import type { Request, Response } from 'express';

/**
 * ============================================================================
 * LAZCAKONGYM - BACKEND DAILY CALORIE & WORKOUT HISTORY SANITIZER CONTROLLER
 * ============================================================================
 * Directrices Estrictas:
 * 1. UNICIDAD POR FECHA ('YYYY-MM-DD') Y TIEMPO REAL (45 A 120 MIN MÁXIMO):
 *    - Cada registro por fecha ('YYYY-MM-DD') es único e independiente.
 *    - Se bloquea cualquier acumulación repetitiva de minutos o concatenación
 *      de nombres de días en una misma fecha.
 *    - Si una sesión presenta un tiempo corrupto (> 120 min, ej. 1201 o 6115 min),
 *      se recalcula automáticamente en base a las series verdaderamente
 *      marcadas como completadas dentro del rango de 45 a 120 minutos máximo.
 *
 * 2. REPORTE TOTAL DIARIO (24 HORAS DEL DÍA ACTUAL):
 *    - Informa únicamente el total de calorías quemadas en las 24h del día actual.
 *    - El contador inicia en cero (0 kcal) cada día.
 *
 * 3. FILTRADO LIMPIO Y SCRIPT DE PURGA (DATA PURGE):
 *    - Renderiza 1 sola línea limpia por fecha:
 *      [Fecha] -> [Nombre de la Rutina Realizada ese día] | [Tiempo Real en min] | [Kilos totales]
 */

export type ActivityCategory =
  | 'fuerza_moderada'
  | 'fuerza_vigorosa'
  | 'cardio_eliptica'
  | 'cardio_caminata'
  | 'cardio_bicicleta'
  | 'cardio_hiit';

export const MET_VALUES: Record<ActivityCategory, number> = {
  fuerza_moderada: 5.0,
  fuerza_vigorosa: 6.0,
  cardio_eliptica: 6.5,
  cardio_caminata: 4.3,
  cardio_bicicleta: 7.5,
  cardio_hiit: 8.0,
};

const WEEKDAY_NAMES_ES: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
};

export interface WorkoutRecordInput {
  id: string;
  routineId: string;
  routineTitle: string;
  date: string;
  startTime?: number;
  endTime?: number;
  durationSeconds: number;
  totalVolumeKg?: number;
  completedSetsCount: number;
  isFinished: boolean;
  avgRpe?: number;
  caloriesBurned?: number;
  exercisesSummary?: {
    exerciseId?: string;
    name: string;
    sets: number;
    maxWeight?: number;
    maxReps?: number;
    volumeKg?: number;
    muscleGroup?: string;
    estimated1RM?: number;
    rpe?: number;
    completed?: boolean;
    durationSeconds?: number;
  }[];
}

export interface AthleteBiometricsInput {
  id: string;
  name?: string;
  weightKg: number;
}

export interface DailySessionCalorieDetail {
  workoutId: string;
  routineTitle: string;
  dateKey: string;
  timestamp: string;
  durationMinutes: number;
  totalVolumeKg: number;
  appliedMet: number;
  athleteWeightKg: number;
  completedBlocksCount: number;
  caloriesBurned: number;
}

export interface IsolatedDailyCalorieSummary {
  dateKey: string; // 'YYYY-MM-DD'
  routineTitle: string; // Nombre único limpio de la rutina de ese día
  dailyCaloriesBurned: number;
  completedWorkoutsCount: number; // Estrictamente 1 por fecha
  totalDurationMinutes: number;   // Estrictamente 45 - 120 min máx
  totalVolumeKg: number;          // Kilos totales movidos ese día
  athleteWeightKg: number;
  sessions: DailySessionCalorieDetail[];
}

export interface DailyCaloriesReportResponse {
  success: boolean;
  dateKey: string;
  dailyCaloriesBurned: number;
  athleteWeightKg: number;
  totalDurationMinutesToday: number;
  completedWorkoutsToday: number;
  todaySessions: DailySessionCalorieDetail[];
  isolatedDailyHistory: IsolatedDailyCalorieSummary[];
}

