import type {
  VersionRange,
  VersionSpec,
  ResolvedVersion,
  CompatibilityResult,
  CompatibilityIssue,
} from "../types/versions.js";
import type { RegistryResource } from "../types/registry.js";
import { createLogger, type Logger } from "../logger/index.js";

export class VersionResolver {
  private readonly _logger: Logger;

  constructor(logger?: Logger) {
    this._logger = logger ?? createLogger({ prefix: "versions" });
  }

  resolveVersion(
    available: ReadonlyArray<RegistryResource>,
    range: VersionRange,
  ): ResolvedVersion | null {
    if (range === "*" || range === "latest" || range === "") {
      const sorted = [...available].sort((a, b) =>
        this._compareVersions(b.version, a.version),
      );
      const latest = sorted[0];
      if (latest === undefined) return null;
      return { requested: range, resolved: latest.version, satisfies: true };
    }

    const spec = this._parseSpec(range);
    const matching = available
      .filter((r) => this._satisfies(r.version, spec))
      .sort((a, b) => this._compareVersions(b.version, a.version));

    const best = matching[0];
    if (best === undefined) {
      return { requested: range, resolved: "", satisfies: false };
    }

    return { requested: range, resolved: best.version, satisfies: true };
  }

  parseSpec(raw: string): VersionSpec {
    return this._parseSpec(raw);
  }

  satisfies(version: string, spec: VersionSpec): boolean {
    return this._satisfies(version, spec);
  }

  /**
   * Checks a raw range string against a version. Supports compound
   * AND-ranges like ">=1.0.0 <2.0.0" — every part must be satisfied.
   */
  satisfiesRange(version: string, range: string): boolean {
    const parts = range.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return true;
    return parts.every((part) =>
      this._satisfies(version, this._parseSpec(part)),
    );
  }

  compareVersions(a: string, b: string): number {
    return this._compareVersions(a, b);
  }

  getLatest(
    available: ReadonlyArray<RegistryResource>,
  ): RegistryResource | null {
    if (available.length === 0) return null;
    const sorted = [...available].sort((a, b) =>
      this._compareVersions(b.version, a.version),
    );
    return sorted[0] ?? null;
  }

  getCompatible(
    resources: ReadonlyArray<RegistryResource>,
    nodeVersion: string,
    frameworks: ReadonlyArray<string> = [],
  ): ReadonlyArray<RegistryResource> {
    return resources.filter((r) => {
      if (r.compatibility === undefined) return true;

      if (r.compatibility.node !== undefined) {
        if (
          !this._satisfies(nodeVersion, this._parseSpec(r.compatibility.node))
        ) {
          return false;
        }
      }

      if (
        r.compatibility.frameworks !== undefined &&
        r.compatibility.frameworks.length > 0
      ) {
        const hasOverlap = r.compatibility.frameworks.some((f) =>
          frameworks.includes(f),
        );
        if (!hasOverlap) return false;
      }

      if (
        r.compatibility.platforms !== undefined &&
        r.compatibility.platforms.length > 0
      ) {
        if (
          !r.compatibility.platforms.includes(
            process.platform as "linux" | "darwin" | "win32",
          )
        ) {
          return false;
        }
      }

      return true;
    });
  }

  checkCompatibility(
    resource: RegistryResource,
    nodeVersion: string,
    frameworks: ReadonlyArray<string> = [],
  ): CompatibilityResult {
    const issues: Array<CompatibilityIssue> = [];

    if (resource.compatibility?.node !== undefined) {
      const spec = this._parseSpec(resource.compatibility.node);
      if (!this._satisfies(nodeVersion, spec)) {
        issues.push({
          type: "node",
          expected: resource.compatibility.node,
          actual: nodeVersion,
          severity: "error",
        });
      }
    }

    const platforms = resource.compatibility?.platforms ?? [];
    if (platforms.length > 0) {
      const currentPlatform = process.platform;
      if (
        !platforms.includes(currentPlatform as "linux" | "darwin" | "win32")
      ) {
        issues.push({
          type: "platform",
          expected: platforms.join(", "),
          actual: currentPlatform,
          severity: "error",
        });
      }
    }

    const resourceFrameworks = resource.compatibility?.frameworks ?? [];
    if (resourceFrameworks.length > 0 && frameworks.length > 0) {
      const hasOverlap = resourceFrameworks.some((f) => frameworks.includes(f));
      if (!hasOverlap) {
        issues.push({
          type: "framework",
          expected: resourceFrameworks.join(", "),
          actual: frameworks.join(", "),
          severity: "warning",
        });
      }
    }

    return {
      compatible: issues.filter((i) => i.severity === "error").length === 0,
      resource: resource.id,
      resourceVersion: resource.version,
      nodeVersion,
      platforms: platforms.map(String),
      frameworks: resourceFrameworks.map(String),
      issues,
    };
  }

