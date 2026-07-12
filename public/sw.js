const CACHE_NAME = 'badminton-pwa-v3';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-180.png',
];

function isAppShellAsset(url) {
  return APP_SHELL.includes(url.pathname);
}

function isStaticAssetRequest(request, url) {
  if (request.destination === 'script' || request.destination === 'style' || request.destination === 'worker') {
    return true;
  }

  if (url.pathname.startsWith('/_next/')) {
    return true;
  }

  return /\.(?:js|css|png|jpg|jpeg|svg|webp|avif|ico|woff2?)$/i.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // 개발 환경(localhost)에서는 캐싱 및 네트워크 인터셉트를 하지 않고 바이패스합니다.
  if (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1') {
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  // 인증 API와 페이지 이동은 서비스 워커가 가로채지 않는다.
  // 세션 쿠키와 서버 응답을 항상 브라우저/Next 서버가 직접 처리하도록 한다.
  if (event.request.mode === 'navigate' || url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        if (isAppShellAsset(url)) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone).catch(() => undefined);
          });
        }

        return networkResponse;
      })
      .catch(async () => {
        if (event.request.mode === 'navigate') {
          return caches.match('/') || Response.error();
        }

        if (isStaticAssetRequest(event.request, url)) {
          return caches.match(event.request) || Response.error();
        }

        return Response.error();
      })
  );
});
