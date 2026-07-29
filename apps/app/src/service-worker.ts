/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ revision?: string; url: string }>;
};

const cacheName = 'dusori-shell-v1';

// The app shell, addressed the way this worker will look it up later.
const shellUrl = new URL('./', self.location.href).href;

// Manifest URLs are relative to the build output, where the shell arrives as "/". Resolved against
// a worker living at /Dusori/app/ that is the *server* root — on Pages, the marketing site — so the
// shell was precached under a URL no app navigation ever asks for. Anchor every entry to the scope.
const precache = [
  ...new Set([
    shellUrl,
    ...self.__WB_MANIFEST.map(
      (entry) => new URL(entry.url.replace(/^\//u, './'), self.location.href).href,
    ),
  ]),
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(precache)));
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          // Every navigation returns the same shell, and the app writes ?topic= and ?view= into the
          // URL itself. Keying on the request would store one copy per view and leave the reader's
          // actual URL unmatched, so the shell is stored — and looked up — under one key.
          void caches.open(cacheName).then((cache) => cache.put(shellUrl, copy));
          return response;
        })
        .catch(
          async () =>
            (await caches.match(request, { ignoreSearch: true })) ??
            (await caches.match(shellUrl))!,
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && /\.[a-f0-9]{8,}\.(?:css|js|woff2)$/u.test(url.pathname)) {
        const copy = response.clone();
        void caches.open(cacheName).then((cache) => cache.put(request, copy));
      }
      return response;
    }),
  );
});
