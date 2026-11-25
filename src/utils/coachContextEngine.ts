import {
  ActiveWorkoutSession,
  AthleteDailyRecoveryCheckIn,
  CompletedWorkout,
  Exercise,
  ExerciseSetSnapshot,
  LiveSetCoachEvaluation,
  LiveSetPerformanceSignal,
  PersonalRecord,
  PostWorkoutCoachReport,
  PostWorkoutMuscleRecoveryItem,
  PostWorkoutNextSessionItem,
  PreWorkoutCoachBriefing,
  PreWorkoutInitialLoadItem,
  PreWorkoutPriorityMuscle,
  Profile,
  Routine,
  WorkoutExerciseState,
} from '../types/index.ts';
import {
  calculateNextSetByRpe,
  evaluateDoubleProgression,
  evaluateNextSessionProgression,
  findPreviousExerciseSessions,
  formatPreviousSessionSummary,
  MatchedPreviousExerciseSession,
  parseRepRange,
  resolveEquipmentProgressionStep,
  SessionProgressionRecommendation,
} from './progressionEngine.ts';
import {
  buildTechniqueProProfile,
  CandidateAlternative,
  findRecommendedAlternative,
  libraryItemToExercise,
} from './exerciseAlternatives.ts';
import {
  computeOverallAthleteSummary,
  computeRealTimeRecovery,
  computeRecoveryForecast24_48_72,
  evaluateDailyCheckInReadiness,
  evaluateSmartRoutinePlanning,
  getTodayDateKey,
  loadDailyRecoveryCheckIn,
  MUSCLE_CONFIG,
  resolveExerciseMuscleImpact,
} from './muscleRecoveryEngine.ts';
import { calculateFatigueScore } from './fatigueCalculator.ts';
import { isSameWeekday, normalizeText } from './workoutAnalyticsEngine.ts';
import { purgeAndSanitizeWorkoutHistory } from './historySanitizer.ts';
import { evaluateWeeklyDaysCompletion } from './exportReport.ts';
import { safeApiFetchJson } from './safeApiFetch.ts';
import { auth } from '../firebase.ts';
import { getChileWeekdayName } from './calorieCalculator.ts';

export type CoachQuickIntent =
  | 'today_workout'
  | 'last_weight'
  | 'replace_exercise'
  | 'freeform';

export type CoachReplacementScope = 'session' | 'routine';

export interface CoachRoutineExerciseItem {
  id: string;
  libraryExerciseId?: string;
  name: string;
  originalName?: string;
  targetMuscles: string;
  equipment?: string;
  defaultSets: number;
  repRange: string;
  restSeconds: number;
  objective?: string;
  alternative?: string;
  completedSetsCount: number;
  source: 'active_session' | 'routine';
  rawRoutineExercise?: Exercise;
  rawActiveExercise?: WorkoutExerciseState;
}

export interface CoachRoutineResolution {
  todayDayName: string;
  hasRoutines: boolean;
  hasWeekdayAssignments: boolean;
  requiresDaySelection: boolean;
  isRestDayFallback: boolean;
  selectableRoutines: Routine[];
  selectedRoutine: Routine | null;
  todayMatchedRoutine: Routine | null;
  hasActiveSession: boolean;
  activeSessionTitle?: string;
  exercises: CoachRoutineExerciseItem[];
}

export interface CoachLiftedSetItem {
  setNumber: number;
  weight: number;
  reps: number;
  rpe?: number;
  rir?: number;
}

export interface CoachExerciseLoadReport {
  exerciseId: string;
  exerciseName: string;
  equipment?: string;
  hasRegisteredSets: boolean;
  emptyMessage?: string;
  lastSessionDate?: string;
  lastSessionIso?: string;
  lastRoutineTitle?: string;
  matchedExerciseName?: string;
  hasPerSetDetail: boolean;
  liftedSummaryLine?: string;
  liftedSets: CoachLiftedSetItem[];
  liftedFallbackSummary?: string;
  progression: SessionProgressionRecommendation;
}

export interface CoachAlternativeOption {
  libraryExerciseId: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  thumbnailUrl?: string;
  secondaryThumbnailUrl?: string;
  pattern: string;
  rationale: string;
  isProgrammedMatch: boolean;
  exercisePayload: Exercise;
}

export interface CoachReplacementPreview {
  originalExerciseId: string;
  originalExerciseName: string;
  originalEquipment?: string;
  originalTargetMuscles?: string;
  completedSetsCount: number;
  replacement: CoachAlternativeOption;
  scope: CoachReplacementScope;
  canApplyToSession: boolean;
  canSaveToRoutine: boolean;
  targetRoutineId?: string;
  targetRoutineTitle?: string;
}

export interface CoachChatApiTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface CoachChatApiResponse {
  ok: boolean;
  status: number;
  reply?: string;
  model?: string;
  disclaimer?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  aborted?: boolean;
  timedOut?: boolean;
}

const WEEKDAY_NAMES_ES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const;

export function getTodayWeekdayNameEs(referenceDate: Date = new Date()): string {
  const chileDay = getChileWeekdayName(referenceDate);
  return chileDay !== 'Entrenamiento' ? chileDay : WEEKDAY_NAMES_ES[referenceDate.getDay()] || 'Lunes';
}

export function formatCoachDateEs(isoOrDate: string | number | Date): string {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate || '');
  try {
    return d.toLocaleDateString('es-CL', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function doesRoutineHaveWeekdayAssignment(routine: Routine): boolean {
  const probe = `${routine.dayName || ''} ${routine.title || ''}`.trim();
  if (!probe) return false;
  return ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].some(
    (day) => isSameWeekday(probe, day)
  );
}

/**
 * Resolves today's programmed workout (or selected routine day when routines don't map to weekdays),
 * plus active session exercises when an active session is underway.
 */
export function resolveCoachRoutineAndExercises(params: {
  routines: Routine[];
  activeSession: ActiveWorkoutSession | null;
  selectedRoutineId?: string | null;
  referenceDate?: Date;
}): CoachRoutineResolution {
  const {
    routines,
    activeSession,
    selectedRoutineId,
    referenceDate = new Date(),
  } = params;

  const validRoutines = Array.isArray(routines)
    ? routines.filter((r) => r && Array.isArray(r.exercises) && r.exercises.length > 0)
    : [];

  const todayDayName = getTodayWeekdayNameEs(referenceDate);
  const hasWeekdayAssignments = validRoutines.some((r) =>
    doesRoutineHaveWeekdayAssignment(r)
  );

  const todayMatchedRoutine =
    validRoutines.find((r) => isSameWeekday(r.dayName || r.title, todayDayName)) || null;

  let selectedRoutine: Routine | null = null;
  if (selectedRoutineId) {
    selectedRoutine = validRoutines.find((r) => r.id === selectedRoutineId) || null;
  }
  if (!selectedRoutine && activeSession?.routineId) {
    selectedRoutine =
      validRoutines.find((r) => r.id === activeSession.routineId) || null;
  }
  if (!selectedRoutine && todayMatchedRoutine) {
    selectedRoutine = todayMatchedRoutine;
  }
  const isRestDayFallback = Boolean(
    validRoutines.length > 0 &&
      !selectedRoutineId &&
      !activeSession &&
      hasWeekdayAssignments &&
      !todayMatchedRoutine
  );
  if (!selectedRoutine && validRoutines.length > 0) {
    selectedRoutine = validRoutines[0];
  }

  const requiresDaySelection =
    validRoutines.length > 0 &&
    !activeSession &&
    !todayMatchedRoutine &&
    !hasWeekdayAssignments &&
    !selectedRoutineId;

  let exercises: CoachRoutineExerciseItem[] = [];

  if (
    activeSession &&
    Array.isArray(activeSession.exercises) &&
    activeSession.exercises.length > 0 &&
    (!selectedRoutineId || selectedRoutineId === activeSession.routineId)
  ) {
    exercises = activeSession.exercises.map((ex) => {
      const matchedRoutineEx = selectedRoutine?.exercises.find(
        (re) => re.id === ex.exerciseId || re.id === ex.originalExerciseId
      );
      return {
        id: ex.exerciseId,
        libraryExerciseId: ex.libraryExerciseId,
        name: ex.activeExerciseName || ex.exerciseName,
        originalName: ex.originalExerciseName || ex.exerciseName,
        targetMuscles: ex.targetMuscles || matchedRoutineEx?.targetMuscles || '',
        equipment: ex.equipment || matchedRoutineEx?.equipment,
        defaultSets: ex.sets?.length || matchedRoutineEx?.defaultSets || 3,
        repRange: ex.repRange || matchedRoutineEx?.repRange || '8 - 12 reps',
        restSeconds: ex.restSeconds || matchedRoutineEx?.restSeconds || 90,
        objective: ex.objective || matchedRoutineEx?.objective,
        alternative: matchedRoutineEx?.alternative,
        completedSetsCount: Array.isArray(ex.sets)
          ? ex.sets.filter((s) => s.completed).length
          : 0,
        source: 'active_session',
        rawActiveExercise: ex,
        rawRoutineExercise: matchedRoutineEx,
      };
    });
  } else if (selectedRoutine) {
    exercises = selectedRoutine.exercises.map((ex) => ({
      id: ex.id,
      libraryExerciseId: ex.libraryExerciseId,
      name: ex.name,
      originalName: ex.name,
      targetMuscles: ex.targetMuscles || '',
      equipment: ex.equipment,
      defaultSets: ex.defaultSets || 3,
      repRange: ex.repRange || '8 - 12 reps',
      restSeconds: ex.restSeconds || 90,
      objective: ex.objective,
      alternative: ex.alternative,
      completedSetsCount: 0,
      source: 'routine',
      rawRoutineExercise: ex,
    }));
  }

  return {
    todayDayName,
    hasRoutines: validRoutines.length > 0,
    hasWeekdayAssignments,
    requiresDaySelection,
    isRestDayFallback,
    selectableRoutines: validRoutines,
    selectedRoutine,
    todayMatchedRoutine,
    hasActiveSession: Boolean(activeSession && activeSession.exercises.length > 0),
    activeSessionTitle: activeSession?.routineTitle,
    exercises,
  };
}

/**
 * Finds the athlete's real last completed session for an exercise and separates
 * lifted loads from suggested progression.
 */
export function buildExerciseLoadReport(params: {
  history: CompletedWorkout[];
  exercise: CoachRoutineExerciseItem;
  routineModality?: string;
  activeSession?: ActiveWorkoutSession | null;
  activeProfileId?: string;
}): CoachExerciseLoadReport {
  const { history, exercise, routineModality, activeSession, activeProfileId } = params;

  const matchedSessions: MatchedPreviousExerciseSession[] = findPreviousExerciseSessions({
    history,
    exercise: {
      exerciseId: exercise.id,
      originalExerciseId: exercise.rawActiveExercise?.originalExerciseId || exercise.id,
      libraryExerciseId: exercise.libraryExerciseId,
      activeExerciseName: exercise.name,
      originalExerciseName: exercise.originalName || exercise.name,
      equipment: exercise.equipment,
      useAlternative: exercise.rawActiveExercise?.useAlternative,
    },
    currentSessionId: activeSession?.sessionId,
    currentSessionStartTime: activeSession?.startTime,
    activeProfileId,
    limit: 1,
  });

  const lastSession = matchedSessions[0] || null;

  const progression = evaluateNextSessionProgression({
    previousSession: lastSession,
    exerciseName: exercise.name,
    equipmentHint: exercise.equipment,
    repRangeStr: exercise.repRange,
    targetSetsCount: exercise.defaultSets,
    routineModality,
    exerciseObjective: exercise.objective,
  });

  if (!lastSession) {
    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      equipment: exercise.equipment,
      hasRegisteredSets: false,
      emptyMessage: 'Aún no tienes series registradas para este ejercicio',
      hasPerSetDetail: false,
      liftedSets: [],
      progression,
    };
  }

  const liftedSets: CoachLiftedSetItem[] = (lastSession.setsDetail || []).map(
    (s: ExerciseSetSnapshot, idx: number) => ({
      setNumber: s.setNumber || idx + 1,
      weight: s.weight,
      reps: s.reps,
      ...(typeof s.rpe === 'number' ? { rpe: s.rpe } : {}),
      ...(typeof s.rir === 'number' ? { rir: s.rir } : {}),
    })
  );

  const liftedSummaryLine = formatPreviousSessionSummary(lastSession);

  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    equipment: lastSession.equipment || exercise.equipment,
    hasRegisteredSets: true,
    lastSessionDate: formatCoachDateEs(lastSession.date),
    lastSessionIso: lastSession.date,
    lastRoutineTitle: lastSession.routineTitle,
    matchedExerciseName: lastSession.exerciseName,
    hasPerSetDetail: lastSession.hasPerSetDetail,
    liftedSummaryLine,
    liftedSets,
    liftedFallbackSummary: !lastSession.hasPerSetDetail
      ? `Resumen guardado (${lastSession.setsCount} series · máx ${lastSession.maxWeight} kg × ${lastSession.maxReps} reps; sin desglose individual por serie).`
      : undefined,
    progression,
  };
}

