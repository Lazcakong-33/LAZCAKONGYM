import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './components/AuthProvider';
import {
  APP_VERSION,
  APP_BUILD_ID,
  DEFERRED_UPDATE_FLAG_KEY,
  getAppUpdateSafetyStatus,
} from './utils/updateApp';
import { detectRuntimePlatform } from './utils/capacitorPlatform';
import { initNativeShell } from './utils/nativeNotifications';

// Clean up ?updated=... cache-busting query parameter after automatic app restart
try {
  if (window.location.search.includes('updated=')) {
    localStorage.setItem('lazcakon_installed_version', APP_VERSION);
    localStorage.setItem('lazcakon_installed_build_id', APP_BUILD_ID);
    localStorage.setItem('lazcakongym_dismissed_update', APP_BUILD_ID);
    localStorage.removeItem(DEFERRED_UPDATE_FLAG_KEY);
    const url = new URL(window.location.href);
    url.searchParams.delete('updated');
    const cleanSearch = url.searchParams.toString();
    const newRelativePath = url.pathname + (cleanSearch ? `?${cleanSearch}` : '') + url.hash;
    window.history.replaceState({}, '', newRelativePath);
  }
} catch {}

// Controlled version tracking without aggressive global CacheStorage destruction
try {
  const installedVer = localStorage.getItem('lazcakon_app_version');
  if (!installedVer) {
    localStorage.setItem('lazcakon_app_version', APP_VERSION);
  }
} catch {}

const runtimePlatform = detectRuntimePlatform();
if (runtimePlatform.isCapacitorNative) {
  void initNativeShell();
}

// Register standard Service Worker for offline PWA, Chrome Android WebAPK, and PWABuilder compliance
if (runtimePlatform.hasServiceWorkerSupport && 'serviceWorker' in navigator) {
  let isReloading = false;

  // When a new Service Worker takes control, ONLY reload if no active workout or offline sync is pending
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const safety = getAppUpdateSafetyStatus();
    if (!safety.canUpdateSafely) {
      try {
        localStorage.setItem(DEFERRED_UPDATE_FLAG_KEY, String(Date.now()));
      } catch {}
      window.dispatchEvent(new CustomEvent('app-update-deferred', { detail: safety }));
      window.dispatchEvent(new CustomEvent('app-update-available'));
      console.warn('[LAZCAKONGYM] Recarga tras controllerchange pospuesta para proteger entrenamiento/cola offline:', safety.reason);
      return;
    }
    if (!isReloading) {
      isReloading = true;
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        console.log('[LAZCAKONGYM] Service Worker activo con scope:', registration.scope);

        // Immediate update check right on startup
        registration.update().catch(() => {});

        // If a new worker is waiting, notify the UI banner immediately
        if (registration.waiting) {
          window.dispatchEvent(new CustomEvent('app-update-available'));
        }

        // Periodically check for updates every 25 seconds
        setInterval(() => {
          registration.update().catch(() => {});
        }, 1000 * 25);

        // Check for updates when phone app is reopened from background
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => {});
          }
        });

        // Detect update ready and display mobile update banner
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[LAZCAKONGYM] Nueva versión lista en segundo plano.');
                window.dispatchEvent(new CustomEvent('app-update-available'));
              }
            });
          }
        });
      })
      .catch((error) => {
        console.warn('[LAZCAKONGYM] Error registrando Service Worker:', error);
      });

    // Listen for SW_ACTIVATED messages from sw.js
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SW_ACTIVATED') {
        window.dispatchEvent(new CustomEvent('app-update-available'));
      }
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
