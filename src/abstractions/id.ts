import { sha256 } from "../utils/index.js";
export interface IdGenerator {
  generate(prefix?: string): string;
}
export const defaultIdGenerator: IdGenerator = {
  generate: (p = "id") =>
    `${p}_${Date.now().toString(36)}_${sha256(`${Math.random()}`).slice(0, 6)}`,
};
export class DeterministicIdGenerator implements IdGenerator {
  private _n = 0;
  constructor(private readonly _prefix = "test") {}
  generate(p?: string): string {
    return `${p ?? this._prefix}_${String(this._n++).padStart(4, "0")}`;
  }
  reset(): void {
    this._n = 0;
  }
}
