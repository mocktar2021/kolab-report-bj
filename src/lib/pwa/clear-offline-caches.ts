/**
 * Removes pages and data the service worker kept for offline reading, so the
 * next person on a shared device cannot open them. The precache (app shell,
 * offline page, static assets) is kept.
 */
export function clearOfflineCaches() {
  if (typeof window === "undefined" || !("caches" in window)) return;
  void caches
    .keys()
    .then((keys) => Promise.all(keys.filter((key) => !key.includes("precache")).map((key) => caches.delete(key))))
    .catch(() => undefined);
}
