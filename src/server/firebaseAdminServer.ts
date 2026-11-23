import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

// Lazy initialize Firebase Admin
let adminApp: App | null = null;
let adminAuth: Auth | null = null;
let adminDb: Firestore | null = null;
let parsedServiceAccountCache: Record<string, any> | null | undefined;

export function parseConfiguredServiceAccount(): Record<string, any> | null {
  if (parsedServiceAccountCache !== undefined) return parsedServiceAccountCache;
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    parsedServiceAccountCache = null;
    return null;
  }
  try {
    const decoded = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const obj = JSON.parse(decoded);
    if (obj && typeof obj === 'object' && obj.client_email && obj.private_key) {
      parsedServiceAccountCache = obj;
      return obj;
    }
  } catch (err) {
    console.warn('[FirebaseAdmin] FIREBASE_SERVICE_ACCOUNT_JSON inválido:', (err as any)?.message || err);
  }
  parsedServiceAccountCache = null;
  return null;
}

export function getAdminServices() {
  if (!adminApp) {
    if (getApps().length === 0) {
      const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
      const sa = parseConfiguredServiceAccount();
      if (sa) {
        adminApp = initializeApp({
          credential: cert(sa as any),
          projectId: sa.project_id || projectId,
        });
      } else {
        adminApp = initializeApp({ projectId });
      }
    } else {
      adminApp = getApps()[0];
    }
    adminAuth = getAuth(adminApp);
  }
  if (!adminDb) {
    const dbId = process.env.FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId;
    try {
      adminDb = getFirestore(adminApp, dbId);
    } catch {
      adminDb = getFirestore(adminApp);
    }
  }
  return {
    auth: adminAuth!,
    db: adminDb!,
  };
}

let cachedAdminFirestoreProbe: { checkedAt: number; ok: boolean; error?: string } | null = null;

export async function probeAdminFirestoreAccess(force = false): Promise<{ ok: boolean; error?: string }> {
  const now = Date.now();
  if (!force && cachedAdminFirestoreProbe && now - cachedAdminFirestoreProbe.checkedAt < 30_000) {
    return { ok: cachedAdminFirestoreProbe.ok, error: cachedAdminFirestoreProbe.error };
  }
  try {
    const { db } = getAdminServices();
    await db.collection('athletes').limit(1).get();
    cachedAdminFirestoreProbe = { checkedAt: now, ok: true };
    return { ok: true };
  } catch (err: any) {
    const msg = String(err?.message || err || 'Firestore Admin access unavailable');
    cachedAdminFirestoreProbe = { checkedAt: now, ok: false, error: msg };
    return { ok: false, error: msg };
  }
}

// In-memory rate limiter per IP / identifier to protect against brute-force and enumeration
interface RateLimitBucket {
  attempts: number;
  blockedUntil?: number;
}
const rateLimitMap = new Map<string, RateLimitBucket>();

export function checkRateLimit(key: string, maxAttempts = 5, windowMs = 15 * 60 * 1000): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const bucket = rateLimitMap.get(key) || { attempts: 0 };

  if (bucket.blockedUntil && bucket.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((bucket.blockedUntil - now) / 1000),
    };
  }

  if (bucket.blockedUntil && bucket.blockedUntil <= now) {
    bucket.attempts = 0;
    bucket.blockedUntil = undefined;
  }

  bucket.attempts += 1;
  if (bucket.attempts > maxAttempts) {
    bucket.blockedUntil = now + windowMs;
    rateLimitMap.set(key, bucket);
    return {
      allowed: false,
      retryAfterSec: Math.ceil(windowMs / 1000),
    };
  }

  rateLimitMap.set(key, bucket);
  return { allowed: true };
}

export function resetRateLimit(key: string) {
  rateLimitMap.delete(key);
}

/**
 * Distributed Rate Limiter:
 * Coordinates across multiple serverless/container instances (e.g. Cloud Run)
 * via atomic Firestore transactions in 'rate_limits' collection, with fast in-memory cache.
 * When failClosed=true (default for critical auth operations), if the distributed store
 * is unreachable, it fails closed to prevent cluster-wide brute force attacks.
 */
