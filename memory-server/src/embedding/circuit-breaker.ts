/**
 * S81-D01: Circuit breaker with cooldown.
 *
 * Tracks consecutive failures per provider and, once the threshold is
 * crossed, parks the provider in a cooldown window so embedding requests
 * are routed elsewhere without hammering the failing endpoint.
 *
 * State machine:
 *   closed   — requests are attempted; failures increment the counter.
 *   open     — requests are skipped; returns immediately until cooldown
 *              elapses. After the cooldown passes the breaker enters
 *              half-open automatically on the next request.
 *   half-open — a single probe is permitted. Success closes the breaker;
 *               failure re-opens it and resets the cooldown.
 *
 * Defaults match the §81 plan: 3 failures → 60s cooldown → 1 probe.
 * The breaker is deterministic thanks to an injectable `now()` clock so
 * tests can fast-forward without wall-clock sleeps.
 */

export type BreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive failures required to open the breaker. Default: 3. */
  failureThreshold?: number;
  /** Cooldown duration once open, in ms. Default: 60_000 (60s). */
  cooldownMs?: number;
  /** Clock hook for deterministic tests. Default: Date.now. */
  now?: () => number;
}

export interface CircuitBreakerStatus {
  state: BreakerState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  openedAt: number | null;
  nextProbeAt: number | null;
}

export interface CircuitBreaker {
  /** Returns true if the next call should be skipped (breaker open). */
  shouldSkip(): boolean;
  /** Returns true if a probe is permitted (half-open). */
  allowProbe(): boolean;
  /** Record a successful call. Closes the breaker if open/half-open. */
  recordSuccess(): void;
  /** Record a failure. Increments counter and opens if threshold crossed. */
  recordFailure(reason?: string): void;
  /** Current state snapshot. */
  status(): CircuitBreakerStatus;
  /** Reset breaker to closed. Mostly for tests. */
  reset(): void;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 60_000;

export function createCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreaker {
  const failureThreshold = Math.max(1, options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD);
  const cooldownMs = Math.max(0, options.cooldownMs ?? DEFAULT_COOLDOWN_MS);
  const now = options.now ?? (() => Date.now());

  let state: BreakerState = "closed";
  let consecutiveFailures = 0;
  let lastFailureAt: number | null = null;
  let openedAt: number | null = null;
  // When half-open, we must let exactly one probe through. This flag guards
  // against concurrent probes inside the same half-open window.
  let probeInFlight = false;

  const nextProbeAt = (): number | null => {
    if (state !== "open" || openedAt === null) return null;
    return openedAt + cooldownMs;
  };

  const tryTransitionToHalfOpen = (): void => {
    if (state !== "open" || openedAt === null) return;
    if (now() >= openedAt + cooldownMs) {
      state = "half-open";
      probeInFlight = false;
    }
  };

  return {
    shouldSkip(): boolean {
      tryTransitionToHalfOpen();
      if (state === "closed") return false;
      if (state === "half-open" && !probeInFlight) return false;
      return true;
    },

    allowProbe(): boolean {
      tryTransitionToHalfOpen();
      if (state !== "half-open") return false;
      if (probeInFlight) return false;
      probeInFlight = true;
      return true;
    },

    recordSuccess(): void {
      consecutiveFailures = 0;
      state = "closed";
      openedAt = null;
      probeInFlight = false;
    },

    recordFailure(_reason?: string): void {
      lastFailureAt = now();
      consecutiveFailures += 1;
      probeInFlight = false;
      if (state === "half-open") {
        // Probe failed → re-open with fresh cooldown.
        state = "open";
        openedAt = now();
        return;
      }
      if (consecutiveFailures >= failureThreshold) {
        state = "open";
        openedAt = now();
      }
    },

    status(): CircuitBreakerStatus {
      tryTransitionToHalfOpen();
      return {
        state,
        consecutiveFailures,
        lastFailureAt,
        openedAt,
        nextProbeAt: nextProbeAt(),
      };
    },

    reset(): void {
      state = "closed";
      consecutiveFailures = 0;
      lastFailureAt = null;
      openedAt = null;
      probeInFlight = false;
    },
  };
}
