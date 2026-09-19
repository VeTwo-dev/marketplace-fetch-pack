import type {
  RegistryProvider,
  ProviderCapabilities,
} from "../types/providers.js";

export interface EnhancedProviderCapabilities extends ProviderCapabilities {
  readonly supportsConditionalRequests: boolean;
  readonly supportsRevision: boolean;
  readonly supportsBulkFetch: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsAuthentication: boolean;
  readonly supportsTreeListing: boolean;
  readonly supportsPagination: boolean;
  readonly rateLimitAware: boolean;
  readonly maxConcurrentRequests: number;
}

const GITHUB_CAPABILITIES: EnhancedProviderCapabilities = {
  supportsTree: true,
  supportsRawUrl: true,
  supportsSearch: false,
  maxPageSize: 100,
  rateLimitAware: true,
  supportsConditionalRequests: true,
  supportsRevision: true,
  supportsBulkFetch: true,
  supportsStreaming: false,
  supportsAuthentication: true,
  supportsTreeListing: true,
  supportsPagination: true,
  maxConcurrentRequests: 10,
};

const HTTP_CAPABILITIES: EnhancedProviderCapabilities = {
  supportsTree: true,
  supportsRawUrl: true,
  supportsSearch: false,
  maxPageSize: 100,
  rateLimitAware: false,
  supportsConditionalRequests: false,
  supportsRevision: false,
  supportsBulkFetch: false,
  supportsStreaming: false,
  supportsAuthentication: false,
  supportsTreeListing: false,
  supportsPagination: false,
  maxConcurrentRequests: 5,
};

const LOCAL_CAPABILITIES: EnhancedProviderCapabilities = {
  supportsTree: true,
  supportsRawUrl: false,
  supportsSearch: true,
  maxPageSize: Infinity,
  rateLimitAware: false,
  supportsConditionalRequests: false,
  supportsRevision: false,
  supportsBulkFetch: true,
  supportsStreaming: false,
  supportsAuthentication: false,
  supportsTreeListing: true,
  supportsPagination: false,
  maxConcurrentRequests: 50,
};

export function detectCapabilities(
  provider: RegistryProvider,
): EnhancedProviderCapabilities {
  switch (provider.type) {
    case "github":
      return GITHUB_CAPABILITIES;
    case "http":
      return HTTP_CAPABILITIES;
    case "local":
      return LOCAL_CAPABILITIES;
    default:
      return {
        supportsTree: false,
        supportsRawUrl: false,
        supportsSearch: false,
        maxPageSize: 50,
        rateLimitAware: false,
        supportsConditionalRequests: false,
        supportsRevision: false,
        supportsBulkFetch: false,
        supportsStreaming: false,
        supportsAuthentication: false,
        supportsTreeListing: false,
        supportsPagination: false,
        maxConcurrentRequests: 5,
      };
  }
}

export function createConditionalHeaders(revision?: {
  etag?: string;
  lastModified?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (revision?.etag !== undefined) {
    headers["If-None-Match"] = revision.etag;
  }
  if (revision?.lastModified !== undefined) {
    headers["If-Modified-Since"] = revision.lastModified;
  }
  return headers;
}