export async function checkRateLimitDistributed(
  key: string,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
  failClosed = true
): Promise<{ allowed: boolean; retryAfterSec?: number; error?: string }> {
  const now = Date.now();
  const local = rateLimitMap.get(key);

  // Fast-path memory rejection
  if (local?.blockedUntil && local.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((local.blockedUntil - now) / 1000),
    };
  }

  try {
    const { db } = getAdminServices();
    const docId = hashToken(key);
    const docRef = db.collection('rate_limits').doc(docId);

    const result = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists) {
        transaction.set(docRef, {
          key,
          attempts: 1,
          windowStartedAt: now,
          blockedUntil: 0,
          updatedAt: new Date().toISOString(),
        });
        return { allowed: true };
      }

      const data = snap.data() || {};
      const blockedUntil = Number(data.blockedUntil || 0);
      const windowStartedAt = Number(data.windowStartedAt || 0);
      const currentAttempts = Number(data.attempts || 0);

      // Blocked in distributed store
      if (blockedUntil > now) {
        return {
          allowed: false,
          retryAfterSec: Math.ceil((blockedUntil - now) / 1000),
        };
      }

      // Expired window
      if (now - windowStartedAt > windowMs) {
        transaction.set(docRef, {
          key,
          attempts: 1,
          windowStartedAt: now,
          blockedUntil: 0,
          updatedAt: new Date().toISOString(),
        });
        return { allowed: true };
      }

      const nextAttempts = currentAttempts + 1;
      if (nextAttempts > maxAttempts) {
        const newBlockedUntil = now + windowMs;
        transaction.set(
          docRef,
          {
            attempts: nextAttempts,
            blockedUntil: newBlockedUntil,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        return {
          allowed: false,
          retryAfterSec: Math.ceil(windowMs / 1000),
        };
      }

      transaction.set(
        docRef,
        {
          attempts: nextAttempts,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return { allowed: true };
    });

    if (!result.allowed) {
      rateLimitMap.set(key, {
        attempts: maxAttempts + 1,
        blockedUntil: now + (result.retryAfterSec || 900) * 1000,
      });
    }

    return result;
  } catch (err: any) {
    if (isFirestorePermissionDeniedError(err)) {
      // Cloud Run default service account without IAM role on Firestore: use in-memory rate limiter
      return checkRateLimit(key, maxAttempts, windowMs);
    }
    if (failClosed) {
      console.error('[RateLimitDistributed] Distributed rate limiter error. Failing closed for security:', err?.message || err);
      // Fail closed: reject request to protect against distributed brute force during database outage
      return {
        allowed: false,
        retryAfterSec: 60,
        error: 'El servicio de seguridad distribuido no está disponible en este momento. Intenta en 60 segundos.',
      };
    }
    // Seamless fallback to local in-memory rate limiter if failClosed is explicitly disabled
    return checkRateLimit(key, maxAttempts, windowMs);
  }
}

export async function resetRateLimitDistributed(key: string): Promise<void> {
  rateLimitMap.delete(key);
  try {
    const { db } = getAdminServices();
    const docId = hashToken(key);
    await db.collection('rate_limits').doc(docId).delete();
  } catch {}
}

export function isFirestorePermissionDeniedError(err: any): boolean {
  const code = err?.code;
  const msg = String(err?.message || err || '');
  return (
    code === 7 ||
    code === 'permission-denied' ||
    code === 'PERMISSION_DENIED' ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('Missing or insufficient permissions')
  );
}

