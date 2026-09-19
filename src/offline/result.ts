export type ResultSource =
  "network" | "cache" | "stale-cache" | "local-state" | "fallback" | "unknown";

export interface ClassifiedResult<T> {
  readonly data: T;
  readonly source: ResultSource;
  readonly stale: boolean;
  readonly fromCache: boolean;
  readonly timestamp?: string;
}

export function classify<T>(
  data: T,
  source: ResultSource,
  opts?: { stale?: boolean; timestamp?: string },
): ClassifiedResult<T> {
  return {
    data,
    source,
    stale: opts?.stale ?? source === "stale-cache",
    fromCache:
      source === "cache" ||
      source === "stale-cache" ||
      source === "local-state",
    timestamp: opts?.timestamp,
  };
}

function isStale(source: ResultSource): boolean {
  return source === "stale-cache";
}
