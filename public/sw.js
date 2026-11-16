/* LAZCAKONGYM - Progressive Web App Service Worker */
/* Version: v6.3.5 - Smartwatch Haptic Vibration & Offline Deferred Sync */
const CACHE_NAME = 'lazcakongym-v6.3.6-library669-offline';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/manifest.webmanifest',
  '/pwa-192x192.png?v=2',
  '/pwa-512x512.png?v=2',
  '/pwa-maskable-512x512.png?v=2',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/icon.svg',
];

// Active Service Worker Rest Timer State (survives phone screen lock via event.waitUntil)
let swRestInterval = null;
let swFiveSecTimeout = null;
let swCompleteTimeout = null;
let swResolveWaitUntil = null;
let lastFiveSecTargetFired = 0;
let lastCompleteTargetFired = 0;

function clearSwRestTimers() {
  if (swRestInterval) {
    clearInterval(swRestInterval);
    swRestInterval = null;
  }
  if (swFiveSecTimeout) {
    clearTimeout(swFiveSecTimeout);
    swFiveSecTimeout = null;
  }
  if (swCompleteTimeout) {
    clearTimeout(swCompleteTimeout);
    swCompleteTimeout = null;
  }
  if (swResolveWaitUntil) {
    swResolveWaitUntil();
    swResolveWaitUntil = null;
  }
}

async function clearPreviousRestNotifications() {
  try {
    if (self.registration && self.registration.getNotifications) {
      const list = await self.registration.getNotifications();
      for (const n of list) {
        if (n.tag && n.tag.startsWith('lazcakon-rest-')) {
          n.close();
        }
      }
    }
  } catch (e) {}
}

async function fireSwFiveSecNotification(targetEndTime, exerciseName) {
  if (lastFiveSecTargetFired === targetEndTime) return;
  lastFiveSecTargetFired = targetEndTime;

  await clearPreviousRestNotifications();

  const title = '⚡ ¡Quedan 5 segundos de descanso!';
  const body = exerciseName
    ? `Prepárate para tu siguiente serie en ${exerciseName}.`
    : 'Prepárate para iniciar tu siguiente serie.';

  try {
    await self.registration.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: `lazcakon-rest-5s-${targetEndTime}`,
      vibrate: [400, 120, 400, 120, 400],
      renotify: true,
      requireInteraction: true,
      silent: false,
      timestamp: Date.now(),
      data: { url: '/', time: Date.now(), type: 'countdown-5s' },
    });
  } catch (err) {
    console.warn('[SW] Error showing 5s notification:', err);
  }
}

async function fireSwCompleteNotification(targetEndTime, exerciseName) {
  if (lastCompleteTargetFired === targetEndTime) return;
  lastCompleteTargetFired = targetEndTime;

  await clearPreviousRestNotifications();

  const title = '⏱️ ¡DESCANSO COMPLETADO! 🔥';
  const body = exerciseName
    ? `Fin de recuperación en ${exerciseName}. ¡A por la siguiente serie!`
    : '¡Tiempo de recuperación finalizado! Vuelve a la barra.';

  try {
    await self.registration.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: `lazcakon-rest-done-${targetEndTime}`,
      vibrate: [400, 120, 400, 120, 400],
      renotify: true,
      requireInteraction: true,
      silent: false,
      timestamp: Date.now(),
      data: { url: '/', time: Date.now(), type: 'rest-complete' },
    });
  } catch (err) {
    console.warn('[SW] Error showing complete notification:', err);
  }
}

// Install Event - Precache app shell and activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[LAZCAKONGYM SW] Pre-caching non-fatal warning:', err);
      });
    })
  );
});

// Activate Event - Clean up ANY old caches, claim clients, and auto-navigate clients to new version
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cache) => {
            if (cache !== CACHE_NAME) {
              console.log('[LAZCAKONGYM SW] Eliminando caché obsoleta:', cache);
              return caches.delete(cache);
            }
          })
        );
      })
      .then(() => self.clients.claim())
      .then(async () => {
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
          client.postMessage({ type: 'SW_ACTIVATED', version: 'v6.1.0' });
        }
      })
  );
});

// Message Listener - Handles background rest alarms & cache commands
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((cacheNames) => {
      return Promise.all(cacheNames.map((name) => caches.delete(name)));
    });
    return;
  }

  if (event.data.type === 'CANCEL_REST_ALARM') {
    clearSwRestTimers();
    clearPreviousRestNotifications();
    return;
  }

  if (event.data.type === 'SCHEDULE_REST_ALARM') {
    const targetEndTime = Number(event.data.targetEndTime);
    const exerciseName = event.data.exerciseName || '';
    if (!targetEndTime || targetEndTime <= Date.now()) return;

    clearSwRestTimers();

    // Keep Service Worker awake while rest timer is counting down (even when phone is locked)
    const keepAlivePromise = new Promise((resolve) => {
      swResolveWaitUntil = resolve;
      const now = Date.now();
      const totalMs = targetEndTime - now;
      const msUntilFiveSec = totalMs - 5000;

      // Exact timeout for 5-second warning
      if (msUntilFiveSec > 0) {
        swFiveSecTimeout = setTimeout(() => {
          fireSwFiveSecNotification(targetEndTime, exerciseName);
        }, msUntilFiveSec);
      } else if (totalMs > 1500) {
        fireSwFiveSecNotification(targetEndTime, exerciseName);
      }

      // Exact timeout for 0-second rest completion
      swCompleteTimeout = setTimeout(async () => {
        await fireSwCompleteNotification(targetEndTime, exerciseName);
        clearSwRestTimers();
      }, Math.max(0, totalMs));

      // Redundant 400ms hardware clock check in case OS delays setTimeout slightly
      swRestInterval = setInterval(async () => {
        const remainingMs = targetEndTime - Date.now();
        if (remainingMs <= 5300 && remainingMs > 1000) {
          await fireSwFiveSecNotification(targetEndTime, exerciseName);
        }
        if (remainingMs <= 0) {
          await fireSwCompleteNotification(targetEndTime, exerciseName);
          clearSwRestTimers();
        }
      }, 400);
    });

    if (event.waitUntil) {
      event.waitUntil(keepAlivePromise);
    }
  }
});

// Notification Click Event - Focus or open the app when notification is tapped
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});

// Fetch Event - Handle network requests
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Handle cross-origin or API calls with direct network
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // Never cache service worker script or version endpoint
  if (url.pathname === '/sw.js' || url.pathname === '/api/version') {
    return;
  }

  // Handle SPA navigation requests: NETWORK FIRST with Cache Fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const fallback = await caches.match('/index.html');
          if (fallback) return fallback;
          return caches.match('/');
        })
    );
    return;
  }

  // Static Assets: Network-first for JavaScript and CSS bundles to avoid stale code
  const isCodeBundle = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
  if (isCodeBundle) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          throw new Error('Asset not found in network or cache');
        })
    );
    return;
  }

  // Other static assets (images, fonts, icons): Cache-first with background revalidation
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