function getFirestoreRestDocumentsUrl(): string {
  const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
  const dbId = process.env.FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || '(default)';
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(dbId)}/documents`;
}

function fromFirestoreRestValue(val: any): any {
  if (!val || typeof val !== 'object') return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('arrayValue' in val) {
    const values = Array.isArray(val.arrayValue?.values) ? val.arrayValue.values : [];
    return values.map(fromFirestoreRestValue);
  }
  if ('mapValue' in val) {
    return fromFirestoreRestFields(val.mapValue?.fields || {});
  }
  return undefined;
}

function fromFirestoreRestFields(fields: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = fromFirestoreRestValue(v);
  }
  return out;
}

function toFirestoreRestValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { integerValue: '0' };
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreRestValue) } };
  }
  if (typeof val === 'object') {
    return { mapValue: { fields: toFirestoreRestFields(val) } };
  }
  return { stringValue: String(val) };
}

function toFirestoreRestFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && v.constructor?.name === 'DeleteTransform') continue;
    fields[k] = toFirestoreRestValue(v);
  }
  return fields;
}

export async function queryCollectionByFieldWithUserToken(
  rawIdToken: string,
  collectionId: string,
  fieldPath: string,
  fieldValue: string,
  limitCount = 1
): Promise<{ ok: boolean; status: number; docs: Array<{ id: string; data: Record<string, any> }> }> {
  const baseUrl = getFirestoreRestDocumentsUrl();
  const res = await fetch(`${baseUrl}:runQuery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${rawIdToken}`,
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: 'EQUAL',
            value: { stringValue: fieldValue },
          },
        },
        limit: limitCount,
      },
    }),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, docs: [] };
  }

  const rows = (await res.json()) as Array<{ document?: { name?: string; fields?: Record<string, any> } }>;
  const docs: Array<{ id: string; data: Record<string, any> }> = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row?.document?.name) {
        const id = row.document.name.split('/').pop() || '';
        const data = fromFirestoreRestFields(row.document.fields || {});
        if (id) {
          docs.push({ id, data });
        }
      }
    }
  }
  return { ok: true, status: 200, docs };
}

export async function getDocumentWithUserToken(
  rawIdToken: string,
  collectionId: string,
  docId: string
): Promise<{ ok: boolean; status: number; exists: boolean; id: string; data?: Record<string, any> }> {
  const baseUrl = getFirestoreRestDocumentsUrl();
  const res = await fetch(`${baseUrl}/${encodeURIComponent(collectionId)}/${encodeURIComponent(docId)}`, {
    method: 'GET',
    signal:
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(8000)
        : undefined,
    headers: {
      Authorization: `Bearer ${rawIdToken}`,
    },
  });

  if (res.status === 404) {
    return { ok: true, status: 404, exists: false, id: docId };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, exists: false, id: docId };
  }

  const docJson = (await res.json()) as { name?: string; fields?: Record<string, any> };
  return {
    ok: true,
    status: 200,
    exists: true,
    id: docId,
    data: fromFirestoreRestFields(docJson.fields || {}),
  };
}

export async function patchDocumentWithUserToken(
  rawIdToken: string,
  collectionId: string,
  docId: string,
  patchData: Record<string, any>
): Promise<{ ok: boolean; status: number; data?: Record<string, any> }> {
  const cleanEntries = Object.entries(patchData || {}).filter(
    ([, v]) => v !== undefined && !(v && typeof v === 'object' && v.constructor?.name === 'DeleteTransform')
  );
  if (cleanEntries.length === 0) {
    return { ok: true, status: 200 };
  }
  const cleanObj = Object.fromEntries(cleanEntries);
  const maskParams = cleanEntries
    .map(([k]) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  const baseUrl = getFirestoreRestDocumentsUrl();
  const res = await fetch(
    `${baseUrl}/${encodeURIComponent(collectionId)}/${encodeURIComponent(docId)}?${maskParams}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawIdToken}`,
      },
      body: JSON.stringify({
        fields: toFirestoreRestFields(cleanObj),
      }),
    }
  );
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const docJson = (await res.json()) as { fields?: Record<string, any> };
  return {
    ok: true,
    status: 200,
    data: fromFirestoreRestFields(docJson.fields || {}),
  };
}

export async function getSubcollectionDocWithUserToken(
  rawIdToken: string,
  parentCollection: string,
  parentId: string,
  subcollection: string,
  docId: string
): Promise<{ ok: boolean; status: number; exists: boolean; id: string; data?: Record<string, any> }> {
  const baseUrl = getFirestoreRestDocumentsUrl();
  const res = await fetch(
    `${baseUrl}/${encodeURIComponent(parentCollection)}/${encodeURIComponent(parentId)}/${encodeURIComponent(subcollection)}/${encodeURIComponent(docId)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${rawIdToken}` },
    }
  );
  if (res.status === 404) {
    return { ok: true, status: 404, exists: false, id: docId };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, exists: false, id: docId };
  }
  const docJson = (await res.json()) as { fields?: Record<string, any> };
  return {
    ok: true,
    status: 200,
    exists: true,
    id: docId,
    data: fromFirestoreRestFields(docJson.fields || {}),
  };
}

export async function putSubcollectionDocWithUserToken(
  rawIdToken: string,
  parentCollection: string,
  parentId: string,
  subcollection: string,
  docId: string,
  data: Record<string, any>
): Promise<{ ok: boolean; status: number; data?: Record<string, any>; error?: string }> {
  const baseUrl = getFirestoreRestDocumentsUrl();
  const res = await fetch(
    `${baseUrl}/${encodeURIComponent(parentCollection)}/${encodeURIComponent(parentId)}/${encodeURIComponent(subcollection)}/${encodeURIComponent(docId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawIdToken}`,
      },
      body: JSON.stringify({
        fields: toFirestoreRestFields(data),
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: errText.slice(0, 300) };
  }
  const docJson = (await res.json()) as { fields?: Record<string, any> };
  return {
    ok: true,
    status: 200,
    data: fromFirestoreRestFields(docJson.fields || {}),
  };
}

export async function listSubcollectionDocsWithUserToken(
  rawIdToken: string,
  parentCollection: string,
  parentId: string,
  subcollection: string
): Promise<{ ok: boolean; status: number; docs: Array<{ id: string; data: Record<string, any> }> }> {
  const baseUrl = getFirestoreRestDocumentsUrl();
  const res = await fetch(
    `${baseUrl}/${encodeURIComponent(parentCollection)}/${encodeURIComponent(parentId)}/${encodeURIComponent(subcollection)}?pageSize=50`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${rawIdToken}` },
    }
  );
  if (!res.ok) {
    return { ok: false, status: res.status, docs: [] };
  }
  const json = (await res.json()) as { documents?: Array<{ name?: string; fields?: Record<string, any> }> };
  const docs = (json.documents || [])
    .map((doc) => ({
      id: doc.name?.split('/').pop() || '',
      data: fromFirestoreRestFields(doc.fields || {}),
    }))
    .filter((d) => Boolean(d.id));
  return { ok: true, status: 200, docs };
}

