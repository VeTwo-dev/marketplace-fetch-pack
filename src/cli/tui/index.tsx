import { render } from "ink";
import { App } from "./App.js";
import type { Marketplace } from "../../marketplace/index.js";

export function launchTUI(marketplace: Marketplace, debug = false): void {
  const { waitUntilExit } = render(
    <App marketplace={marketplace} debug={debug} />,
  );
  void waitUntilExit();
}
