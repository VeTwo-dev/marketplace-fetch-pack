import { describe, it, expect, vi } from "vitest";
import { createMarketplaceHook } from "../../src/cli/tui/hooks/useMarketplace.js";

function createMockMarketplace() {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue({ items: [] }),
    install: vi.fn().mockResolvedValue({ success: true, id: "test", version: "1.0.0", filesInstalled: 5 }),
    preview: vi.fn().mockResolvedValue({ wouldInstall: ["file1"], estimatedSize: 1024 }),
    categories: vi.fn().mockResolvedValue([{ id: "plugins", name: "Plugins", description: "", resourceCount: 10 }]),
    resources: vi.fn().mockResolvedValue([{ id: "res-1", name: "res-1" }]),
    detectProject: vi.fn().mockResolvedValue({ rootPath: "/test", frameworks: [] }),
    update: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("createMarketplaceHook", () => {
  it("creates a hook with all methods", () => {
    const marketplace = createMockMarketplace();
    const hook = createMarketplaceHook(marketplace);
    expect(typeof hook.load).toBe("function");
    expect(typeof hook.search).toBe("function");
    expect(typeof hook.install).toBe("function");
    expect(typeof hook.preview).toBe("function");
    expect(typeof hook.getCategories).toBe("function");
    expect(typeof hook.getResources).toBe("function");
    expect(typeof hook.detectProject).toBe("function");
  });

  it("load calls marketplace.load", async () => {
    const marketplace = createMockMarketplace();
    const hook = createMarketplaceHook(marketplace);
    await hook.load();
    expect(marketplace.load).toHaveBeenCalled();
  });

  it("getCategories calls marketplace.categories", async () => {
    const marketplace = createMockMarketplace();
    const hook = createMarketplaceHook(marketplace);
    const result = await hook.getCategories();
    expect(marketplace.categories).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it("getResources calls marketplace.resources", async () => {
    const marketplace = createMockMarketplace();
    const hook = createMarketplaceHook(marketplace);
    const result = await hook.getResources();
    expect(marketplace.resources).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it("detectProject calls marketplace.detectProject", async () => {
    const marketplace = createMockMarketplace();
    const hook = createMarketplaceHook(marketplace);
    const result = await hook.detectProject();
    expect(marketplace.detectProject).toHaveBeenCalled();
    expect(result?.rootPath).toBe("/test");
  });

  it("detectProject returns null on error", async () => {
    const marketplace = createMockMarketplace();
    marketplace.detectProject.mockRejectedValue(new Error("fail"));
    const hook = createMarketplaceHook(marketplace);
    const result = await hook.detectProject();
    expect(result).toBeNull();
  });

  it("install calls marketplace.install", async () => {
    const marketplace = createMockMarketplace();
    const hook = createMarketplaceHook(marketplace);
    const result = await hook.install("res-1");
    expect(marketplace.install).toHaveBeenCalledWith({ id: "res-1" });
    expect(result.success).toBe(true);
  });

  it("install returns error on failure", async () => {
    const marketplace = createMockMarketplace();
    marketplace.install.mockRejectedValue(new Error("install failed"));
    const hook = createMarketplaceHook(marketplace);
    const result = await hook.install("res-1");
    expect(result.success).toBe(false);
    expect(result.message).toContain("install failed");
  });

  it("preview calls marketplace.preview", async () => {
    const marketplace = createMockMarketplace();
    const hook = createMarketplaceHook(marketplace);
    const result = await hook.preview("res-1");
    expect(marketplace.preview).toHaveBeenCalledWith("res-1");
    expect(result.files).toBe(1);
    expect(result.size).toBe(1024);
  });

  it("search calls marketplace.search and maps results", async () => {
    const marketplace = createMockMarketplace();
    marketplace.search.mockResolvedValue({
      items: [{
        resource: {
          id: "res-1", name: "res-1", displayName: "Res 1", description: "Desc",
          version: "1.0.0", category: "plugins", tags: [], author: "Author", license: "MIT",
        },
      }],
    });
    const hook = createMarketplaceHook(marketplace);
    const result = await hook.search("res");
    expect(marketplace.search).toHaveBeenCalledWith({ keyword: "res" });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("res-1");
  });
});
