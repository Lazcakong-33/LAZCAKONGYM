/**
 * LAZCAKONG GYM - ELITE PERFORMANCE ANALYTICS ENGINE (FASE 7 - ETAPAS A-D)
 *
 * Motor analítico puro y de alto rendimiento para el Centro de Rendimiento.
 *
 * Reglas de cálculo e integridad:
 * 1. Fechas locales coherentes sin desfases UTC (YYYY-MM-DD interpretado en horario local).
 * 2. Deduplicación por ID único de sesión (preserva múltiples entrenamientos legítimos el mismo día).
 * 3. Diferenciación explícita entre número de sesiones y número de días distintos entrenados.
 * 4. Tonelaje calculado únicamente sobre series efectivamente completadas; peso externo 0 kg en autocarga.
 * 5. Estimación de 1RM (Epley: W * (1 + R/30)) estrictamente separada de marcas reales medidas.
 * 6. Conteo de PRs únicamente para marcas históricamente superadas (nunca por un primer registro base ni repeticiones).
 * 7. Comparativas contra período equivalente previo con manejo seguro de denominador cero ("información insuficiente").
 */

import {
  getChileLocalDateKey,
  getChileWeekdayIndex,
  resolveWorkoutChileDateKey,
} from './calorieCalculator';
import {
  CompletedWorkout,
  Routine,
  PersonalRecord,
  BodyWeightEntry,
  Profile,
  CoachPlatformStorageAdapter,
  MultiWeekComparativeHorizon,
  MultiWeekComparativeBlock,
  VolumeHorizonSummary,
  ProgressiveOverloadProposal,
  ProgressiveOverloadProposalType,
  ExerciseStagnationAnalysis,
  StagnationDetectionStatus,
  PeriodizationDurationWeeks,
  PeriodizationGoalType,
  PeriodizationPhaseType,
  PeriodizationWeekConfig,
  PeriodizationMesocyclePlan,
  MuscleMovementPattern,
  MuscleGroupBalanceItem,
  MuscleBalanceReport,
  SmartWeeklyPerformanceReport,
} from '../types';
import {
  mapToStandardMuscleCategory,
  StandardMuscleCategory,
  STANDARD_MUSCLE_CATEGORIES,
  normalizeText,
} from './workoutAnalyticsEngine';
import { resolveCanonicalExerciseIdentity } from './historyRecoveryEngine';
import {
  sanitizeWorkoutsHistory,
  computeRealTimeRecovery,
  resolveExerciseMuscleImpact,
  MUSCLE_CONFIG,
  BiometricMuscleId,
  getDefaultRecoveryStorageAdapter,
} from './muscleRecoveryEngine';
import {
  findPreviousExerciseSessions,
  extractEquipmentAndVariantSignature,
  areExerciseVariantsCompatible,
  resolveEquipmentProgressionStep,
} from './progressionEngine';
import { buildTechniqueProProfile } from './exerciseAlternatives';

export type PerformancePeriodFilter = '7d' | '30d' | '90d' | '6m' | '12m' | 'all';

export interface PerformanceKpiMetrics {
  totalWorkouts: number;
  totalVolumeKg: number;
  totalVolumeTons: number;
  totalCompletedSets: number;
  totalCompletedReps: number;
  totalDurationMinutes: number;
  activeDaysCount: number;
  weeklyFrequency: number;
  weeklyTargetCompliancePct: number | null;
  verifiedPRsCount: number; // Récords superados verificables en el período
  baselineMarksCount: number; // Primeros registros históricos sin base previa
  averageSessionVolumeKg: number;
  averageSessionDurationMinutes: number;
}

export interface PerformanceComparativeDelta {
  hasBaseComparison: boolean;
  prevWorkouts: number;
  diffWorkouts: number;
  diffWorkoutsPct: number | null;
  prevVolumeKg: number;
  diffVolumeKg: number;
  diffVolumePct: number | null;
  prevWeeklyFrequency: number;
  diffWeeklyFrequency: number;
  prevCompletedSets: number;
  diffCompletedSets: number;
  prevActiveDaysCount: number;
  diffActiveDays: number;
}

export interface MuscleExerciseDetail {
  id: string;
  name: string;
  sets: number;
  volumeKg: number;
  maxWeightKg: number;
  repsAtMax: number;
  sessionsCount: number;
}

export interface MuscleWeeklyPoint {
  weekKey: string;
  weekLabel: string;
  volumeKg: number;
  sets: number;
  sessionsCount: number;
}

export interface MuscleSessionLog {
  workoutId: string;
  date: string;
  routineTitle: string;
  sets: number;
  volumeKg: number;
}

export interface MuscleVolumeBreakdownItem {
  muscle: StandardMuscleCategory;
  sets: number;
  volumeKg: number;
  sharePct: number;
  exercisesCount: number;
  sessionsCount: number;
  distinctDaysCount: number;
  weeklyFrequency: number;
  lastSessionDate?: string;
  exercises: MuscleExerciseDetail[];
  weeklyEvolution: MuscleWeeklyPoint[];
  sessionLogs: MuscleSessionLog[];
  previousPeriod: {
    hasBaseComparison: boolean;
    prevVolumeKg: number;
    diffVolumeKg: number;
    diffVolumePct: number | null;
    prevSets: number;
    diffSets: number;
  };
}

export interface ExerciseStrengthPoint {
  workoutId: string;
  date: string;
  dateTimestamp: number;
  dateLabel: string;
  routineTitle: string;
  maxWeightKg: number;
  repsAtMax: number;
  estimated1RM: number;
  setVolumeKg: number;
  totalSets: number;
  loadDeltaFromPrevKg: number | null;
  isAllTimePR: boolean; // True solo si superó peso o 1RM previo histórico (>0)
  isSurpassedWeightPR: boolean;
  isSurpassed1RMPR: boolean;
}

export interface ExerciseStrengthSeries {
  exerciseId: string;
  exerciseName: string;
  muscleGroup: StandardMuscleCategory;
  points: ExerciseStrengthPoint[];
  allTimeMaxWeightKg: number;
  allTimeMaxWeightReps: number;
  allTimeMaxWeightDate: string;
  allTimeEstimated1RM: number;
  allTime1RMDate: string;
  periodBestWeightKg: number;
  periodBestWeightReps: number;
  periodBestWeightDate: string;
  periodBest1RM: number;
  periodBest1RMDate: string;
  totalVolumeInPeriodKg: number;
  sessionsCount: number;
  previousPeriodComparison: {
    hasPrevData: boolean;
    prevBestWeightKg: number;
    diffBestWeightKg: number;
    prevBest1RM: number;
    diffBest1RM: number;
    prevVolumeKg: number;
    diffVolumePct: number | null;
    prevSessionsCount: number;
  };
}

export interface ElitePersonalRecordItem {
  id: string;
  exerciseName: string;
  muscleGroup: StandardMuscleCategory;
  // Mejor marca real levantada (peso máximo efectivo)
  bestWeightKg: number;
  bestWeightReps: number;
  bestWeightDate: string;
  // Mejor 1RM estimado matemáticamente (Epley)
  best1RM: number;
  best1RMSourceWeight: number;
  best1RMSourceReps: number;
  best1RMDate: string;
  // Marca inicial histórica para evolución
  firstRecordedWeightKg: number;
  firstRecorded1RM: number;
  firstRecordedDate: string;
  total1RMGainKg: number | null;
  total1RMGainPct: number | null;
  sessionsCount: number;
  // Estado verificable dentro del período seleccionado
  hasVerifiedNewRecordInPeriod: boolean;
  surpassedEventsInPeriod: number;
  lastSurpassedDateInPeriod?: string;
  historySnapshots: {
    workoutId: string;
    date: string;
    weightKg: number;
    reps: number;
    estimated1RM: number;
    isSurpassedPR: boolean;
  }[];
}

export interface PeriodFrequencyPoint {
  key: string;
  label: string;
  startDate: string;
  sessionsCount: number;
  activeDaysCount: number;
  volumeKg: number;
  setsCount: number;
}

export interface ConsistencyMetrics {
  hasEnoughData: boolean;
  reasonIfInsufficient?: string;
  consistencyPct: number | null;
  activeDaysCount: number;
  totalWorkouts: number;
  weeklyTargetDays: number;
  weeksEvaluated: number;
  weeksMeetingTarget: number;
  avgSessionsPerActiveDay: number;
}

export interface BodyWeightPoint {
  date: string;
  dateLabel: string;
  dateTimestamp: number;
  weightKg: number;
  bodyFatPct?: number;
  note?: string;
  deltaFromPrevKg: number | null;
  deltaFromStartKg: number;
}

export interface BodyWeightTrainingComparisonPoint {
  weekKey: string;
  weekLabel: string;
  startDate: string;
  avgBodyWeightKg: number | null;
  latestBodyWeightKg: number | null;
  weightSamplesCount: number;
  volumeKg: number;
  sessionsCount: number;
  bestWeightedLoadKg: number | null;
  topEstimated1RM: number | null;
}

export interface BodyWeightEvolutionReport {
  currentWeightKg: number | null;
  startingWeightKg: number | null;
  avgWeightKg: number | null;
  diffWeightKg: number | null;
  minWeightKg: number | null;
  maxWeightKg: number | null;
  entriesCount: number;
  hasAnyAllTimeLogs: boolean;
  totalAllTimeLogsCount: number;
  allTimeLatestWeightKg: number | null;
  allTimeLatestDate: string | null;
  previousPeriodComparison: {
    hasPrevData: boolean;
    prevEntriesCount: number;
    prevLatestWeightKg: number | null;
    prevAvgWeightKg: number | null;
    diffLatestKg: number | null;
    diffLatestPct: number | null;
    diffAvgKg: number | null;
  };
  composition: {
    latestBodyFatPct: number | null;
    startingBodyFatPct: number | null;
    diffBodyFatPct: number | null;
    bodyFatEntriesCount: number;
    heightCm: number | null;
    bmi: number | null;
  };
  points: BodyWeightPoint[];
  comparisonWithTrainingSeries: BodyWeightTrainingComparisonPoint[];
}

export interface ElitePerformanceReport {
  period: PerformancePeriodFilter;
  periodLabel: string;
  dateRange: {
    startDate: string;
    endDate: string;
    startTimestamp: number;
    endTimestamp: number;
    daysCount: number;
  };
  kpis: PerformanceKpiMetrics;
  comparative: PerformanceComparativeDelta;
  consistency: ConsistencyMetrics;
  weeklyFrequencySeries: PeriodFrequencyPoint[];
  monthlyFrequencySeries: PeriodFrequencyPoint[];
  muscleBreakdown: MuscleVolumeBreakdownItem[];
  exerciseSeriesMap: Record<string, ExerciseStrengthSeries>;
  availableExercisesList: {
    id: string;
    name: string;
    muscle: StandardMuscleCategory;
    sessionsCount: number;
  }[];
  recordsSummary: {
    surpassedPRsInPeriodCount: number;
    surpassedExercisesInPeriodCount: number;
    baselineMarksInPeriodCount: number;
    records: ElitePersonalRecordItem[];
  };
  filteredHistory: CompletedWorkout[];
  bodyWeight: BodyWeightEvolutionReport;
  volumeHorizons: VolumeHorizonSummary;
  multiWeekComparatives: {
    w4: MultiWeekComparativeBlock;
    w8: MultiWeekComparativeBlock;
    w12: MultiWeekComparativeBlock;
  };
}

/**
 * Parsea una fecha 'YYYY-MM-DD' o ISO en timestamp local coherente sin desfases UTC.
 */
