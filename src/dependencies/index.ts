import type {
  DependencyNode,
  DependencyGraph,
  DependencyConflict,
  InstallationPlan,
  ResolvedResource,
  PlanOptions,
} from "../types/dependencies.js";
import type {
  RegistryResource,
  RegistryDependency,
} from "../types/registry.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";
import { DEFAULT_SECURITY_POLICY } from "../security/index.js";
import { VersionResolver } from "../versions/index.js";
import {
  AdvancedDependencyResolver,
  type ResolverContext,
  type ResolverResult,
  type ImpactAnalysis,
} from "./advanced-resolver.js";
import { ResolutionCache } from "./resolution-cache.js";
import {
  type DependencyGraphV2,
  type DependencyEdge,
  getDependents,
  getTransitiveDependents,
} from "./graph.js";

export class DependencyResolver {
  private readonly _resourceMap: Map<string, Array<RegistryResource>> =
    new Map();
  private readonly _versionResolver: VersionResolver;
  private readonly _logger: Logger;
  private readonly _advancedResolver: AdvancedDependencyResolver;
  private readonly _resolutionCache: ResolutionCache;
  private _lastResolverResult: ResolverResult | null = null;

  constructor(logger?: Logger) {
    this._logger = logger ?? createLogger({ prefix: "dependencies" });
    this._versionResolver = new VersionResolver(logger);
    this._advancedResolver = new AdvancedDependencyResolver(
      this._versionResolver,
      logger,
    );
    this._resolutionCache = new ResolutionCache();
  }

  setResources(resources: ReadonlyArray<RegistryResource>): void {
    this._resourceMap.clear();
    for (const resource of resources) {
      const existing = this._resourceMap.get(resource.id);
      if (existing !== undefined) {
        existing.push(resource);
      } else {
        this._resourceMap.set(resource.id, [resource]);
      }
      // Alias: manifests may reference the canonical `@scope/name` id while
      // the registry keys by short name. Index both so resolution works.
      if (
        resource.manifestId !== undefined &&
        resource.manifestId !== "" &&
        resource.manifestId !== resource.id
      ) {
        const aliasExisting = this._resourceMap.get(resource.manifestId);
        if (aliasExisting !== undefined) {
          if (!aliasExisting.includes(resource)) aliasExisting.push(resource);
        } else {
          this._resourceMap.set(resource.manifestId, [resource]);
        }
      }
    }
  }

  getResource(id: string): RegistryResource | undefined {
    const versions = this._resourceMap.get(id);
    if (versions === undefined || versions.length === 0) return undefined;
    return this._versionResolver.getLatest(versions) ?? undefined;
  }

