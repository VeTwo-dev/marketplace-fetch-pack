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

export const SCREEN_LABELS: Record<ScreenId, string> = {
  splash: "",
  projectDetection: "Project",
  marketplaceConnection: "Connect",
  mainMenu: "Home",
  categorySelection: "Browse",
  resourceList: "Resources",
  resourcePreview: "Preview",
  installConfig: "Configure",
  dependencyPreview: "Deps",
  installProgress: "Install",
  success: "Done",
  search: "Search",
  installed: "Installed",
  doctor: "Doctor",
  settings: "Settings",
  recommended: "Recommended",
  error: "Error",
};

const SCREEN_ORDER: ReadonlyArray<ScreenId> = [
  "splash",
  "projectDetection",
  "marketplaceConnection",
  "mainMenu",
  "categorySelection",
  "resourceList",
  "resourcePreview",
  "installConfig",
  "dependencyPreview",
  "installProgress",
  "success",
  "search",
  "installed",
  "doctor",
  "settings",
  "recommended",
  "error",
];

function isStartupScreen(screen: ScreenId): boolean {
  return (
    screen === "splash" ||
    screen === "projectDetection" ||
    screen === "marketplaceConnection"
  );
}

function isListScreen(screen: ScreenId): boolean {
  return (
    screen === "categorySelection" ||
    screen === "resourceList" ||
    screen === "search" ||
    screen === "installed" ||
    screen === "recommended"
  );
}
