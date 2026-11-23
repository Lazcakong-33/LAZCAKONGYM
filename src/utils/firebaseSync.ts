import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { auth, db } from '../firebase.ts';
import {
  Profile,
  PendingOfflineSyncOp,
  SyncOperationType,
  OfflineSyncQueueSummary,
} from '../types/index.ts';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { safeApiFetchJson } from './safeApiFetch.ts';
import { resolveApiUrl } from './apiUrl.ts';
import { safeLocalStorageSetItem, type StorageAdapterLike } from './safeStorage.ts';
import { getChileLocalDateKey, getChileWeekdayName, resolveWorkoutChileDateKey } from './calorieCalculator.ts';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  firestoreDatabaseId?: string;
}

export interface InviteLink {
  token: string;
  createdAt: string;
  createdBy: string;
  note?: string;
  used: boolean;
  usedAt?: string;
  usedByName?: string;
  usedByEmail?: string;
  revoked?: boolean;
}

export const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId,
  firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
};

const STORAGE_KEY = 'lazcakon_firebase_config';
export const DEFAULT_PUBLIC_APP_URL = 'https://lazcakongym.ai.studio';

export function getPublicAppUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('lazcakon_public_app_url');
      if (
        stored &&
        !stored.includes('localhost') &&
        !stored.includes('ais-dev-')
      ) {
        return stored.trim();
      }
    }
  } catch {}
  if (typeof window !== 'undefined') {
    const origin = window.location.origin || '';
    if (
      origin &&
      origin !== 'null' &&
      !origin.includes('localhost') &&
      !origin.startsWith('capacitor:') &&
      !origin.startsWith('ionic:') &&
      !origin.includes('ais-dev-') &&
      !origin.includes('google.com') &&
      !origin.includes('googleusercontent.com') &&
      !origin.includes('appspot.com')
    ) {
      return origin;
    }
  }
  return DEFAULT_PUBLIC_APP_URL;
}

export function getStoredFirebaseConfig(): FirebaseConfig {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_FIREBASE_CONFIG, ...parsed };
      }
    }
  } catch {}
  return DEFAULT_FIREBASE_CONFIG;
}

export function saveStoredFirebaseConfig(config: FirebaseConfig) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
  } catch {}
}

export function getFirestoreDB(): Firestore | null {
  return db;
}

async function getBearerAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Debes iniciar sesión con Firebase Authentication primero.');
  }
  const idToken = await currentUser.getIdToken(forceRefresh);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };
}

/**
 * Deep sanitization of undefined values before saving to Firestore.
 */
function sanitizeForFirestore(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore);
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.entries(obj).reduce((acc: any, [key, val]) => {
      if (val !== undefined) {
        acc[key] = sanitizeForFirestore(val);
      }
      return acc;
    }, {});
  }
  return obj;
}

/**
 * Strips security-sensitive & immutable fields before writing /athletes/{id} from client SDK,
 * ensuring strict compliance with hardened firestore.rules (`!('pin' in request.resource.data)`,
 * immutable `isAdmin` and `authUid`).
 */
export function buildRuleCompliantAthletePatch(
  rawData: Record<string, unknown>
): Record<string, unknown> {
  const clone = sanitizeForFirestore({ ...rawData });
  delete clone.pin;
  delete clone.isAdmin;
  delete clone.authUid;
  delete clone.migrationStatus;
  delete clone.legacyPinPurged;
  delete clone.serverIdentityVerified;
  return clone;
}

function mapCloudDocToProfile(data: Record<string, any>): Profile {
  return {
    id: data.id,
    name: data.name,
    email: data.email || '',
    authUid: data.authUid || undefined,
    migrationStatus: data.migrationStatus || undefined,
    avatar: data.avatar || '🦍',
    goal: data.goal || 'Hipertrofia & Masa',
    weeklyTargetDays: data.weeklyTargetDays || 5,
    soundEnabled: data.soundEnabled !== false,
    vibrationEnabled: data.vibrationEnabled !== false,
    weightUnit: data.weightUnit || 'kg',
    weightKg: data.weightKg,
    heightCm: data.heightCm,
    isAdmin: !!data.isAdmin,
    themeAccent: data.themeAccent || undefined,
    createdAt: data.createdAt || new Date().toISOString(),
  };
}

/**
 * Save or update an authenticated athlete's profile in Cloud Firestore.
 * Requires active Firebase Auth session and strips restricted fields (pin, isAdmin, authUid).
 */
