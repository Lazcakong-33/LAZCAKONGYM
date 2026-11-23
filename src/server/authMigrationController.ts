import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  Firestore as AdminFirestore,
  Transaction as AdminTransaction,
  DocumentSnapshot as AdminDocumentSnapshot,
  QueryDocumentSnapshot as AdminQueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import {
  getAdminServices,
  parseConfiguredServiceAccount,
  checkRateLimitDistributed,
  resetRateLimitDistributed,
  hashToken,
  hashPinWithScrypt,
  verifyPinHardened,
  constantTimeCompare,
  isAuthorizedAdminEmail,
  isAuthorizedAdminToken,
  isFirestorePermissionDeniedError,
  queryCollectionByFieldWithUserToken,
  getDocumentWithUserToken,
  patchDocumentWithUserToken,
} from './firebaseAdminServer.ts';
import type { AuthenticatedUser } from './firebaseAdminServer.ts';

export interface AuthControllerDeps {
  getAdminServices?: typeof getAdminServices;
  checkRateLimitDistributed?: typeof checkRateLimitDistributed;
  resetRateLimitDistributed?: typeof resetRateLimitDistributed;
}

export interface ServerBroadcastState {
  version: string;
  buildId: string;
  broadcastId: string;
  updatedAt: string;
  message: string;
}

let serverBroadcastState: ServerBroadcastState | null = null;

export function getServerBroadcastState(): ServerBroadcastState | null {
  return serverBroadcastState;
}

export function setServerBroadcastState(next: ServerBroadcastState | null) {
  serverBroadcastState = next;
}

function sanitizeAthleteForClient(
  data: Record<string, any>,
  docId: string,
  authUid: string,
  isAdmin: boolean
) {
  const { pin: _omittedPin, ...rest } = data || {};
  return {
    ...rest,
    id: data?.id || docId,
    name: data?.name || 'Atleta',
    email: String(data?.email || '').toLowerCase().trim(),
    authUid,
    isAdmin,
    avatar: data?.avatar || '🦍',
    goal: data?.goal || 'Hipertrofia & Masa',
    weeklyTargetDays: typeof data?.weeklyTargetDays === 'number' ? data.weeklyTargetDays : 5,
    soundEnabled: data?.soundEnabled !== false,
    vibrationEnabled: data?.vibrationEnabled !== false,
    weightUnit: data?.weightUnit === 'lb' ? 'lb' : 'kg',
    createdAt: data?.createdAt || new Date().toISOString(),
  };
}

function normalizeInviteToken(raw: unknown): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    if (trimmed.includes('invite=')) {
      const match = trimmed.match(/[?&]invite=([^&#\s]+)/i);
      if (match && match[1]) {
        return decodeURIComponent(match[1].trim()).toUpperCase();
      }
    }
  } catch {}
  return trimmed.toUpperCase();
}

function generateSecureInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (len: number) => {
    const bytes = crypto.randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) {
      out += chars.charAt(bytes[i] % chars.length);
    }
    return out;
  };
  return `LZK-${pick(4)}-${pick(4)}`;
}

async function resolveInviteDocRefAndSnap(
  db: AdminFirestore,
  rawToken: string,
  transaction?: AdminTransaction
) {
  const tokenHashKey = hashToken(rawToken);
  const hashedRef = db.collection('invites').doc(tokenHashKey);
  const hashedSnap = transaction ? await transaction.get(hashedRef) : await hashedRef.get();
  if (hashedSnap.exists) {
    return { ref: hashedRef, snap: hashedSnap };
  }

  const legacyRef = db.collection('invites').doc(rawToken);
  const legacySnap = transaction ? await transaction.get(legacyRef) : await legacyRef.get();
  if (legacySnap.exists) {
    return { ref: legacyRef, snap: legacySnap };
  }

  return { ref: hashedRef, snap: hashedSnap };
}

/**
 * POST /api/auth/migrate-legacy
 * Starter-Tier-compatible atomic linkage of a legacy athlete profile to the caller's
 * verified Firebase Auth session (Google or Email+Password).
 * Security guarantees:
 * 1. Caller MUST already be authenticated via Firebase Auth (`verifyAuthTokenMiddleware` -> `verifyIdToken`).
 * 2. NEVER auto-links by email alone: requires proving ownership via legacy PIN (scrypt/sha256/legacy)
 *    OR single-use Coach recovery code (`LZK-REC-XXXXXX`).
 * 3. Distributed rate-limiting per IP + target email prevents brute-force PIN enumeration.
 * 4. Atomic Firestore transaction prevents duplicate profiles, UID takeovers, and race conditions.
 * 5. Master Admin profiles can ONLY be linked by a verified Google Admin session (`isAuthorizedAdminToken`).
 * 6. Purges plaintext `pin` and zeroizes `athlete_credentials` upon completion.
 */