export function parseLocalDateTimestamp(
  dateStr?: string,
  fallbackTimestamp?: number
): number {
  if (typeof fallbackTimestamp === 'number' && fallbackTimestamp > 0) {
    return fallbackTimestamp;
  }
  if (!dateStr) return 0;
  const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (isoDateOnly) {
    const year = Number(isoDateOnly[1]);
    const month = Number(isoDateOnly[2]) - 1;
    const day = Number(isoDateOnly[3]);
    return new Date(year, month, day, 12, 0, 0, 0).getTime();
  }
  const parsed = new Date(dateStr).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Formatea una fecha a 'YYYY-MM-DD' en hora local.
 */
export function formatLocalYYYYMMDD(d: Date | number | string): string {
  return getChileLocalDateKey(d);
}

/**
 * Retorna la estampa de medianoche local (00:00:00.000) para una fecha dada.
 */
export function getLocalMidnightTimestamp(d: Date | string | number): number {
  const ts = typeof d === 'string' ? parseLocalDateTimestamp(d) : new Date(d).getTime();
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Retorna la clave de inicio de semana (Lunes) 'YYYY-MM-DD' y etiqueta legible.
 */
function getWeekBucketInfo(ts: number): { weekKey: string; weekLabel: string } {
  const dateKey = getChileLocalDateKey(ts);
  const [y, m, d] = dateKey.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(y || 2026, (m || 11) - 1, d || 19, 12, 0, 0));
  const day = getChileWeekdayIndex(noonUtc);
  const diffToMonday = day === 0 ? -6 : 1 - day;
  noonUtc.setUTCDate(noonUtc.getUTCDate() + diffToMonday);
  const weekKey = noonUtc.toISOString().slice(0, 10);
  const weekLabel = noonUtc.toLocaleDateString('es-ES', {
    timeZone: 'America/Santiago',
    day: 'numeric',
    month: 'short',
  });
  return { weekKey, weekLabel };
}

/**
 * Calcula el 1RM estimado mediante la fórmula de Epley: W * (1 + R / 30).
 * Si R = 1, retorna exactamente W (marca real medida).
 */
export function calculateEstimated1RM(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return Math.round(weightKg);
  return Math.round(weightKg * (1 + reps / 30));
}

/**
 * Calcula los límites de tiempo del período y del período previo equivalente.
 */
export function resolvePeriodInterval(
  period: PerformancePeriodFilter,
  referenceNow: Date = new Date()
): {
  current: { startMs: number; endMs: number; days: number; label: string };
  previous: { startMs: number; endMs: number; days: number } | null;
} {
  const todayEnd = new Date(referenceNow);
  todayEnd.setHours(23, 59, 59, 999);
  const endMs = todayEnd.getTime();

  let days = 30;
  let label = 'Últimos 30 días';

  switch (period) {
    case '7d':
      days = 7;
      label = 'Últimos 7 días';
      break;
    case '30d':
      days = 30;
      label = 'Últimos 30 días';
      break;
    case '90d':
      days = 90;
      label = 'Últimos 90 días';
      break;
    case '6m':
      days = 182;
      label = 'Últimos 6 meses';
      break;
    case '12m':
      days = 365;
      label = 'Últimos 12 meses';
      break;
    case 'all':
      days = 3650;
      label = 'Todo el historial';
      break;
  }

  const startDateObj = new Date(referenceNow);
  startDateObj.setDate(startDateObj.getDate() - (days - 1));
  startDateObj.setHours(0, 0, 0, 0);
  const startMs = period === 'all' ? 0 : startDateObj.getTime();

  if (period === 'all') {
    return {
      current: { startMs, endMs, days, label },
      previous: null,
    };
  }

  const prevEndMs = startMs - 1;
  const prevStartObj = new Date(startDateObj);
  prevStartObj.setDate(prevStartObj.getDate() - days);
  prevStartObj.setHours(0, 0, 0, 0);
  const prevStartMs = prevStartObj.getTime();

  return {
    current: { startMs, endMs, days, label },
    previous: { startMs: prevStartMs, endMs: prevEndMs, days },
  };
}

function resolveWorkoutTimestamp(w: CompletedWorkout): number {
  return parseLocalDateTimestamp(w.date, w.startTime);
}

function resolveWorkoutDateKey(w: CompletedWorkout): string {
  const resolved = resolveWorkoutChileDateKey(w);
  if (resolved) return resolved;
  const ts = resolveWorkoutTimestamp(w);
  return ts > 0 ? formatLocalYYYYMMDD(ts) : '';
}

function resolveExerciseVolumeKg(ex: CompletedWorkout['exercisesSummary'][number]): number {
  const maxW = Number(ex.maxWeight) || 0;
  // Regla de integridad: si es autocarga (peso externo 0 kg), jamás inventar cargas externas
  if (maxW <= 0) return 0;
  if (typeof ex.volumeKg === 'number' && ex.volumeKg >= 0) {
    return Math.round(ex.volumeKg);
  }
  const reps = Math.max(0, Number(ex.maxReps) || 0);
  const sets = Math.max(0, Number(ex.sets) || 0);
  return Math.round(maxW * reps * sets);
}

function resolveWorkoutRealVolumeKg(w: CompletedWorkout): number {
  if (typeof w.totalVolumeKg === 'number' && w.totalVolumeKg > 0) {
    return Math.round(w.totalVolumeKg);
  }
  const sumFromExercises = (w.exercisesSummary || []).reduce(
    (acc, ex) => acc + resolveExerciseVolumeKg(ex),
    0
  );
  return Math.round(sumFromExercises);
}

/**
 * Genera el reporte integral de rendimiento deportivo para el atleta activo.
 */
export function computeElitePerformanceAnalytics({
  history = [],
  prs = {},
  bodyWeightLogs = [],
  period = '30d',
  weeklyTargetDays = 4,
  athleteHeightCm,
  profileId,
  referenceNow = new Date(),
}: {
  history: CompletedWorkout[];
  routines?: Routine[];
  prs?: Record<string, PersonalRecord>;
  bodyWeightLogs?: BodyWeightEntry[];
  period: PerformancePeriodFilter;
  weeklyTargetDays?: number;
  athleteHeightCm?: number;
  profileId?: string;
  referenceNow?: Date;
}): ElitePerformanceReport {
  const { current, previous } = resolvePeriodInterval(period, referenceNow);

  // 1. Filtrar sesiones terminadas, aislar por profileId y deduplicar sesiones y series (sanitizeWorkoutsHistory)
  const sanitizedHistory = sanitizeWorkoutsHistory(
    Array.isArray(history) ? history : [],
    profileId
  );
  const seenWorkoutIds = new Set<string>();
  const safeWorkouts = sanitizedHistory
    .filter((w) => {
      if (!w || w.isFinished === false || (w.completedSetsCount || 0) <= 0) return false;
      const uid = w.id || `${resolveWorkoutDateKey(w)}::${w.startTime || 0}::${w.routineId}`;
      if (seenWorkoutIds.has(uid)) return false;
      seenWorkoutIds.add(uid);
      return true;
    })
    .sort((a, b) => resolveWorkoutTimestamp(a) - resolveWorkoutTimestamp(b));

  const currentWorkouts = safeWorkouts.filter((w) => {
    const t = resolveWorkoutTimestamp(w);
    return t >= current.startMs && t <= current.endMs;
  });

  const previousWorkouts = previous
    ? safeWorkouts.filter((w) => {
        const t = resolveWorkoutTimestamp(w);
        return t >= previous.startMs && t <= previous.endMs;
      })
    : [];

  // 2. Evolución de Fuerza y Detección Histórica Real de PRs Superados (sin doble conteo)
  interface InternalExMeta {
    name: string;
    muscle: StandardMuscleCategory;
    allTimeMaxW: number;
    allTimeMaxWReps: number;
    allTimeMaxWDate: string;
    allTimeMax1RM: number;
    allTime1RMSourceW: number;
    allTime1RMSourceReps: number;
    allTime1RMDate: string;
    firstW: number;
    first1RM: number;
    firstDate: string;
    totalSessions: number;
    lastPointWeight: number | null;
    historySnapshots: {
      workoutId: string;
      date: string;
      weightKg: number;
      reps: number;
      estimated1RM: number;
      isSurpassedPR: boolean;
    }[];
  }

  const exerciseMetaMap = new Map<string, InternalExMeta>();
  const currentPeriodExPointsMap = new Map<string, ExerciseStrengthPoint[]>();
  const prevPeriodExBestMap = new Map<
    string,
    { bestW: number; best1RM: number; volumeKg: number; sessionsCount: number }
  >();

  let surpassedPRsInPeriodCount = 0;
  let baselineMarksInPeriodCount = 0;
  const surpassedExercisesInPeriodSet = new Set<string>();
  const exerciseSurpassedInPeriodInfo = new Map<
    string,
    { count: number; lastDate: string }
  >();

  // Recorrer todo el historial cronológicamente (antiguo -> reciente) para establecer línea base real
  safeWorkouts.forEach((w) => {
    const sessionDate = resolveWorkoutDateKey(w);
    const sessionTimestamp = resolveWorkoutTimestamp(w);
    const dateLabel = new Date(sessionTimestamp).toLocaleDateString('es-ES', {
      timeZone: 'America/Santiago',
      day: 'numeric',
      month: 'short',
    });
    const inCurrentPeriod = sessionTimestamp >= current.startMs && sessionTimestamp <= current.endMs;
    const inPrevPeriod =
      previous !== null &&
      sessionTimestamp >= previous.startMs &&
      sessionTimestamp <= previous.endMs;

    // Si en una sola sesión el atleta registró múltiples entradas del mismo ejercicio, deduplicamos el mejor punto de esa sesión
    const perSessionExSeen = new Set<string>();

    (w.exercisesSummary || []).forEach((ex) => {
      const iden = resolveCanonicalExerciseIdentity({
        exerciseId: ex.exerciseId,
        libraryExerciseId: ex.libraryExerciseId,
        name: ex.name,
        equipment: ex.equipment,
        muscleGroup: ex.muscleGroup,
      });
      const cleanName = iden.canonicalName || ex.name?.trim() || 'Ejercicio';
      const key = iden.canonicalKey;
      if (!key) return;

      const maxW = Math.max(0, Math.round((Number(ex.maxWeight) || 0) * 10) / 10);
      const reps = Math.max(1, Math.round(Number(ex.maxReps) || 1));
      const est1RM =
        maxW > 0
          ? ex.estimated1RM && ex.estimated1RM > 0
            ? Math.round(ex.estimated1RM)
            : calculateEstimated1RM(maxW, reps)
          : 0;
      const exVol = resolveExerciseVolumeKg(ex);

      if (inPrevPeriod) {
        const prevEntry = prevPeriodExBestMap.get(key) || {
          bestW: 0,
          best1RM: 0,
          volumeKg: 0,
          sessionsCount: 0,
        };
        prevEntry.bestW = Math.max(prevEntry.bestW, maxW);
        prevEntry.best1RM = Math.max(prevEntry.best1RM, est1RM);
        prevEntry.volumeKg += exVol;
        if (!perSessionExSeen.has(key)) {
          prevEntry.sessionsCount += 1;
        }
        prevPeriodExBestMap.set(key, prevEntry);
      }

      let meta = exerciseMetaMap.get(key);
      if (!meta) {
        meta = {
          name: cleanName,
          muscle: mapToStandardMuscleCategory(ex.muscleGroup, cleanName),
          allTimeMaxW: 0,
          allTimeMaxWReps: reps,
          allTimeMaxWDate: sessionDate,
          allTimeMax1RM: 0,
          allTime1RMSourceW: maxW,
          allTime1RMSourceReps: reps,
          allTime1RMDate: sessionDate,
          firstW: maxW,
          first1RM: est1RM,
          firstDate: sessionDate,
          totalSessions: 0,
          lastPointWeight: null,
          historySnapshots: [],
        };
        exerciseMetaMap.set(key, meta);
      }

      const hadPriorBaseline = meta.totalSessions > 0 && (meta.allTimeMaxW > 0 || meta.allTimeMax1RM > 0);
      const isSurpassedWeightPR = hadPriorBaseline && maxW > meta.allTimeMaxW;
      const isSurpassed1RMPR = hadPriorBaseline && est1RM > meta.allTimeMax1RM;
      const isVerifiedSurpassedPR = isSurpassedWeightPR || isSurpassed1RMPR;

      if (!hadPriorBaseline && maxW > 0 && inCurrentPeriod && meta.totalSessions === 0) {
        baselineMarksInPeriodCount += 1;
      }

      if (isVerifiedSurpassedPR && inCurrentPeriod) {
        surpassedPRsInPeriodCount += 1;
        surpassedExercisesInPeriodSet.add(key);
        const existingSurp = exerciseSurpassedInPeriodInfo.get(key) || {
          count: 0,
          lastDate: sessionDate,
        };
        exerciseSurpassedInPeriodInfo.set(key, {
          count: existingSurp.count + 1,
          lastDate: sessionDate,
        });
      }

      if (maxW > meta.allTimeMaxW) {
        meta.allTimeMaxW = maxW;
        meta.allTimeMaxWReps = reps;
        meta.allTimeMaxWDate = sessionDate;
      }
      if (est1RM > meta.allTimeMax1RM) {
        meta.allTimeMax1RM = est1RM;
        meta.allTime1RMSourceW = maxW;
        meta.allTime1RMSourceReps = reps;
        meta.allTime1RMDate = sessionDate;
      }

      const loadDeltaFromPrevKg =
        meta.lastPointWeight !== null ? Number((maxW - meta.lastPointWeight).toFixed(1)) : null;

      meta.lastPointWeight = maxW;
      if (!perSessionExSeen.has(key)) {
        meta.totalSessions += 1;
        perSessionExSeen.add(key);
      }

      meta.historySnapshots.push({
        workoutId: w.id,
        date: sessionDate,
        weightKg: maxW,
        reps,
        estimated1RM: est1RM,
        isSurpassedPR: isVerifiedSurpassedPR,
      });

      if (inCurrentPeriod) {
        const point: ExerciseStrengthPoint = {
          workoutId: w.id,
          date: sessionDate,
          dateTimestamp: sessionTimestamp,
          dateLabel,
          routineTitle: w.routineTitle || 'Entrenamiento',
          maxWeightKg: maxW,
          repsAtMax: reps,
          estimated1RM: est1RM,
          setVolumeKg: exVol,
          totalSets: ex.sets || 0,
          loadDeltaFromPrevKg,
          isAllTimePR: isVerifiedSurpassedPR,
          isSurpassedWeightPR,
          isSurpassed1RMPR,
        };

        const list = currentPeriodExPointsMap.get(key) || [];
        list.push(point);
        currentPeriodExPointsMap.set(key, list);
      }
    });
  });

  // Incorporar posibles marcas guardadas en `prs` que no figuren en el historial resumido
  // (nunca contarlas como "nuevo récord superado del período" salvo evidencia histórica)
  Object.values(prs || {}).forEach((pr) => {
    if (!pr || !pr.exerciseName || (pr.maxWeight || 0) <= 0) return;
    const iden = resolveCanonicalExerciseIdentity({
      exerciseId: pr.exerciseId,
      name: pr.exerciseName,
    });
    const key = iden.canonicalKey;
    if (!key) return;
    if (!exerciseMetaMap.has(key)) {
      const prDate = formatLocalYYYYMMDD(pr.date) || formatLocalYYYYMMDD(new Date());
      const est1RM = pr.estimated1RM || calculateEstimated1RM(pr.maxWeight, pr.repsAtMaxWeight || 1);
      exerciseMetaMap.set(key, {
        name: pr.exerciseName,
        muscle: mapToStandardMuscleCategory('', pr.exerciseName),
        allTimeMaxW: pr.maxWeight,
        allTimeMaxWReps: pr.repsAtMaxWeight || 1,
        allTimeMaxWDate: prDate,
        allTimeMax1RM: est1RM,
        allTime1RMSourceW: pr.maxWeight,
        allTime1RMSourceReps: pr.repsAtMaxWeight || 1,
        allTime1RMDate: prDate,
        firstW: pr.maxWeight,
        first1RM: est1RM,
        firstDate: prDate,
        totalSessions: 1,
        lastPointWeight: pr.maxWeight,
        historySnapshots: [
          {
            workoutId: `pr-stored-${key}`,
            date: prDate,
            weightKg: pr.maxWeight,
            reps: pr.repsAtMaxWeight || 1,
            estimated1RM: est1RM,
            isSurpassedPR: false,
          },
        ],
      });
    }
  });

  // 3. Cálculo de KPIs, Sesiones, Días Distintos y Consistencia del Período
  let totalVolumeKg = 0;
  let totalSets = 0;
  let totalReps = 0;
  let totalDurationSec = 0;
  const activeDaysSet = new Set<string>();

  const weeklyBuckets = new Map<
    string,
    { label: string; startDate: string; sessionsCount: number; days: Set<string>; volumeKg: number; setsCount: number }
  >();
  const monthlyBuckets = new Map<
    string,
    { label: string; startDate: string; sessionsCount: number; days: Set<string>; volumeKg: number; setsCount: number }
  >();

  currentWorkouts.forEach((w) => {
    const wVol = resolveWorkoutRealVolumeKg(w);
    const wSets = w.completedSetsCount || 0;
    const wReps = w.totalRepsCount || 0;
    const wDur = w.durationSeconds || 0;
    const dateKey = resolveWorkoutDateKey(w);
    const ts = resolveWorkoutTimestamp(w);

    totalVolumeKg += wVol;
    totalSets += wSets;
    totalReps += wReps;
    totalDurationSec += wDur;
    if (dateKey) {
      activeDaysSet.add(dateKey);
    }

    if (ts > 0) {
      const { weekKey, weekLabel } = getWeekBucketInfo(ts);
      const wb = weeklyBuckets.get(weekKey) || {
        label: weekLabel,
        startDate: weekKey,
        sessionsCount: 0,
        days: new Set<string>(),
        volumeKg: 0,
        setsCount: 0,
      };
      wb.sessionsCount += 1;
      if (dateKey) wb.days.add(dateKey);
      wb.volumeKg += wVol;
      wb.setsCount += wSets;
      weeklyBuckets.set(weekKey, wb);

      const mKey = dateKey && dateKey.length >= 7
        ? dateKey.slice(0, 7)
        : (() => {
            const dObj = new Date(ts);
            return `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, '0')}`;
          })();
      const [mY, mM] = mKey.split('-').map(Number);
      const mNoonUtc = new Date(Date.UTC(mY || 2026, (mM || 11) - 1, 15, 12, 0, 0));
      const mLabel = mNoonUtc.toLocaleDateString('es-ES', {
        timeZone: 'America/Santiago',
        month: 'short',
        year: '2-digit',
      });
      const mb = monthlyBuckets.get(mKey) || {
        label: mLabel,
        startDate: `${mKey}-01`,
        sessionsCount: 0,
        days: new Set<string>(),
        volumeKg: 0,
        setsCount: 0,
      };
      mb.sessionsCount += 1;
      if (dateKey) mb.days.add(dateKey);
      mb.volumeKg += wVol;
      mb.setsCount += wSets;
      monthlyBuckets.set(mKey, mb);
    }
  });

  // Calcular semanas reales abarcadas en el período 'all' o fijo
  let effectiveDaysInPeriod = current.days;
  if (period === 'all' && currentWorkouts.length > 0) {
    const firstTs = resolveWorkoutTimestamp(currentWorkouts[0]);
    const lastTs = resolveWorkoutTimestamp(currentWorkouts[currentWorkouts.length - 1]);
    effectiveDaysInPeriod = Math.max(7, Math.ceil((lastTs - firstTs) / (24 * 60 * 60 * 1000)) + 1);
  }

  const periodWeeks = Math.max(1, effectiveDaysInPeriod / 7);
  const weeklyFrequency = Number((currentWorkouts.length / periodWeeks).toFixed(1));
  const targetDays = Math.max(1, weeklyTargetDays || 4);
  const weeklyTargetCompliancePct =
    currentWorkouts.length > 0
      ? Math.min(100, Math.round((activeDaysSet.size / (periodWeeks * targetDays)) * 100))
      : null;

  const weeklyFrequencySeries: PeriodFrequencyPoint[] = Array.from(weeklyBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, b]) => ({
      key,
      label: b.label,
      startDate: b.startDate,
      sessionsCount: b.sessionsCount,
      activeDaysCount: b.days.size,
      volumeKg: Math.round(b.volumeKg),
      setsCount: b.setsCount,
    }));

  const monthlyFrequencySeries: PeriodFrequencyPoint[] = Array.from(monthlyBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, b]) => ({
      key,
      label: b.label,
      startDate: b.startDate,
      sessionsCount: b.sessionsCount,
      activeDaysCount: b.days.size,
      volumeKg: Math.round(b.volumeKg),
      setsCount: b.setsCount,
    }));

  const weeksMeetingTarget = weeklyFrequencySeries.filter(
    (w) => w.activeDaysCount >= targetDays
  ).length;

  const hasEnoughConsistencyData = currentWorkouts.length >= 2;
  const consistency: ConsistencyMetrics = {
    hasEnoughData: hasEnoughConsistencyData,
    reasonIfInsufficient:
      currentWorkouts.length === 0
        ? 'Sin sesiones registradas en este período'
        : currentWorkouts.length === 1
        ? 'Se requieren al menos 2 sesiones para medir consistencia'
        : undefined,
    consistencyPct: hasEnoughConsistencyData ? weeklyTargetCompliancePct : null,
    activeDaysCount: activeDaysSet.size,
    totalWorkouts: currentWorkouts.length,
    weeklyTargetDays: targetDays,
    weeksEvaluated: weeklyFrequencySeries.length,
    weeksMeetingTarget,
    avgSessionsPerActiveDay:
      activeDaysSet.size > 0
        ? Number((currentWorkouts.length / activeDaysSet.size).toFixed(2))
        : 0,
  };

  const kpis: PerformanceKpiMetrics = {
    totalWorkouts: currentWorkouts.length,
    totalVolumeKg,
    totalVolumeTons: Number((totalVolumeKg / 1000).toFixed(2)),
    totalCompletedSets: totalSets,
    totalCompletedReps: totalReps,
    totalDurationMinutes: Math.round(totalDurationSec / 60),
    activeDaysCount: activeDaysSet.size,
    weeklyFrequency,
    weeklyTargetCompliancePct,
    verifiedPRsCount: surpassedPRsInPeriodCount,
    baselineMarksCount: baselineMarksInPeriodCount,
    averageSessionVolumeKg:
      currentWorkouts.length > 0 ? Math.round(totalVolumeKg / currentWorkouts.length) : 0,
    averageSessionDurationMinutes:
      currentWorkouts.length > 0 ? Math.round(totalDurationSec / 60 / currentWorkouts.length) : 0,
  };

  // 4. Comparativa con Período Equivalente Anterior
  const hasBaseComparison = previous !== null && previousWorkouts.length > 0;
  let prevVolumeKg = 0;
  let prevSets = 0;
  const prevActiveDaysSet = new Set<string>();

  previousWorkouts.forEach((w) => {
    prevVolumeKg += resolveWorkoutRealVolumeKg(w);
    prevSets += w.completedSetsCount || 0;
    const dKey = resolveWorkoutDateKey(w);
    if (dKey) prevActiveDaysSet.add(dKey);
  });

  const prevWeeks = previous ? Math.max(1, previous.days / 7) : 1;
  const prevWeeklyFreq = Number((previousWorkouts.length / prevWeeks).toFixed(1));

  const diffWorkouts = currentWorkouts.length - previousWorkouts.length;
  const diffWorkoutsPct =
    hasBaseComparison && previousWorkouts.length > 0
      ? Math.round((diffWorkouts / previousWorkouts.length) * 100)
      : null;

  const diffVolumeKg = totalVolumeKg - prevVolumeKg;
  const diffVolumePct =
    hasBaseComparison && prevVolumeKg > 0
      ? Math.round((diffVolumeKg / prevVolumeKg) * 100)
      : null;

  const comparative: PerformanceComparativeDelta = {
    hasBaseComparison,
    prevWorkouts: previousWorkouts.length,
    diffWorkouts,
    diffWorkoutsPct,
    prevVolumeKg,
    diffVolumeKg,
    diffVolumePct,
    prevWeeklyFrequency: prevWeeklyFreq,
    diffWeeklyFrequency: Number((weeklyFrequency - prevWeeklyFreq).toFixed(1)),
    prevCompletedSets: prevSets,
    diffCompletedSets: totalSets - prevSets,
    prevActiveDaysCount: prevActiveDaysSet.size,
    diffActiveDays: activeDaysSet.size - prevActiveDaysSet.size,
  };

  // 5. Volumen Muscular Avanzado (sin doble cómputo, 1 músculo primario por ejercicio)
  interface MuscleAccumulator {
    sets: number;
    volumeKg: number;
    sessions: Set<string>;
    days: Set<string>;
    lastDate?: string;
    exercisesMap: Map<string, MuscleExerciseDetail>;
    weeklyMap: Map<string, { weekLabel: string; volumeKg: number; sets: number; sessions: Set<string> }>;
    sessionLogs: MuscleSessionLog[];
  }

  const createEmptyMuscleAcc = (): MuscleAccumulator => ({
    sets: 0,
    volumeKg: 0,
    sessions: new Set<string>(),
    days: new Set<string>(),
    exercisesMap: new Map<string, MuscleExerciseDetail>(),
    weeklyMap: new Map(),
    sessionLogs: [],
  });

  const muscleMap = {} as Record<StandardMuscleCategory, MuscleAccumulator>;
  const prevMuscleMap = {} as Record<StandardMuscleCategory, { volumeKg: number; sets: number; hasData: boolean }>;

  STANDARD_MUSCLE_CATEGORIES.forEach((m) => {
    muscleMap[m] = createEmptyMuscleAcc();
    prevMuscleMap[m] = { volumeKg: 0, sets: 0, hasData: false };
  });

  currentWorkouts.forEach((w) => {
    const wId = w.id || `${resolveWorkoutDateKey(w)}-${w.startTime}`;
    const wDate = resolveWorkoutDateKey(w);
    const ts = resolveWorkoutTimestamp(w);
    const { weekKey, weekLabel } = getWeekBucketInfo(ts > 0 ? ts : Date.now());
    const perSessionMuscleVol = new Map<StandardMuscleCategory, { sets: number; vol: number }>();

    (w.exercisesSummary || []).forEach((ex) => {
      const category = mapToStandardMuscleCategory(ex.muscleGroup, ex.name);
      const exVol = resolveExerciseVolumeKg(ex);
      const exSets = Math.max(0, Number(ex.sets) || 0);
      const maxW = Math.max(0, Math.round((Number(ex.maxWeight) || 0) * 10) / 10);
      const reps = Math.max(0, Math.round(Number(ex.maxReps) || 0));
      const iden = resolveCanonicalExerciseIdentity({
        exerciseId: ex.exerciseId,
        libraryExerciseId: ex.libraryExerciseId,
        name: ex.name,
        equipment: ex.equipment,
        muscleGroup: ex.muscleGroup,
      });
      const exKey = iden.canonicalKey;
      const bucket = muscleMap[category];

      if (bucket) {
        bucket.sets += exSets;
        bucket.volumeKg += exVol;
        bucket.sessions.add(wId);
        if (wDate) bucket.days.add(wDate);
        if (!bucket.lastDate || (wDate && wDate > bucket.lastDate)) {
          bucket.lastDate = wDate;
        }

        if (exKey) {
          const exItem = bucket.exercisesMap.get(exKey) || {
            id: exKey,
            name: ex.name || 'Ejercicio',
            sets: 0,
            volumeKg: 0,
            maxWeightKg: 0,
            repsAtMax: 0,
            sessionsCount: 0,
          };
          exItem.sets += exSets;
          exItem.volumeKg += exVol;
          if (maxW > exItem.maxWeightKg) {
            exItem.maxWeightKg = maxW;
            exItem.repsAtMax = reps;
          }
          exItem.sessionsCount += 1;
          bucket.exercisesMap.set(exKey, exItem);
        }

        const wBucket = bucket.weeklyMap.get(weekKey) || {
          weekLabel,
          volumeKg: 0,
          sets: 0,
          sessions: new Set<string>(),
        };
        wBucket.volumeKg += exVol;
        wBucket.sets += exSets;
        wBucket.sessions.add(wId);
        bucket.weeklyMap.set(weekKey, wBucket);

        const sAcc = perSessionMuscleVol.get(category) || { sets: 0, vol: 0 };
        sAcc.sets += exSets;
        sAcc.vol += exVol;
        perSessionMuscleVol.set(category, sAcc);
      }
    });

    perSessionMuscleVol.forEach((stats, cat) => {
      muscleMap[cat].sessionLogs.push({
        workoutId: wId,
        date: wDate,
        routineTitle: w.routineTitle || 'Entrenamiento',
        sets: stats.sets,
        volumeKg: stats.vol,
      });
    });
  });

  previousWorkouts.forEach((w) => {
    (w.exercisesSummary || []).forEach((ex) => {
      const category = mapToStandardMuscleCategory(ex.muscleGroup, ex.name);
      const exVol = resolveExerciseVolumeKg(ex);
      const exSets = Math.max(0, Number(ex.sets) || 0);
      if (prevMuscleMap[category]) {
        prevMuscleMap[category].volumeKg += exVol;
        prevMuscleMap[category].sets += exSets;
        prevMuscleMap[category].hasData = true;
      }
    });
  });

  const totalAttributableMuscleVolKg = STANDARD_MUSCLE_CATEGORIES.reduce(
    (acc, m) => acc + muscleMap[m].volumeKg,
    0
  );
  const shareDenominator = totalAttributableMuscleVolKg > 0 ? totalAttributableMuscleVolKg : totalVolumeKg;

  const muscleBreakdown: MuscleVolumeBreakdownItem[] = STANDARD_MUSCLE_CATEGORIES.map((m) => {
    const data = muscleMap[m];
    const prev = prevMuscleMap[m];
    const sharePct = shareDenominator > 0 ? Math.round((data.volumeKg / shareDenominator) * 100) : 0;

    const hasPrevMuscleBase = previous !== null && prev.hasData && prev.volumeKg > 0;
    const diffVol = data.volumeKg - prev.volumeKg;
    const diffVolPct = hasPrevMuscleBase ? Math.round((diffVol / prev.volumeKg) * 100) : null;

    return {
      muscle: m,
      sets: data.sets,
      volumeKg: data.volumeKg,
      sharePct,
      exercisesCount: data.exercisesMap.size,
      sessionsCount: data.sessions.size,
      distinctDaysCount: data.days.size,
      weeklyFrequency: Number((data.days.size / periodWeeks).toFixed(1)),
      lastSessionDate: data.lastDate,
      exercises: Array.from(data.exercisesMap.values()).sort((a, b) => b.volumeKg - a.volumeKg),
      weeklyEvolution: Array.from(data.weeklyMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([weekKey, w]) => ({
          weekKey,
          weekLabel: w.weekLabel,
          volumeKg: w.volumeKg,
          sets: w.sets,
          sessionsCount: w.sessions.size,
        })),
      sessionLogs: [...data.sessionLogs].reverse().slice(0, 10),
      previousPeriod: {
        hasBaseComparison: previous !== null && previousWorkouts.length > 0,
        prevVolumeKg: prev.volumeKg,
        diffVolumeKg: diffVol,
        diffVolumePct,
        prevSets: prev.sets,
        diffSets: data.sets - prev.sets,
      },
    };
  }).sort((a, b) => b.volumeKg - a.volumeKg || b.sets - a.sets);

  // 6. Construir Series de Fuerza por Ejercicio + Lista Unificada de Récords Personales
  const exerciseSeriesMap: Record<string, ExerciseStrengthSeries> = {};
  const availableExercisesList: {
    id: string;
    name: string;
    muscle: StandardMuscleCategory;
    sessionsCount: number;
  }[] = [];
  const unifiedRecords: ElitePersonalRecordItem[] = [];

  exerciseMetaMap.forEach((meta, key) => {
    const points = currentPeriodExPointsMap.get(key) || [];
    let periodBestWeightKg = 0;
    let periodBestWeightReps = 0;
    let periodBestWeightDate = '';
    let periodBest1RM = 0;
    let periodBest1RMDate = '';
    let totalVolumeInPeriodKg = 0;

    points.forEach((p) => {
      if (p.maxWeightKg >= periodBestWeightKg) {
        if (p.maxWeightKg > periodBestWeightKg || p.repsAtMax > periodBestWeightReps) {
          periodBestWeightKg = p.maxWeightKg;
          periodBestWeightReps = p.repsAtMax;
          periodBestWeightDate = p.date;
        }
      }
      if (p.estimated1RM > periodBest1RM) {
        periodBest1RM = p.estimated1RM;
        periodBest1RMDate = p.date;
      }
      totalVolumeInPeriodKg += p.setVolumeKg;
    });

    const prevEx = prevPeriodExBestMap.get(key);
    const hasPrevData = Boolean(previous !== null && prevEx && prevEx.sessionsCount > 0);
    const diffBestWeightKg = hasPrevData && prevEx ? Number((periodBestWeightKg - prevEx.bestW).toFixed(1)) : 0;
    const diffBest1RM = hasPrevData && prevEx ? periodBest1RM - prevEx.best1RM : 0;
    const diffVolumePct =
      hasPrevData && prevEx && prevEx.volumeKg > 0
        ? Math.round(((totalVolumeInPeriodKg - prevEx.volumeKg) / prevEx.volumeKg) * 100)
        : null;

    exerciseSeriesMap[key] = {
      exerciseId: key,
      exerciseName: meta.name,
      muscleGroup: meta.muscle,
      points,
      allTimeMaxWeightKg: meta.allTimeMaxW,
      allTimeMaxWeightReps: meta.allTimeMaxWReps,
      allTimeMaxWeightDate: meta.allTimeMaxWDate,
      allTimeEstimated1RM: meta.allTimeMax1RM,
      allTime1RMDate: meta.allTime1RMDate,
      periodBestWeightKg,
      periodBestWeightReps,
      periodBestWeightDate,
      periodBest1RM,
      periodBest1RMDate,
      totalVolumeInPeriodKg,
      sessionsCount: points.length,
      previousPeriodComparison: {
        hasPrevData,
        prevBestWeightKg: prevEx?.bestW || 0,
        diffBestWeightKg,
        prevBest1RM: prevEx?.best1RM || 0,
        diffBest1RM,
        prevVolumeKg: prevEx?.volumeKg || 0,
        diffVolumePct,
        prevSessionsCount: prevEx?.sessionsCount || 0,
      },
    };

    if (points.length > 0) {
      availableExercisesList.push({
        id: key,
        name: meta.name,
        muscle: meta.muscle,
        sessionsCount: points.length,
      });
    }

    if (meta.allTimeMaxW > 0 || meta.allTimeMax1RM > 0) {
      const surpInfo = exerciseSurpassedInPeriodInfo.get(key);
      const hasMultiSessions = meta.historySnapshots.length >= 2 && meta.first1RM > 0;
      const total1RMGainKg = hasMultiSessions ? meta.allTimeMax1RM - meta.first1RM : null;
      const total1RMGainPct =
        hasMultiSessions && total1RMGainKg !== null && meta.first1RM > 0
          ? Number(((total1RMGainKg / meta.first1RM) * 100).toFixed(1))
          : null;

      unifiedRecords.push({
        id: key,
        exerciseName: meta.name,
        muscleGroup: meta.muscle,
        bestWeightKg: meta.allTimeMaxW,
        bestWeightReps: meta.allTimeMaxWReps,
        bestWeightDate: meta.allTimeMaxWDate,
        best1RM: meta.allTimeMax1RM,
        best1RMSourceWeight: meta.allTime1RMSourceW,
        best1RMSourceReps: meta.allTime1RMSourceReps,
        best1RMDate: meta.allTime1RMDate,
        firstRecordedWeightKg: meta.firstW,
        firstRecorded1RM: meta.first1RM,
        firstRecordedDate: meta.firstDate,
        total1RMGainKg,
        total1RMGainPct,
        sessionsCount: meta.totalSessions,
        hasVerifiedNewRecordInPeriod: Boolean(surpInfo && surpInfo.count > 0),
        surpassedEventsInPeriod: surpInfo?.count || 0,
        lastSurpassedDateInPeriod: surpInfo?.lastDate,
        historySnapshots: meta.historySnapshots,
      });
    }
  });

  availableExercisesList.sort(
    (a, b) => b.sessionsCount - a.sessionsCount || a.name.localeCompare(b.name)
  );

  unifiedRecords.sort((a, b) => {
    if (a.hasVerifiedNewRecordInPeriod !== b.hasVerifiedNewRecordInPeriod) {
      return a.hasVerifiedNewRecordInPeriod ? -1 : 1;
    }
    return b.best1RM - a.best1RM;
  });

  // 7. Evolución Corporal, Composición y Comparativa Descriptiva con Tendencias de Entrenamiento
  const allValidWeightEntries = (Array.isArray(bodyWeightLogs) ? bodyWeightLogs : [])
    .filter((entry) => {
      if (!entry || !entry.date) return false;
      const wVal = Number(entry.weightKg);
      if (!Number.isFinite(wVal) || wVal <= 0 || wVal > 450) return false;
      const t = parseLocalDateTimestamp(entry.date);
      return t > 0;
    })
    .map((entry) => {
      const ts = parseLocalDateTimestamp(entry.date);
      const rawFat =
        typeof entry.bodyFatPct === 'number' &&
        Number.isFinite(entry.bodyFatPct) &&
        entry.bodyFatPct > 0 &&
        entry.bodyFatPct <= 70
          ? Number(entry.bodyFatPct.toFixed(1))
          : undefined;
      return {
        ...entry,
        weightKg: Number(Number(entry.weightKg).toFixed(1)),
        bodyFatPct: rawFat,
        _ts: ts,
        _dateKey: formatLocalYYYYMMDD(entry.date),
      };
    })
    .sort((a, b) => a._ts - b._ts);

  const filteredWeightEntries = allValidWeightEntries.filter(
    (entry) => entry._ts >= current.startMs && entry._ts <= current.endMs
  );

  const prevWeightEntries = previous
    ? allValidWeightEntries.filter(
        (entry) => entry._ts >= previous.startMs && entry._ts <= previous.endMs
      )
    : [];

  let currentWeightKg: number | null = null;
  let startingWeightKg: number | null = null;
  let avgWeightKg: number | null = null;
  let minWeightKg: number | null = null;
  let maxWeightKg: number | null = null;

  if (filteredWeightEntries.length > 0) {
    startingWeightKg = filteredWeightEntries[0].weightKg;
    currentWeightKg = filteredWeightEntries[filteredWeightEntries.length - 1].weightKg;
    const weights = filteredWeightEntries.map((e) => e.weightKg);
    const sumW = weights.reduce((acc, v) => acc + v, 0);
    avgWeightKg = Number((sumW / weights.length).toFixed(1));
    minWeightKg = Math.min(...weights);
    maxWeightKg = Math.max(...weights);
  }

  // Comparativa con ventana equivalente anterior
  let previousPeriodComparison: BodyWeightEvolutionReport['previousPeriodComparison'] = {
    hasPrevData: false,
    prevEntriesCount: 0,
    prevLatestWeightKg: null,
    prevAvgWeightKg: null,
    diffLatestKg: null,
    diffLatestPct: null,
    diffAvgKg: null,
  };

  if (prevWeightEntries.length > 0 && currentWeightKg !== null && avgWeightKg !== null) {
    const prevLatest = prevWeightEntries[prevWeightEntries.length - 1].weightKg;
    const prevAvg = Number(
      (
        prevWeightEntries.reduce((acc, e) => acc + e.weightKg, 0) /
        prevWeightEntries.length
      ).toFixed(1)
    );
    const diffLatestKg = Number((currentWeightKg - prevLatest).toFixed(1));
    const diffLatestPct =
      prevLatest > 0 ? Number(((diffLatestKg / prevLatest) * 100).toFixed(1)) : null;
    const diffAvgKg = Number((avgWeightKg - prevAvg).toFixed(1));

    previousPeriodComparison = {
      hasPrevData: true,
      prevEntriesCount: prevWeightEntries.length,
      prevLatestWeightKg: prevLatest,
      prevAvgWeightKg: prevAvg,
      diffLatestKg,
      diffLatestPct,
      diffAvgKg,
    };
  }

  // Composición corporal estrictamente desde registros reales (sin inventar % grasa)
  const fatEntriesInPeriod = filteredWeightEntries.filter(
    (e) => typeof e.bodyFatPct === 'number'
  );
  const latestBodyFatPct =
    fatEntriesInPeriod.length > 0
      ? fatEntriesInPeriod[fatEntriesInPeriod.length - 1].bodyFatPct!
      : null;
  const startingBodyFatPct =
    fatEntriesInPeriod.length > 0 ? fatEntriesInPeriod[0].bodyFatPct! : null;
  const diffBodyFatPct =
    latestBodyFatPct !== null && startingBodyFatPct !== null
      ? Number((latestBodyFatPct - startingBodyFatPct).toFixed(1))
      : null;

  const validHeightCm =
    typeof athleteHeightCm === 'number' && Number.isFinite(athleteHeightCm) && athleteHeightCm >= 80 && athleteHeightCm <= 260
      ? Math.round(athleteHeightCm)
      : null;

  const latestWeightForBmi =
    currentWeightKg !== null
      ? currentWeightKg
      : allValidWeightEntries.length > 0
      ? allValidWeightEntries[allValidWeightEntries.length - 1].weightKg
      : null;

  const bmi =
    validHeightCm !== null && latestWeightForBmi !== null
      ? Number((latestWeightForBmi / Math.pow(validHeightCm / 100, 2)).toFixed(1))
      : null;

  const bodyWeightPoints: BodyWeightPoint[] = filteredWeightEntries.map((e, idx) => {
    const prevWeight = idx > 0 ? filteredWeightEntries[idx - 1].weightKg : null;
    const deltaFromPrevKg =
      prevWeight !== null ? Number((e.weightKg - prevWeight).toFixed(1)) : null;
    const deltaFromStartKg =
      startingWeightKg !== null ? Number((e.weightKg - startingWeightKg).toFixed(1)) : 0;
    const dateLabel = new Date(e._ts).toLocaleDateString('es-ES', {
      timeZone: 'America/Santiago',
      day: 'numeric',
      month: 'short',
    });
    return {
      date: e._dateKey,
      dateLabel,
      dateTimestamp: e._ts,
      weightKg: e.weightKg,
      bodyFatPct: e.bodyFatPct,
      note: e.note,
      deltaFromPrevKg,
      deltaFromStartKg,
    };
  });

  // Serie semanal combinada (peso corporal vs volumen y fuerza semanal, sin causalidad ni relleno falso)
  interface CombinedWeekBucket {
    weekKey: string;
    weekLabel: string;
    startDate: string;
    weights: number[];
    volumeKg: number;
    sessionsCount: number;
    bestWeightedLoadKg: number | null;
    topEstimated1RM: number | null;
  }

  const combinedWeekMap = new Map<string, CombinedWeekBucket>();

  weeklyFrequencySeries.forEach((wPoint) => {
    combinedWeekMap.set(wPoint.key, {
      weekKey: wPoint.key,
      weekLabel: wPoint.label,
      startDate: wPoint.startDate,
      weights: [],
      volumeKg: wPoint.volumeKg,
      sessionsCount: wPoint.sessionsCount,
      bestWeightedLoadKg: null,
      topEstimated1RM: null,
    });
  });

  currentWorkouts.forEach((w) => {
    const ts = resolveWorkoutTimestamp(w);
    if (ts <= 0) return;
    const { weekKey, weekLabel } = getWeekBucketInfo(ts);
    const bucket = combinedWeekMap.get(weekKey) || {
      weekKey,
      weekLabel,
      startDate: weekKey,
      weights: [],
      volumeKg: 0,
      sessionsCount: 0,
      bestWeightedLoadKg: null,
      topEstimated1RM: null,
    };
    (w.exercisesSummary || []).forEach((ex) => {
      const maxW = Math.max(0, Number(ex.maxWeight) || 0);
      if (maxW > 0) {
        const reps = Math.max(1, Number(ex.maxReps) || 1);
        const est1RM =
          ex.estimated1RM && ex.estimated1RM > 0
            ? Math.round(ex.estimated1RM)
            : calculateEstimated1RM(maxW, reps);
        bucket.bestWeightedLoadKg =
          bucket.bestWeightedLoadKg !== null ? Math.max(bucket.bestWeightedLoadKg, maxW) : maxW;
        bucket.topEstimated1RM =
          bucket.topEstimated1RM !== null ? Math.max(bucket.topEstimated1RM, est1RM) : est1RM;
      }
    });
    combinedWeekMap.set(weekKey, bucket);
  });

  filteredWeightEntries.forEach((entry) => {
    const { weekKey, weekLabel } = getWeekBucketInfo(entry._ts);
    const bucket = combinedWeekMap.get(weekKey) || {
      weekKey,
      weekLabel,
      startDate: weekKey,
      weights: [],
      volumeKg: 0,
      sessionsCount: 0,
      bestWeightedLoadKg: null,
      topEstimated1RM: null,
    };
    bucket.weights.push(entry.weightKg);
    combinedWeekMap.set(weekKey, bucket);
  });

  const comparisonWithTrainingSeries: BodyWeightTrainingComparisonPoint[] = Array.from(
    combinedWeekMap.values()
  )
    .sort((a, b) => a.weekKey.localeCompare(b.weekKey))
    .map((b) => ({
      weekKey: b.weekKey,
      weekLabel: b.weekLabel,
      startDate: b.startDate,
      avgBodyWeightKg:
        b.weights.length > 0
          ? Number((b.weights.reduce((acc, v) => acc + v, 0) / b.weights.length).toFixed(1))
          : null,
      latestBodyWeightKg:
        b.weights.length > 0 ? b.weights[b.weights.length - 1] : null,
      weightSamplesCount: b.weights.length,
      volumeKg: b.volumeKg,
      sessionsCount: b.sessionsCount,
      bestWeightedLoadKg: b.bestWeightedLoadKg,
      topEstimated1RM: b.topEstimated1RM,
    }));

  const bodyWeight: BodyWeightEvolutionReport = {
    currentWeightKg,
    startingWeightKg,
    avgWeightKg,
    diffWeightKg:
      currentWeightKg !== null && startingWeightKg !== null
        ? Number((currentWeightKg - startingWeightKg).toFixed(1))
        : null,
    minWeightKg,
    maxWeightKg,
    entriesCount: filteredWeightEntries.length,
    hasAnyAllTimeLogs: allValidWeightEntries.length > 0,
    totalAllTimeLogsCount: allValidWeightEntries.length,
    allTimeLatestWeightKg:
      allValidWeightEntries.length > 0
        ? allValidWeightEntries[allValidWeightEntries.length - 1].weightKg
        : null,
    allTimeLatestDate:
      allValidWeightEntries.length > 0
        ? allValidWeightEntries[allValidWeightEntries.length - 1]._dateKey
        : null,
    previousPeriodComparison,
    composition: {
      latestBodyFatPct,
      startingBodyFatPct,
      diffBodyFatPct,
      bodyFatEntriesCount: fatEntriesInPeriod.length,
      heightCm: validHeightCm,
      bmi,
    },
    points: bodyWeightPoints,
    comparisonWithTrainingSeries,
  };

  const volumeHorizons = computeVolumeHorizons(safeWorkouts, referenceNow);
  const multiWeekComparatives = computeMultiWeekComparatives4_8_12({
    history: safeWorkouts,
    weeklyTargetDays: targetDays,
    referenceNow,
  });

  return {
    period,
    periodLabel: current.label,
    dateRange: {
      startDate: formatLocalYYYYMMDD(current.startMs),
      endDate: formatLocalYYYYMMDD(current.endMs),
      startTimestamp: current.startMs,
      endTimestamp: current.endMs,
      daysCount: effectiveDaysInPeriod,
    },
    kpis,
    comparative,
    consistency,
    weeklyFrequencySeries,
    monthlyFrequencySeries,
    muscleBreakdown,
    exerciseSeriesMap,
    availableExercisesList,
    recordsSummary: {
      surpassedPRsInPeriodCount,
      surpassedExercisesInPeriodCount: surpassedExercisesInPeriodSet.size,
      baselineMarksInPeriodCount,
      records: unifiedRecords,
    },
    filteredHistory: currentWorkouts,
    bodyWeight,
    volumeHorizons,
    multiWeekComparatives,
  };
}

