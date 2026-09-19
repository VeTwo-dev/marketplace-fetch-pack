import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import {
  registerProvider,
  type Provider,
  type RepoIdentifier,
  type FetchOptions,
} from "@vetwo/repo-fetch";
import { RepoFetchClient } from "../../src/registry/repo-fetch-client.js";
import { MarketplaceClientError } from "../../src/errors/index.js";

function makeServer(
  handler: (req: { url: string; headers: Record<string, string> }) => {
    status: number;
    headers?: Record<string, string>;
    body: string;
  },
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const reqHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") reqHeaders[k] = v;
      }
      req.on("data", () => {});
      req.on("end", () => {
        const result = handler({ url: req.url ?? "/", headers: reqHeaders });
        for (const [k, v] of Object.entries(result.headers ?? {})) {
          res.setHeader(k, v);
        }
        res.writeHead(result.status);
        res.end(result.body);
      });
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

const seenAuth: Array<string | undefined> = [];
let base = "";

const fakeProvider: Provider = {
  name: "github",
  config: {
    baseUrl: "http://localhost",
    apiBaseUrl: "http://localhost",
    rawBaseUrl: "http://localhost",
    needsToken: false,
    defaultBranch: "main",
  },
  async getTree(repo: RepoIdentifier, options?: FetchOptions) {
    seenAuth.push(options?.token);
    const res = await fetch(`${base}/tree`, {
      headers:
        options?.token !== undefined
          ? { Authorization: `Bearer ${options.token}` }
          : {},
      signal: options?.signal,
    });
    const body = (await res.json()) as Array<{
      path: string;
      type: "blob" | "tree";
      sha: string;
      size: number;
    }>;
    void repo;
    return body.map((t) => ({ ...t, url: `${base}/tree` }));
  },
  async getFile(repo: RepoIdentifier, path: string, options?: FetchOptions) {
    seenAuth.push(options?.token);
    const res = await fetch(`${base}/files/${path}`, {
      headers:
        options?.token !== undefined
          ? { Authorization: `Bearer ${options.token}` }
          : {},
      signal: options?.signal,
    });
    void repo;
    if (res.status === 404) return null;
    if (res.status !== 200) {
      throw new Error(`local fixture returned ${res.status}`);
    }
    const text = await res.text();
    return Readable.from([Buffer.from(text)]);
  },
  getDownloadUrl(_repo: RepoIdentifier, path: string) {
    return `${base}/files/${path}`;
  },
  async resolveRepository(input: string): Promise<RepoIdentifier> {
    return {
      provider: "github",
      owner: "o",
      repo: "r",
      branch: "main",
      path: input,
    };
  },
  async getDefaultBranch(): Promise<string> {
    return "main";
  },
  async search(): Promise<[]> {
    return [];
  },
  async testConnection(): Promise<boolean> {
    return true;
  },
};

describe("RepoFetchClient (primary fetch)", () => {
  let server: Server;

  beforeAll(async () => {
    // Isolated worker: overriding "github" only affects this file.
    registerProvider("github", fakeProvider);
    const { server: s, port } = await makeServer((req) => {
      if (req.url === "/tree") {
        return {
          status: 200,
          body: JSON.stringify([
            { path: "registry.json", type: "blob", sha: "a", size: 10 },
            { path: "x/resource.json", type: "blob", sha: "b", size: 20 },
          ]),
        };
      }
      const m = /^\/files\/(.+)$/.exec(req.url);
      if (m?.[1] === "registry.json") {
        return { status: 200, body: '{"version":"1.0.0"}' };
      }
      if (m?.[1] === "x/resource.json") {
        return { status: 200, body: '{"name":"x"}' };
      }
      if (m?.[1] === "boom.txt") {
        return { status: 500, body: "server exploded" };
      }
      return { status: 404, body: "nope" };
    });
    server = s;
    base = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function client(options?: {
    token?: string;
    offline?: boolean;
  }): RepoFetchClient {
    return new RepoFetchClient({
      repository: "https://github.com/o/r",
      branch: "main",
      timeout: 5000,
      token: options?.token,
      offline: options?.offline,
    });
  }

  it("readText returns file content via repo-fetch", async () => {
    const text = await client().readText("registry.json");
    expect(JSON.parse(text)).toEqual({ version: "1.0.0" });
  });

  it("readText forwards the configured token", async () => {
    seenAuth.length = 0;
    await client({ token: "tok-123" }).readText("registry.json");
    expect(seenAuth).toContain("tok-123");
  });

  it("readText maps 404 to REGISTRY_NOT_FOUND", async () => {
    await expect(client().readText("missing.json")).rejects.toThrow(
      expect.objectContaining({ code: "REGISTRY_NOT_FOUND" }),
    );
  });

  it("getTree returns mapped entries", async () => {
    const tree = await client().getTree();
    expect(tree.map((t) => t.path)).toEqual([
      "registry.json",
      "x/resource.json",
    ]);
  });

  it("downloadTo writes atomically and verifies content", async () => {
    const { mkdtemp, readFile, access } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "rfc-"));
    const dest = join(dir, "sub", "registry.json");
    const out = await client().downloadTo("registry.json", dest);
    expect(out.size).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(dest, "utf-8"))).toEqual({
      version: "1.0.0",
    });
    await expect(access(`${dest}.part`)).rejects.toThrow();
  });

  it("downloadTo rejects checksum mismatch with cause", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "rfc-"));
    await expect(
      client().downloadTo("registry.json", join(dir, "f.json"), {
        expectedChecksum: "deadbeef",
      }),
    ).rejects.toThrow(
      expect.objectContaining({ code: "INTEGRITY_CHECK_FAILED" }),
    );
  });

  it("downloadTo failure carries the underlying cause (no silent failure)", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "rfc-"));
    const error = await client()
      .downloadTo("boom.txt", join(dir, "boom.txt"), { retries: 0 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MarketplaceClientError);
    expect((error as MarketplaceClientError).code).toBe("DOWNLOAD_FAILED");
    // The cause/message must explain WHY — never a bare failure.
    expect((error as Error).message).not.toBe("Download failed");
    expect((error as Error).message.length).toBeGreaterThan(
      "Download failed".length,
    );
  });

  it("downloadMany preserves per-file errors", async () => {
    const results = await client().downloadMany(
      ["registry.json", "missing.json"],
      { retries: 0 },
    );
    expect(results).toHaveLength(2);
    const ok = results.find((r) => r.path === "registry.json");
    const bad = results.find((r) => r.path === "missing.json");
    expect(ok !== undefined && "data" in ok).toBe(true);
    expect(bad !== undefined && "error" in bad).toBe(true);
    expect(
      (bad as unknown as { error: Error }).error.message.length,
    ).toBeGreaterThan(0);
  });

  it("offline mode refuses network with a clear error", async () => {
    await expect(
      client({ offline: true }).readText("registry.json"),
    ).rejects.toThrow(
      expect.objectContaining({ code: "INTERNET_UNAVAILABLE" }),
    );
  });

  it("invalid repository URL fails fast with a clear error", () => {
    expect(
      () => new RepoFetchClient({ repository: "not-a-repo", branch: "main" }),
    ).toThrow(/Cannot parse repository URL/);
  });
});
