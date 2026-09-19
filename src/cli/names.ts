import { basename } from "node:path";
import { CLI_NAME, LEGACY_CLI_NAMES } from "./constants.js";

export function getInvokedCliName(): string {
  const invoked = basename(process.argv[1] ?? "");
  const cleaned = invoked.endsWith(".js") ? invoked.slice(0, -3) : invoked;
  return cleaned === "" ? CLI_NAME : cleaned;
}

export function isLegacyInvocation(): boolean {
  return LEGACY_CLI_NAMES.includes(getInvokedCliName());
}
