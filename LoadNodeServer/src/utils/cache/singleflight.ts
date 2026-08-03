// Concurrent requests for the same object share one upstream fetch.
// The LRU handles repeats over time; this handles the window before anything
// is cached.

interface Flight<T> {
  promise: Promise<T>;
  startedAt: number;
  waiters: number;
}

class SingleFlight {
  private readonly inFlight = new Map<string, Flight<any>>();
  private joined = 0;
  private started = 0;

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      existing.waiters++;
      this.joined++;
      return existing.promise as Promise<T>;
    }

    this.started++;
    const flight: Flight<T> = {
      startedAt: Date.now(),
      waiters: 1,
      // Clears on failure too, so a rejected fetch is not remembered.
      promise: (async () => fn())().finally(() => {
        this.inFlight.delete(key);
      }),
    };
    this.inFlight.set(key, flight);
    return flight.promise;
  }

  stats() {
    const total = this.started + this.joined;
    return {
      inFlight: this.inFlight.size,
      started: this.started,
      joined: this.joined,
      savedRatio: total > 0 ? this.joined / total : 0,
    };
  }
}

let singleton: SingleFlight | null = null;

export function getSingleFlight(): SingleFlight {
  if (!singleton) singleton = new SingleFlight();
  return singleton;
}

// Callers must key on the object only, never on who is asking, and must run
// their access check before coalescing.
export function buildFlightKey(backend: 'gh' | 'r2', path: string): string {
  return `${backend}\0${path}`;
}