export async function handleMigrateLegacyAuth(
  req: Request,
  res: Response,
  deps?: AuthControllerDeps
) {
  const caller = (req as any).user as AuthenticatedUser | undefined;
  if (!caller || !caller.uid) {
    return res.status(401).json({
      success: false,
      error: 'Inicia sesión primero con Google o tu nueva contraseña en Firebase Auth para vincular tu perfil.',
    });
  }

  const email = String(req.body?.email || caller.email || '').toLowerCase().trim();
  const pin = String(req.body?.pin || '').trim();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  if (!email || !pin) {
    return res.status(400).json({
      success: false,
      error: 'Correo del perfil heredado y PIN o código de recuperación son obligatorios.',
    });
  }

  const resolveAdmin = deps?.getAdminServices || getAdminServices;
  const checkRate = deps?.checkRateLimitDistributed || checkRateLimitDistributed;
  const resetRate = deps?.resetRateLimitDistributed || resetRateLimitDistributed;

  // Distributed Rate limiting per IP + Email
  const rateLimitKey = `migrate:${ip}:${email}`;
  const rateCheck = await checkRate(rateLimitKey, 5, 15 * 60 * 1000);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: `Demasiados intentos fallidos. Intenta nuevamente en ${rateCheck.retryAfterSec || 900} segundos.`,
    });
  }

  try {
    const { db } = resolveAdmin();
    const nowIso = new Date().toISOString();

    const txResult = await db.runTransaction(async (transaction) => {
      // 1. Prevent caller UID from hijacking a second profile if already linked elsewhere
      const callerOwnedSnap = await transaction.get(
        db.collection('athletes').where('authUid', '==', caller.uid).limit(1)
      );

      // 2. Locate legacy profile by email
      const legacySnap = await transaction.get(
        db.collection('athletes').where('email', '==', email).limit(1)
      );
      if (legacySnap.empty) {
        return { ok: false as const, status: 401, error: 'Credenciales inválidas.' };
      }

      const athleteDoc = legacySnap.docs[0];
      const athleteData = athleteDoc.data() || {};

      if (!callerOwnedSnap.empty && callerOwnedSnap.docs[0].id !== athleteDoc.id) {
        return {
          ok: false as const,
          status: 409,
          error: 'Tu sesión actual de Firebase Auth ya está vinculada a otro perfil de atleta.',
        };
      }

      // 3. Reject deleted/tombstoned athletes
      const deletedSnap = await transaction.get(db.collection('deleted_athletes').doc(athleteDoc.id));
      if (deletedSnap.exists) {
        return {
          ok: false as const,
          status: 403,
          error: 'Esta cuenta de atleta fue eliminada por la administración.',
        };
      }

      // 4. Anti-Hijacking Guard: never overwrite another user's authUid or re-claim confirmed profile
      if (athleteData.authUid && athleteData.authUid !== caller.uid) {
        return {
          ok: false as const,
          status: 409,
          alreadyLinkedToAnotherUid: true,
          linkingConflict: true,
          error: 'Conflicto de vinculación: este perfil ya está vinculado a otra cuenta de Firebase Authentication.',
        };
      }
      if (athleteData.migrationStatus === 'confirmed' && athleteData.authUid) {
        return {
          ok: false as const,
          status: 409,
          alreadyMigrated: true,
          sameUid: athleteData.authUid === caller.uid,
          error: 'Este perfil ya completó la migración a Firebase Authentication.',
        };
      }

      // 5. Master Admin protection: only Google-verified ADMIN_EMAIL may link the Master Admin profile
      if (isAuthorizedAdminEmail(email) || athleteDoc.id === 'perfil_admin_master') {
        if (!isAuthorizedAdminToken(caller)) {
          return {
            ok: false as const,
            status: 403,
            error: 'La cuenta de Administrador Master solo puede vincularse mediante Google Sign-In verificado.',
          };
        }
      }

      // 6. Verify identity proof: Coach single-use recovery code OR legacy PIN (scrypt / legacy hash)
      const credDocRef = db.collection('athlete_credentials').doc(athleteDoc.id);
      const credSnap = await transaction.get(credDocRef);
      const credData = credSnap.exists ? credSnap.data() || {} : {};

      let verifiedBy: 'recovery_code' | 'legacy_pin' | null = null;
      const upperCandidate = pin.toUpperCase();

      if (
        upperCandidate.startsWith('LZK-REC-') &&
        credData.recoveryCodeHash &&
        credData.recoveryUsed === false &&
        Number(credData.recoveryExpiresAt || 0) > Date.now()
      ) {
        const candidateHash = hashToken(upperCandidate);
        if (constantTimeCompare(candidateHash, String(credData.recoveryCodeHash))) {
          verifiedBy = 'recovery_code';
        }
      }

      if (!verifiedBy) {
        const storedPin = String(credData.pinHash || credData.pin || athleteData.pin || '').trim();
        if (!storedPin) {
          return {
            ok: false as const,
            status: 401,
            error:
              'Esta cuenta no tiene PIN heredado activo. Solicita un código de recuperación temporal al Coach o inicia sesión con tu método vinculado.',
          };
        }

        const verification = await verifyPinHardened(pin, storedPin);
        if (!verification.matches) {
          return { ok: false as const, status: 401, error: 'Credenciales inválidas.' };
        }
        verifiedBy = 'legacy_pin';
      }

      const targetIsAdmin = isAuthorizedAdminToken(caller) && isAuthorizedAdminEmail(email);

      const updatePayload: Record<string, any> = {
        authUid: caller.uid,
        isAdmin: targetIsAdmin,
        migrationStatus: 'confirmed',
        migratedAt: nowIso,
        confirmedAt: nowIso,
        legacyPinPurged: true,
        serverIdentityVerified: true,
        authProviderConfirmed: caller.signInProvider || 'password',
        pin: FieldValue.delete(),
      };

      transaction.set(athleteDoc.ref, updatePayload, { merge: true });

      // Zeroize legacy credentials and mark recovery code consumed
      if (credSnap.exists) {
        transaction.set(
          credDocRef,
          {
            athleteId: athleteDoc.id,
            email,
            pinHash: FieldValue.delete(),
            pin: FieldValue.delete(),
            recoveryCodeHash: FieldValue.delete(),
            recoveryUsed: true,
            recoveryConsumedAt: nowIso,
            purgedAt: nowIso,
            linkedAuthUid: caller.uid,
          },
          { merge: true }
        );
      }

      const auditRef = db.collection('security_audit_logs').doc();
      transaction.set(auditRef, {
        eventType: 'LEGACY_PROFILE_MIGRATED_STARTER_TIER',
        athleteId: athleteDoc.id,
        authUid: caller.uid,
        profileEmail: email,
        authEmail: caller.email || '',
        verifiedBy,
        signInProvider: caller.signInProvider || 'unknown',
        timestamp: nowIso,
      });

      return {
        ok: true as const,
        status: 200,
        athleteId: athleteDoc.id,
        isAdmin: targetIsAdmin,
        athleteData: { ...athleteData, ...updatePayload },
      };
    });

    if (!txResult.ok) {
      return res.status(txResult.status).json({
        success: false,
        alreadyMigrated: Boolean((txResult as any).alreadyMigrated),
        alreadyLinkedToAnotherUid: Boolean((txResult as any).alreadyLinkedToAnotherUid),
        linkingConflict: Boolean((txResult as any).linkingConflict),
        sameUid: Boolean((txResult as any).sameUid),
        error: txResult.error,
      });
    }

    await resetRate(rateLimitKey);

    return res.status(200).json({
      success: true,
      athleteId: txResult.athleteId,
      authUid: caller.uid,
      isAdmin: txResult.isAdmin,
      name: txResult.athleteData.name,
      profile: sanitizeAthleteForClient(
        txResult.athleteData,
        txResult.athleteId,
        caller.uid,
        txResult.isAdmin
      ),
      message: 'Identidad verificada y perfil heredado vinculado exitosamente.',
    });
  } catch (error: any) {
    const rawIdToken = (req as any).rawIdToken as string | undefined;
    if (isFirestorePermissionDeniedError(error) && rawIdToken) {
      try {
        const byUid = await queryCollectionByFieldWithUserToken(
          rawIdToken,
          'athletes',
          'authUid',
          caller.uid,
          1
        );
        if (byUid.ok && byUid.docs.length > 0) {
          return res.status(409).json({
            success: false,
            alreadyMigrated: true,
            sameUid: true,
            athleteId: byUid.docs[0].id,
            error:
              'Este perfil ya completó la migración a Firebase Authentication. Inicia sesión normalmente con tu correo y contraseña o Google.',
          });
        }
      } catch {}
    }
    console.error('[handleMigrateLegacyAuth error]:', error);
    return res.status(500).json({
      success: false,
      code: error?.code || 'server/migration-error',
      operation: 'handleMigrateLegacyAuth',
      error: 'Error del servidor procesando vinculación.',
    });
  }
}

let adminFirestorePermissionDeniedDetected = false;

