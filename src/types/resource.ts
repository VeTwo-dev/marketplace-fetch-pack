export type ResourceId = string;
export type ResourceVersion = string;

export interface Resource {
  readonly id: ResourceId;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: ResourceVersion;
  readonly category: string;
  readonly tags: ReadonlyArray<string>;
  readonly author: ResourceAuthor;
  readonly files: ReadonlyArray<ResourceFile>;
  readonly dependencies: ReadonlyArray<ResourceDependency>;
  readonly compatibility?: ResourceCompatibility;
  readonly repository?: string;
  readonly homepage?: string;
  readonly license?: string;
  readonly keywords: ReadonlyArray<string>;
  readonly defaultDestination?: string;
  readonly manifestPath: string;
  readonly manifestHash: string;
  readonly size?: number;
  readonly downloads?: number;
  readonly updatedAt?: string;
}

export interface ResourceAuthor {
  readonly name: string;
  readonly email?: string;
  readonly url?: string;
  readonly github?: string;
}

export interface ResourceFile {
  readonly path: string;
  readonly sha?: string;
  readonly size?: number;
}

export interface ResourceDependency {
  readonly id: string;
  readonly version?: string;
  readonly optional?: boolean;
}

export interface ResourceCompatibility {
  readonly node?: string;
  readonly frameworks?: ReadonlyArray<string>;
  readonly platforms?: ReadonlyArray<"linux" | "darwin" | "win32">;
}
