import type {
  SearchQuery,
  SearchResult,
  SearchResultItem,
  SearchResultResource,
  ResourceType,
  SortOption,
  SortOrder,
} from "../types/search.js";
import type { RegistryResource } from "../types/registry.js";
import { EventBus } from "../events/index.js";
import { PluginManager } from "../plugins/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { computeLevenshtein, sortBy } from "../utils/index.js";

export class SearchEngine {
  private _resources: ReadonlyArray<RegistryResource> = [];
  private readonly _events: EventBus;
  private readonly _plugins: PluginManager;
  private readonly _logger: Logger;

  constructor(events: EventBus, plugins: PluginManager, logger?: Logger) {
    this._events = events;
    this._plugins = plugins;
    this._logger = logger ?? createLogger({ prefix: "search" });
  }

  setResources(resources: ReadonlyArray<RegistryResource>): void {
    this._resources = resources;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();

    await this._events.emit("beforeSearch", {
      query: query.keyword ?? "",
    });

    const items = this._searchInternal(query);

    const result: SearchResult = {
      items,
      total: items.length,
      query,
      duration: Date.now() - startTime,
    };

    const processed = (await this._plugins.executeSearchHook(
      query,
      result,
    )) as unknown as SearchResult;

    await this._events.emit("afterSearch", {
      query: query.keyword ?? "",
      resultCount: processed.total,
    });

    return processed;
  }

  private _searchInternal(query: SearchQuery): ReadonlyArray<SearchResultItem> {
    let candidates = [...this._resources];

    if (query.keyword !== undefined && query.keyword !== "") {
      candidates = candidates.filter((r) =>
        this._matchesKeyword(r, query.keyword!),
      );
    }

    if (query.tags !== undefined && query.tags.length > 0) {
      candidates = candidates.filter((r) =>
        query.tags!.every((tag) => r.tags.includes(tag)),
      );
    }

    if (query.category !== undefined && query.category !== "") {
      candidates = candidates.filter(
        (r) => r.category.toLowerCase() === query.category!.toLowerCase(),
      );
    }

    if (query.author !== undefined && query.author !== "") {
      candidates = candidates.filter((r) =>
        r.author.name.toLowerCase().includes(query.author!.toLowerCase()),
      );
    }

    if (query.version !== undefined && query.version !== "") {
      candidates = candidates.filter((r) => r.version === query.version);
    }

    if (query.type !== undefined && query.type !== "all") {
      candidates = candidates.filter((r) => this._matchesType(r, query.type!));
    }

    if (query.framework !== undefined && query.framework !== "") {
      candidates = candidates.filter((r) => {
        const frameworks = r.compatibility?.frameworks;
        if (frameworks === undefined || frameworks.length === 0) return true;
        return frameworks.some(
          (f) => f.toLowerCase() === query.framework!.toLowerCase(),
        );
      });
    }

    const items: Array<SearchResultItem> = candidates.map((resource) => ({
      resource: this._toSearchResult(resource),
      score: this._computeScore(resource, query),
      matchedFields: this._getMatchedFields(resource, query),
    }));

    const sorted = this._sortItems(items, query.sort, query.order);

    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    return sorted.slice(offset, offset + limit);
  }

  private _matchesKeyword(
    resource: RegistryResource,
    keyword: string,
  ): boolean {
    const lowerKeyword = keyword.toLowerCase();
    return (
      resource.name.toLowerCase().includes(lowerKeyword) ||
      resource.displayName.toLowerCase().includes(lowerKeyword) ||
      resource.description.toLowerCase().includes(lowerKeyword) ||
      resource.tags.some((t) => t.toLowerCase().includes(lowerKeyword)) ||
      resource.keywords.some((k) => k.toLowerCase().includes(lowerKeyword))
    );
  }

