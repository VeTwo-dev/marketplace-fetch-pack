import type { RegistryResource } from "../types/registry.js";
import {
  type DependencyGraphV2,
  type DependencyNodeV2,
  type DependencyEdge,
  type DependencyConflictV2,
  type DependencyConstraint,
  type PeerRequirement,
  type OptionalDependencyResult,
  type DependencyType,
  normalizeDependencySpec,
  buildReverseEdges,
  detectCycles,
  buildTopologicalOrder,
} from "./graph.js";
import type { VersionResolver } from "../versions/index.js";
import { MarketplaceClientError } from "../errors/index.js";
import { createLogger, type Logger } from "../logger/index.js";

export interface ResolverContext {
  readonly registryResources: ReadonlyMap<
    string,
    ReadonlyArray<RegistryResource>
  >;
  readonly installedVersions: ReadonlyMap<string, string>;
  readonly nodeVersion: string;
  readonly frameworks: ReadonlyArray<string>;
  readonly platform: string;
  readonly maxDepth: number;
  readonly skipOptional: boolean;
  readonly multiVersionPolicy: "deny" | "allow";
}

export interface ResolverResult {
  readonly graph: DependencyGraphV2;
  readonly resolvedVersions: ReadonlyMap<string, string>;
  readonly installationOrder: ReadonlyArray<string>;
  readonly conflicts: ReadonlyArray<DependencyConflictV2>;
  readonly peerRequirements: ReadonlyArray<PeerRequirement>;
  readonly optionalResults: ReadonlyArray<OptionalDependencyResult>;
  readonly isDeterministic: boolean;
  readonly resolutionMs: number;
}

export class AdvancedDependencyResolver {
  private readonly _versionResolver: VersionResolver;
  private readonly _logger: Logger;

  constructor(versionResolver: VersionResolver, logger?: Logger) {
    this._versionResolver = versionResolver;
    this._logger = logger ?? createLogger({ prefix: "advanced-deps" });
  }

