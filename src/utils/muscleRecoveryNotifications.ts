import {
  AthleteDailyRecoveryCheckIn,
  CompletedWorkout,
  Routine,
} from '../types';
import {
  BiometricMuscleId,
  CANONICAL_MUSCLE_INFO,
  CanonicalMuscleId,
  CanonicalMuscleReadinessItem,
  MuscleRecoveryState,
  OverallAthleteMuscularSummary,
  computeOverallAthleteSummary,
  computeRealTimeRecovery,
  getDefaultRecoveryStorageAdapter,
  getTodayDateKey,
  loadDailyRecoveryCheckIn,
} from './muscleRecoveryEngine';
import {
  InteractiveMuscleId,
  resolveInteractiveTargetForCanonical,
} from './muscleMapSelection';

export interface RecoveryNotificationStorageAdapter {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

export type TrackedMuscleRecoveryStatus =
  | 'SIN_DATOS'
  | 'DESCANSO_RECOMENDADO'
  | 'RECUPERACION_EN_PROCESO'
  | 'LISTO';

export type RecoveringMuscleStatus = 'DESCANSO_RECOMENDADO' | 'RECUPERACION_EN_PROCESO';

export interface RecoveredMuscleRef {
  canonicalId: CanonicalMuscleId;
  name: string;
  interactiveId: InteractiveMuscleId;
  view: 'frontal' | 'posterior';
  previousState: RecoveringMuscleStatus;
  lastTrainedDate: string | null;
}

export interface MuscleRecoveryNotification {
  id: string;
  profileId: string;
  createdAt: number;
  read: boolean;
  readAt: number | null;
  title: string;
  message: string;
  muscles: RecoveredMuscleRef[];
  transitionKeys: string[];
}

export interface AthleteRecoveryNotificationStore {
  version: 1;
  profileId: string;
  lastEvaluatedAt: number;
  lastStates: Partial<Record<CanonicalMuscleId, TrackedMuscleRecoveryStatus>>;
  evaluatedTransitionKeys: string[];
  notifications: MuscleRecoveryNotification[];
}

export interface EvaluateMuscleRecoveryNotificationsParams {
  profileId: string;
  history: CompletedWorkout[];
  routines?: Routine[];
  nowMs?: number;
  dailyCheckIn?: AthleteDailyRecoveryCheckIn | null;
  storage?: RecoveryNotificationStorageAdapter;
}

export interface EvaluateMuscleRecoveryNotificationsResult {
  store: AthleteRecoveryNotificationStore;
  createdNotification: MuscleRecoveryNotification | null;
  unreadCount: number;
  currentStates: Record<CanonicalMuscleId, TrackedMuscleRecoveryStatus>;
  recoveryReport: Record<BiometricMuscleId, MuscleRecoveryState>;
  athleteSummary: OverallAthleteMuscularSummary;
}

const STORAGE_KEY_PREFIX = 'lazcakon_muscle_recovery_notifications_v1';
const MAX_STORED_NOTIFICATIONS = 40;
const MAX_STORED_TRANSITION_KEYS = 120;

const CANONICAL_IDS_ORDER: CanonicalMuscleId[] = [
  'pectoral_major',
  'latissimus_dorsi',
  'quadriceps',
  'hamstrings',
  'glutes',
  'deltoids',
  'biceps',
  'triceps',
  'calves',
  'abs',
];

const PLURAL_CANONICAL_MUSCLES = new Set<CanonicalMuscleId>([
  'quadriceps',
  'hamstrings',
  'glutes',
  'deltoids',
  'calves',
]);

export function buildRecoveryNotificationStorageKey(profileId: string): string {
  const safeProfile = String(profileId || 'default_athlete').trim() || 'default_athlete';
  return `${STORAGE_KEY_PREFIX}_${safeProfile}`;
}

export function createEmptyRecoveryNotificationStore(
  profileId: string
): AthleteRecoveryNotificationStore {
  const safeProfile = String(profileId || 'default_athlete').trim() || 'default_athlete';
  return {
    version: 1,
    profileId: safeProfile,
    lastEvaluatedAt: 0,
    lastStates: {},
    evaluatedTransitionKeys: [],
    notifications: [],
  };
}

/**
 * Clasifica un músculo canónico exactamente con los mismos estados del Mapa Muscular Inteligente:
 * - SIN_DATOS: statusColor === '#71717A' (Sin datos suficientes)
 * - LISTO: readiness === 'LISTO PARA ENTRENAR' con datos históricos (#CCFF00)
 * - RECUPERACION_EN_PROCESO: readiness === 'RECUPERACIÓN EN PROCESO' (#FACC15)
 * - DESCANSO_RECOMENDADO: readiness === 'DESCANSO RECOMENDADO' (#F97316 / #EF4444)
 */
export function classifyCanonicalMuscleStatus(
  item: Pick<CanonicalMuscleReadinessItem, 'readiness' | 'statusColor'>
): TrackedMuscleRecoveryStatus {
  if (!item || item.statusColor === '#71717A') {
    return 'SIN_DATOS';
  }
  if (item.readiness === 'LISTO PARA ENTRENAR') {
    return 'LISTO';
  }
  if (item.readiness === 'RECUPERACIÓN EN PROCESO') {
    return 'RECUPERACION_EN_PROCESO';
  }
  return 'DESCANSO_RECOMENDADO';
}

export function isRecoveringMuscleStatus(
  status: TrackedMuscleRecoveryStatus | undefined
): status is RecoveringMuscleStatus {
  return status === 'DESCANSO_RECOMENDADO' || status === 'RECUPERACION_EN_PROCESO';
}

export function loadAthleteRecoveryNotificationStore(
  profileId: string,
  storage: RecoveryNotificationStorageAdapter = getDefaultRecoveryStorageAdapter()
): AthleteRecoveryNotificationStore {
  const safeProfile = String(profileId || 'default_athlete').trim() || 'default_athlete';
  const fallback = createEmptyRecoveryNotificationStore(safeProfile);
  try {
    const raw = storage.getItem(buildRecoveryNotificationStorageKey(safeProfile));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AthleteRecoveryNotificationStore> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;

    const notifications = Array.isArray(parsed.notifications)
      ? parsed.notifications
          .filter(
            (n): n is MuscleRecoveryNotification =>
              Boolean(n) &&
              typeof n.id === 'string' &&
              Array.isArray(n.muscles) &&
              n.muscles.length > 0
          )
          .map((n) => ({
            ...n,
            profileId: safeProfile,
            read: Boolean(n.read),
            readAt: typeof n.readAt === 'number' ? n.readAt : null,
            transitionKeys: Array.isArray(n.transitionKeys) ? n.transitionKeys : [],
          }))
      : [];

    const lastStates: Partial<Record<CanonicalMuscleId, TrackedMuscleRecoveryStatus>> = {};
    if (parsed.lastStates && typeof parsed.lastStates === 'object') {
      CANONICAL_IDS_ORDER.forEach((cId) => {
        const val = (parsed.lastStates as Record<string, unknown>)[cId];
        if (
          val === 'SIN_DATOS' ||
          val === 'DESCANSO_RECOMENDADO' ||
          val === 'RECUPERACION_EN_PROCESO' ||
          val === 'LISTO'
        ) {
          lastStates[cId] = val;
        }
      });
    }

    const evaluatedTransitionKeys = Array.isArray(parsed.evaluatedTransitionKeys)
      ? parsed.evaluatedTransitionKeys.filter((k): k is string => typeof k === 'string')
      : [];

    return {
      version: 1,
      profileId: safeProfile,
      lastEvaluatedAt: typeof parsed.lastEvaluatedAt === 'number' ? parsed.lastEvaluatedAt : 0,
      lastStates,
      evaluatedTransitionKeys: evaluatedTransitionKeys.slice(-MAX_STORED_TRANSITION_KEYS),
      notifications: notifications.slice(0, MAX_STORED_NOTIFICATIONS),
    };
  } catch {
    return fallback;
  }
}

export function saveAthleteRecoveryNotificationStore(
  store: AthleteRecoveryNotificationStore,
  storage: RecoveryNotificationStorageAdapter = getDefaultRecoveryStorageAdapter()
): void {
  try {
    const trimmed: AthleteRecoveryNotificationStore = {
      ...store,
      version: 1,
      evaluatedTransitionKeys: store.evaluatedTransitionKeys.slice(-MAX_STORED_TRANSITION_KEYS),
      notifications: store.notifications.slice(0, MAX_STORED_NOTIFICATIONS),
    };
    storage.setItem(
      buildRecoveryNotificationStorageKey(trimmed.profileId),
      JSON.stringify(trimmed)
    );
  } catch {
    // Silenciar errores de cuota en storage
  }
}

export function getUnreadRecoveryNotificationCount(
  notifications: MuscleRecoveryNotification[]
): number {
  if (!Array.isArray(notifications)) return 0;
  return notifications.reduce((acc, item) => (item && !item.read ? acc + 1 : acc), 0);
}

export function formatRecoveredMuscleList(names: string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} y ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')} y ${cleaned[cleaned.length - 1]}`;
}

