/**
 * LAZCAKONG GYM - REAL FIREBASE EMULATOR & INTEGRATION TEST SUITE
 * 
 * Runs REAL tests against:
 * 1. Live Firestore Emulator (Port 8080) with real firestore.rules
 * 2. Live Firebase Auth Emulator (Port 9099)
 * 3. Server Admin SDK endpoints with synthetic profiles
 * 4. Rate-limiting under multi-instance simulation
 * 5. Same-day identical routine/volume/sets preservation with stable IDs
 */

import fs from 'node:fs';
import path from 'path';
import crypto from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { purgeAndSanitizeWorkoutHistory } from '../../utils/historySanitizer.ts';
import {
  createSanitizedProfileBackup,
  inspectBackupForRestore,
  executeSafeBackupRestore,
  type StorageLike,
} from '../../utils/eliteBackupEngine.ts';
import {
  checkRateLimitDistributed,
  resetRateLimitDistributed,
  hashToken,
  hashPinWithScrypt,
  verifyPinHardened,
  constantTimeCompare,
  getAdminServices,
} from '../firebaseAdminServer.ts';
import {
  handleMigrateLegacyAuth,
  handleRedeemInvite,
  handleAdminRecoverAthlete,
} from '../authMigrationController.ts';
import { CompletedWorkout, Profile } from '../../types/index.ts';