/**
 * =========================================================================================
 * LAZCAKONG GYM 7.0 — ETAPA 4: PERFORMANCE LAB PRO
 * =========================================================================================
 */

export const NON_MEDICAL_BALANCE_DISCLAIMER =
  'Análisis descriptivo de distribución de volumen y patrones de movimiento para planificación deportiva. No constituye diagnóstico de desbalances físicos, posturales ni lesiones médicas.';

/**
 * 1A. VOLUMEN SEMANAL, MENSUAL Y ANUAL (SIN DOBLE CONTEO)
 */
export function computeVolumeHorizons(
  workouts: CompletedWorkout[],
  referenceNow: Date = new Date(),
  profileId?: string
): VolumeHorizonSummary {
  const safe = sanitizeWorkoutsHistory(workouts || [], profileId).filter(
    (w) => w && w.isFinished !== false && (w.completedSetsCount || 0) > 0
  );

  const endObj = new Date(referenceNow);
  endObj.setHours(23, 59, 59, 999);
  const endMs = endObj.getTime();

  const start7d = new Date(referenceNow);
  start7d.setDate(start7d.getDate() - 6);
  start7d.setHours(0, 0, 0, 0);

  const start30d = new Date(referenceNow);
  start30d.setDate(start30d.getDate() - 29);
  start30d.setHours(0, 0, 0, 0);

  const start365d = new Date(referenceNow);
  start365d.setDate(start365d.getDate() - 364);
  start365d.setHours(0, 0, 0, 0);

  let weeklyVolumeKg = 0;
  let monthlyVolumeKg = 0;
  let annualVolumeKg = 0;
  let weeklyEffectiveSets = 0;
  let monthlyEffectiveSets = 0;
  let annualEffectiveSets = 0;
  let weeklyWorkoutsCount = 0;
  let monthlyWorkoutsCount = 0;
  let annualWorkoutsCount = 0;

  safe.forEach((w) => {
    const ts = resolveWorkoutTimestamp(w);
    if (ts <= 0 || ts > endMs) return;
    const vol = resolveWorkoutRealVolumeKg(w);
    const sets = w.completedSetsCount || 0;

    if (ts >= start7d.getTime()) {
      weeklyVolumeKg += vol;
      weeklyEffectiveSets += sets;
      weeklyWorkoutsCount += 1;
    }
    if (ts >= start30d.getTime()) {
      monthlyVolumeKg += vol;
      monthlyEffectiveSets += sets;
      monthlyWorkoutsCount += 1;
    }
    if (ts >= start365d.getTime()) {
      annualVolumeKg += vol;
      annualEffectiveSets += sets;
      annualWorkoutsCount += 1;
    }
  });

  return {
    weeklyVolumeKg: Math.round(weeklyVolumeKg),
    monthlyVolumeKg: Math.round(monthlyVolumeKg),
    annualVolumeKg: Math.round(annualVolumeKg),
    weeklyEffectiveSets,
    monthlyEffectiveSets,
    annualEffectiveSets,
    weeklyWorkoutsCount,
    monthlyWorkoutsCount,
    annualWorkoutsCount,
  };
}

