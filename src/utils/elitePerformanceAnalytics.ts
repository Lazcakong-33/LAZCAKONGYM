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

import { CompletedWorkout, Routine, PersonalRecord, BodyWeightEntry } from '../types';
import {
  mapToStandardMuscleCategory,
  StandardMuscleCategory,
  STANDARD_MUSCLE_CATEGORIES,
  normalizeText,
} from './workoutAnalyticsEngine';

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
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.trim())) {
    return d.trim().slice(0, 10);
  }
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  const d = new Date(ts);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  const weekKey = formatLocalYYYYMMDD(monday);
  const weekLabel = monday.toLocaleDateString('es-ES', {
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
  if (w.date && /^\d{4}-\d{2}-\d{2}/.test(w.date.trim())) {
    return w.date.trim().slice(0, 10);
  }
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
}: {
  history: CompletedWorkout[];
  routines?: Routine[];
  prs?: Record<string, PersonalRecord>;
  bodyWeightLogs?: BodyWeightEntry[];
  period: PerformancePeriodFilter;
  weeklyTargetDays?: number;
  athleteHeightCm?: number;
}): ElitePerformanceReport {
  const { current, previous } = resolvePeriodInterval(period);

  // 1. Filtrar sesiones terminadas y deduplicar estrictamente por ID único de sesión
  const seenWorkoutIds = new Set<string>();
  const safeWorkouts = (Array.isArray(history) ? history : [])
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
      const cleanName = ex.name?.trim() || 'Ejercicio';
      const key = normalizeText(cleanName);
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
    const key = normalizeText(pr.exerciseName);
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

      const dObj = new Date(ts);
      const mKey = `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, '0')}`;
      const mLabel = dObj.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
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
      const exKey = normalizeText(ex.name);
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
  };
}