/**
 * Maps library alternatives compatible by muscle and available equipment.
 */
export function buildCoachExerciseAlternatives(params: {
  exercise: CoachRoutineExerciseItem;
  filterEquipment?: string;
  searchQuery?: string;
  limit?: number;
}): {
  recommended: CoachAlternativeOption | null;
  alternatives: CoachAlternativeOption[];
  targetPattern: string;
} {
  const { exercise, filterEquipment, searchQuery, limit = 8 } = params;

  const result = findRecommendedAlternative(
    {
      id: exercise.id,
      libraryExerciseId: exercise.libraryExerciseId,
      name: exercise.name,
      targetMuscles: exercise.targetMuscles,
      equipment: exercise.equipment,
      objective: exercise.objective,
      alternative: exercise.alternative,
    },
    {
      filterEquipment,
      searchQuery,
      limit,
    }
  );

  const toOption = (candidate: CandidateAlternative): CoachAlternativeOption => {
    const payload = libraryItemToExercise(
      candidate.exercise,
      exercise.rawRoutineExercise || null
    );
    return {
      libraryExerciseId: candidate.exercise.id,
      name: candidate.exercise.name,
      muscleGroup: candidate.exercise.muscleGroup,
      equipment: candidate.exercise.equipment || 'Equipo estándar',
      thumbnailUrl: candidate.exercise.thumbnailUrl || undefined,
      secondaryThumbnailUrl: candidate.exercise.secondaryThumbnailUrl || undefined,
      pattern: candidate.pattern,
      rationale: candidate.rationale,
      isProgrammedMatch: candidate.isProgrammedMatch,
      exercisePayload: payload,
    };
  };

  const recommended = result.recommended ? toOption(result.recommended) : null;
  const others = result.otherCandidates.map(toOption);
  const all = recommended ? [recommended, ...others] : others;

  return {
    recommended,
    alternatives: all.slice(0, limit),
    targetPattern: result.targetPattern,
  };
}

/**
 * Creates a non-mutating replacement preview prior to athlete confirmation.
 */
export function createReplacementPreview(params: {
  exercise: CoachRoutineExerciseItem;
  replacement: CoachAlternativeOption;
  scope: CoachReplacementScope;
  activeSession: ActiveWorkoutSession | null;
  selectedRoutine: Routine | null;
}): CoachReplacementPreview {
  const { exercise, replacement, scope, activeSession, selectedRoutine } = params;

  const canApplyToSession = Boolean(
    activeSession &&
      activeSession.exercises.some(
        (ex) => ex.exerciseId === exercise.id || ex.originalExerciseId === exercise.id
      )
  );

  const canSaveToRoutine = Boolean(selectedRoutine);

  const resolvedScope: CoachReplacementScope =
    scope === 'session' && !canApplyToSession && canSaveToRoutine
      ? 'routine'
      : scope;

  return {
    originalExerciseId: exercise.id,
    originalExerciseName: exercise.name,
    originalEquipment: exercise.equipment,
    originalTargetMuscles: exercise.targetMuscles,
    completedSetsCount: exercise.completedSetsCount,
    replacement,
    scope: resolvedScope,
    canApplyToSession,
    canSaveToRoutine,
    targetRoutineId: selectedRoutine?.id,
    targetRoutineTitle: selectedRoutine?.title,
  };
}

/**
 * Applies a confirmed substitution cleanly without touching completed sets
 * or transferring weights from the replaced exercise.
 */
export function buildUpdatedRoutineWithReplacement(params: {
  routine: Routine;
  originalExerciseId: string;
  originalExerciseName: string;
  replacement: CoachAlternativeOption;
}): Routine {
  const { routine, originalExerciseId, originalExerciseName, replacement } = params;

  return {
    ...routine,
    exercises: routine.exercises.map((ex) => {
      if (ex.id !== originalExerciseId && ex.name !== originalExerciseName) {
        return ex;
      }
      return {
        ...ex,
        name: replacement.name,
        libraryExerciseId: replacement.libraryExerciseId,
        targetMuscles: replacement.muscleGroup || ex.targetMuscles,
        equipment: replacement.equipment || ex.equipment,
        // Keep original exercise name as secondary alternative and NEVER carry over previous exercise kg
        alternative: ex.name,
        defaultWeight: undefined,
        prevWeight: undefined,
        defaultVideoUrl:
          replacement.exercisePayload.defaultVideoUrl || ex.defaultVideoUrl,
        thumbnailUrl: replacement.thumbnailUrl || ex.thumbnailUrl,
        secondaryThumbnailUrl:
          replacement.secondaryThumbnailUrl || ex.secondaryThumbnailUrl,
        techniqueCues:
          replacement.exercisePayload.techniqueCues || ex.techniqueCues,
      };
    }),
  };
}

/**
 * Builds the strictly minimized authorized training context sent to `/api/coach/chat`.
 * Zero credentials, PINs, emails, or unrelated user records.
 */
