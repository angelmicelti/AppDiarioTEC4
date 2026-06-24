// Service Worker — TEC4 Diario de Clase (PWA)
// Estrategia:
// 1. Precache del app shell (HTML, manifest, icons) en install
// 2. Runtime cache para CDN (Tailwind, Firebase, fuentes) con stale-while-revalidate
// 3. Network-first para el HTML principal (para obtener actualizaciones), fallback a cache
// 4. Cache-first para imágenes e icons

const CACHE_VERSION = 'tec4-diario-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Archivos locales del app shell (siempre se cachean en install)
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './favicon.png'
];

// Patrones de URL externas que se cachean en runtime (CDNs)
const RUNTIME_PATTERNS = [
  /https:\/\/cdn\.tailwindcss\.com/,
  /https:\/\/fonts\.googleapis\.com/,
  /https:\/\/fonts\.gstatic\.com/,
  /https:\/\/cdn\.jsdelivr\.net/,
  /https:\/\/www\.gstatic\.com/,
  /https:\/\/www\.googletagmanager\.com/
];

// === INSTALL: precachear el app shell ===
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(SHELL_FILES).catch((err) => {
        console.warn('[SW] Algunos archivos del shell no se pudieron cachear:', err);
      });
    })
  );
  self.skipWaiting(); // activar inmediatamente
});

// === ACTIVATE: limpiar caches antiguos ===
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim(); // tomar control inmediatamente
});

// === FETCH: estrategia según el tipo de recurso ===
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo gestionar GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Si es una petición a Firebase Realtime Database (wss:// o https://*.firebaseio.com)
  // → dejar pasar sin cachear (datos en tiempo real)
  if (url.hostname.includes('firebaseio.com') || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // Recursos locales (mismo origen) → network-first con fallback a cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Cachear la respuesta fresca
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => {
          // Sin red → servir desde cache
          return caches.match(req).then((cached) => {
            if (cached) return cached;
            // Si es navegación y no hay cache, servir index.html cacheado
            if (req.mode === 'navigate') {
              return caches.match('./index.html');
            }
            return new Response('Sin conexión', { status: 503, statusText: 'Offline' });
          });
        })
    );
    return;
  }

  // Recursos de CDN (Tailwind, Firebase SDK, fuentes) → stale-while-revalidate
  if (RUNTIME_PATTERNS.some((pattern) => pattern.test(url.href))) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) => {
        return cache.match(req).then((cached) => {
          const fetchPromise = fetch(req)
            .then((res) => {
              // Solo cachear respuestas válidas
              if (res && res.status === 200) {
                cache.put(req, res.clone());
              }
              return res;
            })
            .catch(() => cached); // si falla la red, usar cache
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // Resto de peticiones → probar red, fallback a cache
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

// === MESSAGE: permitir forzar actualización del SW ===
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
