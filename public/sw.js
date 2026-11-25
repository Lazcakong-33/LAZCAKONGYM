/* LAZCAKONGYM - Progressive Web App Service Worker */
/* Version: v7.0.0 - OTA & Shell Cache Recovery & MIME Safety */
const CACHE_NAME = 'lazcakongym-v7.0.0-ota';
const EXERCISE_LIB_CACHE_PREFIX = 'lazcakon-exercise-lib-';
const EXERCISE_LIB_CACHE_NAME = 'lazcakon-exercise-lib-v1';
const REST_ACTIVE_NOTIFICATION_TAG = 'lazcakon-rest-active';
const REST_COMPLETE_VIBRATION_PATTERN = [600, 250, 600, 250, 600];
const NOTIFICATION_ICON_PATH = '/notification-icon-192.png';
const NOTIFICATION_BADGE_PATH = '/notification-badge-gorilla.png';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/manifest.webmanifest',
  '/lazcakong-elite-v6-any-192.png',
  '/lazcakong-elite-v6-any-512.png',
  '/lazcakong-elite-v6-maskable-192.png',
  '/lazcakong-elite-v6-maskable-512.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/notification-icon-192.png',
  '/notification-badge-gorilla.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/icon.svg',
];

function isWhitelistedExerciseMediaUrl(url) {
  return (
    url &&
    url.origin === 'https://raw.githubusercontent.com' &&
    url.pathname.includes('/LAZCAKONGYM/') &&
    /\.(webp|png|jpg|jpeg|gif)$/i.test(url.pathname)
  );
}

const handledPushTags = new Set();

function resolveSwNotificationAssetUrl(assetPath) {
  const cleanPath = assetPath.startsWith('/') ? assetPath : '/' + assetPath;
  if (self.location && self.location.origin && /^https?:\/\//i.test(self.location.origin)) {
    try {
      return new URL(cleanPath, self.location.origin).href;
    } catch {
      return self.location.origin.replace(/\/$/, '') + cleanPath;
    }
  }
  return cleanPath;
}

function buildSwRestCompleteBody(exerciseName, nextSetNumber, isTest) {
  if (
    exerciseName &&
    String(exerciseName).trim().length > 0 &&
    typeof nextSetNumber === 'number' &&
    Number.isFinite(nextSetNumber) &&
    nextSetNumber > 0
  ) {
    return `Siguiente serie: ${String(exerciseName).trim()} · Serie ${nextSetNumber}`;
  }
  if (isTest) {
    return 'Prueba push de LazcaKong Gym. Comprueba la recepción en celular y reloj.';
  }
  return 'Descanso finalizado. Continúa tu entrenamiento.';
}

function trimTagSet(set) {
  if (set.size > 40) {
    const first = set.values().next().value;
    if (typeof first === 'string') set.delete(first);
  }
}

async function clearPreviousRestNotifications(specificTag) {
  try {
    if (self.registration && self.registration.getNotifications) {
      const list = await self.registration.getNotifications();
      for (const n of list) {
        if (!n.tag) continue;
        if (specificTag ? n.tag === specificTag : n.tag.startsWith('lazcakon-rest-')) {
          n.close();
        }
      }
    }
  } catch {}
}

async function clearRestCompleteNotificationsOnly(specificTag) {
  try {
    if (self.registration && self.registration.getNotifications) {
      const list = await self.registration.getNotifications();
      for (const n of list) {
        if (!n.tag) continue;
        if (specificTag ? n.tag === specificTag : n.tag.startsWith('lazcakon-rest-done-')) {
          n.close();
        }
      }
    }
  } catch {}
}

async function getWindowClientsState() {
  try {
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    const visible = windowClients.filter((c) => c.visibilityState === 'visible');
    return { windowClients, visible };
  } catch {
    return { windowClients: [], visible: [] };
  }
}

async function handleIncomingWebPush(event) {
  let payload = {};
  try {
    if (event.data) {
      payload = typeof event.data.json === 'function' ? event.data.json() : JSON.parse(event.data.text());
    }
  } catch {
    try {
      const rawText = event.data && typeof event.data.text === 'function' ? event.data.text() : '';
      payload = rawText ? { body: rawText } : {};
    } catch {
      payload = {};
    }
  }

  const restId = payload.restId ? String(payload.restId) : '';
  const targetEndTime = Number(payload.targetEndTime || 0) || 0;
  const receiptTime = Date.now();
  const deltaReceiptMs = targetEndTime ? receiptTime - targetEndTime : 0;
  console.log(
    `[SW Push Receipt Timing] restId: ${restId}, targetEndTime: ${
      targetEndTime ? new Date(targetEndTime).toISOString() : 'N/A'
    }, receiptTime: ${new Date(receiptTime).toISOString()}, deltaReceiptMs: ${deltaReceiptMs}`
  );
  const tag = payload.tag || (restId ? `lazcakon-rest-done-${restId}` : `lazcakon-rest-done-${Date.now()}`);
  const isTest = Boolean(payload.isTest);
  const mode = payload.mode === 'sound' || payload.mode === 'silent' ? payload.mode : 'vibrate_only';
  const vibrationEnabled = payload.vibrationEnabled !== false && mode !== 'silent';

  if (handledPushTags.has(tag)) {
    return;
  }



  const { windowClients, visible } = await getWindowClientsState();

  // Notify open clients so foreground state stays synchronized & deduplicated
  for (const client of windowClients) {
    try {
      client.postMessage({
        type: 'PUSH_REST_ALARM_RECEIVED',
        restId,
        targetEndTime,
        tag,
        isTest,
      });
    } catch {}
  }



  const title = payload.title || 'LAZCAKONG · DESCANSO TERMINADO';
  const body =
    payload.body ||
    buildSwRestCompleteBody(payload.exerciseName, payload.nextSetNumber, isTest);
  const icon = payload.icon || resolveSwNotificationAssetUrl(NOTIFICATION_ICON_PATH);
  const badge = payload.badge || resolveSwNotificationAssetUrl(NOTIFICATION_BADGE_PATH);
  const isSilent = mode === 'silent' || payload.silent === true;

  const notificationOptions = {
    body,
    icon,
    badge,
    tag,
    renotify: true,
    requireInteraction: true,
    silent: isSilent,
    ...(isSilent || !vibrationEnabled
      ? {}
      : { vibrate: Array.isArray(payload.vibrate) ? payload.vibrate : REST_COMPLETE_VIBRATION_PATTERN }),
    timestamp: Date.now(),
    data: {
      url: '/?openActiveWorkout=1',
      action: 'open-active-workout',
      time: Date.now(),
      type: 'rest-complete',
      restId,
      targetEndTime,
      isTest,
    },
  };

  handledPushTags.add(tag);
  trimTagSet(handledPushTags);

  await clearPreviousRestNotifications();
  await self.registration.showNotification(title, notificationOptions);
}