export function buildMinimizedCoachContext(params: {
  activeProfile: Profile;
  routines: Routine[];
  history: CompletedWorkout[];
  prs: Record<string, PersonalRecord>;
  activeSession: ActiveWorkoutSession | null;
  selectedRoutineId?: string | null;
  selectedExerciseId?: string | null;
  filterEquipment?: string;
  isHistorySyncing?: boolean;
  historySyncError?: string | null;
  referenceDate?: Date;
}) {
  const {
    activeProfile,
    routines,
    history,
    activeSession,
    selectedRoutineId,
    selectedExerciseId,
    filterEquipment,
    isHistorySyncing = false,
    historySyncError = null,
    referenceDate = new Date(),
  } = params;

  let sanitizedHistory: CompletedWorkout[] = [];
  let partialContextWarning: string | undefined;

  try {
    sanitizedHistory = purgeAndSanitizeWorkoutHistory(
      Array.isArray(history) ? history : [],
      activeProfile?.weightKg || 95
    ).cleanedHistory;
  } catch (err) {
    console.warn('[CoachContext] Fallback on workout history sanitization:', (err as any)?.message || err);
    sanitizedHistory = Array.isArray(history) ? history : [];
    partialContextWarning = 'Historial cargado en modo básico.';
  }

  const resolution = resolveCoachRoutineAndExercises({
    routines,
    activeSession,
    selectedRoutineId,
    referenceDate,
  });

  const selectedExercise =
    resolution.exercises.find((e) => e.id === selectedExerciseId) ||
    resolution.exercises[0] ||
    null;

  let loadReport: CoachExerciseLoadReport | null = null;
  if (selectedExercise) {
    try {
      loadReport = buildExerciseLoadReport({
        history: sanitizedHistory,
        exercise: selectedExercise,
        routineModality: resolution.selectedRoutine?.modality,
        activeSession,
        activeProfileId: activeProfile?.id,
      });
    } catch (err) {
      console.warn('[CoachContext] Non-blocking loadReport error:', (err as any)?.message || err);
      partialContextWarning = partialContextWarning || 'Sin desglose secundario de cargas previas.';
    }
  }

  let alternativesResult: {
    recommended: CoachAlternativeOption | null;
    alternatives: CoachAlternativeOption[];
    targetPattern: string;
  } = { recommended: null, alternatives: [], targetPattern: '' };
  if (selectedExercise) {
    try {
      alternativesResult = buildCoachExerciseAlternatives({
        exercise: selectedExercise,
        filterEquipment,
        limit: 5,
      });
    } catch (err) {
      console.warn('[CoachContext] Non-blocking alternatives error:', (err as any)?.message || err);
    }
  }

  let athleteSummary = {
    overallRecoveryPct: 100,
    highFatigueMuscles: [] as any[],
    inRecoveryMuscles: [] as any[],
    readyMuscles: [] as any[],
  };
  try {
    const recoveryReport = computeRealTimeRecovery(
      sanitizedHistory,
      referenceDate.getTime(),
      routines,
      'ALL'
    );
    athleteSummary = computeOverallAthleteSummary(
      recoveryReport,
      sanitizedHistory,
      referenceDate.getTime()
    );
  } catch (err) {
    console.warn('[CoachContext] Non-blocking recovery summary error:', (err as any)?.message || err);
    partialContextWarning = partialContextWarning || 'Recuperación muscular estimada no disponible temporalmente.';
  }

  let completedThisWeek = 0;
  try {
    const weeklyCompletion = evaluateWeeklyDaysCompletion(
      sanitizedHistory,
      routines,
      referenceDate
    );
    completedThisWeek = weeklyCompletion.days.filter((d) => d.isCompleted).length;
  } catch (err) {
    console.warn('[CoachContext] Non-blocking weekly completion error:', (err as any)?.message || err);
  }

  return {
    resolution,
    selectedExercise,
    loadReport,
    alternativesResult,
    athleteSummary,
    hasHistory: sanitizedHistory.length > 0,
    historyCount: sanitizedHistory.length,
    completedThisWeek,
    weeklyTargetDays: Math.max(1, activeProfile?.weeklyTargetDays || 5),
    minimizedPayload: {
      athleteGoal: activeProfile?.goal || 'Hipertrofia',
      weightUnit: activeProfile?.weightUnit || 'kg',
      todayDayName: resolution.todayDayName,
      hasHistory: sanitizedHistory.length > 0,
      historyCount: sanitizedHistory.length,
      isHistorySyncing,
      hasSyncError: Boolean(historySyncError),
      syncErrorNote: historySyncError ? 'Sincronización remota pendiente o con error.' : undefined,
      partialContextWarning,
      weeklyProgress: {
        completedSessionsThisWeek: completedThisWeek,
        targetDaysPerWeek: Math.max(1, activeProfile?.weeklyTargetDays || 5),
      },
      estimatedRecovery: {
        isEstimate: true,
        hasData: sanitizedHistory.length > 0,
        overallRecoveryPct: sanitizedHistory.length > 0 ? athleteSummary.overallRecoveryPct : null,
      },
      hasActiveSession: resolution.hasActiveSession,
      activeSessionTitle: resolution.activeSessionTitle,
      selectedRoutine: resolution.selectedRoutine
        ? {
            id: resolution.selectedRoutine.id,
            dayName: resolution.selectedRoutine.dayName,
            title: resolution.selectedRoutine.title,
            modality: resolution.selectedRoutine.modality || resolution.selectedRoutine.modalityName,
            hasWeekdayAssignment: doesRoutineHaveWeekdayAssignment(resolution.selectedRoutine),
            exercises: resolution.selectedRoutine.exercises.slice(0, 14).map((ex) => ({
              id: ex.id,
              name: ex.name,
              targetMuscles: ex.targetMuscles,
              equipment: ex.equipment,
              defaultSets: ex.defaultSets,
              repRange: ex.repRange,
            })),
          }
        : null,
      selectableRoutineDays: resolution.selectableRoutines.map((r) => ({
        id: r.id,
        dayName: r.dayName,
        title: r.title,
      })),
      selectedExerciseLoadReport: loadReport
        ? {
            exerciseName: loadReport.exerciseName,
            equipment: loadReport.equipment,
            hasRegisteredSets: loadReport.hasRegisteredSets,
            emptyMessage: loadReport.emptyMessage,
            lastSessionDate: loadReport.lastSessionDate,
            lastRoutineTitle: loadReport.lastRoutineTitle,
            hasPerSetDetail: loadReport.hasPerSetDetail,
            liftedSets: loadReport.liftedSets,
            liftedFallbackSummary: loadReport.liftedFallbackSummary,
            suggestedProgression: {
              isSuggestion: true,
              status: loadReport.progression.status,
              suggestedWeightKg: loadReport.progression.suggestedWeightKg,
              suggestedRepsPattern: loadReport.progression.suggestedRepsPattern,
              summaryLine: loadReport.progression.summaryLine,
              detailReason: loadReport.progression.detailReason,
            },
          }
        : null,
      availableAlternatives: alternativesResult.alternatives.slice(0, 4).map((alt) => ({
        libraryExerciseId: alt.libraryExerciseId,
        name: alt.name,
        muscleGroup: alt.muscleGroup,
        equipment: alt.equipment,
        pattern: alt.pattern,
        rationale: alt.rationale,
      })),
    },
  };
}

export interface AskCoachAIParams {
  athleteId: string;
  message: string;
  intent: CoachQuickIntent;
  history: CoachChatApiTurn[];
  context: Record<string, any>;
  signal?: AbortSignal;
  timeoutMs?: number;
  tokenTimeoutMs?: number;
  maxTransientRetries?: number;
  getAuthUser?: () => { getIdToken: (forceRefresh?: boolean) => Promise<string> } | null;
  fetchJsonFn?: typeof safeApiFetchJson;
  isOnlineFn?: () => boolean;
}

const DEFAULT_COACH_REQUEST_TIMEOUT_MS = 22_000;
const DEFAULT_COACH_TOKEN_TIMEOUT_MS = 8_000;
const TRANSIENT_RETRY_DELAY_MS = 650;

function isExpiredAuthError(err: any): boolean {
  const code = String(err?.code || '').toLowerCase();
  const msg = String(err?.message || '').toLowerCase();
  return (
    code.includes('token-expired') ||
    code.includes('invalid-user-token') ||
    code.includes('user-disabled') ||
    code.includes('requires-recent-login') ||
    code.includes('no-current-user') ||
    msg.includes('expired') ||
    msg.includes('requires-recent-login')
  );
}

