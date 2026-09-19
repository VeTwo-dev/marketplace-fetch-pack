import type { Resource } from "./resource.js";
import type { Registry } from "./registry.js";
import type { InstallOptions, InstallResult } from "./install.js";
import type { DownloadOptions, DownloadResult } from "./download.js";
import type { Snapshot } from "./snapshot.js";
import type { MergeResult, MergeStrategyName } from "./merge.js";
import type { TransformResult } from "./transform.js";
import type { LockEntry } from "./lockfile.js";

export type MarketplaceEvent =
  | "beforeRegistryLoad"
  | "afterRegistryLoad"
  | "beforeDiscovery"
  | "afterDiscovery"
  | "beforeInstall"
  | "afterInstall"
  | "beforeDownload"
  | "afterDownload"
  | "downloadProgress"
  | "downloadRetry"
  | "downloadCancelled"
  | "beforeWrite"
  | "afterWrite"
  | "beforeTransform"
  | "afterTransform"
  | "beforeMerge"
  | "afterMerge"
  | "beforeSearch"
  | "afterSearch"
  | "beforePreview"
  | "afterPreview"
  | "beforeRollback"
  | "afterRollback"
  | "beforeSnapshot"
  | "afterSnapshot"
  | "beforeLockUpdate"
  | "afterLockUpdate"
  | "beforePipelineStage"
  | "afterPipelineStage"
  | "onError"
  | "rollback"
  | "cacheHit"
  | "cacheMiss"
  | "cacheSet"
  | "cacheInvalidate"
  | "cacheEvict"
  | "cacheCorrupt"
  | "cachePrune"
  | "pluginDiscovered"
  | "pluginLoaded"
  | "pluginInitialized"
  | "pluginFailed"
  | "pluginDisposed"
  | "resourceTypeRegistered"
  | "resourceTypeUnregistered"
  | "installerRegistered"
  | "extensionConflict"
  | "networkAccessBlocked"
  | "offlineFallback"
  | "staleDataUsed"
  | "localRegistryLoaded"
  | "registryRefreshed"
  | "offlineInstallStarted"
  | "offlineInstallCompleted"
  | "offlineCapabilityFailure"
  | "transactionCreated"
  | "transactionStarted"
  | "transactionStageStarted"
  | "transactionStageCompleted"
  | "transactionCommitStarted"
  | "transactionCommitted"
  | "transactionRollbackStarted"
  | "transactionRolledBack"
  | "transactionFailed"
  | "transactionRecoveryRequired"
  | "transactionRecovered"
  | "transactionCancelled";