/**
 * 1B. COMPARATIVAS DE 4, 8 Y 12 SEMANAS
 */
export function computeMultiWeekComparatives4_8_12({
  history = [],
  weeklyTargetDays = 4,
  referenceNow = new Date(),
  profileId,
}: {
  history: CompletedWorkout[];
  weeklyTargetDays?: number;
  referenceNow?: Date;
  profileId?: string;
}): {
  w4: MultiWeekComparativeBlock;
  w8: MultiWeekComparativeBlock;
  w12: MultiWeekComparativeBlock;
} {
  const safe = sanitizeWorkoutsHistory(history || [], profileId)
    .filter((w) => w && w.isFinished !== false && (w.completedSetsCount || 0) > 0)
    .sort((a, b) => resolveWorkoutTimestamp(a) - resolveWorkoutTimestamp(b));

  const targetDays = Math.max(1, weeklyTargetDays || 4);

  const buildHorizonBlock = (
    horizon: MultiWeekComparativeHorizon,
    weeksCount: 4 | 8 | 12
  ): MultiWeekComparativeBlock => {
    const days = weeksCount * 7;
    const endObj = new Date(referenceNow);
    endObj.setHours(23, 59, 59, 999);
    const endMs = endObj.getTime();

    const startObj = new Date(referenceNow);
    startObj.setDate(startObj.getDate() - (days - 1));
    startObj.setHours(0, 0, 0, 0);
    const startMs = startObj.getTime();

    const prevEndMs = startMs - 1;
    const prevStartObj = new Date(startObj);
    prevStartObj.setDate(prevStartObj.getDate() - days);
    prevStartObj.setHours(0, 0, 0, 0);
    const prevStartMs = prevStartObj.getTime();

    const currList = safe.filter((w) => {
      const t = resolveWorkoutTimestamp(w);
      return t >= startMs && t <= endMs;
    });
    const prevList = safe.filter((w) => {
      const t = resolveWorkoutTimestamp(w);
      return t >= prevStartMs && t <= prevEndMs;
    });

    const currVolumeKg = currList.reduce((acc, w) => acc + resolveWorkoutRealVolumeKg(w), 0);
    const prevVolumeKg = prevList.reduce((acc, w) => acc + resolveWorkoutRealVolumeKg(w), 0);

    const currSets = currList.reduce((acc, w) => acc + (w.completedSetsCount || 0), 0);
    const prevSets = prevList.reduce((acc, w) => acc + (w.completedSetsCount || 0), 0);

    const currDaysSet = new Set<string>();
    currList.forEach((w) => {
      const dk = resolveWorkoutDateKey(w);
      if (dk) currDaysSet.add(dk);
    });

    const currFreq = Number((currList.length / weeksCount).toFixed(1));
    const prevFreq = Number((prevList.length / weeksCount).toFixed(1));
    const hasPreviousBase = prevList.length > 0;

    const diffWorkouts = currList.length - prevList.length;
    const diffWorkoutsPct =
      hasPreviousBase && prevList.length > 0
        ? Math.round((diffWorkouts / prevList.length) * 100)
        : null;

    const diffVolumeKg = currVolumeKg - prevVolumeKg;
    const diffVolumePct =
      hasPreviousBase && prevVolumeKg > 0
        ? Math.round((diffVolumeKg / prevVolumeKg) * 100)
        : null;

    const routineCompliancePct =
      currList.length > 0
        ? Math.min(100, Math.round((currDaysSet.size / (weeksCount * targetDays)) * 100))
        : null;

    // Detectar PRs verificados y evolución de 1RM dentro del bloque
    const priorBest1RM = new Map<string, number>();
    const currFirst1RM = new Map<string, { name: string; val: number }>();
    const currBest1RM = new Map<string, { name: string; val: number }>();
    let verifiedPRsCount = 0;

    safe.forEach((w) => {
      const ts = resolveWorkoutTimestamp(w);
      if (ts > endMs) return;
      const inCurr = ts >= startMs && ts <= endMs;

      (w.exercisesSummary || []).forEach((ex) => {
        const iden = resolveCanonicalExerciseIdentity({
          exerciseId: ex.exerciseId,
          libraryExerciseId: ex.libraryExerciseId,
          name: ex.name,
          equipment: ex.equipment,
          muscleGroup: ex.muscleGroup,
        });
        const key = iden.canonicalKey;
        if (!key) return;
        const cleanName = iden.canonicalName || ex.name || 'Ejercicio';
        const maxW = Math.max(0, Number(ex.maxWeight) || 0);
        const reps = Math.max(1, Number(ex.maxReps) || 1);
        const est1RM =
          maxW > 0
            ? ex.estimated1RM && ex.estimated1RM > 0
              ? Math.round(ex.estimated1RM)
              : calculateEstimated1RM(maxW, reps)
            : 0;
        if (est1RM <= 0) return;

        const prevBest = priorBest1RM.get(key) || 0;
        if (inCurr) {
          if (prevBest > 0 && est1RM > prevBest) {
            verifiedPRsCount += 1;
          }
          if (!currFirst1RM.has(key)) {
            currFirst1RM.set(key, {
              name: cleanName,
              val: prevBest > 0 ? prevBest : est1RM,
            });
          }
          const curBest = currBest1RM.get(key)?.val || 0;
          if (est1RM >= curBest) {
            currBest1RM.set(key, { name: cleanName, val: est1RM });
          }
        }
        if (est1RM > prevBest) {
          priorBest1RM.set(key, est1RM);
        }
      });
    });

    const topImprovedExercises: MultiWeekComparativeBlock['topImprovedExercises'] = [];
    currBest1RM.forEach((bestObj, key) => {
      const startObj1RM = currFirst1RM.get(key);
      if (!startObj1RM || startObj1RM.val <= 0) return;
      const delta1RM = bestObj.val - startObj1RM.val;
      if (delta1RM > 0) {
        topImprovedExercises.push({
          exerciseId: key,
          exerciseName: bestObj.name,
          start1RM: startObj1RM.val,
          end1RM: bestObj.val,
          delta1RM,
          deltaPct: Number(((delta1RM / startObj1RM.val) * 100).toFixed(1)),
        });
      }
    });
    topImprovedExercises.sort((a, b) => b.delta1RM - a.delta1RM);

    return {
      horizon,
      weeksCount,
      label: `Últimas ${weeksCount} semanas`,
      hasPreviousBase,
      currentWorkouts: currList.length,
      previousWorkouts: prevList.length,
      diffWorkouts,
      diffWorkoutsPct,
      currentVolumeKg: Math.round(currVolumeKg),
      previousVolumeKg: Math.round(prevVolumeKg),
      diffVolumeKg: Math.round(diffVolumeKg),
      diffVolumePct,
      currentCompletedSets: currSets,
      previousCompletedSets: prevSets,
      diffCompletedSets: currSets - prevSets,
      currentWeeklyFrequency: currFreq,
      previousWeeklyFrequency: prevFreq,
      diffWeeklyFrequency: Number((currFreq - prevFreq).toFixed(1)),
      verifiedPRsCount,
      routineCompliancePct,
      topImprovedExercises: topImprovedExercises.slice(0, 5),
    };
  };

  return {
    w4: buildHorizonBlock('4w', 4),
    w8: buildHorizonBlock('8w', 8),
    w12: buildHorizonBlock('12w', 12),
  };
}