  async resolve(
    resourceId: string,
    skipOptional: boolean = false,
  ): Promise<DependencyGraph> {
    const versions = this._resourceMap.get(resourceId);
    if (versions === undefined || versions.length === 0) {
      throw new MarketplaceClientError("DEPENDENCY_NOT_FOUND", {
        message: `Resource not found: ${resourceId}`,
        context: { resourceId },
      });
    }

    const resource = this._versionResolver.getLatest(versions);
    if (resource === null) {
      throw new MarketplaceClientError("DEPENDENCY_NOT_FOUND", {
        message: `Resource not found: ${resourceId}`,
        context: { resourceId },
      });
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const circular: Array<ReadonlyArray<string>> = [];
    const allNodes = new Map<string, DependencyNode>();
    const allFlatSet = new Set<string>();
    const allFlat: Array<string> = [];

    await this._resolveNode(
      resource,
      resourceId,
      visited,
      visiting,
      circular,
      allNodes,
      allFlatSet,
      allFlat,
      skipOptional,
      [resourceId],
    );

    const conflicts = this._detectConflicts(allFlat, allNodes);

    const graph: DependencyGraph = {
      root: resourceId,
      nodes: allNodes,
      flat: allFlat,
      circular,
      conflicts,
      totalSize: allNodes.size,
    };

    if (circular.length > 0) {
      this._logger.warn("Circular dependencies detected", {
        chains: circular.map((c) => c.join(" -> ")),
      });
    }

    if (conflicts.length > 0) {
      this._logger.warn("Dependency conflicts detected", {
        conflicts: conflicts.map((c) => `${c.id}: ${c.versions.join(", ")}`),
      });
    }

    return graph;
  }

  async resolveAdvanced(
    resourceId: string,
    context: ResolverContext,
  ): Promise<ResolverResult> {
    const cacheKey = this._resolutionCache.buildKey(
      resourceId,
      "",
      context.installedVersions,
      context.nodeVersion,
      context.platform,
      context.frameworks,
      context.skipOptional,
    );

    const cached = this._resolutionCache.get(cacheKey);
    if (cached !== null) {
      this._logger.debug("Resolution cache hit", { resourceId });
      return cached;
    }

    const result = this._advancedResolver.resolve(resourceId, context);

    this._resolutionCache.set(cacheKey, result);
    this._lastResolverResult = result;

    if (result.conflicts.length > 0) {
      this._logger.warn("Advanced resolution conflicts detected", {
        conflicts: result.conflicts.map((c) => c.explanation),
      });
    }

    return result;
  }

  analyzeImpact(
    resourceId: string,
    newVersion: string,
    context: ResolverContext,
  ): ImpactAnalysis {
    return this._advancedResolver.analyzeImpact(
      resourceId,
      newVersion,
      context,
    );
  }

  getReverseDependents(resourceId: string): ReadonlyArray<string> {
    if (this._lastResolverResult === null) return [];

    const edges = this._lastResolverResult.graph.edges;
    const reverseEdges = new Map<string, Array<DependencyEdge>>();

    for (const edge of edges) {
      const existing = reverseEdges.get(edge.to);
      if (existing !== undefined) {
        existing.push({ ...edge, from: edge.to, to: edge.from });
      } else {
        reverseEdges.set(edge.to, [{ ...edge, from: edge.to, to: edge.from }]);
      }
    }

    return getDependents(resourceId, reverseEdges);
  }

  getTransitiveDependentsOf(resourceId: string): ReadonlyArray<string> {
    if (this._lastResolverResult === null) return [];

    const edges = this._lastResolverResult.graph.edges;
    const reverseEdges = new Map<string, Array<DependencyEdge>>();

    for (const edge of edges) {
      const existing = reverseEdges.get(edge.to);
      if (existing !== undefined) {
        existing.push({ ...edge, from: edge.to, to: edge.from });
      } else {
        reverseEdges.set(edge.to, [{ ...edge, from: edge.to, to: edge.from }]);
      }
    }

    return getTransitiveDependents(resourceId, reverseEdges);
  }

  getDependencyGraphV2(): DependencyGraphV2 | null {
    return this._lastResolverResult?.graph ?? null;
  }

  async resolvePlan(
    resourceId: string,
    options?: PlanOptions,
  ): Promise<InstallationPlan> {
    const skipOptional = options?.skipOptional ?? false;
    const graph = await this.resolve(resourceId, skipOptional);

    const resources = new Map<string, ResolvedResource>();
    const skipped: Array<string> = [];
    const warnings: Array<string> = [];

    for (const nodeId of graph.flat) {
      const node = graph.nodes.get(nodeId);
      if (node === undefined) continue;

      const installedVersion = options?.installedVersions?.get(nodeId);
      const isInstalled = options?.installed?.has(nodeId) ?? false;

      const conflict = graph.conflicts.find((c) => c.id === nodeId);
      let action: ResolvedResource["action"];

      if (conflict !== undefined) {
        action = "conflict";
        warnings.push(
          `Conflict for ${nodeId}: versions ${conflict.versions.join(", ")}`,
        );
      } else if (isInstalled && installedVersion !== undefined) {
        if (installedVersion === node.version) {
          action = "skip";
          skipped.push(nodeId);
        } else {
          action = "update";
        }
      } else if (isInstalled) {
        action = "skip";
        skipped.push(nodeId);
      } else {
        action = "install";
      }

      const depIds = node.dependencies.map((d) => d.id);

      const resolved: ResolvedResource = {
        id: nodeId,
        version: node.version,
        action,
        dependencies: depIds,
        optional: node.optional,
        installedVersion,
        conflict,
      };

      resources.set(nodeId, resolved);
    }

    return {
      root: resourceId,
      resources,
      installOrder: graph.flat,
      conflicts: graph.conflicts,
      skipped,
      warnings,
      totalResources: graph.flat.length,
      dryRun: options?.dryRun ?? false,
    };
  }

  getDependencies(resourceId: string): ReadonlyArray<RegistryDependency> {
    const versions = this._resourceMap.get(resourceId);
    if (versions === undefined || versions.length === 0) return [];
    const resource = this._versionResolver.getLatest(versions);
    return resource?.dependencies ?? [];
  }

  getDependents(resourceId: string): ReadonlyArray<RegistryResource> {
    const dependents: Array<RegistryResource> = [];
    for (const versions of this._resourceMap.values()) {
      for (const resource of versions) {
        if (resource.dependencies.some((d) => d.id === resourceId)) {
          dependents.push(resource);
        }
      }
    }
    return dependents;
  }

  isInstalled(resourceId: string, installed: ReadonlySet<string>): boolean {
    return installed.has(resourceId);
  }

  getInstallOrder(graph: DependencyGraph): ReadonlyArray<string> {
    const order: Array<string> = [];
    const visited = new Set<string>();

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = graph.nodes.get(nodeId);
      if (node !== undefined) {
        for (const dep of node.dependencies) {
          visit(dep.id);
        }
      }

      order.push(nodeId);
    };

    for (const nodeId of graph.flat) {
      visit(nodeId);
    }

    return order;
  }

