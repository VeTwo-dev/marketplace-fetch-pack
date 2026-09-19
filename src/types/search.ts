export interface SearchQuery {
  readonly keyword?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly category?: string;
  readonly author?: string;
  readonly version?: string;
  readonly type?: ResourceType;
  readonly framework?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly sort?: SortOption;
  readonly order?: SortOrder;
}

export type ResourceType =
  "plugin" | "theme" | "module" | "template" | "tool" | "all";
export type SortOption =
  "relevance" | "name" | "version" | "downloads" | "updatedAt";
export type SortOrder = "asc" | "desc";

export interface SearchResult {
  readonly items: ReadonlyArray<SearchResultItem>;
  readonly total: number;
  readonly query: SearchQuery;
  readonly duration: number;
}

export interface SearchResultItem {
  readonly resource: SearchResultResource;
  readonly score: number;
  readonly matchedFields: ReadonlyArray<string>;
}

export interface SearchResultResource {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly category: string;
  readonly tags: ReadonlyArray<string>;
  readonly author: string;
  readonly license?: string;
}

export interface SearchFilter {
  readonly field: string;
  readonly operator: FilterOperator;
  readonly value: string;
}

export type FilterOperator =
  "eq" | "neq" | "contains" | "startsWith" | "endsWith" | "in" | "gte" | "lte";