/**
 * Helper interno para obtener recuperación muscular actual de un ejercicio
 * reutilizando Muscle Recovery Pro (`computeRealTimeRecovery` + `resolveExerciseMuscleImpact`).
 */
function resolveExercisePrimaryRecoveryState(
  exerciseName: string,
  muscleGroup: string,
  recoveryMap: ReturnType<typeof computeRealTimeRecovery>
): { recoveryPct: number; remainingHours: number } {
  const impact = resolveExerciseMuscleImpact(exerciseName, muscleGroup);
  const primaryIds = impact.primary.length > 0 ? impact.primary : (['chest_left'] as BiometricMuscleId[]);
  let minRecoveryPct = 100;
  let maxRemainingHours = 0;

  primaryIds.forEach((mId) => {
    const st = recoveryMap[mId];
    if (st) {
      const recPct = Math.max(0, Math.min(100, Math.round(100 - st.fatigue)));
      if (recPct < minRecoveryPct) minRecoveryPct = recPct;
      const remH = st.remainingHours + st.remainingMinutes / 60;
      if (remH > maxRemainingHours) maxRemainingHours = remH;
    }
  });

  return {
    recoveryPct: minRecoveryPct,
    remainingHours: Number(maxRemainingHours.toFixed(1)),
  };
}

function parseTargetRepsNumber(repsField: number | string | undefined, fallback = 10): number {
  if (typeof repsField === 'number' && repsField > 0) return Math.round(repsField);
  if (typeof repsField === 'string') {
    const nums = repsField.match(/\d+/g);
    if (nums && nums.length > 0) {
      return Math.max(1, Number(nums[nums.length - 1]) || fallback);
    }
  }
  return fallback;
}

/**
 * 2. SOBRECARGA PROGRESIVA INTELIGENTE
 * Reutiliza progressionEngine.ts, Coach Intelligence Pro y Muscle Recovery Pro.
 * Detecta oportunidades de aumento de carga, repeticiones o volumen considerando historial, RPE, RIR y recuperación.
 * JAMÁS aplica cambios automáticamente: todas las propuestas llevan `requiresExplicitAuthorization: true`.
 */
export function evaluateIntelligentProgressiveOverload({
  routines = [],
  history = [],
  currentTime = Date.now(),
  profileId,
}: {
  routines: Routine[];
  history: CompletedWorkout[];
  currentTime?: number;
  profileId?: string;
}): ProgressiveOverloadProposal[] {
  const safeHistory = sanitizeWorkoutsHistory(history || [], profileId);
  const recoveryMap = computeRealTimeRecovery(safeHistory, currentTime, routines, 'ALL', 'ALL', {
    profileId,
  });
  const proposals: ProgressiveOverloadProposal[] = [];

  (Array.isArray(routines) ? routines : []).forEach((routine) => {
    if (!routine || !Array.isArray(routine.exercises)) return;
    const anyRoutine = routine as any;
    const dayName = routine.dayName || anyRoutine.day || routine.title || 'Rutina';

    routine.exercises.forEach((ex) => {
      if (!ex || !ex.name) return;
      const anyEx = ex as any;
      const rawMuscleGroup = String(ex.targetMuscles || anyEx.muscleGroup || '');
      const rawRepField = ex.repRange ?? anyEx.reps ?? ex.defaultReps;
      const rawDefaultWeight = Number(ex.defaultWeight ?? anyEx.targetWeight ?? 0);
      const rawDefaultSets = Number(ex.defaultSets ?? anyEx.sets ?? 0);

      const prevSessions = findPreviousExerciseSessions({
        history: safeHistory,
        exercise: {
          exerciseId: ex.id,
          libraryExerciseId: ex.libraryExerciseId,
          activeExerciseName: ex.name,
          equipment: ex.equipment,
        },
        activeProfileId: profileId,
        limit: 4,
      });

      if (prevSessions.length === 0) return;

      const latest = prevSessions[0];
      const baseWeight =
        latest.maxWeight > 0
          ? latest.maxWeight
          : rawDefaultWeight > 0
          ? rawDefaultWeight
          : 0;
      const baseReps =
        latest.maxReps > 0 ? latest.maxReps : parseTargetRepsNumber(rawRepField, 10);
      const baseSets = Math.max(1, rawDefaultSets || latest.setsCount || 3);

      const rpeSamples = prevSessions
        .map((s) => s.avgRpe)
        .filter((v): v is number => typeof v === 'number' && v > 0);
      const avgRecentRpe =
        rpeSamples.length > 0
          ? Number((rpeSamples.reduce((a, b) => a + b, 0) / rpeSamples.length).toFixed(1))
          : null;
      const avgRecentRir =
        avgRecentRpe !== null ? Number(Math.max(0, 10 - avgRecentRpe).toFixed(1)) : null;

      const { recoveryPct, remainingHours } = resolveExercisePrimaryRecoveryState(
        ex.name,
        rawMuscleGroup,
        recoveryMap
      );

      const stepInfo = resolveEquipmentProgressionStep(
        ex.name,
        ex.equipment,
        baseWeight,
        typeof rawRepField === 'string' ? rawRepField : undefined
      );
      const stepKg = stepInfo.stepKg || 2.5;
      const sig = extractEquipmentAndVariantSignature(ex.name, ex.equipment);

      let overloadType: ProgressiveOverloadProposalType = 'maintain_load';
      let proposedWeightKg = baseWeight;
      let proposedReps = baseReps;
      let proposedSets = baseSets;
      let confidenceLevel: ProgressiveOverloadProposal['confidenceLevel'] = 'moderate';
      let headline = 'Mantener carga consolidando técnica';
      let rationale = '';

      const effectiveRpe = avgRecentRpe !== null ? avgRecentRpe : 8.0;
      const targetTopReps = parseTargetRepsNumber(rawRepField, baseReps);

      if (recoveryPct < 55 || remainingHours > 24) {
        // Músculo aún fatigado -> prioridad recuperación
        overloadType = 'hold_recovery_priority';
        proposedWeightKg = baseWeight;
        proposedReps = baseReps;
        proposedSets = baseSets;
        confidenceLevel = 'conservative';
        headline = `Priorizar recuperación (${recoveryPct}% rec. · ${Math.ceil(remainingHours)}h pendientes)`;
        rationale = `El grupo muscular ${rawMuscleGroup || 'principal'} aún presenta fatiga residual estimada (${Math.ceil(
          remainingHours
        )} h restantes). Se recomienda mantener ${baseWeight} kg × ${baseReps} reps sin forzar sobrecarga hoy.`;
      } else if (baseWeight > 0 && baseReps >= targetTopReps && effectiveRpe <= 8.2 && recoveryPct >= 68) {
        // Listo para incremento de carga externa
        overloadType = 'increase_load';
        proposedWeightKg = Number((baseWeight + stepKg).toFixed(2));
        proposedReps = Math.max(1, targetTopReps);
        proposedSets = baseSets;
        confidenceLevel = prevSessions.length >= 2 && effectiveRpe <= 8.0 ? 'high' : 'moderate';
        headline = `Subir carga a ${proposedWeightKg} kg (+${stepKg} kg)`;
        rationale = `Completaste ${baseWeight} kg × ${baseReps} reps con esfuerzo controlado (${
          avgRecentRpe !== null ? `RPE ${avgRecentRpe} / RIR ${avgRecentRir}` : 'RIR estimado ≥ 2'
        }) y recuperación muscular del ${recoveryPct}%. Oportunidad óptima para progresar +${stepKg} kg.`;
      } else if (effectiveRpe <= 8.5 && recoveryPct >= 65 && baseReps < Math.max(12, targetTopReps + 2)) {
        // Doble progresión: ganar +1 repetición con la misma carga
        overloadType = 'increase_reps';
        proposedWeightKg = baseWeight;
        proposedReps = baseReps + 1;
        proposedSets = baseSets;
        confidenceLevel = 'high';
        headline = `Aumentar a ${proposedReps} repeticiones (+1 rep a ${baseWeight} kg)`;
        rationale = `Con ${baseWeight} kg y recuperación al ${recoveryPct}%, el paso biomecánico más eficiente antes de subir peso es consolidar ${proposedReps} repeticiones manteniendo tempo técnico.`;
      } else if (
        prevSessions.length >= 2 &&
        effectiveRpe <= 7.8 &&
        recoveryPct >= 78 &&
        baseSets < 5
      ) {
        // Aumento de volumen (+1 serie efectiva)
        overloadType = 'increase_volume_sets';
        proposedWeightKg = baseWeight;
        proposedReps = baseReps;
        proposedSets = baseSets + 1;
        confidenceLevel = 'moderate';
        headline = `Añadir +1 serie efectiva (${proposedSets} series × ${baseReps} reps)`;
        rationale = `Tolerancia alta de volumen (${
          avgRecentRpe !== null ? `RPE promedio ${avgRecentRpe}` : 'esfuerzo moderado'
        }) y recuperación al ${recoveryPct}%. Puedes sumar 1 serie efectiva para incrementar estímulo.`;
      } else {
        overloadType = 'maintain_load';
        headline = `Consolidar ${baseWeight} kg × ${baseReps} reps`;
        rationale = `Esfuerzo reciente ${
          avgRecentRpe !== null ? `RPE ${avgRecentRpe}` : 'cercano al límite'
        } con recuperación al ${recoveryPct}%. Mantén la carga actual perfeccionando control excéntrico.`;
      }

      const currentEstimated1RM =
        baseWeight > 0 ? calculateEstimated1RM(baseWeight, baseReps) : 0;
      const projectedEstimated1RM =
        proposedWeightKg > 0 ? calculateEstimated1RM(proposedWeightKg, proposedReps) : 0;

      proposals.push({
        id: `overload::${routine.id}::${ex.id}`,
        routineId: routine.id,
        routineTitle: routine.title || dayName,
        dayName,
        exerciseId: ex.id,
        exerciseName: ex.name,
        muscleGroup: mapToStandardMuscleCategory(rawMuscleGroup, ex.name),
        equipmentVariant: sig.equipment || 'barbell',
        currentWeightKg: baseWeight,
        proposedWeightKg,
        loadIncrementKg: Number((proposedWeightKg - baseWeight).toFixed(2)),
        currentReps: baseReps,
        proposedReps,
        currentSets: baseSets,
        proposedSets,
        currentEstimated1RM,
        projectedEstimated1RM,
        avgRecentRpe,
        avgRecentRir,
        muscleRecoveryPct: recoveryPct,
        muscleRemainingHours: remainingHours,
        overloadType,
        confidenceLevel,
        headline,
        rationale,
        requiresExplicitAuthorization: true,
      });
    });
  });

  // Ordenar priorizando oportunidades de aumento de carga, reps y volumen
  const priorityOrder: Record<ProgressiveOverloadProposalType, number> = {
    increase_load: 1,
    increase_reps: 2,
    increase_volume_sets: 3,
    hold_recovery_priority: 4,
    maintain_load: 5,
  };

  return proposals.sort(
    (a, b) =>
      priorityOrder[a.overloadType] - priorityOrder[b.overloadType] ||
      b.muscleRecoveryPct - a.muscleRecoveryPct
  );
}

