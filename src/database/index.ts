import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createLogger, type Logger } from "../logger/index.js";
import { fileExists } from "../utils/index.js";
import type {
  DatabaseConfig,
  DatabaseEntry,
  DatabaseEntryStatus,
  DatabaseHistoryEntry,
  DatabaseService,
  InstallReport,
} from "../types/database.js";

const DEFAULT_CONFIG: DatabaseConfig = {
  directory: "",
  maxHistoryEntries: 1000,
};

const ENTRIES_FILE = "entries.json";
const HISTORY_FILE = "history.json";
const REPORTS_DIR = "reports";

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

class DatabaseServiceImpl implements DatabaseService {
  private readonly logger: Logger;
  private entriesPath = "";
  private historyPath = "";
  private reportsDir = "";
  private basePath = "";
  private config: DatabaseConfig;

  constructor(config?: Partial<DatabaseConfig>) {
    this.logger = createLogger({ prefix: "database" });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(basePath: string): Promise<void> {
    this.basePath = basePath;
    this.entriesPath = join(basePath, ENTRIES_FILE);
    this.historyPath = join(basePath, HISTORY_FILE);
    this.reportsDir = join(basePath, REPORTS_DIR);

    await mkdir(basePath, { recursive: true });
    await mkdir(this.reportsDir, { recursive: true });

    if (!(await fileExists(this.entriesPath))) {
      await writeJson(this.entriesPath, []);
    }
    if (!(await fileExists(this.historyPath))) {
      await writeJson(this.historyPath, []);
    }

    this.logger.info("Database initialized", { basePath });
  }

  async addEntry(entry: DatabaseEntry): Promise<void> {
    const entries = await readJson<DatabaseEntry[]>(this.entriesPath, []);
    const idx = entries.findIndex((e) => e.resourceId === entry.resourceId);
    if (idx >= 0) {
      entries[idx] = entry;
    } else {
      entries.push(entry);
    }
    await writeJson(this.entriesPath, entries);
  }

  async removeEntry(resourceId: string): Promise<void> {
    const entries = await readJson<DatabaseEntry[]>(this.entriesPath, []);
    const filtered = entries.filter((e) => e.resourceId !== resourceId);
    await writeJson(this.entriesPath, filtered);
  }

  async getEntry(resourceId: string): Promise<DatabaseEntry | null> {
    const entries = await readJson<DatabaseEntry[]>(this.entriesPath, []);
    return entries.find((e) => e.resourceId === resourceId) ?? null;
  }

  async getAllEntries(): Promise<ReadonlyArray<DatabaseEntry>> {
    return readJson<DatabaseEntry[]>(this.entriesPath, []);
  }

  async hasEntry(resourceId: string): Promise<boolean> {
    const entries = await readJson<DatabaseEntry[]>(this.entriesPath, []);
    return entries.some((e) => e.resourceId === resourceId);
  }

  async updateEntryStatus(
    resourceId: string,
    status: DatabaseEntryStatus,
  ): Promise<void> {
    const entries = await readJson<DatabaseEntry[]>(this.entriesPath, []);
    const idx = entries.findIndex((e) => e.resourceId === resourceId);
    if (idx < 0) {
      throw new Error(`Entry not found: ${resourceId}`);
    }
    const existing = entries[idx];
    if (existing === undefined) return;
    const updated: DatabaseEntry = { ...existing, status };
    entries[idx] = updated;
    await writeJson(this.entriesPath, entries);
  }

  async addHistory(entry: DatabaseHistoryEntry): Promise<void> {
    const history = await readJson<DatabaseHistoryEntry[]>(
      this.historyPath,
      [],
    );
    history.push(entry);
    if (history.length > this.config.maxHistoryEntries) {
      history.splice(0, history.length - this.config.maxHistoryEntries);
    }
    await writeJson(this.historyPath, history);
  }

  async getHistory(
    resourceId?: string,
    limit?: number,
  ): Promise<ReadonlyArray<DatabaseHistoryEntry>> {
    let history = await readJson<DatabaseHistoryEntry[]>(this.historyPath, []);
    if (resourceId !== undefined) {
      history = history.filter((h) => h.resourceId === resourceId);
    }
    if (limit !== undefined) {
      history = history.slice(-limit);
    }
    return history;
  }

  async clearHistory(): Promise<void> {
    await writeJson(this.historyPath, []);
  }

  async getReports(resourceId?: string): Promise<ReadonlyArray<InstallReport>> {
    let files: string[];
    try {
      files = await readdir(this.reportsDir);
    } catch {
      return [];
    }

    const reports: InstallReport[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const report = await readJson<InstallReport | null>(
        join(this.reportsDir, file),
        null,
      );
      if (report !== null) {
        if (resourceId === undefined || report.resourceId === resourceId) {
          reports.push(report);
        }
      }
    }
    return reports;
  }
}

export function createDatabaseService(
  basePath: string,
  config?: Partial<DatabaseConfig>,
): DatabaseService {
  const service = new DatabaseServiceImpl(config);
  return {
    initialize: (bp: string) => service.initialize(bp),
    addEntry: (entry: DatabaseEntry) => service.addEntry(entry),
    removeEntry: (resourceId: string) => service.removeEntry(resourceId),
    getEntry: (resourceId: string) => service.getEntry(resourceId),
    getAllEntries: () => service.getAllEntries(),
    hasEntry: (resourceId: string) => service.hasEntry(resourceId),
    updateEntryStatus: (resourceId: string, status: DatabaseEntryStatus) =>
      service.updateEntryStatus(resourceId, status),
    addHistory: (entry: DatabaseHistoryEntry) => service.addHistory(entry),
    getHistory: (resourceId?: string, limit?: number) =>
      service.getHistory(resourceId, limit),
    clearHistory: () => service.clearHistory(),
    getReports: (resourceId?: string) => service.getReports(resourceId),
  };
}