export type MarketplaceEventData = {
  beforeRegistryLoad: BeforeRegistryLoadData;
  afterRegistryLoad: AfterRegistryLoadData;
  beforeDiscovery: BeforeDiscoveryData;
  afterDiscovery: AfterDiscoveryData;
  beforeInstall: BeforeInstallData;
  afterInstall: AfterInstallData;
  beforeDownload: BeforeDownloadData;
  afterDownload: AfterDownloadData;
  downloadProgress: DownloadProgressEventData;
  downloadRetry: DownloadRetryEventData;
  downloadCancelled: DownloadCancelledEventData;
  beforeWrite: BeforeWriteData;
  afterWrite: AfterWriteData;
  beforeTransform: BeforeTransformData;
  afterTransform: AfterTransformData;
  beforeMerge: BeforeMergeData;
  afterMerge: AfterMergeData;
  beforeSearch: BeforeSearchData;
  afterSearch: AfterSearchData;
  beforePreview: BeforePreviewData;
  afterPreview: AfterPreviewData;
  beforeRollback: BeforeRollbackData;
  afterRollback: AfterRollbackData;
  beforeSnapshot: BeforeSnapshotData;
  afterSnapshot: AfterSnapshotData;
  beforeLockUpdate: BeforeLockUpdateData;
  afterLockUpdate: AfterLockUpdateData;
  beforePipelineStage: BeforePipelineStageData;
  afterPipelineStage: AfterPipelineStageData;
  onError: OnErrorData;
  rollback: RollbackData;
  cacheHit: CacheHitData;
  cacheMiss: CacheMissData;
  cacheSet: CacheSetEventData;
  cacheInvalidate: CacheInvalidateEventData;
  cacheEvict: CacheEvictEventData;
  cacheCorrupt: CacheCorruptEventData;
  cachePrune: CachePruneEventData;
  pluginDiscovered: PluginDiscoveredEventData;
  pluginLoaded: PluginLoadedEventData;
  pluginInitialized: PluginInitializedEventData;
  pluginFailed: PluginFailedEventData;
  pluginDisposed: PluginDisposedEventData;
  resourceTypeRegistered: ResourceTypeRegisteredEventData;
  resourceTypeUnregistered: ResourceTypeUnregisteredEventData;
  installerRegistered: InstallerRegisteredEventData;
  extensionConflict: ExtensionConflictEventData;
  networkAccessBlocked: NetworkAccessBlockedData;
  offlineFallback: OfflineFallbackData;
  staleDataUsed: StaleDataUsedData;
  localRegistryLoaded: LocalRegistryLoadedData;
  registryRefreshed: RegistryRefreshedData;
  offlineInstallStarted: OfflineInstallStartedData;
  offlineInstallCompleted: OfflineInstallCompletedData;
  offlineCapabilityFailure: OfflineCapabilityFailureData;
  transactionCreated: TransactionEventData;
  transactionStarted: TransactionEventData;
  transactionStageStarted: TransactionStageData;
  transactionStageCompleted: TransactionStageData;
  transactionCommitStarted: TransactionEventData;
  transactionCommitted: TransactionEventData;
  transactionRollbackStarted: TransactionEventData;
  transactionRolledBack: TransactionEventData;
  transactionFailed: TransactionFailedData;
  transactionRecoveryRequired: TransactionRecoveryData;
  transactionRecovered: TransactionEventData;
  transactionCancelled: TransactionEventData;
};

interface BeforeRegistryLoadData {
  readonly source: string;
}

interface AfterRegistryLoadData {
  readonly registry: Registry;
  readonly duration: number;
}

interface BeforeDiscoveryData {
  readonly source: string;
  readonly method: "registry" | "scan";
}

interface AfterDiscoveryData {
  readonly resourcesFound: number;
  readonly duration: number;
  readonly method: "registry" | "scan";
}

interface BeforeInstallData {
  readonly options: InstallOptions;
}

interface AfterInstallData {
  readonly result: InstallResult;
}

interface BeforeDownloadData {
  readonly url: string;
  readonly options: DownloadOptions;
}

interface AfterDownloadData {
  readonly url: string;
  readonly result: DownloadResult;
}

interface BeforeWriteData {
  readonly destination: string;
  readonly files: ReadonlyArray<string>;
}

interface AfterWriteData {
  readonly destination: string;
  readonly filesWritten: number;
}

interface BeforeTransformData {
  readonly filePath: string;
  readonly transformName: string;
}

interface AfterTransformData {
  readonly filePath: string;
  readonly result: TransformResult;
}

interface BeforeMergeData {
  readonly filePath: string;
  readonly strategy: MergeStrategyName;
}

interface AfterMergeData {
  readonly filePath: string;
  readonly result: MergeResult;
}

interface BeforeSearchData {
  readonly query: string;
}

interface AfterSearchData {
  readonly query: string;
  readonly resultCount: number;
}

interface BeforePreviewData {
  readonly id: string;
}

interface AfterPreviewData {
  readonly id: string;
  readonly resource: Resource;
}

interface BeforeRollbackData {
  readonly snapshotId: string;
  readonly reason: string;
}

interface AfterRollbackData {
  readonly snapshotId: string;
  readonly filesRestored: number;
  readonly success: boolean;
}

interface BeforeSnapshotData {
  readonly resourceId: string;
  readonly destination: string;
}

interface AfterSnapshotData {
  readonly snapshot: Snapshot;
}

interface BeforeLockUpdateData {
  readonly resourceId: string;
  readonly action: "add" | "remove" | "update";
}

interface AfterLockUpdateData {
  readonly resourceId: string;
  readonly entry: LockEntry | null;
}