/**
 * Aplica una propuesta de sobrecarga progresiva a una rutina ÚNICAMENTE cuando el atleta
 * la autoriza explícitamente en la interfaz. Conserva intactos los IDs de ejercicios.
 */
export function applyAuthorizedOverloadToRoutine(
  routine: Routine,
  proposal: ProgressiveOverloadProposal
): Routine {
  if (!routine || routine.id !== proposal.routineId) return routine;

  return {
    ...routine,
    exercises: (routine.exercises || []).map((ex) => {
      if (ex.id !== proposal.exerciseId) return ex;
      return {
        ...ex,
        id: ex.id, // Jamás modificar IDs de ejercicios existentes
        defaultWeight: proposal.proposedWeightKg,
        prevWeight: proposal.currentWeightKg,
        defaultReps: proposal.proposedReps,
        repRange: `${proposal.proposedReps} reps`,
        defaultSets: proposal.proposedSets,
      };
    }),
  };
}

/**
 * 3. DETECCIÓN DE ESTANCAMIENTO (PLATEAU DETECTION)
 * Identifica tendencias de rendimiento estable o decreciente usando sesiones comparables suficientes (>= 3).
 * Considera cambios de ejercicio o equipamiento, descanso, técnica (Technique Pro) y disponibilidad de datos.
 * Genera recomendaciones justificadas sin inventar causas.
 */
export function detectExerciseStagnation({
  routines = [],
  history = [],
  profileId,
  minComparableSessions = 3,
}: {
  routines?: Routine[];
  history: CompletedWorkout[];
  profileId?: string;
  minComparableSessions?: number;
}): ExerciseStagnationAnalysis[] {
  const safeHistory = sanitizeWorkoutsHistory(history || [], profileId).filter(
    (w) => w && w.isFinished !== false && (w.completedSetsCount || 0) > 0
  );
  const minReq = Math.max(3, minComparableSessions);

  // Recolectar ejercicios únicos desde las rutinas y el historial del atleta
  const candidateExercises = new Map<
    string,
    {
      exerciseId: string;
      canonicalKey: string;
      libraryExerciseId?: string;
      name: string;
      muscleGroup: string;
      equipment?: string;
      restSeconds?: number;
    }
  >();

  (Array.isArray(routines) ? routines : []).forEach((r) => {
    (r?.exercises || []).forEach((ex) => {
      const anyEx = ex as any;
      const rawMuscle = String(ex.targetMuscles || anyEx.muscleGroup || '');
      const iden = resolveCanonicalExerciseIdentity({
        exerciseId: ex.id,
        libraryExerciseId: ex.libraryExerciseId,
        name: ex.name,
        equipment: ex.equipment,
        muscleGroup: rawMuscle,
      });
      const key = ex.id || iden.canonicalKey;
      if (!key) return;
      candidateExercises.set(key, {
        exerciseId: ex.id || key,
        canonicalKey: iden.canonicalKey,
        libraryExerciseId: ex.libraryExerciseId,
        name: iden.canonicalName || ex.name || 'Ejercicio',
        muscleGroup: mapToStandardMuscleCategory(rawMuscle, ex.name),
        equipment: ex.equipment,
        restSeconds: ex.restSeconds,
      });
    });
  });

  safeHistory.forEach((w) => {
    (w.exercisesSummary || []).forEach((ex) => {
      const iden = resolveCanonicalExerciseIdentity({
        exerciseId: ex.exerciseId,
        libraryExerciseId: ex.libraryExerciseId,
        name: ex.name,
        equipment: ex.equipment,
        muscleGroup: ex.muscleGroup,
      });
      const key = ex.exerciseId || iden.canonicalKey;
      if (!key || candidateExercises.has(key)) return;
      // Evitar duplicar si ya existe un candidato con el mismo canonicalKey
      const alreadyByCanonical = Array.from(candidateExercises.values()).some(
        (c) => c.canonicalKey === iden.canonicalKey
      );
      if (alreadyByCanonical) return;
      candidateExercises.set(key, {
        exerciseId: ex.exerciseId || key,
        canonicalKey: iden.canonicalKey,
        libraryExerciseId: ex.libraryExerciseId,
        name: iden.canonicalName || ex.name || 'Ejercicio',
        muscleGroup: mapToStandardMuscleCategory(ex.muscleGroup, ex.name),
        equipment: ex.equipment,
      });
    });
  });

  const results: ExerciseStagnationAnalysis[] = [];

  // Ordenar historial del más antiguo al más reciente para recolectar sesiones por ejercicio
  const chronologicalWorkouts = [...safeHistory].sort(
    (a, b) => resolveWorkoutTimestamp(a) - resolveWorkoutTimestamp(b)
  );

  candidateExercises.forEach((candidate) => {
    const rawOccurrences: {
      workoutId: string;
      date: string;
      nameUsed: string;
      equipmentUsed?: string;
      maxWeightKg: number;
      maxReps: number;
      estimated1RM: number;
      volumeKg: number;
      avgRpe: number | null;
      restSeconds: number | null;
    }[] = [];

    chronologicalWorkouts.forEach((w) => {
      (w.exercisesSummary || []).forEach((ex) => {
        const iden = resolveCanonicalExerciseIdentity({
          exerciseId: ex.exerciseId,
          libraryExerciseId: ex.libraryExerciseId,
          name: ex.name,
          equipment: ex.equipment,
          muscleGroup: ex.muscleGroup,
        });
        const matchesById = Boolean(ex.exerciseId && ex.exerciseId === candidate.exerciseId);
        const matchesByCanonical = Boolean(
          iden.canonicalKey && iden.canonicalKey === candidate.canonicalKey
        );
        if (!matchesById && !matchesByCanonical) return;

        const maxW = Math.max(0, Number(ex.maxWeight) || 0);
        const reps = Math.max(1, Number(ex.maxReps) || 1);
        const est1RM =
          maxW > 0
            ? ex.estimated1RM && ex.estimated1RM > 0
              ? Math.round(ex.estimated1RM)
              : calculateEstimated1RM(maxW, reps)
            : 0;
        const vol = resolveExerciseVolumeKg(ex);

        const anyHistEx = ex as any;
        const rawSetsDetail: any[] = Array.isArray(ex.setsDetail)
          ? ex.setsDetail
          : Array.isArray(anyHistEx.setDetails)
          ? anyHistEx.setDetails
          : [];
        const setRpes = rawSetsDetail
          .map((s: any) => s?.rpe)
          .filter((r: unknown): r is number => typeof r === 'number' && r > 0);
        const avgRpe =
          setRpes.length > 0
            ? Number((setRpes.reduce((a: number, b: number) => a + b, 0) / setRpes.length).toFixed(1))
            : typeof ex.rpe === 'number' && ex.rpe > 0
            ? ex.rpe
            : null;

        rawOccurrences.push({
          workoutId: w.id,
          date: resolveWorkoutDateKey(w),
          nameUsed: ex.name || candidate.name,
          equipmentUsed: ex.equipment || candidate.equipment,
          maxWeightKg: maxW,
          maxReps: reps,
          estimated1RM: est1RM,
          volumeKg: vol,
          avgRpe,
          restSeconds: candidate.restSeconds || null,
        });
      });
    });

    const techniqueProfile = buildTechniqueProProfile({
      name: candidate.name,
      targetMuscles: candidate.muscleGroup,
      equipment: candidate.equipment,
      libraryExerciseId: candidate.libraryExerciseId,
    });
    const techniqueProCue =
      techniqueProfile.specificTips[0] ||
      'Controla la fase excéntrica y mantén estabilidad escapular/lumbar en cada repetición.';
    const techniqueProCommonMistake =
      techniqueProfile.commonMistakes[0] ||
      'Acortar el rango de movimiento o perder tensión al iniciar la fase concéntrica.';

    const totalSessionsRecorded = rawOccurrences.length;
    const latestOccurrence = rawOccurrences[rawOccurrences.length - 1];
    const latestSig = extractEquipmentAndVariantSignature(
      latestOccurrence?.nameUsed || candidate.name,
      latestOccurrence?.equipmentUsed || candidate.equipment
    );
    const equipmentSignature = `${latestSig.equipment || 'barbell'}${
      latestSig.angle ? ` · ${latestSig.angle}` : ''
    }`;

    if (totalSessionsRecorded < minReq) {
      results.push({
        exerciseId: candidate.exerciseId,
        exerciseName: candidate.name,
        muscleGroup: candidate.muscleGroup,
        equipmentSignature,
        status: 'insufficient_comparable_sessions',
        totalSessionsRecorded,
        comparableSessionsCount: totalSessionsRecorded,
        minRequiredComparableSessions: minReq,
        recent1RMValues: rawOccurrences.map((o) => o.estimated1RM),
        recentMaxWeightValues: rawOccurrences.map((o) => o.maxWeightKg),
        recentVolumeValues: rawOccurrences.map((o) => o.volumeKg),
        delta1RMPct: null,
        deltaVolumePct: null,
        avgRecentRpe: null,
        avgRestSeconds: candidate.restSeconds || null,
        techniqueProCue,
        techniqueProCommonMistake,
        justifiedRecommendation: `Datos insuficientes: solo se registran ${totalSessionsRecorded} de las ${minReq} sesiones comparables requeridas para evaluar estancamiento con rigor estadístico.`,
        suggestedAction: 'collect_more_sessions',
      });
      return;
    }

    // Verificar compatibilidad de equipamiento/variante en las últimas sesiones
    const recentWindow = rawOccurrences.slice(-Math.max(minReq, 4));
    const latestItem = recentWindow[recentWindow.length - 1];
    const latestItemSig = extractEquipmentAndVariantSignature(
      latestItem.nameUsed,
      latestItem.equipmentUsed
    );
    const compatibleRecent = recentWindow.filter((item) => {
      const itemSig = extractEquipmentAndVariantSignature(item.nameUsed, item.equipmentUsed);
      return areExerciseVariantsCompatible(latestItemSig, itemSig);
    });

    if (compatibleRecent.length < minReq) {
      results.push({
        exerciseId: candidate.exerciseId,
        exerciseName: candidate.name,
        muscleGroup: candidate.muscleGroup,
        equipmentSignature,
        status: 'equipment_or_variant_changed',
        totalSessionsRecorded,
        comparableSessionsCount: compatibleRecent.length,
        minRequiredComparableSessions: minReq,
        recent1RMValues: recentWindow.map((o) => o.estimated1RM),
        recentMaxWeightValues: recentWindow.map((o) => o.maxWeightKg),
        recentVolumeValues: recentWindow.map((o) => o.volumeKg),
        delta1RMPct: null,
        deltaVolumePct: null,
        avgRecentRpe: null,
        avgRestSeconds: candidate.restSeconds || null,
        variantChangeNote: `Se detectó cambio reciente de variante o equipamiento (${equipmentSignature}). Solo ${compatibleRecent.length} sesión(es) comparten la misma configuración mecánica.`,
        techniqueProCue,
        techniqueProCommonMistake,
        justifiedRecommendation: `Cambiaste recientemente de equipamiento o variante en ${candidate.name}. No se clasifica como estancamiento porque las palancas mecánicas no son directamente comparables; completa ${
          minReq - compatibleRecent.length
        } sesión(es) más con ${equipmentSignature}.`,
        suggestedAction: 'collect_more_sessions',
      });
      return;
    }

    const evalWindow = compatibleRecent.slice(-4);
    const firstSess = evalWindow[0];
    const lastSess = evalWindow[evalWindow.length - 1];

    const delta1RMPct =
      firstSess.estimated1RM > 0
        ? Number(
            (
              ((lastSess.estimated1RM - firstSess.estimated1RM) / firstSess.estimated1RM) *
              100
            ).toFixed(1)
          )
        : null;

    const deltaVolumePct =
      firstSess.volumeKg > 0
        ? Number(
            (((lastSess.volumeKg - firstSess.volumeKg) / firstSess.volumeKg) * 100).toFixed(1)
          )
        : null;

    const rpeValues = evalWindow
      .map((s) => s.avgRpe)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    const avgRecentRpe =
      rpeValues.length > 0
        ? Number((rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length).toFixed(1))
        : null;

    const avgRestSeconds = candidate.restSeconds || null;

    // Clasificación determinista
    const weightGain = lastSess.maxWeightKg - firstSess.maxWeightKg;
    let status: StagnationDetectionStatus = 'progressing';
    let suggestedAction: ExerciseStagnationAnalysis['suggestedAction'] = 'continue_plan';
    let justifiedRecommendation = '';

    if ((delta1RMPct !== null && delta1RMPct >= 2.0) || weightGain > 0 || (deltaVolumePct !== null && deltaVolumePct >= 6.0)) {
      status = 'progressing';
      suggestedAction = 'continue_plan';
      justifiedRecommendation = `Progresión activa verificada en ${evalWindow.length} sesiones comparables (${firstSess.maxWeightKg} kg → ${lastSess.maxWeightKg} kg, 1RM ${
        delta1RMPct !== null && delta1RMPct >= 0 ? `+${delta1RMPct}%` : `${delta1RMPct}%`
      }). Mantén la progresión actual.`;
    } else if (delta1RMPct !== null && delta1RMPct <= -4.0) {
      status = 'regression_detected';
      if (avgRecentRpe !== null && avgRecentRpe >= 8.8) {
        suggestedAction = 'deload_or_reduce_volume';
        justifiedRecommendation = `Tendencia decreciente de rendimiento (${delta1RMPct}% en 1RM estimado) acompañada de esfuerzo elevado (RPE promedio ${avgRecentRpe}) en las últimas ${evalWindow.length} sesiones. Se recomienda reducir 1 serie o aplicar descarga del 10% en carga durante 1 semana.`;
      } else if (avgRestSeconds !== null && avgRestSeconds < 90) {
        suggestedAction = 'adjust_rest_or_technique';
        justifiedRecommendation = `Descenso de rendimiento (${delta1RMPct}% en 1RM) con descanso configurado corto (${avgRestSeconds} s). Incrementa el descanso entre series a 120–150 s y revisa la ejecución técnica (${techniqueProCue}).`;
      } else {
        suggestedAction = 'adjust_rest_or_technique';
        justifiedRecommendation = `Rendimiento decreciente (${delta1RMPct}% en 1RM en ${evalWindow.length} sesiones comparables). Prioriza precisión técnica (${techniqueProCue}) y verifica recuperación del grupo ${candidate.muscleGroup} antes de forzar carga.`;
      }
    } else {
      status = 'plateau_detected';
      if (avgRecentRpe !== null && avgRecentRpe >= 9.0) {
        suggestedAction = 'deload_or_reduce_volume';
        justifiedRecommendation = `Meseta detectada en ${evalWindow.length} sesiones comparables (${lastSess.maxWeightKg} kg × ${lastSess.maxReps} reps, Δ1RM ${
          delta1RMPct ?? 0
        }%) con RPE alto (${avgRecentRpe}). Reduce fatiga acumulada recortando 1 serie o programa semana de descarga antes de intentar un nuevo salto.`;
      } else if (avgRestSeconds !== null && avgRestSeconds <= 90) {
        suggestedAction = 'adjust_rest_or_technique';
        justifiedRecommendation = `Rendimiento estable sin ganancia en ${evalWindow.length} sesiones (${lastSess.maxWeightKg} kg). Tu descanso configurado (${avgRestSeconds} s) puede limitar la resíntesis de ATP-PCr; amplíalo a 120–150 s y aplica: ${techniqueProCue}`;
      } else {
        suggestedAction = 'micro_overload';
        justifiedRecommendation = `Estancamiento de carga en ${evalWindow.length} sesiones comparables (${lastSess.maxWeightKg} kg × ${lastSess.maxReps} reps). Aplica doble progresión (+1 repetición en la primera serie manteniendo tempo ${techniqueProfile.defaultTempo.notation}) o microcarga.`;
      }
    }

    results.push({
      exerciseId: candidate.exerciseId,
      exerciseName: candidate.name,
      muscleGroup: candidate.muscleGroup,
      equipmentSignature,
      status,
      totalSessionsRecorded,
      comparableSessionsCount: evalWindow.length,
      minRequiredComparableSessions: minReq,
      recent1RMValues: evalWindow.map((o) => o.estimated1RM),
      recentMaxWeightValues: evalWindow.map((o) => o.maxWeightKg),
      recentVolumeValues: evalWindow.map((o) => o.volumeKg),
      delta1RMPct,
      deltaVolumePct,
      avgRecentRpe,
      avgRestSeconds,
      techniqueProCue,
      techniqueProCommonMistake,
      justifiedRecommendation,
      suggestedAction,
    });
  });

  const statusPriority: Record<StagnationDetectionStatus, number> = {
    regression_detected: 1,
    plateau_detected: 2,
    equipment_or_variant_changed: 3,
    progressing: 4,
    insufficient_comparable_sessions: 5,
  };

  return results.sort(
    (a, b) =>
      statusPriority[a.status] - statusPriority[b.status] ||
      b.comparableSessionsCount - a.comparableSessionsCount
  );
}

