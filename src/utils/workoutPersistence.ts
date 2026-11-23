import {
  ActiveWorkoutSession,
  CompletedWorkout,
  LoggedSet,
  WorkoutSyncStatus,
} from '../types/index.ts';

let idSequence = 0;

export function generateStableId(prefix: 'workout' | 'set'): string {
  idSequence = (idSequence + 1) % 100000;
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${now}-${idSequence}-${rand}`;
}

export function deriveRirFromRpe(rpe?: number): number | undefined {
  if (typeof rpe !== 'number' || !Number.isFinite(rpe) || rpe <= 0) return undefined;
  return Math.max(0, Number((10 - rpe).toFixed(1)));
}

export function ensureSetStableId(set: LoggedSet): LoggedSet {
  const existingId = typeof set.id === 'string' && set.id.trim() ? set.id.trim() : undefined;
  return {
    ...set,
    id: existingId || generateStableId('set'),
  };
}

export function ensureSessionStableIds(session: ActiveWorkoutSession): ActiveWorkoutSession {
  const sessionId =
    typeof session.sessionId === 'string' && session.sessionId.trim()
      ? session.sessionId.trim()
      : generateStableId('workout');

  return {
    ...session,
    sessionId,
    updatedAt: typeof session.updatedAt === 'number' && session.updatedAt > 0 ? session.updatedAt : session.startTime || Date.now(),
    exercises: (session.exercises || []).map((ex) => ({
      ...ex,
      sets: (ex.sets || []).map((s, idx) => ({
        ...ensureSetStableId(s),
        setNumber: Number(s.setNumber) > 0 ? Number(s.setNumber) : idx + 1,
      })),
    })),
  };
}

export function countCompletedSetsInSession(session: ActiveWorkoutSession | null | undefined): number {
  if (!session || !Array.isArray(session.exercises)) return 0;
  let total = 0;
  for (const ex of session.exercises) {
    for (const s of ex.sets || []) {
      if (s.completed) total++;
    }
  }
  return total;
}

export function computeActiveSessionElapsedMs(
  session:
    | Pick<ActiveWorkoutSession, 'startTime' | 'isPaused' | 'pausedAt' | 'accumulatedPausedMs'>
    | null
    | undefined,
  nowMs: number = Date.now()
): number {
  if (!session || typeof session.startTime !== 'number' || !Number.isFinite(session.startTime)) {
    return 0;
  }
  const effectiveEnd =
    session.isPaused && typeof session.pausedAt === 'number' && session.pausedAt > 0
      ? session.pausedAt
      : nowMs;
  const accumulated =
    typeof session.accumulatedPausedMs === 'number' && session.accumulatedPausedMs > 0
      ? session.accumulatedPausedMs
      : 0;
  return Math.max(0, effectiveEnd - session.startTime - accumulated);
}

export function pauseActiveWorkoutSession(
  session: ActiveWorkoutSession,
  nowMs: number = Date.now()
): ActiveWorkoutSession {
  if (session.isPaused) return session;
  return {
    ...session,
    isPaused: true,
    pausedAt: nowMs,
    updatedAt: nowMs,
  };
}

export function resumeActiveWorkoutSession(
  session: ActiveWorkoutSession,
  nowMs: number = Date.now()
): ActiveWorkoutSession {
  if (!session.isPaused) return session;
  const pausedAt =
    typeof session.pausedAt === 'number' && session.pausedAt > 0 ? session.pausedAt : nowMs;
  const extraPausedMs = Math.max(0, nowMs - pausedAt);
  const prevAccumulated =
    typeof session.accumulatedPausedMs === 'number' && session.accumulatedPausedMs > 0
      ? session.accumulatedPausedMs
      : 0;
  const next: ActiveWorkoutSession = {
    ...session,
    isPaused: false,
    accumulatedPausedMs: prevAccumulated + extraPausedMs,
    updatedAt: nowMs,
  };
  delete next.pausedAt;
  return next;
}

export interface ActiveSessionUiState {
  focusedExerciseIndex: number;
  viewMode: 'focus' | 'list';
  autoRestEnabled: boolean;
  selectedSetIndexMap: Record<string, number>;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getDefaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getActiveSessionUiStorageKey(sessionId: string): string {
  return `lazcakon_active_ui_${sessionId}`;
}

export function loadActiveSessionUiState(
  sessionId: string | undefined,
  storage: StorageLike | null = getDefaultStorage()
): ActiveSessionUiState | null {
  if (!sessionId || !storage) return null;
  try {
    const raw = storage.getItem(getActiveSessionUiStorageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const focusedExerciseIndex =
      typeof parsed.focusedExerciseIndex === 'number' && Number.isFinite(parsed.focusedExerciseIndex)
        ? Math.max(0, Math.floor(parsed.focusedExerciseIndex))
        : 0;
    const viewMode: 'focus' | 'list' = parsed.viewMode === 'list' ? 'list' : 'focus';
    const autoRestEnabled = typeof parsed.autoRestEnabled === 'boolean' ? parsed.autoRestEnabled : true;
    const rawMap = parsed.selectedSetIndexMap;
    const selectedSetIndexMap: Record<string, number> = {};
    if (rawMap && typeof rawMap === 'object') {
      for (const [k, v] of Object.entries(rawMap)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          selectedSetIndexMap[k] = Math.floor(v);
        }
      }
    }
    return {
      focusedExerciseIndex,
      viewMode,
      autoRestEnabled,
      selectedSetIndexMap,
    };
  } catch {
    return null;
  }
}

export function saveActiveSessionUiState(
  sessionId: string | undefined,
  state: ActiveSessionUiState,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!sessionId || !storage) return;
  try {
    storage.setItem(getActiveSessionUiStorageKey(sessionId), JSON.stringify(state));
  } catch {}
}

export function clearActiveSessionUiState(
  sessionId: string | undefined,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!sessionId || !storage) return;
  try {
    storage.removeItem(getActiveSessionUiStorageKey(sessionId));
  } catch {}
}

export function reconcileActiveSessionWithCloud(params: {
  localSession: ActiveWorkoutSession | null;
  cloudSession: ActiveWorkoutSession | null | undefined;
  cloudClearedAt?: number;
  localClearedAt?: number;
  hasPendingOfflineSync: boolean;
  history: CompletedWorkout[];
}): {
  resolvedSession: ActiveWorkoutSession | null;
  source: 'local_kept' | 'cloud_restored' | 'cleared';
} {
  const {
    localSession,
    cloudSession,
    cloudClearedAt = 0,
    localClearedAt = 0,
    hasPendingOfflineSync,
    history,
  } = params;

  const finishedIds = new Set(
    (history || []).map((w) => (typeof w?.id === 'string' ? w.id.trim() : '')).filter(Boolean)
  );

  const normalizedLocal = localSession ? ensureSessionStableIds(localSession) : null;
  const normalizedCloud =
    cloudSession && Array.isArray(cloudSession.exercises)
      ? ensureSessionStableIds(cloudSession)
      : null;

  // Never discard local edits when offline queue still holds pending changes
  if (hasPendingOfflineSync) {
    return { resolvedSession: normalizedLocal, source: 'local_kept' };
  }

  // If local session exists and cloud explicitly reports null AFTER local was last updated
  if (normalizedLocal && cloudSession === null) {
    const localUpdated = normalizedLocal.updatedAt || normalizedLocal.startTime || 0;
    const isFinishedInHistory = Boolean(
      normalizedLocal.sessionId && finishedIds.has(normalizedLocal.sessionId)
    );
    if (isFinishedInHistory || (cloudClearedAt > 0 && cloudClearedAt > localUpdated)) {
      return { resolvedSession: null, source: 'cleared' };
    }
    return { resolvedSession: normalizedLocal, source: 'local_kept' };
  }

  // Never overwrite non-null local session with undefined/missing cloud field
  if (normalizedLocal && !normalizedCloud) {
    return { resolvedSession: normalizedLocal, source: 'local_kept' };
  }

  // Both null
  if (!normalizedLocal && !normalizedCloud) {
    return { resolvedSession: null, source: 'local_kept' };
  }

  // Cloud has a session and local is null -> restore ONLY if not already finished/cleared locally
  if (!normalizedLocal && normalizedCloud) {
    if (normalizedCloud.sessionId && finishedIds.has(normalizedCloud.sessionId)) {
      return { resolvedSession: null, source: 'cleared' };
    }
    const cloudUpdated = normalizedCloud.updatedAt || normalizedCloud.startTime || 0;
    if (localClearedAt > 0 && localClearedAt >= cloudUpdated) {
      return { resolvedSession: null, source: 'cleared' };
    }
    return { resolvedSession: normalizedCloud, source: 'cloud_restored' };
  }

  // Both local and cloud sessions exist -> compare deterministically without losing completed sets
  const local = normalizedLocal!;
  const cloud = normalizedCloud!;

  if (cloud.sessionId && finishedIds.has(cloud.sessionId)) {
    return { resolvedSession: local.sessionId === cloud.sessionId ? null : local, source: 'local_kept' };
  }

  if (local.sessionId === cloud.sessionId) {
    const localCompleted = countCompletedSetsInSession(local);
    const cloudCompleted = countCompletedSetsInSession(cloud);
    const localUpdated = local.updatedAt || local.startTime || 0;
    const cloudUpdated = cloud.updatedAt || cloud.startTime || 0;

    if (cloudCompleted > localCompleted || (cloudCompleted === localCompleted && cloudUpdated > localUpdated)) {
      return { resolvedSession: cloud, source: 'cloud_restored' };
    }
    return { resolvedSession: local, source: 'local_kept' };
  }

  // Different active sessions across devices: keep whichever was updated more recently
  const localUpdated = local.updatedAt || local.startTime || 0;
  const cloudUpdated = cloud.updatedAt || cloud.startTime || 0;
  if (cloudUpdated > localUpdated) {
    return { resolvedSession: cloud, source: 'cloud_restored' };
  }
  return { resolvedSession: local, source: 'local_kept' };
}

/**
 * Monotonic multi-device merge for Personal Records:
 * keeps the strictly strongest record per exerciseKey (higher maxWeight, or higher reps at equal weight, or higher estimated1RM)
 * so remote snapshots never downgrade a local PR set while offline.
 */
export function reconcilePersonalRecordsMap(
  localPrs: Record<string, import('../types/index.ts').PersonalRecord> | null | undefined,
  cloudPrs: Record<string, import('../types/index.ts').PersonalRecord> | null | undefined
): Record<string, import('../types/index.ts').PersonalRecord> {
  const merged: Record<string, import('../types/index.ts').PersonalRecord> = {};
  const addEntry = (key: string, pr: import('../types/index.ts').PersonalRecord | undefined) => {
    if (!pr || typeof pr !== 'object') return;
    const existing = merged[key];
    if (!existing) {
      merged[key] = pr;
      return;
    }
    const prWeight = Number(pr.maxWeight || 0);
    const exWeight = Number(existing.maxWeight || 0);
    const prReps = Number(pr.repsAtMaxWeight || 0);
    const exReps = Number(existing.repsAtMaxWeight || 0);
    const pr1RM = Number(pr.estimated1RM || 0);
    const ex1RM = Number(existing.estimated1RM || 0);

    const isBetter =
      prWeight > exWeight ||
      (prWeight === exWeight && prReps > exReps) ||
      (prWeight === exWeight && prReps === exReps && pr1RM > ex1RM);

    if (isBetter) {
      merged[key] = pr;
    }
  };

  if (localPrs && typeof localPrs === 'object') {
    for (const [k, v] of Object.entries(localPrs)) {
      addEntry(k, v);
    }
  }
  if (cloudPrs && typeof cloudPrs === 'object') {
    for (const [k, v] of Object.entries(cloudPrs)) {
      addEntry(k, v);
    }
  }
  return merged;
}

/**
 * Multi-device routine reconciliation that preserves pending local routine mutations
 * and avoids dropping locally created routines when merging with cloud snapshots.
 */
export function reconcileRoutinesWithCloud(params: {
  localRoutines: import('../types/index.ts').Routine[];
  cloudRoutines: import('../types/index.ts').Routine[];
  hasPendingRoutineOp: boolean;
  allowEmptyCloudAdoption?: boolean;
}): {
  resolvedRoutines: import('../types/index.ts').Routine[];
  source: 'local_kept' | 'cloud_adopted' | 'merged';
} {
  const {
    localRoutines,
    cloudRoutines,
    hasPendingRoutineOp,
    allowEmptyCloudAdoption = false,
  } = params;
  const safeLocal = Array.isArray(localRoutines) ? localRoutines : [];
  const safeCloud = Array.isArray(cloudRoutines) ? cloudRoutines : [];

  if (hasPendingRoutineOp) {
    return { resolvedRoutines: safeLocal, source: 'local_kept' };
  }

  if (safeLocal.length === 0) {
    return { resolvedRoutines: safeCloud, source: 'cloud_adopted' };
  }
  if (safeCloud.length === 0) {
    if (allowEmptyCloudAdoption) {
      return { resolvedRoutines: safeCloud, source: 'cloud_adopted' };
    }
    return { resolvedRoutines: safeLocal, source: 'local_kept' };
  }

  return { resolvedRoutines: safeCloud, source: 'cloud_adopted' };
}

/**
 * Non-destructive union merge by entry ID for bodyweight logs across devices.
 */
export function reconcileBodyWeightLogs(
  localLogs: import('../types/index.ts').BodyWeightEntry[] | null | undefined,
  cloudLogs: import('../types/index.ts').BodyWeightEntry[] | null | undefined,
  hasPendingBodyweightOp = false
): import('../types/index.ts').BodyWeightEntry[] {
  const safeLocal = Array.isArray(localLogs) ? localLogs : [];
  const safeCloud = Array.isArray(cloudLogs) ? cloudLogs : [];

  if (hasPendingBodyweightOp) {
    return safeLocal;
  }

  const byId = new Map<string, import('../types/index.ts').BodyWeightEntry>();
  for (const item of safeCloud) {
    if (item && item.id) byId.set(item.id, item);
  }
  for (const item of safeLocal) {
    if (item && item.id && !byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    const tA = new Date(a.date).getTime() || 0;
    const tB = new Date(b.date).getTime() || 0;
    return tB - tA;
  });
}

export function resolveWorkoutSyncDisplay(
  status: WorkoutSyncStatus,
  errorMessage?: string | null
): {
  status: WorkoutSyncStatus;
  label: string;
  detail: string;
  canRetry: boolean;
} {
  switch (status) {
    case 'synced':
      return {
        status,
        label: 'Sincronizado',
        detail: 'Guardado en este dispositivo y confirmado en la nube.',
        canRetry: false,
      };
    case 'pending_sync':
      return {
        status,
        label: 'Pendiente de sincronización',
        detail: 'Guardado en este dispositivo. Se sincronizará al reconectar.',
        canRetry: true,
      };
    case 'error':
      return {
        status,
        label: 'Error: reintentar',
        detail: errorMessage || 'No se pudo confirmar el guardado remoto. Los datos siguen en este dispositivo.',
        canRetry: true,
      };
    case 'saved_local':
    default:
      return {
        status: 'saved_local',
        label: 'Guardado en este dispositivo',
        detail: 'Conservado localmente en este dispositivo.',
        canRetry: false,
      };
  }
}

