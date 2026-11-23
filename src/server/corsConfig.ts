export const PERMANENT_CLOUD_RUN_ORIGIN =
  'https://lazcakongym.ai.studio';

export const DIRECT_CLOUD_RUN_SERVICE_ORIGIN =
  'https://lazcakongym-13537846485.us-east1.run.app';

export const DEV_PREVIEW_CLOUD_RUN_ORIGIN =
  'https://ais-dev-56i2tt63sua7ovhyxwpgjs-888570249716.us-east1.run.app';

const BASE_AUTHORIZED_ORIGINS = [
  // Capacitor Native Shells (Android & iOS)
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
  // Official Permanent LAZCAKONG GYM Backend / Web App
  PERMANENT_CLOUD_RUN_ORIGIN,
  DIRECT_CLOUD_RUN_SERVICE_ORIGIN,
  // Official Firebase Hosting Origins for Project forward-cortex-1ds98
  'https://forward-cortex-1ds98.web.app',
  'https://forward-cortex-1ds98.firebaseapp.com',
];

function normalizeOriginEntry(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (/^(capacitor|ionic):\/\/localhost$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function getAllowedCorsOrigins(
  env: Record<string, string | undefined> = process.env
): Set<string> {
  const allowed = new Set<string>(BASE_AUTHORIZED_ORIGINS);

  const appOrigin = normalizeOriginEntry(env.APP_URL);
  if (appOrigin) {
    allowed.add(appOrigin);
  }

  if (env.CORS_ALLOWED_ORIGINS) {
    for (const part of env.CORS_ALLOWED_ORIGINS.split(',')) {
      const normalized = normalizeOriginEntry(part);
      if (normalized) {
        allowed.add(normalized);
      }
    }
  }

  if (env.NODE_ENV !== 'production') {
    allowed.add('http://localhost');
    allowed.add('http://localhost:3000');
    allowed.add('http://127.0.0.1:3000');
    allowed.add(DEV_PREVIEW_CLOUD_RUN_ORIGIN);
  }

  return allowed;
}

export function isAllowedCorsOrigin(
  origin?: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!origin) return true;
  const normalized = normalizeOriginEntry(origin);
  if (!normalized) return false;

  const allowedSet = getAllowedCorsOrigins(env);
  if (allowedSet.has(normalized)) {
    return true;
  }

  // Allow arbitrary localhost ports only during local non-production development
  if (env.NODE_ENV !== 'production') {
    if (
      /^http:\/\/localhost(:\d+)?$/i.test(normalized) ||
      /^https:\/\/localhost(:\d+)?$/i.test(normalized) ||
      /^http:\/\/127\.0\.0\.1(:\d+)?$/i.test(normalized)
    ) {
      return true;
    }
  }

  return false;
}