export async function deleteSubcollectionDocWithUserToken(
  rawIdToken: string,
  parentCollection: string,
  parentId: string,
  subcollection: string,
  docId: string
): Promise<{ ok: boolean; status: number }> {
  const baseUrl = getFirestoreRestDocumentsUrl();
  const res = await fetch(
    `${baseUrl}/${encodeURIComponent(parentCollection)}/${encodeURIComponent(parentId)}/${encodeURIComponent(subcollection)}/${encodeURIComponent(docId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${rawIdToken}` },
    }
  );
  return { ok: res.ok || res.status === 404, status: res.status };
}

// Secure SHA-256 token hashing
export function hashToken(rawToken: string): string {
  const clean = String(rawToken || '').trim().toUpperCase();
  return crypto.createHash('sha256').update(clean).digest('hex');
}

/**
 * Hardened Key Derivation Function (KDF) using scrypt for offline brute-force resistance.
 * A 4-digit PIN has only 10,000 combinations. Plain SHA-256 can be broken in milliseconds offline.
 * scrypt with N=16384, r=8, p=1 and a 16-byte cryptographically random salt requires
 * 16MB RAM and substantial CPU per candidate evaluation, rendering offline GPU/ASIC rainbow attacks infeasible.
 */
export function hashPinWithScrypt(pin: string, customSalt?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = customSalt || crypto.randomBytes(16);
    crypto.scrypt(pin, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (err, derivedKey) => {
      if (err) return reject(err);
      const saltHex = salt.toString('hex');
      const hashHex = derivedKey.toString('hex');
      resolve(`scrypt$16384$8$1$${saltHex}$${hashHex}`);
    });
  });
}

/**
 * Verifies legacy candidates (plaintext or legacy SHA-256) while upgrading stored credentials
 * to memory-hard scrypt. Provides progressive retirement: once verified, legacy credentials
 * are re-hashed with scrypt, and completely purged upon final migration confirmation.
 */
