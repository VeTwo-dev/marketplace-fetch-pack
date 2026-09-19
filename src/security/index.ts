import { realpath, lstat, mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, dirname } from "node:path";
import { MarketplaceClientError } from "../errors/index.js";

// ─── Security Policy (Step 3) ─────────────────────────────────────────

export type ScriptExecutionPolicy = "deny" | "allow-registered" | "allow-all";

export interface SecurityPolicy {
  /** Reject paths escaping the destination root */
  readonly enforcePathSandbox: boolean;
  /** Allow symlinks inside resources (conservative default: false) */
  readonly allowSymlinks: boolean;
  /** Maximum size of a single file (bytes) */
  readonly maxFileSizeBytes: number;
  /** Maximum total installed resource size (bytes) */
  readonly maxTotalSizeBytes: number;
  /** Maximum number of files per resource */
  readonly maxFileCount: number;
  /** Maximum dependency count per resource */
  readonly maxDependencyCount: number;
  /** Maximum dependency resolution depth */
  readonly maxDependencyDepth: number;
  /** Allowed remote URL protocols for providers/downloads */
  readonly allowedProtocols: ReadonlyArray<string>;
  /** Block localhost/private-network URLs (SSRF guard) */
  readonly blockPrivateNetworks: boolean;
  /** Script/command execution policy (default deny — never run resource scripts) */
  readonly scriptExecution: ScriptExecutionPolicy;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  enforcePathSandbox: true,
  allowSymlinks: false,
  maxFileSizeBytes: 50 * 1024 * 1024,
  maxTotalSizeBytes: 500 * 1024 * 1024,
  maxFileCount: 10_000,
  maxDependencyCount: 200,
  maxDependencyDepth: 128,
  allowedProtocols: ["https:"],
  blockPrivateNetworks: true,
  scriptExecution: "deny",
};

function securityError(
  code: import("../types/errors.js").ErrorCode,
  message: string,
  context?: Record<string, unknown>,
): MarketplaceClientError {
  return new MarketplaceClientError(code, { message, context });
}

// ─── Path traversal protection (Step 4) ──────────────────────────────

// eslint-disable-next-line no-control-regex -- intentional: we must DETECT control characters
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

/**
 * Validates a resource-provided relative path against traversal attacks.
 *
 * Rejects:
 * - absolute POSIX paths (/etc/passwd)
 * - Windows drive paths (C:\x, C:/x)
 * - UNC paths (\\\\server\\share)
 * - dot-segment escapes (../, ..\)
 * - control characters / null bytes
 * - encoded traversal that survives normalization (%2e%2e/ handled by
 *   callers decoding before calling; raw sequences are rejected)
 */
export function isSafeRelativePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.length > 4096) return false;
  if (CONTROL_CHARS.test(path)) return false;

  // Absolute or Windows-specific forms
  if (isAbsolute(path)) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  if (path.startsWith("\\\\") || path.startsWith("//")) return false;

  // Encoded traversal sequences (rejected outright — callers must decode
  // before submitting paths; encoded dots are never legitimate file names
  // in this ecosystem and rejecting is the conservative choice)
  const lowered = path.toLowerCase();
  if (
    lowered.includes("%2e") ||
    lowered.includes("%2f") ||
    lowered.includes("%5c")
  ) {
    return false;
  }

  // Segment walk with depth tracking (handles mixed separators)
  const normalized = path.replace(/\\/g, "/");
  let depth = 0;
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      depth--;
      if (depth < 0) return false;
      continue;
    }
    // Windows reserved device names (even mid-path on some filesystems)
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(segment)) return false;
    depth++;
  }
  return depth > 0;
}

/**
 * Resolves a relative path within a destination root and verifies the
 * canonical result stays inside it. Uses path resolution (not string
 * prefixes). Returns the absolute target path.
 */
export function resolveWithinRoot(root: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) {
    throw securityError(
      "DESTINATION_INVALID",
      `Unsafe resource path rejected: ${relativePath}`,
      {
        relativePath,
        reason: "path-traversal",
      },
    );
  }
  const rootResolved = resolve(root);
  const target = resolve(rootResolved, relativePath);
  const rel = relative(rootResolved, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw securityError(
      "DESTINATION_INVALID",
      `Path escapes destination sandbox: ${relativePath}`,
      {
        relativePath,
        reason: "sandbox-escape",
      },
    );
  }
  return target;
}

/**
 * Symlink escape check (Step 6): walks from the target's deepest existing
 * ancestor to the root. If any existing component is a symlink, rejects
 * unless the policy allows symlinks AND it stays inside the root.
 */
export async function assertNoSymlinkEscape(
  root: string,
  targetPath: string,
  policy: SecurityPolicy,
): Promise<void> {
  if (!policy.enforcePathSandbox) return;

  const rootReal = await safeRealpath(root);

  let current = resolve(targetPath);
  const rootResolved = resolve(root);

  while (current.startsWith(rootResolved) && current !== rootResolved) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        if (!policy.allowSymlinks) {
          throw securityError(
            "PERMISSION_DENIED",
            `Symlink in resource path rejected: ${current}`,
            {
              path: current,
              reason: "symlink-policy",
            },
          );
        }
        // Even when allowed, canonical resolution must stay in root
        const real = await safeRealpath(current);
        const rel = relative(rootReal ?? rootResolved, real ?? "");
        if (rel.startsWith("..")) {
          throw securityError(
            "PERMISSION_DENIED",
            `Symlink escapes destination root: ${current}`,
            {
              path: current,
              reason: "symlink-escape",
            },
          );
        }
      }
    } catch (error) {
      if (error instanceof MarketplaceClientError) throw error;
      // component does not exist yet — fine, keep walking up
    }
    current = dirname(current);
  }
}

