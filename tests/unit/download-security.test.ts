import { describe, it, expect } from "vitest";
import { assertSafeDownloadDestination, assertSafeDownloadUrl } from "../../src/download/security.js";

describe("download/security", () => {
  it("allows safe relative path", () => {
    const p = assertSafeDownloadDestination("/tmp/root", "a/b/c.txt");
    expect(p).toContain("a");
  });
  it("rejects traversal", () => {
    expect(() => assertSafeDownloadDestination("/tmp/root", "../evil.txt")).toThrow();
  });
  it("rejects absolute path", () => {
    expect(() => assertSafeDownloadDestination("/tmp/root", "/etc/passwd")).toThrow();
  });
  it("allows https URL", () => {
    expect(() => assertSafeDownloadUrl("https://example.com/file.bin")).not.toThrow();
  });
  it("rejects http URL per default policy", () => {
    expect(() => assertSafeDownloadUrl("http://example.com/file.bin")).toThrow();
  });
});