  resolve(resourceId: string, context: ResolverContext): ResolverResult {
    const startTime = Date.now();

    const selfDeps = this._checkSelfDependencies(resourceId, context);
    if (selfDeps.length > 0) {
      throw new MarketplaceClientError("DEPENDENCY_CIRCULAR", {
        message: `Self-dependency detected: ${selfDeps.join(", ")}`,
        context: { selfDependencies: selfDeps },
      });
    }

    const nodes = new Map<string, DependencyNodeV2>();
    const edges: Array<DependencyEdge> = [];
    const conflicts: Array<DependencyConflictV2> = [];
    const peerRequirements: Array<PeerRequirement> = [];
    const optionalResults: Array<OptionalDependencyResult> = [];
    const resolvedVersions = new Map<string, string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const circular: Array<Array<string>> = [];

    const resolveNode = (
      id: string,
      depth: number,
      originPath: ReadonlyArray<string>,
      type: DependencyType,
      optional: boolean,
    ): DependencyNodeV2 | null => {
      if (depth > context.maxDepth) {
        throw new MarketplaceClientError("DEPENDENCY_CIRCULAR", {
          message: `Dependency depth ${depth} exceeds limit (${context.maxDepth})`,
          context: { chain: originPath.slice(-6), resourceId: id },
        });
      }

      if (visiting.has(id)) {
        const cycleStart = originPath.indexOf(id);
        if (cycleStart >= 0) {
          circular.push([...originPath.slice(cycleStart), id]);
        }
        return null;
      }

      if (visited.has(id)) {
        return nodes.get(id) ?? null;
      }

      visiting.add(id);

      const versions = context.registryResources.get(id);
      if (versions === undefined || versions.length === 0) {
        if (optional) {
          optionalResults.push({
            resourceId: originPath[originPath.length - 1] ?? "unknown",
            dependencyId: id,
            status: "unavailable",
            reason: "Resource not found in registry",
          });
          visiting.delete(id);
          return null;
        }
        throw new MarketplaceClientError("DEPENDENCY_NOT_FOUND", {
          message: `Required dependency not found: ${id}`,
          context: {
            resourceId: id,
            requestedBy: originPath[originPath.length - 1],
          },
        });
      }

      const resolved = this._resolveVersionForNode(id, versions, context);
      if (resolved === null) {
        if (optional) {
          optionalResults.push({
            resourceId: originPath[originPath.length - 1] ?? "unknown",
            dependencyId: id,
            status: "incompatible",
            reason: "No compatible version found",
          });
          visiting.delete(id);
          return null;
        }
        throw new MarketplaceClientError("DEPENDENCY_NOT_FOUND", {
          message: `No compatible version found for: ${id}`,
          context: {
            resourceId: id,
            availableVersions: versions.map((v) => v.version),
          },
        });
      }

      resolvedVersions.set(id, resolved.version);

      const childEdges: Array<DependencyEdge> = [];
      const depNodes: Array<DependencyNodeV2> = [];

      for (const dep of resolved.dependencies) {
        const depSpec = normalizeDependencySpec(dep);
        const childType = depSpec.type;
        const childOptional = depSpec.optional || context.skipOptional;

        const edge: DependencyEdge = {
          from: id,
          to: depSpec.resourceId,
          type: childType,
          versionRange: depSpec.versionRange,
          optional: depSpec.optional,
        };
        childEdges.push(edge);
        edges.push(edge);

        if (depSpec.type === "peer") {
          const installedVersion = context.installedVersions.get(
            depSpec.resourceId,
          );
          peerRequirements.push({
            resourceId: id,
            peerId: depSpec.resourceId,
            versionRange: depSpec.versionRange,
            satisfied: installedVersion !== undefined,
            installedVersion,
          });
          continue;
        }

        const childNode = resolveNode(
          depSpec.resourceId,
          depth + 1,
          [...originPath, depSpec.resourceId],
          childType,
          childOptional,
        );

        if (childNode !== null) {
          depNodes.push(childNode);
        }
      }

      const node: DependencyNodeV2 = {
        id,
        version: resolved.version,
        dependencies: childEdges,
        type,
        optional,
        depth,
        originPath,
      };

      nodes.set(id, node);
      visiting.delete(id);
      visited.add(id);

      return node;
    };

    const rootNode = resolveNode(
      resourceId,
      0,
      [resourceId],
      "required",
      false,
    );
    if (rootNode === null) {
      throw new MarketplaceClientError("DEPENDENCY_NOT_FOUND", {
        message: `Root resource not found: ${resourceId}`,
        context: { resourceId },
      });
    }

    const allCycles = detectCycles(nodes);
    for (const cycle of allCycles) {
      circular.push([...cycle]);
    }

    const detectedConflicts = this._detectConflicts(edges, nodes);
    conflicts.push(...detectedConflicts);

    if (context.multiVersionPolicy === "deny" && detectedConflicts.length > 0) {
      const firstConflict = detectedConflicts[0]!;
      throw new MarketplaceClientError("DEPENDENCY_CONFLICT", {
        message: firstConflict.explanation,
        context: {
          conflictId: firstConflict.id,
          versions: firstConflict.versions,
          constraints: firstConflict.constraints,
        },
      });
    }

    const reverseEdges = buildReverseEdges(edges);
    const flat = buildTopologicalOrder(nodes, edges);

    const constructionMs = Date.now() - startTime;

    return {
      graph: {
        root: resourceId,
        nodes,
        edges,
        reverseEdges,
        flat,
        circular,
        conflicts,
        peerRequirements,
        optionalResults,
        totalSize: nodes.size,
        constructionMs,
      },
      resolvedVersions,
      installationOrder: flat,
      conflicts,
      peerRequirements,
      optionalResults,
      isDeterministic: true,
      resolutionMs: constructionMs,
    };
  }

  analyzeImpact(
    resourceId: string,
    newVersion: string,
    context: ResolverContext,
  ): ImpactAnalysis {
    const nodes = new Map<string, DependencyNodeV2>();

    for (const [id, versions] of context.registryResources) {
      const latest = versions[0];
      if (latest === undefined) continue;

      const edges: Array<DependencyEdge> = [];
      for (const dep of latest.dependencies) {
        edges.push({
          from: id,
          to: dep.id,
          type: dep.optional ? "optional" : "required",
          versionRange: dep.version ?? "*",
          optional: dep.optional === true,
        });
      }

      nodes.set(id, {
        id,
        version: latest.version,
        dependencies: edges,
        type: "required",
        optional: false,
        depth: 0,
        originPath: [id],
      });
    }

    const allEdges: Array<DependencyEdge> = [];
    for (const node of nodes.values()) {
      allEdges.push(...node.dependencies);
    }

    const allReverse = buildReverseEdges(allEdges);
    const directDependents = allReverse.get(resourceId) ?? [];
    const transitiveDependents: Array<string> = [];

    const queue = directDependents.map((e) => e.to);
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      transitiveDependents.push(current);

      const node = nodes.get(current);
      if (node !== undefined) {
        const deps = allReverse.get(current) ?? [];
        for (const dep of deps) {
          if (!visited.has(dep.to)) {
            queue.push(dep.to);
          }
        }
      }
    }

