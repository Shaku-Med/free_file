import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type MainPlayerSlotState = {
  uniqueId: string | null;
  anchorEl: HTMLElement | null;
  /** Video inset inside the floating mini player (`mini_player_inner_{uniqueId}`). */
  miniAnchorEl: HTMLElement | null;
};

type MainPlayerSlotContextValue = {
  state: MainPlayerSlotState;
  /** Register the in-page slot (`player_inner_{uniqueId}`) or clear when leaving watch / non-HLS. */
  setSlot: (uniqueId: string | null, anchorEl: HTMLElement | null) => void;
  setMiniSlot: (anchorEl: HTMLElement | null) => void;
};

const MainPlayerSlotContext = createContext<MainPlayerSlotContextValue | null>(null);

export function MainPlayerSlotProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MainPlayerSlotState>({
    uniqueId: null,
    anchorEl: null,
    miniAnchorEl: null,
  });

  const setSlot = useCallback((uniqueId: string | null, anchorEl: HTMLElement | null) => {
    setState((prev) => ({ ...prev, uniqueId, anchorEl }));
  }, []);

  const setMiniSlot = useCallback((miniAnchorEl: HTMLElement | null) => {
    setState((prev) => ({ ...prev, miniAnchorEl }));
  }, []);

  const value = useMemo(
    () => ({ state, setSlot, setMiniSlot }),
    [state, setSlot, setMiniSlot],
  );

  return (
    <MainPlayerSlotContext.Provider value={value}>
      {children}
    </MainPlayerSlotContext.Provider>
  );
}

export function useMainPlayerSlot(): MainPlayerSlotContextValue {
  const ctx = useContext(MainPlayerSlotContext);
  if (!ctx) {
    throw new Error("useMainPlayerSlot must be used within MainPlayerSlotProvider");
  }
  return ctx;
}