async function getFirebaseIdTokenBounded(
  user: { getIdToken: (forceRefresh?: boolean) => Promise<string> },
  forceRefresh: boolean,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ ok: true; token: string } | { ok: false; response: CoachChatApiResponse }> {
  if (signal?.aborted) {
    return {
      ok: false,
      response: {
        ok: false,
        status: 0,
        code: 'coach/aborted',
        aborted: true,
        retryable: false,
        error: 'Consulta cancelada.',
      },
    };
  }

  let timerId: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;

  try {
    const token = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finishResolve = (val: string) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };
      const finishReject = (err: any) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      if (signal) {
        onAbort = () => {
          const abortErr: any = new Error('Consulta cancelada.');
          abortErr.name = 'AbortError';
          abortErr.__externalAbort = true;
          finishReject(abortErr);
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      timerId = setTimeout(() => {
        const timeoutErr: any = new Error('Tiempo de espera agotado al validar tu sesión.');
        timeoutErr.__tokenTimeout = true;
        finishReject(timeoutErr);
      }, Math.max(250, timeoutMs));

      Promise.resolve()
        .then(() => user.getIdToken(forceRefresh))
        .then((tok) => finishResolve(tok))
        .catch((err) => finishReject(err));
    });

    if (!token || typeof token !== 'string') {
      return {
        ok: false,
        response: {
          ok: false,
          status: 401,
          code: 'coach/session-expired',
          retryable: false,
          error: 'Tu sesión de Firebase Auth no es válida o expiró. Vuelve a iniciar sesión para usar Coach IA.',
        },
      };
    }

    return { ok: true, token };
  } catch (err: any) {
    if (err?.__externalAbort || signal?.aborted) {
      return {
        ok: false,
        response: {
          ok: false,
          status: 0,
          code: 'coach/aborted',
          aborted: true,
          retryable: false,
          error: 'Consulta cancelada.',
        },
      };
    }
    if (err?.__tokenTimeout) {
      return {
        ok: false,
        response: {
          ok: false,
          status: 0,
          code: 'coach/token-timeout',
          timedOut: true,
          retryable: true,
          error:
            'No se pudo renovar tu sesión a tiempo por red lenta. Verifica tu conexión e intenta nuevamente.',
        },
      };
    }
    if (isExpiredAuthError(err)) {
      return {
        ok: false,
        response: {
          ok: false,
          status: 401,
          code: 'coach/session-expired',
          retryable: false,
          error:
            'Tu sesión expiró. Cierra e inicia sesión nuevamente para continuar usando Coach IA.',
        },
      };
    }
    return {
      ok: false,
      response: {
        ok: false,
        status: 401,
        code: 'coach/token-error',
        retryable: true,
        error: err?.message || 'No se pudo obtener el token de autenticación.',
      },
    };
  } finally {
    if (timerId !== null) clearTimeout(timerId);
    if (signal && onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  return new Promise<boolean>((resolve) => {
    let onAbort: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve(true);
    }, ms);
    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function classifyCoachHttpFailure(res: {
  ok: boolean;
  status: number;
  isJson: boolean;
  isHtml: boolean;
  data: any;
  error?: string;
  aborted?: boolean;
  timedOut?: boolean;
}): CoachChatApiResponse {
  if (res.aborted) {
    return {
      ok: false,
      status: 0,
      code: 'coach/aborted',
      aborted: true,
      retryable: false,
      error: 'Consulta cancelada.',
    };
  }

  if (res.timedOut || res.status === 408 || res.status === 504) {
    return {
      ok: false,
      status: res.status || 504,
      code: 'coach/timeout',
      timedOut: true,
      retryable: true,
      error:
        res.data?.error ||
        'Coach LazcaKong IA tardó demasiado en responder (tiempo de espera agotado). Verifica tu señal e intenta de nuevo.',
    };
  }

  if (res.isHtml) {
    return {
      ok: false,
      status: res.status || 502,
      code: 'coach/proxy-auth-required',
      retryable: res.status !== 404,
      error:
        res.error ||
        'El servidor devolvió una página HTML inesperada en lugar de responder al Coach IA.',
    };
  }

  if (res.status === 401) {
    return {
      ok: false,
      status: 401,
      code: res.data?.code || 'coach/session-expired',
      retryable: false,
      error:
        res.data?.error ||
        'Tu sesión expiró o no es válida. Vuelve a iniciar sesión para usar Coach IA.',
    };
  }

  if (res.status === 403) {
    return {
      ok: false,
      status: 403,
      code: res.data?.code || 'coach/forbidden-athlete',
      retryable: false,
      error:
        res.data?.error ||
        'No tienes autorización para consultar Coach IA con este perfil.',
    };
  }

  if (res.status === 404) {
    return {
      ok: false,
      status: 404,
      code: res.data?.code || 'coach/endpoint-not-found',
      retryable: false,
      error:
        res.data?.error ||
        'El servicio de Coach IA no está disponible en esta ruta del servidor.',
    };
  }

  if (res.status === 429) {
    return {
      ok: false,
      status: 429,
      code: res.data?.code || 'coach/rate-limit',
      retryable: true,
      error:
        res.data?.error ||
        'Coach IA alcanzó el límite temporal de consultas. Espera unos segundos e intenta nuevamente.',
    };
  }

  if (res.status === 502 || res.status === 503) {
    return {
      ok: false,
      status: res.status,
      code: res.data?.code || 'coach/server-unavailable',
      retryable: res.data?.retryable ?? true,
      error:
        res.data?.error ||
        'El servidor de Coach IA no está disponible temporalmente. Intenta nuevamente en unos segundos.',
    };
  }

  if (res.status === 0) {
    return {
      ok: false,
      status: 0,
      code: 'coach/network-error',
      retryable: true,
      error:
        res.error ||
        'No se pudo conectar con Coach IA. Verifica tu conexión a internet e intenta nuevamente.',
    };
  }

  if (res.ok && (!res.isJson || !res.data?.success || !res.data?.reply || !String(res.data.reply).trim())) {
    return {
      ok: false,
      status: res.status,
      code: res.data?.code || 'coach/empty-response',
      retryable: true,
      error:
        res.data?.error ||
        'Coach IA devolvió una respuesta vacía o incompleta. Intenta nuevamente.',
    };
  }

  return {
    ok: false,
    status: res.status,
    code: res.data?.code || 'coach/upstream-error',
    retryable: res.data?.retryable ?? res.status >= 500,
    error:
      res.data?.error ||
      res.error ||
      'No se pudo obtener respuesta de Coach LazcaKong IA.',
  };
}

/**
 * Sends a prompt + minimized authorized context to the server-side Gemini Coach endpoint.
 * Guarantees bounded timeout, AbortController cancellation, explicit error classification,
 * and transient-only retries without mocking AI replies.
 */
export async function askCoachAI(params: AskCoachAIParams): Promise<CoachChatApiResponse> {
  const {
    signal,
    timeoutMs = DEFAULT_COACH_REQUEST_TIMEOUT_MS,
    tokenTimeoutMs = DEFAULT_COACH_TOKEN_TIMEOUT_MS,
    maxTransientRetries = 1,
    getAuthUser,
    fetchJsonFn = safeApiFetchJson,
    isOnlineFn,
  } = params;

  if (signal?.aborted) {
    return {
      ok: false,
      status: 0,
      code: 'coach/aborted',
      aborted: true,
      retryable: false,
      error: 'Consulta cancelada.',
    };
  }

  const online =
    typeof isOnlineFn === 'function'
      ? isOnlineFn()
      : typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true;

  if (!online) {
    return {
      ok: false,
      status: 0,
      code: 'coach/network-error',
      retryable: true,
      error:
        'Sin conexión a internet. Verifica tu Wi-Fi o datos móviles e intenta nuevamente.',
    };
  }

  const currentUser = getAuthUser ? getAuthUser() : auth.currentUser;
  if (!currentUser) {
    return {
      ok: false,
      status: 401,
      code: 'coach/no-firebase-session',
      retryable: false,
      error:
        'Tu sesión no está activa. Inicia sesión nuevamente con tu cuenta para consultar a Coach IA.',
    };
  }

  const tokenResult = await getFirebaseIdTokenBounded(currentUser, false, tokenTimeoutMs, signal);
  if (!tokenResult.ok) {
    return (tokenResult as { ok: false; response: CoachChatApiResponse }).response;
  }

  let idToken = tokenResult.token;
  let serializedBody = '';
  try {
    serializedBody = JSON.stringify(import.meta.env?.MODE === 'cloudflare-preview' ? { message: params.message } : {
      athleteId: params.athleteId,
      message: params.message,
      intent: params.intent,
      history: (Array.isArray(params.history) ? params.history : []).slice(-8),
      context: params.context || {},
    });
  } catch {
    serializedBody = JSON.stringify({
      athleteId: params.athleteId,
      message: params.message,
      intent: params.intent,
      history: [],
      context: {},
    });
  }

  let attemptedTokenRefresh = false;
  const maxAttempts = 1 + Math.max(0, Math.min(2, maxTransientRetries));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      return {
        ok: false,
        status: 0,
        code: 'coach/aborted',
        aborted: true,
        retryable: false,
        error: 'Consulta cancelada.',
      };
    }

    const res = await fetchJsonFn<{
      success?: boolean;
      reply?: string;
      model?: string;
      disclaimer?: string;
      error?: string;
      code?: string;
      retryable?: boolean;
    }>('/api/coach/chat', {
      method: 'POST',
      signal,
      timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: serializedBody,
    });

    if (res.aborted || signal?.aborted) {
      return {
        ok: false,
        status: 0,
        code: 'coach/aborted',
        aborted: true,
        retryable: false,
        error: 'Consulta cancelada.',
      };
    }

    if (res.ok && res.isJson && res.data?.success && typeof res.data.reply === 'string' && res.data.reply.trim()) {
      return {
        ok: true,
        status: res.status,
        reply: res.data.reply.trim(),
        model: res.data.model,
        disclaimer: res.data.disclaimer,
      };
    }

    // If 401 happens once with a cached token, try exactly ONE forced refresh before declaring session expired
    if (res.status === 401 && !attemptedTokenRefresh) {
      attemptedTokenRefresh = true;
      const refreshed = await getFirebaseIdTokenBounded(
        currentUser,
        true,
        Math.min(tokenTimeoutMs, 6_000),
        signal
      );
      if (refreshed.ok && refreshed.token !== idToken) {
        idToken = refreshed.token;
        const retry401 = await fetchJsonFn<{
          success?: boolean;
          reply?: string;
          model?: string;
          disclaimer?: string;
          error?: string;
          code?: string;
          retryable?: boolean;
        }>('/api/coach/chat', {
          method: 'POST',
          signal,
          timeoutMs,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: serializedBody,
        });

        if (retry401.ok && retry401.isJson && retry401.data?.success && retry401.data?.reply?.trim()) {
          return {
            ok: true,
            status: retry401.status,
            reply: retry401.data.reply.trim(),
            model: retry401.data.model,
            disclaimer: retry401.data.disclaimer,
          };
        }

        return classifyCoachHttpFailure(retry401);
      }
      if (!refreshed.ok) {
        return (refreshed as { ok: false; response: CoachChatApiResponse }).response;
      }
    }

    const classified = classifyCoachHttpFailure(res);

    // Retry ONLY for fast transient infrastructure/network errors (never 4xx, never 429 rate-limit, never full timeout, never HTML proxy)
    const isTransientRetryEligible =
      attempt < maxAttempts - 1 &&
      !res.timedOut &&
      !res.isHtml &&
      (res.status === 502 || res.status === 503 || res.status === 0);

    if (!isTransientRetryEligible) {
      return classified;
    }

    const canProceed = await sleepWithAbort(TRANSIENT_RETRY_DELAY_MS, signal);
    if (!canProceed) {
      return {
        ok: false,
        status: 0,
        code: 'coach/aborted',
        aborted: true,
        retryable: false,
        error: 'Consulta cancelada.',
      };
    }
  }

  return {
    ok: false,
    status: 503,
    code: 'coach/server-unavailable',
    retryable: true,
    error: 'No se pudo obtener respuesta de Coach LazcaKong IA. Intenta nuevamente.',
  };
}

// ============================================================================
// LAZCAKONG GYM 7.0 — ETAPA 2: COACH INTELLIGENCE PRO (DETERMINISTIC ENGINE)
// ============================================================================

/**
 * 1. INTELIGENCIA ANTES DEL ENTRENAMIENTO
 * Analiza historial reciente, recuperación muscular estimada, rendimiento anterior
 * y planificación del atleta.
 */