export function buildRecoveryNotificationCopy(muscles: RecoveredMuscleRef[]): {
  title: string;
  message: string;
} {
  if (muscles.length === 1) {
    const single = muscles[0];
    const isPlural = PLURAL_CANONICAL_MUSCLES.has(single.canonicalId);
    return {
      title: isPlural ? `${single.name} listos para entrenar` : `${single.name} listo para entrenar`,
      message: isPlural
        ? `${single.name} completaron su recuperación y ya están en estado Listo en el Mapa Muscular.`
        : `${single.name} completó su recuperación y ya está en estado Listo en el Mapa Muscular.`,
    };
  }

  const listLabel = formatRecoveredMuscleList(muscles.map((m) => m.name));
  return {
    title: `${muscles.length} grupos musculares listos`,
    message: `${listLabel} pasaron a estado Listo para entrenar.`,
  };
}

function resolveLatestTrainedDateByCanonical(
  recoveryReport: Record<BiometricMuscleId, MuscleRecoveryState>
): Partial<Record<CanonicalMuscleId, { date: string | null; biometricId: BiometricMuscleId }>> {
  const result: Partial<
    Record<CanonicalMuscleId, { date: string | null; biometricId: BiometricMuscleId }>
  > = {};

  (Object.values(recoveryReport) as MuscleRecoveryState[]).forEach((state) => {
    if (!state || !state.hasHistoricalData) return;
    const existing = result[state.canonicalId];
    const currentMs = state.lastTrainedDate ? new Date(state.lastTrainedDate).getTime() : 0;
    const existingMs = existing?.date ? new Date(existing.date).getTime() : -1;
    if (!existing || currentMs >= existingMs) {
      result[state.canonicalId] = {
        date: state.lastTrainedDate || null,
        biometricId: state.id,
      };
    }
  });

  return result;
}

