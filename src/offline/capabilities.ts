export type OfflineCapability =
  | "search"
  | "info"
  | "preview"
  | "dependency-resolution"
  | "install-cached"
  | "install-uncached"
  | "registry-refresh"
  | "remote-update-check"
  | "doctor-network-check";

export interface CapabilityCheck {
  readonly operation: OfflineCapability;
  readonly offlinePossible: boolean;
  readonly reason?: string;
}

const CAPABILITY_MAP: Record<OfflineCapability, CapabilityCheck> = {
  search: { operation: "search", offlinePossible: true },
  info: { operation: "info", offlinePossible: true },
  preview: { operation: "preview", offlinePossible: true },
  "dependency-resolution": {
    operation: "dependency-resolution",
    offlinePossible: true,
  },
  "install-cached": { operation: "install-cached", offlinePossible: true },
  "install-uncached": {
    operation: "install-uncached",
    offlinePossible: false,
    reason: "Missing cached artifact",
  },
  "registry-refresh": {
    operation: "registry-refresh",
    offlinePossible: false,
    reason: "Requires network registry",
  },
  "remote-update-check": {
    operation: "remote-update-check",
    offlinePossible: false,
    reason: "Requires remote update check",
  },
  "doctor-network-check": {
    operation: "doctor-network-check",
    offlinePossible: false,
    reason: "Network check skipped offline",
  },
};

export function checkOfflineCapability(op: OfflineCapability): CapabilityCheck {
  return CAPABILITY_MAP[op];
}

export function isOfflineCapable(op: OfflineCapability): boolean {
  return CAPABILITY_MAP[op]?.offlinePossible ?? false;
}

class OfflineCapabilityError extends Error {
  constructor(
    public readonly operation: OfflineCapability,
    public readonly reason: string,
  ) {
    super(`Offline capability failure: ${operation} — ${reason}`);
    this.name = "OfflineCapabilityError";
  }
}
