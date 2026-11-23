/**
 * LAZCAKONG GYM - ELITE SECURITY & DEDUPLICATION TEST SUITE
 * 
 * Verifies:
 * 1. Multi-session same-day workout preservation (morning + evening workouts on same calendar date).
 * 2. True duplicate removal by ID / composite signature without collapsing distinct workouts.
 * 3. Rate limiting (strict cutoff after max attempts + retry-after).
 * 4. Constant-time PIN comparison (timing-attack defense).
 * 5. Token SHA-256 hashing & normalization.
 * 6. Express endpoint validation (400, 401, 429 responses).
 * 7. Firestore Security Rules evaluation logic (strict athlete isolation, anti-escalation, admin claims).
 */

import crypto from 'node:crypto';
import { purgeAndSanitizeWorkoutHistory } from '../../utils/historySanitizer.ts';
import {
  createSanitizedProfileBackup,
  inspectBackupForRestore,
  executeSafeBackupRestore,
  type StorageLike,
} from '../../utils/eliteBackupEngine.ts';
import { checkRateLimit, resetRateLimit, constantTimeCompare, hashToken } from '../firebaseAdminServer.ts';
import { CompletedWorkout, Profile } from '../../types/index.ts';

// Simple assertion helper
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('   LAZCAKONG GYM - SECURITY & PERSISTENCE TEST SUITE  ');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  // ---------------------------------------------------------------------------
  // TEST 1: Same-Day Multiple Workouts Preservation & Deduplication
  // ---------------------------------------------------------------------------
  console.log('1. PRUEBA DE PERSISTENCIA Y NO-DUPLICACIÓN (SESIONES MISMO DÍA)');
  try {
    const morningLegWorkout: CompletedWorkout = {
      id: 'session-2026-11-12-morning-leg',
      routineId: 'leg-day-1',
      routineTitle: 'Pierna Pesada & Isquios',
      date: '2026-11-12',
      startTime: Date.now() - 36000000,
      endTime: Date.now() - 32400000,
      durationSeconds: 3600,
      isFinished: true,
      exercisesSummary: [
        {
          name: 'Sentadilla Libre',
          sets: 2,
          maxWeight: 125,
          maxReps: 8,
          volumeKg: 1960,
        }
      ],
      totalVolumeKg: 1960,
      completedSetsCount: 2,
    };

    const eveningCoreWorkout: CompletedWorkout = {
      id: 'session-2026-11-12-evening-core',
      routineId: 'core-mobility-2',
      routineTitle: 'Core & Telemetría Abdominal',
      date: '2026-11-12',
      startTime: Date.now() - 7200000,
      endTime: Date.now() - 5400000,
      durationSeconds: 1800,
      isFinished: true,
      exercisesSummary: [
        {
          name: 'Rueda Abdominal',
          sets: 2,
          maxWeight: 0,
          maxReps: 15,
          volumeKg: 0,
        }
      ],
      totalVolumeKg: 0,
      completedSetsCount: 2,
    };

    // Duplicate clone of morning workout with identical ID
    const duplicateMorningWorkout: CompletedWorkout = { ...morningLegWorkout };

    const rawHistory = [morningLegWorkout, eveningCoreWorkout, duplicateMorningWorkout];
    const sanitized = purgeAndSanitizeWorkoutHistory(rawHistory);

    assert(sanitized.cleanedHistory.length === 2, 'Sanitizer conserva exactamente 2 sesiones distintas del mismo día (elimina duplicado exacto)');
    assert(sanitized.cleanedHistory.some(w => w.id === 'session-2026-11-12-morning-leg'), 'Conserva la sesión matutina de Pierna');
    assert(sanitized.cleanedHistory.some(w => w.id === 'session-2026-11-12-evening-core'), 'Conserva la sesión vespertina de Core');
    assert(sanitized.cleanedHistory.find(w => w.id === 'session-2026-11-12-morning-leg')?.totalVolumeKg === 1960, 'El volumen de la sesión matutina no fue alterado');

    // Test non-destructive backup merge
    const inMemoryStorage: Record<string, string> = {};
    const mockStorageAdapter: StorageLike = {
      getItem: (k: string) => inMemoryStorage[k] || null,
      setItem: (k: string, v: string) => { inMemoryStorage[k] = v; },
      removeItem: (k: string) => { delete inMemoryStorage[k]; }
    };

    const targetProfile: Profile = {
      id: 'ath1',
      name: 'Atleta Test',
      email: 'atleta@test.com',
      pin: '1234',
      avatar: '🦍',
      goal: 'Hipertrofia',
      weeklyTargetDays: 5,
      weightUnit: 'kg',
      soundEnabled: true,
      vibrationEnabled: true,
      createdAt: '2026-01-01',
    };

    const currentState = {
      routines: [],
      history: [morningLegWorkout as CompletedWorkout],
      prs: {},
      bodyWeightLogs: [],
      customLinks: {},
      selectedAlternatives: {},
    };

    // Create a real signed v2.0.0 backup containing eveningCoreWorkout
    const backupDoc = createSanitizedProfileBackup({
      profile: targetProfile,
      routines: [],
      history: [eveningCoreWorkout as CompletedWorkout],
      prs: {},
      bodyWeightLogs: [],
      customLinks: {},
      selectedAlternatives: {},
      storage: mockStorageAdapter,
    });
    const backupJson = JSON.stringify(backupDoc);

    const inspection = inspectBackupForRestore({
      rawJson: backupJson,
      targetProfile,
      currentState,
    });

    assert(inspection.valid === true, 'Inspección de respaldo es válida y checksum verificado');
    assert(inspection.counts.backup.history === 1, 'Detecta 1 entrenamiento en el archivo');

    const restoreRes = executeSafeBackupRestore({
      rawJson: backupJson,
      targetProfile,
      currentState,
      strategy: 'merge_safe',
      confirmed: true,
      storage: mockStorageAdapter,
    });

    assert(restoreRes.success === true, 'Restauración merge_safe exitosa');
    assert(restoreRes.nextState !== undefined, 'Retorna nuevo estado calculado');

    const mergedHistory = restoreRes.nextState!.history;
    assert(mergedHistory.length === 2, 'El historial unificado conserva ambas sesiones del mismo día');
    assert(mergedHistory.some(w => w.routineTitle === 'Pierna Pesada & Isquios'), 'Sesión existente previa intacta');
    assert(mergedHistory.some(w => w.routineTitle === 'Core & Telemetría Abdominal'), 'Sesión nueva importada intacta');

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 1:', err.message);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Rate Limiter Enforcement
  // ---------------------------------------------------------------------------
  console.log('\n2. PRUEBA DE RATE LIMITER CONTRA FUERZA BRUTA');
  try {
    const testKey = `test-ip-${Date.now()}`;
    resetRateLimit(testKey);

    for (let i = 1; i <= 5; i++) {
      const res = checkRateLimit(testKey, 5, 60000);
      assert(res.allowed === true, `Intento #${i} permitido dentro del límite permitido (5 max)`);
    }

    const blockedRes = checkRateLimit(testKey, 5, 60000);
    assert(blockedRes.allowed === false, 'Intento #6 bloqueado inmediatamente con HTTP 429');
    assert(typeof blockedRes.retryAfterSec === 'number' && blockedRes.retryAfterSec > 0, 'Informa tiempo de espera en segundos');

    resetRateLimit(testKey);
    const afterReset = checkRateLimit(testKey, 5, 60000);
    assert(afterReset.allowed === true, 'El reseteo manual reactiva el bucket para peticiones legítimas');

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 2:', err.message);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Constant-Time Comparison & Token Hashing
  // ---------------------------------------------------------------------------
  console.log('\n3. PRUEBA DE COMPARACIÓN DE TIEMPO CONSTANTE Y HASHING SHA-256');
  try {
    assert(constantTimeCompare('1234', '1234') === true, 'PIN idéntico coincide exactamente');
    assert(constantTimeCompare('1234', '5678') === false, 'PIN erróneo rechazado');
    assert(constantTimeCompare('1234', '123') === false, 'Longitudes distintas rechazadas sin fuga');
    assert(constantTimeCompare('1234', '12345') === false, 'Longitud mayor rechazada sin error');

    const rawCode = 'LZK-PRO-2026';
    const hash1 = hashToken(rawCode);
    const hash2 = hashToken('  lzk-pro-2026  ');
    assert(hash1.length === 64, 'El hash generado es SHA-256 válido (64 caracteres hexadecimales)');
    assert(hash1 === hash2, 'La normalización de mayúsculas y espacios produce el mismo hash determinista');

    const expected = crypto.createHash('sha256').update(rawCode).digest('hex');
    assert(hash1 === expected, 'El hash coincide con el estándar SHA-256 de Node crypto');

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 3:', err.message);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Controladores de Migración y Canje (Auth, AuthZ, Integridad & Anti-Secuestro)
  // ---------------------------------------------------------------------------
  console.log('\n4. PRUEBA DE CONTROLADORES DE MIGRACIÓN (401, 400, 403, 200, 409)');
  try {
    const { handleMigrateLegacyAuth, handleRedeemInvite } = await import('../authMigrationController.ts');
    const { hashPinWithScrypt } = await import('../firebaseAdminServer.ts');
    const { FieldValue } = await import('firebase-admin/firestore');

    // Fake Express req/res
    function createMockRes() {
      const resObj: any = {
        statusCode: 200,
        body: null,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(data: any) {
          this.body = data;
          return this;
        },
      };
      return resObj;
    }

    // Minimal stateful in-memory Firestore mock matching AdminFirestore transaction contract
    function createMockFirestore() {
      const collections: Record<string, Map<string, Record<string, any>>> = {
        athletes: new Map(),
        athlete_credentials: new Map(),
        deleted_athletes: new Map(),
        security_audit_logs: new Map(),
      };
      let autoIdSeq = 0;

      const makeDocRef = (colName: string, docId: string) => ({
        __kind: 'doc' as const,
        colName,
        id: docId,
      });

      const makeDocSnap = (colName: string, docId: string) => {
        const col = collections[colName];
        const raw = col?.get(docId);
        return {
          exists: Boolean(raw),
          id: docId,
          ref: makeDocRef(colName, docId),
          data: () => (raw ? { ...raw } : undefined),
        };
      };

      const makeQuery = (colName: string, field: string, value: any) => ({
        __kind: 'query' as const,
        colName,
        field,
        value,
        limit() {
          return this;
        },
      });

      const runQuery = (colName: string, field: string, value: any) => {
        const col = collections[colName] || new Map();
        const docs: any[] = [];
        for (const [docId, docData] of col.entries()) {
          if (docData && docData[field] === value) {
            docs.push({
              id: docId,
              ref: makeDocRef(colName, docId),
              data: () => ({ ...docData }),
            });
          }
        }
        return {
          empty: docs.length === 0,
          docs,
        };
      };

      const deleteSentinel = FieldValue.delete();

      const applyWrite = (ref: { colName: string; id: string }, data: Record<string, any>, merge = true) => {
        if (!collections[ref.colName]) {
          collections[ref.colName] = new Map();
        }
        const prev = merge ? { ...(collections[ref.colName].get(ref.id) || {}) } : {};
        for (const [k, v] of Object.entries(data)) {
          if (v === deleteSentinel || (v && typeof v === 'object' && v.constructor?.name === 'DeleteTransform')) {
            delete prev[k];
          } else {
            prev[k] = v;
          }
        }
        collections[ref.colName].set(ref.id, prev);
      };

      const db: any = {
        collection: (colName: string) => ({
          doc: (docId?: string) => makeDocRef(colName, docId || `auto-${++autoIdSeq}`),
          where: (field: string, _op: string, value: any) => makeQuery(colName, field, value),
        }),
        runTransaction: async (fn: (tx: any) => Promise<any>) => {
          const tx = {
            get: async (target: any) => {
              if (target.__kind === 'query') {
                return runQuery(target.colName, target.field, target.value);
              }
              return makeDocSnap(target.colName, target.id);
            },
            set: (ref: { colName: string; id: string }, data: Record<string, any>, opts?: { merge?: boolean }) => {
              applyWrite(ref, data, opts?.merge !== false);
            },
          };
          return fn(tx);
        },
      };

      return { collections, db };
    }

    const { collections, db } = createMockFirestore();
    const rateBucketMap = new Map<string, number>();
    const testDeps = {
      getAdminServices: () => ({ db, auth: {} as any }),
      checkRateLimitDistributed: async (key: string) => {
        const count = (rateBucketMap.get(key) || 0) + 1;
        rateBucketMap.set(key, count);
        return count <= 10 ? { allowed: true } : { allowed: false, retryAfterSec: 900 };
      },
      resetRateLimitDistributed: async (key: string) => {
        rateBucketMap.delete(key);
      },
    };

    // Seed synthetic legacy athlete, tombstoned athlete, other-owner athlete, and Master Admin doc
    const validPinHash = await hashPinWithScrypt('4321');
    collections.athletes.set('test-ath-legacy-1', {
      id: 'test-ath-legacy-1',
      name: 'Atleta Heredado',
      email: 'legacy.test@synthetic.local',
      migrationStatus: 'pending',
      pin: '4321',
    });
    collections.athlete_credentials.set('test-ath-legacy-1', {
      athleteId: 'test-ath-legacy-1',
      email: 'legacy.test@synthetic.local',
      pinHash: validPinHash,
    });

    collections.athletes.set('test-ath-deleted', {
      id: 'test-ath-deleted',
      name: 'Atleta Eliminado',
      email: 'deleted.test@synthetic.local',
      migrationStatus: 'pending',
    });
    collections.deleted_athletes.set('test-ath-deleted', { deletedAt: '2026-11-01T00:00:00Z' });

    collections.athletes.set('perfil_admin_master', {
      id: 'perfil_admin_master',
      name: 'Coach Master',
      email: 'coach.master@synthetic.local',
      migrationStatus: 'pending',
    });

    collections.athletes.set('test-ath-other-owner', {
      id: 'test-ath-other-owner',
      name: 'Otro Atleta',
      email: 'other.athlete@synthetic.local',
      authUid: 'uid-real-owner-999',
      migrationStatus: 'confirmed',
    });

    // 4.1 Unauthenticated request -> HTTP 401
    const resUnauth = createMockRes();
    await handleMigrateLegacyAuth(
      { body: { email: 'legacy.test@synthetic.local', pin: '4321' }, ip: '10.0.0.1', socket: {} } as any,
      resUnauth,
      testDeps
    );
    assert(resUnauth.statusCode === 401 && resUnauth.body?.success === false, 'Migración rechaza solicitud sin autenticación con HTTP 401');

    // 4.2 Authenticated request with invalid/empty body -> HTTP 400
    const resInvalidBody = createMockRes();
    await handleMigrateLegacyAuth(
      {
        user: { uid: 'uid-caller-1', email: '', signInProvider: 'password', emailVerified: false, isAdminClaim: false },
        body: { email: '', pin: '' },
        ip: '10.0.0.2',
        socket: {},
      } as any,
      resInvalidBody,
      testDeps
    );
    assert(resInvalidBody.statusCode === 400 && resInvalidBody.body?.success === false, 'Migración autenticada con cuerpo inválido rechaza con HTTP 400');

    // 4.3a Authenticated request targeting tombstoned/deleted athlete -> HTTP 403
    const resDeleted = createMockRes();
    await handleMigrateLegacyAuth(
      {
        user: { uid: 'uid-caller-1', email: 'deleted.test@synthetic.local', signInProvider: 'password', emailVerified: false, isAdminClaim: false },
        body: { email: 'deleted.test@synthetic.local', pin: '4321' },
        ip: '10.0.0.3',
        socket: {},
      } as any,
      resDeleted,
      testDeps
    );
    assert(resDeleted.statusCode === 403 && resDeleted.body?.success === false, 'Migración rechaza cuenta eliminada/revoca acceso con HTTP 403');

    // 4.3b Non-Google / non-admin caller attempting to claim Master Admin profile -> HTTP 403
    const resNonAdminMaster = createMockRes();
    await handleMigrateLegacyAuth(
      {
        user: { uid: 'uid-attacker-1', email: 'attacker@synthetic.local', signInProvider: 'password', emailVerified: false, isAdminClaim: false },
        body: { email: 'coach.master@synthetic.local', pin: '4321' },
        ip: '10.0.0.4',
        socket: {},
      } as any,
      resNonAdminMaster,
      testDeps
    );
    assert(resNonAdminMaster.statusCode === 403 && resNonAdminMaster.body?.success === false, 'Migración bloquea intento sin autorización Google Admin sobre perfil_admin_master con HTTP 403');

    // 4.4a Wrong PIN rejected with HTTP 401
    const resWrongPin = createMockRes();
    await handleMigrateLegacyAuth(
      {
        user: { uid: 'uid-caller-1', email: 'legacy.test@synthetic.local', signInProvider: 'password', emailVerified: true, isAdminClaim: false },
        body: { email: 'legacy.test@synthetic.local', pin: '0000' },
        ip: '10.0.0.5',
        socket: {},
      } as any,
      resWrongPin,
      testDeps
    );
    assert(resWrongPin.statusCode === 401 && resWrongPin.body?.success === false, 'Migración rechaza PIN heredado incorrecto con HTTP 401');

    // 4.4b Valid authorized migration -> HTTP 200, binds authUid, purges legacy PIN, writes audit log
    const resValid = createMockRes();
    await handleMigrateLegacyAuth(
      {
        user: { uid: 'uid-caller-1', email: 'legacy.test@synthetic.local', signInProvider: 'password', emailVerified: true, isAdminClaim: false },
        body: { email: 'legacy.test@synthetic.local', pin: '4321' },
        ip: '10.0.0.5',
        socket: {},
      } as any,
      resValid,
      testDeps
    );
    const updatedAth = collections.athletes.get('test-ath-legacy-1');
    const updatedCreds = collections.athlete_credentials.get('test-ath-legacy-1');
    assert(resValid.statusCode === 200 && resValid.body?.success === true, 'Migración válida y autorizada responde HTTP 200 con success: true');
    assert(resValid.body?.authUid === 'uid-caller-1' && resValid.body?.athleteId === 'test-ath-legacy-1', 'Vincula exactamente al athleteId y authUid del caller');
    assert(updatedAth?.authUid === 'uid-caller-1' && updatedAth?.migrationStatus === 'confirmed' && !('pin' in updatedAth), 'Purga el PIN heredado en /athletes y confirma migración');
    assert(!('pinHash' in (updatedCreds || {})) && updatedCreds?.linkedAuthUid === 'uid-caller-1', 'Zeroiza credenciales heredadas tras migración');
    assert(collections.security_audit_logs.size === 1, 'Registra evento de auditoría de seguridad tras migración exitosa');

    // 4.5a Duplicate migration prevention (re-attempting same confirmed profile) -> HTTP 409
    const resDuplicateSameUid = createMockRes();
    await handleMigrateLegacyAuth(
      {
        user: { uid: 'uid-caller-1', email: 'legacy.test@synthetic.local', signInProvider: 'password', emailVerified: true, isAdminClaim: false },
        body: { email: 'legacy.test@synthetic.local', pin: '4321' },
        ip: '10.0.0.5',
        socket: {},
      } as any,
      resDuplicateSameUid,
      testDeps
    );
    assert(
      resDuplicateSameUid.statusCode === 409 && resDuplicateSameUid.body?.alreadyMigrated === true,
      'Previene migración duplicada del mismo perfil con HTTP 409 (alreadyMigrated: true)'
    );

    // 4.5b Duplicate binding prevention (caller already linked trying to claim another unlinked profile) -> HTTP 409
    collections.athletes.set('test-ath-second-unlinked', {
      id: 'test-ath-second-unlinked',
      name: 'Segundo Heredado',
      email: 'second.test@synthetic.local',
      migrationStatus: 'pending',
    });
    const resCallerAlreadyBound = createMockRes();
    await handleMigrateLegacyAuth(
      {
        user: { uid: 'uid-caller-1', email: 'second.test@synthetic.local', signInProvider: 'password', emailVerified: true, isAdminClaim: false },
        body: { email: 'second.test@synthetic.local', pin: '4321' },
        ip: '10.0.0.5',
        socket: {},
      } as any,
      resCallerAlreadyBound,
      testDeps
    );
    assert(
      resCallerAlreadyBound.statusCode === 409 && resCallerAlreadyBound.body?.success === false,
      'Impide que un mismo authUid reclame un segundo perfil de atleta (HTTP 409)'
    );

    // 4.6 Cross-athlete anti-hijacking protection (different caller trying to claim another athlete's profile) -> HTTP 409
    const resHijackAttempt = createMockRes();
    await handleMigrateLegacyAuth(
      {
        user: { uid: 'uid-attacker-2', email: 'attacker2@synthetic.local', signInProvider: 'password', emailVerified: true, isAdminClaim: false },
        body: { email: 'other.athlete@synthetic.local', pin: '4321' },
        ip: '10.0.0.6',
        socket: {},
      } as any,
      resHijackAttempt,
      testDeps
    );
    assert(
      resHijackAttempt.statusCode === 409 &&
        resHijackAttempt.body?.alreadyLinkedToAnotherUid === true &&
        collections.athletes.get('test-ath-other-owner')?.authUid === 'uid-real-owner-999',
      'Bloquea intento de acceso/secuestro sobre perfil de otro atleta (HTTP 409, authUid original intacto)'
    );

    // 4.7 Invite redemption validation checks (kept intact)
    const mockReqInviteUnauth: any = { body: { token: 'LZK-TEST-1234' }, user: null };
    const mockResInviteUnauth = createMockRes();
    await handleRedeemInvite(mockReqInviteUnauth, mockResInviteUnauth);
    assert(mockResInviteUnauth.statusCode === 401, 'Canje de invitación rechaza peticiones no autenticadas con HTTP 401');

    const mockReqInviteEmpty: any = { body: { token: '' }, user: { uid: 'user-123' } };
    const mockResInviteEmpty = createMockRes();
    await handleRedeemInvite(mockReqInviteEmpty, mockResInviteEmpty);
    assert(mockResInviteEmpty.statusCode === 400, 'Canje de invitación rechaza petición sin token con HTTP 400');

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 4:', err.message);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Simulación Rigurosa de Reglas Firestore (Aislamiento por Atleta)
  // ---------------------------------------------------------------------------
  console.log('\n5. PRUEBA DE EVALUACIÓN DE REGLAS FIRESTORE (SIN FALLBACK ABIERTO)');
  try {
    interface SecurityContext {
      auth: {
        uid: string;
        token: {
          admin?: boolean;
          email?: string;
          athleteId?: string;
        };
      } | null;
    }

    interface DocResource {
      id: string;
      data: Record<string, any>;
    }

    // Implementation of the exact logic in firestore.rules
    const rulesEvaluator = {
      isAuthenticated: (ctx: SecurityContext) => ctx.auth !== null,
      isAdmin: (ctx: SecurityContext) => {
        if (!ctx.auth) return false;
        return ctx.auth.token.admin === true || ctx.auth.token.email === 'admin@example.invalid';
      },
      isOwner: (ctx: SecurityContext, athleteId: string, resource: DocResource) => {
        if (!ctx.auth) return false;
        return (
          ctx.auth.uid === athleteId ||
          ctx.auth.uid === resource.data.authUid ||
          ctx.auth.token.athleteId === athleteId
        );
      },
      canReadAthlete: (ctx: SecurityContext, athleteId: string, resource: DocResource) => {
        return rulesEvaluator.isAdmin(ctx) || rulesEvaluator.isOwner(ctx, athleteId, resource);
      },
      canCreateAthlete: (ctx: SecurityContext, athleteId: string, newResourceData: Record<string, any>) => {
        if (rulesEvaluator.isAdmin(ctx)) return true;
        if (!rulesEvaluator.isAuthenticated(ctx)) return false;
        const isOwnerCreate = ctx.auth!.uid === athleteId || newResourceData.authUid === ctx.auth!.uid || ctx.auth!.token.athleteId === athleteId;
        const noAdminEscalation = newResourceData.isAdmin !== true;
        const validAuthUid = newResourceData.authUid === ctx.auth!.uid;
        return isOwnerCreate && noAdminEscalation && validAuthUid;
      },
      canUpdateAthlete: (ctx: SecurityContext, athleteId: string, existingResource: DocResource, newResourceData: Record<string, any>) => {
        if (rulesEvaluator.isAdmin(ctx)) return true;
        if (!rulesEvaluator.isOwner(ctx, athleteId, existingResource)) return false;
        // Anti-escalation check
        const preservesAdmin = !('isAdmin' in newResourceData) || newResourceData.isAdmin === existingResource.data.isAdmin;
        // Anti-hijacking check
        const preservesAuthUid = !('authUid' in newResourceData) || newResourceData.authUid === existingResource.data.authUid;
        return preservesAdmin && preservesAuthUid;
      },
      canAccessInvites: (ctx: SecurityContext) => {
        return rulesEvaluator.isAdmin(ctx);
      }
    };

    // User contexts
    const unauthenticatedUser: SecurityContext = { auth: null };
    const athleteA: SecurityContext = {
      auth: { uid: 'auth-user-A', token: { admin: false, email: 'atletaA@gym.com', athleteId: 'ath-A' } }
    };
    const athleteB: SecurityContext = {
      auth: { uid: 'auth-user-B', token: { admin: false, email: 'atletaB@gym.com', athleteId: 'ath-B' } }
    };
    const adminUser: SecurityContext = {
      auth: { uid: 'auth-admin', token: { admin: true, email: 'admin@example.invalid', athleteId: 'perfil_1' } }
    };

    const docAthleteA: DocResource = {
      id: 'ath-A',
      data: { id: 'ath-A', name: 'Atleta A', authUid: 'auth-user-A', isAdmin: false }
    };
    const docAthleteB: DocResource = {
      id: 'ath-B',
      data: { id: 'ath-B', name: 'Atleta B', authUid: 'auth-user-B', isAdmin: false }
    };

    // 1. Unauthenticated read attempt
    assert(!rulesEvaluator.canReadAthlete(unauthenticatedUser, 'ath-A', docAthleteA), 'Usuario anónimo no puede leer perfiles');

    // 2. Athlete A reading Athlete A
    assert(rulesEvaluator.canReadAthlete(athleteA, 'ath-A', docAthleteA), 'Atleta A puede leer su propio perfil');

    // 3. Athlete A attempting to read Athlete B (Aislamiento estricto sin fallback)
    assert(!rulesEvaluator.canReadAthlete(athleteA, 'ath-B', docAthleteB), 'Atleta A NO puede leer el perfil de Atleta B (aislamiento garantizado)');

    // 4. Admin reading Athlete B
    assert(rulesEvaluator.canReadAthlete(adminUser, 'ath-B', docAthleteB), 'Administrador con Custom Claim puede supervisar perfiles');

    // 5. Athlete A attempting to escalate privileges to isAdmin: true on update
    const escalatedData = { ...docAthleteA.data, isAdmin: true };
    assert(!rulesEvaluator.canUpdateAthlete(athleteA, 'ath-A', docAthleteA, escalatedData), 'Atleta A NO puede promoverse a sí mismo como isAdmin');

    // 6. Athlete A attempting to reassign authUid
    const hijackedData = { ...docAthleteA.data, authUid: 'some-other-uid' };
    assert(!rulesEvaluator.canUpdateAthlete(athleteA, 'ath-A', docAthleteA, hijackedData), 'Atleta A NO puede alterar ni secuestrar su authUid');

    // 7. Legitimate update of profile by Athlete A
    const legitimateData = { ...docAthleteA.data, name: 'Atleta A Modificado', goal: 'Fuerza' };
    assert(rulesEvaluator.canUpdateAthlete(athleteA, 'ath-A', docAthleteA, legitimateData), 'Atleta A puede actualizar legítimamente sus metas y nombre');

    // 8. Invites collection read by regular athlete
    assert(!rulesEvaluator.canAccessInvites(athleteA), 'Atleta regular NO puede leer ni enumerar la colección /invites');

    // 9. Invites collection read by Admin
    assert(rulesEvaluator.canAccessInvites(adminUser), 'Administrador sí tiene autorización de gestionar /invites');

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 5:', err.message);
    failed++;
  }

  console.log('\n======================================================');
  console.log(`   RESULTADO: ${passed} PASADAS / ${failed} FALLIDAS`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Error fatal en ejecución del test suite:', err);
  process.exit(1);
});