  invalidateResolutionCache(): void {
    this._resolutionCache.clear();
    this._lastResolverResult = null;
  }

  async resolveIndependentSubgraphs(
    resourceIds: ReadonlyArray<string>,
    skipOptional: boolean = false,
  ): Promise<ReadonlyMap<string, DependencyGraph>> {
    const results = new Map<string, DependencyGraph>();

    // Resolve all roots first
    const roots = resourceIds.map((id) => {
      const versions = this._resourceMap.get(id);
      return {
        id,
        resource: versions
          ? (this._versionResolver.getLatest(versions) ?? null)
          : null,
      };
    });

    // Filter to only roots that don't depend on each other
    const independent: Array<{ id: string; resource: RegistryResource }> = [];
    for (const root of roots) {
      if (root.resource === null) continue;

      const dependsOnOthers = root.resource.dependencies.some(
        (dep) => resourceIds.includes(dep.id) && dep.id !== root.id,
      );

      if (!dependsOnOthers) {
        independent.push({ id: root.id, resource: root.resource });
      }
    }

    // Resolve independent roots in parallel
    const promises = independent.map(async ({ id }) => {
      const graph = await this.resolve(id, skipOptional);
      results.set(id, graph);
    });

    await Promise.allSettled(promises);

    return results;
  }

