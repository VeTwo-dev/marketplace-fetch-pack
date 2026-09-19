export type DiagnosticSeverity = "info" | "warning" | "error" | "fatal";

export type ErrorCategory =
  | "configuration"
  | "network"
  | "authentication"
  | "authorization"
  | "registry"
  | "manifest"
  | "cache"
  | "download"
  | "integrity"
  | "dependency"
  | "installation"
  | "filesystem"
  | "transaction"
  | "plugin"
  | "resource-type"
  | "state"
  | "lockfile"
  | "internal";

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly subsystem: string;
  readonly timestamp: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly suggestion?: string;
  readonly cause?: string;
}

export interface DiagnosticCollectorOptions {
  readonly maxDiagnostics?: number;
}

/**
 * Bounded, machine-readable diagnostic collector.
 * Never throws — diagnostics must not break core operations.
 */
export class DiagnosticCollector {
  private readonly _diagnostics: Array<Diagnostic> = [];
  private readonly _max: number;
  private readonly _listeners = new Set<(d: Diagnostic) => void>();

  constructor(options?: DiagnosticCollectorOptions) {
    this._max = options?.maxDiagnostics ?? 500;
  }

  record(
    severity: DiagnosticSeverity,
    subsystem: string,
    code: string,
    message: string,
    context?: Readonly<Record<string, unknown>>,
    suggestion?: string,
    cause?: Error,
  ): Diagnostic {
    const diagnostic: Diagnostic = {
      code,
      severity,
      message,
      subsystem,
      timestamp: new Date().toISOString(),
      ...(context !== undefined ? { context } : {}),
      ...(suggestion !== undefined ? { suggestion } : {}),
      ...(cause !== undefined ? { cause: cause.message } : {}),
    };

    this._diagnostics.push(diagnostic);
    if (this._diagnostics.length > this._max) {
      this._diagnostics.splice(0, this._diagnostics.length - this._max);
    }

    for (const listener of this._listeners) {
      try {
        listener(diagnostic);
      } catch {
        // listeners must never break collection
      }
    }

    return diagnostic;
  }

  info(subsystem: string, code: string, message: string): Diagnostic {
    return this.record("info", subsystem, code, message);
  }

  warn(
    subsystem: string,
    code: string,
    message: string,
    suggestion?: string,
  ): Diagnostic {
    return this.record(
      "warning",
      subsystem,
      code,
      message,
      undefined,
      suggestion,
    );
  }

  error(
    subsystem: string,
    code: string,
    message: string,
    context?: Readonly<Record<string, unknown>>,
    cause?: Error,
  ): Diagnostic {
    return this.record(
      "error",
      subsystem,
      code,
      message,
      context,
      undefined,
      cause,
    );
  }

  onRecord(listener: (d: Diagnostic) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  getAll(): ReadonlyArray<Diagnostic> {
    return [...this._diagnostics];
  }

  getBySeverity(severity: DiagnosticSeverity): ReadonlyArray<Diagnostic> {
    return this._diagnostics.filter((d) => d.severity === severity);
  }

  getBySubsystem(subsystem: string): ReadonlyArray<Diagnostic> {
    return this._diagnostics.filter((d) => d.subsystem === subsystem);
  }

  count(): number {
    return this._diagnostics.length;
  }

  clear(): void {
    this._diagnostics.length = 0;
  }
}

export interface TimelineSpan {
  readonly name: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TimelineSummaryEntry {
  readonly name: string;
  readonly calls: number;
  readonly totalMs: number;
  readonly avgMs: number;
  readonly maxMs: number;
}

/**
 * Lightweight performance timeline for major stages only.
 * Bounded history; low overhead.
 */
export class PerformanceTimeline {
  private static readonly MAX_SPANS = 2000;
  private readonly _spans: Array<TimelineSpan> = [];

  start(name: string, metadata?: Record<string, unknown>): () => TimelineSpan {
    const span: TimelineSpan = {
      name,
      startedAt: performance.now(),
      ...(metadata !== undefined ? { metadata } : {}),
    };
    let finished: TimelineSpan = span;

    return () => {
      if (finished.endedAt === undefined) {
        const endedAt = performance.now();
        finished = {
          ...span,
          endedAt,
          durationMs: endedAt - span.startedAt,
        };
        this._spans.push(finished);
        if (this._spans.length > PerformanceTimeline.MAX_SPANS) {
          this._spans.shift();
        }
      }
      return finished;
    };
  }

  async measure<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const end = this.start(name, metadata);
    try {
      return await fn();
    } finally {
      end();
    }
  }

  getSpans(): ReadonlyArray<TimelineSpan> {
    return [...this._spans];
  }

  summary(): ReadonlyArray<TimelineSummaryEntry> {
    const byName = new Map<
      string,
      { calls: number; total: number; max: number }
    >();
    for (const span of this._spans) {
      if (span.durationMs === undefined) continue;
      const entry = byName.get(span.name) ?? { calls: 0, total: 0, max: 0 };
      entry.calls += 1;
      entry.total += span.durationMs;
      entry.max = Math.max(entry.max, span.durationMs);
      byName.set(span.name, entry);
    }
    return Array.from(byName.entries())
      .map(([name, e]) => ({
        name,
        calls: e.calls,
        totalMs: e.total,
        avgMs: e.total / e.calls,
        maxMs: e.max,
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }

  clear(): void {
    this._spans.length = 0;
  }
}
