/** Home-style feed cards: ⋮ menu beside title, no like/dislike/comment row. */
export const FEED_HIDE_ACTIONS = { completely: false, halfway: true } as const;

/**
 * The column rhythm every video grid in the app uses: home, subscriptions,
 * saved. Kept in one place so a card never ends up twice the size of the
 * same card on the next page over.
 *
 * YouTube's sizing, from the grid's own width rather than the window's so it
 * is right beside an open sidebar too: 16px between columns, 32px between
 * rows, cards at least 20rem. One column below ~656px, two below ~992px, then
 * three, which YouTube keeps up to a 1080p screen. The second minimum is a
 * hair over a quarter of the row (25% less 11px of the gaps), so a fourth
 * column cannot fit until cards would be 32rem, at about 2100px.
 */
export const MEDIA_GRID =
  "grid w-full min-w-0 grid-cols-[repeat(auto-fill,minmax(max(min(100%,20rem),min(25%_-_0.6875rem,32rem)),1fr))] gap-x-4 gap-y-8";
