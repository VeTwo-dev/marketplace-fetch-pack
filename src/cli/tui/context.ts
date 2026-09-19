import { createContext, useContext } from "react";
import type { ScreenId } from "./core/NavigationController.js";
import type { WizardData, WizardAction } from "./state.js";
import type { MarketplaceHook } from "./hooks/useMarketplace.js";

export interface WizardContextValue {
  readonly screen: ScreenId;
  readonly data: WizardData;
  readonly dispatch: (action: WizardAction) => void;
  readonly navigate: {
    readonly push: (screen: ScreenId, data?: Record<string, unknown>) => void;
    readonly pop: () => void;
    readonly goto: (screen: ScreenId, data?: Record<string, unknown>) => void;
    readonly home: () => void;
    readonly canGoBack: () => boolean;
  };
  readonly hook: MarketplaceHook;
}

export const WizardContext = createContext<WizardContextValue | null>(null);

export function useWizardContext(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (ctx === null) {
    throw new Error("useWizardContext must be used within WizardProvider");
  }
  return ctx;
}

function useWizardData(): WizardData {
  return useWizardContext().data;
}

function useWizardDispatch(): (action: WizardAction) => void {
  return useWizardContext().dispatch;
}

function useNavigate(): WizardContextValue["navigate"] {
  return useWizardContext().navigate;
}

function useScreenId(): ScreenId {
  return useWizardContext().screen;
}

function useHook(): MarketplaceHook {
  return useWizardContext().hook;
}
