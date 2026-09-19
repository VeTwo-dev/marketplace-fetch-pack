import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLogger, silentLogger } from "../../src/logger/index.js";

describe("createLogger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("creates a logger with default options", () => {
    const logger = createLogger();
    expect(logger).toHaveProperty("debug");
    expect(logger).toHaveProperty("info");
    expect(logger).toHaveProperty("warn");
    expect(logger).toHaveProperty("error");
    expect(logger).toHaveProperty("child");
  });

  it("info writes to stderr by default", () => {
    const logger = createLogger({ level: "info", color: false });
    logger.info("hello");
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain("hello");
    expect(output).toContain("INFO");
  });

  it("respects log level filtering", () => {
    const logger = createLogger({ level: "warn", color: false });
    logger.debug("debug msg");
    logger.info("info msg");
    expect(stderrSpy).not.toHaveBeenCalled();

    logger.warn("warn msg");
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect((stderrSpy.mock.calls[0]![0] as string)).toContain("warn msg");
  });

  it("writes error level messages", () => {
    const logger = createLogger({ level: "error", color: false });
    logger.error("error msg");
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect((stderrSpy.mock.calls[0]![0] as string)).toContain("error msg");
  });

  it("includes data when provided", () => {
    const logger = createLogger({ level: "debug", color: false });
    logger.info("with data", { key: "value" });
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain("with data");
    expect(output).toContain('"key":"value"');
  });

  it("omits data when not provided", () => {
    const logger = createLogger({ level: "debug", color: false });
    logger.info("no data");
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain("no data");
    expect(output).not.toContain("{");
  });

  it("writes to stdout when stream is stdout", () => {
    const logger = createLogger({ level: "info", stream: "stdout", color: false });
    logger.info("stdout msg");
    expect(stdoutSpy).toHaveBeenCalledOnce();
    expect(stderrSpy).not.toHaveBeenCalled();
    expect((stdoutSpy.mock.calls[0]![0] as string)).toContain("stdout msg");
  });

  describe("child logger", () => {
    it("creates a child logger with prefix", () => {
      const logger = createLogger({ level: "info", prefix: "parent", color: false });
      const child = logger.child("child");
      child.info("child msg");
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toContain("[parent:child]");
      expect(output).toContain("child msg");
    });

    it("child without parent prefix", () => {
      const logger = createLogger({ level: "info", color: false });
      const child = logger.child("child");
      child.info("msg");
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toContain("[child]");
    });
  });

  describe("silentLogger", () => {
    it("produces no output for any level", () => {
      const logger = silentLogger();
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
    });
  });

  it("includes timestamp in output", () => {
    const logger = createLogger({ level: "info", color: false });
    logger.info("timestamped");
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
