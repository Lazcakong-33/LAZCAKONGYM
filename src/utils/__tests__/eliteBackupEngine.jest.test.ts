import {
  createSanitizedProfileBackup,
  inspectBackupForRestore,
  executeSafeBackupRestore,
  type StorageLike,
} from '../eliteBackupEngine';
import { restorePreImportBackupSnapshot } from '../safeImportPersistence';
import type { Profile, Routine, CompletedWorkout } from '../../types';

function createMemoryStorage(): StorageLike & { store: Record<string, string> } {
  const store: Record<string, string> = {};
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

describe('eliteBackupEngine + safeImportPersistence real identity restoration', () => {
  const profile: Profile = {
    id: 'ath_jest_1',
    name: 'Atleta Jest',
    email: 'secret@jest.test',
    pin: '4321',
    avatar: '🦍',
    goal: 'Fuerza',
    weeklyTargetDays: 4,
    weightUnit: 'kg',
    soundEnabled: true,
    vibrationEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const routine: Routine = {
    id: 'r_jest_1',
    title: 'Torso Pesado',
    tagline: 'Fuerza',
    dayName: 'Lunes',
    modality: 'fuerza',
    exercises: [
      {
        id: 'ex_1',
        name: 'Press Militar',
        targetMuscles: 'Hombros',
        defaultSets: 4,
        repRange: '5',
        defaultWeight: 70,
        restSeconds: 120,
        restText: '120s',
        objective: 'Fuerza',
        defaultVideoUrl: '',
        techniqueCues: ['Core firme'],
      },
    ],
  };

  const workout: CompletedWorkout = {
    id: 'wk_jest_100',
    routineId: 'r_jest_1',
    routineTitle: 'Torso Pesado',
    date: '2026-11-09T18:00:00.000Z',
    startTime: 1762711200000,
    endTime: 1762714800000,
    durationSeconds: 3600,
    isFinished: true,
    totalVolumeKg: 1400,
    completedSetsCount: 4,
    exercisesSummary: [
      {
        exerciseId: 'ex_1',
        name: 'Press Militar',
        muscleGroup: 'Hombros',
        sets: 4,
        maxWeight: 70,
        maxReps: 5,
        volumeKg: 1400,
      },
    ],
  };

  test('strips PII/PIN, persists exact record identities in StorageLike, and supports pre-restore rollback', () => {
    const storage = createMemoryStorage();
    const doc = createSanitizedProfileBackup({
      profile,
      routines: [routine],
      history: [workout],
      prs: {
        'Press Militar': {
          exerciseId: 'ex_1',
          exerciseName: 'Press Militar',
          maxWeight: 70,
          repsAtMaxWeight: 5,
          estimated1RM: 81.6,
          date: '2026-11-09T18:00:00.000Z',
        },
      },
      bodyWeightLogs: [{ id: 'bw_1', date: '2026-11-09', weightKg: 84.2 }],
      customLinks: {},
      selectedAlternatives: {},
      storage,
    });

    const rawJson = JSON.stringify(doc);
    expect(rawJson).not.toContain('4321');
    expect(rawJson).not.toContain('secret@jest.test');

    const inspection = inspectBackupForRestore({
      rawJson,
      targetProfile: profile,
      currentState: {
        routines: [],
        history: [],
        prs: {},
        bodyWeightLogs: [],
        customLinks: {},
        selectedAlternatives: {},
      },
    });
    expect(inspection.valid).toBe(true);
    expect(inspection.integrityStatus).toBe('verified');

    const existingWorkout: CompletedWorkout = {
      ...workout,
      id: 'wk_existing_local',
      routineTitle: 'Sesión Local Previa',
      date: '2026-11-12T10:00:00.000Z',
    };

    const mergeRes = executeSafeBackupRestore({
      rawJson,
      targetProfile: profile,
      currentState: {
        routines: [],
        history: [existingWorkout],
        prs: {},
        bodyWeightLogs: [],
        customLinks: {},
        selectedAlternatives: {},
      },
      strategy: 'merge_safe',
      confirmed: true,
      storage,
    });

    expect(mergeRes.success).toBe(true);
    const persistedHistory = JSON.parse(storage.getItem('lazcakon_ath_jest_1_history') || '[]') as CompletedWorkout[];
    expect(persistedHistory.map((w) => w.id)).toEqual(
      expect.arrayContaining(['wk_jest_100', 'wk_existing_local'])
    );
    expect(persistedHistory.find((w) => w.id === 'wk_jest_100')?.exercisesSummary?.[0]?.name).toBe('Press Militar');

    const rollback = restorePreImportBackupSnapshot('ath_jest_1', mergeRes.backupSnapshot?.id, storage);
    expect(rollback.restored.history.map((w) => w.id)).toEqual(['wk_existing_local']);
  });
});