export function buildPreWorkoutCoachBriefing(params: {
  routine: Routine | null;
  history: CompletedWorkout[];
  routines: Routine[];
  activeProfile?: Profile;
  referenceDate?: Date;
  dailyCheckIn?: AthleteDailyRecoveryCheckIn | null;
}): PreWorkoutCoachBriefing {
  const {
    routine,
    history,
    routines,
    activeProfile,
    referenceDate = new Date(),
    dailyCheckIn: explicitCheckIn,
  } = params;

  const safeHistory = Array.isArray(history) ? history : [];
  const nowMs = referenceDate.getTime();
  const profileId = activeProfile?.id;
  const resolvedCheckIn =
    explicitCheckIn !== undefined
      ? explicitCheckIn
      : profileId
      ? loadDailyRecoveryCheckIn(profileId, getTodayDateKey(nowMs))
      : null;

  const recoveryMap = computeRealTimeRecovery(safeHistory, nowMs, routines, 'ALL', 'ALL', {
    profileId,
    dailyCheckIn: resolvedCheckIn,
  });
  const athleteSummary = computeOverallAthleteSummary(recoveryMap, safeHistory, nowMs);
  const fatigueEval = calculateFatigueScore(safeHistory);
  const checkInEval = evaluateDailyCheckInReadiness(resolvedCheckIn);
  const recoveryForecast = computeRecoveryForecast24_48_72(safeHistory, nowMs, routines, {
    profileId,
    dailyCheckIn: resolvedCheckIn,
  });
  const smartPlanning = evaluateSmartRoutinePlanning({
    routine,
    routines,
    history: safeHistory,
    currentTime: nowMs,
    dailyCheckIn: resolvedCheckIn,
    profileId,
  });

  const readinessScorePct =
    safeHistory.length > 0 ? athleteSummary.overallRecoveryPct : 100;

  if (!routine || !Array.isArray(routine.exercises) || routine.exercises.length === 0) {
    return {
      routineTitle: 'Sesión Libre',
      readinessScorePct,
      fatigueStatus: checkInEval.hasAlertSignal ? 'high' : fatigueEval.status,
      priorityMuscles: [],
      intensityAdjustment: {
        action: checkInEval.hasAlertSignal ? 'moderate_deload' : 'maintain',
        headline: checkInEval.hasAlertSignal
          ? 'Precaución por evaluación diaria: evita alta intensidad'
          : 'Intensidad estándar autorregulada',
        rationale: checkInEval.hasAlertSignal
          ? checkInEval.rationale
          : 'Sin rutina seleccionada: mantén RPE 7.5–8.5 en tus ejercicios principales.',
        suggestedRestDeltaSec: checkInEval.hasAlertSignal ? 30 : 0,
      },
      initialLoadRecommendations: [],
      dailyCheckIn: resolvedCheckIn,
      recoveryForecast,
      smartPlanning,
    };
  }

  // Identificar músculos prioritarios de la rutina y cruzar con recuperación
  const muscleMapByName = new Map<string, PreWorkoutPriorityMuscle>();
  const allCanonicalItems = [
    ...athleteSummary.highFatigueMuscles,
    ...athleteSummary.inRecoveryMuscles,
    ...athleteSummary.readyMuscles,
  ];

  for (const ex of routine.exercises) {
    const impact = resolveExerciseMuscleImpact(ex.name, ex.targetMuscles || '');
    for (const mId of impact.primary) {
      const cfg = MUSCLE_CONFIG[mId];
      if (!cfg) continue;
      const categoryName = cfg.standardCategory || cfg.name;
      if (muscleMapByName.has(categoryName)) continue;

      const canonicalMatch = allCanonicalItems.find(
        (item) =>
          normalizeText(item.groupName) === normalizeText(categoryName) ||
          normalizeText(item.name) === normalizeText(cfg.name)
      );

      const fatiguePct = canonicalMatch ? Math.round(canonicalMatch.fatigue) : 0;
      const recoveryPct = Math.max(0, Math.min(100, 100 - fatiguePct));
      const remainingHours = canonicalMatch
        ? Math.max(
            0,
            Math.round(
              (canonicalMatch.remainingHours + canonicalMatch.remainingMinutes / 60) * 10
            ) / 10
          )
        : 0;

      const status: PreWorkoutPriorityMuscle['status'] =
        remainingHours > 18 || recoveryPct < 55
          ? 'fatigued'
          : remainingHours > 0
          ? 'recovering'
          : 'ready';

      const rationale =
        status === 'ready'
          ? '100% recuperado · Óptimo para sobrecarga progresiva.'
          : status === 'recovering'
          ? `En recuperación (${remainingHours} h restantes) · Mantén RPE ≤ 8.5.`
          : `Fatiga residual alta (${remainingHours} h restantes) · Prioriza control técnico y evita RPE 10.`;

      muscleMapByName.set(categoryName, {
        muscleName: categoryName,
        recoveryPct,
        remainingHours,
        status,
        rationale,
      });
    }
  }

  const priorityMuscles = Array.from(muscleMapByName.values());
  const hasFatiguedPrimary = priorityMuscles.some((m) => m.status === 'fatigued');
  const allPrimaryReady =
    priorityMuscles.length > 0 && priorityMuscles.every((m) => m.status === 'ready');

  let intensityAdjustment: PreWorkoutCoachBriefing['intensityAdjustment'];
  if (checkInEval.hasAlertSignal || hasFatiguedPrimary || fatigueEval.status === 'high') {
    intensityAdjustment = {
      action: 'moderate_deload',
      headline: checkInEval.hasAlertSignal
        ? 'Ajuste de precaución por señal de alerta diaria (RPE ≤ 7.5–8)'
        : 'Ajuste preventivo de intensidad (-5% o RPE ≤ 8.5)',
      rationale: checkInEval.hasAlertSignal
        ? checkInEval.rationale
        : 'Detectamos fatiga residual en músculos objetivo o alto volumen reciente. Evita el fallo muscular (@10) y añade +15 a 30 s de descanso entre series.',
      suggestedRestDeltaSec: checkInEval.hasAlertSignal ? 30 : 20,
    };
  } else if (allPrimaryReady && safeHistory.length > 0 && readinessScorePct >= 85) {
    intensityAdjustment = {
      action: 'boost',
      headline: 'Ventana óptima de progresión de cargas',
      rationale:
        'Tus grupos musculares prioritarios están recuperados. Busca progresar en carga o repeticiones en los ejercicios donde cerraste con RPE ≤ 8.0.',
      suggestedRestDeltaSec: 0,
    };
  } else {
    intensityAdjustment = {
      action: 'maintain',
      headline: 'Ejecución pautada con autorregulación RPE/RIR',
      rationale:
        'Mantén las cargas de referencia y ajusta serie a serie según tu reserva de repeticiones (RIR 1.5–2).',
      suggestedRestDeltaSec: 0,
    };
  }

  const initialLoadRecommendations: PreWorkoutInitialLoadItem[] = routine.exercises.map(
    (ex) => {
      const matched = findPreviousExerciseSessions({
        history: safeHistory,
        exercise: {
          exerciseId: ex.id,
          originalExerciseId: ex.id,
          libraryExerciseId: ex.libraryExerciseId,
          activeExerciseName: ex.name,
          originalExerciseName: ex.name,
          equipment: ex.equipment,
        },
        activeProfileId: activeProfile?.id,
        limit: 1,
      });

      const lastSession = matched[0] || null;
      const prog = evaluateNextSessionProgression({
        previousSession: lastSession,
        exerciseName: ex.name,
        equipmentHint: ex.equipment,
        repRangeStr: ex.repRange,
        targetSetsCount: ex.defaultSets || 3,
        routineModality: routine.modality,
        exerciseObjective: ex.objective,
      });

      const techProfile =
        ex.techniquePro ||
        buildTechniqueProProfile({
          id: ex.id,
          libraryExerciseId: ex.libraryExerciseId,
          name: ex.name,
          targetMuscles: ex.targetMuscles,
          equipment: ex.equipment,
        });

      const hasSufficientData =
        prog.status !== 'first_session' && prog.status !== 'incomplete_data';

      return {
        exerciseId: ex.id,
        exerciseName: ex.name,
        equipment: ex.equipment || techProfile.equipment,
        suggestedWeightKg: prog.suggestedWeightKg,
        suggestedReps: prog.suggestedReps,
        repRange: `${prog.targetMinReps}–${prog.targetMaxReps} reps`,
        status: prog.status,
        badgeText: prog.badgeText,
        rationale: hasSufficientData
          ? prog.summaryLine
          : 'No existe información suficiente previa para recomendar un cambio de carga; registra hoy peso, repeticiones y RPE/RIR.',
        techniqueFocus: techProfile.preSetTip,
        hasSufficientData,
      };
    }
  );

  return {
    routineId: routine.id,
    routineTitle: routine.title,
    readinessScorePct,
    fatigueStatus: checkInEval.hasAlertSignal ? 'high' : fatigueEval.status,
    priorityMuscles,
    intensityAdjustment,
    initialLoadRecommendations,
    dailyCheckIn: resolvedCheckIn,
    recoveryForecast,
    smartPlanning,
  };
}

/**
 * 2, 3 & 4. INTELIGENCIA DURANTE EL ENTRENAMIENTO, DETECCIÓN DE RENDIMIENTO E INTEGRACIÓN CON TECHNIQUE PRO
 * Evalúa cada serie completada y genera recomendaciones justificadas sin modificar automáticamente la rutina.
 */
