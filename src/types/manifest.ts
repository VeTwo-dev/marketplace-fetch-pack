export interface ResourceManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: ResourceAuthor;
  readonly category: string;
  readonly tags: ReadonlyArray<string>;
  readonly files: ReadonlyArray<ResourceFile>;
  readonly dependencies: ReadonlyArray<ResourceDependency>;
  /** Canonical `@scope/name` identifier when the manifest declares one. */
  readonly resourceId?: string;
  readonly compatibility?: ResourceCompatibility;
  readonly repository?: string;
  readonly homepage?: string;
  readonly license?: string;
  readonly keywords: ReadonlyArray<string>;
  readonly defaultDestination?: string;
  readonly engine?: string;
  readonly vetwo?: VetwoResourceMetadata;
}

export interface VetwoResourceMetadata {
  readonly minNodeVersion?: string;
  readonly frameworks?: ReadonlyArray<string>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, string>>;
}

interface ResourceAuthor {
  readonly name: string;
  readonly email?: string;
  readonly url?: string;
  readonly github?: string;
}

interface ResourceFile {
  readonly path: string;
  readonly sha?: string;
  readonly size?: number;
}

interface ResourceDependency {
  readonly id: string;
  readonly version?: string;
  readonly optional?: boolean;
}

interface ResourceCompatibility {
  readonly node?: string;
  readonly frameworks?: ReadonlyArray<string>;
  readonly platforms?: ReadonlyArray<PlatformType>;
}

type PlatformType = "linux" | "darwin" | "win32";

export type ManifestFileName =
  "resource.json" | "manifest.json" | "vetwo.json" | "package.json";

export const MANIFEST_FILE_NAMES: ReadonlyArray<ManifestFileName> = [
  "resource.json",
  "manifest.json",
  "vetwo.json",
  "package.json",
];

export interface ManifestFile {
  readonly fileName: ManifestFileName;
  readonly path: string;
  readonly content: Readonly<Record<string, unknown>>;
}