/**
 * Evalúa el estado de recuperación muscular del atleta usando exactamente el mismo cálculo
 * y los mismos estados del Mapa Muscular Inteligente.
 *
 * Reglas estrictas:
 * 1. Primera vez que se evalúa un músculo -> registra su estado inicial sin crear aviso.
 * 2. Solo crea aviso cuando un músculo pasa de un estado de recuperación
 *    (DESCANSO_RECOMENDADO o RECUPERACION_EN_PROCESO) a LISTO.
 * 3. Agrupa en un solo aviso todos los músculos que pasan a LISTO en la misma revisión.
 * 4. Persiste por atleta los estados, claves de transición y avisos para no duplicar al recargar.
 */
export function evaluateMuscleRecoveryNotifications(
  params: EvaluateMuscleRecoveryNotificationsParams
): EvaluateMuscleRecoveryNotificationsResult {
  const {
    profileId,
    history,
    routines = [],
    nowMs = Date.now(),
    storage = getDefaultRecoveryStorageAdapter(),
  } = params;

  const safeProfileId = String(profileId || 'default_athlete').trim() || 'default_athlete';
  const resolvedDailyCheckIn =
    params.dailyCheckIn !== undefined
      ? params.dailyCheckIn
      : loadDailyRecoveryCheckIn(safeProfileId, getTodayDateKey(nowMs), storage);

  const recoveryReport = computeRealTimeRecovery(
    history,
    nowMs,
    routines,
    'ALL',
    'ALL',
    {
      profileId: safeProfileId,
      dailyCheckIn: resolvedDailyCheckIn,
    }
  );
  const athleteSummary = computeOverallAthleteSummary(recoveryReport, history, nowMs);

  const canonicalItems = athleteSummary.readyMuscles
    .concat(athleteSummary.inRecoveryMuscles)
    .concat(athleteSummary.highFatigueMuscles);

  const canonicalById = new Map<CanonicalMuscleId, CanonicalMuscleReadinessItem>();
  canonicalItems.forEach((item) => {
    if (item) {
      canonicalById.set(item.canonicalId, item);
    }
  });

  const latestTrainedByCanonical = resolveLatestTrainedDateByCanonical(recoveryReport);
  const store = loadAthleteRecoveryNotificationStore(safeProfileId, storage);
  const knownTransitionKeys = new Set<string>(store.evaluatedTransitionKeys);
  const nextLastStates: Partial<Record<CanonicalMuscleId, TrackedMuscleRecoveryStatus>> = {
    ...store.lastStates,
  };

  const currentStates = {} as Record<CanonicalMuscleId, TrackedMuscleRecoveryStatus>;
  const newlyRecoveredMuscles: RecoveredMuscleRef[] = [];
  const newTransitionKeys: string[] = [];

  CANONICAL_IDS_ORDER.forEach((canonicalId) => {
    const item = canonicalById.get(canonicalId);
    const currentStatus: TrackedMuscleRecoveryStatus = item
      ? classifyCanonicalMuscleStatus(item)
      : 'SIN_DATOS';
    currentStates[canonicalId] = currentStatus;

    const previousStatus = store.lastStates[canonicalId];

    // Primera evaluación de este músculo para este atleta: registrar baseline sin crear aviso
    if (previousStatus === undefined) {
      nextLastStates[canonicalId] = currentStatus;
      return;
    }

    // Actualizar siempre el último estado conocido
    nextLastStates[canonicalId] = currentStatus;

    // Solo crear aviso si pasa estrictamente de un estado de recuperación a LISTO
    if (isRecoveringMuscleStatus(previousStatus) && currentStatus === 'LISTO') {
      const trainedMeta = latestTrainedByCanonical[canonicalId];
      const lastTrainedDate = trainedMeta?.date || null;
      const transitionKey = `${safeProfileId}::${canonicalId}::${lastTrainedDate || 'cycle'}`;

      if (!knownTransitionKeys.has(transitionKey)) {
        const target = resolveInteractiveTargetForCanonical(
          canonicalId,
          trainedMeta?.biometricId
        );
        newlyRecoveredMuscles.push({
          canonicalId,
          name: item?.name || CANONICAL_MUSCLE_INFO[canonicalId]?.name || canonicalId,
          interactiveId: target.interactiveId,
          view: target.view,
          previousState: previousStatus,
          lastTrainedDate,
        });
        newTransitionKeys.push(transitionKey);
        knownTransitionKeys.add(transitionKey);
      }
    }
  });

  let createdNotification: MuscleRecoveryNotification | null = null;
  let nextNotifications = store.notifications;

  if (newlyRecoveredMuscles.length > 0) {
    const copy = buildRecoveryNotificationCopy(newlyRecoveredMuscles);
    const idSeed = newlyRecoveredMuscles.map((m) => m.canonicalId).join('_');
    createdNotification = {
      id: `mrec_${nowMs}_${idSeed}`,
      profileId: safeProfileId,
      createdAt: nowMs,
      read: false,
      readAt: null,
      title: copy.title,
      message: copy.message,
      muscles: newlyRecoveredMuscles,
      transitionKeys: newTransitionKeys,
    };
    nextNotifications = [createdNotification, ...store.notifications].slice(
      0,
      MAX_STORED_NOTIFICATIONS
    );
  }

  const nextStore: AthleteRecoveryNotificationStore = {
    version: 1,
    profileId: safeProfileId,
    lastEvaluatedAt: nowMs,
    lastStates: nextLastStates,
    evaluatedTransitionKeys: Array.from(knownTransitionKeys).slice(-MAX_STORED_TRANSITION_KEYS),
    notifications: nextNotifications,
  };

  saveAthleteRecoveryNotificationStore(nextStore, storage);

  return {
    store: nextStore,
    createdNotification,
    unreadCount: getUnreadRecoveryNotificationCount(nextStore.notifications),
    currentStates,
    recoveryReport,
    athleteSummary,
  };
}

