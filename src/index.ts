export { Marketplace, type MarketplaceOptions } from "./marketplace/index.js";
export {
  RegistryClient,
  type RegistryClientOptions,
  type LoadOptions,
} from "./registry/index.js";
export {
  RegistryDiscovery,
  type DiscoveryResult,
  type DiscoveryWarning,
} from "./registry/discovery.js";
export {
  RepoFetchClient,
  type RepoFetchClientOptions,
  type RepoFetchTreeEntry,
  type RepoFetchDownloadedFile,
} from "./registry/repo-fetch-client.js";
export {
  GitHubRepositoryTransport,
  getApiBase,
  getRawBase,
} from "./transport/github-repository.js";
export type {
  RepositoryTransportOptions,
  TreeEntry as RepositoryTreeEntry,
} from "./transport/github-repository.js";
export { getSharedTransport } from "./transport/node-fetch-transport.js";
export {
  RegistryIndexManager,
  createRegistryIndexManager,
} from "./registry/registry-index.js";
export {
  RevisionDetector,
  createRevisionDetector,
} from "./registry/revision-detector.js";
export type {
  RegistryIndex,
  RegistryIndexEntry,
  RegistryIndexAuthor,
  RegistryIndexDependency,
  RegistryIndexCompatibility,
  RegistryIndexCategory,
  RegistryIndexMetadata,
  RevisionInfo,
} from "./registry/index-schema.js";

// Phase 23: Registry Snapshot & Freshness
export {
  type RegistrySnapshot,
  type RegistrySnapshotResource,
  type RegistrySnapshotMetadata,
  buildRegistrySnapshot,
  snapshotToRegistry,
  createSnapshotId,
} from "./registry/registry-snapshot.js";
export {
  type FreshnessPolicy,
  type FreshnessConfig,
  type FreshnessResult,
  type FreshnessState,
  evaluateFreshness,
  shouldUseCache,
  shouldRevalidate,
  shouldBlockOnNetwork,
  getPolicyDefaults,
} from "./registry/freshness-policy.js";

// Phase 23: Provider Capabilities
export {
  type EnhancedProviderCapabilities,
  detectCapabilities,
  createConditionalHeaders,
} from "./registry/provider-capabilities.js";

// Phase 23: Single-Flight & Deduplication
export {
  SingleFlight,
  RequestDeduplicator,
  buildRegistryFetchKey,
  buildManifestFetchKey,
  buildResourceFetchKey,
} from "./registry/single-flight.js";

// Phase 23: Resource Index & Version Index
export {
  ResourceIndexBuilder,
  lookupByVersionIndex,
  getVersionsForRange,
  type ResourceIndex,
  type VersionIndex,
  type VersionEntry,
} from "./registry/resource-index.js";

// Phase 23: Concurrency Limiter
export {
  ConcurrencyLimiter,
  type ConcurrencyLimiterConfig,
} from "./registry/concurrency-limiter.js";

// Phase 23: Registry Diagnostics
export {
  RegistryDiagnosticsCollector,
  type RegistryDiagnostics,
  type RegistryPerformanceMetrics,
  type RegistryIndexStats,
} from "./registry/diagnostics.js";

export { SearchEngine } from "./search/index.js";
export { DependencyResolver } from "./dependencies/index.js";
export { InstallationPlanBuilder } from "./dependencies/plan.js";
export { VersionResolver } from "./versions/index.js";

// Phase 24: Advanced Dependency Graph
export {
  type DependencyGraphV2,
  type DependencyNodeV2,
  type DependencyEdge,
  type DependencyConflictV2,
  type DependencyConstraint,
  type PeerRequirement,
  type OptionalDependencyResult,
  type NormalizedDependencySpec,
  type DependencyType,
  normalizeDependencySpec,
  buildReverseEdges,
  detectCycles,
  detectSelfDependency,
  buildTopologicalOrder,
  pruneIrrelevant,
  getDependents,
  getTransitiveDependents,
} from "./dependencies/graph.js";

