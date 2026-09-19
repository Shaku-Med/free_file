/** Home-style feed cards: ⋮ menu beside title, no like/dislike/comment row. */
export const FEED_HIDE_ACTIONS = { completely: false, halfway: true } as const;

/**
 * The column rhythm every video grid in the app uses: home, subscriptions,
 * playlists. Kept in one place so a card never ends up twice the size of the
 * same card on the next page over.
 */
export const MEDIA_GRID =
  "grid w-full min-w-0 grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 sm:gap-y-8 lg:grid-cols-3 lg:gap-y-10 xl:grid-cols-4 2xl:grid-cols-5";
