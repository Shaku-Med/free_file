/** Everything Ask may tell a viewer when it can't answer. The panel shows nothing else. */
export const ASK_MESSAGES = {
  unavailable: 'Ask is not available right now.',
  signIn: 'Sign in to ask about videos.',
  notAskable: "This video can't be asked about.",
  busy: 'Lots of people are asking right now.',
  later: 'Ask is busy for a while. Try again later.',
  oneAtATime: 'Wait for the answer you asked for to finish first.',
  tooFast: 'You are asking too fast. Try again in a few minutes.',
  dailyCap: "You've asked a lot today. Try again later.",
} as const;

const shown = new Set<string>(Object.values(ASK_MESSAGES));

/** A message safe to show, or null for anything else, like a raw error. */
export const askMessage = (value: unknown): string | null =>
  typeof value === 'string' && shown.has(value) ? value : null;