// Phase 24: Advanced Dependency Resolver
export {
  AdvancedDependencyResolver,
  type ResolverContext,
  type ResolverResult,
  type ImpactAnalysis,
} from "./dependencies/advanced-resolver.js";

// Phase 24: Resolution Cache
export {
  ResolutionCache,
  type ResolutionCacheEntry,
  type ResolutionCacheConfig,
} from "./dependencies/resolution-cache.js";
export { Downloader } from "./downloader/index.js";
export {
  DownloadEngine,
  DownloadMetricsCollector,
  DownloadProgressEmitter,
  DEFAULT_RETRY_CONFIG,
} from "./download/index.js";
export type {
  DownloadRequest,
  DownloadResult,
  DownloadMetadata,
  DownloadPriority,
  ConcurrentQueueConfig,
  RetryConfig,
} from "./download/types.js";
export type {
  DownloadMetricsEntry,
  DownloadMetricsSummary,
} from "./download/metrics.js";
export type {
  DownloadProgressEvent,
  DownloadProgressData,
} from "./download/progress.js";

// Phase 25: Content Transport
export { NodeFetchTransport } from "./transport/index.js";
export type {
  ContentTransport,
  ContentTransportRequest,
  ContentTransportResponse,
  HeadResult,
  TransportTimeouts,
  TransportErrorKind,
  TransportError,
} from "./transport/index.js";

export { Installer } from "./installer/index.js";
export {
  TransactionManager,
  type TransactionManagerOptions,
} from "./transaction/index.js";
export { ManifestParser } from "./manifest/index.js";
export { ProjectDetector } from "./detection/index.js";
export { Doctor } from "./doctor/index.js";
export { getHealth, type HealthStatus } from "./health/index.js";
export { systemClock, FakeClock, type Clock } from "./abstractions/clock.js";
export {
  defaultIdGenerator,
  DeterministicIdGenerator,
  type IdGenerator,
} from "./abstractions/id.js";
export { ConfigManager } from "./config/index.js";
export {
  validateMarketplaceConfig,
  validateResolvedConfig,
  ensureValidConfig,
  redactSecrets,
  freezeConfig,
  type ConfigValidationResult,
  type ConfigValidationError,
} from "./config/validate.js";
export { Cache } from "./cache/index.js";
export { CacheManager } from "./cache/CacheManager.js";
export { EventBus } from "./events/index.js";
export {
  PluginManager,
  createPlugin,
  createFallbackPluginContext,
} from "./plugins/index.js";
export {
  DiagnosticCollector,
  PerformanceTimeline,
} from "./diagnostics/index.js";
export type {
  Diagnostic,
  DiagnosticSeverity,
  ErrorCategory,
  TimelineSpan,
  TimelineSummaryEntry,
} from "./diagnostics/index.js";
export {
  DEFAULT_SECURITY_POLICY,
  isSafeRelativePath,
  resolveWithinRoot,
  assertNoSymlinkEscape,
  ensureDestinationRoot,
  assertSafeFileType,
  assertFileSize,
  assertResourceSize,
  assertDependencyLimits,
  validateRemoteUrl,
  mayForwardSensitiveHeaders,
  assertScriptExecutionAllowed,
  type SecurityPolicy,
  type ScriptExecutionPolicy,
} from "./security/index.js";
export {
  DEFAULT_TIMEOUTS,
  RetryBudget,
  NetworkTelemetry,
  CategoryConcurrencyLimiter,
  StaleWhileRevalidate,
  buildNamespacedCacheKey,
  type TimeoutModel,
  type RetryBudgetOptions,
  type NetworkTelemetrySnapshot,
  type RequestCategory,
  type SwrState,
  type SwrOptions,
  type CacheKeyContext,
} from "./network/runtime.js";
export {
  classifyEntry,
  categoryTtl,
  buildNamespacedKey,
  parseNamespacedKey,
  withStampedeGuard,
  collectCacheGarbage,
  promoteAtomically,
  CATEGORY_TTL_MS,
  GENERAL_TTL_MS,
  type CacheStateInfo,
  type NamespacedKeyParts,
  type GcResult,
  type StampedeGuardOptions,
} from "./cache/smart.js";
export {
  validateArchiveEntries,
  extractArchiveEntries,
  type ArchiveEntryDescriptor,
  type ArchiveEntryWithContent,
  type ArchiveSafetyResult,
} from "./security/archive.js";
export {
  warnDeprecated,
  resetDeprecationWarnings,
  validateSchemaVersion,
  SUPPORTED_MANIFEST_VERSIONS,
  SUPPORTED_REGISTRY_VERSIONS,
  type Deprecation,
  type SchemaVersionResult,
} from "./compat/index.js";
export { PluginStateStore } from "./plugins/state-store.js";
export {
  PluginDiscovery,
  createPluginDiscovery,
  isPluginShape,
} from "./plugins/discovery.js";
export { HookSystem, createHookSystem } from "./hooks/index.js";
export {
  InstallerRegistry,
  createInstallerRegistry,
} from "./installer-registry/index.js";
export {
  genericFileInstaller,
  genericFileRemover,
  genericFilePreviewer,
} from "./installer-registry/generic.js";
export { MarketplaceClientError, createError } from "./errors/index.js";
export { createLogger, silentLogger, type Logger } from "./logger/index.js";