export function toIsolatedDateKey(
  dateInput: string | number | Date,
  timezoneOffsetMinutes?: number
): string {
  const dateObj = new Date(dateInput);
  if (isNaN(dateObj.getTime())) {
    return '';
  }

  if (typeof timezoneOffsetMinutes === 'number' && !isNaN(timezoneOffsetMinutes)) {
    const localMs = dateObj.getTime() - timezoneOffsetMinutes * 60 * 1000;
    const localDate = new Date(localMs);
    const year = localDate.getUTCFullYear();
    const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(localDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Trunca cualquier string repetitivo de nombres de días concatenados
 * y normaliza el título de la rutina al día real correspondiente a la fecha.
 */
export function cleanCorruptedRoutineTitle(rawTitle: string | undefined, dateInput: string): string {
  const d = new Date(dateInput);
  const actualDay = !isNaN(d.getTime()) ? WEEKDAY_NAMES_ES[d.getDay()] || 'Entrenamiento' : 'Entrenamiento';

  if (!rawTitle || typeof rawTitle !== 'string') {
    return `Rutina ${actualDay}`;
  }

  // Tomar únicamente el primer segmento antes de comas o separadores repetidos
  let clean = rawTitle.split(/[,;|]+/).map((s) => s.trim()).filter(Boolean)[0] || rawTitle.trim();

  // Detectar si tiene múltiples nombres de días concatenados
  const dayMatches = clean.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi);
  if (dayMatches && dayMatches.length > 1) {
    clean = `Rutina ${actualDay}`;
  }

  if (/^rutina\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$/i.test(clean)) {
    clean = `Rutina ${actualDay}`;
  }

  return clean.slice(0, 80).trim() || `Rutina ${actualDay}`;
}

/**
 * Recalcula el tiempo real en minutos basado en las series completadas,
 * acotando cualquier valor corrupto (ej. 1201 min o 6115 min) al rango real de 45 a 120 min máx.
 */
export function normalizeDurationMinutes(
  rawDurationSeconds: number | undefined,
  completedSetsCount: number
): number {
  const MIN_MINUTES = 45;
  const MAX_MINUTES = 120;

  const estimatedFromSetsMinutes = Math.min(
    MAX_MINUTES,
    Math.max(MIN_MINUTES, Math.round(Math.max(1, completedSetsCount) * 3.5))
  );

  const rawMinutes = Math.round((Number(rawDurationSeconds) || 0) / 60);

  if (rawMinutes <= 0 || rawMinutes > MAX_MINUTES) {
    return estimatedFromSetsMinutes;
  }

  if (rawMinutes < MIN_MINUTES && completedSetsCount >= 12) {
    return estimatedFromSetsMinutes;
  }

  return rawMinutes;
}

export function resolveActivityMet(
  name: string = '',
  muscleGroup: string = '',
  rpe: number = 8
): number {
  const normalized = `${name} ${muscleGroup}`.toLowerCase().trim();

  if (normalized.includes('elíptica') || normalized.includes('eliptica') || normalized.includes('elliptical')) {
    return MET_VALUES.cardio_eliptica;
  }
  if (
    normalized.includes('caminata') ||
    normalized.includes('caminar') ||
    normalized.includes('walking') ||
    normalized.includes('cinta') ||
    normalized.includes('treadmill')
  ) {
    return MET_VALUES.cardio_caminata;
  }
  if (
    normalized.includes('bicicleta') ||
    normalized.includes('bici') ||
    normalized.includes('spinning') ||
    normalized.includes('ciclismo') ||
    normalized.includes('cycling') ||
    normalized.includes('bike')
  ) {
    return MET_VALUES.cardio_bicicleta;
  }
  if (
    normalized.includes('hiit') ||
    normalized.includes('remo') ||
    normalized.includes('escaladora') ||
    normalized.includes('burpee')
  ) {
    return MET_VALUES.cardio_hiit;
  }

  return rpe >= 8 ? MET_VALUES.fuerza_vigorosa : MET_VALUES.fuerza_moderada;
}

export function computeMetCalories(
  met: number,
  bodyWeightKg: number,
  durationMinutes: number
): number {
  if (met <= 0 || bodyWeightKg <= 0 || durationMinutes <= 0) {
    return 0;
  }
  return ((met * 3.5 * bodyWeightKg) / 200) * durationMinutes;
}

export function calculateCompletedRoutineCalories(
  workout: WorkoutRecordInput,
  athleteWeightKg: number
): DailySessionCalorieDetail | null {
  if (!workout || !workout.isFinished) {
    return null;
  }

  const validWeightKg =
    typeof athleteWeightKg === 'number' && athleteWeightKg > 0 ? athleteWeightKg : 95;

  const rawCompletedExercises = Array.isArray(workout.exercisesSummary)
    ? workout.exercisesSummary.filter(
        (ex) => ex && ex.completed !== false && ((ex.sets && ex.sets > 0) || (ex.durationSeconds && ex.durationSeconds > 0))
      )
    : [];

  // Deduplicar ejercicios dentro de la sesión
  const uniqueExercisesMap = new Map<string, typeof rawCompletedExercises[0]>();
  for (const ex of rawCompletedExercises) {
    const key = (ex.name || '').trim().toLowerCase();
    if (!key) continue;
    const safeSets = Math.min(Math.max(ex.sets || 1, 1), 6);
    if (!uniqueExercisesMap.has(key)) {
      uniqueExercisesMap.set(key, { ...ex, sets: safeSets });
    }
  }
  const completedExercises = Array.from(uniqueExercisesMap.values());

  const totalCompletedSets =
    completedExercises.length > 0
      ? completedExercises.reduce((acc, ex) => acc + (ex.sets || 0), 0)
      : Math.min(Math.max(Number(workout.completedSetsCount) || 0, 0), 35);

  if (totalCompletedSets <= 0 && completedExercises.length === 0) {
    return null;
  }

  const durationMinutes = normalizeDurationMinutes(workout.durationSeconds, totalCompletedSets);
  const cleanTitle = cleanCorruptedRoutineTitle(workout.routineTitle, workout.date);

  let totalVolumeKg = Number(workout.totalVolumeKg) || 0;
  if (completedExercises.length > 0) {
    const calcVol = completedExercises.reduce((acc, ex) => {
      const v =
        typeof ex.volumeKg === 'number' && ex.volumeKg > 0
          ? ex.volumeKg
          : (Number(ex.maxWeight) || 0) * (Number(ex.maxReps) || 0) * (ex.sets || 1);
      return acc + v;
    }, 0);
    if (calcVol > 0) totalVolumeKg = Math.round(calcVol);
  }

  let weightedMetSum = 0;
  let totalWeightUnits = 0;

  for (const ex of completedExercises) {
    const exRpe = ex.rpe || workout.avgRpe || 8;
    const exMet = resolveActivityMet(ex.name, ex.muscleGroup, exRpe);
    const unitWeight = ex.sets && ex.sets > 0 ? ex.sets : 1;
    weightedMetSum += exMet * unitWeight;
    totalWeightUnits += unitWeight;
  }

  const effectiveMet =
    totalWeightUnits > 0
      ? Number((weightedMetSum / totalWeightUnits).toFixed(2))
      : resolveActivityMet(cleanTitle, '', workout.avgRpe || 8);

  const caloriesBurned = Math.round(computeMetCalories(effectiveMet, validWeightKg, durationMinutes));

  return {
    workoutId: workout.id,
    routineTitle: cleanTitle,
    dateKey: toIsolatedDateKey(workout.date),
    timestamp: workout.date,
    durationMinutes,
    totalVolumeKg,
    appliedMet: effectiveMet,
    athleteWeightKg: validWeightKg,
    completedBlocksCount: completedExercises.length || totalCompletedSets,
    caloriesBurned,
  };
}

/**
 * Construye el reporte diario asegurando ESTRICTAMENTE 1 ÚNICO REGISTRO POR FECHA ('YYYY-MM-DD'),
 * descartando duplicados, truncando títulos repetitivos y recalculando tiempos reales (45-120 min máx).
 */
export function buildDailyCaloriesReport(params: {
  athlete: AthleteBiometricsInput;
  workouts: WorkoutRecordInput[];
  targetDate?: string | number | Date;
  timezoneOffsetMinutes?: number;
}): DailyCaloriesReportResponse {
  const { athlete, workouts, targetDate, timezoneOffsetMinutes } = params;

  const athleteWeightKg =
    typeof athlete?.weightKg === 'number' && athlete.weightKg > 0 ? athlete.weightKg : 95;

  const todayKey = toIsolatedDateKey(targetDate || new Date(), timezoneOffsetMinutes);

  const isolatedDaysMap = new Map<string, IsolatedDailyCalorieSummary>();

  const safeWorkouts = Array.isArray(workouts) ? [...workouts] : [];
  // Ordenar por fecha descendente para tomar la sesión válida más reciente de cada fecha única
  safeWorkouts.sort((a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime());

  for (const workout of safeWorkouts) {
    if (!workout || !workout.date) continue;

    const workoutDateKey = toIsolatedDateKey(workout.date, timezoneOffsetMinutes);
    if (!workoutDateKey) continue;

    // REGLA 1 & 2: Cada registro por fecha ('YYYY-MM-DD') es único e independiente.
    // Si ya se procesó la sesión de esa fecha, se descarta cualquier registro repetido/basura.
    if (isolatedDaysMap.has(workoutDateKey)) {
      continue;
    }

    const detail = calculateCompletedRoutineCalories(workout, athleteWeightKg);
    if (!detail || detail.caloriesBurned <= 0) {
      continue;
    }

    detail.dateKey = workoutDateKey;

    isolatedDaysMap.set(workoutDateKey, {
      dateKey: workoutDateKey,
      routineTitle: detail.routineTitle,
      dailyCaloriesBurned: detail.caloriesBurned,
      completedWorkoutsCount: 1,
      totalDurationMinutes: detail.durationMinutes,
      totalVolumeKg: detail.totalVolumeKg,
      athleteWeightKg,
      sessions: [detail],
    });
  }

  const isolatedDailyHistory = Array.from(isolatedDaysMap.values()).sort((a, b) =>
    b.dateKey.localeCompare(a.dateKey)
  );

  const todayReport = isolatedDaysMap.get(todayKey);

  return {
    success: true,
    dateKey: todayKey,
    dailyCaloriesBurned: todayReport ? todayReport.dailyCaloriesBurned : 0,
    athleteWeightKg,
    totalDurationMinutesToday: todayReport ? todayReport.totalDurationMinutes : 0,
    completedWorkoutsToday: todayReport ? 1 : 0,
    todaySessions: todayReport ? todayReport.sessions : [],
    isolatedDailyHistory,
  };
}

/**
 * SCRIPT DE LIMPIEZA DE BASE DE DATOS EN SERVIDOR (DATA PURGE):
 * Escanea un array de entrenamientos corruptos, elimina duplicados por fecha ('YYYY-MM-DD'),
 * trunca títulos concatenados y recalcula tiempos a valores reales (45-120 min).
 */
export function purgeCorruptedWorkoutsOnServer(
  rawWorkouts: WorkoutRecordInput[],
  athleteWeightKg: number = 95
): {
  cleanedHistory: WorkoutRecordInput[];
  purgedCount: number;
} {
  const safeList = Array.isArray(rawWorkouts) ? [...rawWorkouts] : [];
  safeList.sort((a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime());

  const byDate = new Map<string, WorkoutRecordInput>();

  for (const w of safeList) {
    if (!w || !w.date) continue;
    const dateKey = toIsolatedDateKey(w.date);
    if (!dateKey || byDate.has(dateKey)) continue;

    const detail = calculateCompletedRoutineCalories(w, athleteWeightKg);
    if (!detail) continue;

    const cleanDurationSeconds = detail.durationMinutes * 60;
    const endTimeMs = new Date(w.date).getTime();

    byDate.set(dateKey, {
      ...w,
      id: w.id || `workout-${dateKey}`,
      routineTitle: detail.routineTitle,
      durationSeconds: cleanDurationSeconds,
      startTime: endTimeMs - cleanDurationSeconds * 1000,
      endTime: endTimeMs,
      totalVolumeKg: detail.totalVolumeKg,
      completedSetsCount: detail.completedBlocksCount,
      caloriesBurned: detail.caloriesBurned,
      isFinished: true,
    });
  }

  const cleanedHistory = Array.from(byDate.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return {
    cleanedHistory,
    purgedCount: Math.max(0, safeList.length - cleanedHistory.length),
  };
}

export async function handleGetDailyCaloriesReport(req: Request, res: Response): Promise<void> {
  try {
    const { athlete, workouts, targetDate, timezoneOffsetMinutes } = req.body || {};

    const report = buildDailyCaloriesReport({
      athlete: athlete || { id: 'default', weightKg: 95 },
      workouts: Array.isArray(workouts) ? workouts : [],
      targetDate,
      timezoneOffsetMinutes,
    });

    res.status(200).json(report);
  } catch (error: any) {
    console.error('[DailyCaloriesController] Error generating daily report:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Error interno al calcular el gasto calórico diario.',
      dailyCaloriesBurned: 0,
    });
  }
}

export async function handleCalculateSessionCalories(req: Request, res: Response): Promise<void> {
  try {
    const { workout, athleteWeightKg } = req.body || {};
    const weight = typeof athleteWeightKg === 'number' && athleteWeightKg > 0 ? athleteWeightKg : 95;

    const sessionDetail = calculateCompletedRoutineCalories(workout, weight);

    res.status(200).json({
      success: true,
      caloriesBurned: sessionDetail ? sessionDetail.caloriesBurned : 0,
      detail: sessionDetail,
    });
  } catch (error: any) {
    console.error('[DailyCaloriesController] Error calculating session calories:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Error al calcular calorías de la sesión.',
      caloriesBurned: 0,
    });
  }
}

export async function handlePurgeCorruptedHistory(req: Request, res: Response): Promise<void> {
  try {
    const { workouts, athleteWeightKg } = req.body || {};
    const weight = typeof athleteWeightKg === 'number' && athleteWeightKg > 0 ? athleteWeightKg : 95;
    const result = purgeCorruptedWorkoutsOnServer(Array.isArray(workouts) ? workouts : [], weight);
    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[DailyCaloriesController] Error purging history:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Error al purgar historial corrupto.',
    });
  }
}
