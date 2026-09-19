import type { LogLevel } from "../types/config.js";

export interface Logger {
  readonly debug: (
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly info: (
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly warn: (
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly error: (
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly child: (prefix: string) => Logger;
}

const LOG_LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const LEVEL_COLORS: Readonly<Record<LogLevel, string>> = {
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  silent: "",
};

const RESET = "\x1b[0m";

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(
  level: LogLevel,
  prefix: string,
  message: string,
  data?: Readonly<Record<string, unknown>>,
): string {
  const timestamp = formatTimestamp();
  const levelStr = level.toUpperCase().padEnd(5);
  const prefixStr = prefix !== "" ? `[${prefix}] ` : "";
  let output = `${timestamp} ${levelStr} ${prefixStr}${message}`;
  if (data !== undefined && Object.keys(data).length > 0) {
    output += ` ${JSON.stringify(data)}`;
  }
  return output;
}

function writeStderr(text: string): void {
  process.stderr.write(`${text}\n`);
}

function writeStdout(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function createLogger(
  options: {
    readonly level?: LogLevel;
    readonly prefix?: string;
    readonly color?: boolean;
    readonly stream?: "stdout" | "stderr";
  } = {},
): Logger {
  const level = options.level ?? "info";
  const prefix = options.prefix ?? "";
  const color = options.color ?? true;
  const stream = options.stream ?? "stderr";
  const write = stream === "stderr" ? writeStderr : writeStdout;

  function shouldLog(targetLevel: LogLevel): boolean {
    return LOG_LEVEL_ORDER[targetLevel] >= LOG_LEVEL_ORDER[level];
  }

  function log(
    targetLevel: LogLevel,
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ): void {
    if (!shouldLog(targetLevel)) return;
    const formatted = formatMessage(targetLevel, prefix, message, data);
    if (color && process.stdout.isTTY) {
      const colorCode = LEVEL_COLORS[targetLevel];
      write(`${colorCode}${formatted}${RESET}`);
    } else {
      write(formatted);
    }
  }

  return {
    debug: (message, data) => log("debug", message, data),
    info: (message, data) => log("info", message, data),
    warn: (message, data) => log("warn", message, data),
    error: (message, data) => log("error", message, data),
    child: (childPrefix) =>
      createLogger({
        level,
        prefix: prefix !== "" ? `${prefix}:${childPrefix}` : childPrefix,
        color,
        stream,
      }),
  };
}

export function silentLogger(): Logger {
  return createLogger({ level: "silent" });
}