export async function saveAthleteToCloud(
  profile: Profile,
  extraData?: Record<string, unknown>
): Promise<{ success: boolean; message: string }> {
  try {
    if (!db) return { success: false, message: 'Base de datos no inicializada' };
    if (!auth.currentUser) {
      return { success: false, message: 'Autenticación de Firebase requerida para guardar en la nube.' };
    }
    const athleteDocRef = doc(db, 'athletes', profile.id);
    const sanitizedPatch = buildRuleCompliantAthletePatch({
      ...profile,
      ...(extraData || {}),
      lastSyncedAt: new Date().toISOString(),
    });
    await setDoc(athleteDocRef, sanitizedPatch, { merge: true });
    return { success: true, message: 'Atleta guardado en la nube exitosamente.' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al guardar atleta en la nube';
    console.warn('[saveAthleteToCloud error]:', msg);
    return { success: false, message: msg };
  }
}

/**
 * Fetch athlete profile(s) respecting Firestore security rules:
 * - Admin (Google-verified ADMIN_EMAIL confirmed by server): fetches /athletes and /deleted_athletes.
 * - Regular athlete: fetches ONLY their own /athletes/{athleteId} doc or queries `where('authUid', '==', uid)`.
 */
export async function fetchAthletesFromCloud(options?: {
  isAdmin?: boolean;
  athleteId?: string;
}): Promise<{ profiles: Profile[]; deletedIds: Set<string> }> {
  try {
    if (!db || !auth.currentUser) return { profiles: [], deletedIds: new Set() };

    const isAdmin = Boolean(options?.isAdmin);
    const scopedAthleteId = options?.athleteId;

    if (!isAdmin) {
      if (scopedAthleteId) {
        const ownSnap = await getDoc(doc(db, 'athletes', scopedAthleteId));
        if (!ownSnap.exists()) {
          return { profiles: [], deletedIds: new Set([scopedAthleteId]) };
        }
        const data = ownSnap.data();
        if (data && data.id && data.name) {
          return { profiles: [mapCloudDocToProfile(data)], deletedIds: new Set() };
        }
        return { profiles: [], deletedIds: new Set() };
      }

      const byUidSnap = await getDocs(
        query(collection(db, 'athletes'), where('authUid', '==', auth.currentUser.uid), limit(1))
      );
      if (byUidSnap.empty) {
        return { profiles: [], deletedIds: new Set() };
      }
      const data = byUidSnap.docs[0].data();
      if (data && data.id && data.name) {
        return { profiles: [mapCloudDocToProfile(data)], deletedIds: new Set() };
      }
      return { profiles: [], deletedIds: new Set() };
    }

    const [athletesSnap, deletedSnap] = await Promise.all([
      getDocs(collection(db, 'athletes')),
      getDocs(collection(db, 'deleted_athletes')).catch(() => null),
    ]);

    const deletedIds = new Set<string>();
    if (deletedSnap) {
      deletedSnap.forEach((d) => deletedIds.add(d.id));
    }

    const list: Profile[] = [];
    athletesSnap.forEach((d) => {
      const data = d.data();
      if (data && data.id && data.name && !deletedIds.has(data.id)) {
        list.push(mapCloudDocToProfile(data));
      }
    });
    return { profiles: list, deletedIds };
  } catch (err) {
    console.warn('[fetchAthletesFromCloud error]:', err);
    return { profiles: [], deletedIds: new Set() };
  }
}

/**
 * Role-scoped real-time listener in Cloud Firestore:
 * - Unauthenticated: does NOT attach any listener (zero 403/permission-denied probes).
 * - Admin (Google-verified ADMIN_EMAIL confirmed by server): listens to /athletes and /deleted_athletes.
 * - Athlete: listens ONLY to their own /athletes/{athleteId} doc or `where('authUid', '==', uid)`.
 */
export function subscribeAthletesFromCloud(
  onUpdate: (profiles: Profile[], deletedIds: Set<string>) => void,
  options?: { isAdmin?: boolean; athleteId?: string }
): () => void {
  try {
    if (!db || !auth.currentUser) return () => {};

    if (!options?.isAdmin) {
      const targetId = options?.athleteId;
      if (targetId) {
        const unsubOwn = onSnapshot(
          doc(db, 'athletes', targetId),
          (snap) => {
            if (!snap.exists()) {
              onUpdate([], new Set([targetId]));
              return;
            }
            const data = snap.data();
            if (data && data.id && data.name) {
              onUpdate([mapCloudDocToProfile(data)], new Set());
            }
          },
          (err) => {
            console.warn('[subscribeOwnAthleteFromCloud error]:', err);
          }
        );
        return unsubOwn;
      }

      const ownQuery = query(
        collection(db, 'athletes'),
        where('authUid', '==', auth.currentUser.uid),
        limit(1)
      );
      return onSnapshot(
        ownQuery,
        (snapshot) => {
          if (snapshot.empty) {
            onUpdate([], new Set());
            return;
          }
          const data = snapshot.docs[0].data();
          if (data && data.id && data.name) {
            onUpdate([mapCloudDocToProfile(data)], new Set());
          }
        },
        (err) => {
          console.warn('[subscribeOwnAthleteQueryFromCloud error]:', err);
        }
      );
    }

    let latestAthletesDocs: Profile[] = [];
    let latestDeletedIds = new Set<string>();
    let hasLoadedAthletes = false;

    const notify = () => {
      const activeAthletes = latestAthletesDocs.filter((p) => !latestDeletedIds.has(p.id));
      if (hasLoadedAthletes) {
        onUpdate(activeAthletes, latestDeletedIds);
      }
    };

    const unsubDeleted = onSnapshot(
      collection(db, 'deleted_athletes'),
      (snap) => {
        const ids = new Set<string>();
        snap.forEach((d) => ids.add(d.id));
        latestDeletedIds = ids;
        notify();
      },
      (err) => {
        console.warn('[subscribeAthletesFromCloud deleted_athletes error]:', err);
      }
    );

    const unsubAthletes = onSnapshot(
      collection(db, 'athletes'),
      (snapshot) => {
        const list: Profile[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          if (data && data.id && data.name) {
            list.push(mapCloudDocToProfile(data));
          }
        });
        latestAthletesDocs = list;
        hasLoadedAthletes = true;
        notify();
      },
      (err) => {
        console.warn('[subscribeAthletesFromCloud athletes error]:', err);
      }
    );

    return () => {
      unsubDeleted();
      unsubAthletes();
    };
  } catch (err) {
    console.warn('[subscribeAthletesFromCloud error]:', err);
    return () => {};
  }
}

