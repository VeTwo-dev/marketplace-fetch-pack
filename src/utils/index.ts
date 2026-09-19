import { createHash } from "node:crypto";
import { access } from "node:fs/promises";

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeVersion(version: string): string {
  return version.replace(/^v/, "");
}

export function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge<T extends Readonly<Record<string, unknown>>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<string>) {
    const sourceValue = source[key as keyof T];
    const targetValue = result[key as keyof T];
    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetValue as Readonly<Record<string, unknown>>,
        sourceValue as Readonly<Record<string, unknown>>,
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }
  return result;
}

export function uniqueBy<T, K extends string | number>(
  items: ReadonlyArray<T>,
  keyFn: (item: T) => K,
): Array<T> {
  const seen = new Set<K>();
  const result: Array<T> = [];
  for (const item of items) {
    const k = keyFn(item);
    if (!seen.has(k)) {
      seen.add(k);
      result.push(item);
    }
  }
  return result;
}

export function groupBy<T, K extends string>(
  items: ReadonlyArray<T>,
  keyFn: (item: T) => K,
): Readonly<Record<K, Array<T>>> {
  const result = {} as Record<K, Array<T>>;
  for (const item of items) {
    const k = keyFn(item);
    const group = result[k];
    if (group !== undefined) {
      group.push(item);
    } else {
      result[k] = [item];
    }
  }
  return result;
}

export function sortBy<T>(
  items: ReadonlyArray<T>,
  keyFn: (item: T) => string | number,
  order: "asc" | "desc" = "asc",
): Array<T> {
  return [...items].sort((a, b) => {
    const aKey = keyFn(a);
    const bKey = keyFn(b);
    const cmp = aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    return order === "asc" ? cmp : -cmp;
  });
}

export function computeLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: Array<Array<number>> = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) {
    dp[i]![0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0]![j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dp[m]![n]!;
}

export function pick<
  T extends Readonly<Record<string, unknown>>,
  K extends keyof T,
>(obj: T, keys: ReadonlyArray<K>): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function omit<
  T extends Readonly<Record<string, unknown>>,
  K extends keyof T,
>(obj: T, keys: ReadonlyArray<K>): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete (result as Record<string, unknown>)[key as string];
  }
  return result as Omit<T, K>;
}

export function invariant(
  condition: boolean,
  message: string,
): asserts condition is true {
  if (!condition) {
    throw new Error(`Invariant violation: ${message}`);
  }
}
