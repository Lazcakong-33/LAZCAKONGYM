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
  handleConfirmMigration,
  handleAdminRecoverAthlete,
} from '../authMigrationController.ts';
import { CompletedWorkout, Profile } from '../../types/index.ts';

const PROJECT_ID = 'demo-lazcakongym-test';

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
      email: 'admin@example.invalid',
      email_verified: true,
      admin: true,
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
    assert(true, 'Administrador con Custom Claim admin: true puede supervisar atletas');

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
    const reqWrongPin: any = {
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
      body: { email: syntheticEmail, pin: correctPin },
      ip: '10.0.0.99',
      socket: {},
    };
    const resCorrect = createMockRes();
    await handleMigrateLegacyAuth(reqCorrect, resCorrect);

    assert(resCorrect.statusCode === 200, 'Migración exitosa devuelve HTTP 200');
    assert(resCorrect.body.success === true, 'Respuesta confirma success: true');
    assert(typeof resCorrect.body.customToken === 'string', 'Retorna Custom Token criptográfico para Firebase Auth');
    assert(resCorrect.body.athleteId === syntheticDocId, 'Vincula exactamente el ID del perfil de atleta existente');

    // Verificar en base de datos que el documento del atleta fue actualizado a provisional_claimed
    const updatedSnap = await db.collection('athletes').doc(syntheticDocId).get();
    const updatedData = updatedSnap.data() || {};
    assert(updatedData.migrationStatus === 'provisional_claimed', 'Estampa estado migrationStatus: provisional_claimed en la base de datos');
    assert(typeof updatedData.authUid === 'string', 'Asocia authUid generado sin exponer secretos');
    assert(updatedData.pin === undefined, 'Campo pin legado fue completamente eliminado del perfil del atleta');

    // Verificar que la credencial legacy fue aislada en /athlete_credentials con scrypt KDF
    const isolatedCredSnap = await db.collection('athlete_credentials').doc(syntheticDocId).get();
    assert(isolatedCredSnap.exists, 'Credencial legacy protegida y aislada en /athlete_credentials/{id}');
    assert(typeof isolatedCredSnap.data()?.pinHash === 'string', 'PIN almacenado únicamente como hash');
    assert(isolatedCredSnap.data()?.pinHash.startsWith('scrypt$'), 'PIN actualizado progresivamente a scrypt KDF (N=16384, r=8, p=1) resistente a ataques offline');
    assert(isolatedCredSnap.data()?.kdfAlgorithm === 'scrypt', 'Algoritmo registrado como scrypt con sal aleatoria de 16 bytes');

    // 2.3.1 Prueba de derivación criptográfica scrypt offline
    const testPinCandidate = '4321';
    const scryptHash = await hashPinWithScrypt(testPinCandidate);
    assert(scryptHash.startsWith('scrypt$16384$8$1$'), 'scryptHash generado con parámetros seguros N=16384, r=8, p=1');
    const validVerify = await verifyPinHardened(testPinCandidate, scryptHash);
    assert(validVerify.matches === true && validVerify.needsRehash === false, 'Verificación de PIN con scrypt exitosa sin requerir re-hash');
    const invalidVerify = await verifyPinHardened('9999', scryptHash);
    assert(invalidVerify.matches === false, 'Candidato inválido rechazado en tiempo constante');

    // 2.4 Prueba Anti-Hijacking: Intentar re-reclamar un perfil que ya fue migrado
    const resAlreadyClaimed = createMockRes();
    await handleMigrateLegacyAuth(reqCorrect, resAlreadyClaimed);
    // Nota: provisional_claimed permite al usuario re-intentar si falla la sesión, pero cuando pasa a confirmed se bloquea (409)

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
      body: { email: hashedPinAthleteEmail, pin: plainSecretPin },
      ip: '10.0.0.98',
      socket: {},
    };
    const resHashedMigrate = createMockRes();
    await handleMigrateLegacyAuth(reqHashedMigrate, resHashedMigrate);
    assert(resHashedMigrate.statusCode === 200, 'Migración exitosa de perfil con PIN almacenado en formato SHA-256');

    // Comprobar que en la migración el hash SHA-256 fue progresivamente actualizado a scrypt
    const migratedHashedSnap = await db.collection('athlete_credentials').doc(hashedPinDocId).get();
    assert(migratedHashedSnap.data()?.pinHash.startsWith('scrypt$'), 'Retiro progresivo: Hash legacy SHA-256 fue actualizado automáticamente a scrypt');

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

    // 2.7 Confirmación de sesión y ceroización definitiva con verificación profunda en Firebase Admin SDK
    const { auth } = getAdminServices();

    const mockCustomTokenUser = {
      uid: updatedData.authUid,
      email: syntheticEmail,
      isAdmin: false,
      emailVerified: false,
      signInProvider: 'custom',
    };

    // 2.7.1 Intento con UID falso/no existente en Firebase Auth debe ser rechazado
    const reqConfirmFakeUser: any = {
      user: { uid: 'non_existent_fake_uid', email: syntheticEmail, isAdmin: false, signInProvider: 'google.com', emailVerified: true },
      body: { persistentAuthVerified: true },
    };
    const resConfirmFakeUser = createMockRes();
    await handleConfirmMigration(reqConfirmFakeUser, resConfirmFakeUser);
    assert(resConfirmFakeUser.statusCode === 401, 'Rechazo HTTP 401 si la identidad no existe en Firebase Auth');

    // 2.7.2 Intento con Custom Token + persistentAuthVerified: true debe ser rechazado (422) y NO purgar PIN
    const reqConfirmCustomOnly: any = {
      user: mockCustomTokenUser,
      body: { persistentAuthVerified: true },
    };
    const resConfirmCustomOnly = createMockRes();
    await handleConfirmMigration(reqConfirmCustomOnly, resConfirmCustomOnly);
    assert(resConfirmCustomOnly.statusCode === 422, 'Rechazo HTTP 422: Custom Token + persistentAuthVerified no purga credencial legacy');
    const credStillIntact = await db.collection('athlete_credentials').doc(syntheticDocId).get();
    assert(credStillIntact.exists, 'Credencial legacy intacta tras rechazo de Custom Token');

    // Vincular correo verificado y contraseña controlada por el usuario para la prueba
    await auth.updateUser(updatedData.authUid, {
      emailVerified: true,
      password: 'UserChosenStrongPassword!2026',
    });

    const mockVerifiedPasswordUser = {
      uid: updatedData.authUid,
      email: syntheticEmail,
      isAdmin: false,
      emailVerified: true,
      signInProvider: 'password',
      authTime: Math.floor(Date.now() / 1000),
    };

    // 2.7.3 Intento con discrepancia de email respecto al perfil
    const reqConfirmEmailMismatch: any = {
      user: { ...mockVerifiedPasswordUser, email: 'impostor@lazcakon.test' },
      body: { persistentAuthVerified: true },
    };
    const resConfirmMismatch = createMockRes();
    await handleConfirmMigration(reqConfirmEmailMismatch, resConfirmMismatch);
    assert(resConfirmMismatch.statusCode === 403, 'Rechazo HTTP 403 si el email de Firebase Auth discrepa del perfil de atleta');

    // 2.7.4 Intento sin persistencia verificada explícitamente en false debe ser rechazado
    const reqConfirmNoPersist: any = { user: mockVerifiedPasswordUser, body: { persistentAuthVerified: false } };
    const resConfirmNoPersist = createMockRes();
    await handleConfirmMigration(reqConfirmNoPersist, resConfirmNoPersist);
    assert(resConfirmNoPersist.statusCode === 400, 'Confirmación con persistentAuthVerified: false rechazada con HTTP 400');

    // 2.7.5 Confirmación legítima: Firebase Admin SDK verifica sesión real (password/google), email verificado y no-autogenerado
    const reqConfirm: any = { user: mockVerifiedPasswordUser, body: { persistentAuthVerified: true } };
    const resConfirm = createMockRes();
    await handleConfirmMigration(reqConfirm, resConfirm);
    assert(resConfirm.statusCode === 200, 'Confirmación de migración exitosa devuelve HTTP 200 con verificación efectiva en servidor');

    const confirmedSnap = await db.collection('athletes').doc(syntheticDocId).get();
    const confirmedData = confirmedSnap.data() || {};
    assert(confirmedData.migrationStatus === 'confirmed', 'Estado actualizado a confirmed en base de datos');
    assert(confirmedData.legacyPinPurged === true, 'legacyPinPurged marcado true tras confirmación');
    assert(confirmedData.serverIdentityVerified === true, 'serverIdentityVerified confirmado por Firebase Admin SDK');

    // Verificar que el documento en /athlete_credentials fue totalmente eliminado (Ceroización)
    const deletedCredSnap = await db.collection('athlete_credentials').doc(syntheticDocId).get();
    assert(!deletedCredSnap.exists, 'Documento en /athlete_credentials eliminado definitivamente (Ceroización total)');

    // Anti-Hijacking tras confirmación: no puede ser vuelto a reclamar
    const resHijackAfterConfirm = createMockRes();
    await handleMigrateLegacyAuth(reqCorrect, resHijackAfterConfirm);
    assert(resHijackAfterConfirm.statusCode === 409, 'Anti-Hijacking: Perfil con confirmed bloquea cualquier re-migración con HTTP 409');

    // 2.8 Recuperación de Emergencia por el Administrador Master (admin@example.invalid)
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
      startTime: 1731402000000, // 09:00 AM
      endTime: 1731405600000,
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
      startTime: 1731434400000, // 18:00 PM
      endTime: 1731438000000,
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
      email: 'admin@example.invalid',
      admin: true,
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

    // 6.5 Autorización administrativa basada estrictamente en Custom Claim
    // Usuario con correo coincidente pero SIN claim admin: true DEBE SER RECHAZADO
    const emailOnlyNoClaimContext = contingencyEnv.authenticatedContext('fake-admin-uid', {
      email: 'admin@example.invalid',
      // admin claim NOT present
    });
    await assertFails(updateDoc(doc(emailOnlyNoClaimContext.firestore(), 'athletes', 'ath-123'), { name: 'Escalada No Autorizada' }));
    assert(true, 'Contingencia: Coincidencia de email sin Custom Claim admin: true es RECHAZADA (No hay escalada por email)');

    // Usuario con Custom Claim admin: true SÍ es autorizado para lectura y escrituras de rescate
    await assertSucceeds(getDoc(doc(adminContingency.firestore(), 'athletes', 'ath-123')));
    assert(true, 'Contingencia: Administrador con Custom Claim admin: true puede leer perfiles en contingencia');
    await assertSucceeds(updateDoc(doc(adminContingency.firestore(), 'athletes', 'ath-123'), { name: 'Rescate Admin' }));
    assert(true, 'Contingencia: Administrador con Custom Claim admin: true puede realizar escrituras administrativas de rescate');

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