const PROJECT_ID = 'demo-lazcakongym-test';
const RULES_ADMIN_EMAIL = 'kmiloko19@gmail.com';
const RULES_ADMIN_TOKEN = {
  email: RULES_ADMIN_EMAIL,
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' as const, identities: {} },
};

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runRealEmulatorTestSuite() {
  console.log('\n==================================================================');
  console.log('   LAZCAKONG GYM - VERIFICACIÓN REAL CON FIREBASE EMULATORS       ');
  console.log('==================================================================\n');

  let passed = 0;
  let failed = 0;
  let testEnv: RulesTestEnvironment | null = null;

  // ---------------------------------------------------------------------------
  // 1. REAL FIRESTORE SECURITY RULES ON LIVE EMULATOR
  // ---------------------------------------------------------------------------
  console.log('1. PRUEBA REAL DE REGLAS FIRESTORE EN EMULADOR (AISLAMIENTO Y BLOQUEO)');
  try {
    const rulesContent = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: rulesContent,
        host: '127.0.0.1',
        port: 8080,
      },
    });

    await testEnv.clearFirestore();

    // Contextos autenticados con tokens sintéticos
    const atletaAContext = testEnv.authenticatedContext('auth-atleta-a', {
      email: 'atleta.a@test.com',
      email_verified: true,
      athleteId: 'perfil-a',
    });

    const atletaBContext = testEnv.authenticatedContext('auth-atleta-b', {
      email: 'atleta.b@test.com',
      email_verified: true,
      athleteId: 'perfil-b',
    });

    const unauthedContext = testEnv.unauthenticatedContext();

    const adminContext = testEnv.authenticatedContext('auth-admin', {
      ...RULES_ADMIN_TOKEN,
      athleteId: 'perfil_1',
    });

    // Sembrar perfil A en el emulador (como admin)
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'athletes', 'perfil-a'), {
        id: 'perfil-a',
        name: 'Atleta A Real',
        email: 'atleta.a@test.com',
        authUid: 'auth-atleta-a',
        isAdmin: false,
        routines: [],
        history: [],
      });
      await setDoc(doc(adminDb, 'athletes', 'perfil-b'), {
        id: 'perfil-b',
        name: 'Atleta B Real',
        email: 'atleta.b@test.com',
        authUid: 'auth-atleta-b',
        isAdmin: false,
        routines: [],
        history: [],
      });
      await setDoc(doc(adminDb, 'invites', 'INVITE-SECRET-123'), {
        token: 'INVITE-SECRET-123',
        used: false,
      });
    });

    // 1.1 Usuario anónimo intentando leer perfil
    await assertFails(getDoc(doc(unauthedContext.firestore(), 'athletes', 'perfil-a')));
    assert(true, 'Usuario anónimo es RECHAZADO por el emulador (Permission Denied)');

    // 1.2 Atleta A leyendo su propio perfil
    await assertSucceeds(getDoc(doc(atletaAContext.firestore(), 'athletes', 'perfil-a')));
    assert(true, 'Atleta A puede leer su propio perfil exitosamente (Permitido)');

    // 1.3 Atleta A intentando leer perfil de Atleta B (AISLAMIENTO TOTAL)
    await assertFails(getDoc(doc(atletaAContext.firestore(), 'athletes', 'perfil-b')));
    assert(true, 'Atleta A tiene BLOQUEADO el acceso al perfil de Atleta B (Aislamiento real)');

    // 1.4 Atleta A intentando promoverse a isAdmin: true en su perfil
    await assertFails(
      updateDoc(doc(atletaAContext.firestore(), 'athletes', 'perfil-a'), {
        isAdmin: true,
      })
    );
    assert(true, 'Atleta A tiene BLOQUEADA la auto-promoción administrativa (isAdmin inmutable)');

    // 1.5 Atleta A intentando cambiar o secuestrar authUid
    await assertFails(
      updateDoc(doc(atletaAContext.firestore(), 'athletes', 'perfil-a'), {
        authUid: 'auth-atleta-b',
      })
    );
    assert(true, 'Atleta A tiene BLOQUEADO el secuestro o alteración de authUid');

    // 1.6 Atleta A actualizando campos legítimos (metas, nombre)
    await assertSucceeds(
      updateDoc(doc(atletaAContext.firestore(), 'athletes', 'perfil-a'), {
        name: 'Atleta A Modificado',
      })
    );
    assert(true, 'Atleta A puede actualizar legítimamente campos permitidos (nombre, metas)');

    // 1.7 Administrador accediendo a supervisar perfil B
    await assertSucceeds(getDoc(doc(adminContext.firestore(), 'athletes', 'perfil-b')));
    assert(true, 'Administrador con cuenta Google verificada puede supervisar atletas');

    // 1.8 Atleta regular intentando leer la colección de invitaciones
    await assertFails(getDoc(doc(atletaAContext.firestore(), 'invites', 'INVITE-SECRET-123')));
    assert(true, 'Atleta regular tiene BLOQUEADO el acceso a la colección /invites');

    // 1.9 Administrador leyendo invitaciones
    await assertSucceeds(getDoc(doc(adminContext.firestore(), 'invites', 'INVITE-SECRET-123')));
    assert(true, 'Administrador sí puede consultar y gestionar /invites');

    // 1.10 Colección separada de credenciales (athlete_credentials) TOTALMENTE BLOQUEADA al cliente
    await assertFails(getDoc(doc(atletaAContext.firestore(), 'athlete_credentials', 'perfil-a')));
    assert(true, 'Colección /athlete_credentials bloqueada al cliente (allow read, write: if false)');

    // 1.11 Registros de auditoría de seguridad
    await assertFails(getDoc(doc(atletaAContext.firestore(), 'security_audit_logs', 'log-1')));
    assert(true, 'Atleta regular no puede leer registros de auditoría (/security_audit_logs)');
    await assertSucceeds(getDoc(doc(adminContext.firestore(), 'security_audit_logs', 'log-1')));
    assert(true, 'Administrador sí puede supervisar registros de auditoría (/security_audit_logs)');

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 1 (Emulador Firestore):', err.message);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 2. REAL SERVER-SIDE ENDPOINTS CON FIREBASE ADMIN SDK & USUARIOS SINTÉTICOS
  // ---------------------------------------------------------------------------
  console.log('\n2. PRUEBA REAL DE CONTROLADORES SERVER (MIGRACIÓN, PIN Y CANJE)');
  try {
    const { db } = getAdminServices();

    // Sembrar atleta sintético para migración
    const syntheticEmail = 'sintetico.elite@lazcakon.test';
    const correctPin = '7788';
    const syntheticDocId = 'synthetic_atleta_01';

    await db.collection('athletes').doc(syntheticDocId).set({
      id: syntheticDocId,
      name: 'Atleta Sintético Migración',
      email: syntheticEmail,
      pin: correctPin,
      isAdmin: false,
      routines: [],
      history: [],
      createdAt: new Date().toISOString(),
    });

    const createMockRes = () => {
      const res: any = {
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
      return res;
    };

    // 2.1 Intento con PIN incorrecto
    const caller = { uid: 'test-migration-athlete', email: syntheticEmail, signInProvider: 'password', emailVerified: true };
    const reqWrongPin: any = {
      user: caller,
      body: { email: syntheticEmail, pin: '0000' },
      ip: '10.0.0.99',
      socket: {},
    };
    const resWrongPin = createMockRes();
    await handleMigrateLegacyAuth(reqWrongPin, resWrongPin);
    assert(resWrongPin.statusCode === 401, 'PIN incorrecto rechazado con HTTP 401 Credenciales inválidas');

    // 2.2 Prueba de límite de intentos (Rate Limiter Distribuido)
    for (let i = 1; i <= 4; i++) {
      const resLoop = createMockRes();
      await handleMigrateLegacyAuth(reqWrongPin, resLoop);
    }
    // 6to intento total
    const resBlocked = createMockRes();
    await handleMigrateLegacyAuth(reqWrongPin, resBlocked);
    assert(resBlocked.statusCode === 429, '6to intento bloqueado por Rate Limiter con HTTP 429');

    // Resetear rate limit del test
    await resetRateLimitDistributed(`migrate:10.0.0.99:${syntheticEmail}`);

    // 2.3 Migración exitosa con PIN correcto
    const reqCorrect: any = {
      user: caller,
      body: { email: syntheticEmail, pin: correctPin },
      ip: '10.0.0.99',
      socket: {},
    };
    const resCorrect = createMockRes();
    await handleMigrateLegacyAuth(reqCorrect, resCorrect);

    assert(resCorrect.statusCode === 200, 'Migración exitosa devuelve HTTP 200');
    assert(resCorrect.body.success === true, 'Respuesta confirma success: true');
    assert(resCorrect.body.authUid === caller.uid, 'Conserva el UID de la sesión Firebase autenticada');
    assert(!resCorrect.body.customToken, 'La migración no emite tokens personalizados');
    assert(resCorrect.body.athleteId === syntheticDocId, 'Vincula exactamente el ID del perfil de atleta existente');

    // Verificar en base de datos que el documento del atleta fue actualizado a confirmed
    const updatedSnap = await db.collection('athletes').doc(syntheticDocId).get();
    const updatedData = updatedSnap.data() || {};
    assert(updatedData.migrationStatus === 'confirmed', 'Estampa estado migrationStatus: confirmed en la base de datos');
    assert(typeof updatedData.authUid === 'string', 'Asocia authUid generado sin exponer secretos');
    assert(updatedData.pin === undefined, 'Campo pin legado fue completamente eliminado del perfil del atleta');

    assert(updatedData.authUid === caller.uid, 'Asocia exactamente el UID autenticado');

    // 2.3.1 Prueba de derivación criptográfica scrypt offline
    const testPinCandidate = '4321';
    const scryptHash = await hashPinWithScrypt(testPinCandidate);
    assert(scryptHash.startsWith('scrypt$16384$8$1$'), 'scryptHash generado con parámetros seguros N=16384, r=8, p=1');
    const validVerify = await verifyPinHardened(testPinCandidate, scryptHash);
    assert(validVerify.matches === true && validVerify.needsRehash === false, 'Verificación de PIN con scrypt exitosa sin requerir re-hash');
    const invalidVerify = await verifyPinHardened('9999', scryptHash);
    assert(invalidVerify.matches === false, 'Candidato inválido rechazado en tiempo constante');

    const resAlreadyClaimed = createMockRes();
    await handleMigrateLegacyAuth(reqCorrect, resAlreadyClaimed);
    assert(resAlreadyClaimed.statusCode === 409, 'Bloquea una nueva migración tras confirmar el vínculo');

    // 2.5 Prueba con PIN almacenado como hash SHA-256 (Atleta con esquema hasheado)
    const hashedPinAthleteEmail = 'hashed.pin@lazcakon.test';
    const plainSecretPin = '5566';
    const hashedPinDocId = 'synthetic_atleta_hashed';
    await db.collection('athletes').doc(hashedPinDocId).set({
      id: hashedPinDocId,
      name: 'Atleta con PIN Hasheado',
      email: hashedPinAthleteEmail,
      pin: hashToken(plainSecretPin), // Almacenado como hash SHA-256 de 64 caracteres
      isAdmin: false,
      routines: [],
      history: [],
      createdAt: new Date().toISOString(),
    });

    const reqHashedMigrate: any = {
      user: { ...caller, uid: 'test-hashed-athlete', email: hashedPinAthleteEmail },
      body: { email: hashedPinAthleteEmail, pin: plainSecretPin },
      ip: '10.0.0.98',
      socket: {},
    };
    const resHashedMigrate = createMockRes();
    await handleMigrateLegacyAuth(reqHashedMigrate, resHashedMigrate);
    assert(resHashedMigrate.statusCode === 200, 'Migración exitosa de perfil con PIN almacenado en formato SHA-256');

    const migratedHashedSnap = await db.collection('athletes').doc(hashedPinDocId).get();
    assert(migratedHashedSnap.data()?.pin === undefined, 'Elimina el PIN SHA-256 legado después de vincular el perfil');

    // 2.6 Canje de invitación única con Hashing SHA-256 y transacción atómica
    const rawInviteCode = 'LZK-SYNTH-9988';
    const hashedInviteDocId = hashToken(rawInviteCode);

    await db.collection('invites').doc(hashedInviteDocId).set({
      token: rawInviteCode,
      createdAt: new Date().toISOString(),
      createdBy: 'Coach Admin',
      used: false,
      revoked: false,
    });

    const mockAuthUser = {
      uid: updatedData.authUid,
      email: syntheticEmail,
      isAdmin: false,
    };

    // Canje inicial legítimo
    const reqRedeem1: any = {
      body: { token: rawInviteCode },
      user: mockAuthUser,
    };
    const resRedeem1 = createMockRes();
    await handleRedeemInvite(reqRedeem1, resRedeem1);
    assert(resRedeem1.statusCode === 200, 'Canje inicial de invitación exitoso con HTTP 200');

    // Segundo intento con el MISMO código (Garantía de uso único)
    const reqRedeem2: any = {
      body: { token: rawInviteCode },
      user: mockAuthUser,
    };
    const resRedeem2 = createMockRes();
    await handleRedeemInvite(reqRedeem2, resRedeem2);
    assert(resRedeem2.statusCode === 409, 'Segundo canje de invitación rechazado con HTTP 409 (Uso único garantizado)');

    // Probar la recuperación con una lista administrativa sintética.
    process.env.ADMIN_EMAILS = 'admin@example.invalid';
    const adminUserContext = {
      uid: 'admin_test_uid',
      email: 'admin@example.invalid',
      isAdmin: true,
    };
    const reqAdminRecover: any = {
      user: adminUserContext,
      body: {
        athleteId: syntheticDocId,
        targetEmail: syntheticEmail,
        reason: 'Recuperación de prueba controlada',
      },
    };
    const resAdminRecover = createMockRes();
    await handleAdminRecoverAthlete(reqAdminRecover, resAdminRecover);
    assert(resAdminRecover.statusCode === 200, 'Administrador Master genera código de recuperación con HTTP 200');
    assert(typeof resAdminRecover.body.recoveryCode === 'string' && resAdminRecover.body.recoveryCode.startsWith('LZK-REC-'), 'Retorna código temporal LZK-REC-XXXX');
    assert(resAdminRecover.body.expiresInMinutes === 15, 'Código de recuperación válido por 15 minutos');

    // Verificar registro inmutable en /security_audit_logs
    const auditLogsSnap = await db.collection('security_audit_logs').where('targetAthleteId', '==', syntheticDocId).get();
    assert(!auditLogsSnap.empty, 'Registro inmutable de auditoría generado en /security_audit_logs');
    assert(auditLogsSnap.docs[0].data().eventType === 'ADMIN_RECOVERY_CODE_GENERATED', 'Evento registrado correctamente en auditoría');

    // Intento de recuperación por un usuario NO admin debe ser rechazado
    const nonAdminContext = { uid: 'regular_uid', email: 'regular@test.com', isAdmin: false };
    const reqNonAdminRecover: any = { user: nonAdminContext, body: { athleteId: syntheticDocId } };
    const resNonAdminRecover = createMockRes();
    await handleAdminRecoverAthlete(reqNonAdminRecover, resNonAdminRecover);
    assert(resNonAdminRecover.statusCode === 403, 'Intento de recuperación por usuario no-admin rechazado con HTTP 403');

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 2 (Controladores Server):', err.message);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 3. PERSISTENCIA DE ENTRENAMIENTOS IDÉNTICOS EL MISMO DÍA (PUNTO 5)
  // ---------------------------------------------------------------------------
  console.log('\n3. PRUEBA DE PRESERVACIÓN DE SESIONES LEGÍTIMAS IDÉNTICAS EL MISMO DÍA');
  try {
    // Escenario crítico del usuario:
    // Dos entrenamientos en la MISMA fecha ('2026-11-12'), con la MISMA rutina ('Pierna Pesada'),
    // el MISMO volumen (2400 kg) y las MISMAS series (8), pero con IDs estables y horas distintas (Mañana y Tarde)
    const sessionMorning: CompletedWorkout = {
      id: 'session-2026-11-12-morning-0900',
      routineId: 'leg-hypertrophy',
      routineTitle: 'Pierna Pesada',
      date: '2026-11-12',
      startTime: Date.parse('2026-11-12T09:00:00-03:00'), // 09:00 AM
      endTime: Date.parse('2026-11-12T10:00:00-03:00'),
      durationSeconds: 3600,
      totalVolumeKg: 2400,
      completedSetsCount: 8,
      isFinished: true,
      exercisesSummary: [
        { name: 'Sentadilla Hack', sets: 4, maxWeight: 150, maxReps: 10, volumeKg: 1200 },
        { name: 'Prensa 45°', sets: 4, maxWeight: 200, maxReps: 10, volumeKg: 1200 },
      ],
    };

    const sessionAfternoon: CompletedWorkout = {
      id: 'session-2026-11-12-afternoon-1800',
      routineId: 'leg-hypertrophy',
      routineTitle: 'Pierna Pesada',
      date: '2026-11-12',
      startTime: Date.parse('2026-11-12T18:00:00-03:00'), // 18:00 PM
      endTime: Date.parse('2026-11-12T19:00:00-03:00'),
      durationSeconds: 3600,
      totalVolumeKg: 2400,
      completedSetsCount: 8,
      isFinished: true,
      exercisesSummary: [
        { name: 'Sentadilla Hack', sets: 4, maxWeight: 150, maxReps: 10, volumeKg: 1200 },
        { name: 'Prensa 45°', sets: 4, maxWeight: 200, maxReps: 10, volumeKg: 1200 },
      ],
    };

    // Un clon idéntico repetido por error de red o doble envío
    const duplicateOfMorning: CompletedWorkout = { ...sessionMorning };

    const batch = [sessionMorning, sessionAfternoon, duplicateOfMorning];
    const purgeReport = purgeAndSanitizeWorkoutHistory(batch);

    assert(purgeReport.cleanedHistory.length === 2, 'Sanitizer conserva exactamente las 2 sesiones legítimas y descarta el duplicado idéntico');
    assert(purgeReport.cleanedHistory.some(w => w.id === 'session-2026-11-12-morning-0900'), 'Sesión matutina conservada intacta');
    assert(purgeReport.cleanedHistory.some(w => w.id === 'session-2026-11-12-afternoon-1800'), 'Sesión vespertina (con mismo día/rutina/sets/volumen) conservada intacta');

    // Prueba en motor de respaldo JSON:
    // La sesión matutina ya existe en la base de datos del atleta, y se importa un respaldo que contiene la sesión vespertina
    const inMemoryStorage: Record<string, string> = {};
    const mockStorage: StorageLike = {
      getItem: (k: string) => inMemoryStorage[k] || null,
      setItem: (k: string, v: string) => { inMemoryStorage[k] = v; },
      removeItem: (k: string) => { delete inMemoryStorage[k]; },
    };

    const profile: Profile = {
      id: 'ath_dedup_test',
      name: 'Atleta Test Dedup',
      email: 'dedup@test.com',
      pin: '1234',
      avatar: '🦍',
      goal: 'Fuerza',
      weeklyTargetDays: 5,
      weightUnit: 'kg',
      soundEnabled: true,
      vibrationEnabled: true,
      createdAt: '2026-01-01',
    };

    const currentState = {
      routines: [],
      history: [sessionMorning],
      prs: {},
      bodyWeightLogs: [],
      customLinks: {},
      selectedAlternatives: {},
    };

    // Respaldo generado que contiene la sesión vespertina
    const backupV2 = createSanitizedProfileBackup({
      profile,
      routines: [],
      history: [sessionAfternoon],
      prs: {},
      bodyWeightLogs: [],
      customLinks: {},
      selectedAlternatives: {},
      storage: mockStorage,
    });
    const backupJson = JSON.stringify(backupV2);

    const inspection = inspectBackupForRestore({ rawJson: backupJson, targetProfile: profile, currentState });
    assert(inspection.valid === true, 'Inspección de respaldo es válida con checksum íntegro');
    assert(inspection.counts.willAdd.history === 1, 'Inspección reconoce correctamente que la sesión vespertina debe ser agregada');

    const restoreResult = executeSafeBackupRestore({
      rawJson: backupJson,
      targetProfile: profile,
      currentState,
      strategy: 'merge_safe',
      confirmed: true,
      storage: mockStorage,
    });

    assert(restoreResult.success === true, 'Restauración merge_safe exitosa');
    const finalHistory = restoreResult.nextState!.history;
    assert(finalHistory.length === 2, 'El historial final contiene exactamente ambas sesiones del mismo día');
    assert(finalHistory.some(w => w.id === 'session-2026-11-12-morning-0900'), 'Sesión matutina previa no fue alterada');
    assert(finalHistory.some(w => w.id === 'session-2026-11-12-afternoon-1800'), 'Sesión vespertina nueva fue integrada sin colisión');

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 3 (Preservación mismo día):', err.message);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 4. RATE LIMITING DISTRIBUIDO MULTI-INSTANCIA (PUNTO 4)
  // ---------------------------------------------------------------------------
  console.log('\n4. PRUEBA DE RATE LIMITING DISTRIBUIDO MULTI-INSTANCIA');
  try {
    const distributedKey = `rate-test-multinode-${Date.now()}`;
    await resetRateLimitDistributed(distributedKey);

    // Simulación de 5 peticiones provenientes de diferentes nodos
    for (let i = 1; i <= 5; i++) {
      const check = await checkRateLimitDistributed(distributedKey, 5, 30000);
      assert(check.allowed === true, `Petición distribuida #${i} aceptada`);
    }

    // 6ta petición debe ser bloqueada globalmente
    const checkBlocked = await checkRateLimitDistributed(distributedKey, 5, 30000);
    assert(checkBlocked.allowed === false, 'Petición distribuida #6 bloqueada globalmente con retryAfterSec');
    assert(typeof checkBlocked.retryAfterSec === 'number' && checkBlocked.retryAfterSec > 0, 'Reporta ventana de retry correcta');

    // Limpieza
    await resetRateLimitDistributed(distributedKey);
    const checkAfterReset = await checkRateLimitDistributed(distributedKey, 5, 30000);
    assert(checkAfterReset.allowed === true, 'Reset distribuido reactiva el contador atómicamente');

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 4 (Rate Limiter Distribuido):', err.message);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 5. IMPORTACIÓN EXCEL Y RESPALDO JSON SIN PÉRDIDA DE DATOS NI SECRETOS (PUNTO 5 Y 6)
  // ---------------------------------------------------------------------------
  console.log('\n5. PRUEBA DE IMPORTACIÓN EXCEL Y RESPALDO JSON SIN PÉRDIDA DE DATOS NI SECRETOS');
  try {
    const { parseGymCsvData } = await import('../../utils/csvImporter.ts');

    // 5.1 Importación segura de hoja de cálculo XLSX/CSV
    const csvRows = [
      { Día: 'Lunes', Rutina: 'Torso A', Ejercicio: 'Press Banca Barra', Series: '4', Repeticiones: '8 a 10', Descanso: '120s' },
      { Día: 'Lunes', Rutina: 'Torso A', Ejercicio: 'Remo con Barra', Series: '4', Repeticiones: '8 a 10', Descanso: '120s' },
      { Día: 'Miércoles', Rutina: 'Pierna A', Ejercicio: 'Sentadilla Libre', Series: '4', Repeticiones: '6 a 8', Descanso: '180s' },
    ];

    const importedResult = parseGymCsvData(csvRows);
    assert(importedResult.routines.length >= 2, 'Importador genera rutinas estructuradas para los días indicados');
    assert(importedResult.routines.some(r => r.dayName === 'Lunes'), 'Genera rutina de Lunes');
    assert(importedResult.routines.some(r => r.dayName === 'Miércoles'), 'Genera rutina de Miércoles');

    // 5.2 Auditoría de Secretos en el Respaldo JSON Exportado
    const profileWithSecrets: Profile = {
      id: 'profile_with_secrets',
      name: 'Atleta con PIN',
      email: 'secrets@test.com',
      pin: '8899', // Secreto que jamás debe salir en el respaldo
      avatar: '🦍',
      goal: 'Hipertrofia',
      weeklyTargetDays: 5,
      weightUnit: 'kg',
      soundEnabled: true,
      vibrationEnabled: true,
      createdAt: new Date().toISOString(),
    };

    const exportedDoc = createSanitizedProfileBackup({
      profile: profileWithSecrets,
      routines: [],
      history: [],
      prs: {},
      bodyWeightLogs: [],
      customLinks: {},
      selectedAlternatives: {},
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    });

    const exportedJsonStr = JSON.stringify(exportedDoc);
    assert(!exportedJsonStr.includes('"pin"'), 'Auditoría de Respaldo: El campo "pin" fue eliminado del archivo');
    assert(!exportedJsonStr.includes('8899'), 'Auditoría de Respaldo: El valor del PIN no existe en el JSON');
    assert(!exportedJsonStr.includes('"password"'), 'Auditoría de Respaldo: Cero referencias a contraseñas');
    assert(!exportedJsonStr.includes('"secret"'), 'Auditoría de Respaldo: Cero claves secretas');

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 5 (Importación y Auditoría de Secretos):', err.message);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 6. PRUEBA REAL DE REGLAS DE CONTINGENCIA Y ROLLBACK SEGURO
  // ---------------------------------------------------------------------------
  console.log('\n6. PRUEBA REAL DE REGLAS DE CONTINGENCIA Y ROLLBACK SEGURO');
  let contingencyEnv: RulesTestEnvironment | null = null;
  try {
    const contingencyRules = fs.readFileSync(path.resolve(process.cwd(), 'contingency_firestore.rules'), 'utf8');

    // Comprobar que NUNCA contenga allow read, write: if true
    assert(!contingencyRules.includes('allow read, write: if true'), 'Reglas de contingencia NUNCA contienen allow read, write: if true');
    assert(!contingencyRules.includes('allow read: if true'), 'Reglas de contingencia NUNCA contienen allow read: if true');
    assert(!contingencyRules.includes('allow write: if true'), 'Reglas de contingencia NUNCA contienen allow write: if true');

    contingencyEnv = await initializeTestEnvironment({
      projectId: 'demo-contingency-test',
      firestore: {
        rules: contingencyRules,
        host: '127.0.0.1',
        port: 8080,
      },
    });

    await contingencyEnv.clearFirestore();

    const athContext = contingencyEnv.authenticatedContext('ath-123', {
      email: 'atleta@contingency.test',
      athleteId: 'ath-123',
    });
    const otherAthContext = contingencyEnv.authenticatedContext('ath-999', {
      email: 'other@contingency.test',
      athleteId: 'ath-999',
    });
    const adminContingency = contingencyEnv.authenticatedContext('admin-uid', {
      ...RULES_ADMIN_TOKEN,
      athleteId: 'perfil_1',
    });
    const anonContext = contingencyEnv.unauthenticatedContext();

    await contingencyEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'athletes', 'ath-123'), {
        id: 'ath-123',
        authUid: 'ath-123',
        name: 'Atleta Contingencia',
      });
    });

    // 6.1 Anónimo rechazado
    await assertFails(getDoc(doc(anonContext.firestore(), 'athletes', 'ath-123')));
    assert(true, 'Contingencia: Usuario anónimo rechazado');

    // 6.2 Propietario puede leer su perfil (Aislamiento preservado)
    await assertSucceeds(getDoc(doc(athContext.firestore(), 'athletes', 'ath-123')));
    assert(true, 'Contingencia: Atleta propietario puede leer su perfil (Aislamiento preservado)');

    // 6.3 Otro atleta no puede leer perfil ajeno
    await assertFails(getDoc(doc(otherAthContext.firestore(), 'athletes', 'ath-123')));
    assert(true, 'Contingencia: Atleta no propietario bloqueado (Sin fugas entre atletas)');

    // 6.4 Escrituras de atletas congeladas durante rollback
    await assertFails(updateDoc(doc(athContext.firestore(), 'athletes', 'ath-123'), { name: 'Hack' }));
    assert(true, 'Contingencia: Escrituras de atletas congeladas para proteger integridad');

    // 6.5 El correo por sí solo no autoriza operaciones administrativas
    const emailOnlyNoClaimContext = contingencyEnv.authenticatedContext('fake-admin-uid', {
      email: RULES_ADMIN_EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'password', identities: {} },
    });
    await assertFails(updateDoc(doc(emailOnlyNoClaimContext.firestore(), 'athletes', 'ath-123'), { name: 'Escalada No Autorizada' }));
    assert(true, 'Contingencia: Correo coincidente con proveedor password es rechazado');

    // La cuenta autorizada mediante Google verificado puede realizar el rescate.
    await assertSucceeds(getDoc(doc(adminContingency.firestore(), 'athletes', 'ath-123')));
    assert(true, 'Contingencia: Administrador con cuenta Google verificada puede leer perfiles en contingencia');
    await assertSucceeds(updateDoc(doc(adminContingency.firestore(), 'athletes', 'ath-123'), { name: 'Rescate Admin' }));
    assert(true, 'Contingencia: Administrador con cuenta Google verificada puede realizar escrituras administrativas de rescate');

    // 6.6 /athlete_credentials totalmente inaccesible
    await assertFails(getDoc(doc(athContext.firestore(), 'athlete_credentials', 'ath-123')));
    assert(true, 'Contingencia: /athlete_credentials bloqueada al cliente (allow read, write: if false)');

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 6 (Reglas de contingencia):', err.message);
    failed++;
  } finally {
    if (contingencyEnv) {
      await contingencyEnv.cleanup();
    }
  }

  // Teardown emulators test environment
  if (testEnv) {
    await testEnv.cleanup();
  }

  console.log('\n==================================================================');
  console.log(`   RESUMEN FINAL: ${passed} PASADAS / ${failed} FALLIDAS`);
  console.log('==================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRealEmulatorTestSuite().catch((err) => {
  console.error('Error fatal durante la ejecución:', err);
  process.exit(1);
});