export function markRecoveryNotificationAsRead(
  profileId: string,
  notificationId: string,
  nowMs: number = Date.now(),
  storage: RecoveryNotificationStorageAdapter = getDefaultRecoveryStorageAdapter()
): AthleteRecoveryNotificationStore {
  const store = loadAthleteRecoveryNotificationStore(profileId, storage);
  let changed = false;
  const nextNotifications = store.notifications.map((n) => {
    if (n.id === notificationId && !n.read) {
      changed = true;
      return {
        ...n,
        read: true,
        readAt: nowMs,
      };
    }
    return n;
  });

  if (!changed) return store;

  const nextStore: AthleteRecoveryNotificationStore = {
    ...store,
    notifications: nextNotifications,
  };
  saveAthleteRecoveryNotificationStore(nextStore, storage);
  return nextStore;
}

export function markAllRecoveryNotificationsAsRead(
  profileId: string,
  nowMs: number = Date.now(),
  storage: RecoveryNotificationStorageAdapter = getDefaultRecoveryStorageAdapter()
): AthleteRecoveryNotificationStore {
  const store = loadAthleteRecoveryNotificationStore(profileId, storage);
  let changed = false;
  const nextNotifications = store.notifications.map((n) => {
    if (!n.read) {
      changed = true;
      return {
        ...n,
        read: true,
        readAt: nowMs,
      };
    }
    return n;
  });

  if (!changed) return store;

  const nextStore: AthleteRecoveryNotificationStore = {
    ...store,
    notifications: nextNotifications,
  };
  saveAthleteRecoveryNotificationStore(nextStore, storage);
  return nextStore;
}