function sanitizeHintAthleteId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'perfil_default') return undefined;
  return /^[A-Za-z0-9_-]{1,128}$/.test(trimmed) ? trimmed : undefined;
}

async function handleSessionInitWithUserToken(
  res: Response,
  user: AuthenticatedUser,
  rawIdToken: string,
  hintAthleteId?: string
) {
  const normalizedEmail = String(user.email || '').toLowerCase().trim();
  const isVerifiedEmail = Boolean(user.emailVerified);
  const activeProvider = String(user.signInProvider || '').trim();
  const isAuthorizedAdmin = isAuthorizedAdminToken(user);
  const targetIsAdmin = isAuthorizedAdmin;

  // 1. Resolve existing athlete doc strictly bound by authUid.
  // If client supplied a valid hintAthleteId from its local binding, fetch athlete + deleted tombstone in parallel
  // (1 round-trip instead of 2-3 sequential calls), STRICTLY verifying server-side that doc.authUid === user.uid.
  let resolvedDoc: { id: string; data: Record<string, any> } | null = null;
  let precheckedDeleted: { athleteId: string; ok: boolean; exists: boolean } | null = null;

  if (hintAthleteId) {
    const [hintDoc, hintDeleted] = await Promise.all([
      getDocumentWithUserToken(rawIdToken, 'athletes', hintAthleteId),
      getDocumentWithUserToken(rawIdToken, 'deleted_athletes', hintAthleteId),
    ]);
    if (hintDoc.ok && hintDoc.exists && hintDoc.data && hintDoc.data.authUid === user.uid) {
      resolvedDoc = { id: hintDoc.id, data: hintDoc.data };
      precheckedDeleted = {
        athleteId: hintDoc.id,
        ok: hintDeleted.ok,
        exists: hintDeleted.exists,
      };
    }
  }

  if (!resolvedDoc) {
    const byUidRes = await queryCollectionByFieldWithUserToken(
      rawIdToken,
      'athletes',
      'authUid',
      user.uid,
      1
    );
    if (byUidRes.ok && byUidRes.docs.length > 0) {
      resolvedDoc = byUidRes.docs[0];
    }
  }

  // Fallback check if document ID itself equals user.uid
  if (!resolvedDoc) {
    const directUidDoc = await getDocumentWithUserToken(rawIdToken, 'athletes', user.uid);
    if (directUidDoc.ok && directUidDoc.exists && directUidDoc.data) {
      resolvedDoc = { id: directUidDoc.id, data: directUidDoc.data };
    }
  }

  // 2. If not yet bound by authUid, check Master Admin resolution
  if (!resolvedDoc && isAuthorizedAdmin) {
    if (normalizedEmail) {
      const byEmailRes = await queryCollectionByFieldWithUserToken(
        rawIdToken,
        'athletes',
        'email',
        normalizedEmail,
        1
      );
      if (byEmailRes.ok && byEmailRes.docs.length > 0) {
        const candidate = byEmailRes.docs[0];
        if (candidate.data.authUid && candidate.data.authUid !== user.uid) {
          return res.status(409).json({
            success: false,
            alreadyLinkedToAnotherUid: true,
            linkingConflict: true,
            error: 'Este correo ya está vinculado a otra cuenta de Firebase Authentication.',
          });
        }
        resolvedDoc = candidate;
      }
    }

    if (!resolvedDoc) {
      const masterAdminId = 'perfil_admin_master';
      const existingMaster = await getDocumentWithUserToken(rawIdToken, 'athletes', masterAdminId);
      if (existingMaster.ok && existingMaster.exists && existingMaster.data) {
        if (existingMaster.data.authUid && existingMaster.data.authUid !== user.uid) {
          return res.status(409).json({
            success: false,
            alreadyLinkedToAnotherUid: true,
            linkingConflict: true,
            error: 'El perfil Master Admin ya está vinculado a otro UID.',
          });
        }
        resolvedDoc = { id: masterAdminId, data: existingMaster.data };
      } else {
        const nowIso = new Date().toISOString();
        const masterProfile: Record<string, any> = {
          id: masterAdminId,
          name: 'Camilo Lazcano (Coach Admin)',
          email: normalizedEmail,
          authUid: user.uid,
          isAdmin: true,
          migrationStatus: 'confirmed',
          avatar: '👑',
          goal: 'Fuerza Máxima',
          weeklyTargetDays: 5,
          soundEnabled: true,
          vibrationEnabled: true,
          weightUnit: 'kg',
          weightKg: 95,
          routines: [],
          history: [],
          prs: {},
          bodyWeightLogs: [],
          createdAt: nowIso,
          lastSyncedAt: nowIso,
        };
        const created = await patchDocumentWithUserToken(
          rawIdToken,
          'athletes',
          masterAdminId,
          masterProfile
        );
        resolvedDoc = {
          id: masterAdminId,
          data: created.data || masterProfile,
        };
      }
    }
  }

  if (!resolvedDoc) {
    if (isAuthorizedAdminEmail(normalizedEmail) && !isAuthorizedAdmin) {
      return res.status(409).json({
        success: false,
        linkingConflict: true,
        requiresLegacyVerification: false,
        error:
          'Este correo corresponde al Administrador Master, pero el perfil aún no tiene vinculado este authUid o requiere iniciar sesión con Google ("Continuar con Google") para validar permisos.',
      });
    }
    return res.status(403).json({
      success: false,
      error:
        'No se encontró un perfil de atleta vinculado a tu cuenta (authUid). Si tienes un código de invitación actívalo, o si eres un perfil antiguo pendiente usa la opción de vinculación.',
    });
  }

  // 3. Reject deleted/tombstoned profiles (reuse parallel check if hint matched)
  const deletedDoc =
    precheckedDeleted && precheckedDeleted.athleteId === resolvedDoc.id
      ? precheckedDeleted
      : await getDocumentWithUserToken(rawIdToken, 'deleted_athletes', resolvedDoc.id);
  if (deletedDoc.ok && deletedDoc.exists) {
    return res.status(403).json({
      success: false,
      error: 'Tu perfil ha sido dado de baja por la administración.',
    });
  }

  const athleteData = resolvedDoc.data || {};

  // Only patch if Admin needs to bind authUid/isAdmin on their profile
  if (isAuthorizedAdmin && (athleteData.authUid !== user.uid || athleteData.isAdmin !== true)) {
    const adminPatch: Record<string, any> = {
      authUid: user.uid,
      isAdmin: true,
      migrationStatus: 'confirmed',
      ...(normalizedEmail && !athleteData.email ? { email: normalizedEmail } : {}),
    };
    await patchDocumentWithUserToken(rawIdToken, 'athletes', resolvedDoc.id, adminPatch).catch(() => {});
    Object.assign(athleteData, adminPatch);
  }

  const adminRequiresGoogleSignIn = Boolean(
    isAuthorizedAdminEmail(user.email) && !targetIsAdmin
  );

  return res.status(200).json({
    success: true,
    athleteId: resolvedDoc.id,
    authUid: user.uid,
    isAdmin: targetIsAdmin,
    signInProvider: activeProvider || null,
    emailVerified: isVerifiedEmail,
    adminRequiresGoogleSignIn,
    claimsUpdated: false,
    profile: sanitizeAthleteForClient(
      athleteData,
      resolvedDoc.id,
      user.uid,
      targetIsAdmin
    ),
  });
}

