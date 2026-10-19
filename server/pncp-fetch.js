const DEFAULT_MIN_INTERVAL_MS = 1000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;

function retryAfterMs(response, now) {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export function createPncpFetch({
  fetchImpl = fetch,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  rateLimitCooldownMs = DEFAULT_RATE_LIMIT_COOLDOWN_MS,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  let queue = Promise.resolve();
  let lastRequestAt = 0;
  let blockedUntil = 0;
  const inFlight = new Map();
  const cache = new Map();

  return function pncpFetch(url, options) {
    const key = String(url);
    const currentTime = now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > currentTime) return Promise.resolve(cached.response.clone());
    if (cached) cache.delete(key);
    const existing = inFlight.get(key);
    if (existing) return existing.then(response => response.clone());

    const result = queue.then(async () => {
      const currentTime = now();
      if (blockedUntil > currentTime) {
        return new Response(null, {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((blockedUntil - currentTime) / 1000)) }
        });
      }

      const delay = lastRequestAt + minIntervalMs - currentTime;
      if (delay > 0) await sleep(delay);

      lastRequestAt = now();
      const response = await fetchImpl(url, options);
      if (response.status === 429) {
        const retryMs = retryAfterMs(response, now()) ?? rateLimitCooldownMs;
        blockedUntil = Math.max(blockedUntil, now() + retryMs);
      } else if (response.ok && cacheTtlMs > 0) {
        for (const [cachedKey, entry] of cache) {
          if (entry.expiresAt <= now()) cache.delete(cachedKey);
        }
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        cache.set(key, { expiresAt: now() + cacheTtlMs, response: response.clone() });
      }
      return response;
    });
    queue = result.then(() => undefined, () => undefined);
    inFlight.set(key, result);
    result.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key)
    );
    return result;
  };
}