  private _matchesType(
    resource: RegistryResource,
    type: ResourceType,
  ): boolean {
    const tags = resource.tags.map((t) => t.toLowerCase());
    const name = resource.name.toLowerCase();

    switch (type) {
      case "plugin":
        return tags.includes("plugin") || name.includes("plugin");
      case "theme":
        return tags.includes("theme") || name.includes("theme");
      case "module":
        return tags.includes("module") || name.includes("module");
      case "template":
        return tags.includes("template") || name.includes("template");
      case "tool":
        return tags.includes("tool") || name.includes("tool");
      case "all":
        return true;
    }
  }

  private _computeScore(
    resource: RegistryResource,
    query: SearchQuery,
  ): number {
    let score = 0;

    if (query.keyword !== undefined && query.keyword !== "") {
      const lowerKeyword = query.keyword.toLowerCase();

      if (resource.name.toLowerCase() === lowerKeyword) {
        score += 100;
      } else if (resource.name.toLowerCase().includes(lowerKeyword)) {
        score += 50;
      }

      if (resource.displayName.toLowerCase().includes(lowerKeyword)) {
        score += 40;
      }

      if (resource.description.toLowerCase().includes(lowerKeyword)) {
        score += 20;
      }

      const tagMatch = resource.tags.some(
        (t) => t.toLowerCase() === lowerKeyword,
      );
      if (tagMatch) score += 30;

      const keywordMatch = resource.keywords.some(
        (k) => k.toLowerCase() === lowerKeyword,
      );
      if (keywordMatch) score += 25;

      const distance = computeLevenshtein(
        resource.name.toLowerCase(),
        lowerKeyword,
      );
      if (distance <= 3) {
        score += 10 - distance;
      }
    }

    if (resource.downloads !== undefined) {
      score += Math.min(Math.log10(resource.downloads + 1) * 5, 20);
    }

    if (resource.tags.length > 0) {
      score += Math.min(resource.tags.length, 5);
    }

    return score;
  }

  private _getMatchedFields(
    resource: RegistryResource,
    query: SearchQuery,
  ): ReadonlyArray<string> {
    const fields: Array<string> = [];

    if (query.keyword !== undefined && query.keyword !== "") {
      const lower = query.keyword.toLowerCase();
      if (resource.name.toLowerCase().includes(lower)) fields.push("name");
      if (resource.displayName.toLowerCase().includes(lower))
        fields.push("displayName");
      if (resource.description.toLowerCase().includes(lower))
        fields.push("description");
      if (resource.tags.some((t) => t.toLowerCase().includes(lower)))
        fields.push("tags");
      if (resource.keywords.some((k) => k.toLowerCase().includes(lower)))
        fields.push("keywords");
    }

    if (query.category !== undefined) fields.push("category");
    if (query.author !== undefined) fields.push("author");
    if (query.version !== undefined) fields.push("version");

    return fields;
  }

  private _sortItems(
    items: ReadonlyArray<SearchResultItem>,
    sort?: SortOption,
    order?: SortOrder,
  ): Array<SearchResultItem> {
    const sortKey = sort ?? "relevance";
    const sortOrder = order ?? "desc";

    switch (sortKey) {
      case "name":
        return sortBy(items, (i) => i.resource.name, sortOrder);
      case "version":
        return sortBy(items, (i) => i.resource.version, sortOrder);
      case "downloads":
        return sortBy(
          items,
          (i) => {
            const r = this._resources.find((res) => res.id === i.resource.id);
            return r?.downloads ?? 0;
          },
          sortOrder,
        );
      case "updatedAt":
        return sortBy(
          items,
          (i) => {
            const r = this._resources.find((res) => res.id === i.resource.id);
            return r?.updatedAt ?? "";
          },
          sortOrder,
        );
      case "relevance":
      default:
        return sortBy(items, (i) => i.score, sortOrder);
    }
  }

  private _toSearchResult(resource: RegistryResource): SearchResultResource {
    return {
      id: resource.id,
      name: resource.name,
      displayName: resource.displayName,
      description: resource.description,
      version: resource.version,
      category: resource.category,
      tags: resource.tags,
      author: resource.author.name,
      license: resource.license,
    };
  }
}