export { GitHubRegistryProvider } from "./providers/github.js";
export { LocalRegistryProvider } from "./providers/local.js";
export { HttpRegistryProvider } from "./providers/http.js";

export {
  ResourceTypeRegistry,
  createTypeRegistry,
} from "./resource-types/index.js";

export { InstallPipeline, createInstallPipeline } from "./pipeline/core.js";
export {
  createResolveStage,
  createCompatibilityStage,
  createDependencyStage,
  createDownloadStage,
  createIntegrityStage,
  createVariablesStage,
  createTransformStage,
  createMergeStage,
  createWriteStage,
  createPostInstallStage,
  createReportStage,
} from "./pipeline/stages/index.js";

export { createVariableResolver } from "./variables/index.js";

export { createTemplateEngine } from "./template/index.js";

export { createASTTransformer, detectLanguage } from "./ast/index.js";

export { createTransformRegistry } from "./transform/index.js";

export { createMergeRegistry } from "./merge/index.js";

export { createSnapshotManager } from "./snapshot/index.js";

export { createLockFileService } from "./lockfile/index.js";

export { createDatabaseService } from "./database/index.js";

export type {
  Registry,
  RegistryCategory,
  RegistryResource,
  RegistryMetadata,
  RegistryAuthor,
  RegistryDependency,
} from "./types/registry.js";
export type {
  Resource,
  ResourceId,
  ResourceVersion,
  ResourceFile,
  ResourceAuthor,
  ResourceDependency,
  ResourceCompatibility,
} from "./types/resource.js";
export type {
  ResourceManifest,
  ManifestFile,
  ManifestFileName,
  VetwoResourceMetadata,
} from "./types/manifest.js";
export type {
  SearchQuery,
  SearchResult,
  SearchResultItem,
  SearchResultResource,
  SearchFilter,
  ResourceType,
  SortOption,
  SortOrder,
  FilterOperator,
} from "./types/search.js";
export type {
  InstallOptions,
  InstallResult,
  InstallReport,
  InstalledFile,
  DryRunResult,
  DryRunFile,
  DryRunConflict,
  IntegrityReport,
  InstallationTransaction,
  TransactionStatus,
  DryRunInstallResult,
} from "./types/install.js";
export type { CacheEntry, CacheConfig, CacheStats } from "./types/cache.js";
export { CacheInvalidationGraph } from "./cache/invalidation.js";
export type { InvalidationReason } from "./cache/invalidation.js";
export { CacheWarmup } from "./cache/warmup.js";
export type { WarmupOptions, PrefetchOptions } from "./cache/warmup.js";
export {
  assertSafeDownloadDestination,
  assertSafeDownloadUrl,
  isSafeDownloadPath,
} from "./download/security.js";
export { OfflinePolicy } from "./offline/policy.js";
export { NetworkAccessGuard } from "./offline/guard.js";
export {
  checkOfflineCapability,
  isOfflineCapable,
} from "./offline/capabilities.js";
export { classify } from "./offline/result.js";
export { OperationHistory } from "./state/history.js";
export { StateRecovery } from "./state/recovery.js";
export type {
  CacheLayer,
  CacheEntryState,
  CacheEntryMeta,
  CacheLayerConfig,
  CacheManagerConfig,
  CacheManagerStats,
  ContentAddressableRef,
} from "./cache/types.js";
export type {
  MarketplaceEvent,
  MarketplaceEventData,
  EventListener,
  EventUnsubscribe,
} from "./types/events.js";
export type {
  Plugin,
  PluginContext,
  PluginHooks,
  PluginManifest,
  PluginCapability,
  PluginState,
  PluginFailurePolicy,
  PluginDependency,
  PluginEntry,
  PluginRegistrationOptions,
  PluginLogger,
  PluginConfigAccess,
  PluginStateAccess,
  PluginEventAccess,
  HookErrorPolicy,
  HookRegistration,
  PluginPermission,
  WizardStep,
  WizardChoice,
} from "./types/plugin.js";
export type {
  MarketplaceConfig,
  ConfigSource,
  ResolvedConfig,
  ResolvedCacheConfig,
  ResolvedLoggerConfig,
  LogLevel,
  CacheConfigInput,
  LoggerConfigInput,
  PluginConfigInput,
  HooksConfig,
} from "./types/config.js";
export type { ErrorCode, ErrorSeverity } from "./types/errors.js";
export type {
  ErrorCategory as ClassifiedErrorCategory,
  Retryability,
} from "./types/errors.js";
export type { DoctorRepairAction, DoctorRepairResult } from "./types/doctor.js";
export type {
  DoctorCheck,
  DoctorResult,
  DoctorReport,
  DoctorStatus,
} from "./types/doctor.js";
export type {
  DetectedProject,
  DetectedFramework,
  FrameworkType,
  PackageManagerType,
  BundlerType,
  StylingType,
  TestingType,
  RuntimeType,
} from "./types/detection.js";
export type {
  DependencyNode,
  DependencyGraph,
  ResolvedDependency,
  DependencyConflict,
  InstallAction,
  ResolvedResource,
  InstallationPlan,
  PlanOptions,
} from "./types/dependencies.js";
export type {
  VersionRange,
  VersionSpec,
  VersionOperator,
  ResolvedVersion,
  CompatibilityResult,
  CompatibilityIssue,
} from "./types/versions.js";
export type {
  DownloadOptions,
  DownloadResult as LegacyDownloadResult,
  DownloadedFile,
  DownloadProgress,
} from "./types/download.js";

