/**
 * Expiry with jitter.
 *
 * THE PROBLEM. Entries written together expire together. A deploy that changes the co-pilot's code
 * starts an empty cache; a room of people then asks the same few questions within a minute, and a
 * day later every one of those answers expires within the same minute. The next visitors all miss
 * at once and each pays for a model call: a small "stampede".
 *
 * THE FIX. Each write picks its own expiry: the base time plus or minus up to 10%, chosen at random
 * for that write. A day becomes somewhere between 21.6 and 26.4 hours, so entries written in the
 * same minute expire across almost five hours.
 *
 * Only cache entries get this. A rate limit's window and the circuit breaker's times mean
 * something exact (6 a minute is 6 a minute), so they keep their own times.
 */
export const JITTER = 0.1

/** `baseSeconds` plus or minus up to 10%, as whole seconds, never under 1. `random` gives a number in [0, 1). */
export function jitteredSeconds(baseSeconds: number, random: () => number = Math.random): number {
  const factor = 1 - JITTER + 2 * JITTER * random()
  return Math.max(1, Math.round(baseSeconds * factor))
}