export function evaluateCompletedSetWithCoach(params: {
  exerciseState: WorkoutExerciseState;
  completedSetIndex: number;
  history: CompletedWorkout[];
  prs: Record<string, PersonalRecord>;
  routineModality?: string;
  currentRestSeconds?: number;
  activeSessionId?: string;
  activeSessionStartTime?: number;
  activeProfileId?: string;
}): LiveSetCoachEvaluation {
  const {
    exerciseState,
    completedSetIndex,
    history,
    prs,
    routineModality,
    currentRestSeconds = exerciseState.restSeconds || 90,
    activeSessionId,
    activeSessionStartTime,
    activeProfileId,
  } = params;

  const targetSet = exerciseState.sets[completedSetIndex];
  const setNumber = targetSet?.setNumber ?? completedSetIndex + 1;
  const weight =
    targetSet && typeof targetSet.weight === 'number' && Number.isFinite(targetSet.weight)
      ? targetSet.weight
      : 0;
  const reps =
    targetSet && typeof targetSet.reps === 'number' && Number.isFinite(targetSet.reps)
      ? Math.round(targetSet.reps)
      : 0;
  const rpe =
    targetSet && typeof targetSet.rpe === 'number' && Number.isFinite(targetSet.rpe)
      ? targetSet.rpe
      : undefined;
  const rir =
    targetSet && typeof targetSet.rir === 'number' && Number.isFinite(targetSet.rir)
      ? targetSet.rir
      : typeof rpe === 'number'
      ? Math.max(0, Number((10 - rpe).toFixed(1)))
      : undefined;

  // Perfil Technique Pro actualizado para el ejercicio activo (incluyendo sustituciones por máquina ocupada)
  const techProfile =
    exerciseState.techniquePro &&
    normalizeText(exerciseState.techniquePro.exerciseName) ===
      normalizeText(exerciseState.activeExerciseName)
      ? exerciseState.techniquePro
      : buildTechniqueProProfile({
          id: exerciseState.exerciseId,
          libraryExerciseId: exerciseState.libraryExerciseId,
          name: exerciseState.activeExerciseName,
          targetMuscles: exerciseState.targetMuscles,
          equipment: exerciseState.equipment,
        });

  const { minReps, maxReps } = parseRepRange(exerciseState.repRange || '8 - 12 reps');
  const equipmentSpec = resolveEquipmentProgressionStep(
    exerciseState.activeExerciseName,
    exerciseState.equipment || techProfile.equipment,
    weight,
    exerciseState.repRange
  );

  // Siguiente serie pendiente de trabajo (sin tocar series completadas ni de calentamiento)
  const nextPendingSetIndex = exerciseState.sets.findIndex(
    (s, idx) => idx > completedSetIndex && !s.completed && !s.isWarmup
  );
  const fallbackPendingSetIndex =
    nextPendingSetIndex >= 0
      ? nextPendingSetIndex
      : exerciseState.sets.findIndex((s) => !s.completed && !s.isWarmup);

  // Volumen acumulado en las series completadas de este ejercicio
  const accumulatedExerciseVolumeKg = Math.round(
    exerciseState.sets.reduce((acc, s) => {
      if (!s.completed || s.isWarmup) return acc;
      const w = typeof s.weight === 'number' ? s.weight : 0;
      const r = typeof s.reps === 'number' ? s.reps : 0;
      return acc + w * r;
    }, 0)
  );

  // Historial previo real del mismo ejercicio/variante
  const previousSessions = findPreviousExerciseSessions({
    history: Array.isArray(history) ? history : [],
    exercise: {
      exerciseId: exerciseState.exerciseId,
      originalExerciseId: exerciseState.originalExerciseId || exerciseState.exerciseId,
      libraryExerciseId: exerciseState.libraryExerciseId,
      activeExerciseName: exerciseState.activeExerciseName,
      originalExerciseName: exerciseState.originalExerciseName || exerciseState.exerciseName,
      equipment: exerciseState.equipment,
      useAlternative: exerciseState.useAlternative,
    },
    currentSessionId: activeSessionId,
    currentSessionStartTime: activeSessionStartTime,
    activeProfileId,
    limit: 5,
  });
  const lastSession = previousSessions[0] || null;

  // Récord personal previo (de PRs o historial)
  const existingPr =
    prs?.[exerciseState.exerciseId] ||
    prs?.[`swap_${normalizeText(exerciseState.activeExerciseName)}`];
  const historicalBestWeight = Math.max(
    existingPr &&
      normalizeText(existingPr.exerciseName) ===
        normalizeText(exerciseState.activeExerciseName)
      ? existingPr.maxWeight
      : 0,
    lastSession?.maxWeight || 0
  );
  const historicalBest1RM = Math.max(
    existingPr &&
      normalizeText(existingPr.exerciseName) ===
        normalizeText(exerciseState.activeExerciseName)
      ? existingPr.estimated1RM
      : 0,
    lastSession?.estimated1RM || 0
  );
  const currentEst1RM =
    weight > 0 && reps > 0 ? Math.round(weight * (1 + reps / 30) * 10) / 10 : 0;

  const evaluationId = `${exerciseState.exerciseId}-s${setNumber}-w${weight}-r${reps}-rpe${rpe ?? 'na'}`;

  // Validación: ¿hay datos suficientes para recomendar un cambio?
  if (weight <= 0 || reps <= 0 || (rpe === undefined && !lastSession)) {
    const headline =
      'No existe información suficiente para recomendar un cambio de carga';
    const rationale =
      weight <= 0 || reps <= 0
        ? 'Registra un peso y repeticiones válidos para evaluar la serie.'
        : 'Es tu primera referencia en este ejercicio y no registraste RPE/RIR. Mantén la carga actual y selecciona el RPE de tu serie para habilitar ajustes autorregulados.';
    const techniqueCue = `Enfoque técnico (${techProfile.exerciseName}): ${
      techProfile.specificTips[0] || techProfile.preSetTip
    } Tempo sugerido: ${techProfile.defaultTempo.notation}.`;

    return {
      evaluationId,
      exerciseId: exerciseState.exerciseId,
      exerciseName: exerciseState.activeExerciseName,
      setNumber,
      setIndex: completedSetIndex,
      signals: ['insufficient_data'],
      primarySignal: 'insufficient_data',
      isImportant: false,
      hasSufficientData: false,
      loadAction: 'insufficient_data',
      currentWeightKg: weight,
      currentReps: reps,
      currentRpe: rpe,
      currentRir: rir,
      suggestedWeightKg: weight > 0 ? weight : null,
      suggestedReps: reps > 0 ? reps : minReps,
      currentRestSeconds,
      suggestedRestSeconds: currentRestSeconds,
      restDeltaSeconds: 0,
      headline,
      rationale,
      techniqueCue,
      accumulatedExerciseVolumeKg,
      historicalComparisonText: 'Sin historial previo ni RPE registrado en esta serie.',
      voiceSummaryText: `Serie ${setNumber} registrada en ${exerciseState.activeExerciseName}. No existe información suficiente para recomendar un cambio de carga; registra tu RPE en la próxima serie.`,
      canApplyToNextSet: false,
      nextPendingSetIndex: fallbackPendingSetIndex,
    };
  }

  // Reutilizar el motor de autorregulación RPE existente (calculateNextSetByRpe + evaluateDoubleProgression)
  const rpePrescription = calculateNextSetByRpe({
    Series_Completadas: true,
    Peso_Actual: weight,
    Reps: reps,
    RPE_Value: rpe,
  });
  const doubleProg = evaluateDoubleProgression(
    exerciseState.activeExerciseName,
    exerciseState.repRange,
    exerciseState.sets,
    routineModality
  );

  const signals: LiveSetPerformanceSignal[] = [];

  // 1. Detectar Récord Personal (si supera peso máximo histórico o 1RM estimado histórico con historial previo)
  const isNewPr =
    (historicalBestWeight > 0 && weight > historicalBestWeight && reps >= minReps - 2) ||
    (historicalBest1RM > 0 && currentEst1RM > historicalBest1RM + 0.5);
  if (isNewPr) {
    signals.push('personal_record');
  }

  // 2. Detectar Disminución de Rendimiento (vs serie previa de hoy o vs sesión anterior)
  const prevWorkingSetToday = exerciseState.sets
    .slice(0, completedSetIndex)
    .reverse()
    .find((s) => s.completed && !s.isWarmup && typeof s.reps === 'number' && s.reps > 0);

  const droppedVsPrevSetToday =
    prevWorkingSetToday &&
    typeof prevWorkingSetToday.weight === 'number' &&
    weight <= prevWorkingSetToday.weight &&
    typeof prevWorkingSetToday.reps === 'number' &&
    prevWorkingSetToday.reps - reps >= 3;

  const droppedVsHistory =
    lastSession &&
    lastSession.maxWeight > 0 &&
    weight <= lastSession.maxWeight &&
    reps < minReps &&
    lastSession.maxReps >= minReps;

  if (droppedVsPrevSetToday || droppedVsHistory || reps < Math.max(1, minReps - 1)) {
    signals.push('performance_drop');
  }

  // 3. Detectar Esfuerzo Excesivo o Serie Cercana al Fallo
  if ((typeof rpe === 'number' && rpe >= 9.5) || (typeof rir === 'number' && rir <= 0.5)) {
    signals.push('excessive_effort');
  } else if (
    (typeof rpe === 'number' && rpe >= 8.5) ||
    (typeof rir === 'number' && rir <= 1.5)
  ) {
    signals.push('near_failure');
  }

  // 4. Detectar Oportunidad Razonable de Progresión
  const stepKg = equipmentSpec.stepKg > 0 ? equipmentSpec.stepKg : 2.5;
  if (
    typeof rpe === 'number' &&
    rpe <= 8.0 &&
    reps >= maxReps &&
    !signals.includes('performance_drop')
  ) {
    signals.push('progression_opportunity');
  }

  // Si alcanzó el techo de repeticiones pero NO indicó RPE, faltan datos para recomendar subir peso
  if (reps >= maxReps && rpe === undefined) {
    signals.push('insufficient_data');
  }

  if (signals.length === 0) {
    signals.push('steady_execution');
  }

  // Determinar señal primaria por prioridad de seguridad y relevancia
  const priorityOrder: LiveSetPerformanceSignal[] = [
    'excessive_effort',
    'performance_drop',
    'personal_record',
    'progression_opportunity',
    'near_failure',
    'insufficient_data',
    'steady_execution',
  ];
  const primarySignal =
    priorityOrder.find((sig) => signals.includes(sig)) || 'steady_execution';

  // Calcular acción de carga, repeticiones y descanso
  let loadAction: LiveSetCoachEvaluation['loadAction'] = 'maintain';
  let suggestedWeightKg: number | null = weight;
  let suggestedReps: number | null = reps;
  let restDeltaSeconds = 0;
  let headline = '';
  let rationale = '';
  let techniqueCue = '';

  if (primarySignal === 'excessive_effort') {
    loadAction = 'decrease';
    suggestedWeightKg = rpePrescription.drop5PctWeightKg;
    suggestedReps = Math.max(minReps, rpePrescription.reducedTargetReps);
    restDeltaSeconds = 30;
    headline = `Esfuerzo excesivo detectado (@${rpe ?? 10} · ${rir ?? 0} RIR) — Sugerencia de descarga`;
    rationale = `Alcanzaste el límite de esfuerzo en la Serie ${setNumber} (${weight} kg × ${reps} reps). Para evitar fatiga neural desproporcionada y conservar el volumen restante, se recomienda reducir la carga a ${suggestedWeightKg} kg (-5%) o bajar a ${rpePrescription.reducedTargetReps} reps, y ampliar el descanso +30 s (${currentRestSeconds + 30} s).`;
    techniqueCue = `Enfoque biomecánico (${techProfile.exerciseName}): Evita compensaciones bajo fatiga (${
      techProfile.commonMistakes[0] || 'mantén el rango controlado'
    }). Prioriza ${techProfile.breathing.bracingCue}`;
  } else if (primarySignal === 'performance_drop') {
    loadAction = 'decrease';
    const reducedW = Math.max(
      stepKg,
      Math.round(weight * 0.95 * 2) / 2
    );
    suggestedWeightKg = reducedW < weight ? reducedW : weight;
    suggestedReps = minReps;
    restDeltaSeconds = 20;
    headline = `Disminución de rendimiento detectada en Serie ${setNumber}`;
    rationale = droppedVsPrevSetToday
      ? `Tus repeticiones cayeron a ${reps} reps frente a la serie previa. Se sugiere ajustar la carga a ${suggestedWeightKg} kg para volver al rango objetivo (${minReps}–${maxReps} reps) y sumar +20 s de descanso.`
      : `Quedaste por debajo del rango mínimo (${reps} reps vs ${minReps}–${maxReps} reps). Ajusta a ${suggestedWeightKg} kg y descansa ${currentRestSeconds + 20} s para recuperar capacidad contráctil.`;
    techniqueCue = `Guía técnica (${techProfile.exerciseName}): ${
      techProfile.specificTips[1] || techProfile.specificTips[0] || techProfile.preSetTip
    } Respeta el tempo ${techProfile.defaultTempo.notation}.`;
  } else if (
    primarySignal === 'progression_opportunity' ||
    (primarySignal === 'personal_record' && typeof rpe === 'number' && rpe <= 8.0 && reps >= maxReps)
  ) {
    loadAction = 'increase';
    suggestedWeightKg = Number((weight + stepKg).toFixed(2));
    suggestedReps = minReps;
    restDeltaSeconds = 0;
    headline = isNewPr
      ? `¡Récord Personal y oportunidad de progresión (+${stepKg} kg)!`
      : `Oportunidad razonable de progresión (+${stepKg} kg)`;
    rationale = `Completaste ${reps} reps (techo del rango ${minReps}–${maxReps}) con RPE @${rpe} (${rir} RIR de reserva). Tu margen permite incrementar a ${suggestedWeightKg} kg en la próxima serie o mantener ${weight} kg buscando ${reps} reps limpias.`;
    techniqueCue = `Al incrementar a ${suggestedWeightKg} kg en ${techProfile.exerciseName}, asegura la posición inicial: ${
      techProfile.startingPosition[0] || techProfile.preSetTip
    }`;
  } else if (primarySignal === 'personal_record') {
    loadAction = 'maintain';
    suggestedWeightKg = weight;
    suggestedReps = reps;
    restDeltaSeconds = typeof rpe === 'number' && rpe >= 8.5 ? 15 : 0;
    headline = `¡Nuevo Récord Personal en ${exerciseState.activeExerciseName}!`;
    rationale = `Superaste tu mejor marca histórica (${weight} kg × ${reps} reps · 1RM est. ${currentEst1RM} kg). Mantén ${weight} kg para consolidar la marca en las series restantes.`;
    techniqueCue = `Consolidación técnica (${techProfile.exerciseName}): ${
      techProfile.specificTips[0] || techProfile.preSetTip
    }`;
  } else if (primarySignal === 'near_failure') {
    loadAction = 'maintain';
    suggestedWeightKg = weight;
    suggestedReps = reps;
    restDeltaSeconds = 15;
    headline = `Serie cercana al fallo (@${rpe} · ${rir} RIR) — Mantener carga`;
    rationale = `Trabajaste en zona de alta exigencia (@${rpe}). No subas peso en la siguiente serie: mantén ${weight} kg y añade +15 s de descanso (${currentRestSeconds + 15} s) para sostener las repeticiones.`;
    techniqueCue = `Control bajo tensión (${techProfile.exerciseName}): ${
      techProfile.breathing.eccentricPhase
    } ${techProfile.breathing.concentricPhase}`;
  } else if (primarySignal === 'insufficient_data') {
    loadAction = 'insufficient_data';
    suggestedWeightKg = weight;
    suggestedReps = reps;
    restDeltaSeconds = 0;
    headline = 'No existe información suficiente para recomendar un cambio de carga';
    rationale = `Alcanzaste ${reps} repeticiones, pero no registraste el RPE/RIR de la serie. Sin conocer tu reserva real de esfuerzo, se recomienda mantener ${weight} kg.`;
    techniqueCue = `Referencia técnica (${techProfile.exerciseName}): ${
      techProfile.specificTips[0] || techProfile.preSetTip
    }`;
  } else {
    loadAction = 'maintain';
    suggestedWeightKg = weight;
    suggestedReps = Math.min(maxReps, reps + 1);
    restDeltaSeconds = 0;
    headline = `Ejecución sólida en rango (${weight} kg × ${reps} reps)`;
    rationale = `${doubleProg.actionAdvice} Mantén ${weight} kg e intenta alcanzar ${suggestedReps} reps con tempo controlado.`;
    techniqueCue = `Foco técnico (${techProfile.exerciseName}): ${
      techProfile.specificTips[0] || techProfile.preSetTip
    }`;
  }

  const suggestedRestSeconds = Math.max(30, currentRestSeconds + restDeltaSeconds);
  const historicalComparisonText = lastSession
    ? `Última sesión (${formatCoachDateEs(lastSession.date)}): máx ${lastSession.maxWeight} kg × ${lastSession.maxReps} reps · Vol. ejercicio hoy: ${accumulatedExerciseVolumeKg} kg.`
    : `Primera sesión registrada de ${exerciseState.activeExerciseName} · Vol. acumulado hoy: ${accumulatedExerciseVolumeKg} kg.`;

  const isImportant =
    primarySignal === 'personal_record' ||
    primarySignal === 'excessive_effort' ||
    primarySignal === 'performance_drop' ||
    primarySignal === 'progression_opportunity';

  const voiceSummaryText =
    loadAction === 'increase'
      ? `Serie ${setNumber} completada en ${exerciseState.activeExerciseName}. ${headline}. Sugerencia: subir a ${suggestedWeightKg} kg por ${suggestedReps} reps.`
      : loadAction === 'decrease'
      ? `Serie ${setNumber} en ${exerciseState.activeExerciseName}. ${headline}. Sugerencia: ajustar a ${suggestedWeightKg} kg y descansar ${suggestedRestSeconds} segundos.`
      : `Serie ${setNumber} en ${exerciseState.activeExerciseName}. ${headline}. Mantén ${weight} kg.`;

  const hasActionableDiff =
    fallbackPendingSetIndex >= 0 &&
    loadAction !== 'insufficient_data' &&
    (suggestedWeightKg !== weight ||
      suggestedReps !== reps ||
      restDeltaSeconds !== 0 ||
      loadAction === 'increase' ||
      loadAction === 'decrease');

  return {
    evaluationId,
    exerciseId: exerciseState.exerciseId,
    exerciseName: exerciseState.activeExerciseName,
    setNumber,
    setIndex: completedSetIndex,
    signals,
    primarySignal,
    isImportant,
    hasSufficientData: primarySignal !== 'insufficient_data',
    loadAction,
    currentWeightKg: weight,
    currentReps: reps,
    currentRpe: rpe,
    currentRir: rir,
    suggestedWeightKg,
    suggestedReps,
    currentRestSeconds,
    suggestedRestSeconds,
    restDeltaSeconds,
    headline,
    rationale,
    techniqueCue,
    accumulatedExerciseVolumeKg,
    historicalComparisonText,
    voiceSummaryText,
    canApplyToNextSet: Boolean(fallbackPendingSetIndex >= 0 && (hasActionableDiff || loadAction === 'maintain')),
    nextPendingSetIndex: fallbackPendingSetIndex,
  };
}

