/**
 * Example extension: custom provider + resource type without touching core.
 * Proves Phase 30 extensibility.
 */
import type { RegistryProvider, TreeEntry } from "../types/providers.js";

export class ExampleMemoryProvider implements RegistryProvider {
  type = "http" as const;
  name = "example-memory";
  private _files = new Map<string, string>([
    ["registry.json", JSON.stringify({ version: "1.0.0", resources: [] })],
  ]);

  async connect(): Promise<void> {}
  async readFile(path: string): Promise<string> {
    const v = this._files.get(path);
    if (v === undefined) throw new Error(`not found: ${path}`);
    return v;
  }
  async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await this.readFile(path)) as T;
  }
  async getTree(): Promise<TreeEntry[]> {
    return Array.from(this._files.keys()).map((p) => ({
      path: p,
      type: "blob" as const,
      sha: "abc123",
    }));
  }
  async getRawUrl(path: string): Promise<string> {
    return `memory://${path}`;
  }
  invalidate(): void {}
  setFile(path: string, content: string): void {
    this._files.set(path, content);
  }
}