/**
 * 4. PERIODIZACIÓN DEPORTIVA (CICLOS DE 4, 8 Y 12 SEMANAS)
 * Objetivos: Fuerza, Hipertrofia, Resistencia muscular, Rendimiento deportivo, Entrenamiento combinado.
 * Permite configurar semanas de progresión y semanas de descarga sin modificar rutinas originales sin consentimiento.
 */
export const PERIODIZATION_GOAL_METADATA: Record<
  PeriodizationGoalType,
  {
    label: string;
    repRangeLabel: string;
    baseLoadPct1RM: number;
    peakLoadPct1RM: number;
    baseRpe: number;
    peakRpe: number;
    focusDescription: string;
  }
> = {
  fuerza: {
    label: 'Fuerza Máxima',
    repRangeLabel: '3–6 reps',
    baseLoadPct1RM: 80,
    peakLoadPct1RM: 90,
    baseRpe: 8.0,
    peakRpe: 9.0,
    focusDescription: 'Énfasis neural y reclutamiento de unidades motoras de alto umbral con descansos completos (2–3 min).',
  },
  hipertrofia: {
    label: 'Hipertrofia Muscular',
    repRangeLabel: '8–12 reps',
    baseLoadPct1RM: 68,
    peakLoadPct1RM: 78,
    baseRpe: 7.5,
    peakRpe: 8.5,
    focusDescription: 'Tensión mecánica sostenida y acumulación progresiva de series efectivas cercanas al fallo técnico (RIR 1–2).',
  },
  resistencia_muscular: {
    label: 'Resistencia Muscular',
    repRangeLabel: '15–20 reps',
    baseLoadPct1RM: 55,
    peakLoadPct1RM: 65,
    baseRpe: 7.0,
    peakRpe: 8.0,
    focusDescription: 'Capacidad de trabajo metabólico, tolerancia a la fatiga local y densidad de entrenamiento con descansos controlados.',
  },
  rendimiento_deportivo: {
    label: 'Rendimiento Deportivo',
    repRangeLabel: '4–8 reps (velocidad máxima)',
    baseLoadPct1RM: 72,
    peakLoadPct1RM: 85,
    baseRpe: 7.5,
    peakRpe: 8.5,
    focusDescription: 'Desarrollo de potencia, tasa de producción de fuerza (RFD) y transferencia atlética evitando fatiga excesiva.',
  },
  combinado: {
    label: 'Entrenamiento Combinado',
    repRangeLabel: '5–8 / 10–12 reps',
    baseLoadPct1RM: 72,
    peakLoadPct1RM: 84,
    baseRpe: 7.5,
    peakRpe: 8.5,
    focusDescription: 'Sinergia fuerza-hipertrofia combinando básicos pesados al inicio de la sesión con trabajo accesorio de volumen.',
  },
};

export function createPeriodizationMesocyclePlan({
  profileId,
  goal = 'hipertrofia',
  durationWeeks = 4,
  customName,
  deloadWeeks,
  now = Date.now(),
}: {
  profileId: string;
  goal: PeriodizationGoalType;
  durationWeeks: PeriodizationDurationWeeks;
  customName?: string;
  deloadWeeks?: number[];
  now?: number;
}): PeriodizationMesocyclePlan {
  const safeProfileId = (profileId || 'default').trim();
  const meta = PERIODIZATION_GOAL_METADATA[goal] || PERIODIZATION_GOAL_METADATA.hipertrofia;

  // Por defecto: semana 4 en ciclo de 4 sem; semana 4 y 8 en 8 sem; semana 4, 8 y 12 en 12 sem
  const defaultDeloadSet = new Set<number>(
    Array.isArray(deloadWeeks) && deloadWeeks.length > 0
      ? deloadWeeks
      : durationWeeks === 4
      ? [4]
      : durationWeeks === 8
      ? [4, 8]
      : [4, 8, 12]
  );

  const weeks: PeriodizationWeekConfig[] = [];

  for (let w = 1; w <= durationWeeks; w++) {
    const isDeload = defaultDeloadSet.has(w);
    const blockIndex = ((w - 1) % 4) + 1; // Posición 1..4 dentro del bloque de 4 semanas

    let phase: PeriodizationPhaseType = 'acumulacion';
    let phaseLabel = 'Progresión · Acumulación';
    let targetRpe = meta.baseRpe;
    let setsMultiplier = 1.0;
    let loadIntensityPct1RM = meta.baseLoadPct1RM;
    let coachFocusNote = '';

    if (isDeload) {
      phase = 'descarga';
      phaseLabel = 'Semana de Descarga';
      targetRpe = Number(Math.max(6.0, meta.baseRpe - 1.5).toFixed(1));
      setsMultiplier = 0.65;
      loadIntensityPct1RM = Math.max(50, meta.baseLoadPct1RM - 10);
      coachFocusNote =
        'Reducción programada de volumen (-35% series) e intensidad para disipar fatiga acumulada y supercompensar.';
    } else if (blockIndex === 1) {
      phase = 'acumulacion';
      phaseLabel = 'Progresión · Base';
      targetRpe = meta.baseRpe;
      setsMultiplier = 1.0;
      loadIntensityPct1RM = meta.baseLoadPct1RM;
      coachFocusNote = `Establecer línea base técnica en rango ${meta.repRangeLabel} con margen RIR ${Number(
        (10 - targetRpe).toFixed(1)
      )}.`;
    } else if (blockIndex === 2) {
      phase = 'intensificacion';
      phaseLabel = 'Progresión · Sobrecarga';
      targetRpe = Number(Math.min(9.0, meta.baseRpe + 0.5).toFixed(1));
      setsMultiplier = 1.08;
      loadIntensityPct1RM = Math.round((meta.baseLoadPct1RM + meta.peakLoadPct1RM) / 2);
      coachFocusNote =
        'Incrementar carga (+2.5%) o añadir +1 repetición por serie en ejercicios principales.';
    } else {
      phase = 'realizacion';
      phaseLabel = 'Progresión · Pico de Bloque';
      targetRpe = meta.peakRpe;
      setsMultiplier = 1.15;
      loadIntensityPct1RM = meta.peakLoadPct1RM;
      coachFocusNote =
        'Semana de máximo estímulo del bloque antes de la descarga. Prioriza recuperación y descanso entre series.';
    }

    const targetRir = Number(Math.max(0.5, 10 - targetRpe).toFixed(1));

    weeks.push({
      weekNumber: w,
      phase,
      phaseLabel,
      isDeloadWeek: isDeload,
      targetRpe,
      targetRir,
      setsMultiplier,
      loadIntensityPct1RM,
      repRangeLabel: meta.repRangeLabel,
      coachFocusNote,
    });
  }

  return {
    id: `mesocycle::${safeProfileId}::${durationWeeks}w::${goal}`,
    profileId: safeProfileId,
    name: customName?.trim() || `Mesociclo ${meta.label} (${durationWeeks} Semanas)`,
    goal,
    goalLabel: meta.label,
    durationWeeks,
    currentWeekNumber: 1,
    createdAt: now,
    updatedAt: now,
    weeks,
    preservesOriginalRoutines: true,
  };
}

/**
 * Alterna cualquier semana del mesociclo entre semana de progresión y semana de descarga.
 */
export function togglePeriodizationDeloadWeek(
  plan: PeriodizationMesocyclePlan,
  weekNumber: number,
  now: number = Date.now()
): PeriodizationMesocyclePlan {
  const currentDeloads = new Set<number>();
  plan.weeks.forEach((w) => {
    if (w.isDeloadWeek) currentDeloads.add(w.weekNumber);
  });

  if (currentDeloads.has(weekNumber)) {
    currentDeloads.delete(weekNumber);
  } else {
    currentDeloads.add(weekNumber);
  }

  const rebuilt = createPeriodizationMesocyclePlan({
    profileId: plan.profileId,
    goal: plan.goal,
    durationWeeks: plan.durationWeeks,
    customName: plan.name,
    deloadWeeks: Array.from(currentDeloads),
    now,
  });

  return {
    ...rebuilt,
    id: plan.id,
    createdAt: plan.createdAt,
    currentWeekNumber: Math.min(plan.currentWeekNumber, plan.durationWeeks),
    updatedAt: now,
  };
}

function getPeriodizationStorageKey(profileId: string): string {
  const safeId = (profileId || 'default').trim();
  return `lazcakong_periodization_plan_v1_${safeId}`;
}

export function savePeriodizationMesocyclePlan(
  plan: PeriodizationMesocyclePlan,
  storage: CoachPlatformStorageAdapter = getDefaultRecoveryStorageAdapter()
): void {
  if (!plan || !plan.profileId) return;
  const key = getPeriodizationStorageKey(plan.profileId);
  storage.setItem(key, JSON.stringify(plan));
}