    const potentiallyBroken: Array<{ id: string; reason: string }> = [];
    for (const depId of transitiveDependents) {
      const node = nodes.get(depId);
      if (node === undefined) continue;

      for (const edge of node.dependencies) {
        if (edge.to === resourceId) {
          const currentVersion =
            context.registryResources.get(resourceId)?.[0]?.version;
          if (
            currentVersion !== undefined &&
            !this._versionResolver.satisfiesRange(newVersion, edge.versionRange)
          ) {
            potentiallyBroken.push({
              id: depId,
              reason: `Requires ${resourceId} ${edge.versionRange}, but new version is ${newVersion}`,
            });
          }
        }
      }
    }

    return {
      resourceId,
      newVersion,
      directDependents: directDependents.map((e) => e.to),
      transitiveDependents,
      potentiallyBroken,
      impactSeverity: potentiallyBroken.length > 0 ? "breaking" : "safe",
    };
  }

  private _resolveVersionForNode(
    id: string,
    versions: ReadonlyArray<RegistryResource>,
    context: ResolverContext,
  ): RegistryResource | null {
    const sorted = [...versions].sort((a, b) =>
      this._versionResolver.compareVersions(b.version, a.version),
    );

    for (const resource of sorted) {
      if (resource.compatibility?.node !== undefined) {
        if (
          !this._versionResolver.satisfiesRange(
            context.nodeVersion,
            resource.compatibility.node,
          )
        ) {
          continue;
        }
      }

      if (
        resource.compatibility?.platforms !== undefined &&
        resource.compatibility.platforms.length > 0
      ) {
        if (
          !(resource.compatibility.platforms as ReadonlyArray<string>).includes(
            context.platform,
          )
        ) {
          continue;
        }
      }

      return resource;
    }

    return sorted[0] ?? null;
  }

  private _detectConflicts(
    edges: ReadonlyArray<DependencyEdge>,
    nodes: ReadonlyMap<string, DependencyNodeV2>,
  ): ReadonlyArray<DependencyConflictV2> {
    const versionMap = new Map<string, Map<string, Set<string>>>();

    for (const edge of edges) {
      const existing = versionMap.get(edge.to);
      if (existing !== undefined) {
        const requesters = existing.get(edge.versionRange);
        if (requesters !== undefined) {
          requesters.add(edge.from);
        } else {
          existing.set(edge.versionRange, new Set([edge.from]));
        }
      } else {
        const versionMap2 = new Map<string, Set<string>>();
        versionMap2.set(edge.versionRange, new Set([edge.from]));
        versionMap.set(edge.to, versionMap2);
      }
    }

    const conflicts: Array<DependencyConflictV2> = [];

    for (const [id, versionRequests] of versionMap) {
      if (versionRequests.size > 1) {
        const versions = Array.from(versionRequests.keys());
        const constraints: Array<DependencyConstraint> = [];
        const requestedBy: Array<string> = [];

        for (const [range, requesters] of versionRequests) {
          constraints.push({
            resourceId: id,
            versionRange: range,
            type: "required",
          });
          for (const req of requesters) {
            requestedBy.push(req);
          }
        }

        const nodeVersions = nodes.get(id);
        const possibleResolutions =
          nodeVersions !== undefined ? [nodeVersions.version] : [];

        const explanation = `Resource "${id}" has conflicting version requirements: ${versions.join(", ")}. Requested by: ${requestedBy.join(", ")}`;

        conflicts.push({
          id,
          versions,
          constraints,
          requestedBy,
          possibleResolutions,
          explanation,
        });
      }
    }

    return conflicts;
  }

  private _checkSelfDependencies(
    resourceId: string,
    context: ResolverContext,
  ): ReadonlyArray<string> {
    const versions = context.registryResources.get(resourceId);
    if (versions === undefined) return [];

    const selfDeps: Array<string> = [];
    for (const resource of versions) {
      for (const dep of resource.dependencies) {
        if (dep.id === resourceId) {
          selfDeps.push(resourceId);
        }
      }
    }

    return selfDeps;
  }
}

export interface ImpactAnalysis {
  readonly resourceId: string;
  readonly newVersion: string;
  readonly directDependents: ReadonlyArray<string>;
  readonly transitiveDependents: ReadonlyArray<string>;
  readonly potentiallyBroken: ReadonlyArray<{ id: string; reason: string }>;
  readonly impactSeverity: "safe" | "breaking";
}
