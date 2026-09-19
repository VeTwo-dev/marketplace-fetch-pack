import {
  validateSchemaVersion,
  SUPPORTED_MANIFEST_VERSIONS,
} from "../compat/index.js";
import type {
  ResourceManifest,
  ManifestFile,
  ManifestFileName,
  VetwoResourceMetadata,
} from "../types/manifest.js";
import type {
  Resource,
  ResourceAuthor,
  ResourceFile,
  ResourceDependency,
  ResourceCompatibility,
} from "../types/resource.js";
import { MANIFEST_FILE_NAMES } from "../types/manifest.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { sha256, isPlainObject } from "../utils/index.js";

export class ManifestParser {
  private readonly _logger: Logger;

  constructor(logger?: Logger) {
    this._logger = logger ?? createLogger({ prefix: "manifest" });
  }

  detectManifest(files: ReadonlyArray<ManifestFile>): ManifestFile | null {
    for (const name of MANIFEST_FILE_NAMES) {
      const found = files.find((f) => f.fileName === name);
      if (found !== undefined) {
        if (name === "package.json") {
          if (this._hasVetwoResource(found.content)) {
            return found;
          }
          continue;
        }
        return found;
      }
    }
    return null;
  }

  parse(
    content: Readonly<Record<string, unknown>>,
    manifestFileName: ManifestFileName,
    manifestPath: string,
  ): ResourceManifest {
    // Schema version gate (Phase 18 Step 28): unsupported future versions
    // fail clearly — they are never silently parsed as the current schema.
    if (manifestFileName !== "package.json") {
      const declared =
        (content as Record<string, unknown>)["schemaVersion"] ??
        (content as Record<string, unknown>)["manifestVersion"];
      const check = validateSchemaVersion(
        declared,
        SUPPORTED_MANIFEST_VERSIONS,
        "manifest",
      );
      if (!check.supported) {
        throw new MarketplaceClientError("MANIFEST_INVALID", {
          message: check.error,
          context: { manifestPath, declaredVersion: String(declared) },
        });
      }
    }
    if (manifestFileName === "package.json") {
      return this._parsePackageJson(content, manifestPath);
    }
    return this._parseDirect(content, manifestPath);
  }

  validate(manifest: ResourceManifest): ReadonlyArray<string> {
    const errors: Array<string> = [];

    if (manifest.name === "" || manifest.name === undefined) {
      errors.push("Manifest must have a non-empty 'name' field");
    }
    if (manifest.version === "" || manifest.version === undefined) {
      errors.push("Manifest must have a non-empty 'version' field");
    }
    if (manifest.description === "" || manifest.description === undefined) {
      errors.push("Manifest must have a non-empty 'description' field");
    }
    if (manifest.author === undefined) {
      errors.push("Manifest must have an 'author' field");
    } else if (
      typeof manifest.author === "string" ||
      typeof manifest.author === "object"
    ) {
      // author is valid
    } else {
      errors.push(
        "Manifest 'author' must be a string or object with 'name' property",
      );
    }
    if (manifest.category === "" || manifest.category === undefined) {
      errors.push("Manifest must have a non-empty 'category' field");
    }
    if (!Array.isArray(manifest.tags)) {
      errors.push("Manifest must have a 'tags' array");
    }
    if (!Array.isArray(manifest.files)) {
      errors.push("Manifest must have a 'files' array");
    }
    if (
      manifest.version !== undefined &&
      !this._isValidSemver(manifest.version)
    ) {
      errors.push(`Invalid version format: ${manifest.version}`);
    }

    return errors;
  }

  manifestToResource(
    manifest: ResourceManifest,
    manifestPath: string,
  ): Resource {
    const manifestHash = sha256(JSON.stringify(manifest));
    return {
      id: manifest.name,
      name: manifest.name,
      displayName: manifest.name,
      description: manifest.description,
      version: manifest.version,
      category: manifest.category,
      tags: manifest.tags,
      author: this._normalizeAuthor(manifest.author),
      files: manifest.files,
      dependencies:
        (manifest.dependencies as readonly ResourceDependency[]) ?? [],
      compatibility: manifest.compatibility as
        ResourceCompatibility | undefined,
      repository: manifest.repository,
      homepage: manifest.homepage,
      license: manifest.license,
      keywords: (manifest.keywords as readonly string[]) ?? [],
      defaultDestination: manifest.defaultDestination as string | undefined,
      manifestPath,
      manifestHash,
    };
  }

  computeHash(content: string): string {
    return sha256(content);
  }

  private _parseDirect(
    content: Readonly<Record<string, unknown>>,
    _manifestPath: string,
  ): ResourceManifest {
    return {
      name: this._getString(content, "name"),
      resourceId: this._getOptionalString(content, "id"),
      version: this._getString(content, "version"),
      description: this._getString(content, "description"),
      author: this._parseAuthor(content["author"]),
      category: this._getString(content, "category"),
      tags: this._getStringArray(content, "tags"),
      files: this._parseFiles(content["files"]),
      dependencies: this._parseDependencies(content["dependencies"]) ?? [],
      compatibility: this._parseCompatibility(content["compatibility"]),
      repository: this._getOptionalString(content, "repository"),
      homepage: this._getOptionalString(content, "homepage"),
      license: this._getOptionalString(content, "license"),
      keywords: this._getOptionalStringArray(content, "keywords") ?? [],
      defaultDestination: this._getOptionalString(
        content,
        "defaultDestination",
      ),
      engine: this._getOptionalString(content, "engine"),
      vetwo: this._parseVetwo(content["vetwo"]),
    };
  }