async function safeRealpath(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}

/**
 * Destination sandbox (Step 5): ensures root exists and returns its
 * canonical real path so later comparisons cannot be spoofed.
 */
export async function ensureDestinationRoot(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const real = await realpath(root);
  return real;
}

// ─── File type safety (Step 7) ───────────────────────────────────────

export async function assertSafeFileType(
  filePath: string,
  policy: SecurityPolicy,
): Promise<void> {
  if (!policy.allowSymlinks) {
    const info = await lstat(filePath).catch(() => null);
    if (info?.isSymbolicLink()) {
      throw securityError(
        "PERMISSION_DENIED",
        `Refusing to install symlink: ${filePath}`,
        {
          path: filePath,
          reason: "symlink-policy",
        },
      );
    }
    if (info !== null && !info.isFile() && !info.isDirectory()) {
      throw securityError(
        "PERMISSION_DENIED",
        `Unsupported filesystem object refused: ${filePath}`,
        {
          path: filePath,
          kind: info.isFIFO()
            ? "fifo"
            : info.isSocket()
              ? "socket"
              : info.isBlockDevice()
                ? "block"
                : info.isCharacterDevice()
                  ? "char"
                  : "unknown",
        },
      );
    }
  }
}

// ─── Size limits (Step 8) ────────────────────────────────────────────

export function assertFileSize(
  sizeBytes: number,
  policy: SecurityPolicy,
  label: string,
): void {
  if (sizeBytes > policy.maxFileSizeBytes) {
    throw securityError("DISK_FULL", `File exceeds maximum size: ${label}`, {
      size: sizeBytes,
      limit: policy.maxFileSizeBytes,
      reason: "file-size-limit",
    }) as never;
  }
}

export function assertResourceSize(
  totalBytes: number,
  fileCount: number,
  policy: SecurityPolicy,
): void {
  if (totalBytes > policy.maxTotalSizeBytes) {
    throw securityError("DISK_FULL", "Resource exceeds total size limit", {
      size: totalBytes,
      limit: policy.maxTotalSizeBytes,
      reason: "resource-size-limit",
    }) as never;
  }
  if (fileCount > policy.maxFileCount) {
    throw securityError(
      "INSTALL_FAILED",
      "Resource exceeds file count limit (possible resource bomb)",
      {
        files: fileCount,
        limit: policy.maxFileCount,
        reason: "file-count-limit",
      },
    ) as never;
  }
}

export function assertDependencyLimits(
  count: number,
  depth: number,
  policy: SecurityPolicy,
): void {
  if (count > policy.maxDependencyCount) {
    throw securityError(
      "DEPENDENCY_CONFLICT",
      `Dependency count ${count} exceeds limit`,
      {
        count,
        limit: policy.maxDependencyCount,
        reason: "dependency-count",
      },
    ) as never;
  }
  if (depth > policy.maxDependencyDepth) {
    throw securityError(
      "DEPENDENCY_CIRCULAR",
      `Dependency depth ${depth} exceeds limit (possible dependency explosion)`,
      {
        depth,
        limit: policy.maxDependencyDepth,
        reason: "dependency-depth",
      },
    ) as never;
  }
}

// ─── URL validation (Steps 19–20) ────────────────────────────────────

const PRIVATE_HOST_PATTERNS: ReadonlyArray<RegExp> = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /\.local$/i,
  /^0\.0\.0\.0$/,
];

export interface UrlValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly url?: URL;
}

export function validateRemoteUrl(
  rawUrl: string,
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY,
): UrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: "unparseable-url" };
  }

  if (!policy.allowedProtocols.includes(parsed.protocol)) {
    return { valid: false, reason: `protocol-not-allowed:${parsed.protocol}` };
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return { valid: false, reason: "credentials-in-url" };
  }

  if (
    policy.blockPrivateNetworks &&
    PRIVATE_HOST_PATTERNS.some((p) => p.test(parsed.hostname))
  ) {
    return { valid: false, reason: "private-network-blocked" };
  }

  return { valid: true, url: parsed };
}

/**
 * Redirect security (Step 20): sensitive credentials must only be sent to
 * the origin they belong to. Returns true if headers may be forwarded.
 */
export function mayForwardSensitiveHeaders(
  originalUrl: string,
  redirectUrl: string,
): boolean {
  try {
    const origin = new URL(originalUrl).origin;
    const redirected = new URL(redirectUrl).origin;
    return origin === redirected;
  } catch {
    return false;
  }
}

// ─── Script execution policy (Step 14) ───────────────────────────────

export function assertScriptExecutionAllowed(
  command: string,
  policy: SecurityPolicy,
): void {
  if (policy.scriptExecution === "deny") {
    throw securityError(
      "PERMISSION_DENIED",
      `Script execution denied by security policy: ${command.slice(0, 80)}`,
      {
        command: command.slice(0, 120),
        reason: "script-execution-deny",
      },
    );
  }
}