/**
 * Permanently delete an athlete profile via Admin-authenticated backend API.
 */
export async function deleteAthleteFromCloud(
  profileId: string,
  _adminIdentifier?: string
): Promise<boolean> {
  try {
    const headers = await getBearerAuthHeaders();
    const res = await fetch(resolveApiUrl(`/api/admin/athletes/${encodeURIComponent(profileId)}`), {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) return false;

    try {
      localStorage.removeItem(`lazcakon_${profileId}_routines`);
      localStorage.removeItem(`lazcakon_${profileId}_history`);
      localStorage.removeItem(`lazcakon_${profileId}_prs`);
      localStorage.removeItem(`lazcakon_${profileId}_bodyweight`);
      localStorage.removeItem(`lazcakon_${profileId}_alternatives`);
      localStorage.removeItem(`lazcakon_${profileId}_custom_links`);
    } catch {}

    return true;
  } catch (err) {
    console.warn('[deleteAthleteFromCloud error]:', err);
    return false;
  }
}

/**
 * Synchronize athlete training data (routines, history, PRs, bodyweight) to Firestore.
 * Strictly strips forbidden fields (pin, isAdmin, authUid) and requires active Firebase Auth.
 */
export async function syncUserDataToFirebase(
  profileId: string,
  data: Record<string, unknown>
): Promise<{ success: boolean; message: string; permissionDenied?: boolean }> {
  try {
    if (!db) {
      return { success: false, message: 'Firebase no está configurado.' };
    }
    if (!auth.currentUser) {
      return { success: false, message: 'Inicia sesión para sincronizar tus datos en la nube.' };
    }
    const cleanData = buildRuleCompliantAthletePatch(data);
    const userDocRef = doc(db, 'athletes', profileId);
    await setDoc(
      userDocRef,
      {
        ...cleanData,
        lastSyncedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return { success: true, message: '¡Datos sincronizados exitosamente con Cloud Firestore!' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido al sincronizar.';
    const permissionDenied =
      message.toLowerCase().includes('permission-denied') ||
      message.toLowerCase().includes('missing or insufficient permissions');
    return { success: false, message, permissionDenied };
  }
}

/**
 * Retrieve authenticated athlete training data from Firestore.
 */
export async function fetchUserDataFromFirebase(
  profileId: string
): Promise<{ success: boolean; data?: Record<string, unknown>; message?: string }> {
  try {
    if (!db) {
      return { success: false, message: 'Firebase no está configurado.' };
    }
    if (!auth.currentUser || !profileId) {
      return { success: false, message: 'Autenticación de Firebase requerida.' };
    }
    const userDocRef = doc(db, 'athletes', profileId);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      const data = snap.data() || {};
      if ('pin' in data) {
        delete data.pin;
      }
      return { success: true, data };
    }
    return { success: false, message: 'No se encontraron datos en la nube para este perfil.' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al obtener datos.';
    return { success: false, message };
  }
}

// ============================================================================
// SINGLE-USE INVITATION LINKS SYSTEM (SERVER ADMIN SDK BACKED ONLY)
// ============================================================================

export function extractInviteTokenFromInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  try {
    if (trimmed.includes('invite=')) {
      const match = trimmed.match(/[?&]invite=([^&#\s]+)/i);
      if (match && match[1]) return decodeURIComponent(match[1].trim()).toUpperCase();
    }
  } catch {}
  return trimmed.toUpperCase();
}

/**
 * Verify if an invite token exists and has NOT been used or revoked via server Admin SDK API.
 * Browser never reads /invites directly and NEVER uses local regex bypasses.
 */
export async function verifyInviteToken(
  rawToken: string
): Promise<{
  valid: boolean;
  status: 'valid' | 'used' | 'revoked' | 'not_found';
  invite?: InviteLink;
  error?: string;
}> {
  const token = extractInviteTokenFromInput(rawToken);
  if (!token) {
    return { valid: false, status: 'not_found' };
  }

  try {
    const result = await safeApiFetchJson<{
      valid?: boolean;
      status?: 'valid' | 'used' | 'revoked' | 'not_found';
      invite?: InviteLink;
      error?: string;
    }>('/api/invites/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = result.data;
    if (!result.isJson || !data) {
      return { valid: false, status: 'not_found', error: result.error };
    }
    if (!result.ok && !data.status) {
      return { valid: false, status: 'not_found', error: data.error || result.error };
    }
    return {
      valid: Boolean(data.valid),
      status: data.status || 'not_found',
      invite: data.invite,
      error: data.error,
    };
  } catch (err: any) {
    console.warn('[verifyInviteToken network error]:', err);
    return { valid: false, status: 'not_found', error: 'Error de red verificando código.' };
  }
}

/**
 * Atomic single-use registration via server Admin SDK API (/api/invites/register).
 * Starter Tier compatible: requires active Firebase Client SDK session (`Authorization: Bearer <idToken>`).
 */
export async function registerAthleteWithInvite(payload: {
  token: string;
  name: string;
  email: string;
  avatar: string;
  goal: string;
}): Promise<{
  success: boolean;
  athleteId?: string;
  authUid?: string;
  isAdmin?: boolean;
  profile?: Profile;
  error?: string;
}> {
  try {
    const headers = await getBearerAuthHeaders(true);
    const result = await safeApiFetchJson<{
      success?: boolean;
      athleteId?: string;
      authUid?: string;
      isAdmin?: boolean;
      profile?: Profile;
      error?: string;
    }>('/api/invites/register', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = result.data;
    if (!result.ok || !result.isJson || !data?.success) {
      return {
        success: false,
        error: result.error || data?.error || 'No se pudo completar el registro con invitación.',
      };
    }
    return {
      success: true,
      athleteId: data.athleteId,
      authUid: data.authUid,
      isAdmin: data.isAdmin,
      profile: data.profile,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Error de conexión al registrar cuenta.',
    };
  }
}

/**
 * Links an unlinked legacy athlete profile to the currently signed-in Firebase Auth user
 * after proving identity via legacy PIN or single-use Coach recovery code (`LZK-REC-...`).
 */
export async function linkLegacyProfileWithServer(payload: {
  email: string;
  pin: string;
}): Promise<{
  success: boolean;
  athleteId?: string;
  authUid?: string;
  isAdmin?: boolean;
  profile?: Profile;
  error?: string;
  alreadyMigrated?: boolean;
  alreadyLinkedToAnotherUid?: boolean;
  linkingConflict?: boolean;
  sameUid?: boolean;
}> {
  try {
    const headers = await getBearerAuthHeaders(true);
    const result = await safeApiFetchJson<{
      success?: boolean;
      athleteId?: string;
      authUid?: string;
      isAdmin?: boolean;
      profile?: Profile;
      error?: string;
      alreadyMigrated?: boolean;
      alreadyLinkedToAnotherUid?: boolean;
      linkingConflict?: boolean;
      sameUid?: boolean;
    }>('/api/auth/migrate-legacy', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = result.data;
    const errorMsg = result.error || data?.error || '';
    const isAlreadyMigrated = Boolean(
      data?.alreadyMigrated || errorMsg.includes('completó la migración')
    );
    const isLinkingConflict = Boolean(
      data?.linkingConflict || data?.alreadyLinkedToAnotherUid
    );
    if (!result.ok || !result.isJson || !data?.success) {
      return {
        success: false,
        alreadyMigrated: isAlreadyMigrated,
        alreadyLinkedToAnotherUid: Boolean(data?.alreadyLinkedToAnotherUid),
        linkingConflict: isLinkingConflict,
        sameUid: Boolean(data?.sameUid),
        error:
          errorMsg ||
          'No se pudo verificar la propiedad del perfil heredado.',
      };
    }
    return {
      success: true,
      athleteId: data.athleteId,
      authUid: data.authUid,
      isAdmin: data.isAdmin,
      profile: data.profile,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Error de conexión verificando el perfil heredado.',
    };
  }
}

export async function createSingleUseInvite(
  createdBy: string,
  note?: string
): Promise<InviteLink | null> {
  try {
    const headers = await getBearerAuthHeaders();
    const result = await safeApiFetchJson<{ success?: boolean; invite?: InviteLink; error?: string }>(
      '/api/admin/invites',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ createdBy, note }),
      }
    );
    const data = result.data;
    if (!result.ok || !result.isJson || !data?.success) {
      throw new Error(result.error || data?.error || 'No autorizado para generar invitaciones.');
    }
    return data.invite as InviteLink;
  } catch (err) {
    console.warn('[createSingleUseInvite error]:', err);
    return null;
  }
}

export async function generateBatchInviteTokens(
  count = 50,
  createdBy = 'Coach Camilo Lazcano (Admin)'
): Promise<{ success: boolean; tokens: string[]; message: string }> {
  try {
    const headers = await getBearerAuthHeaders();
    const result = await safeApiFetchJson<{
      success?: boolean;
      tokens?: string[];
      message?: string;
      error?: string;
    }>('/api/admin/invites/batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({ count, createdBy }),
    });
    const data = result.data;
    if (!result.ok || !result.isJson || !data?.success) {
      return {
        success: false,
        tokens: [],
        message: result.error || data?.error || 'Error generando lote de invitaciones.',
      };
    }
    return {
      success: true,
      tokens: data.tokens || [],
      message: data.message || `¡${count} códigos generados!`,
    };
  } catch (err: any) {
    return {
      success: false,
      tokens: [],
      message: err?.message || 'Error generando lote de invitaciones.',
    };
  }
}

export async function revokeInviteToken(token: string): Promise<boolean> {
  try {
    const headers = await getBearerAuthHeaders();
    const resolvedInviteUrl = resolveApiUrl(`/api/admin/invites/${encodeURIComponent(token)}`);
    const res = await fetch(resolvedInviteUrl, {
      method: 'DELETE',
      headers,
      credentials: resolvedInviteUrl.startsWith('/') ? 'same-origin' : 'omit',
    });
    return res.ok;
  } catch (err) {
    console.warn('[revokeInviteToken error]:', err);
    return false;
  }
}

export async function fetchInvitesAdmin(): Promise<InviteLink[]> {
  try {
    const headers = await getBearerAuthHeaders();
    const result = await safeApiFetchJson<{ invites?: InviteLink[] }>('/api/admin/invites', {
      method: 'GET',
      headers,
    });
    if (!result.ok || !result.isJson) return [];
    return Array.isArray(result.data?.invites) ? result.data.invites : [];
  } catch {
    return [];
  }
}

/**
 * Poll Admin-only /api/admin/invites for Invite Management UI (strictly server-verified Admin only).
 */
export function subscribeToInvites(onUpdate: (invites: InviteLink[]) => void): () => void {
  if (!auth.currentUser) {
    onUpdate([]);
    return () => {};
  }

  let cancelled = false;
  const pull = async () => {
    const list = await fetchInvitesAdmin();
    if (!cancelled) {
      onUpdate(list);
    }
  };

  pull();
  const timer = setInterval(pull, 15000);
  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}

// ============================================================================
// REAL-TIME MOBILE UPDATE BANNER BROADCAST (SERVER ENDPOINT BACKED)
// ============================================================================

export interface AppUpdateBroadcast {
  version: string;
  buildId: string;
  broadcastId: string;
  updatedAt: string;
  message?: string;
}

export async function broadcastAppUpdateToDevices(
  version: string,
  buildId: string,
  message?: string
): Promise<{ success: boolean; broadcastId: string }> {
  const fallbackId = `${buildId}-${Date.now()}`;
  try {
    const headers = await getBearerAuthHeaders();
    const result = await safeApiFetchJson<{ success?: boolean; broadcastId?: string }>(
      '/api/admin/broadcast-update',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ version, buildId, message }),
      }
    );
    const data = result.data;
    if (result.ok && result.isJson && data?.success) {
      return { success: true, broadcastId: data.broadcastId || fallbackId };
    }
  } catch (err) {
    console.warn('[broadcastAppUpdateToDevices error]:', err);
  }
  return { success: false, broadcastId: fallbackId };
}

// ============================================================================
// DEFERRED OFFLINE SYNC SYSTEM (STAGE 6 SMART QUEUE + BACKOFF + MUTEX LOCK)
// ============================================================================

export const OFFLINE_SYNC_QUEUE_KEY = 'lazcakon_pending_offline_sync_queue';

export type PendingOfflineSync = PendingOfflineSyncOp;

interface QueueStorageLike extends StorageAdapterLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

let lastQueueStorageError: string | null = null;
export function getLastOfflineQueueStorageError(): string | null {
  return lastQueueStorageError;
}

function resolveDefaultQueueStorage(customStorage?: QueueStorageLike): QueueStorageLike | null {
  if (customStorage) return customStorage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

let queueIdSeq = 0;
let inFlightSyncPromise: Promise<{
  syncedCount: number;
  remainingCount: number;
  failedCount: number;
}> | null = null;
const inFlightByStorage = new WeakMap<
  QueueStorageLike,
  Promise<{
    syncedCount: number;
    remainingCount: number;
    failedCount: number;
  }>
>();
const queueChangeListeners = new Set<() => void>();

function notifyQueueChanged(): void {
  queueChangeListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

export function subscribeOfflineSyncQueue(listener: () => void): () => void {
  queueChangeListeners.add(listener);
  return () => {
    queueChangeListeners.delete(listener);
  };
}

export function computeRetryBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(60_000, 1500 * Math.pow(2, Math.max(0, attempts - 1)));
}

function normalizeOfflineQueueOp(raw: any, fallbackIndex: number): PendingOfflineSyncOp | null {
  if (!raw || typeof raw !== 'object' || typeof raw.profileId !== 'string' || !raw.profileId.trim()) {
    return null;
  }
  const payloadObj =
    raw.payload && typeof raw.payload === 'object'
      ? (raw.payload as Record<string, unknown>)
      : raw.data && typeof raw.data === 'object'
        ? (raw.data as Record<string, unknown>)
        : {};
  const createdIso =
    typeof raw.createdAt === 'string' && raw.createdAt
      ? raw.createdAt
      : typeof raw.queuedAt === 'string' && raw.queuedAt
        ? raw.queuedAt
        : new Date().toISOString();

  return {
    id:
      typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim()
        : `sync-${Date.now()}-${fallbackIndex}`,
    profileId: raw.profileId.trim(),
    createdAt: createdIso,
    queuedAt: createdIso,
    operationType: (raw.operationType as SyncOperationType) || 'workout_patch',
    status: raw.status || 'pending',
    attempts: typeof raw.attempts === 'number' && Number.isFinite(raw.attempts) ? Math.max(0, raw.attempts) : 0,
    nextRetryAt:
      typeof raw.nextRetryAt === 'number' && Number.isFinite(raw.nextRetryAt) ? raw.nextRetryAt : 0,
    recordVersion:
      typeof raw.recordVersion === 'number' && Number.isFinite(raw.recordVersion)
        ? raw.recordVersion
        : Date.now() + fallbackIndex,
    ...(typeof raw.lastError === 'string' && raw.lastError ? { lastError: raw.lastError } : {}),
    payload: payloadObj,
    data: payloadObj,
  };
}

export function getOfflineSyncQueue(customStorage?: QueueStorageLike): PendingOfflineSyncOp[] {
  try {
    const store = resolveDefaultQueueStorage(customStorage);
    if (!store) return [];
    const raw = store.getItem(OFFLINE_SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, idx) => normalizeOfflineQueueOp(item, idx))
      .filter((item): item is PendingOfflineSyncOp => Boolean(item));
  } catch {
    return [];
  }
}

function saveOfflineSyncQueue(
  queue: PendingOfflineSyncOp[],
  customStorage?: QueueStorageLike
): { ok: boolean; errorMessage?: string } {
  const store = resolveDefaultQueueStorage(customStorage);
  if (!store) return { ok: false, errorMessage: 'Almacenamiento local no disponible.' };
  if (queue.length > 0) {
    const res = safeLocalStorageSetItem(OFFLINE_SYNC_QUEUE_KEY, JSON.stringify(queue), {
      storage: store,
      critical: true,
    });
    if (!res.ok) {
      lastQueueStorageError = res.errorMessage || 'Error guardando cola de sincronización.';
      notifyQueueChanged();
      return { ok: false, errorMessage: lastQueueStorageError };
    }
    lastQueueStorageError = null;
  } else {
    store.removeItem(OFFLINE_SYNC_QUEUE_KEY);
    lastQueueStorageError = null;
  }
  notifyQueueChanged();
  return { ok: true };
}

export function getOfflineSyncQueueSummary(
  profileId?: string,
  customStorage?: QueueStorageLike
): OfflineSyncQueueSummary {
  const all = getOfflineSyncQueue(customStorage);
  const filtered = profileId ? all.filter((op) => op.profileId === profileId) : all;
  const lastErrOp = [...filtered].reverse().find((op) => Boolean(op.lastError));
  return {
    count: filtered.length,
    pendingOps: filtered,
    lastError: lastErrOp?.lastError || null,
    hasRetryScheduled: filtered.some((op) => op.status === 'retry_scheduled' || op.status === 'error'),
  };
}

export function hasPendingSyncOperationType(
  profileId: string,
  operationTypes: SyncOperationType[],
  customStorage?: QueueStorageLike
): boolean {
  if (!profileId) return false;
  const set = new Set(operationTypes);
  return getOfflineSyncQueue(customStorage).some(
    (op) => op.profileId === profileId && set.has(op.operationType)
  );
}

export function queueOfflineSync(
  profileId: string,
  data: Record<string, unknown>,
  operationType: SyncOperationType = 'workout_patch',
  customStorage?: QueueStorageLike
): PendingOfflineSyncOp | null {
  try {
    const store = resolveDefaultQueueStorage(customStorage);
    if (!store || !profileId) return null;

    const queue = getOfflineSyncQueue(store);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    queueIdSeq = (queueIdSeq + 1) % 100000;

    // Coalesce consecutive operations of the same type for the same profile safely,
    // and when finishing/cancelling a workout, fold superseded workout_patch drafts cleanly.
    let nextQueue = queue;
    if (operationType === 'workout_finish' || operationType === 'workout_cancel') {
      nextQueue = queue.filter(
        (op) => !(op.profileId === profileId && op.operationType === 'workout_patch')
      );
    }

    const existingIdx = nextQueue.findIndex(
      (op) => op.profileId === profileId && op.operationType === operationType
    );

    const recordVersion =
      Math.max(nowMs, ...nextQueue.map((op) => op.recordVersion || 0)) + 1;

    if (existingIdx >= 0) {
      const existing = nextQueue[existingIdx];
      const mergedPayload = { ...existing.payload, ...data };
      const updatedOp: PendingOfflineSyncOp = {
        ...existing,
        createdAt: nowIso,
        queuedAt: nowIso,
        status: 'pending',
        nextRetryAt: 0,
        recordVersion,
        payload: mergedPayload,
        data: mergedPayload,
      };
      nextQueue[existingIdx] = updatedOp;
      const writeRes = saveOfflineSyncQueue(nextQueue, store);
      return writeRes.ok ? updatedOp : null;
    }

    const newOp: PendingOfflineSyncOp = {
      id: `sync-${nowMs}-${queueIdSeq}-${Math.random().toString(36).slice(2, 6)}`,
      profileId,
      createdAt: nowIso,
      queuedAt: nowIso,
      operationType,
      status: 'pending',
      attempts: 0,
      nextRetryAt: 0,
      recordVersion,
      payload: data,
      data,
    };
    nextQueue.push(newOp);
    const writeRes = saveOfflineSyncQueue(nextQueue, store);
    return writeRes.ok ? newOp : null;
  } catch (err) {
    lastQueueStorageError = err instanceof Error ? err.message : 'Error guardando en cola offline.';
    console.warn('[OfflineSync queue error]:', err);
    return null;
  }
}

export async function processPendingOfflineSyncs(options?: {
  forceNow?: boolean;
  nowMs?: number;
  profileId?: string;
  isOnline?: boolean;
  isAuthed?: boolean;
  storage?: QueueStorageLike;
  syncFn?: (
    profileId: string,
    data: Record<string, unknown>
  ) => Promise<{ success: boolean; permissionDenied?: boolean; message?: string }>;
}): Promise<{ syncedCount: number; remainingCount: number; failedCount: number }> {
  const storageKey = options?.storage;
  if (storageKey) {
    const existing = inFlightByStorage.get(storageKey);
    if (existing) return existing;
  } else if (inFlightSyncPromise && !options?.syncFn) {
    return inFlightSyncPromise;
  }

  const runFlush = async (): Promise<{
    syncedCount: number;
    remainingCount: number;
    failedCount: number;
  }> => {
    const isOnline =
      typeof options?.isOnline === 'boolean'
        ? options.isOnline
        : typeof navigator === 'undefined' || navigator.onLine;
    if (!isOnline) {
      const currentCount = getOfflineSyncQueue(options?.storage).length;
      return { syncedCount: 0, remainingCount: currentCount, failedCount: 0 };
    }

    const isAuthed =
      typeof options?.isAuthed === 'boolean' ? options.isAuthed : Boolean(auth.currentUser);
    if (!isAuthed) {
      const currentCount = getOfflineSyncQueue(options?.storage).length;
      return { syncedCount: 0, remainingCount: currentCount, failedCount: 0 };
    }

    const queue = getOfflineSyncQueue(options?.storage);
    if (queue.length === 0) {
      return { syncedCount: 0, remainingCount: 0, failedCount: 0 };
    }

    // Order FIFO by recordVersion / createdAt
    const ordered = [...queue].sort((a, b) => (a.recordVersion || 0) - (b.recordVersion || 0));
    const remainingQueue: PendingOfflineSyncOp[] = [];
    const syncFn = options?.syncFn || syncUserDataToFirebase;
    const nowMs = options?.nowMs ?? Date.now();
    let syncedCount = 0;
    let failedCount = 0;

    for (const item of ordered) {
      if (options?.profileId && item.profileId !== options.profileId) {
        remainingQueue.push(item);
        continue;
      }

      if (!options?.forceNow && item.status === 'error') {
        remainingQueue.push(item);
        continue;
      }

      if (!options?.forceNow && item.nextRetryAt > nowMs) {
        remainingQueue.push(item);
        continue;
      }

      try {
        const res = await syncFn(item.profileId, item.payload);
        if (res.success) {
          // Strict ACK-gated removal: only drop after confirmed cloud write
          syncedCount++;
        } else if (res.permissionDenied) {
          failedCount++;
          remainingQueue.push({
            ...item,
            status: 'error',
            attempts: item.attempts + 1,
            nextRetryAt: Number.MAX_SAFE_INTEGER,
            lastError:
              res.message || 'Permisos insuficientes en Cloud Firestore. Tus datos siguen seguros en local.',
          });
        } else {
          failedCount++;
          const nextAttempts = item.attempts + 1;
          const backoffMs = computeRetryBackoffMs(nextAttempts);
          remainingQueue.push({
            ...item,
            status: 'retry_scheduled',
            attempts: nextAttempts,
            nextRetryAt: nowMs + backoffMs,
            lastError: res.message || 'No se pudo confirmar escritura remota.',
          });
        }
      } catch (err: any) {
        failedCount++;
        const nextAttempts = item.attempts + 1;
        const backoffMs = computeRetryBackoffMs(nextAttempts);
        remainingQueue.push({
          ...item,
          status: 'retry_scheduled',
          attempts: nextAttempts,
          nextRetryAt: nowMs + backoffMs,
          lastError: err?.message || 'Error de red durante sincronización.',
        });
      }
    }

    saveOfflineSyncQueue(remainingQueue, options?.storage);
    return { syncedCount, remainingCount: remainingQueue.length, failedCount };
  };

  if (storageKey) {
    const promise = runFlush().finally(() => {
      inFlightByStorage.delete(storageKey);
    });
    inFlightByStorage.set(storageKey, promise);
    return promise;
  }

  if (options?.syncFn) {
    return runFlush();
  }

  inFlightSyncPromise = runFlush().finally(() => {
    inFlightSyncPromise = null;
  });
  return inFlightSyncPromise;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (auth.currentUser) {
      processPendingOfflineSyncs({ forceNow: true }).catch(() => {});
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine && auth.currentUser) {
      processPendingOfflineSyncs().catch(() => {});
    }
  });
}