/**
 * POST /api/auth/session-init
 * Starter-Tier compatible session initializer:
 * - Relies strictly on verified Firebase ID token (`req.user` from `verifyIdToken`).
 * - ZERO Auth Admin IAM calls (`getUser`, `setCustomUserClaims`, `createCustomToken`).
 * - Resolves /athletes profile by `authUid`.
 * - NEVER auto-links a non-admin legacy athlete profile solely by matching email;
 *   returns 409 `{ requiresLegacyVerification: true }` ONLY if the profile is still unmigrated.
 * - If a profile is already migrated (`migrationStatus === 'confirmed'`) but has a missing or
 *   conflicting `authUid`, reports `linkingConflict: true` without restarting migration.
 * - Authorizes Master Admin strictly via verified Google Sign-In (`isAuthorizedAdminToken`).
 */
export async function handleSessionInit(
  req: Request,
  res: Response,
  deps?: AuthControllerDeps
) {
  const user = (req as any).user as AuthenticatedUser | undefined;
  if (!user || !user.uid) {
    return res.status(401).json({ success: false, error: 'Autenticación de Firebase requerida.' });
  }

  const rawIdToken = (req as any).rawIdToken as string | undefined;
  const hintAthleteId = sanitizeHintAthleteId(req.body?.hintAthleteId);

  // Fast-path on Starter-Tier Cloud Run without FIREBASE_SERVICE_ACCOUNT_JSON:
  // skip the guaranteed-to-fail Admin Firestore gRPC call (code 7 PERMISSION_DENIED)
  // and resolve directly via Firestore REST with the verified Firebase user token.
  if (
    !deps?.getAdminServices &&
    rawIdToken &&
    (!parseConfiguredServiceAccount() || adminFirestorePermissionDeniedDetected)
  ) {
    try {
      return await handleSessionInitWithUserToken(res, user, rawIdToken, hintAthleteId);
    } catch (userTokenErr: any) {
      console.error('[handleSessionInitWithUserToken direct error]:', userTokenErr);
      return res.status(500).json({
        success: false,
        code: userTokenErr?.code || 'server/session-init-error',
        operation: 'handleSessionInit',
        error: 'Error inicializando sesión autenticada.',
      });
    }
  }

  try {
    const resolveAdmin = deps?.getAdminServices || getAdminServices;
    const { db } = resolveAdmin();

    const normalizedEmail = String(user.email || '').toLowerCase().trim();
    const isVerifiedEmail = Boolean(user.emailVerified);
    const activeProvider = String(user.signInProvider || '').trim();
    const isAuthorizedAdmin = isAuthorizedAdminToken(user);

    // 1. Resolve existing athlete doc strictly bound by authUid
    let athleteDoc: AdminQueryDocumentSnapshot | AdminDocumentSnapshot | null = null;
    const byUidSnap = await db.collection('athletes').where('authUid', '==', user.uid).limit(1).get();
    if (!byUidSnap.empty) {
      athleteDoc = byUidSnap.docs[0];
    }

    // 2. Check by email if not already bound by authUid
    if (!athleteDoc && normalizedEmail) {
      const byEmailSnap = await db.collection('athletes').where('email', '==', normalizedEmail).limit(1).get();
      if (!byEmailSnap.empty) {
        const candidate = byEmailSnap.docs[0];
        const candData = candidate.data() || {};

        // Already claimed by a different Firebase Auth UID
        if (candData.authUid && candData.authUid !== user.uid) {
          return res.status(409).json({
            success: false,
            alreadyLinkedToAnotherUid: true,
            linkingConflict: true,
            error: 'Este correo ya está vinculado a otra cuenta de Firebase Authentication.',
          });
        }

        // Only the verified Google Master Admin may auto-bind their own admin profile without legacy PIN
        if (isAuthorizedAdmin) {
          athleteDoc = candidate;
        } else if (candData.migrationStatus === 'confirmed' || candData.legacyPinPurged === true) {
          // Profile is already migrated, never restart migration automatically; report conflict
          return res.status(409).json({
            success: false,
            linkingConflict: true,
            requiresLegacyVerification: false,
            error: isAuthorizedAdminEmail(normalizedEmail)
              ? 'Este perfil de Administrador ya completó la migración. Inicia sesión con Google ("Continuar con Google") para validar tu cuenta.'
              : 'Conflicto de vinculación: este perfil ya completó la migración a Firebase Authentication pero su authUid no coincide con la sesión actual.',
          });
        } else {
          // NEVER auto-link a non-admin legacy profile solely by matching email
          return res.status(409).json({
            success: false,
            requiresLegacyVerification: true,
            email: normalizedEmail,
            error:
              'Encontramos un perfil existente con este correo. Por seguridad, verifica tu identidad ingresando tu PIN anterior o código de recuperación del Coach para vincular tu historial.',
          });
        }
      }
    }

    // 3. Bootstrap single Master Admin profile ONLY for Google-verified ADMIN_EMAIL
    if (!athleteDoc) {
      if (isAuthorizedAdmin) {
        const masterAdminId = 'perfil_admin_master';
        const masterRef = db.collection('athletes').doc(masterAdminId);
        const existingMaster = await masterRef.get();
        if (existingMaster.exists) {
          const masterData = existingMaster.data() || {};
          if (masterData.authUid && masterData.authUid !== user.uid) {
            return res.status(409).json({
              success: false,
              alreadyLinkedToAnotherUid: true,
              linkingConflict: true,
              error: 'El perfil Master Admin ya está vinculado a otro UID.',
            });
          }
          athleteDoc = existingMaster;
        } else {
          const nowIso = new Date().toISOString();
          const masterProfile = {
            id: masterAdminId,
            name: 'Camilo Lazcano (Coach Admin)',
            email: normalizedEmail,
            authUid: user.uid,
            isAdmin: true,
            migrationStatus: 'confirmed',
            avatar: '👑',
            goal: 'Fuerza Máxima',
            weeklyTargetDays: 5,
            soundEnabled: true,
            vibrationEnabled: true,
            weightUnit: 'kg',
            weightKg: 95,
            routines: [],
            history: [],
            prs: {},
            bodyWeightLogs: [],
            createdAt: nowIso,
            lastSyncedAt: nowIso,
          };
          await masterRef.set(masterProfile, { merge: true });
          athleteDoc = await masterRef.get();
        }
      } else {
        return res.status(403).json({
          success: false,
          error:
            'No tienes un perfil de atleta activo en LAZCAKONGYM. Regístrate con tu código de invitación único o vincula tu cuenta heredada.',
        });
      }
    }

    // 4. Reject deleted/tombstoned profiles
    const deletedSnap = await db.collection('deleted_athletes').doc(athleteDoc.id).get().catch(() => null);
    if (deletedSnap && deletedSnap.exists) {
      return res.status(403).json({
        success: false,
        error: 'Tu perfil ha sido dado de baja por la administración.',
      });
    }

    const athleteData = athleteDoc.data() || {};
    const targetIsAdmin = isAuthorizedAdmin;

    // 5. Enforce server-authoritative authUid + isAdmin on profile doc and strip legacy `pin`
    const updatePayload: Record<string, any> = {
      authUid: user.uid,
      isAdmin: targetIsAdmin,
      pin: FieldValue.delete(),
    };
    if (normalizedEmail && !athleteData.email) {
      updatePayload.email = normalizedEmail;
    }

    if (
      USER_CONTROLLED_SIGN_IN_PROVIDERS.has(activeProvider) &&
      isVerifiedEmail &&
      athleteData.migrationStatus !== 'confirmed'
    ) {
      const credRef = db.collection('athlete_credentials').doc(athleteDoc.id);
      const credSnap = await credRef.get();
      const credData = credSnap.exists ? credSnap.data() || {} : {};
      const isPendingSystemPwd =
        activeProvider === 'password' && credData.systemGeneratedPasswordPendingReplacement === true;
      if (!isPendingSystemPwd) {
        updatePayload.migrationStatus = 'confirmed';
        updatePayload.confirmedAt = new Date().toISOString();
        updatePayload.legacyPinPurged = true;
        updatePayload.serverIdentityVerified = true;
        updatePayload.authProviderConfirmed = activeProvider;
        if (credSnap.exists) {
          await credRef.delete();
        }
      }
    }

    await athleteDoc.ref.set(updatePayload, { merge: true });

    const adminRequiresGoogleSignIn = Boolean(
      isAuthorizedAdminEmail(user.email) && !targetIsAdmin
    );

    return res.status(200).json({
      success: true,
      athleteId: athleteDoc.id,
      authUid: user.uid,
      isAdmin: targetIsAdmin,
      signInProvider: activeProvider || null,
      emailVerified: isVerifiedEmail,
      adminRequiresGoogleSignIn,
      claimsUpdated: false,
      profile: sanitizeAthleteForClient(
        { ...athleteData, ...updatePayload },
        athleteDoc.id,
        user.uid,
        targetIsAdmin
      ),
    });
  } catch (error: any) {
    if (isFirestorePermissionDeniedError(error) && rawIdToken) {
      adminFirestorePermissionDeniedDetected = true;
      try {
        return await handleSessionInitWithUserToken(res, user, rawIdToken, hintAthleteId);
      } catch (fallbackErr: any) {
        console.error('[handleSessionInitWithUserToken error]:', fallbackErr);
      }
    }
    console.error('[handleSessionInit error]:', error);
    return res.status(500).json({
      success: false,
      code: error?.code || 'server/session-init-error',
      operation: 'handleSessionInit',
      error: 'Error inicializando sesión autenticada.',
    });
  }
}

