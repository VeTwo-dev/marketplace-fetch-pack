/**
 * Startup profiler — DIAGNOSTICS ONLY, changes no behavior.
 *
 * Run: node benchmarks/startup-profile.mjs [cold|warm|offline|all]
 *
 * Measures: stage timings, every network request (method/url/auth/timing/
 * status), retries (undici per-attempt hooks), concurrency, duplicates,
 * cache vs network contribution. Never prints secrets.
 */
import dc from "node:diagnostics_channel";

const MODE = process.argv[2] ?? "all";
const now = () => performance.now();
const fmt = (ms) => `${ms.toFixed(0)}ms`;

// ---------------------------------------------------------------------------
// Request ledger (all layers)
// ---------------------------------------------------------------------------
const ledger = [];
let inFlight = 0;
let maxInFlight = 0;

const T0 = now();
function record(entry) {
  entry.t = now() - T0;
  ledger.push(entry);
}

function summarizeLedger() {
  const total = ledger.length;
  const byUrl = new Map();
  for (const e of ledger) {
    const k = `${e.method} ${e.url}`;
    byUrl.set(k, (byUrl.get(k) ?? 0) + 1);
  }
  const dups = [...byUrl.values()].filter((n) => n > 1).length;
  const byStatus = {};
  for (const e of ledger) {
    const s = e.status ?? "error";
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  const totalTime = ledger.reduce((a, e) => a + (e.durationMs ?? 0), 0);
  return {
    total,
    unique: byUrl.size,
    duplicateUrls: dups,
    byStatus,
    totalTime,
    maxInFlight,
  };
}

function dumpLedger(limit = 250) {
  console.log("idx | layer | method | ms | status | auth | url");
  ledger.slice(0, limit).forEach((e, i) => {
    console.log(
      `${i} | t=${(e.t ?? 0).toFixed(0)} | ${e.layer} | ${e.method} | ${(e.durationMs ?? 0).toFixed(0)} | ${e.status} | ${e.authenticated ? "Y" : "-"} | ${e.url}${e.note && e.note !== "attempt" ? ` [${e.note}]` : ""}`,
    );
  });
  if (ledger.length > limit) console.log(`… +${ledger.length - limit} more`);
}

function resetLedger() {
  ledger.length = 0;
  connections.length = 0;
  maxInFlight = 0;
}

// --- Layer 1: global fetch (native transport, revision detector, doctor) ---
const realFetch = globalThis.fetch;
globalThis.fetch = async function tracedFetch(url, init = {}) {
  const u = String(url);
  const start = now();
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  const headers = init.headers ?? {};
  const getHeader = (n) => {
    if (typeof headers.get === "function") return headers.get(n);
    return headers[n] ?? headers[n.toLowerCase()];
  };
  const authenticated =
    getHeader("authorization") !== undefined &&
    getHeader("authorization") !== null;
  try {
    const res = await realFetch(url, init);
    record({
      layer: "fetch",
      method: init.method ?? "GET",
      url: u.length > 120 ? u.slice(0, 120) + "…" : u,
      authenticated,
      durationMs: now() - start,
      status: res.status,
    });
    return res;
  } catch (e) {
    record({
      layer: "fetch",
      method: init.method ?? "GET",
      url: u.length > 120 ? u.slice(0, 120) + "…" : u,
      authenticated,
      durationMs: now() - start,
      status: "fetch-throw",
      note: String(e).slice(0, 80),
    });
    throw e;
  } finally {
    inFlight--;
  }
};

// --- Layer 2: undici per-attempt + connection hooks (repo-fetch internals) ---
const attemptStarts = new Map();
const connections = [];
function hasAuthHeader(headers) {
  if (headers === undefined || headers === null) return false;
  try {
    if (typeof headers.get === "function")
      return headers.get("authorization") !== null;
    if (Array.isArray(headers))
      return headers.some(
        (h) => String(h?.[0] ?? h).toLowerCase() === "authorization",
      );
    if (typeof headers === "object")
      return Object.keys(headers).some(
        (k) => k.toLowerCase() === "authorization",
      );
    if (typeof headers === "string")
      return headers.toLowerCase().includes("authorization");
  } catch {
    return false;
  }
  return false;
}
function fullUrl(origin, path) {
  const u = `${origin ?? ""}${path ?? ""}`;
  return u.length > 140 ? u.slice(0, 140) + "…" : u;
}
try {
  dc.subscribe("undici:request:create", (msg) => {
    attemptStarts.set(msg.request, { start: now() });
  });
  dc.subscribe("undici:request:headers", (msg) => {
    const a = attemptStarts.get(msg.request);
    if (!a) return;
    attemptStarts.delete(msg.request);
    record({
      layer: "undici",
      method: msg.request?.method ?? "?",
      url: fullUrl(msg.request?.origin, msg.request?.path),
      authenticated: hasAuthHeader(msg.request?.headers),
      durationMs: now() - a.start,
      status: msg.response?.statusCode,
      note: "attempt",
    });
  });
  dc.subscribe("undici:request:error", (msg) => {
    const a = attemptStarts.get(msg.request);
    attemptStarts.delete(msg.request);
    record({
      layer: "undici",
      method: msg.request?.method ?? "?",
      url: fullUrl(msg.request?.origin, msg.request?.path),
      authenticated: hasAuthHeader(msg.request?.headers),
      durationMs: a !== undefined ? now() - a.start : 0,
      status: "req-error",
      note: String(msg.error?.message ?? "?").slice(0, 80),
    });
  });
  dc.subscribe("undici:client:beforeConnect", (msg) => {
    const p = msg.connectParams ?? {};
    connections.push({
      when: now(),
      host: `${p.host ?? "?"}${p.port ? `:${p.port}` : ""}`,
    });
  });
} catch (e) {
  console.log("undici channels unavailable:", String(e).slice(0, 60));
}

// --- Layer 3: repo-fetch provider logical calls ---
async function wrapRepoFetch() {
  const rf = await import("@vetwo/repo-fetch");
  const provider = rf.getProvider("github");
  for (const method of ["getTree", "getFile"]) {
    const orig = provider[method].bind(provider);
    provider[method] = async (...args) => {
      const start = now();
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const out = await orig(...args);
        const n = Array.isArray(out)
          ? `${out.length} items`
          : out === null
            ? "null"
            : "stream";
        record({
          layer: `repo-fetch:${method}`,
          method: "N/A",
          url:
            method === "getTree" ? "git/trees?recursive=1" : `file:${args[1]}`,
          authenticated: !!(
            args[2]?.token ??
            process.env.GITHUB_TOKEN ??
            process.env.REPO_FETCH_TOKEN
          ),
          durationMs: now() - start,
          status: `ok(${n})`,
        });
        return out;
      } catch (e) {
        record({
          layer: `repo-fetch:${method}`,
          method: "N/A",
          url:
            method === "getTree" ? "git/trees?recursive=1" : `file:${args[1]}`,
          authenticated: !!(
            args[2]?.token ??
            process.env.GITHUB_TOKEN ??
            process.env.REPO_FETCH_TOKEN
          ),
          durationMs: now() - start,
          status: `throw:${e?.name ?? "?"}`,
          note: String(e?.message ?? e).slice(0, 100),
        });
        throw e;
      } finally {
        inFlight--;
      }
    };
  }
  let downloads = 0;
  rf.globalEmitter?.on?.("afterDownload", () => {
    downloads++;
  });
  return { downloads: () => downloads };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
async function quota() {
  try {
    const r = await realFetch("https://api.github.com/rate_limit");
    const j = await r.json();
    return `${j.resources.core.remaining}/${j.resources.core.limit}`;
  } catch {
    return "unknown";
  }
}

async function scenarioCold(dist) {
  const { Marketplace, createLogger } = await import("../dist/index.js");
  const silent = () => createLogger({ level: "silent" });
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dest = await mkdtemp(join(tmpdir(), "prof-cold-"));

  const t0 = now();
  const mp = new Marketplace({ logger: silent() });
  const tConstructed = now();
  await mp.load({ destination: dest });
  const tLoaded = now();
  const resources = await mp.resources();
  const tRead = now();

  let diag = null;
  try {
    diag = await mp.diagnostics();
  } catch {}
  const tSearch0 = now();
  await mp.search("react");
  const tSearch1 = now();

  console.log("--- COLD START (empty state, real network) ---");
  console.log(`construct:        ${fmt(tConstructed - t0)}`);
  console.log(`load():           ${fmt(tLoaded - tConstructed)}`);
  console.log(
    `resources():      ${fmt(tRead - tLoaded)} (${resources.length} resources)`,
  );
  console.log(`search('react'):  ${fmt(tSearch1 - tSearch0)}`);
  console.log(`TOTAL:            ${fmt(tRead - t0)}`);
  if (diag) console.log("diagnostics:", JSON.stringify(diag).slice(0, 600));
  return { mp, dest };
}

async function scenarioWarm(dest) {
  const { Marketplace, createLogger } = await import("../dist/index.js");
  const silent = () => createLogger({ level: "silent" });
  resetLedger();
  const t0 = now();
  const mp = new Marketplace({ logger: silent() });
  await mp.load({ destination: dest });
  const t1 = now();
  const resources = await mp.resources();
  const t2 = now();
  console.log("--- WARM START (same state dir, real network allowed) ---");
  console.log(`load():           ${fmt(t1 - t0)}`);
  console.log(
    `resources():      ${fmt(t2 - t1)} (${resources.length} resources)`,
  );
  console.log(`TOTAL:            ${fmt(t2 - t0)}`);
}

async function scenarioOffline(dest) {
  const { Marketplace, createLogger } = await import("../dist/index.js");
  const silent = () => createLogger({ level: "silent" });
  ledger.length = 0;
  const t0 = now();
  const mp = new Marketplace({ logger: silent() });
  await mp.load({ destination: dest, offline: true });
  const t1 = now();
  const resources = await mp.resources();
  const t2 = now();
  console.log("--- OFFLINE START (same state dir, network forbidden) ---");
  console.log(`load():           ${fmt(t1 - t0)}`);
  console.log(
    `resources():      ${fmt(t2 - t1)} (${resources.length} resources)`,
  );
  console.log(`TOTAL:            ${fmt(t2 - t0)}`);
}

// ---------------------------------------------------------------------------
console.log(`quota before: ${await quota()}`);
const dl = await wrapRepoFetch();

if (MODE === "all" || MODE === "cold") {
  const { dest } = await scenarioCold();
  console.log(
    "network summary (cold):",
    JSON.stringify(summarizeLedger(), null, 1),
  );
  dumpLedger();
  console.log("connections created:", JSON.stringify(connections));
  if (MODE === "all") {
    await scenarioWarm(dest);
    console.log(
      "network summary (warm):",
      JSON.stringify(summarizeLedger(), null, 1),
    );
    dumpLedger();
    console.log("connections created:", JSON.stringify(connections));
    await scenarioOffline(dest);
    console.log(
      "network summary (offline):",
      JSON.stringify(summarizeLedger(), null, 1),
    );
    dumpLedger();
    console.log("connections created:", JSON.stringify(connections));
  }
} else if (MODE === "warm" || MODE === "offline") {
  console.log(
    "warm/offline modes need a cold state dir first; run default (all).",
  );
}
console.log(`quota after: ${await quota()}`);
console.log(`repo-fetch downloads completed: ${dl.downloads()}`);