export async function verifyPinHardened(
  candidatePin: string,
  storedCredential: string
): Promise<{ matches: boolean; needsRehash: boolean; upgradedHash?: string }> {
  if (!candidatePin || !storedCredential) {
    return { matches: false, needsRehash: false };
  }

  // 1. Hardened scrypt format: scrypt$N$r$p$saltHex$hashHex
  if (storedCredential.startsWith('scrypt$')) {
    const parts = storedCredential.split('$');
    if (parts.length === 6) {
      const N = parseInt(parts[1], 10);
      const r = parseInt(parts[2], 10);
      const p = parseInt(parts[3], 10);
      const salt = Buffer.from(parts[4], 'hex');
      const expectedHash = Buffer.from(parts[5], 'hex');

      return new Promise((resolve) => {
        crypto.scrypt(candidatePin, salt, expectedHash.length, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, derivedKey) => {
          if (err) return resolve({ matches: false, needsRehash: false });
          const matches = crypto.timingSafeEqual(derivedKey, expectedHash);
          resolve({ matches, needsRehash: false });
        });
      });
    }
  }

  // 2. Legacy SHA-256 (64 hex characters)
  if (storedCredential.length === 64 && /^[0-9a-f]{64}$/i.test(storedCredential)) {
    const candidateHash = hashToken(candidatePin);
    const matches = constantTimeCompare(candidateHash, storedCredential);
    if (matches) {
      const upgradedHash = await hashPinWithScrypt(candidatePin);
      return { matches: true, needsRehash: true, upgradedHash };
    }
    return { matches: false, needsRehash: false };
  }

  // 3. Legacy Plaintext PIN (e.g. "1234")
  const matches = constantTimeCompare(candidatePin, storedCredential);
  if (matches) {
    const upgradedHash = await hashPinWithScrypt(candidatePin);
    return { matches: true, needsRehash: true, upgradedHash };
  }

  return { matches: false, needsRehash: false };
}

// Constant-time string comparison to prevent timing attacks
export function constantTimeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Constant-time compare against dummy to prevent length leakage
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Server-authoritative Admin Identity configuration
const DEFAULT_ADMIN_EMAIL = '';

export function getAuthorizedAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  const list = raw
    .split(',')
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
  return list;
}

export function isAuthorizedAdminEmail(email?: string | null): boolean {
  const normalized = String(email || '').toLowerCase().trim();
  if (!normalized) return false;
  return getAuthorizedAdminEmails().includes(normalized);
}

/**
 * Authorizes Master Admin strictly from cryptographically verified Firebase ID Token claims:
 * - Sign-in provider MUST be 'google.com'
 * - Email MUST be verified (`email_verified === true`)
 * - Email MUST match server-private ADMIN_EMAIL / ADMIN_EMAILS configuration
 * Compatible with Google Cloud Starter Tier (zero Custom Claims or Auth Admin IAM required).
 */
export function isAuthorizedAdminToken(decoded: {
  email?: string | null;
  emailVerified?: boolean;
  signInProvider?: string;
}): boolean {
  return Boolean(
    isAuthorizedAdminEmail(decoded.email) &&
      decoded.emailVerified === true &&
      decoded.signInProvider === 'google.com'
  );
}

// Authenticated user request extension
export interface AuthenticatedUser {
  uid: string;
  email?: string;
  isAdmin: boolean;
  athleteId?: string;
  emailVerified?: boolean;
  signInProvider?: string;
  signInIdentities?: Record<string, string[]>;
  authTime?: number;
}

export async function verifyAuthTokenMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Cabecera Authorization Bearer requerida.' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const { auth } = getAdminServices();
    const decoded = await auth.verifyIdToken(token);
    const signInProvider = decoded.firebase?.sign_in_provider;
    const emailVerified = Boolean(decoded.email_verified);
    const isAdmin = isAuthorizedAdminToken({
      email: decoded.email,
      emailVerified,
      signInProvider,
    });
    (req as any).rawIdToken = token;
    (req as any).user = {
      uid: decoded.uid,
      email: decoded.email,
      isAdmin,
      emailVerified,
      signInProvider,
      signInIdentities: decoded.firebase?.identities,
      authTime: typeof decoded.auth_time === 'number' ? decoded.auth_time : undefined,
    } as AuthenticatedUser;
    next();
  } catch (err: any) {
    return res.status(401).json({
      success: false,
      code: err?.code || 'auth/invalid-id-token',
      operation: 'verifyIdToken',
      error: 'Token de autenticación inválido o expirado.',
    });
  }
}