/**
 * Resuelve la vista inicial y músculos a resaltar en el Mapa Muscular Inteligente
 * al tocar un aviso individual o agrupado.
 */
export function resolveRecoveryNotificationMapSelection(muscles: RecoveredMuscleRef[]): {
  primaryView: 'frontal' | 'posterior';
  primaryInteractiveId: InteractiveMuscleId;
  isMultiSelect: boolean;
  frontalCount: number;
  posteriorCount: number;
} | null {
  if (!Array.isArray(muscles) || muscles.length === 0) return null;

  const frontalMuscles = muscles.filter((m) => m.view === 'frontal');
  const posteriorMuscles = muscles.filter((m) => m.view === 'posterior');

  let primaryView: 'frontal' | 'posterior' = muscles[0].view;
  if (frontalMuscles.length > posteriorMuscles.length) {
    primaryView = 'frontal';
  } else if (posteriorMuscles.length > frontalMuscles.length) {
    primaryView = 'posterior';
  }

  const primaryMuscle =
    muscles.find((m) => m.view === primaryView) || muscles[0];

  return {
    primaryView,
    primaryInteractiveId: primaryMuscle.interactiveId,
    isMultiSelect: muscles.length > 1,
    frontalCount: frontalMuscles.length,
    posteriorCount: posteriorMuscles.length,
  };
}