/**
 * Aplica de forma pura e inmutable un ajuste aceptado por el atleta a las series
 * pendientes de trabajo del ejercicio activo, sin duplicar series ni alterar
 * las series ya completadas.
 */
export function applyAcceptedCoachSetAdjustment(params: {
  exerciseState: WorkoutExerciseState;
  evaluation: LiveSetCoachEvaluation;
  applyToAllPending?: boolean;
}): WorkoutExerciseState {
  const { exerciseState, evaluation, applyToAllPending = false } = params;

  const targetPendingIdx = evaluation.nextPendingSetIndex;
  const updatedSets = exerciseState.sets.map((s, idx) => {
    if (s.completed || s.isWarmup) {
      return s;
    }
    const shouldUpdate = applyToAllPending
      ? idx >= targetPendingIdx && targetPendingIdx >= 0
      : idx === targetPendingIdx;
    if (!shouldUpdate) return s;

    return {
      ...s,
      weight:
        typeof evaluation.suggestedWeightKg === 'number' && evaluation.suggestedWeightKg > 0
          ? evaluation.suggestedWeightKg
          : s.weight,
      reps:
        typeof evaluation.suggestedReps === 'number' && evaluation.suggestedReps > 0
          ? evaluation.suggestedReps
          : s.reps,
    };
  });

  return {
    ...exerciseState,
    restSeconds:
      evaluation.suggestedRestSeconds > 0
        ? evaluation.suggestedRestSeconds
        : exerciseState.restSeconds,
    sets: updatedSets,
  };
}

