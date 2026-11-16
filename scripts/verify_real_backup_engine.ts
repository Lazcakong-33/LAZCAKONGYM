import {
  createSanitizedProfileBackup,
  inspectBackupForRestore,
  executeSafeBackupRestore,
  type StorageLike,
} from '../src/utils/eliteBackupEngine';
import {
  getLatestPreImportBackup,
  restorePreImportBackupSnapshot,
} from '../src/utils/safeImportPersistence';
import { Profile, Routine, CompletedWorkout, PersonalRecord, BodyWeightEntry } from '../src/types';

function assert(cond: boolean, label: string) {
  if (!cond) {
    throw new Error(`[BACKUP VERIFICATION FAIL] ${label}`);
  }
  console.log(`  ✓ ${label}`);
}

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & { store: Record<string, string> } {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: (k: string) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
}

export function runRealBackupEngineVerification() {
  console.log('=== LAZCAKONG GYM 5.0 - REAL ELITE BACKUP ENGINE & PERSISTENCE VERIFICATION ===');

  const storage = createMemoryStorage({
    lazcakon_historico_meses_disponibles: JSON.stringify(['2026-10']),
    'lazcakon_historico_mensual_2026-10': JSON.stringify({
      userId: 'fixture_athlete_1',
      month: '2026-10',
      totalWorkouts: 12,
      pin: 'fixture-archive-secret', // must be stripped on export
    }),
  });

  const profileWithSecrets = {
    id: 'fixture_athlete_1',
    name: 'Atleta Sintético',
    email: 'backup-fixture@example.invalid',
    pin: 'fixture-not-a-login-pin',
    avatar: '🦍',
    goal: 'Hipertrofia',
    weeklyTargetDays: 5,
    weightKg: 92,
    weightUnit: 'kg',
    soundEnabled: true,
    vibrationEnabled: true,
    createdAt: '2026-01-10T10:00:00.000Z',
  } as Profile;

  const routines: Routine[] = [
    {
      id: 'rutina_piernas_01',
      title: 'Pierna Elite A',
      tagline: 'Enfoque cuádriceps',
      dayName: 'Lunes',
      modality: 'hipertrofia',
      exercises: [
        {
          id: 'ex_sentadilla_01',
          name: 'Sentadilla Libre',
          targetMuscles: 'Cuádriceps',
          defaultSets: 4,
          repRange: '6–8',
          defaultWeight: 140,
          restSeconds: 90,
          restText: '90s',
          objective: 'Hipertrofia',
          defaultVideoUrl: '',
          techniqueCues: ['Control excéntrico'],
        },
      ],
    },
  ];

  const history: CompletedWorkout[] = [
    {
      id: 'workout_uuid_999',
      routineId: 'rutina_piernas_01',
      date: '2026-11-10T18:00:00.000Z',
      routineTitle: 'Pierna Elite A',
      startTime: 1762797600000,
      endTime: 1762801200000,
      isFinished: true,
      totalVolumeKg: 3360,
      completedSetsCount: 4,
      durationSeconds: 3600,
      exercisesSummary: [
        {
          exerciseId: 'ex_sentadilla_01',
          name: 'Sentadilla Libre',
          muscleGroup: 'Cuádriceps',
          sets: 4,
          maxWeight: 140,
          maxReps: 8,
          volumeKg: 3360,
        },
      ],
    },
  ];

  const prs: Record<string, PersonalRecord> = {
    'Sentadilla Libre': {
      exerciseId: 'ex_sentadilla_01',
      exerciseName: 'Sentadilla Libre',
      maxWeight: 140,
      repsAtMaxWeight: 5,
      estimated1RM: 160,
      date: '2026-11-10T18:00:00.000Z',
    },
  };

  const bodyWeightLogs: BodyWeightEntry[] = [
    {
      id: 'bw_entry_01',
      date: '2026-11-10',
      weightKg: 92.5,
    },
  ];

  const customLinks = {
    ex_sentadilla_01: [{ id: 'lnk_1', title: 'Técnica', url: 'https://example.com/squat' }],
  };
  const selectedAlternatives = { ex_sentadilla_01: true };

  // 1. Create sanitized backup and verify ZERO PII/PIN leakage
  const backupDoc = createSanitizedProfileBackup({
    profile: profileWithSecrets,
    routines,
    history,
    prs,
    bodyWeightLogs,
    customLinks,
    selectedAlternatives,
    storage,
  });

  const rawJson = JSON.stringify(backupDoc, null, 2);
  assert(!rawJson.includes('backup-fixture@example.invalid'), 'PII email eliminado del JSON exportado');
  assert(!rawJson.includes('"pin"'), 'Campo PIN eliminado del JSON exportado');
  assert(Boolean(backupDoc.data.monthlyArchives['2026-10']), 'Archivo mensual incluido sin campo PIN');

  // 2. Verify tamper detection
  const tamperedDoc = JSON.parse(rawJson);
  tamperedDoc.data.prs['Sentadilla Libre'].maxWeight = 999;
  const tamperedInspection = inspectBackupForRestore({
    rawJson: JSON.stringify(tamperedDoc),
    targetProfile: profileWithSecrets,
    currentState: {
      routines: [],
      history: [],
      prs: {},
      bodyWeightLogs: [],
      customLinks: {},
      selectedAlternatives: {},
    },
  });
  assert(
    !tamperedInspection.valid && tamperedInspection.integrityStatus === 'corrupted',
    'Respaldo adulterado rechazado por verificación de checksum FNV1a-32'
  );

  // 3. Verify cross-profile isolation guard
  const foreignProfile: Profile = { ...profileWithSecrets, id: 'otro_atleta_99', name: 'Atleta Ajeno' };
  const blockedCross = executeSafeBackupRestore({
    rawJson,
    targetProfile: foreignProfile,
    currentState: {
      routines: [],
      history: [],
      prs: {},
      bodyWeightLogs: [],
      customLinks: {},
      selectedAlternatives: {},
    },
    strategy: 'merge_safe',
    confirmed: true,
    storage,
  });
  assert(!blockedCross.success, 'Aislamiento bloquea restaurar respaldo de otro perfil sin autorización explícita');

  // 4. Test MERGE_SAFE reconciliation against pre-existing athlete records + real StorageLike persistence
  const existingRoutine: Routine = {
    id: 'rutina_empuje_existente',
    title: 'Empuje Existente',
    tagline: 'Pecho/Hombro',
    dayName: 'Martes',
    modality: 'hipertrofia',
    exercises: [
      {
        id: 'ex_press_01',
        name: 'Press Banca Plano',
        targetMuscles: 'Pecho',
        defaultSets: 4,
        repRange: '6–8',
        defaultWeight: 100,
        restSeconds: 120,
        restText: '120s',
        objective: 'Fuerza/Hipertrofia',
        defaultVideoUrl: '',
        techniqueCues: ['Retracción escapular'],
      },
    ],
  };
  const existingWorkout: CompletedWorkout = {
    id: 'workout_existente_111',
    routineId: 'rutina_empuje_existente',
    date: '2026-11-11T10:00:00.000Z',
    routineTitle: 'Empuje Existente',
    startTime: 1762855200000,
    endTime: 1762858800000,
    isFinished: true,
    totalVolumeKg: 2100,
    completedSetsCount: 3,
    durationSeconds: 3600,
    exercisesSummary: [
      {
        exerciseId: 'ex_press',
        name: 'Press Banca',
        muscleGroup: 'Pecho',
        sets: 3,
        maxWeight: 100,
        maxReps: 7,
        volumeKg: 2100,
      },
    ],
  };

  const mergeResult = executeSafeBackupRestore({
    rawJson,
    targetProfile: profileWithSecrets,
    currentState: {
      routines: [existingRoutine],
      history: [existingWorkout],
      prs: {
        'Sentadilla Libre': {
          exerciseId: 'ex_sentadilla_01',
          exerciseName: 'Sentadilla Libre',
          maxWeight: 145, // Higher existing PR MUST win monotonic merge
          repsAtMaxWeight: 4,
          estimated1RM: 164,
          date: '2026-11-12T10:00:00.000Z',
        },
      },
      bodyWeightLogs: [{ id: 'bw_entry_02', date: '2026-11-12', weightKg: 93.1 }],
      customLinks: {},
      selectedAlternatives: {},
    },
    strategy: 'merge_safe',
    confirmed: true,
    storage,
  });

  assert(mergeResult.success, 'Restauración merge_safe completada con éxito');

  // Read back directly from persisted storage keys and verify EXACT record identities
  const persistedRoutines = JSON.parse(storage.getItem('lazcakon_fixture_athlete_1_routines') || '[]') as Routine[];
  const persistedHistory = JSON.parse(storage.getItem('lazcakon_fixture_athlete_1_history') || '[]') as CompletedWorkout[];
  const persistedPrs = JSON.parse(storage.getItem('lazcakon_fixture_athlete_1_prs') || '{}') as Record<string, PersonalRecord>;
  const persistedBw = JSON.parse(storage.getItem('lazcakon_fixture_athlete_1_bodyweight') || '[]') as BodyWeightEntry[];
  const persistedLinks = JSON.parse(storage.getItem('lazcakon_fixture_athlete_1_custom_links') || '{}');

  assert(
    persistedRoutines.some((r) => r.id === 'rutina_empuje_existente' && r.title === 'Empuje Existente') &&
      persistedRoutines.some((r) => r.id === 'rutina_piernas_01' && r.exercises[0]?.name === 'Sentadilla Libre'),
    'Identidad exacta de rutinas previas + restauradas verificada en storage'
  );
  assert(
    persistedHistory.some((w) => w.id === 'workout_existente_111' && w.totalVolumeKg === 2100) &&
      persistedHistory.some(
        (w) =>
          w.id === 'workout_uuid_999' &&
          w.exercisesSummary?.[0]?.name === 'Sentadilla Libre' &&
          w.exercisesSummary?.[0]?.maxWeight === 140
      ),
    'Identidad exacta de entrenamientos y ejercicios verificada en storage sin sobrescritura'
  );
  assert(
    persistedPrs['Sentadilla Libre']?.maxWeight === 145,
    'Reconciliación monotónica de PR conserva el máximo histórico (145 kg > 140 kg)'
  );
  assert(
    persistedBw.some((b) => b.id === 'bw_entry_01' && b.weightKg === 92.5) &&
      persistedBw.some((b) => b.id === 'bw_entry_02' && b.weightKg === 93.1),
    'Identidad de registros de peso corporal preservada y fusionada en storage'
  );
  assert(
    persistedLinks.ex_sentadilla_01?.[0]?.url === 'https://example.com/squat',
    'Enlaces personalizados restaurados en storage por identidad'
  );

  // 5. Verify Pre-Restore Rollback Snapshot was stored and can roll back cleanly
  const preRestoreSnapshot = getLatestPreImportBackup('fixture_athlete_1', storage);
  assert(
    Boolean(preRestoreSnapshot && preRestoreSnapshot.routines[0]?.id === 'rutina_empuje_existente'),
    'Snapshot automático previo a la restauración persistido con identidad original'
  );

  // Execute replace_authorized and then verify rollback recovers previous workout ID
  const replaceResult = executeSafeBackupRestore({
    rawJson,
    targetProfile: profileWithSecrets,
    currentState: {
      routines: persistedRoutines,
      history: persistedHistory,
      prs: persistedPrs,
      bodyWeightLogs: persistedBw,
      customLinks: persistedLinks,
      selectedAlternatives,
    },
    strategy: 'replace_authorized',
    confirmed: true,
    confirmReplaceExplicit: true,
    storage,
  });
  assert(replaceResult.success, 'Modo replace_authorized ejecutado tras confirmación explícita');
  const postReplaceHistory = JSON.parse(storage.getItem('lazcakon_fixture_athlete_1_history') || '[]') as CompletedWorkout[];
  assert(
    postReplaceHistory.length === 1 && postReplaceHistory[0].id === 'workout_uuid_999',
    'replace_authorized dejó exactamente el snapshot del respaldo (workout_uuid_999)'
  );

  const rollback = restorePreImportBackupSnapshot('fixture_athlete_1', replaceResult.backupSnapshot?.id, storage);
  assert(
    rollback.restored.history.some((w) => w.id === 'workout_existente_111') &&
      rollback.restored.history.some((w) => w.id === 'workout_uuid_999'),
    'Rollback de emergencia recupera intactos todos los IDs previos a replace_authorized'
  );

  console.log('\nREAL ELITE BACKUP ENGINE & PERSISTENCE VERIFICATION: ALL CHECKS PASSED');
}

runRealBackupEngineVerification();