  private _parsePackageJson(
    content: Readonly<Record<string, unknown>>,
    manifestPath: string,
  ): ResourceManifest {
    const vetwo = content["vetwo"] as
      Readonly<Record<string, unknown>> | undefined;
    const resource = vetwo?.["resource"] as
      Readonly<Record<string, unknown>> | undefined;

    if (resource === undefined) {
      throw new MarketplaceClientError("MANIFEST_INVALID", {
        message: "package.json does not contain vetwo.resource",
        context: { path: manifestPath },
      });
    }

    return this._parseDirect(resource, manifestPath);
  }

  private _hasVetwoResource(
    content: Readonly<Record<string, unknown>>,
  ): boolean {
    const vetwo = content["vetwo"];
    if (!isPlainObject(vetwo)) return false;
    const resource = vetwo["resource"];
    return isPlainObject(resource);
  }

  private _parseAuthor(value: unknown): ResourceAuthor {
    if (typeof value === "string") {
      return { name: value };
    }
    if (isPlainObject(value)) {
      return {
        name: this._getString(
          value as Readonly<Record<string, unknown>>,
          "name",
        ),
        email: this._getOptionalString(
          value as Readonly<Record<string, unknown>>,
          "email",
        ),
        url: this._getOptionalString(
          value as Readonly<Record<string, unknown>>,
          "url",
        ),
        github: this._getOptionalString(
          value as Readonly<Record<string, unknown>>,
          "github",
        ),
      };
    }
    return { name: "Unknown" };
  }

  private _parseFiles(value: unknown): ReadonlyArray<ResourceFile> {
    if (!Array.isArray(value)) return [];
    return value
      .filter((f): f is Readonly<Record<string, unknown>> => isPlainObject(f))
      .map((f) => ({
        path: this._getString(f, "path"),
        sha: this._getOptionalString(f, "sha"),
        size: this._getOptionalNumber(f, "size"),
      }));
  }

  private _parseDependencies(
    value: unknown,
  ): ReadonlyArray<ResourceDependency> | undefined {
    // Object form used by the real marketplace schema: { "<id>": "<range>" }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.entries(value as Readonly<Record<string, unknown>>)
        .filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" && entry[0] !== "",
        )
        .map(([id, version]) => ({ id, version, optional: false }));
    }
    if (!Array.isArray(value)) return undefined;
    return value
      .filter((d): d is Readonly<Record<string, unknown>> => isPlainObject(d))
      .map((d) => ({
        id: this._getString(d, "id"),
        version: this._getOptionalString(d, "version"),
        optional: this._getOptionalBoolean(d, "optional"),
      }));
  }

  private _parseCompatibility(
    value: unknown,
  ): ResourceCompatibility | undefined {
    if (!isPlainObject(value)) return undefined;
    const obj = value as Readonly<Record<string, unknown>>;
    return {
      node: this._getOptionalString(obj, "node"),
      frameworks: this._getOptionalStringArray(obj, "frameworks"),
      platforms: this._getOptionalStringArray(obj, "platforms") as
        ReadonlyArray<"linux" | "darwin" | "win32"> | undefined,
    };
  }

  private _parseVetwo(value: unknown): VetwoResourceMetadata | undefined {
    if (!isPlainObject(value)) return undefined;
    const obj = value as Readonly<Record<string, unknown>>;
    return {
      minNodeVersion: this._getOptionalString(obj, "minNodeVersion"),
      frameworks: this._getOptionalStringArray(obj, "frameworks"),
      peerDependencies: this._getOptionalRecord(obj, "peerDependencies"),
      exports: this._getOptionalRecord(obj, "exports"),
    };
  }

  private _normalizeAuthor(author: ResourceAuthor): ResourceAuthor {
    return {
      name: author.name,
      email: author.email,
      url: author.url,
      github: author.github,
    };
  }

  private _getString(
    obj: Readonly<Record<string, unknown>>,
    key: string,
  ): string {
    const value = obj[key];
    if (typeof value !== "string" || value === "") {
      throw new MarketplaceClientError("MANIFEST_INVALID", {
        message: `Missing or empty required field: ${key}`,
        context: { key },
      });
    }
    return value;
  }

  private _getOptionalString(
    obj: Readonly<Record<string, unknown>>,
    key: string,
  ): string | undefined {
    const value = obj[key];
    if (typeof value !== "string") return undefined;
    return value === "" ? undefined : value;
  }

  private _getOptionalNumber(
    obj: Readonly<Record<string, unknown>>,
    key: string,
  ): number | undefined {
    const value = obj[key];
    if (typeof value !== "number") return undefined;
    return value;
  }

  private _getOptionalBoolean(
    obj: Readonly<Record<string, unknown>>,
    key: string,
  ): boolean | undefined {
    const value = obj[key];
    if (typeof value !== "boolean") return undefined;
    return value;
  }

  private _getStringArray(
    obj: Readonly<Record<string, unknown>>,
    key: string,
  ): ReadonlyArray<string> {
    const value = obj[key];
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === "string");
  }

  private _getOptionalStringArray(
    obj: Readonly<Record<string, unknown>>,
    key: string,
  ): ReadonlyArray<string> | undefined {
    const value = obj[key];
    if (!Array.isArray(value)) return undefined;
    const arr = value.filter((v): v is string => typeof v === "string");
    return arr.length > 0 ? arr : undefined;
  }

  private _getOptionalRecord(
    obj: Readonly<Record<string, unknown>>,
    key: string,
  ): Readonly<Record<string, string>> | undefined {
    const value = obj[key];
    if (!isPlainObject(value)) return undefined;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string") {
        result[k] = v;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  private _isValidSemver(version: string): boolean {
    return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/.test(version);
  }
}