interface BeforePipelineStageData {
  readonly stage: string;
  readonly resourceId: string;
}

interface AfterPipelineStageData {
  readonly stage: string;
  readonly resourceId: string;
  readonly duration: number;
  readonly success: boolean;
}

interface OnErrorData {
  readonly error: Error;
  readonly context: string;
  readonly recoverable: boolean;
}

interface RollbackData {
  readonly snapshotId: string;
  readonly resourceId: string;
  readonly reason: string;
}

interface CacheHitData {
  readonly key: string;
  readonly age: number;
}

interface CacheMissData {
  readonly key: string;
}

interface PluginDiscoveredEventData {
  readonly pluginId: string;
  readonly source: string;
}

interface PluginLoadedEventData {
  readonly pluginId: string;
  readonly version: string;
  readonly capabilities: ReadonlyArray<string>;
}

interface PluginInitializedEventData {
  readonly pluginId: string;
  readonly duration: number;
}

interface PluginFailedEventData {
  readonly pluginId: string;
  readonly phase: "load" | "validate" | "initialize" | "dispose";
  readonly error: string;
}

interface PluginDisposedEventData {
  readonly pluginId: string;
  readonly duration: number;
}

interface ResourceTypeRegisteredEventData {
  readonly typeId: string;
  readonly source: "builtin" | "plugin";
  readonly pluginId?: string;
}

interface ResourceTypeUnregisteredEventData {
  readonly typeId: string;
}

interface InstallerRegisteredEventData {
  readonly installerId: string;
  readonly supportedResourceTypes: ReadonlyArray<string>;
  readonly source: "builtin" | "plugin";
  readonly pluginId?: string;
}

interface ExtensionConflictEventData {
  readonly kind: "resource-type" | "installer" | "merge-strategy" | "transform";
  readonly id: string;
  readonly pluginId?: string;
}

interface DownloadProgressEventData {
  readonly url: string;
  readonly resourceId?: string;
  readonly downloaded: number;
  readonly total: number | null;
  readonly percentage: number | null;
  readonly attempt: number;
  readonly maxAttempts: number;
}

interface DownloadRetryEventData {
  readonly url: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly error: string;
  readonly delayMs: number;
}

interface DownloadCancelledEventData {
  readonly url: string;
  readonly resourceId?: string;
}

interface CacheSetEventData {
  readonly key: string;
  readonly layer: string;
  readonly size: number;
}

interface CacheInvalidateEventData {
  readonly key: string;
  readonly layer: string;
  readonly reason: string;
}

interface CacheEvictEventData {
  readonly key: string;
  readonly layer: string;
  readonly reason: string;
  readonly size: number;
}

interface CacheCorruptEventData {
  readonly key: string;
  readonly layer: string;
  readonly error: string;
}

interface CachePruneEventData {
  readonly entriesRemoved: number;
  readonly bytesFreed: number;
  readonly durationMs: number;
}

interface NetworkAccessBlockedData {
  readonly operation: string;
  readonly url?: string;
  readonly mode: string;
}
interface OfflineFallbackData {
  readonly operation: string;
  readonly source: string;
}
interface StaleDataUsedData {
  readonly key: string;
  readonly ageMs: number;
}
interface LocalRegistryLoadedData {
  readonly revision: string;
  readonly stale: boolean;
}
interface RegistryRefreshedData {
  readonly revision: string;
  readonly fromCache: boolean;
}
interface OfflineInstallStartedData {
  readonly resourceId: string;
}
interface OfflineInstallCompletedData {
  readonly resourceId: string;
  readonly fromCache: boolean;
}
interface OfflineCapabilityFailureData {
  readonly operation: string;
  readonly reason: string;
}
interface TransactionEventData {
  readonly transactionId: string;
  readonly resourceId?: string;
}
interface TransactionStageData {
  readonly transactionId: string;
  readonly stage: string;
}
interface TransactionFailedData {
  readonly transactionId: string;
  readonly error: string;
}
interface TransactionRecoveryData {
  readonly transactionId: string;
  readonly reason: string;
}

export type EventListener<T = unknown> = (data: T) => void | Promise<void>;
export type EventUnsubscribe = () => void;