  resolveOffline(
    resourceId: string,
    installedVersions: ReadonlyMap<string, string>,
    skipOptional: boolean = false,
  ): DependencyGraph {
    const versions = this._resourceMap.get(resourceId);
    if (versions === undefined || versions.length === 0) {
      throw new MarketplaceClientError("DEPENDENCY_NOT_FOUND", {
        message: `Resource not found: ${resourceId}`,
        context: { resourceId },
      });
    }

    const resource = this._versionResolver.getLatest(versions);
    if (resource === null) {
      throw new MarketplaceClientError("DEPENDENCY_NOT_FOUND", {
        message: `Resource not found: ${resourceId}`,
        context: { resourceId },
      });
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const circular: Array<ReadonlyArray<string>> = [];
    const allNodes = new Map<string, DependencyNode>();
    const allFlatSet = new Set<string>();
    const allFlat: Array<string> = [];

    this._resolveNodeOffline(
      resource,
      resourceId,
      visited,
      visiting,
      circular,
      allNodes,
      allFlatSet,
      allFlat,
      skipOptional,
      [resourceId],
      false,
      installedVersions,
    );

    const conflicts = this._detectConflicts(allFlat, allNodes);

    return {
      root: resourceId,
      nodes: allNodes,
      flat: allFlat,
      circular,
      conflicts,
      totalSize: allNodes.size,
    };
  }

  private _resolveNodeOffline(
    resource: RegistryResource,
    currentId: string,
    visited: Set<string>,
    visiting: Set<string>,
    circular: Array<ReadonlyArray<string>>,
    allNodes: Map<string, DependencyNode>,
    allFlatSet: Set<string>,
    allFlat: Array<string>,
    skipOptional: boolean,
    path: ReadonlyArray<string>,
    isOptional: boolean,
    installedVersions: ReadonlyMap<string, string>,
  ): DependencyNode {
    if (visiting.has(currentId)) {
      const cycleStart = path.indexOf(currentId);
      if (cycleStart >= 0) {
        circular.push(path.slice(cycleStart));
      }
      return {
        id: currentId,
        version: resource.version,
        dependencies: [],
        optional: false,
      };
    }

    if (visited.has(currentId)) {
      const existing = allNodes.get(currentId);
      if (existing !== undefined) return existing;
    }

    visiting.add(currentId);

    const depNodes: Array<DependencyNode> = [];

    for (const dep of resource.dependencies) {
      if (skipOptional && dep.optional === true) continue;

      const depResource = this._resolveVersionForDep(dep);
      if (depResource === null) {
        if (dep.optional === true) {
          this._logger.debug(`Optional dependency not found: ${dep.id}`);
          continue;
        }
        throw new MarketplaceClientError("DEPENDENCY_NOT_FOUND", {
          message: `Required dependency not found: ${dep.id}`,
          context: { resourceId: currentId, dependencyId: dep.id },
        });
      }

      const childPath = [...path, dep.id];
      const childNode = this._resolveNodeOffline(
        depResource,
        dep.id,
        visited,
        visiting,
        circular,
        allNodes,
        allFlatSet,
        allFlat,
        skipOptional,
        childPath,
        dep.optional === true,
        installedVersions,
      );

      depNodes.push(childNode);
    }

    visiting.delete(currentId);
    visited.add(currentId);

    const node: DependencyNode = {
      id: currentId,
      version: resource.version,
      dependencies: depNodes,
      optional: isOptional,
    };

    allNodes.set(currentId, node);
    if (!allFlatSet.has(currentId)) {
      allFlatSet.add(currentId);
      allFlat.push(currentId);
    }

    return node;
  }

  private _resolveVersionForDep(
    dep: RegistryDependency,
  ): RegistryResource | null {
    const versions = this._resourceMap.get(dep.id);
    if (versions === undefined || versions.length === 0) return null;

    const candidates = versions;

    if (
      dep.version === undefined ||
      dep.version === "*" ||
      dep.version === ""
    ) {
      return this._versionResolver.getLatest(candidates);
    }

    const resolved = this._versionResolver.resolveVersion(
      candidates,
      dep.version,
    );

    if (resolved === null || !resolved.satisfies) return null;

    return candidates.find((r) => r.version === resolved.resolved) ?? null;
  }

  private async _resolveNode(
    resource: RegistryResource,
    currentId: string,
    visited: Set<string>,
    visiting: Set<string>,
    circular: Array<ReadonlyArray<string>>,
    allNodes: Map<string, DependencyNode>,
    allFlatSet: Set<string>,
    allFlat: Array<string>,
    skipOptional: boolean,
    path: ReadonlyArray<string>,
    isOptional: boolean = false,
  ): Promise<DependencyNode> {
    if (visiting.has(currentId)) {
      const cycleStart = path.indexOf(currentId);
      if (cycleStart >= 0) {
        circular.push(path.slice(cycleStart));
      }
      return {
        id: currentId,
        version: resource.version,
        dependencies: [],
        optional: false,
      };
    }

    if (visited.has(currentId)) {
      const existing = allNodes.get(currentId);
      if (existing !== undefined) return existing;
    }

    // Dependency-explosion guard (Step 21): bound recursion depth
    if (path.length > DEFAULT_SECURITY_POLICY.maxDependencyDepth) {
      throw new MarketplaceClientError("DEPENDENCY_CIRCULAR", {
        message: `Dependency depth ${path.length} exceeds security limit (${DEFAULT_SECURITY_POLICY.maxDependencyDepth})`,
        context: { chain: path.slice(-6), reason: "dependency-depth" },
      });
    }

    visiting.add(currentId);

    const depNodes: Array<DependencyNode> = [];

    for (const dep of resource.dependencies) {
      if (skipOptional && dep.optional === true) continue;

      const depResource = this._resolveVersionForDep(dep);
      if (depResource === null) {
        if (dep.optional === true) {
          this._logger.debug(`Optional dependency not found: ${dep.id}`);
          continue;
        }
        throw new MarketplaceClientError("DEPENDENCY_NOT_FOUND", {
          message: `Required dependency not found: ${dep.id}`,
          context: { resourceId: currentId, dependencyId: dep.id },
        });
      }

      const childPath = [...path, dep.id];
      const childNode = await this._resolveNode(
        depResource,
        dep.id,
        visited,
        visiting,
        circular,
        allNodes,
        allFlatSet,
        allFlat,
        skipOptional,
        childPath,
        dep.optional === true,
      );

      depNodes.push(childNode);
    }

    visiting.delete(currentId);
    visited.add(currentId);

    const node: DependencyNode = {
      id: currentId,
      version: resource.version,
      dependencies: depNodes,
      optional: isOptional,
    };

    allNodes.set(currentId, node);
    if (!allFlatSet.has(currentId)) {
      allFlatSet.add(currentId);
      allFlat.push(currentId);
    }

    return node;
  }

  private _detectConflicts(
    allFlat: ReadonlyArray<string>,
    allNodes: Map<string, DependencyNode>,
  ): ReadonlyArray<DependencyConflict> {
    const versionMap = new Map<string, Map<string, Set<string>>>();

    for (const nodeId of allFlat) {
      const node = allNodes.get(nodeId);
      if (node === undefined) continue;

      const versionEntry = versionMap.get(nodeId);
      if (versionEntry !== undefined) {
        const requesters = versionEntry.get(node.version);
        if (requesters !== undefined) {
          requesters.add(nodeId);
        } else {
          versionEntry.set(node.version, new Set([nodeId]));
        }
      } else {
        const versionMap2 = new Map<string, Set<string>>();
        versionMap2.set(node.version, new Set([nodeId]));
        versionMap.set(nodeId, versionMap2);
      }

      this._collectVersionRequests(node, versionMap, nodeId);
    }

    const conflicts: Array<DependencyConflict> = [];

    for (const [id, versions] of versionMap) {
      if (versions.size > 1) {
        conflicts.push({
          id,
          versions: Array.from(versions.keys()),
          requestedBy: Array.from(versions.values())
            .map((s) => Array.from(s))
            .flat(),
        });
      }
    }

    return conflicts;
  }

  private _collectVersionRequests(
    node: DependencyNode,
    versionMap: Map<string, Map<string, Set<string>>>,
    requestPath: string,
  ): void {
    for (const dep of node.dependencies) {
      const existing = versionMap.get(dep.id);
      if (existing !== undefined) {
        const requesters = existing.get(dep.version);
        if (requesters !== undefined) {
          requesters.add(requestPath);
        } else {
          existing.set(dep.version, new Set([requestPath]));
        }
      } else {
        const versionMap2 = new Map<string, Set<string>>();
        versionMap2.set(dep.version, new Set([requestPath]));
        versionMap.set(dep.id, versionMap2);
      }

      this._collectVersionRequests(
        dep,
        versionMap,
        `${requestPath} -> ${dep.id}`,
      );
    }
  }
}
