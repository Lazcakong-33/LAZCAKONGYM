import type {
  BodyWeightEntry,
  CompletedWorkout,
  PersonalRecord,
  Routine,
  RoutineImportMode,
} from '../types';
import { consolidateWeeklyRoutines, resolveCanonicalDay } from './csvImporter';
import { getLocalDateKey } from './calorieCalculator';
import { purgeAndSanitizeWorkoutHistory } from './historySanitizer';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface PreImportBackupSnapshot {
  id: string;
  profileId: string;
  profileName: string;
  createdAt: string;
  reason: string;
  routinesCount: number;
  historyCount: number;
  prsCount: number;
  routines: Routine[];
  history: CompletedWorkout[];
  prs: Record<string, PersonalRecord>;
  bodyWeightLogs: BodyWeightEntry[];
  customLinks: Record<string, { id: string; title: string; url: string }[]>;
  selectedAlternatives: Record<string, boolean>;
}

export interface SafeProfileStateSnapshot {
  routines: Routine[];
  history: CompletedWorkout[];
  prs: Record<string, PersonalRecord>;
  bodyWeightLogs: BodyWeightEntry[];
  customLinks: Record<string, { id: string; title: string; url: string }[]>;
  selectedAlternatives: Record<string, boolean>;
}

export interface SafeImportPayload {
  routines: Routine[];
  workouts?: CompletedWorkout[];
  prs?: Record<string, PersonalRecord>;
  importMode?: RoutineImportMode;
  confirmReplaceExisting?: boolean;
  preserveWorkoutsAndHistory?: boolean;
  sourceLabel?: string;
}

export interface SafeImportExecutionResult {
  nextRoutines: Routine[];
  nextHistory: CompletedWorkout[];
  nextPrs: Record<string, PersonalRecord>;
  historyModified: boolean;
  prsModified: boolean;
  effectiveMode: RoutineImportMode;
  backupSnapshot: PreImportBackupSnapshot;
  cloudPatch: Record<string, unknown>;
  routinesCount: number;
  workoutsAddedCount: number;
  prsUpdatedCount: number;
  routineNames: string[];
}

const MAX_BACKUPS_PER_PROFILE = 3;

export function getPreImportBackupKey(profileId: string): string {
  return `lazcakon_${profileId}_pre_import_backup`;
}

export function getPreImportBackupsListKey(profileId: string): string {
  return `lazcakon_${profileId}_pre_import_backups`;
}