  private _parseSpec(raw: string): VersionSpec {
    const trimmed = raw.trim();

    if (trimmed === "*" || trimmed === "latest" || trimmed === "") {
      return { raw: trimmed, operator: "any", version: "0.0.0" };
    }

    if (trimmed.startsWith(">=")) {
      return { raw: trimmed, operator: "gte", version: trimmed.slice(2) };
    }
    if (trimmed.startsWith("<=")) {
      return { raw: trimmed, operator: "lte", version: trimmed.slice(2) };
    }
    if (trimmed.startsWith(">")) {
      return { raw: trimmed, operator: "gt", version: trimmed.slice(1) };
    }
    if (trimmed.startsWith("<")) {
      return { raw: trimmed, operator: "lt", version: trimmed.slice(1) };
    }
    if (trimmed.startsWith("^")) {
      return { raw: trimmed, operator: "caret", version: trimmed.slice(1) };
    }
    if (trimmed.startsWith("~")) {
      return { raw: trimmed, operator: "tilde", version: trimmed.slice(1) };
    }

    if (trimmed.includes("-")) {
      const parts = trimmed.split("-");
      if (
        parts.length === 2 &&
        parts[0] !== undefined &&
        parts[1] !== undefined
      ) {
        const low = this._parseVersion(parts[0]);
        const high = this._parseVersion(parts[1]);
        if (low !== null && high !== null) {
          return { raw: trimmed, operator: "range", version: trimmed };
        }
      }
    }

    const parsed = this._parseVersion(trimmed);
    if (parsed !== null) {
      return { raw: trimmed, operator: "exact", version: trimmed };
    }

    return { raw: trimmed, operator: "any", version: "0.0.0" };
  }

  private _satisfies(version: string, spec: VersionSpec): boolean {
    const v = this._parseVersion(version);
    if (v === null) return false;

    switch (spec.operator) {
      case "any":
        return true;
      case "exact": {
        const s = this._parseVersion(spec.version);
        return s !== null && this._compareParsed(v, s) === 0;
      }
      case "gte": {
        const s = this._parseVersion(spec.version);
        return s !== null && this._compareParsed(v, s) >= 0;
      }
      case "lte": {
        const s = this._parseVersion(spec.version);
        return s !== null && this._compareParsed(v, s) <= 0;
      }
      case "gt": {
        const s = this._parseVersion(spec.version);
        return s !== null && this._compareParsed(v, s) > 0;
      }
      case "lt": {
        const s = this._parseVersion(spec.version);
        return s !== null && this._compareParsed(v, s) < 0;
      }
      case "caret": {
        const s = this._parseVersion(spec.version);
        if (s === null) return false;
        return this._compareParsed(v, s) >= 0 && v.major === s.major;
      }
      case "tilde": {
        const s = this._parseVersion(spec.version);
        if (s === null) return false;
        return (
          this._compareParsed(v, s) >= 0 &&
          v.major === s.major &&
          v.minor === s.minor
        );
      }
      case "range": {
        const parts = spec.version.split("-");
        if (parts.length !== 2) return false;
        const low = this._parseVersion(parts[0]!);
        const high = this._parseVersion(parts[1]!);
        if (low === null || high === null) return false;
        return (
          this._compareParsed(v, low) >= 0 && this._compareParsed(v, high) <= 0
        );
      }
    }
  }

  private _compareVersions(a: string, b: string): number {
    const pa = this._parseVersion(a);
    const pb = this._parseVersion(b);
    if (pa === null || pb === null) return 0;
    return this._compareParsed(pa, pb);
  }

  private _compareParsed(
    a: { major: number; minor: number; patch: number; pre: string },
    b: { major: number; minor: number; patch: number; pre: string },
  ): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    if (a.pre !== "" && b.pre === "") return -1;
    if (a.pre === "" && b.pre !== "") return 1;
    if (a.pre !== "" && b.pre !== "") {
      return a.pre.localeCompare(b.pre);
    }
    return 0;
  }

  private _parseVersion(
    version: string,
  ): { major: number; minor: number; patch: number; pre: string } | null {
    const cleaned = version.replace(/^v/, "");
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(cleaned);
    if (match === null) return null;
    return {
      major: parseInt(match[1]!, 10),
      minor: parseInt(match[2]!, 10),
      patch: parseInt(match[3]!, 10),
      pre: match[4] ?? "",
    };
  }
}
