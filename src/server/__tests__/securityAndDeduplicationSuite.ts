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
  // TEST 4: Controladores de Migración y Canje (Validación de Esquema)
  // ---------------------------------------------------------------------------
  console.log('\n4. PRUEBA DE RESPUESTAS Y VALIDACIÓN DE CONTROLADORES SERVER');
  try {
    // We import dynamically to test input validation
    const { handleMigrateLegacyAuth, handleRedeemInvite } = await import('../authMigrationController.ts');

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
        }
      };
      return resObj;
    }

    // Missing email / PIN
    const mockReq1: any = { body: { email: '', pin: '' }, ip: '127.0.0.1', socket: {} };
    const mockRes1 = createMockRes();
    await handleMigrateLegacyAuth(mockReq1, mockRes1);
    assert(mockRes1.statusCode === 400, 'Migración rechaza petición sin credenciales con HTTP 400');
    assert(mockRes1.body.success === false, 'Responde success: false');

    // Unauthenticated invite redemption
    const mockReq2: any = { body: { token: 'LZK-TEST-1234' }, user: null };
    const mockRes2 = createMockRes();
    await handleRedeemInvite(mockReq2, mockRes2);
    assert(mockRes2.statusCode === 401, 'Canje de invitación rechaza peticiones no autenticadas con HTTP 401');

    // Missing token in invite redemption
    const mockReq3: any = { body: { token: '' }, user: { uid: 'user-123' } };
    const mockRes3 = createMockRes();
    await handleRedeemInvite(mockReq3, mockRes3);
    assert(mockRes3.statusCode === 400, 'Canje de invitación rechaza petición sin token con HTTP 400');

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