// Web Push Event - Wakes phone & Service Worker from locked/sleeping state via OS push service
self.addEventListener('push', (event) => {
  event.waitUntil(
    handleIncomingWebPush(event).catch((err) => {
      console.warn('[LAZCAKONGYM SW] Error processing push event:', err);
    })
  );
});

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

// Activate Event - Clean up obsolete caches and preserve current versioned exercise library cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cache) => {
            if (cache === CACHE_NAME || cache === EXERCISE_LIB_CACHE_NAME) {
              return Promise.resolve(false);
            }
            if (cache.startsWith(EXERCISE_LIB_CACHE_PREFIX)) {
              // Evict only obsolete exercise library cache versions
              return caches.delete(cache);
            }
            return caches.delete(cache);
          })
        );
      })
      .then(() => self.clients.claim())
      .then(async () => {
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
          client.postMessage({ type: 'SW_ACTIVATED', version: 'v7.0.0' });
        }
      })
  );
});

// Message Listener - Deduplication & notification cleanup only (NO background timers)
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !name.startsWith(EXERCISE_LIB_CACHE_PREFIX))
          .map((name) => caches.delete(name))
      );
    });
    return;
  }

  if (event.data.type === 'SCHEDULE_SW_REST_ALARM') {
    const restId = event.data.restId ? String(event.data.restId) : '';
    if (restId) {
      handledPushTags.delete(`lazcakon-rest-done-${restId}`);
    }
    clearRestCompleteNotificationsOnly();
    return;
  }

  if (event.data.type === 'REST_ALARM_HANDLED') {
    if (event.data.restId) {
      handledPushTags.add(`lazcakon-rest-done-${event.data.restId}`);
      trimTagSet(handledPushTags);
    }
    clearPreviousRestNotifications(REST_ACTIVE_NOTIFICATION_TAG);
    return;
  }

  if (event.data.type === 'CANCEL_REST_ALARM') {
    const preserveOngoing = Boolean(event.data.preserveOngoing);
    if (event.data.restId) {
      const tag = `lazcakon-rest-done-${event.data.restId}`;
      handledPushTags.add(tag);
      trimTagSet(handledPushTags);
      clearPreviousRestNotifications(tag);
      if (!preserveOngoing) {
        clearPreviousRestNotifications(REST_ACTIVE_NOTIFICATION_TAG);
      }
    } else if (preserveOngoing) {
      clearRestCompleteNotificationsOnly();
    } else {
      clearPreviousRestNotifications();
    }
  }
});

// Notification Click Event - Focus or open the active workout session when notification is tapped
self.addEventListener('notificationclick', (event) => {
  const data = event.notification && event.notification.data ? event.notification.data : {};
  const isOngoingRest = data.type === 'rest-active';
  if (!isOngoingRest) {
    event.notification.close();
  }
  const targetUrl = data.url || '/?openActiveWorkout=1';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          try {
            if (typeof client.postMessage === 'function') {
              client.postMessage({
                type: 'OPEN_ACTIVE_WORKOUT',
                notificationType: data.type || '',
                restId: data.restId || '',
              });
            }
          } catch {}
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Fetch Event - Handle network requests (strictly never cache private /api/ data)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Serve selectively pre-downloaded exercise library animations offline from versioned cache
  if (isWhitelistedExerciseMediaUrl(url)) {
    event.respondWith(
      caches.open(EXERCISE_LIB_CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cachedMedia) => {
          if (cachedMedia) return cachedMedia;
          return fetch(event.request);
        })
      )
    );
    return;
  }

  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (url.pathname === '/sw.js' || url.pathname === '/api/version') {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const contentType = (response.headers.get('content-type') || '').toLowerCase();
          if (response && response.status === 200 && contentType.includes('text/html')) {
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

  const isCodeBundle = url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs') || url.pathname.endsWith('.css');
  if (isCodeBundle) {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          const contentType = (response.headers.get('content-type') || '').toLowerCase();
          const isHtmlPayload = contentType.includes('text/html');
          if (response && response.status === 200 && !isHtmlPayload) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          }
          const cached = await caches.match(event.request);
          if (cached) {
            const cachedType = (cached.headers.get('content-type') || '').toLowerCase();
            if (!cachedType.includes('text/html')) {
              return cached;
            }
          }
          return isHtmlPayload ? Response.error() : response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) {
            const cachedType = (cached.headers.get('content-type') || '').toLowerCase();
            if (!cachedType.includes('text/html')) {
              return cached;
            }
          }
          return Response.error();
        })
    );
    return;
  }

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
