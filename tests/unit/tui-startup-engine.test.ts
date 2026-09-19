import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TimeoutController,
  TimeoutError,
  withTimeout,
} from "../../src/cli/tui/core/TimeoutController.js";
import {
  runStartup,
  getStageLabel,
} from "../../src/cli/tui/core/StartupEngine.js";

describe("TimeoutController", () => {
  it("resolves when operation completes before timeout", async () => {
    const controller = new TimeoutController(1000);
    const result = await new Promise<string>((resolve) => {
      setTimeout(() => resolve("done"), 10);
      controller.signal.addEventListener("abort", () => resolve("aborted"));
    });
    expect(result).toBe("done");
    controller.cancel();
  });

  it("aborts when timeout fires", async () => {
    const controller = new TimeoutController(50);
    const result = await new Promise<string>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve("aborted"));
    });
    expect(result).toBe("aborted");
    controller.cancel();
  });

  it("reports elapsed time after timeout", async () => {
    const controller = new TimeoutController(50);
    await new Promise((r) => setTimeout(r, 100));
    // Node timers may fire marginally before the nominal delay on the
    // monotonic clock (~0.3ms observed); allow small scheduler jitter.
    expect(controller.elapsed).toBeGreaterThanOrEqual(45);
    expect(controller.elapsed).toBeLessThan(100);
    controller.cancel();
  });

  it("cancel prevents abort", async () => {
    const controller = new TimeoutController(50);
    controller.cancel();
    let aborted = false;
    controller.signal.addEventListener("abort", () => {
      aborted = true;
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(aborted).toBe(false);
  });

  it("abort immediately triggers signal", () => {
    const controller = new TimeoutController(1000);
    let aborted = false;
    controller.signal.addEventListener("abort", () => {
      aborted = true;
    });
    controller.abort();
    expect(aborted).toBe(true);
  });

  it("can be cancelled before timeout fires", async () => {
    const controller = new TimeoutController(500);
    controller.cancel();
    let aborted = false;
    controller.signal.addEventListener("abort", () => {
      aborted = true;
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(aborted).toBe(false);
  });
});

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 100, "test");
    expect(result).toBe("ok");
  });

  it("rejects when promise completes after timeout", async () => {
    await expect(
      withTimeout(new Promise((r) => setTimeout(r, 500)), 50, "slow"),
    ).rejects.toThrow(TimeoutError);
  });

  it("rejects with stage name in error", async () => {
    try {
      await withTimeout(new Promise((r) => setTimeout(r, 500)), 50, "myStage");
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).stage).toBe("myStage");
      expect((error as TimeoutError).timeout).toBe(50);
    }
  });

  it("rejects when promise rejects before timeout", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 100, "failing"),
    ).rejects.toThrow("boom");
  });

  it("works with function returning promise", async () => {
    const result = await withTimeout(
      () => Promise.resolve("lazy"),
      100,
      "lazy",
    );
    expect(result).toBe("lazy");
  });
});