/**
 * POST /api/invites/verify
 * Public rate-limited check of invite status via Admin SDK (browser never reads /invites).
 */
export async function handleVerifyInvite(
  req: Request,
  res: Response,
  deps?: AuthControllerDeps
) {
  const token = normalizeInviteToken(req.body?.token);
  if (!token) {
    return res.status(400).json({ success: false, valid: false, status: 'not_found', error: 'Código requerido.' });
  }

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const checkRate = deps?.checkRateLimitDistributed || checkRateLimitDistributed;
  const rateCheck = await checkRate(`verify_invite:${ip}`, 30, 10 * 60 * 1000, false);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      valid: false,
      status: 'not_found',
      error: `Demasiadas verificaciones. Intenta en ${rateCheck.retryAfterSec || 60} segundos.`,
    });
  }

  try {
    const resolveAdmin = deps?.getAdminServices || getAdminServices;
    const { db } = resolveAdmin();
    const { snap } = await resolveInviteDocRefAndSnap(db, token);

    if (!snap.exists) {
      return res.status(200).json({ success: true, valid: false, status: 'not_found' });
    }

    const data = snap.data() || {};
    if (data.revoked === true) {
      return res.status(200).json({ success: true, valid: false, status: 'revoked' });
    }
    if (data.used === true) {
      return res.status(200).json({ success: true, valid: false, status: 'used' });
    }
    if (data.expiresAt && new Date(data.expiresAt).getTime() < Date.now()) {
      return res.status(200).json({ success: true, valid: false, status: 'revoked' });
    }

    return res.status(200).json({
      success: true,
      valid: true,
      status: 'valid',
      invite: {
        token,
        note: data.note || undefined,
        createdAt: data.createdAt || new Date().toISOString(),
        createdBy: data.createdBy || 'Coach Camilo Lazcano',
        used: false,
      },
    });
  } catch (error: any) {
    console.error('[handleVerifyInvite error]:', error);
    return res.status(500).json({ success: false, valid: false, status: 'not_found', error: 'Error verificando invitación.' });
  }
}

/**
 * POST /api/invites/register
 * Starter-Tier-compatible atomic single-use invite registration:
 * - Caller MUST already be authenticated in Firebase Auth via Client SDK
 *   (Google Sign-In or Email+Password created on client), verified via `verifyIdToken`.
 * - ZERO Auth Admin IAM calls (`createUser`, `deleteUser`, `setCustomUserClaims`, `createCustomToken`).
 * - Atomically verifies & burns the single-use invite and creates /athletes/{athleteId}
 *   bound to `req.user.uid` with `isAdmin: false`.
 */
