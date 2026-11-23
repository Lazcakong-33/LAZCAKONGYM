/**
 * LAZCAKONG GYM 7.0 — ETAPA 6: OFFLINE SESSION BINDING & SAFE LOGOUT MANAGER
 *
 * Permite que un atleta previamente autenticado con Firebase Auth pueda abrir la app,
 * visualizar sus rutinas, entrenar, completar series, finalizar y guardar sesiones 100% offline.
 *
 * Seguridad estricta:
 * - Nunca almacena contraseñas, PINs ni tokens secretos.
 * - Nunca otorga acceso si el servidor respondió 401 / 403 / 409.
 * - Nunca eleva privilegios de administrador sin verificación previa de sesión Google.
 * - Al cerrar sesión, preserva los cambios offline pendientes del perfil sin borrar datos no sincronizados.
 */

import type {
  LogoutSafetyStatus,
  OfflineSessionBinding,
  Profile,
} from '../types/index.ts';
import { safeLocalStorageSetItem, type StorageAdapterLike } from './safeStorage.ts';

export const OFFLINE_SESSION_BINDING_KEY = 'lazcakon_offline_session_binding_v1';

interface SessionStorageLike extends StorageAdapterLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function getStorage(custom?: SessionStorageLike): SessionStorageLike | null {
  if (custom) return custom;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

export function sanitizeProfileForOfflineBinding(profile: Profile): Profile {
  const copy: Profile = { ...profile };
  delete (copy as any).pin;
  return copy;
}

export function saveOfflineSessionBinding(
  params: {
    uid: string;
    athleteId: string;
    isGoogleVerified: boolean;
    isAdminVerified: boolean;
    profile: Profile;
  },
  customStorage?: SessionStorageLike
): OfflineSessionBinding | null {
  const store = getStorage(customStorage);
  if (!store || !params.uid || !params.athleteId) return null;

  const binding: OfflineSessionBinding = {
    uid: params.uid,
    athleteId: params.athleteId,
    isGoogleVerified: Boolean(params.isGoogleVerified),
    // Never store admin elevation offline unless verified via Google in the online bootstrap
    isAdminVerified: Boolean(params.isGoogleVerified && params.isAdminVerified),
    profileSnapshot: sanitizeProfileForOfflineBinding(params.profile),
    verifiedAt: Date.now(),
  };

  safeLocalStorageSetItem(OFFLINE_SESSION_BINDING_KEY, JSON.stringify(binding), {
    storage: store,
    critical: true,
  });
  return binding;
}

export function getOfflineSessionBinding(
  customStorage?: SessionStorageLike
): OfflineSessionBinding | null {
  const store = getStorage(customStorage);
  if (!store) return null;
  try {
    const raw = store.getItem(OFFLINE_SESSION_BINDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.uid !== 'string' ||
      !parsed.uid ||
      typeof parsed.athleteId !== 'string' ||
      !parsed.athleteId ||
      !parsed.profileSnapshot
    ) {
      return null;
    }
    return {
      uid: parsed.uid,
      athleteId: parsed.athleteId,
      isGoogleVerified: Boolean(parsed.isGoogleVerified),
      isAdminVerified: Boolean(parsed.isGoogleVerified && parsed.isAdminVerified),
      profileSnapshot: sanitizeProfileForOfflineBinding(parsed.profileSnapshot as Profile),
      verifiedAt: typeof parsed.verifiedAt === 'number' ? parsed.verifiedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearOfflineSessionBinding(customStorage?: SessionStorageLike): void {
  const store = getStorage(customStorage);
  if (!store) return;
  try {
    store.removeItem(OFFLINE_SESSION_BINDING_KEY);
  } catch {}
}

/**
 * Determines whether Firebase Auth user + local athlete state may enter offline
 * when `/api/auth/session-init` fails strictly due to lack of network connectivity.
 */
export function canResumeOfflineAuthenticatedSession(params: {
  authUserUid: string | null | undefined;
  apiStatus: number;
  isOnline: boolean;
  binding: OfflineSessionBinding | null;
}): {
  allowed: boolean;
  athleteId: string | null;
  profile: Profile | null;
  isAdminVerified: boolean;
  reason: string;
} {
  const { authUserUid, apiStatus, isOnline, binding } = params;

  if (!authUserUid) {
    return {
      allowed: false,
      athleteId: null,
      profile: null,
      isAdminVerified: false,
      reason: 'No hay usuario Firebase autenticado previamente.',
    };
  }

  // Server actively rejected credentials/permissions -> NEVER bypass offline
  if (apiStatus === 401 || apiStatus === 403 || apiStatus === 404 || apiStatus === 409) {
    return {
      allowed: false,
      athleteId: null,
      profile: null,
      isAdminVerified: false,
      reason: `El servidor rechazó la sesión (HTTP ${apiStatus}).`,
    };
  }

  // Network/transport unavailability (status === 0 or offline)
  const isNetworkFailure = !isOnline || apiStatus === 0 || apiStatus >= 502;
  if (!isNetworkFailure) {
    return {
      allowed: false,
      athleteId: null,
      profile: null,
      isAdminVerified: false,
      reason: `Error de sesión del servidor (HTTP ${apiStatus}).`,
    };
  }

  if (!binding || binding.uid !== authUserUid) {
    return {
      allowed: false,
      athleteId: null,
      profile: null,
      isAdminVerified: false,
      reason: 'Esta cuenta no ha sido verificada previamente en este dispositivo sin conexión.',
    };
  }

  return {
    allowed: true,
    athleteId: binding.athleteId,
    profile: sanitizeProfileForOfflineBinding(binding.profileSnapshot),
    isAdminVerified: Boolean(binding.isGoogleVerified && binding.isAdminVerified),
    reason: 'Sesión offline autorizada mediante vínculo local verificado.',
  };
}

/**
 * Determines whether an already-confirmed Firebase Auth user (`authUserUid`) has a valid,
 * previously server-verified local session binding and local athlete profile for that exact UID
 * so Inicio can render immediately while `/api/auth/session-init` and Firestore sync run in background.
 *
 * Strict access invariants:
 * - Requires non-empty Firebase Auth `authUserUid` (never trusts localStorage alone after logout).
 * - Requires `binding.uid === authUserUid` and a structurally valid athlete profile matching `binding.athleteId`.
 * - Caller MUST still run `/api/auth/session-init` in the background when online and immediately revoke
 *   access if the server returns 401 / 403 / 404 / 409.
 */
export function canResumeInstantLocalSession(params: {
  authUserUid: string | null | undefined;
  binding: OfflineSessionBinding | null;
  storage?: SessionStorageLike;
}): {
  allowed: boolean;
  athleteId: string | null;
  profile: Profile | null;
  isAdminVerified: boolean;
  hasLocalTrainingData: boolean;
  reason: string;
} {
  const { authUserUid, binding, storage } = params;

  if (!authUserUid || typeof authUserUid !== 'string') {
    return {
      allowed: false,
      athleteId: null,
      profile: null,
      isAdminVerified: false,
      hasLocalTrainingData: false,
      reason: 'Identidad de Firebase Auth aún no confirmada.',
    };
  }

  if (
    !binding ||
    binding.uid !== authUserUid ||
    !binding.athleteId ||
    binding.athleteId === 'perfil_default' ||
    !binding.profileSnapshot ||
    binding.profileSnapshot.id !== binding.athleteId ||
    !binding.profileSnapshot.name
  ) {
    return {
      allowed: false,
      athleteId: null,
      profile: null,
      isAdminVerified: false,
      hasLocalTrainingData: false,
      reason: 'No existe un vínculo local verificado para este atleta.',
    };
  }

  const store = getStorage(storage);
  let hasLocalTrainingData = true;
  if (store) {
    try {
      const hasRoutines = Boolean(store.getItem(`lazcakon_${binding.athleteId}_routines`));
      const hasHistory = Boolean(store.getItem(`lazcakon_${binding.athleteId}_history`));
      const hasActive = Boolean(store.getItem(`lazcakon_${binding.athleteId}_active_session`));
      const hasProfiles = Boolean(store.getItem('lazcakon_profiles'));
      hasLocalTrainingData = hasRoutines || hasHistory || hasActive || hasProfiles;
    } catch {
      hasLocalTrainingData = true;
    }
  }

  return {
    allowed: true,
    athleteId: binding.athleteId,
    profile: sanitizeProfileForOfflineBinding(binding.profileSnapshot),
    isAdminVerified: Boolean(binding.isGoogleVerified && binding.isAdminVerified),
    hasLocalTrainingData,
    reason: 'Identidad confirmada con datos locales válidos del atleta; sincronización en segundo plano.',
  };
}

export function evaluateLogoutSafetyStatus(params: {
  pendingSyncCount: number;
  hasActiveWorkout: boolean;
  isOffline: boolean;
}): LogoutSafetyStatus {
  const { pendingSyncCount, hasActiveWorkout, isOffline } = params;
  const requiresWarning = pendingSyncCount > 0 || hasActiveWorkout;

  if (!requiresWarning) {
    return {
      pendingSyncCount,
      hasActiveWorkout,
      isOffline,
      requiresWarning: false,
      warningMessage: null,
    };
  }

  const parts: string[] = [];
  if (hasActiveWorkout) {
    parts.push('tienes un entrenamiento en curso');
  }
  if (pendingSyncCount > 0) {
    parts.push(
      `${pendingSyncCount} ${pendingSyncCount === 1 ? 'cambio pendiente' : 'cambios pendientes'} de sincronizar con la nube`
    );
  }

  return {
    pendingSyncCount,
    hasActiveWorkout,
    isOffline,
    requiresWarning: true,
    warningMessage: `Atención: ${parts.join(' y ')}. Si cierras sesión ahora, tus datos locales permanecerán guardados en este dispositivo${
      isOffline ? ' (estás sin conexión)' : ''
    } y la cola pendiente esperará hasta tu próximo inicio de sesión.`,
  };
}

/**
 * Classifies server revalidation outcome when an offline session regains network connectivity.
 * Ensures 401/403/404/409 immediately revoke local offline session continuity.
 */
export function resolvePostOfflineReconnectOutcome(params: {
  ok: boolean;
  isJson: boolean;
  status: number;
}): 'valid' | 'revoked' | 'defer_offline' {
  const { ok, isJson, status } = params;
  if (ok && isJson) return 'valid';
  if (status === 401 || status === 403 || status === 404 || status === 409) {
    return 'revoked';
  }
  return 'defer_offline';
}