export type {
  ProviderType,
  RegistryProvider,
  ProviderConfig,
  TreeEntry,
  ProviderCapabilities,
} from "./types/providers.js";

export type {
  ResourceTypeDefinition,
  ResourceTypeCapabilities,
  ResourceTypeRegistration,
  ResourceTypeInstaller,
  ResourceTypeCapability,
  ResourceTypeValidator,
  ValidationResult,
  InstallerContext,
  InstallOutcome,
  PreviewOutcome,
  PreviewFile,
  PreviewConflict,
  RemoveContext,
} from "./types/resource-types.js";

export type {
  PipelineContext,
  PipelineFile,
  PipelineAction,
  PipelineOptions,
  PipelineSnapshot,
  SnapshotFile,
  PipelineError,
  PipelineMetadata,
  PipelineStage,
  PipelineResult,
} from "./types/pipeline.js";

export type {
  VariableDefinition,
  VariableType,
  VariableValidation,
  VariableSet,
  VariableResolver,
  VariableError,
} from "./types/variables.js";

export type {
  TemplateEngine,
  TemplateContext,
  TemplateHelper,
  TemplateExpression,
  TemplateRenderResult,
  TemplateSyntax,
  TemplateSyntaxConfig,
} from "./types/template.js";

export type {
  ASTTransform,
  ASTTransformTarget,
  ASTNode,
  ASTNodeType,
  ASTContext,
  ASTLanguage,
  ASTParseResult,
  ASTError,
  ASTTransformer,
} from "./types/ast.js";