export async function handleRegisterWithInvite(
  req: Request,
  res: Response,
  deps?: AuthControllerDeps
) {
  const caller = (req as any).user as AuthenticatedUser | undefined;
  if (!caller || !caller.uid) {
    return res.status(401).json({
      success: false,
      error: 'Autenticación de Firebase Auth requerida para canjear el código de invitación.',
    });
  }

  const token = normalizeInviteToken(req.body?.token);
  const rawName = String(req.body?.name || '').trim();
  const rawEmail = String(req.body?.email || '').toLowerCase().trim();
  const avatar = String(req.body?.avatar || '🦍').trim() || '🦍';
  const goal = String(req.body?.goal || 'Hipertrofia & Masa').trim() || 'Hipertrofia & Masa';
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  if (!token) {
    return res.status(400).json({ success: false, error: 'Código de invitación obligatorio.' });
  }

  const checkRate = deps?.checkRateLimitDistributed || checkRateLimitDistributed;
  const resetRate = deps?.resetRateLimitDistributed || resetRateLimitDistributed;
  const rateKey = `register:${ip}`;
  const rateCheck = await checkRate(rateKey, 10, 15 * 60 * 1000, false);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: `Demasiados intentos de registro. Espera ${rateCheck.retryAfterSec || 600} segundos.`,
    });
  }

  try {
    const resolveAdmin = deps?.getAdminServices || getAdminServices;
    const { db } = resolveAdmin();

    const authUid = caller.uid;
    const finalEmail = String(caller.email || rawEmail).toLowerCase().trim();
    const finalName = rawName || String(finalEmail.split('@')[0] || 'Atleta').trim();

    if (!finalEmail || !finalEmail.includes('@')) {
      return res.status(400).json({ success: false, error: 'Se requiere un correo electrónico válido en Firebase Auth.' });
    }

    const newAthleteId = `perfil_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const nowIso = new Date().toISOString();

    const newProfileDoc = {
      id: newAthleteId,
      name: finalName,
      email: finalEmail,
      authUid,
      isAdmin: false, // Strictly non-admin for invite registration
      migrationStatus: 'confirmed',
      avatar,
      goal,
      weeklyTargetDays: 5,
      soundEnabled: true,
      vibrationEnabled: true,
      weightUnit: 'kg',
      routines: [],
      history: [],
      prs: {},
      bodyWeightLogs: [],
      createdAt: nowIso,
      lastSyncedAt: nowIso,
    };

    const txResult = await db.runTransaction(async (transaction) => {
      const { ref: inviteRef, snap: inviteSnap } = await resolveInviteDocRefAndSnap(db, token, transaction);
      if (!inviteSnap.exists) {
        return { ok: false, status: 404, error: 'Código de invitación inválido o no encontrado.' };
      }
      const inviteData = inviteSnap.data() || {};
      if (inviteData.revoked === true) {
        return { ok: false, status: 403, error: 'Este código de invitación fue revocado.' };
      }
      if (inviteData.used === true) {
        return { ok: false, status: 409, error: 'Este código de invitación ya fue utilizado anteriormente.' };
      }
      if (inviteData.expiresAt && new Date(inviteData.expiresAt).getTime() < Date.now()) {
        return { ok: false, status: 410, error: 'Este código de invitación ha expirado.' };
      }

      const existingUidSnap = await transaction.get(
        db.collection('athletes').where('authUid', '==', authUid).limit(1)
      );
      if (!existingUidSnap.empty) {
        return {
          ok: false,
          status: 409,
          error: 'Esta cuenta de Firebase Auth ya tiene un perfil de atleta activo. Inicia sesión.',
        };
      }

      const dupEmailCheck = await transaction.get(
        db.collection('athletes').where('email', '==', finalEmail).limit(1)
      );
      if (!dupEmailCheck.empty) {
        return {
          ok: false,
          status: 409,
          error: 'Ya existe una cuenta registrada con este correo. Inicia sesión o vincula tu perfil heredado.',
        };
      }

      transaction.update(inviteRef, {
        used: true,
        usedAt: nowIso,
        usedByUid: authUid,
        usedByName: finalName,
        usedByEmail: finalEmail,
      });

      transaction.set(db.collection('athletes').doc(newAthleteId), newProfileDoc);
      return { ok: true, status: 201 };
    });

    if (!txResult.ok) {
      return res.status(txResult.status || 409).json({ success: false, error: txResult.error });
    }

    await resetRate(rateKey);

    return res.status(201).json({
      success: true,
      athleteId: newAthleteId,
      authUid,
      isAdmin: false,
      profile: sanitizeAthleteForClient(newProfileDoc, newAthleteId, authUid, false),
      message: 'Cuenta creada e invitación canjeada exitosamente.',
    });
  } catch (error: any) {
    console.error('[handleRegisterWithInvite error]:', error);
    return res.status(500).json({ success: false, error: 'Error creando cuenta con invitación.' });
  }
}

/**
 * POST /api/invites/redeem
 * Authenticated single-use invitation redemption endpoint on server.
 */
export async function handleRedeemInvite(
  req: Request,
  res: Response,
  deps?: AuthControllerDeps
) {
  const user = (req as any).user as AuthenticatedUser;
  if (!user || !user.uid) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida para canjear pase.' });
  }

  const rawToken = normalizeInviteToken(req.body?.token);
  if (!rawToken) {
    return res.status(400).json({ success: false, error: 'Código de invitación requerido.' });
  }

  const checkRate = deps?.checkRateLimitDistributed || checkRateLimitDistributed;
  const resetRate = deps?.resetRateLimitDistributed || resetRateLimitDistributed;
  const rateLimitKey = `redeem:${user.uid}`;
  const rateCheck = await checkRate(rateLimitKey, 5, 10 * 60 * 1000);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: `Demasiados intentos fallidos de canje. Espera ${rateCheck.retryAfterSec || 600} segundos.`,
    });
  }

  try {
    const resolveAdmin = deps?.getAdminServices || getAdminServices;
    const { db } = resolveAdmin();

    const result = await db.runTransaction(async (transaction) => {
      const { ref: inviteRef, snap: inviteSnap } = await resolveInviteDocRefAndSnap(db, rawToken, transaction);

      if (!inviteSnap.exists) {
        return { success: false, status: 404, error: 'Código de invitación inválido o no encontrado.' };
      }

      const inviteData = inviteSnap.data() || {};
      if (inviteData.revoked === true) {
        return { success: false, status: 403, error: 'Este código de invitación fue revocado.' };
      }

      if (inviteData.used === true) {
        return { success: false, status: 409, error: 'Este código de invitación ya fue utilizado anteriormente.' };
      }

      if (inviteData.expiresAt && new Date(inviteData.expiresAt).getTime() < Date.now()) {
        return { success: false, status: 410, error: 'Este código de invitación ha expirado.' };
      }

      transaction.update(inviteRef, {
        used: true,
        usedAt: new Date().toISOString(),
        usedByUid: user.uid,
        usedByEmail: user.email || 'atleta',
      });

      return { success: true, status: 200, inviteData };
    });

    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, error: result.error });
    }

    await resetRate(rateLimitKey);
    return res.status(200).json({
      success: true,
      message: '¡Pase de acceso verificado y canjeado exitosamente!',
    });
  } catch (error: any) {
    console.error('[handleRedeemInvite error]:', error);
    return res.status(500).json({ success: false, error: 'Error procesando canje de invitación.' });
  }
}

/**
 * POST /api/auth/confirm-migration
 * Server-authoritative confirmation before zeroizing legacy credentials.
 * Starter-Tier compatible: validates solely via decoded Firebase ID token (`req.user`).
 */
const USER_CONTROLLED_SIGN_IN_PROVIDERS = new Set(['google.com', 'password']);

export async function handleConfirmMigration(
  req: Request,
  res: Response,
  deps?: { getAdminServices?: typeof getAdminServices }
) {
  const user = (req as any).user as AuthenticatedUser | undefined;
  if (!user || !user.uid) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida para confirmar migración.' });
  }

  try {
    const resolveAdmin = deps?.getAdminServices || getAdminServices;
    const { db } = resolveAdmin();

    const activeSignInProvider = String(user.signInProvider || '').trim();
    if (!USER_CONTROLLED_SIGN_IN_PROVIDERS.has(activeSignInProvider)) {
      return res.status(422).json({
        success: false,
        error:
          'No se puede purgar la credencial legacy: la sesión actual debe provenir de un inicio de sesión real con Google o contraseña propia del atleta.',
      });
    }

    const callerEmail = String(user.email || '').toLowerCase().trim();
    const hasVerifiedEmail = Boolean(user.emailVerified && callerEmail);
    if (!hasVerifiedEmail) {
      return res.status(422).json({
        success: false,
        error:
          'No se puede purgar la credencial heredada: se requiere método vinculado activo (Google o contraseña) y correo de recuperación verificado en Firebase Auth.',
      });
    }

    const snap = await db.collection('athletes').where('authUid', '==', user.uid).limit(1).get();
    if (snap.empty) {
      return res.status(404).json({ success: false, error: 'Perfil de atleta no encontrado para este usuario.' });
    }

    const athleteDoc = snap.docs[0];
    const athleteData = athleteDoc.data() || {};
    const profileEmail = String(athleteData.email || '').toLowerCase().trim();

    if (profileEmail && profileEmail !== callerEmail) {
      return res.status(403).json({
        success: false,
        error: 'Discrepancia de identidad: el correo en Firebase Auth no coincide con el perfil del atleta.',
      });
    }

    if (athleteData.migrationStatus !== 'provisional_claimed' && athleteData.migrationStatus !== 'confirmed') {
      return res.status(400).json({
        success: false,
        error: `Estado de migración no válido para confirmación: ${athleteData.migrationStatus || 'desconocido'}.`,
      });
    }

    const credRef = db.collection('athlete_credentials').doc(athleteDoc.id);
    const credSnap = await credRef.get();
    const credData = credSnap.exists ? credSnap.data() || {} : {};
    if (
      activeSignInProvider === 'password' &&
      credData.systemGeneratedPasswordPendingReplacement === true
    ) {
      return res.status(422).json({
        success: false,
        error:
          'No se puede purgar el respaldo legacy: la contraseña actual figura como generada por sistema y aún no ha sido reemplazada por el usuario.',
      });
    }

    if (req.body?.persistentAuthVerified === false) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere confirmación de persistencia de sesión activa desde el dispositivo antes de purgar la credencial de respaldo.',
      });
    }

    await athleteDoc.ref.set(
      {
        migrationStatus: 'confirmed',
        confirmedAt: new Date().toISOString(),
        legacyPinPurged: true,
        serverIdentityVerified: true,
        authProviderConfirmed: activeSignInProvider,
        recoveryChannelConfirmed: callerEmail,
      },
      { merge: true }
    );

    await credRef.delete();

    await db.collection('security_audit_logs').add({
      eventType: 'LEGACY_CREDENTIAL_PURGED',
      athleteId: athleteDoc.id,
      authUid: user.uid,
      email: callerEmail,
      timestamp: new Date().toISOString(),
      verifiedMethod: `FIREBASE_AUTH_${activeSignInProvider.toUpperCase()}`,
    });

    return res.status(200).json({
      success: true,
      message: 'Migración y persistencia confirmadas exitosamente por el servidor. Credencial legacy ceroizada.',
    });
  } catch (error: any) {
    console.error('[handleConfirmMigration error]:', error);
    return res.status(500).json({ success: false, error: 'Error confirmando migración.' });
  }
}

/**
 * POST /api/admin/recover-athlete
 * Emergency Access Recovery by Coach Admin (strictly Custom Claim admin === true + ADMIN_EMAIL).
 */
export async function handleAdminRecoverAthlete(
  req: Request,
  res: Response,
  deps?: AuthControllerDeps
) {
  const admin = (req as any).user as AuthenticatedUser;
  if (!admin || !admin.isAdmin || !isAuthorizedAdminEmail(admin.email)) {
    return res.status(403).json({ success: false, error: 'Acceso restringido exclusivamente al Administrador Master.' });
  }

  const checkRate = deps?.checkRateLimitDistributed || checkRateLimitDistributed;
  const rateLimitKey = `admin_recover:${admin.uid}`;
  const rateCheck = await checkRate(rateLimitKey, 5, 10 * 60 * 1000);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: `Límite de recuperaciones alcanzado. Espera ${rateCheck.retryAfterSec || 600} segundos.`,
    });
  }

  const athleteId = String(req.body?.athleteId || '').trim();
  const targetEmail = String(req.body?.targetEmail || '').toLowerCase().trim();
  const reason = String(req.body?.reason || 'Solicitud de recuperación de acceso').trim();

  if (!athleteId) {
    return res.status(400).json({ success: false, error: 'athleteId es obligatorio.' });
  }

  try {
    const resolveAdmin = deps?.getAdminServices || getAdminServices;
    const { db } = resolveAdmin();
    const athleteRef = db.collection('athletes').doc(athleteId);
    const snap = await athleteRef.get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: 'Atleta no encontrado.' });
    }

    const data = snap.data() || {};
    const storedEmail = String(data.email || '').toLowerCase().trim();

    if (targetEmail && targetEmail !== storedEmail) {
      return res.status(400).json({
        success: false,
        error: 'El correo especificado no coincide con el atleta registrado.',
      });
    }

    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    const recoveryCode = `LZK-REC-${randomHex}`;
    const recoveryCodeHash = hashToken(recoveryCode);
    const expiresAt = Date.now() + 15 * 60 * 1000;

    await db.collection('athlete_credentials').doc(athleteId).set(
      {
        recoveryCodeHash,
        recoveryExpiresAt: expiresAt,
        recoveryUsed: false,
        issuedByAdminUid: admin.uid,
        issuedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    await db.collection('security_audit_logs').add({
      eventType: 'ADMIN_RECOVERY_CODE_GENERATED',
      adminUid: admin.uid,
      adminEmail: admin.email,
      targetAthleteId: athleteId,
      targetEmail: storedEmail,
      reason,
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      userAgent: req.headers?.['user-agent'] || 'unknown',
      timestamp: new Date().toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    });

    return res.status(200).json({
      success: true,
      recoveryCode,
      targetEmail: storedEmail,
      athleteId,
      expiresInMinutes: 15,
      message: 'Código de recuperación temporal generado exitosamente. Válido por 15 minutos para un solo uso.',
    });
  } catch (err: any) {
    console.error('[handleAdminRecoverAthlete error]:', err);
    return res.status(500).json({ success: false, error: 'Error procesando recuperación de atleta.' });
  }
}

function assertAuthorizedAdmin(req: Request, res: Response): AuthenticatedUser | null {
  const admin = (req as any).user as AuthenticatedUser | undefined;
  if (!admin || !admin.uid || !admin.isAdmin || !isAuthorizedAdminEmail(admin.email)) {
    res.status(403).json({
      success: false,
      error: 'Acceso restringido exclusivamente al Administrador Master con sesión Google verificada.',
    });
    return null;
  }
  return admin;
}

/**
 * GET /api/admin/invites
 */
export async function handleAdminListInvites(
  req: Request,
  res: Response,
  deps?: AuthControllerDeps
) {
  if (!assertAuthorizedAdmin(req, res)) return;
  try {
    const resolveAdmin = deps?.getAdminServices || getAdminServices;
    const { db } = resolveAdmin();
    const snap = await db.collection('invites').get();
    const list: any[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.token) {
        list.push(data);
      }
    });
    list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return res.status(200).json({ success: true, invites: list });
  } catch (err: any) {
    console.error('[handleAdminListInvites error]:', err);
    return res.status(500).json({ success: false, error: 'Error listando invitaciones.' });
  }
}

/**
 * POST /api/admin/invites
 */
export async function handleAdminCreateInvite(
  req: Request,
  res: Response,
  deps?: AuthControllerDeps
) {
  const admin = assertAuthorizedAdmin(req, res);
  if (!admin) return;
  try {
    const resolveAdmin = deps?.getAdminServices || getAdminServices;
    const { db } = resolveAdmin();
    const token = generateSecureInviteCode();
    const createdBy = String(req.body?.createdBy || admin.email || 'Coach Admin').trim();
    const note = String(req.body?.note || '').trim();
    const inviteDoc = {
      token,
      createdAt: new Date().toISOString(),
      createdBy,
      ...(note ? { note } : {}),
      used: false,
      revoked: false,
    };

    const tokenHash = hashToken(token);
    await db.collection('invites').doc(tokenHash).set(inviteDoc);

    return res.status(201).json({ success: true, invite: inviteDoc });
  } catch (err: any) {
    console.error('[handleAdminCreateInvite error]:', err);
    return res.status(500).json({ success: false, error: 'Error creando código de invitación.' });
  }
}

/**
 * POST /api/admin/invites/batch
 */
export async function handleAdminBatchCreateInvites(
  req: Request,
  res: Response,
  deps?: AuthControllerDeps
) {
  const admin = assertAuthorizedAdmin(req, res);
  if (!admin) return;
  try {
    const resolveAdmin = deps?.getAdminServices || getAdminServices;
    const { db } = resolveAdmin();
    const count = Math.min(50, Math.max(1, Number(req.body?.count || 50)));
    const createdBy = String(req.body?.createdBy || admin.email || 'Coach Admin').trim();
    const nowIso = new Date().toISOString();

    const batch = db.batch();
    const tokens: string[] = [];
    const invites: any[] = [];

    for (let i = 0; i < count; i++) {
      const token = generateSecureInviteCode();
      const inviteDoc = {
        token,
        createdAt: nowIso,
        createdBy,
        note: `Pase Beta Exclusivo #${i + 1}`,
        used: false,
        revoked: false,
      };
      const ref = db.collection('invites').doc(hashToken(token));
      batch.set(ref, inviteDoc);
      tokens.push(token);
      invites.push(inviteDoc);
    }

    await batch.commit();
    return res.status(201).json({
      success: true,
      tokens,
      invites,
      message: `¡${count} códigos de invitación generados exitosamente!`,
    });
  } catch (err: any) {
    console.error('[handleAdminBatchCreateInvites error]:', err);
    return res.status(500).json({ success: false, error: 'Error creando lote de invitaciones.' });
  }
}

