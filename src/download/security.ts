import {
  resolveWithinRoot,
  isSafeRelativePath,
  validateRemoteUrl,
  DEFAULT_SECURITY_POLICY,
} from "../security/index.js";
import { MarketplaceClientError } from "../errors/index.js";

/**
 * Download-specific security checks.
 * Reuses the central security policy — no second mechanism.
 */
export function assertSafeDownloadDestination(
  root: string,
  relativePath: string,
): string {
  return resolveWithinRoot(root, relativePath);
}

export function assertSafeDownloadUrl(url: string): void {
  const result = validateRemoteUrl(url, DEFAULT_SECURITY_POLICY);
  if (!result.valid) {
    throw new MarketplaceClientError("DOWNLOAD_FAILED", {
      message: `Blocked unsafe download URL: ${result.reason}`,
      context: { url, reason: result.reason },
    });
  }
}

export function isSafeDownloadPath(p: string): boolean {
  return isSafeRelativePath(p);
}
