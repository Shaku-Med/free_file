import type { DynamicHLSPlayerWithQueueProps } from "~/routes/Dynamic/components/DynamicHLSPlayerWithQueue";

/** Payload published by the Dynamic watch route for the root-anchored HLS instance. */
export type WatchPageHlsSurfacePayload = {
  props: DynamicHLSPlayerWithQueueProps;
  theaterMode: boolean;
} | null;