/**
 * Subscribe in real time to an authenticated athlete's training data document (/athletes/{profileId}).
 */
export function subscribeUserDataFromCloud(
  profileId: string,
  onDataUpdate: (data: Record<string, unknown>) => void,
  onError?: (err: any) => void
): () => void {
  try {
    if (!db || !profileId || !auth.currentUser) return () => {};
    const userDocRef = doc(db, 'athletes', profileId);
    const unsubscribe = onSnapshot(
      userDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data) {
            if ('pin' in data) delete data.pin;
            onDataUpdate(data);
          }
        }
      },
      (err) => {
        console.warn('[subscribeUserDataFromCloud error]:', err);
        onError?.(err);
      }
    );
    return unsubscribe;
  } catch (err) {
    console.warn('[subscribeUserDataFromCloud init error]:', err);
    onError?.(err);
    return () => {};
  }
}

export async function queryLatestExecutionDatesByDayFromCloud(
  profileId: string
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  try {
    if (!db || !profileId || !auth.currentUser) return result;
    const snap = await getDoc(doc(db, 'athletes', profileId));
    if (!snap.exists()) return result;

    const data = snap.data();
    const cloudHistory = Array.isArray(data?.history) ? data.history : [];
    const cloudRoutines = Array.isArray(data?.routines) ? data.routines : [];

    const normalizeText = (v: unknown) =>
      String(v || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    const toWeekday = (raw?: string, fallbackDate?: string): string => {
      const n = normalizeText(raw);
      if (n.includes('lunes') || n === 'lun' || n.includes('dia 1')) return 'Lunes';
      if (n.includes('martes') || n === 'mar' || n.includes('dia 2')) return 'Martes';
      if (n.includes('miercoles') || n === 'mie' || n.includes('dia 3')) return 'Miércoles';
      if (n.includes('jueves') || n === 'jue' || n.includes('dia 4')) return 'Jueves';
      if (n.includes('viernes') || n === 'vie' || n.includes('dia 5')) return 'Viernes';
      if (n.includes('sabado') || n === 'sab' || n.includes('dia 6')) return 'Sábado';
      if (n.includes('domingo') || n === 'dom' || n.includes('dia 7')) return 'Domingo';
      if (fallbackDate) {
        const chileDay = getChileWeekdayName(fallbackDate);
        if (chileDay && chileDay !== 'Entrenamiento') {
          return chileDay;
        }
      }
      return 'Lunes';
    };

    const toDateKey = (rawDate: unknown): string | null => {
      if (!rawDate) return null;
      const key = getChileLocalDateKey(rawDate as string | number | Date);
      return key || null;
    };

    const exerciseToDays = new Map<string, Set<string>>();
    const routineIdToDay = new Map<string, string>();

    cloudRoutines.forEach((r: any) => {
      if (!r) return;
      const rDay = toWeekday(r.dayName || r.title);
      if (r.id) routineIdToDay.set(r.id, rDay);
      if (Array.isArray(r.exercises)) {
        r.exercises.forEach((ex: any) => {
          const exKey = normalizeText(ex?.name);
          if (!exKey) return;
          const exDay = toWeekday(ex?.dia || ex?.day || rDay);
          const set = exerciseToDays.get(exKey) || new Set<string>();
          set.add(exDay);
          exerciseToDays.set(exKey, set);
        });
      }
    });

    cloudHistory.forEach((w: any) => {
      if (!w || w.isFinished === false) return;
      const dateKey = resolveWorkoutChileDateKey(w) || toDateKey(w.date);
      if (!dateKey) return;

      const hasWork =
        (Array.isArray(w.exercisesSummary) && w.exercisesSummary.length > 0) ||
        (typeof w.completedSetsCount === 'number' && w.completedSetsCount > 0);
      if (!hasWork) return;

      const sessionDay = toWeekday(w.routineTitle, w.date);
      if (!result[sessionDay] || dateKey >= result[sessionDay]!) {
        result[sessionDay] = dateKey;
      }

      if (Array.isArray(w.exercisesSummary)) {
        w.exercisesSummary.forEach((ex: any) => {
          const exKey = normalizeText(ex?.name);
          const mappedDays = exerciseToDays.get(exKey);
          if (mappedDays) {
            mappedDays.forEach((dName) => {
              if (!result[dName] || dateKey >= result[dName]!) {
                result[dName] = dateKey;
              }
            });
          }
        });
      }
    });
  } catch (err) {
    console.warn('[queryLatestExecutionDatesByDayFromCloud error]:', err);
  }
  return result;
}

export interface CloudAthleteDocSnapshot {
  athleteId: string;
  boundUid: string | null;
  isCurrentUid: boolean;
  docExists: boolean;
  rawHistory: any[];
  rawPrs: any[];
  sessionCount: number;
  rawDoc?: Record<string, unknown>;
  error?: string;
}

/**
 * Reads all candidate athlete documents in Firestore accessible to the authenticated user:
 * - /athletes/{profileId}
 * - /athletes/{authUid}
 * - /athletes/perfil_admin_master
 * - /athletes/perfil_1
 * Returns snapshots without writing or overwriting anything.
 */
export async function fetchAllAthleteHistorySourcesFromFirebase(
  activeProfileId: string
): Promise<CloudAthleteDocSnapshot[]> {
  const results: CloudAthleteDocSnapshot[] = [];
  if (!db || !auth.currentUser) return results;

  const currentUid = auth.currentUser.uid;
  const candidateIds = Array.from(
    new Set([activeProfileId, currentUid, 'perfil_admin_master', 'perfil_1', 'perfil_default'])
  ).filter(Boolean);

  for (const docId of candidateIds) {
    try {
      const snap = await getDoc(doc(db, 'athletes', docId));
      if (snap.exists()) {
        const data = snap.data() || {};
        const boundUid = (data.authUid as string) || null;
        const rawHist = Array.isArray(data.history) ? data.history : [];
        const rawPrs = Array.isArray(data.prs) ? data.prs : [];
        results.push({
          athleteId: docId,
          boundUid,
          isCurrentUid: boundUid === currentUid || docId === currentUid,
          docExists: true,
          rawHistory: rawHist,
          rawPrs,
          sessionCount: rawHist.length,
          rawDoc: data,
        });
      } else {
        results.push({
          athleteId: docId,
          boundUid: null,
          isCurrentUid: docId === currentUid,
          docExists: false,
          rawHistory: [],
          rawPrs: [],
          sessionCount: 0,
        });
      }
    } catch (err: any) {
      // Permission denied or network error on specific doc; report safely
      results.push({
        athleteId: docId,
        boundUid: null,
        isCurrentUid: docId === currentUid,
        docExists: false,
        rawHistory: [],
        rawPrs: [],
        sessionCount: 0,
        error: err?.message || 'Error de acceso',
      });
    }
  }

  return results;
}

