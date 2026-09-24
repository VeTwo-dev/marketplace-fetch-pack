export type ScreenId =
  | "splash"
  | "projectDetection"
  | "marketplaceConnection"
  | "mainMenu"
  | "categorySelection"
  | "resourceList"
  | "resourcePreview"
  | "installConfig"
  | "dependencyPreview"
  | "installProgress"
  | "success"
  | "search"
  | "installed"
  | "doctor"
  | "settings"
  | "recommended"
  | "error";

export interface NavigationEntry {
  readonly screen: ScreenId;
  readonly data?: Record<string, unknown>;
}

interface NavigationState {
  readonly stack: ReadonlyArray<NavigationEntry>;
}

export function createNavigationController(initial: ScreenId = "splash") {
  const stack: NavigationEntry[] = [{ screen: initial }];

  function push(screen: ScreenId, data?: Record<string, unknown>): void {
    stack.push({ screen, data });
  }

  function pop(): void {
    if (stack.length > 1) {
      stack.pop();
    }
  }

  function goto(screen: ScreenId, data?: Record<string, unknown>): void {
    if (stack.length > 0) {
      stack[stack.length - 1] = { screen, data };
    } else {
      stack.push({ screen, data });
    }
  }

  function home(): void {
    stack.length = 0;
    stack.push({ screen: "mainMenu" });
  }

  function current(): NavigationEntry {
    return stack[stack.length - 1]!;
  }

  function canGoBack(): boolean {
    return stack.length > 1;
  }

  function getStack(): ReadonlyArray<NavigationEntry> {
    return [...stack];
  }

  return { push, pop, goto, home, current, canGoBack, getStack };
}

type NavigationController = ReturnType<typeof createNavigationController>;
