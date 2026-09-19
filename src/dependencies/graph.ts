import type { RegistryDependency } from "../types/registry.js";

export type DependencyType = "required" | "optional" | "peer" | "development";

export interface NormalizedDependencySpec {
  readonly resourceId: string;
  readonly versionRange: string;
  readonly type: DependencyType;
  readonly optional: boolean;
  readonly sourceConstraints: ReadonlyArray<string>;
  readonly compatibilityConstraints: ReadonlyArray<string>;
}

export interface DependencyEdge {
  readonly from: string;
  readonly to: string;
  readonly type: DependencyType;
  readonly versionRange: string;
  readonly optional: boolean;
}

export interface DependencyGraphV2 {
  readonly root: string;
  readonly nodes: ReadonlyMap<string, DependencyNodeV2>;
  readonly edges: ReadonlyArray<DependencyEdge>;
  readonly reverseEdges: ReadonlyMap<string, ReadonlyArray<DependencyEdge>>;
  readonly flat: ReadonlyArray<string>;
  readonly circular: ReadonlyArray<ReadonlyArray<string>>;
  readonly conflicts: ReadonlyArray<DependencyConflictV2>;
  readonly peerRequirements: ReadonlyArray<PeerRequirement>;
  readonly optionalResults: ReadonlyArray<OptionalDependencyResult>;
  readonly totalSize: number;
  readonly constructionMs: number;
}

export interface DependencyNodeV2 {
  readonly id: string;
  readonly version: string;
  readonly dependencies: ReadonlyArray<DependencyEdge>;
  readonly type: DependencyType;
  readonly optional: boolean;
  readonly depth: number;
  readonly originPath: ReadonlyArray<string>;
}

export interface DependencyConflictV2 {
  readonly id: string;
  readonly versions: ReadonlyArray<string>;
  readonly constraints: ReadonlyArray<DependencyConstraint>;
  readonly requestedBy: ReadonlyArray<string>;
  readonly possibleResolutions: ReadonlyArray<string>;
  readonly explanation: string;
}

export interface DependencyConstraint {
  readonly resourceId: string;
  readonly versionRange: string;
  readonly type: DependencyType;
}

export interface PeerRequirement {
  readonly resourceId: string;
  readonly peerId: string;
  readonly versionRange: string;
  readonly satisfied: boolean;
  readonly installedVersion?: string;
}

export interface OptionalDependencyResult {
  readonly resourceId: string;
  readonly dependencyId: string;
  readonly status: "installed" | "skipped" | "unavailable" | "incompatible";
  readonly reason?: string;
}

export function normalizeDependencySpec(
  dep: RegistryDependency,
): NormalizedDependencySpec {
  const isOptional = dep.optional === true;
  const type: DependencyType = isOptional ? "optional" : "required";

  return {
    resourceId: dep.id,
    versionRange: dep.version ?? "*",
    type,
    optional: isOptional,
    sourceConstraints: dep.version !== undefined ? [dep.version] : [],
    compatibilityConstraints: [],
  };
}

export function buildReverseEdges(
  edges: ReadonlyArray<DependencyEdge>,
): ReadonlyMap<string, ReadonlyArray<DependencyEdge>> {
  const reverse = new Map<string, Array<DependencyEdge>>();

  for (const edge of edges) {
    const existing = reverse.get(edge.to);
    if (existing !== undefined) {
      existing.push({ ...edge, from: edge.to, to: edge.from });
    } else {
      reverse.set(edge.to, [{ ...edge, from: edge.to, to: edge.from }]);
    }
  }

  return reverse;
}

export function detectCycles(
  nodes: ReadonlyMap<string, DependencyNodeV2>,
): ReadonlyArray<ReadonlyArray<string>> {
  const cycles: Array<Array<string>> = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: Array<string> = [];

  const dfs = (nodeId: string): void => {
    if (visited.has(nodeId)) return;

    if (visiting.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart >= 0) {
        cycles.push([...path.slice(cycleStart), nodeId]);
      }
      return;
    }

    visiting.add(nodeId);
    path.push(nodeId);

    const node = nodes.get(nodeId);
    if (node !== undefined) {
      for (const edge of node.dependencies) {
        if (!edge.optional) {
          dfs(edge.to);
        }
      }
    }

    path.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const nodeId of nodes.keys()) {
    dfs(nodeId);
  }

  return cycles;
}

export function detectSelfDependency(
  nodes: ReadonlyMap<string, DependencyNodeV2>,
): ReadonlyArray<string> {
  const selfDeps: Array<string> = [];
  for (const [id, node] of nodes) {
    if (node.dependencies.some((e) => e.to === id)) {
      selfDeps.push(id);
    }
  }
  return selfDeps;
}

export function buildTopologicalOrder(
  nodes: ReadonlyMap<string, DependencyNodeV2>,
  edges: ReadonlyArray<DependencyEdge>,
): ReadonlyArray<string> {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Array<string>>();

  for (const nodeId of nodes.keys()) {
    inDegree.set(nodeId, 0);
    adjacency.set(nodeId, []);
  }

  // Reverse edges: dependency edge a -> b means b must come before a
  for (const edge of edges) {
    if (nodes.has(edge.from) && nodes.has(edge.to)) {
      const current = inDegree.get(edge.from) ?? 0;
      inDegree.set(edge.from, current + 1);
      adjacency.get(edge.to)?.push(edge.from);
    }
  }

  const queue: Array<string> = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }
  queue.sort();

  const order: Array<string> = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
        queue.sort();
      }
    }
  }

  return order;
}

export function pruneIrrelevant(
  nodes: ReadonlyMap<string, DependencyNodeV2>,
  roots: ReadonlyArray<string>,
  _edges: ReadonlyArray<DependencyEdge>,
): ReadonlyMap<string, DependencyNodeV2> {
  const reachable = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);

    const node = nodes.get(nodeId);
    if (node !== undefined) {
      for (const edge of node.dependencies) {
        if (!reachable.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }
  }

  const pruned = new Map<string, DependencyNodeV2>();
  for (const [id, node] of nodes) {
    if (reachable.has(id)) {
      pruned.set(id, node);
    }
  }

  return pruned;
}

export function getDependents(
  nodeId: string,
  reverseEdges: ReadonlyMap<string, ReadonlyArray<DependencyEdge>>,
): ReadonlyArray<string> {
  const edges = reverseEdges.get(nodeId);
  return edges?.map((e) => e.to) ?? [];
}

export function getTransitiveDependents(
  nodeId: string,
  reverseEdges: ReadonlyMap<string, ReadonlyArray<DependencyEdge>>,
): ReadonlyArray<string> {
  const result: Array<string> = [];
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const deps = reverseEdges.get(current);
    if (deps === undefined) continue;

    for (const edge of deps) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        result.push(edge.to);
        queue.push(edge.to);
      }
    }
  }

  return result;
}
