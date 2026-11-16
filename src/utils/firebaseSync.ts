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
import { Profile } from '../types/index.ts';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { safeApiFetchJson } from './safeApiFetch.ts';

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
export const DEFAULT_PUBLIC_APP_URL = 'https://ais-pre-56i2tt63sua7ovhyxwpgjs-888570249716.us-east1.run.app';

export function getPublicAppUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('lazcakon_public_app_url');
      if (stored) return stored.trim();
    }
  } catch {}
  if (typeof window !== 'undefined') {
    const origin = window.location.origin || '';
    if (
      origin &&
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
    const res = await fetch(`/api/admin/athletes/${encodeURIComponent(profileId)}`, {
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
    }>('/api/auth/migrate-legacy', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = result.data;
    if (!result.ok || !result.isJson || !data?.success) {
      return {
        success: false,
        error:
          result.error ||
          data?.error ||
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
    const res = await fetch(`/api/admin/invites/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      headers,
      credentials: 'same-origin',
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
// DEFERRED OFFLINE SYNC SYSTEM (AUTH-GATED QUEUE + SAFE PERMISSION HANDLING)
// ============================================================================

const OFFLINE_SYNC_QUEUE_KEY = 'lazcakon_pending_offline_sync_queue';

export interface PendingOfflineSync {
  profileId: string;
  data: Record<string, unknown>;
  queuedAt: string;
}

export function queueOfflineSync(profileId: string, data: Record<string, unknown>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(OFFLINE_SYNC_QUEUE_KEY);
    const queue: PendingOfflineSync[] = raw ? JSON.parse(raw) : [];

    const existingIndex = queue.findIndex((item) => item.profileId === profileId);
    if (existingIndex >= 0) {
      queue[existingIndex] = {
        profileId,
        data: { ...queue[existingIndex].data, ...data },
        queuedAt: new Date().toISOString(),
      };
    } else {
      queue.push({
        profileId,
        data,
        queuedAt: new Date().toISOString(),
      });
    }

    localStorage.setItem(OFFLINE_SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn('[OfflineSync queue error]:', err);
  }
}

export function getOfflineSyncQueue(): PendingOfflineSync[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(OFFLINE_SYNC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function processPendingOfflineSyncs(): Promise<{ syncedCount: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { syncedCount: 0 };
  }
  if (!auth.currentUser) {
    return { syncedCount: 0 };
  }

  const queue = getOfflineSyncQueue();
  if (queue.length === 0) return { syncedCount: 0 };

  const remainingQueue: PendingOfflineSync[] = [];
  let syncedCount = 0;

  for (const item of queue) {
    try {
      const res = await syncUserDataToFirebase(item.profileId, item.data);
      if (res.success) {
        syncedCount++;
      } else if (!res.permissionDenied) {
        // Retry only transient non-permission errors
        remainingQueue.push(item);
      }
    } catch {
      remainingQueue.push(item);
    }
  }

  try {
    if (typeof localStorage !== 'undefined') {
      if (remainingQueue.length > 0) {
        localStorage.setItem(OFFLINE_SYNC_QUEUE_KEY, JSON.stringify(remainingQueue));
      } else {
        localStorage.removeItem(OFFLINE_SYNC_QUEUE_KEY);
      }
    }
  } catch {}

  return { syncedCount };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (auth.currentUser) {
      processPendingOfflineSyncs().catch(() => {});
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
  onDataUpdate: (data: Record<string, unknown>) => void
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
      }
    );
    return unsubscribe;
  } catch (err) {
    console.warn('[subscribeUserDataFromCloud init error]:', err);
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
        const d = new Date(fallbackDate);
        if (!isNaN(d.getTime())) {
          const map: Record<number, string> = {
            1: 'Lunes',
            2: 'Martes',
            3: 'Miércoles',
            4: 'Jueves',
            5: 'Viernes',
            6: 'Sábado',
            0: 'Domingo',
          };
          return map[d.getDay()] || 'Lunes';
        }
      }
      return 'Lunes';
    };

    const toDateKey = (rawDate: unknown): string | null => {
      if (!rawDate) return null;
      if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
        return rawDate.trim();
      }
      const d = new Date(String(rawDate));
      if (isNaN(d.getTime())) return null;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
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
      const dateKey = toDateKey(w.date);
      if (!dateKey) return;

      const hasWork =
        (Array.isArray(w.exercisesSummary) && w.exercisesSummary.length > 0) ||
        (typeof w.completedSetsCount === 'number' && w.completedSetsCount > 0);
      if (!hasWork) return;

      const sessionDay =
        (w.routineId && routineIdToDay.get(w.routineId)) || toWeekday(w.routineTitle, w.date);
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
