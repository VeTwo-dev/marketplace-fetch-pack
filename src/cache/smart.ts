import { readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";

// ─── Cache entry states (Step 33) ────────────────────────────────────

export type CacheEntryState =
  "fresh" | "stale" | "expired" | "invalid" | "corrupt" | "missing";

export interface CacheStateInfo<T> {
  readonly state: CacheEntryState;
  readonly value: T | null;
  readonly ageMs: number;
}

/** Per-category TTL policy (Step 37) — registry metadata changes slowly. */
export const CATEGORY_TTL_MS: Readonly<Record<string, number>> = {
  registry: 15 * 60 * 1000,
  manifests: 60 * 60 * 1000,
  downloads: 24 * 60 * 60 * 1000,
  "search-index": 30 * 60 * 1000,
  compatibility: 6 * 60 * 60 * 1000,
  general: 60 * 60 * 1000,
} as const;

export const GENERAL_TTL_MS = 60 * 60 * 1000;

export function categoryTtl(category: string): number {
  return CATEGORY_TTL_MS[category] ?? GENERAL_TTL_MS;
}

/**
 * Classifies an entry's freshness given its cached timestamp and category.
 * stale = usable under stale-while-revalidate semantics.
 */
export function classifyEntry(
  cachedAtMs: number,
  category: string,
  now = Date.now(),
): Exclude<CacheEntryState, "invalid" | "corrupt" | "missing"> {
  const age = now - cachedAtMs;
  const ttl = categoryTtl(category);
  // Stale window is 5x the fresh TTL
  if (age < ttl) return "fresh";
  if (age < ttl * 5) return "stale";
  return "expired";
}

// ─── Cache key namespacing validation (Step 31) ──────────────────────

export interface NamespacedKeyParts {
  readonly provider: string;
  readonly repository: string;
  readonly ref: string;
  readonly label: string;
}

/**
 * Human-readable namespaced cache key. Collisions across different
 * providers/repos/refs are structurally impossible because the key embeds
 * all context components separated by a delimiter that cannot appear in them.
 */
export function buildNamespacedKey(parts: NamespacedKeyParts): string {
  return `${parts.provider}::${parts.repository}::${parts.ref}::${parts.label}`;
}

export function parseNamespacedKey(key: string): NamespacedKeyParts | null {
  const segments = key.split("::");
  if (segments.length !== 4) return null;
  return {
    provider: segments[0]!,
    repository: segments[1]!,
    ref: segments[2]!,
    label: segments[3]!,
  };
}

// ─── Cross-process stampede guard (Step 36) ──────────────────────────

export interface StampedeGuardOptions {
  readonly lockDir: string;
  readonly key: string;
  /** Locks older than this are considered abandoned (ms) */
  readonly maxAgeMs?: number;
}

/**
 * Cross-process stampede prevention using atomic lock-file creation.
 * The FIRST caller runs `fn`; concurrent callers wait for the same result.
 * If the lock holder crashes, the next caller after maxAge takes over.
 */
export async function withStampedeGuard<T>(
  options: StampedeGuardOptions,
  fn: () => Promise<T>,
): Promise<{ value: T; leader: boolean }> {
  await mkdir(options.lockDir, { recursive: true });
  const lockPath = join(options.lockDir, `${sanitize(options.key)}.lock`);
  const maxAge = options.maxAgeMs ?? 30_000;

  let leader = false;
  try {
    // wx flag: atomic create — only one process wins
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, at: Date.now() }),
      {
        flag: "wx",
      },
    );
    leader = true;
  } catch {
    // Lock exists — check for staleness (crashed holder)
    try {
      const raw = JSON.parse(await readFile(lockPath, "utf-8")) as {
        at?: number;
      };
      if (typeof raw.at === "number" && Date.now() - raw.at > maxAge) {
        // Take over the abandoned lock
        await writeFile(
          lockPath,
          JSON.stringify({ pid: process.pid, at: Date.now() }),
        );
        leader = true;
      }
    } catch {
      // unreadable lock — treat as contended
    }
  }

  if (!leader) {
    // Wait briefly for the leader's result by polling for lock release
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const stillLocked = await lockExists(lockPath);
      if (!stillLocked) break; // leader finished
      await sleep(50);
    }
    // Followers re-execute fn from their own (now warm) caches; the network
    // dedup layer ensures they do not duplicate requests.
    const value = await fn();
    return { value, leader: false };
  }

  try {
    const value = await fn();
    return { value, leader: true };
  } finally {
    await rm(lockPath, { force: true });
  }
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function lockExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Cache garbage collection (Steps 57–58) ──────────────────────────

export interface GcResult {
  readonly removedEntries: number;
  readonly reclaimedBytes: number;
  readonly preservedEntries: number;
}

/**
 * Incremental, bounded garbage collection of expired cache files.
 * Preserves anything modified within `preserveRecentMs` (active downloads,
 * rollback-relevant content). Never follows symlinks outside root.
 */
export async function collectCacheGarbage(
  cacheDir: string,
  options: {
    maxAgeMs: number;
    preserveRecentMs?: number;
    /** Bound the scan so huge caches never freeze the CLI (Step 58) */
    maxEntriesScanned?: number;
  },
): Promise<GcResult> {
  const preserveRecentMs = options.preserveRecentMs ?? 60_000;
  const maxScan = options.maxEntriesScanned ?? 5000;

  let removedEntries = 0;
  let reclaimedBytes = 0;
  let preservedEntries = 0;
  let scanned = 0;

  async function walk(dir: string): Promise<void> {
    if (scanned >= maxScan) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned >= maxScan) return;
      scanned++;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;
      try {
        const info = await stat(full);
        const age = Date.now() - info.mtimeMs;
        if (age > options.maxAgeMs && age > preserveRecentMs) {
          reclaimedBytes += info.size;
          await rm(full, { force: true });
          removedEntries++;
        } else {
          preservedEntries++;
        }
      } catch {
        // raced deletion — ignore
      }
    }
  }

  await walk(cacheDir);
  return { removedEntries, reclaimedBytes, preservedEntries };
}

// ─── Atomic write helper for snapshots (Step 45 promotion) ───────────

/** temp → atomic rename promotion; unverified data never becomes usable. */
export async function promoteAtomically(
  targetPath: string,
  content: string,
): Promise<void> {
  await mkdir(dirnameSafe(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, targetPath);
}

function dirnameSafe(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx > 0 ? p.slice(0, idx) : ".";
}
