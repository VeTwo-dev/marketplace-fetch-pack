import { writeFile, mkdir, lstat } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";
import {
  type SecurityPolicy,
  resolveWithinRoot,
  isSafeRelativePath,
} from "./index.js";
import { MarketplaceClientError } from "../errors/index.js";

/**
 * Format-independent archive safety (Phase 17 Step 9).
 *
 * Any provider that supports archives (zip/tar/etc.) must reduce the
 * archive to ArchiveEntryDescriptors and pass them through these guards
 * BEFORE writing anything. Extraction happens only inside a controlled
 * destination root — never directly into the project.
 */

export interface ArchiveEntryDescriptor {
  /** Entry path exactly as recorded in the archive */
  readonly path: string;
  readonly type: "file" | "symlink" | "dir" | "special";
  /** Uncompressed size in bytes */
  readonly sizeBytes: number;
  /** Symlink target (only for type === "symlink") */
  readonly target?: string;
}

export interface ArchiveEntryWithContent extends ArchiveEntryDescriptor {
  readonly content?: string;
}

export interface ArchiveSafetyResult<T extends ArchiveEntryDescriptor> {
  readonly allowed: ReadonlyArray<T>;
  readonly rejected: ReadonlyArray<{
    readonly entry: T;
    readonly reason: string;
  }>;
}

/**
 * Validates archive entries against the security policy.
 *
 * Rejects:
 * - path traversal / absolute / drive paths (zip slip)
 * - symlinks (unless policy.allowSymlinks AND target stays relative & inside)
 * - special files (devices, fifos, sockets)
 * - oversized individual files
 * - excessive file counts and total extracted size (decompression bombs)
 *
 * Throws only for aggregate bomb conditions; individual bad entries are
 * reported in `rejected` so callers can surface precise errors.
 */
export function validateArchiveEntries<T extends ArchiveEntryDescriptor>(
  entries: ReadonlyArray<T>,
  policy: SecurityPolicy,
): ArchiveSafetyResult<T> {
  const allowed: T[] = [];
  const rejected: Array<{ entry: T; reason: string }> = [];

  let totalBytes = 0;

  for (const entry of entries) {
    if (!isSafeRelativePath(entry.path)) {
      rejected.push({ entry, reason: `unsafe-entry-path:${entry.path}` });
      continue;
    }

    if (entry.type === "special") {
      rejected.push({ entry, reason: `special-file-refused:${entry.path}` });
      continue;
    }

    if (entry.type === "symlink") {
      const target = entry.target ?? "";
      // Only relative targets resolving INSIDE the archive root may be
      // allowed, and only when the policy explicitly permits symlinks.
      if (
        !policy.allowSymlinks ||
        isAbsolute(target) ||
        /^[a-zA-Z]:/.test(target)
      ) {
        rejected.push({
          entry,
          reason: `archive-symlink-refused:${entry.path}`,
        });
        continue;
      }
      // Resolve the link against its containing directory; must stay in root
      const linkDir = entry.path.includes("/")
        ? entry.path.slice(0, entry.path.lastIndexOf("/"))
        : "";
      const normalizedTarget = normalize(
        linkDir ? `${linkDir}/${target}` : target,
      );
      if (normalizedTarget.startsWith("..")) {
        rejected.push({
          entry,
          reason: `archive-symlink-escape:${entry.path}`,
        });
        continue;
      }
      allowed.push(entry);
      continue;
    }

    if (entry.sizeBytes > policy.maxFileSizeBytes) {
      rejected.push({ entry, reason: `file-size-limit:${entry.path}` });
      continue;
    }

    totalBytes += entry.sizeBytes;
    if (totalBytes > policy.maxTotalSizeBytes) {
      throw new MarketplaceClientError("DISK_FULL", {
        message:
          "Archive exceeds total extracted size limit (possible decompression bomb)",
        context: {
          totalBytes,
          limit: policy.maxTotalSizeBytes,
          reason: "decompression-bomb",
        },
      });
    }

    allowed.push(entry);
  }

  if (allowed.length > policy.maxFileCount) {
    throw new MarketplaceClientError("INSTALL_FAILED", {
      message: "Archive exceeds maximum file count (possible resource bomb)",
      context: {
        files: allowed.length,
        limit: policy.maxFileCount,
        reason: "archive-file-count",
      },
    });
  }

  return { allowed, rejected };
}

/**
 * Safely extracts validated archive entries into destinationRoot.
 * Every write passes through the same path sandbox as ordinary installs.
 * Symlink/special entries present in `allowed` (policy-permitted) are still
 * refused here at write time if they exist on disk as symlinks already.
 */
export async function extractArchiveEntries(
  entries: ReadonlyArray<ArchiveEntryWithContent>,
  destinationRoot: string,
  policy: SecurityPolicy,
): Promise<{ written: ReadonlyArray<string>; skipped: ReadonlyArray<string> }> {
  const safety = validateArchiveEntries(entries, policy);
  const written: string[] = [];
  const skipped = safety.rejected.map((r) => r.entry.path);

  await mkdir(destinationRoot, { recursive: true });

  for (const entry of safety.allowed) {
    if (entry.type === "symlink") continue;
    if (entry.type === "dir") {
      await mkdir(resolveWithinRoot(destinationRoot, entry.path), {
        recursive: true,
      });
      written.push(entry.path);
      continue;
    }
    if (typeof entry.content !== "string") {
      skipped.push(entry.path);
      continue;
    }

    const target = resolveWithinRoot(destinationRoot, entry.path);
    // Refuse to overwrite existing symlinks inside the root
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink() && !policy.allowSymlinks) {
        skipped.push(entry.path);
        continue;
      }
    } catch {
      // does not exist yet — proceed
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(entry.content, "utf-8"));
    written.push(entry.path);
  }

  return { written, skipped };
}
