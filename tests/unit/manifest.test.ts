import { describe, it, expect } from "vitest";
import { ManifestParser } from "../../src/manifest/index.js";
import type { ManifestFile, ResourceManifest } from "../../src/types/manifest.js";
import { MarketplaceClientError } from "../../src/errors/index.js";

function makeManifestFile(
  fileName: ManifestFile["fileName"],
  content: Record<string, unknown>,
  path?: string,
): ManifestFile {
  return { fileName, path: path ?? `/path/${fileName}`, content };
}

function validManifestContent(): Record<string, unknown> {
  return {
    name: "my-plugin",
    version: "1.2.3",
    description: "A test plugin",
    author: "testuser",
    category: "plugin",
    tags: ["test", "plugin"],
    files: [{ path: "index.js" }],
    dependencies: [],
    keywords: ["test"],
  };
}

describe("ManifestParser", () => {
  const parser = new ManifestParser();

  describe("detectManifest()", () => {
    it("detects resource.json first", () => {
      const files = [
        makeManifestFile("manifest.json", {}),
        makeManifestFile("resource.json", {}),
      ];
      const result = parser.detectManifest(files);
      expect(result).not.toBeNull();
      expect(result!.fileName).toBe("resource.json");
    });

    it("detects manifest.json", () => {
      const files = [makeManifestFile("manifest.json", {})];
      const result = parser.detectManifest(files);
      expect(result!.fileName).toBe("manifest.json");
    });

    it("detects vetwo.json", () => {
      const files = [makeManifestFile("vetwo.json", {})];
      const result = parser.detectManifest(files);
      expect(result!.fileName).toBe("vetwo.json");
    });

    it("detects package.json with vetwo.resource", () => {
      const files = [
        makeManifestFile("package.json", {
          vetwo: { resource: { name: "test" } },
        }),
      ];
      const result = parser.detectManifest(files);
      expect(result).not.toBeNull();
      expect(result!.fileName).toBe("package.json");
    });

    it("skips package.json without vetwo.resource", () => {
      const files = [
        makeManifestFile("package.json", { name: "normal-pkg" }),
      ];
      const result = parser.detectManifest(files);
      expect(result).toBeNull();
    });

    it("returns null when no manifest files present", () => {
      const files = [makeManifestFile("readme.md" as any, {})];
      const result = parser.detectManifest(files);
      expect(result).toBeNull();
    });

    it("prioritizes resource.json over package.json", () => {
      const files = [
        makeManifestFile("package.json", { vetwo: { resource: {} } }),
        makeManifestFile("resource.json", {}),
      ];
      const result = parser.detectManifest(files);
      expect(result!.fileName).toBe("resource.json");
    });
  });

  describe("parse()", () => {
    it("parses resource.json format", () => {
      const content = validManifestContent();
      const result = parser.parse(content, "resource.json", "/path/resource.json");
      expect(result.name).toBe("my-plugin");
      expect(result.version).toBe("1.2.3");
      expect(result.description).toBe("A test plugin");
      expect(result.category).toBe("plugin");
      expect(result.tags).toEqual(["test", "plugin"]);
      expect(result.author).toEqual({ name: "testuser" });
      expect(result.files).toHaveLength(1);
    });

    it("parses package.json format with vetwo.resource", () => {
      const content = {
        name: "npm-pkg",
        vetwo: { resource: validManifestContent() },
      };
      const result = parser.parse(content, "package.json", "/path/package.json");
      expect(result.name).toBe("my-plugin");
    });

    it("throws on package.json without vetwo.resource", () => {
      expect(() =>
        parser.parse({ name: "test" }, "package.json", "/path/package.json"),
      ).toThrow(MarketplaceClientError);
    });

    it("parses author as string", () => {
      const content = { ...validManifestContent(), author: "simple-name" };
      const result = parser.parse(content, "resource.json", "/p");
      expect(result.author).toEqual({ name: "simple-name" });
    });

    it("parses author as object", () => {
      const content = {
        ...validManifestContent(),
        author: { name: "Test User", email: "t@t.com", url: "https://example.com", github: "testuser" },
      };
      const result = parser.parse(content, "resource.json", "/p");
      expect(result.author).toEqual({
        name: "Test User",
        email: "t@t.com",
        url: "https://example.com",
        github: "testuser",
      });
    });

    it("parses dependencies", () => {
      const content = {
        ...validManifestContent(),
        dependencies: [
          { id: "dep1", version: "^1.0.0" },
          { id: "dep2", optional: true },
        ],
      };
      const result = parser.parse(content, "resource.json", "/p");
      expect(result.dependencies).toHaveLength(2);
      expect(result.dependencies[0]!.id).toBe("dep1");
      expect(result.dependencies[1]!.optional).toBe(true);
    });

    it("parses compatibility", () => {
      const content = {
        ...validManifestContent(),
        compatibility: { node: ">=20", frameworks: ["react"], platforms: ["linux", "darwin"] },
      };
      const result = parser.parse(content, "resource.json", "/p");
      expect(result.compatibility).toEqual({
        node: ">=20",
        frameworks: ["react"],
        platforms: ["linux", "darwin"],
      });
    });

    it("parses optional fields", () => {
      const content = {
        ...validManifestContent(),
        repository: "https://github.com/test/test",
        homepage: "https://example.com",
        license: "MIT",
        defaultDestination: ".vetwo/resources/my-plugin",
        engine: ">=20",
      };
      const result = parser.parse(content, "resource.json", "/p");
      expect(result.repository).toBe("https://github.com/test/test");
      expect(result.homepage).toBe("https://example.com");
      expect(result.license).toBe("MIT");
      expect(result.defaultDestination).toBe(".vetwo/resources/my-plugin");
      expect(result.engine).toBe(">=20");
    });

    it("throws on missing required field", () => {
      const content = { version: "1.0.0" };
      expect(() => parser.parse(content, "resource.json", "/p")).toThrow(MarketplaceClientError);
    });
  });

  describe("validate()", () => {
    it("returns empty array for valid manifest", () => {
      const manifest: ResourceManifest = {
        name: "test",
        version: "1.0.0",
        description: "desc",
        author: { name: "author" },
        category: "plugin",
        tags: ["tag"],
        files: [{ path: "file.js" }],
        dependencies: [],
        keywords: [],
      };
      expect(parser.validate(manifest)).toEqual([]);
    });

    it("flags missing name", () => {
      const manifest: ResourceManifest = {
        name: "",
        version: "1.0.0",
        description: "d",
        author: { name: "a" },
        category: "c",
        tags: [],
        files: [],
        dependencies: [],
        keywords: [],
      };
      const errors = parser.validate(manifest);
      expect(errors.some((e) => e.includes("name"))).toBe(true);
    });

    it("flags missing version", () => {
      const manifest: ResourceManifest = {
        name: "test",
        version: "",
        description: "d",
        author: { name: "a" },
        category: "c",
        tags: [],
        files: [],
        dependencies: [],
        keywords: [],
      };
      const errors = parser.validate(manifest);
      expect(errors.some((e) => e.includes("version"))).toBe(true);
    });

    it("flags missing description", () => {
      const manifest: ResourceManifest = {
        name: "test",
        version: "1.0.0",
        description: "",
        author: { name: "a" },
        category: "c",
        tags: [],
        files: [],
        dependencies: [],
        keywords: [],
      };
      const errors = parser.validate(manifest);
      expect(errors.some((e) => e.includes("description"))).toBe(true);
    });

    it("flags missing author", () => {
      const manifest: ResourceManifest = {
        name: "test",
        version: "1.0.0",
        description: "d",
        author: undefined as any,
        category: "c",
        tags: [],
        files: [],
        dependencies: [],
        keywords: [],
      };
      const errors = parser.validate(manifest);
      expect(errors.some((e) => e.includes("author"))).toBe(true);
    });

    it("flags missing category", () => {
      const manifest: ResourceManifest = {
        name: "test",
        version: "1.0.0",
        description: "d",
        author: { name: "a" },
        category: "",
        tags: [],
        files: [],
        dependencies: [],
        keywords: [],
      };
      const errors = parser.validate(manifest);
      expect(errors.some((e) => e.includes("category"))).toBe(true);
    });

    it("flags invalid version format", () => {
      const manifest: ResourceManifest = {
        name: "test",
        version: "not-a-version",
        description: "d",
        author: { name: "a" },
        category: "c",
        tags: [],
        files: [],
        dependencies: [],
        keywords: [],
      };
      const errors = parser.validate(manifest);
      expect(errors.some((e) => e.includes("Invalid version"))).toBe(true);
    });
  });

  describe("manifestToResource()", () => {
    it("converts manifest to Resource", () => {
      const manifest: ResourceManifest = {
        name: "test-resource",
        version: "2.0.0",
        description: "desc",
        author: { name: "author", email: "a@b.com" },
        category: "plugin",
        tags: ["tag1"],
        files: [{ path: "index.js", size: 100 }],
        dependencies: [{ id: "dep1", version: "^1.0.0" }],
        keywords: ["kw1"],
        repository: "https://github.com/test/test",
        license: "MIT",
      };
      const resource = parser.manifestToResource(manifest, "/path/resource.json");
      expect(resource.id).toBe("test-resource");
      expect(resource.name).toBe("test-resource");
      expect(resource.version).toBe("2.0.0");
      expect(resource.manifestPath).toBe("/path/resource.json");
      expect(typeof resource.manifestHash).toBe("string");
      expect(resource.manifestHash.length).toBe(64); // sha256 hex
    });
  });

  describe("computeHash()", () => {
    it("returns a 64-char hex string", () => {
      const hash = parser.computeHash("hello world");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("different inputs produce different hashes", () => {
      const h1 = parser.computeHash("input1");
      const h2 = parser.computeHash("input2");
      expect(h1).not.toBe(h2);
    });

    it("same input produces same hash", () => {
      expect(parser.computeHash("test")).toBe(parser.computeHash("test"));
    });
  });
});