export type {
  TransformDefinition,
  TransformTarget,
  TransformFunction,
  TransformInput,
  TransformOutput,
  TransformRegistry,
  TransformResult,
  TransformHook,
} from "./types/transform.js";

export type {
  MergeStrategy,
  MergeStrategyName,
  MergeContext,
  MergeOptions,
  MergeResult,
  MergeConflict,
  MergeRegistry,
  MergeManifest,
} from "./types/merge.js";

export type {
  Snapshot,
  SnapshotEntry,
  SnapshotMetadata,
  SnapshotManager,
  SnapshotRestoreResult,
  SnapshotConfig,
} from "./types/snapshot.js";

export type {
  LockFile,
  LockEntry,
  LockDependency,
  LockFileEntry,
  LockFileService,
} from "./types/lockfile.js";

export type {
  DatabaseConfig,
  DatabaseEntry,
  DatabaseFileEntry,
  DatabaseHistoryEntry,
  DatabaseAction,
  DatabaseService,
  DatabaseEntryStatus,
  InstallReport as DatabaseInstallReport,
  LocalDatabase,
} from "./types/database.js";

export {
  MarketplaceStateManager,
  createStateManager,
  resolveStateRoot,
  resolveStatePaths,
  STATE_SCHEMA_VERSION,
  type MarketplaceStatePaths,
  type StateMeta,
} from "./state/index.js";

export {
  MARKETPLACE_VERSION,
  CLI_NAME,
  LEGACY_CLI_NAMES,
} from "./constants.js";

export {
  StorageManager,
  createStorageManager,
  type StorageManagerConfig,
  type StoragePaths,
  type DirectoryStats,
  type StorageStats,
} from "./storage/index.js";

export {
  NetworkClient,
  createNetworkClient,
  NodeTransport,
  MockTransport,
  isRetryableStatus,
  defaultRetryPolicy,
  defaultNetworkConfig,
} from "./network/index.js";
export type {
  Transport,
  NetworkRequest,
  NetworkResponse,
  NetworkJsonResponse,
  NetworkClientConfig,
  RetryPolicy,
  RateLimitInfo,
  HttpCacheEntry,
} from "./network/index.js";

export {
  InstalledStateManager,
  createInstalledStateManager,
} from "./installed-state/index.js";

export {
  ReconciliationEngine,
  createReconciliationEngine,
} from "./reconciliation/index.js";

export { LifecycleManager, createLifecycleManager } from "./lifecycle/index.js";

export {
  createEnhancedLockFileService,
  type LockFileValidation,
} from "./lockfile/index.js";

export type {
  InstallationState,
  FileIntegrityStatus,
  ManagedFile,
  InstalledResource,
  InstalledDependency,
  InstalledResourceMetadata,
  InstalledStateFile,
  ReconciliationAction,
  ReconciliationItem,
  ReconciliationDetails,
  ReconciliationResult,
  ResourceStatus,
  ManagedFileState,
  IntegrityState,
  UpdateCheckResult,
  RemovePlan,
  LifecycleResult,
  ModifiedFilePolicy,
} from "./types/installed-state.js";

export type {
  PluginDiscoveredEvent,
  PluginLoadedEvent,
  PluginInitializedEvent,
  PluginFailedEvent,
  PluginDisposedEvent,
  ResourceTypeRegisteredEvent,
  InstallerRegisteredEvent,
  ExtensionConflictEvent,
  HookExecutionEvent,
  ResourceTypeInstallerDefinition,
  InstallerRegistryEntry,
  InstallerFunction,
  InstallerInstallContext,
  InstallerResult,
} from "./types/extensions.js";

export const VERSION = "1.0.0";
