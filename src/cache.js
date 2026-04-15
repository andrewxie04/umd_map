export function boundedCacheSet(cache, key, value, maxEntries = 30) {
  cache.set(key, value);
  if (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}
