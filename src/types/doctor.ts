import type { DiagnosticSeverity } from "../diagnostics/collector.js";

export type DoctorStatus = "pass" | "warn" | "fail" | "skip";

/** Safe repairs the doctor can perform on explicit request. */
export type DoctorRepairAction =
  | "remove-stale-locks"
  | "clean-temp-files"
  | "rebuild-registry-index"
  | "clean-incomplete-downloads";

export interface DoctorCheck {
  readonly name: string;
  readonly description: string;
  /** Stable machine-readable check identifier */
  readonly code: string;
  readonly status: DoctorStatus;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly suggestion?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  /** Whether this check offers a safe automatic repair */
  readonly repairable?: boolean;
  readonly duration: number;
}

export interface DoctorResult {
  readonly checks: ReadonlyArray<DoctorCheck>;
  readonly passed: number;
  readonly warned: number;
  readonly failed: number;
  readonly skipped: number;
  readonly duration: number;
}

export interface DoctorReport {
  readonly result: DoctorResult;
  readonly healthy: boolean;
  readonly timestamp: string;
}

export interface DoctorRepairResult {
  readonly action: DoctorRepairAction;
  readonly performed: boolean;
  readonly itemsAffected: number;
  readonly message: string;
}
