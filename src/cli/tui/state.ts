import type {
  RegistryResource,
  RegistryCategory,
} from "../../types/registry.js";
import type { DetectedProject } from "../../types/detection.js";

export interface WizardData {
  readonly detectedProject: DetectedProject | null;
  readonly categories: ReadonlyArray<RegistryCategory>;
  readonly resources: ReadonlyArray<RegistryResource>;
  readonly selectedCategory: RegistryCategory | null;
  readonly selectedResource: RegistryResource | null;
  readonly searchQuery: string;
  readonly searchResults: ReadonlyArray<RegistryResource>;
  readonly installConfig: InstallConfig;
  readonly installResult: InstallResult | null;
  readonly registryStatus: "loading" | "ready" | "error";
  readonly doctorReport: DoctorReport | null;
}

export interface InstallConfig {
  readonly destination: string;
  readonly overwrite: boolean;
  readonly optionalDeps: boolean;
  readonly dryRun: boolean;
}

interface InstallResult {
  readonly success: boolean;
  readonly message: string;
  readonly filesInstalled: number;
  readonly dependenciesInstalled: number;
  readonly duration: number;
}

interface DoctorReport {
  readonly system: CheckResult[];
  readonly github: CheckResult[];
  readonly cache: CheckResult[];
  readonly node: CheckResult[];
  readonly registry: CheckResult[];
  readonly network: CheckResult[];
}

interface CheckResult {
  readonly name: string;
  readonly status: "pass" | "warn" | "fail" | "skip";
  readonly message: string;
}

export type WizardAction =
  | { type: "SET_PROJECT"; project: DetectedProject | null }
  | { type: "SET_CATEGORIES"; categories: ReadonlyArray<RegistryCategory> }
  | { type: "SET_RESOURCES"; resources: ReadonlyArray<RegistryResource> }
  | {
      type: "BATCH_SET_DATA";
      categories: ReadonlyArray<RegistryCategory>;
      resources: ReadonlyArray<RegistryResource>;
      project: DetectedProject | null;
    }
  | { type: "SELECT_CATEGORY"; category: RegistryCategory | null }
  | { type: "SELECT_RESOURCE"; resource: RegistryResource | null }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "SET_SEARCH_RESULTS"; results: ReadonlyArray<RegistryResource> }
  | { type: "SET_INSTALL_CONFIG"; config: Partial<InstallConfig> }
  | { type: "SET_INSTALL_RESULT"; result: InstallResult | null }
  | { type: "SET_REGISTRY_STATUS"; status: "loading" | "ready" | "error" }
  | { type: "SET_DOCTOR_REPORT"; report: DoctorReport | null }
  | { type: "RESET_INSTALL" };

export const DEFAULT_INSTALL_CONFIG: InstallConfig = {
  destination: "./node_modules",
  overwrite: false,
  optionalDeps: true,
  dryRun: false,
};

export const INITIAL_WIZARD_DATA: WizardData = {
  detectedProject: null,
  categories: [],
  resources: [],
  selectedCategory: null,
  selectedResource: null,
  searchQuery: "",
  searchResults: [],
  installConfig: DEFAULT_INSTALL_CONFIG,
  installResult: null,
  registryStatus: "loading",
  doctorReport: null,
};

export function filterByCategory(
  resources: ReadonlyArray<RegistryResource>,
  categoryId: string,
): ReadonlyArray<RegistryResource> {
  return resources.filter((r) => r.category === categoryId);
}

export function filterByQuery(
  resources: ReadonlyArray<RegistryResource>,
  query: string,
): ReadonlyArray<RegistryResource> {
  if (query === "") return resources;
  const lower = query.toLowerCase();
  return resources.filter(
    (r) =>
      r.name.toLowerCase().includes(lower) ||
      r.displayName.toLowerCase().includes(lower) ||
      r.description.toLowerCase().includes(lower) ||
      r.tags.some((t) => t.toLowerCase().includes(lower)),
  );
}

export function wizardReducer(
  state: WizardData,
  action: WizardAction,
): WizardData {
  switch (action.type) {
    case "SET_PROJECT":
      if (state.detectedProject === action.project) return state;
      return { ...state, detectedProject: action.project };

    case "SET_CATEGORIES":
      return { ...state, categories: action.categories };

    case "SET_RESOURCES":
      return { ...state, resources: action.resources };

    case "BATCH_SET_DATA":
      return {
        ...state,
        categories: action.categories,
        resources: action.resources,
        detectedProject: action.project,
        registryStatus: "ready",
      };

    case "SELECT_CATEGORY":
      if (state.selectedCategory === action.category) return state;
      return { ...state, selectedCategory: action.category };

    case "SELECT_RESOURCE":
      if (state.selectedResource === action.resource) return state;
      return { ...state, selectedResource: action.resource };

    case "SET_SEARCH_QUERY":
      if (state.searchQuery === action.query) return state;
      return { ...state, searchQuery: action.query };

    case "SET_SEARCH_RESULTS":
      return { ...state, searchResults: action.results };

    case "SET_INSTALL_CONFIG":
      return {
        ...state,
        installConfig: { ...state.installConfig, ...action.config },
      };

    case "SET_INSTALL_RESULT":
      return { ...state, installResult: action.result };

    case "SET_REGISTRY_STATUS":
      if (state.registryStatus === action.status) return state;
      return { ...state, registryStatus: action.status };

    case "SET_DOCTOR_REPORT":
      return { ...state, doctorReport: action.report };

    case "RESET_INSTALL":
      return {
        ...state,
        installConfig: DEFAULT_INSTALL_CONFIG,
        installResult: null,
      };

    default:
      return state;
  }
}