/**
 * DELETE /api/admin/invites/:token
 */
export async function handleAdminRevokeInvite(
  req: Request,
  res: Response,
  deps?: AuthControllerDeps
) {
  if (!assertAuthorizedAdmin(req, res)) return;
  const rawToken = normalizeInviteToken(req.params?.token || req.body?.token);
  if (!rawToken) {
    return res.status(400).json({ success: false, error: 'Token requerido.' });
  }
  try {
    const resolveAdmin = deps?.getAdminServices || getAdminServices;
    const { db } = resolveAdmin();
    await Promise.allSettled([
      db.collection('invites').doc(hashToken(rawToken)).delete(),
      db.collection('invites').doc(rawToken).delete(),
    ]);
    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('[handleAdminRevokeInvite error]:', err);
    return res.status(500).json({ success: false, error: 'Error revocando invitación.' });
  }
}

/**
 * DELETE /api/admin/athletes/:athleteId
 */
export async function handleAdminDeleteAthlete(
  req: Request,
  res: Response,
  deps?: AuthControllerDeps
) {
  const admin = assertAuthorizedAdmin(req, res);
  if (!admin) return;
  const athleteId = String(req.params?.athleteId || '').trim();
  if (!athleteId) {
    return res.status(400).json({ success: false, error: 'athleteId requerido.' });
  }

  try {
    const resolveAdmin = deps?.getAdminServices || getAdminServices;
    const { db } = resolveAdmin();
    const athleteRef = db.collection('athletes').doc(athleteId);
    const snap = await athleteRef.get();
    const targetData = snap.exists ? snap.data() || {} : {};
    if (
      isAuthorizedAdminEmail(targetData.email) ||
      targetData.authUid === admin.uid ||
      athleteId === 'perfil_admin_master' ||
      (admin.athleteId && athleteId === admin.athleteId)
    ) {
      return res.status(400).json({
        success: false,
        error: 'La cuenta del Administrador Master no puede ser eliminada.',
      });
    }

    await db.collection('deleted_athletes').doc(athleteId).set({
      athleteId,
      authUid: targetData.authUid || null,
      deletedAt: new Date().toISOString(),
      deletedBy: admin.email || admin.uid,
    });
    await Promise.allSettled([
      athleteRef.delete(),
      db.collection('athlete_credentials').doc(athleteId).delete(),
    ]);
    await db.collection('security_audit_logs').add({
      eventType: 'ADMIN_ATHLETE_DELETED',
      adminUid: admin.uid,
      adminEmail: admin.email,
      targetAthleteId: athleteId,
      targetEmail: targetData.email || '',
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('[handleAdminDeleteAthlete error]:', err);
    return res.status(500).json({ success: false, error: 'Error eliminando perfil de atleta.' });
  }
}

/**
 * POST /api/admin/broadcast-update
 */
export async function handleAdminBroadcastUpdate(req: Request, res: Response) {
  if (!assertAuthorizedAdmin(req, res)) return;
  const version = String(req.body?.version || '6.4.0').trim();
  const buildId = String(req.body?.buildId || `${version}-elite-pwa`).trim();
  const message = String(
    req.body?.message || 'Nuevo Mapa de Calor Muscular Anatómico 360° y Telemetría de Fatiga'
  ).trim();
  const broadcastId = `${buildId}-${Date.now()}`;
  const state: ServerBroadcastState = {
    version,
    buildId,
    broadcastId,
    updatedAt: new Date().toISOString(),
    message,
  };
  setServerBroadcastState(state);
  return res.status(200).json({ success: true, ...state });
}