export function loadPeriodizationMesocyclePlan(
  profileId: string,
  storage: CoachPlatformStorageAdapter = getDefaultRecoveryStorageAdapter()
): PeriodizationMesocyclePlan | null {
  if (!profileId) return null;
  const key = getPeriodizationStorageKey(profileId);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PeriodizationMesocyclePlan;
    if (!parsed || parsed.profileId !== profileId || !Array.isArray(parsed.weeks)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Aplica los parámetros de una semana del mesociclo a una rutina ÚNICAMENTE bajo autorización explícita del atleta.
 * Jamás altera los IDs de los ejercicios ni sobrescribe rutinas sin consentimiento.
 */
export function applyAuthorizedPeriodizationWeekToRoutine(
  routine: Routine,
  weekConfig: PeriodizationWeekConfig
): Routine {
  if (!routine || !weekConfig) return routine;

  return {
    ...routine,
    exercises: (routine.exercises || []).map((ex) => {
      const anyEx = ex as any;
      const baseSets = Math.max(1, Number(ex.defaultSets ?? anyEx.sets) || 3);
      const adjustedSets = weekConfig.isDeloadWeek
        ? Math.max(2, Math.round(baseSets * weekConfig.setsMultiplier))
        : Math.max(1, Math.min(6, Math.round(baseSets * weekConfig.setsMultiplier)));

      const baseWeight = Number(ex.defaultWeight ?? anyEx.targetWeight ?? 0);
      const adjustedWeight =
        baseWeight > 0 && weekConfig.isDeloadWeek
          ? Number((Math.round((baseWeight * 0.88) / 2.5) * 2.5).toFixed(1))
          : baseWeight;

      return {
        ...ex,
        id: ex.id,
        defaultSets: adjustedSets,
        defaultWeight: adjustedWeight > 0 ? adjustedWeight : ex.defaultWeight,
      };
    }),
  };
}

/**
 * 5. BALANCE MUSCULAR INTEGRADO CON MUSCLE RECOVERY PRO
 * Analiza volumen por grupo muscular, participación primaria y secundaria, frecuencia semanal,
 * patrones de empuje y tracción, y recuperación estimada.
 * Incluye descargo explícito: no diagnostica desbalances físicos ni lesiones médicas.
 */
export function computeMuscleBalanceReport({
  history = [],
  periodDays = 28,
  currentTime = Date.now(),
  profileId,
}: {
  history: CompletedWorkout[];
  periodDays?: number;
  currentTime?: number;
  profileId?: string;
}): MuscleBalanceReport {
  const safeDays = Math.max(7, periodDays || 28);
  const weeksInWindow = Math.max(1, safeDays / 7);
  const safeHistory = sanitizeWorkoutsHistory(history || [], profileId).filter(
    (w) => w && w.isFinished !== false && (w.completedSetsCount || 0) > 0
  );

  const startMs = currentTime - safeDays * 24 * 60 * 60 * 1000;
  const windowWorkouts = safeHistory.filter((w) => {
    const ts = resolveWorkoutTimestamp(w);
    return ts >= startMs && ts <= currentTime;
  });

  const recoveryMap = computeRealTimeRecovery(safeHistory, currentTime, [], 'ALL', 'ALL', {
    profileId,
  });

  const patternByCategory: Record<StandardMuscleCategory, MuscleMovementPattern> = {
    Pectoral: 'push',
    Hombros: 'push',
    Tríceps: 'push',
    Dorsal: 'pull',
    Bíceps: 'pull',
    Cuádriceps: 'lower_anterior',
    Isquiosurales: 'lower_posterior',
    Glúteos: 'lower_posterior',
    Gemelos: 'lower_posterior',
    Core: 'core',
  };

  const accMap = new Map<
    StandardMuscleCategory,
    {
      primarySets: number;
      secondarySets: number;
      primaryVolKg: number;
      secondaryVolKg: number;
      activeDays: Set<string>;
    }
  >();

  STANDARD_MUSCLE_CATEGORIES.forEach((cat) => {
    accMap.set(cat, {
      primarySets: 0,
      secondarySets: 0,
      primaryVolKg: 0,
      secondaryVolKg: 0,
      activeDays: new Set<string>(),
    });
  });

  windowWorkouts.forEach((w) => {
    const dKey = resolveWorkoutDateKey(w);
    (w.exercisesSummary || []).forEach((ex) => {
      const sets = Math.max(0, Number(ex.sets) || 0);
      if (sets <= 0) return;
      const vol = resolveExerciseVolumeKg(ex);

      const impact = resolveExerciseMuscleImpact(ex.name, ex.muscleGroup);

      // Categorías primarias (100% de las series efectivas, sin duplicar entre lados izquierdo/derecho del mismo grupo)
      const primaryCategories = new Set<StandardMuscleCategory>();
      impact.primary.forEach((bioId) => {
        const cfg = MUSCLE_CONFIG[bioId];
        if (cfg) primaryCategories.add(cfg.standardCategory);
      });
      if (primaryCategories.size === 0) {
        primaryCategories.add(mapToStandardMuscleCategory(ex.muscleGroup, ex.name));
      }

      primaryCategories.forEach((cat) => {
        const bucket = accMap.get(cat);
        if (bucket) {
          bucket.primarySets += sets;
          bucket.primaryVolKg += vol;
          if (dKey) bucket.activeDays.add(dKey);
        }
      });

      // Categorías secundarias / sinergistas (ponderadas según su peso biomecánico 0.20 - 0.60, sin duplicar izq/der)
      const secondaryWeightsByCat = new Map<StandardMuscleCategory, number>();
      impact.synergists.forEach((syn) => {
        const cfg = MUSCLE_CONFIG[syn.id];
        if (!cfg || primaryCategories.has(cfg.standardCategory)) return;
        const prevW = secondaryWeightsByCat.get(cfg.standardCategory) || 0;
        if (syn.weight > prevW) {
          secondaryWeightsByCat.set(cfg.standardCategory, syn.weight);
        }
      });

      secondaryWeightsByCat.forEach((weight, cat) => {
        const bucket = accMap.get(cat);
        if (bucket) {
          bucket.secondarySets = Number((bucket.secondarySets + sets * weight).toFixed(1));
          bucket.secondaryVolKg = Math.round(bucket.secondaryVolKg + vol * weight);
          if (dKey) bucket.activeDays.add(dKey);
        }
      });
    });
  });

  // Calcular recuperación promedio por categoría estándar
  const recoveryByCategory = new Map<
    StandardMuscleCategory,
    { recoveryPct: number; remainingHours: number }
  >();
  STANDARD_MUSCLE_CATEGORIES.forEach((cat) => {
    const bioIds = (Object.keys(MUSCLE_CONFIG) as BiometricMuscleId[]).filter(
      (id) => MUSCLE_CONFIG[id].standardCategory === cat
    );
    let minRec = 100;
    let maxRem = 0;
    bioIds.forEach((id) => {
      const st = recoveryMap[id];
      if (st) {
        const rec = Math.max(0, Math.min(100, Math.round(100 - st.fatigue)));
        if (rec < minRec) minRec = rec;
        const rem = st.remainingHours + st.remainingMinutes / 60;
        if (rem > maxRem) maxRem = rem;
      }
    });
    recoveryByCategory.set(cat, {
      recoveryPct: minRec,
      remainingHours: Number(maxRem.toFixed(1)),
    });
  });

  let grandTotalEffectiveSets = 0;
  accMap.forEach((b) => {
    grandTotalEffectiveSets += b.primarySets + b.secondarySets;
  });

  let pushSets = 0;
  let pullSets = 0;
  let upperBodySets = 0;
  let lowerBodySets = 0;

  const muscleGroups: MuscleGroupBalanceItem[] = STANDARD_MUSCLE_CATEGORIES.map((cat) => {
    const b = accMap.get(cat)!;
    const totalEffectiveSets = Number((b.primarySets + b.secondarySets).toFixed(1));
    const shareOfTotalSetsPct =
      grandTotalEffectiveSets > 0
        ? Math.round((totalEffectiveSets / grandTotalEffectiveSets) * 100)
        : 0;
    const rec = recoveryByCategory.get(cat) || { recoveryPct: 100, remainingHours: 0 };
    const movementPattern = patternByCategory[cat];

    if (movementPattern === 'push') {
      pushSets += totalEffectiveSets;
      upperBodySets += totalEffectiveSets;
    } else if (movementPattern === 'pull') {
      pullSets += totalEffectiveSets;
      upperBodySets += totalEffectiveSets;
    } else if (
      movementPattern === 'lower_anterior' ||
      movementPattern === 'lower_posterior'
    ) {
      lowerBodySets += totalEffectiveSets;
    }

    let statusLabel: MuscleGroupBalanceItem['statusLabel'] = 'equilibrado';
    if (rec.recoveryPct < 60 || rec.remainingHours > 18) {
      statusLabel = 'en_recuperacion';
    } else if (grandTotalEffectiveSets > 0 && shareOfTotalSetsPct >= 24) {
      statusLabel = 'dominante';
    } else if (grandTotalEffectiveSets > 0 && totalEffectiveSets < 2) {
      statusLabel = 'subentrenado';
    }

    return {
      muscleGroup: cat,
      primaryEffectiveSets: b.primarySets,
      secondaryWeightedSets: b.secondarySets,
      totalEffectiveSets,
      primaryVolumeKg: Math.round(b.primaryVolKg),
      secondaryWeightedVolumeKg: Math.round(b.secondaryVolKg),
      weeklyFrequency: Number((b.activeDays.size / weeksInWindow).toFixed(1)),
      currentRecoveryPct: rec.recoveryPct,
      remainingRecoveryHours: rec.remainingHours,
      shareOfTotalSetsPct,
      movementPattern,
      statusLabel,
    };
  }).sort((a, b) => b.totalEffectiveSets - a.totalEffectiveSets);

  pushSets = Number(pushSets.toFixed(1));
  pullSets = Number(pullSets.toFixed(1));
  upperBodySets = Number(upperBodySets.toFixed(1));
  lowerBodySets = Number(lowerBodySets.toFixed(1));

  const pushPullRatio =
    pullSets > 0 ? Number((pushSets / pullSets).toFixed(2)) : pushSets > 0 ? 2.0 : null;
  let pushPullStatus: MuscleBalanceReport['pushPullStatus'] = 'sin_datos';
  if (pushSets === 0 && pullSets === 0) {
    pushPullStatus = 'sin_datos';
  } else if (pushPullRatio !== null && pushPullRatio > 1.35) {
    pushPullStatus = 'dominancia_empuje';
  } else if (pushPullRatio !== null && pushPullRatio < 0.75) {
    pushPullStatus = 'dominancia_traccion';
  } else {
    pushPullStatus = 'equilibrado';
  }

  const upperLowerRatio =
    lowerBodySets > 0
      ? Number((upperBodySets / lowerBodySets).toFixed(2))
      : upperBodySets > 0
      ? 2.0
      : null;
  let upperLowerStatus: MuscleBalanceReport['upperLowerStatus'] = 'sin_datos';
  if (upperBodySets === 0 && lowerBodySets === 0) {
    upperLowerStatus = 'sin_datos';
  } else if (upperLowerRatio !== null && upperLowerRatio > 1.8) {
    upperLowerStatus = 'dominancia_superior';
  } else if (upperLowerRatio !== null && upperLowerRatio < 0.65) {
    upperLowerStatus = 'dominancia_inferior';
  } else {
    upperLowerStatus = 'equilibrado';
  }

  const planningObservations: string[] = [];
  if (windowWorkouts.length === 0) {
    planningObservations.push(
      'Sin sesiones registradas en la ventana analizada. Completa entrenamientos para evaluar la distribución entre patrones de movimiento.'
    );
  } else {
    if (pushPullStatus === 'dominancia_empuje') {
      planningObservations.push(
        `El volumen de Empuje (${pushSets} series) supera al de Tracción (${pullSets} series, ratio ${pushPullRatio}:1). En la planificación deportiva puede ser útil priorizar remos o tracciones verticales la próxima semana.`
      );
    } else if (pushPullStatus === 'dominancia_traccion') {
      planningObservations.push(
        `El volumen de Tracción (${pullSets} series) supera al de Empuje (${pushSets} series, ratio ${pushPullRatio}:1). Distribución favorable para estabilidad escapular; puedes incrementar series de press si buscas foco en empuje.`
      );
    } else {
      planningObservations.push(
        `Equilibrio sólido en patrones de Empuje (${pushSets} ser.) vs Tracción (${pullSets} ser., ratio ${pushPullRatio}:1).`
      );
    }

    const underTrained = muscleGroups
      .filter((m) => m.totalEffectiveSets === 0)
      .map((m) => m.muscleGroup);
    if (underTrained.length > 0 && underTrained.length <= 5) {
      planningObservations.push(
        `Grupos con menor frecuencia en tu programación reciente: ${underTrained.join(', ')}.`
      );
    }
  }

  return {
    generatedAt: currentTime,
    periodDays: safeDays,
    nonMedicalDisclaimer: NON_MEDICAL_BALANCE_DISCLAIMER,
    pushSets,
    pullSets,
    pushPullRatio,
    pushPullStatus,
    upperBodySets,
    lowerBodySets,
    upperLowerRatio,
    upperLowerStatus,
    muscleGroups,
    planningObservations,
  };
}

/**
 * 6. INFORME SEMANAL INTELIGENTE (CON INTEGRACIÓN DE VOZ COACH INTELLIGENCE PRO)
 * Genera un resumen semanal automático local:
 * - Entrenamientos completados, volumen acumulado, PRs logrados, evolución vs semana previa,
 *   cumplimiento de objetivos, músculos más trabajados y recomendaciones para la siguiente semana.
 */
export function generateSmartWeeklyPerformanceReport({
  history = [],
  routines = [],
  activeProfile,
  currentTime = Date.now(),
}: {
  history: CompletedWorkout[];
  routines?: Routine[];
  activeProfile?: Partial<Profile> | null;
  currentTime?: number;
}): SmartWeeklyPerformanceReport {
  const profileId = activeProfile?.id || 'default';
  const targetWorkoutsCount = Math.max(1, Number(activeProfile?.weeklyTargetDays) || 4);

  const report7d = computeElitePerformanceAnalytics({
    history,
    routines,
    period: '7d',
    weeklyTargetDays: targetWorkoutsCount,
    profileId: activeProfile?.id,
    referenceNow: new Date(currentTime),
  });

  const completedWorkoutsCount = report7d.kpis.totalWorkouts;
  const routineCompliancePct = Math.min(
    100,
    Math.round((completedWorkoutsCount / targetWorkoutsCount) * 100)
  );
  const accumulatedVolumeKg = report7d.kpis.totalVolumeKg;
  const previousWeekVolumeKg = report7d.comparative.prevVolumeKg;
  const volumeDeltaPct = report7d.comparative.diffVolumePct;
  const completedSetsCount = report7d.kpis.totalCompletedSets;

  const prsAchievedList = report7d.recordsSummary.records
    .filter((r) => r.hasVerifiedNewRecordInPeriod)
    .slice(0, 5)
    .map((r) => ({
      exerciseName: r.exerciseName,
      weightKg: r.bestWeightKg,
      reps: r.bestWeightReps,
      estimated1RM: r.best1RM,
    }));

  const mostTrainedMuscles = report7d.muscleBreakdown
    .filter((m) => m.sets > 0 || m.volumeKg > 0)
    .slice(0, 3)
    .map((m) => ({
      muscleGroup: m.muscle,
      effectiveSets: m.sets,
      volumeKg: m.volumeKg,
    }));

  let performanceEvolutionSummary = '';
  if (completedWorkoutsCount === 0) {
    performanceEvolutionSummary =
      'Sin entrenamientos registrados en los últimos 7 días. Retoma tu planificación con cargas conservadoras (RPE 7–7.5) para reactivar estímulo.';
  } else if (volumeDeltaPct !== null) {
    performanceEvolutionSummary = `Completaste ${completedWorkoutsCount} de ${targetWorkoutsCount} sesiones objetivo (${routineCompliancePct}% cumplimiento), acumulando ${accumulatedVolumeKg.toLocaleString()} kg (${
      volumeDeltaPct >= 0 ? `+${volumeDeltaPct}%` : `${volumeDeltaPct}%`
    } respecto a la semana anterior) y ${
      report7d.recordsSummary.surpassedPRsInPeriodCount
    } récord(s) superado(s).`;
  } else {
    performanceEvolutionSummary = `Completaste ${completedWorkoutsCount} de ${targetWorkoutsCount} sesiones objetivo (${routineCompliancePct}% cumplimiento) con un volumen total de ${accumulatedVolumeKg.toLocaleString()} kg en ${completedSetsCount} series efectivas.`;
  }

  const overloadProposals = evaluateIntelligentProgressiveOverload({
    routines,
    history,
    currentTime,
    profileId: activeProfile?.id,
  });
  const balance = computeMuscleBalanceReport({
    history,
    periodDays: 14,
    currentTime,
    profileId: activeProfile?.id,
  });

  const nextWeekRecommendations: string[] = [];

  if (completedWorkoutsCount < targetWorkoutsCount) {
    nextWeekRecommendations.push(
      `Priorizar consistencia: programa ${targetWorkoutsCount} sesiones la próxima semana (${
        targetWorkoutsCount - completedWorkoutsCount
      } sesión(es) pendiente(s) respecto a tu meta actual).`
    );
  } else {
    nextWeekRecommendations.push(
      `Meta semanal cumplida al ${routineCompliancePct}%. Mantén la distribución actual de días de descanso.`
    );
  }

  const loadCandidate = overloadProposals.find((p) => p.overloadType === 'increase_load');
  if (loadCandidate) {
    nextWeekRecommendations.push(
      `Oportunidad de sobrecarga: autoriza subir ${loadCandidate.exerciseName} a ${loadCandidate.proposedWeightKg} kg (+${loadCandidate.loadIncrementKg} kg) si te sientes recuperado.`
    );
  }

  if (balance.planningObservations.length > 0) {
    nextWeekRecommendations.push(balance.planningObservations[0]);
  }

  const athleteName = activeProfile?.name || 'Atleta';
  const topMusclesVoice =
    mostTrainedMuscles.length > 0
      ? `Los grupos más trabajados fueron ${mostTrainedMuscles
          .map((m) => `${m.muscleGroup} con ${m.effectiveSets} series`)
          .join(', ')}.`
      : '';

  const coachVoiceText =
    completedWorkoutsCount > 0
      ? `Informe semanal de ${athleteName}. Completaste ${completedWorkoutsCount} entrenamientos con ${routineCompliancePct} por ciento de cumplimiento y un volumen acumulado de ${accumulatedVolumeKg} kilos. Lograste ${
          report7d.recordsSummary.surpassedPRsInPeriodCount
        } récords personales verificados. ${topMusclesVoice} Recomendación para la próxima semana: ${
          nextWeekRecommendations[0] || 'Mantener progresión controlada.'
        }`
      : `Informe semanal de ${athleteName}. Esta semana aún no registras sesiones completadas. Inicia tu próxima rutina con intensidad moderada para retomar el ritmo.`;

  return {
    generatedAt: currentTime,
    profileId,
    weekStartDate: report7d.dateRange.startDate,
    weekEndDate: report7d.dateRange.endDate,
    completedWorkoutsCount,
    targetWorkoutsCount,
    routineCompliancePct,
    accumulatedVolumeKg,
    previousWeekVolumeKg,
    volumeDeltaPct,
    completedSetsCount,
    prsAchievedCount: report7d.recordsSummary.surpassedPRsInPeriodCount,
    prsAchievedList,
    mostTrainedMuscles,
    performanceEvolutionSummary,
    nextWeekRecommendations,
    coachVoiceText,
  };
}

