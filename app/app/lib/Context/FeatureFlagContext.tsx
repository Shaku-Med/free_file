import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { FeatureFlags } from "~/lib/Services/featureFlags.server";

/**
 * Resolved flags for the current viewer, handed down from the root loader.
 *
 * Only the keys that are ON reach the client. The rollout percentage, the
 * audience rule and the flags that are off all stay on the server: shipping
 * them would tell anyone reading the page source which unreleased features
 * exist and exactly how to look enrolled in one.
 */

const FeatureFlagContext = createContext<FeatureFlags>({});

export function FeatureFlagProvider({
  flags,
  children,
}: {
  flags: FeatureFlags | null | undefined;
  children: ReactNode;
}) {
  const value = useMemo(() => flags ?? {}, [flags]);
  return <FeatureFlagContext.Provider value={value}>{children}</FeatureFlagContext.Provider>;
}

/**
 * Is this feature on for this viewer?
 *
 * Unknown keys are false, so deleting a row turns the feature off everywhere
 * rather than throwing, and a typo fails to the safe path instead of enabling
 * something by accident.
 */
export function useFeatureFlag(key: string): boolean {
  return useContext(FeatureFlagContext)[key] === true;
}

/** All enabled flags, for the rare case something needs to branch on several. */
export function useFeatureFlags(): FeatureFlags {
  return useContext(FeatureFlagContext);
}
