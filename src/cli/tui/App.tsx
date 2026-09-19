import { useReducer, useRef, useMemo } from "react";
import { Box, useApp, useInput } from "ink";
import { ThemeProvider } from "@inkjs/ui";
import { wizardReducer, INITIAL_WIZARD_DATA } from "./state.js";
import { TUI_THEME } from "./theme.js";
import { WizardContext, type WizardContextValue } from "./context.js";
import { createNavigationController, type ScreenId } from "./core/NavigationController.js";
import { getActiveHandler, getKeybindings } from "./core/KeyboardRouter.js";
import { loadTheme } from "./core/ThemeEngine.js";
import { initSound, configureSound, isSoundEnabled, playSound } from "./core/SoundEngine.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { Header } from "./components/common/Header.js";
import { Footer } from "./components/common/Footer.js";
import { ToastContainer } from "./components/common/Toast.js";
import { createMarketplaceHook } from "./hooks/useMarketplace.js";
import { Splash } from "./screens/Splash.js";
import { ProjectDetection } from "./screens/ProjectDetection.js";
import { MarketplaceConnection } from "./screens/MarketplaceConnection.js";
import { MainMenu } from "./screens/MainMenu.js";
import { CategorySelection } from "./screens/CategorySelection.js";
import { ResourceListScreen } from "./screens/ResourceListScreen.js";
import { ResourcePreview } from "./screens/ResourcePreview.js";
import { InstallConfigScreen } from "./screens/InstallConfig.js";
import { DependencyPreviewScreen } from "./screens/DependencyPreview.js";
import { InstallProgressScreen } from "./screens/InstallProgressScreen.js";
import { SuccessScreen } from "./screens/SuccessScreen.js";
import { SearchScreen } from "./screens/SearchScreen.js";
import { InstalledScreen } from "./screens/InstalledScreen.js";
import { DoctorScreen } from "./screens/DoctorScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { RecommendedScreen } from "./screens/RecommendedScreen.js";
import { ErrorScreen } from "./screens/ErrorScreen.js";
import type { ReactNode } from "react";
import type { Marketplace } from "../../marketplace/index.js";

const SCREEN_COMPONENTS: Record<ScreenId, React.FC> = {
  splash: Splash,
  projectDetection: ProjectDetection,
  marketplaceConnection: MarketplaceConnection,
  mainMenu: MainMenu,
  categorySelection: CategorySelection,
  resourceList: ResourceListScreen,
  resourcePreview: ResourcePreview,
  installConfig: InstallConfigScreen,
  dependencyPreview: DependencyPreviewScreen,
  installProgress: InstallProgressScreen,
  success: SuccessScreen,
  search: SearchScreen,
  installed: InstalledScreen,
  doctor: DoctorScreen,
  settings: SettingsScreen,
  recommended: RecommendedScreen,
  error: ErrorScreen,
};

interface AppProps {
  readonly marketplace: Marketplace;
  readonly debug?: boolean;
}

// Initialize engines on first import
loadTheme("default");
initSound(false);

export function App({ marketplace }: AppProps): ReactNode {
  const [data, dispatch] = useReducer(wizardReducer, INITIAL_WIZARD_DATA);
  const { exit } = useApp();

  const navRef = useRef(createNavigationController("splash"));
  const hookRef = useRef(createMarketplaceHook(marketplace));
  const hook = hookRef.current;
  const stateRef = useRef(data);
  stateRef.current = data;

  const [, forceUpdate] = useReducer((v: number) => v + 1, 0);

  const nav = useMemo<WizardContextValue["navigate"]>(
    () => ({
      push: (screen, screenData) => {
        navRef.current.push(screen, screenData);
        forceUpdate();
      },
      pop: () => {
        navRef.current.pop();
        forceUpdate();
      },
      goto: (screen, screenData) => {
        navRef.current.goto(screen, screenData);
        forceUpdate();
      },
      home: () => {
        navRef.current.home();
        forceUpdate();
      },
      canGoBack: () => navRef.current.canGoBack(),
    }),
    [],
  );

  const currentScreen = navRef.current.current().screen;

  const ctxValue = useMemo<WizardContextValue>(
    () => ({
      screen: currentScreen,
      data: stateRef.current,
      dispatch,
      navigate: nav,
      hook,
    }),
    [currentScreen, forceUpdate, hook],
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (input === "~") {
      configureSound({ enabled: !isSoundEnabled() });
      playSound(isSoundEnabled() ? "select" : "navigate");
      return;
    }
    const screenId = navRef.current.current().screen;
    const handler = getActiveHandler(screenId);
    handler?.(input, key);
  });

  const hints = getKeybindings(currentScreen) ?? "";
  const categoryName = data.selectedCategory?.name ?? null;

  return (
    <ErrorBoundary>
      <ThemeProvider theme={TUI_THEME}>
        <WizardContext.Provider value={ctxValue}>
          <Box width="100%" flexDirection="column" minHeight="100%">
            <Header
              screen={currentScreen}
              categoryName={categoryName}
            />
            <Box flexGrow={1} flexDirection="column">
              {(() => {
                const Component = SCREEN_COMPONENTS[currentScreen];
                return <Component key={currentScreen} />;
              })()}
            </Box>
            {hints !== "" && <Footer hints={hints} />}
            <ToastContainer />
          </Box>
        </WizardContext.Provider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