describe("runStartup", () => {
  let mockHook!: ReturnType<typeof createMockHook>;
  let mockDispatch!: ReturnType<typeof vi.fn>;
  let mockOnEvent!: ReturnType<typeof vi.fn>;

  function createMockHook() {
    return {
      load: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      install: vi.fn().mockResolvedValue({ success: true, message: "" }),
      preview: vi.fn().mockResolvedValue({ files: 0, size: 0 }),
      getCategories: vi.fn().mockResolvedValue([]),
      getResources: vi.fn().mockResolvedValue([]),
      detectProject: vi.fn().mockResolvedValue(null),
      loadFake: vi.fn(),
    };
  }

  beforeEach(() => {
    mockHook = createMockHook();
    mockDispatch = vi.fn();
    mockOnEvent = vi.fn();
  });

  it("completes successfully with all stages", async () => {
    const result = await runStartup({
      hook: mockHook,
      dispatch: mockDispatch,
      onEvent: mockOnEvent,
    });

    expect(result.success).toBe(true);
    expect(result.stages.length).toBe(7);
    expect(result.stages.filter((s) => s.status === "success").length).toBe(7);
    expect(mockHook.load).toHaveBeenCalledTimes(1);
    expect(mockHook.getCategories).toHaveBeenCalledTimes(1);
    expect(mockHook.detectProject).toHaveBeenCalledTimes(1);
    expect(mockOnEvent).toHaveBeenCalled();
  });

  it("reports durations for each stage", async () => {
    const result = await runStartup({
      hook: mockHook,
      dispatch: mockDispatch,
      onEvent: mockOnEvent,
    });

    for (const stage of result.stages) {
      expect(stage.duration).toBeGreaterThanOrEqual(0);
    }
    expect(result.totalDuration).toBeGreaterThan(0);
  });

  it("fails when github connection timeouts", async () => {
    mockHook.load.mockRejectedValue(
      new TimeoutError("Timed out", "github", 100),
    );

    const result = await runStartup({
      hook: mockHook,
      dispatch: mockDispatch,
      onEvent: mockOnEvent,
    });

    expect(result.success).toBe(false);
    const githubStage = result.stages.find((s) => s.id === "github");
    expect(githubStage?.status).toBe("timeout");
  });

  it("retries github on failure", async () => {
    const load = mockHook.load
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(undefined);

    const result = await runStartup({
      hook: mockHook,
      dispatch: mockDispatch,
      onEvent: mockOnEvent,
    });

    expect(result.success).toBe(true);
    expect(mockHook.load).toHaveBeenCalledTimes(2);
  });

  it("fails after exhausting retries", async () => {
    mockHook.load
      .mockRejectedValueOnce(new Error("Error 1"))
      .mockRejectedValueOnce(new Error("Error 2"))
      .mockRejectedValueOnce(new Error("Error 3"));

    const result = await runStartup({
      hook: mockHook,
      dispatch: mockDispatch,
      onEvent: mockOnEvent,
    });

    expect(result.success).toBe(false);
    expect(mockHook.load).toHaveBeenCalledTimes(3);
    const githubStage = result.stages.find((s) => s.id === "github");
    expect(githubStage?.retries).toBe(2);
    expect(githubStage?.status).toBe("failed");
  });

  it("handles registry failure gracefully", async () => {
    mockHook.getCategories.mockRejectedValue(new Error("Registry error"));

    const result = await runStartup({
      hook: mockHook,
      dispatch: mockDispatch,
      onEvent: mockOnEvent,
    });

    expect(result.success).toBe(false);
    // Registry data retrieval now happens in the github stage
    const githubStage = result.stages.find((s) => s.id === "github");
    expect(githubStage?.status).toBe("failed");
  });

  it("reports stages via onEvent callback", async () => {
    const events: Array<{ stage: string; status: string }> = [];
    const onEvent = (e: { stage: string; status: string }) => {
      events.push({ stage: e.stage, status: e.status });
    };

    await runStartup({
      hook: mockHook,
      dispatch: mockDispatch,
      onEvent,
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.status === "running")).toBe(true);
    expect(events.some((e) => e.status === "success")).toBe(true);
  });

  it("aborts when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runStartup({
      hook: mockHook,
      dispatch: mockDispatch,
      onEvent: mockOnEvent,
      signal: controller.signal,
    });

    expect(result.success).toBe(false);
    expect(result.stages.length).toBe(7);
    expect(result.stages.every((s) => s.status === "skipped")).toBe(true);
  });

  it("handles external abort during startup", async () => {
    const controller = new AbortController();

    mockHook.load.mockImplementationOnce(async () => {
      controller.abort();
    });

    const result = await runStartup({
      hook: mockHook,
      dispatch: mockDispatch,
      onEvent: mockOnEvent,
      signal: controller.signal,
    });

    expect(result.stages.some((s) => s.status === "skipped")).toBe(true);
  });

  it("handles detectProject failure gracefully", async () => {
    mockHook.detectProject.mockRejectedValueOnce(new Error("Detection error"));

    const result = await runStartup({
      hook: mockHook,
      dispatch: mockDispatch,
      onEvent: mockOnEvent,
    });

    expect(result.success).toBe(true);
    expect(mockHook.detectProject).toHaveBeenCalledTimes(1);
  });
});

describe("getStageLabel", () => {
  it("returns label for known stage", () => {
    expect(getStageLabel("github")).toBe("Loading Registry");
    expect(getStageLabel("registry")).toBe("Loading Registry");
  });

  it("returns the id for unknown stage", () => {
    expect(getStageLabel("unknown" as never)).toBe("unknown");
  });
});
