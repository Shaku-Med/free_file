import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Where the single global HLS surface is docked. */
export type GlobalPlayerLayout = "idle" | "watch" | "mini";

type Ctx = {
  layout: GlobalPlayerLayout;
  setLayout: (next: GlobalPlayerLayout) => void;
};

const GlobalPlayerLayoutContext = createContext<Ctx | null>(null);

export function GlobalPlayerLayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayoutState] = useState<GlobalPlayerLayout>("idle");
  const setLayout = useCallback((next: GlobalPlayerLayout) => {
    setLayoutState((prev) => (prev === next ? prev : next));
  }, []);
  const value = useMemo(() => ({ layout, setLayout }), [layout, setLayout]);
  return (
    <GlobalPlayerLayoutContext.Provider value={value}>
      {children}
    </GlobalPlayerLayoutContext.Provider>
  );
}

export function useGlobalPlayerLayoutContext(): Ctx {
  const ctx = useContext(GlobalPlayerLayoutContext);
  if (!ctx) {
    throw new Error("useGlobalPlayerLayoutContext must be used within GlobalPlayerLayoutProvider");
  }
  return ctx;
}

export function useGlobalPlayerLayout(): GlobalPlayerLayout {
  return useGlobalPlayerLayoutContext().layout;
}