function getDefaultStorage(): StorageLike | null {
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function getLatestPreImportBackup(
  profileId: string,
  storage: StorageLike | null = getDefaultStorage()
): PreImportBackupSnapshot | null {
  if (!profileId || !storage) return null;
  try {
    const raw = storage.getItem(getPreImportBackupKey(profileId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PreImportBackupSnapshot;
    if (!parsed || parsed.profileId !== profileId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function listPreImportBackups(
  profileId: string,
  storage: StorageLike | null = getDefaultStorage()
): PreImportBackupSnapshot[] {
  if (!profileId || !storage) return [];
  try {
    const raw = storage.getItem(getPreImportBackupsListKey(profileId));
    if (raw) {
      const list = JSON.parse(raw) as PreImportBackupSnapshot[];
      if (Array.isArray(list)) {
        return list.filter((b) => b && b.profileId === profileId);
      }
    }
    const latest = getLatestPreImportBackup(profileId, storage);
    return latest ? [latest] : [];
  } catch {
    return [];
  }
}

/**
 * Crea un respaldo automático completo e inmutable para el perfil activo
 * ANTES de aplicar cualquier importación de rutina o archivo.
 */
export function createPreImportBackupSnapshot(
  profileId: string,
  profileName: string,
  currentState: SafeProfileStateSnapshot,
  reason: string = 'Importación de rutina',
  storage: StorageLike | null = getDefaultStorage()
): PreImportBackupSnapshot {
  const snapshot: PreImportBackupSnapshot = {
    id: `bak-${profileId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    profileId,
    profileName,
    createdAt: new Date().toISOString(),
    reason,
    routinesCount: Array.isArray(currentState.routines) ? currentState.routines.length : 0,
    historyCount: Array.isArray(currentState.history) ? currentState.history.length : 0,
    prsCount: currentState.prs ? Object.keys(currentState.prs).length : 0,
    routines: deepClone(currentState.routines || []),
    history: deepClone(currentState.history || []),
    prs: deepClone(currentState.prs || {}),
    bodyWeightLogs: deepClone(currentState.bodyWeightLogs || []),
    customLinks: deepClone(currentState.customLinks || {}),
    selectedAlternatives: deepClone(currentState.selectedAlternatives || {}),
  };

  if (storage) {
    storage.setItem(getPreImportBackupKey(profileId), JSON.stringify(snapshot));
    const existingList = listPreImportBackups(profileId, storage);
    const updatedList = [snapshot, ...existingList].slice(0, MAX_BACKUPS_PER_PROFILE);
    storage.setItem(getPreImportBackupsListKey(profileId), JSON.stringify(updatedList));
  }

  return snapshot;
}

/**
 * Ejecuta la persistencia segura de una importación:
 * 1. Crea respaldo automático previo al cambio.
 * 2. Por defecto ('append_new') conserva todas las rutinas previas y guarda la nueva planificación aparte.
 * 3. Jamás permite 'replace_all' sin confirmReplaceExisting === true.
 * 4. Mantiene intactos entrenamientos completados, historial, estadísticas, cargas, PRs y mapa muscular.
 * 5. Aísla estrictamente las claves de almacenamiento por `profileId` (sin claves globales compartidas).
 */
export function executeSafeImportPersistence(params: {
  profileId: string;
  profileName: string;
  athleteWeightKg?: number;
  currentState: SafeProfileStateSnapshot;
  payload: SafeImportPayload;
  storage?: StorageLike | null;
}): SafeImportExecutionResult {
  const {
    profileId,
    profileName,
    athleteWeightKg = 95,
    currentState,
    payload,
    storage = getDefaultStorage(),
  } = params;

  if (!profileId || !profileId.trim()) {
    throw new Error('Perfil inválido para realizar la importación segura.');
  }

  // 1. Respaldo automático obligatorio antes de tocar cualquier dato
  const backupSnapshot = createPreImportBackupSnapshot(
    profileId,
    profileName,
    currentState,
    payload.sourceLabel || 'Importación de planificación',
    storage
  );

  // 2. Determinar modo efectivo seguro: jamás reemplazar sin confirmación explícita
  const requestedMode: RoutineImportMode = payload.importMode || 'append_new';
  const effectiveMode: RoutineImportMode =
    requestedMode === 'replace_all' && payload.confirmReplaceExisting !== true
      ? 'append_new'
      : requestedMode;

  const existingRoutines = deepClone(currentState.routines || []);
  const incomingRoutinesRaw = Array.isArray(payload.routines) ? payload.routines : [];
  const existingIds = new Set(existingRoutines.map((r) => r.id));

  // Detectar si el llamador ya pre-mezcló las rutinas existentes (ej. buildImportResultFromConfirmedDraft)
  // o si envió únicamente las nuevas rutinas importadas.
  const incomingOnlyNew = incomingRoutinesRaw.filter((r) => !existingIds.has(r.id));

  const importTimestamp = Date.now();
  const planBatchId = `plan-imp-${importTimestamp}`;

  const stampedIncoming = (
    effectiveMode === 'replace_all' ? incomingRoutinesRaw : incomingOnlyNew
  ).map((r, idx) => {
    const resolvedDay = resolveCanonicalDay(r.dayName, r.title) || 'Lunes';
    const hasUniqueId =
      r.id &&
      !existingIds.has(r.id) &&
      !/^csv-routine-/.test(r.id) &&
      !/^rutina-(lunes|martes|miercoles|jueves|viernes|sabado|domingo)$/.test(r.id);

    const safeId = hasUniqueId
      ? r.id
      : `rutina-imp-${resolvedDay.toLowerCase().replace(/[^a-z0-9]/g, '')}-${importTimestamp}-${idx}`;

    return {
      ...deepClone(r),
      id: safeId,
      dayName: resolvedDay,
      isCustom: true,
      importedPlanId: r.importedPlanId || planBatchId,
      importedAt: r.importedAt || new Date(importTimestamp).toISOString(),
    } as Routine;
  });

  let rawNextRoutines: Routine[];
  if (effectiveMode === 'replace_all' && payload.confirmReplaceExisting === true) {
    rawNextRoutines = stampedIncoming;
  } else if (effectiveMode === 'merge_days') {
    const importedDaysSet = new Set(
      stampedIncoming.map((r) => resolveCanonicalDay(r.dayName, r.title) || r.dayName)
    );
    const nonCollidingExisting = existingRoutines.filter((r) => {
      const d = resolveCanonicalDay(r.dayName, r.title) || r.dayName;
      return !importedDaysSet.has(d);
    });
    rawNextRoutines = [...nonCollidingExisting, ...stampedIncoming];
  } else {
    // 'append_new' (por defecto): conservar el 100% de rutinas anteriores y agregar la nueva planificación
    rawNextRoutines = [...existingRoutines, ...stampedIncoming];
  }

  const nextRoutines =
    incomingRoutinesRaw.length > 0
      ? consolidateWeeklyRoutines(rawNextRoutines)
      : existingRoutines;

  if (incomingRoutinesRaw.length > 0 && storage) {
    storage.setItem(`lazcakon_${profileId}_routines`, JSON.stringify(nextRoutines));
  }

  // 3. Proteger entrenamientos completados, historial, estadísticas y mapa muscular
  let nextHistory = deepClone(currentState.history || []);
  let historyModified = false;
  let workoutsAddedCount = 0;

  const incomingWorkouts = Array.isArray(payload.workouts) ? payload.workouts : [];
  if (!payload.preserveWorkoutsAndHistory && incomingWorkouts.length > 0) {
    // Prioridad absoluta e inmutable a entrenamientos ya existentes: jamás sobrescribir fechas previas
    const existingDates = new Set(
      nextHistory
        .map((w) => getLocalDateKey(w.date) || String(w.date || '').slice(0, 10))
        .filter(Boolean)
    );
    const nonCollidingIncoming = incomingWorkouts.filter((w) => {
      if (!w || !w.date) return false;
      const dateKey = getLocalDateKey(w.date) || String(w.date).slice(0, 10);
      return Boolean(dateKey) && !existingDates.has(dateKey);
    });

    if (nonCollidingIncoming.length > 0) {
      const { cleanedHistory: cleanedNewOnly } = purgeAndSanitizeWorkoutHistory(
        nonCollidingIncoming,
        athleteWeightKg
      );
      if (cleanedNewOnly.length > 0) {
        workoutsAddedCount = cleanedNewOnly.length;
        nextHistory = [...nextHistory, ...cleanedNewOnly].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        historyModified = true;
        if (storage) {
          storage.setItem(`lazcakon_${profileId}_history`, JSON.stringify(nextHistory));
        }
      }
    }
  }

  // 4. Proteger cargas históricas y récords personales (solo actualizar si supera estrictamente el PR actual)
  const nextPrs = deepClone(currentState.prs || {});
  let prsModified = false;
  let prsUpdatedCount = 0;

  const incomingPrs = payload.prs || {};
  if (!payload.preserveWorkoutsAndHistory && Object.keys(incomingPrs).length > 0) {
    Object.entries(incomingPrs).forEach(([key, record]) => {
      if (
        record &&
        typeof record.maxWeight === 'number' &&
        record.maxWeight > 0 &&
        (!nextPrs[key] || record.maxWeight > (nextPrs[key].maxWeight || 0))
      ) {
        nextPrs[key] = deepClone(record);
        prsUpdatedCount += 1;
        prsModified = true;
      }
    });
    if (prsModified && storage) {
      storage.setItem(`lazcakon_${profileId}_prs`, JSON.stringify(nextPrs));
    }
  }

  const cloudPatch: Record<string, unknown> = {};
  if (incomingRoutinesRaw.length > 0) {
    cloudPatch.routines = nextRoutines;
  }
  if (historyModified) {
    cloudPatch.history = nextHistory;
  }
  if (prsModified) {
    cloudPatch.prs = nextPrs;
  }

  return {
    nextRoutines,
    nextHistory,
    nextPrs,
    historyModified,
    prsModified,
    effectiveMode,
    backupSnapshot,
    cloudPatch,
    routinesCount: stampedIncoming.length > 0 ? stampedIncoming.length : nextRoutines.length,
    workoutsAddedCount,
    prsUpdatedCount,
    routineNames: (stampedIncoming.length > 0 ? stampedIncoming : nextRoutines).map((r) => r.title),
  };
}

/**
 * Restaura el respaldo previo de un perfil específico sin afectar a otros perfiles.
 */
export function restorePreImportBackupSnapshot(
  profileId: string,
  backupId?: string,
  storage: StorageLike | null = getDefaultStorage()
): {
  restored: PreImportBackupSnapshot;
  cloudPatch: Record<string, unknown>;
} {
  if (!profileId) {
    throw new Error('Perfil inválido para restaurar respaldo.');
  }

  const candidates = listPreImportBackups(profileId, storage);
  const target = backupId
    ? candidates.find((b) => b.id === backupId)
    : candidates[0];

  if (!target || target.profileId !== profileId) {
    throw new Error('No se encontró ningún respaldo previo válido para este perfil.');
  }

  const restored = deepClone(target);
  if (storage) {
    storage.setItem(`lazcakon_${profileId}_routines`, JSON.stringify(restored.routines));
    storage.setItem(`lazcakon_${profileId}_history`, JSON.stringify(restored.history));
    storage.setItem(`lazcakon_${profileId}_prs`, JSON.stringify(restored.prs));
    storage.setItem(`lazcakon_${profileId}_bodyweight`, JSON.stringify(restored.bodyWeightLogs));
    storage.setItem(`lazcakon_${profileId}_custom_links`, JSON.stringify(restored.customLinks));
    storage.setItem(
      `lazcakon_${profileId}_alternatives`,
      JSON.stringify(restored.selectedAlternatives)
    );
  }

  return {
    restored,
    cloudPatch: {
      routines: restored.routines,
      history: restored.history,
      prs: restored.prs,
      bodyWeightLogs: restored.bodyWeightLogs,
    },
  };
}
