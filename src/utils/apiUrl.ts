import { detectRuntimePlatform } from './capacitorPlatform.ts';

export const DEFAULT_BACKEND_ORIGIN =
  'https://lazcakongym.ai.studio';

function normalizeOriginCandidate(candidate?: string | null): string | null {
  if (!candidate || typeof candidate !== 'string') return null;
  const trimmed = candidate.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('http://localhost') ||
    lower.startsWith('https://localhost') ||
    lower.startsWith('capacitor://') ||
    lower.startsWith('ionic://') ||
    lower.includes('ais-dev-') ||
    lower.includes('ais-pre-')
  ) {
    return null;
  }
  return trimmed;
}

export function isCapacitorNativeOrigin(): boolean {
  try {
    if (detectRuntimePlatform().isCapacitorNative) {
      return true;
    }
    if (typeof window !== 'undefined' && window.location) {
      const proto = String(window.location.protocol || '').toLowerCase();
      if (proto === 'capacitor:' || proto === 'ionic:') {
        return true;
      }
    }
  } catch {}
  return false;
}

export function getConfiguredApiBaseUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const apiOverride = normalizeOriginCandidate(localStorage.getItem('lazcakon_api_base_url'));
      if (apiOverride) return apiOverride;
      const publicUrlOverride = normalizeOriginCandidate(
        localStorage.getItem('lazcakon_public_app_url')
      );
      if (publicUrlOverride) return publicUrlOverride;
    }
  } catch {}

  try {
    const envUrl = normalizeOriginCandidate(
      (import.meta as unknown as { env?: Record<string, string | undefined> })?.env
        ?.VITE_API_BASE_URL
    );
    if (envUrl) return envUrl;
  } catch {}

  return DEFAULT_BACKEND_ORIGIN;
}

/**
 * Resolves `/api/...` endpoints cleanly across environments:
 * - Standard Web / PWA / Browser Preview: preserves relative `/api/...` (same-origin).
 * - Capacitor Android / iOS WebView (`https://localhost` or `capacitor://localhost`):
 *   routes `/api/...` to the configured Cloud Run backend origin.
 */
export function resolveApiUrl(
  pathOrUrl: string,
  options?: { forceNative?: boolean; baseUrl?: string }
): string {
  if (!pathOrUrl) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const useNativeOrigin =
    typeof options?.forceNative === 'boolean'
      ? options.forceNative
      : isCapacitorNativeOrigin();

  if (!useNativeOrigin) {
    return pathOrUrl;
  }

  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  const base = normalizeOriginCandidate(options?.baseUrl) || getConfiguredApiBaseUrl();
  return `${base}${normalizedPath}`;
}