/**
 * 6. RESUMEN POSTENTRENAMIENTO
 * Genera un informe estructurado con rendimiento general, volumen total, récords personales,
 * comparación con entrenamientos anteriores, recomendaciones para la próxima sesión y
 * recuperación muscular estimada.
 */
export function buildPostWorkoutCoachReport(params: {
  workout: CompletedWorkout;
  history: CompletedWorkout[];
  newPRs: PersonalRecord[];
  routines?: Routine[];
  referenceTimeMs?: number;
}): PostWorkoutCoachReport {
  const {
    workout,
    history,
    newPRs,
    routines = [],
    referenceTimeMs = workout.endTime || Date.now(),
  } = params;

  const totalVolumeKg = Math.round(workout.totalVolumeKg || 0);
  const completedSetsCount = workout.completedSetsCount || 0;
  const totalRepsCount =
    workout.totalRepsCount ??
    (workout.exercisesSummary || []).reduce(
      (acc, ex) => acc + (ex.totalReps ?? ex.sets * ex.maxReps),
      0
    );
  const avgRpe = typeof workout.avgRpe === 'number' ? workout.avgRpe : null;
  const prCount = Array.isArray(newPRs) ? newPRs.length : 0;
  const prHighlights = (newPRs || []).map(
    (pr) => `${pr.exerciseName}: ${pr.maxWeight} kg × ${pr.repsAtMaxWeight} reps (1RM est. ${pr.estimated1RM} kg)`
  );

  // Comparación con sesión previa
  let previousComparison: PostWorkoutCoachReport['previousComparison'];
  if (workout.previousSessionComparison) {
    const prevVol = workout.previousSessionComparison.prevVolumeKg || 0;
    const diffKg = Math.round(workout.previousSessionComparison.volumeDiffKg || 0);
    const diffPct =
      prevVol > 0 ? Math.round(((totalVolumeKg - prevVol) / prevVol) * 1000) / 10 : null;
    previousComparison = {
      hasPrevious: true,
      volumeDiffKg: diffKg,
      volumeDiffPct: diffPct,
      summaryText:
        diffKg >= 0
          ? `Incrementaste +${diffKg.toLocaleString()} kg${diffPct !== null ? ` (+${diffPct}%)` : ''} respecto a la sesión previa (${prevVol.toLocaleString()} kg).`
          : `Volumen ${diffKg.toLocaleString()} kg${diffPct !== null ? ` (${diffPct}%)` : ''} frente a la sesión previa (${prevVol.toLocaleString()} kg).`,
    };
  } else {
    const priorSameRoutine = (history || [])
      .filter((h) => h && h.id !== workout.id && h.routineId === workout.routineId)
      .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))[0];

    if (priorSameRoutine) {
      const prevVol = Math.round(priorSameRoutine.totalVolumeKg || 0);
      const diffKg = totalVolumeKg - prevVol;
      const diffPct =
        prevVol > 0 ? Math.round(((totalVolumeKg - prevVol) / prevVol) * 1000) / 10 : null;
      previousComparison = {
        hasPrevious: true,
        volumeDiffKg: diffKg,
        volumeDiffPct: diffPct,
        summaryText:
          diffKg >= 0
            ? `Superaste la sesión previa de esta rutina por +${diffKg.toLocaleString()} kg.`
            : `Variación de ${diffKg.toLocaleString()} kg respecto a la última sesión de esta rutina.`,
      };
    } else {
      previousComparison = {
        hasPrevious: false,
        volumeDiffKg: 0,
        volumeDiffPct: null,
        summaryText: 'Primera sesión registrada para esta rutina; servirá como línea base oficial.',
      };
    }
  }

  // Calificación general del rendimiento
  let overallRating: PostWorkoutCoachReport['overallRating'] = 'solido';
  let headline = 'Sesión sólida y consistente';
  if (prCount > 0 || (previousComparison.hasPrevious && previousComparison.volumeDiffKg > 0)) {
    overallRating = 'sobresaliente';
    headline =
      prCount > 0
        ? `Rendimiento sobresaliente con ${prCount} récord(s) personal(es)`
        : 'Sobrecarga progresiva alcanzada con éxito';
  } else if (typeof avgRpe === 'number' && avgRpe >= 9.4) {
    overallRating = 'alta_fatiga';
    headline = 'Sesión de alta exigencia neural — Prioriza recuperación';
  } else if (!previousComparison.hasPrevious) {
    overallRating = 'base_registrada';
    headline = 'Línea base biomecánica registrada';
  }

  const executiveSummary = `Completaste ${completedSetsCount} series efectivas y ${totalRepsCount} repeticiones con un tonelaje total de ${totalVolumeKg.toLocaleString()} kg${
    avgRpe ? ` a un RPE promedio de @${avgRpe}` : ''
  }. ${previousComparison.summaryText}`;

  // Recomendaciones para la próxima sesión por ejercicio
  const historyWithCurrent = [
    workout,
    ...(Array.isArray(history) ? history.filter((w) => w.id !== workout.id) : []),
  ];
  const matchedRoutine = routines.find((r) => r.id === workout.routineId) || null;

  const nextSessionRecommendations: PostWorkoutNextSessionItem[] = (
    workout.exercisesSummary || []
  ).map((exSum) => {
    const routineEx = matchedRoutine?.exercises.find(
      (re) =>
        re.id === exSum.exerciseId ||
        normalizeText(re.name) === normalizeText(exSum.name)
    );
    const sessions = findPreviousExerciseSessions({
      history: historyWithCurrent,
      exercise: {
        exerciseId: exSum.exerciseId,
        originalExerciseId: exSum.originalExerciseId,
        libraryExerciseId: exSum.libraryExerciseId,
        activeExerciseName: exSum.name,
        originalExerciseName: exSum.originalExerciseName || exSum.name,
        equipment: exSum.equipment,
      },
      limit: 1,
    });
    const prog = evaluateNextSessionProgression({
      previousSession: sessions[0] || null,
      exerciseName: exSum.name,
      equipmentHint: exSum.equipment || routineEx?.equipment,
      repRangeStr: routineEx?.repRange || '8 - 12 reps',
      targetSetsCount: exSum.sets || routineEx?.defaultSets || 3,
      routineModality: matchedRoutine?.modality,
      exerciseObjective: routineEx?.objective,
    });

    return {
      exerciseId: exSum.exerciseId,
      exerciseName: exSum.name,
      recommendation: prog.summaryLine,
      suggestedNextWeightKg: prog.suggestedWeightKg,
      suggestedNextReps: prog.suggestedReps,
    };
  });

  // Recuperación muscular estimada posterior a la sesión
  const recoveryMap = computeRealTimeRecovery(
    historyWithCurrent,
    referenceTimeMs,
    routines,
    'ALL'
  );
  const athleteSummary = computeOverallAthleteSummary(
    recoveryMap,
    historyWithCurrent,
    referenceTimeMs
  );

  const workedCategories = new Set<string>(
    (workout.primaryMusclesWorked || []).map((m) => normalizeText(m))
  );
  if (workedCategories.size === 0) {
    (workout.exercisesSummary || []).forEach((ex) => {
      const impact = resolveExerciseMuscleImpact(ex.name, ex.muscleGroup || '');
      impact.primary.forEach((mId) => {
        const cat = MUSCLE_CONFIG[mId]?.standardCategory || MUSCLE_CONFIG[mId]?.name;
        if (cat) workedCategories.add(normalizeText(cat));
      });
    });
  }

  const allReadiness = [
    ...athleteSummary.highFatigueMuscles,
    ...athleteSummary.inRecoveryMuscles,
    ...athleteSummary.readyMuscles,
  ];

  const recoveryByGroup = new Map<string, PostWorkoutMuscleRecoveryItem>();
  for (const item of allReadiness) {
    const groupNorm = normalizeText(item.groupName);
    const nameNorm = normalizeText(item.name);
    if (
      workedCategories.size > 0 &&
      !workedCategories.has(groupNorm) &&
      !workedCategories.has(nameNorm) &&
      item.remainingHours <= 0
    ) {
      continue;
    }

    const estHours = Math.max(
      0,
      Math.round((item.remainingHours + item.remainingMinutes / 60) * 10) / 10
    );
    if (estHours <= 0 && !workedCategories.has(groupNorm)) continue;

    const existing = recoveryByGroup.get(item.groupName);
    if (!existing || estHours > existing.estimatedHoursToRecover) {
      const fatigueLevel: PostWorkoutMuscleRecoveryItem['fatigueLevel'] =
        item.fatigue >= 65 ? 'Alta' : item.fatigue >= 30 ? 'Moderada' : 'Baja';
      recoveryByGroup.set(item.groupName, {
        muscleName: item.groupName,
        estimatedHoursToRecover: estHours,
        recoveryPct: Math.max(0, Math.min(100, Math.round(100 - item.fatigue))),
        fatigueLevel,
      });
    }
  }

  const estimatedMuscleRecovery = Array.from(recoveryByGroup.values()).sort(
    (a, b) => b.estimatedHoursToRecover - a.estimatedHoursToRecover
  );

  return {
    overallRating,
    headline,
    executiveSummary,
    totalVolumeKg,
    completedSetsCount,
    totalRepsCount,
    avgRpe,
    prCount,
    prHighlights,
    previousComparison,
    nextSessionRecommendations,
    estimatedMuscleRecovery,
  };
}

