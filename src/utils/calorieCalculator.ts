import { CompletedWorkout, Profile } from '../types';

export interface ActivityBlockCalorieInput {
  name: string;
  muscleGroup?: string;
  setsCompleted?: number;
  completed?: boolean;
  rpe?: number;
}

export interface CalorieBurnParams {
  durationMinutes: number;
  totalVolumeKg?: number;
  bodyWeightKg?: number;
  intensityRPEAverage?: number;
  completedSetsCount?: number;
  completedExercises?: ActivityBlockCalorieInput[];
  routineTitle?: string;
}

const WEEKDAY_NAMES_MAP: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
};

export function resolveExerciseMetValue(
  name: string = '',
  muscleGroup: string = '',
  rpe: number = 8
): number {
  const norm = `${name} ${muscleGroup}`.toLowerCase().trim();

  if (norm.includes('elíptica') || norm.includes('eliptica') || norm.includes('elliptical')) {
    return 6.5;
  }
  if (
    norm.includes('caminata') ||
    norm.includes('caminar') ||
    norm.includes('walking') ||
    norm.includes('cinta') ||
    norm.includes('treadmill')
  ) {
    return 4.3;
  }
  if (
    norm.includes('bicicleta') ||
    norm.includes('bici') ||
    norm.includes('spinning') ||
    norm.includes('ciclismo') ||
    norm.includes('cycling') ||
    norm.includes('bike')
  ) {
    return 7.5;
  }
  if (norm.includes('hiit') || norm.includes('remo') || norm.includes('escaladora')) {
    return 8.0;
  }

  return rpe >= 8 ? 6.0 : 5.0;
}

export function calculateWorkoutCaloriesBurned({
  durationMinutes,
  bodyWeightKg = 95,
  intensityRPEAverage = 8,
  completedSetsCount,
  completedExercises = [],
  routineTitle = '',
}: CalorieBurnParams): number {
  const validCompletedExercises = completedExercises.filter(
    (ex) => ex.completed !== false && (ex.setsCompleted === undefined || ex.setsCompleted > 0)
  );

  const effectiveCompletedCount =
    typeof completedSetsCount === 'number'
      ? completedSetsCount
      : validCompletedExercises.reduce((acc, ex) => acc + (ex.setsCompleted || 1), 0);

  if (effectiveCompletedCount <= 0 || durationMinutes <= 0) {
    return 0;
  }

  const validBodyWeightKg = typeof bodyWeightKg === 'number' && bodyWeightKg > 0 ? bodyWeightKg : 95;

  let weightedMetSum = 0;
  let weightUnits = 0;

  if (validCompletedExercises.length > 0) {
    for (const ex of validCompletedExercises) {
      const met = resolveExerciseMetValue(ex.name, ex.muscleGroup, ex.rpe || intensityRPEAverage);
      const units = ex.setsCompleted && ex.setsCompleted > 0 ? ex.setsCompleted : 1;
      weightedMetSum += met * units;
      weightUnits += units;
    }
  }

  const appliedMet =
    weightUnits > 0
      ? weightedMetSum / weightUnits
      : resolveExerciseMetValue(routineTitle, '', intensityRPEAverage);

  const kcal = ((appliedMet * 3.5 * validBodyWeightKg) / 200) * durationMinutes;

  return Math.round(kcal);
}

export function getLocalDateKey(dateInput: string | number | Date = new Date()): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cleanSingleDayTitle(rawTitle: string | undefined, dateStr: string): string {
  const d = new Date(dateStr);
  const actualDay = !isNaN(d.getTime()) ? WEEKDAY_NAMES_MAP[d.getDay()] || 'Entrenamiento' : 'Entrenamiento';

  if (!rawTitle || typeof rawTitle !== 'string') {
    return `Rutina ${actualDay}`;
  }

  let clean = rawTitle.split(/[,;|]+/).map((p) => p.trim()).filter(Boolean)[0] || rawTitle.trim();
  const dayMatches = clean.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi);
  if (dayMatches && dayMatches.length > 1) {
    clean = `Rutina ${actualDay}`;
  }
  if (/^rutina\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$/i.test(clean)) {
    clean = `Rutina ${actualDay}`;
  }
  return clean.slice(0, 80).trim() || `Rutina ${actualDay}`;
}

function clampRealDurationMinutes(rawDurationSeconds: number | undefined, completedSetsCount: number): number {
  const MIN_MINUTES = 45;
  const MAX_MINUTES = 120;
  const estimatedMinutes = Math.min(
    MAX_MINUTES,
    Math.max(MIN_MINUTES, Math.round(Math.max(1, completedSetsCount) * 3.5))
  );
  const rawMinutes = Math.round((Number(rawDurationSeconds) || 0) / 60);
  if (rawMinutes <= 0 || rawMinutes > MAX_MINUTES) {
    return estimatedMinutes;
  }
  if (rawMinutes < MIN_MINUTES && completedSetsCount >= 12) {
    return estimatedMinutes;
  }
  return rawMinutes;
}

export interface IsolatedDayCalorieBucket {
  dateKey: string;
  routineTitle: string;
  dailyCaloriesBurned: number;
  completedWorkoutsCount: number;
  totalDurationMinutes: number;
  totalVolumeKg: number;
  athleteWeightKg: number;
  sessions: {
    workoutId: string;
    routineTitle: string;
    durationMinutes: number;
    totalVolumeKg: number;
    appliedMet: number;
    caloriesBurned: number;
    completedBlocksCount: number;
  }[];
}

export interface DailyCaloriesSummaryResult {
  dateKey: string;
  dailyCaloriesBurned: number;
  athleteWeightKg: number;
  totalDurationMinutesToday: number;
  completedWorkoutsToday: number;
  isolatedDailyHistory: IsolatedDayCalorieBucket[];
}

/**
 * Calcula de forma aislada el gasto calórico y registro de sesión por jornada (24 horas),
 * garantizando estrictamente:
 * 1. UN (1) ÚNICO REGISTRO INDEPENDIENTE POR FECHA ('YYYY-MM-DD') sin concatenar días ni acumular minutos.
 * 2. Tiempo real ejecutado en rango normal (45 a 120 min máximo).
 * 3. El contador diario inicia en 0 kcal cada nuevo día.
 */
export function calculateIsolatedDailyCalories(
  history: CompletedWorkout[],
  athleteProfile?: Partial<Profile>,
  targetDate: Date = new Date()
): DailyCaloriesSummaryResult {
  const athleteWeightKg =
    typeof athleteProfile?.weightKg === 'number' && athleteProfile.weightKg > 0
      ? athleteProfile.weightKg
      : 95;

  const todayKey = getLocalDateKey(targetDate);
  const daysMap = new Map<string, IsolatedDayCalorieBucket>();

  const safeHistory = Array.isArray(history) ? [...history] : [];
  // Ordenar del más reciente al más antiguo para tomar la sesión única correspondiente a cada fecha
  safeHistory.sort((a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime());

  for (const workout of safeHistory) {
    if (!workout || !workout.date || !workout.isFinished) {
      continue;
    }

    const dateKey = getLocalDateKey(workout.date);
    // Unicidad estricta por fecha ('YYYY-MM-DD'): descartar cualquier duplicado o basura en la misma fecha
    if (!dateKey || daysMap.has(dateKey)) {
      continue;
    }

    const rawExercises = Array.isArray(workout.exercisesSummary)
      ? workout.exercisesSummary.filter((ex) => ex && ex.sets > 0)
      : [];

    const uniqueExMap = new Map<string, typeof rawExercises[0]>();
    for (const ex of rawExercises) {
      const k = (ex.name || '').trim().toLowerCase();
      if (!k) continue;
      if (!uniqueExMap.has(k)) {
        uniqueExMap.set(k, { ...ex, sets: Math.min(Math.max(ex.sets || 1, 1), 6) });
      }
    }
    const completedSummary = Array.from(uniqueExMap.values());

    const completedSetsCount =
      completedSummary.length > 0
        ? completedSummary.reduce((acc, ex) => acc + (ex.sets || 0), 0)
        : Math.min(Math.max(Number(workout.completedSetsCount) || 0, 0), 35);

    if (completedSetsCount <= 0) {
      continue;
    }

    const cleanTitle = cleanSingleDayTitle(workout.routineTitle, workout.date);
    const durationMinutes = clampRealDurationMinutes(workout.durationSeconds, completedSetsCount);

    let totalVolumeKg = Number(workout.totalVolumeKg) || 0;
    if (completedSummary.length > 0) {
      const calcVol = completedSummary.reduce((acc, ex) => {
        const v =
          typeof ex.volumeKg === 'number' && ex.volumeKg > 0
            ? ex.volumeKg
            : (Number(ex.maxWeight) || 0) * (Number(ex.maxReps) || 0) * (ex.sets || 1);
        return acc + v;
      }, 0);
      if (calcVol > 0) totalVolumeKg = Math.round(calcVol);
    }

    const recalculatedCalories = calculateWorkoutCaloriesBurned({
      durationMinutes,
      totalVolumeKg,
      bodyWeightKg: athleteWeightKg,
      intensityRPEAverage: workout.avgRpe || 8,
      completedSetsCount,
      completedExercises: completedSummary.map((ex) => ({
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        setsCompleted: ex.sets,
        completed: true,
        rpe: ex.rpe,
      })),
      routineTitle: cleanTitle,
    });

    if (recalculatedCalories <= 0) continue;

    const avgMet =
      completedSummary.length > 0
        ? Number(
            (
              completedSummary.reduce(
                (acc, ex) => acc + resolveExerciseMetValue(ex.name, ex.muscleGroup, ex.rpe || 8),
                0
              ) / completedSummary.length
            ).toFixed(2)
          )
        : resolveExerciseMetValue(cleanTitle, '', workout.avgRpe || 8);

    const singleSessionDetail = {
      workoutId: workout.id || `workout-${dateKey}`,
      routineTitle: cleanTitle,
      durationMinutes,
      totalVolumeKg,
      appliedMet: avgMet,
      caloriesBurned: recalculatedCalories,
      completedBlocksCount: completedSummary.length || completedSetsCount,
    };

    daysMap.set(dateKey, {
      dateKey,
      routineTitle: cleanTitle,
      dailyCaloriesBurned: recalculatedCalories,
      completedWorkoutsCount: 1,
      totalDurationMinutes: durationMinutes,
      totalVolumeKg,
      athleteWeightKg,
      sessions: [singleSessionDetail],
    });
  }

  const isolatedDailyHistory = Array.from(daysMap.values()).sort((a, b) =>
    b.dateKey.localeCompare(a.dateKey)
  );

  const todayBucket = daysMap.get(todayKey);

  return {
    dateKey: todayKey,
    dailyCaloriesBurned: todayBucket ? todayBucket.dailyCaloriesBurned : 0,
    athleteWeightKg,
    totalDurationMinutesToday: todayBucket ? todayBucket.totalDurationMinutes : 0,
    completedWorkoutsToday: todayBucket ? 1 : 0,
    isolatedDailyHistory,
  };
}

export async function fetchDailyCaloriesReportFromServer(
  history: CompletedWorkout[],
  athleteProfile?: Partial<Profile>
): Promise<DailyCaloriesSummaryResult> {
  try {
    const response = await fetch('/api/calories/daily-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete: {
          id: athleteProfile?.id || 'default',
          name: athleteProfile?.name || 'Atleta',
          weightKg:
            typeof athleteProfile?.weightKg === 'number' && athleteProfile.weightKg > 0
              ? athleteProfile.weightKg
              : 95,
        },
        workouts: history,
        targetDate: new Date().toISOString(),
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.success) {
        return {
          dateKey: data.dateKey,
          dailyCaloriesBurned: data.dailyCaloriesBurned ?? 0,
          athleteWeightKg: data.athleteWeightKg ?? 95,
          totalDurationMinutesToday: data.totalDurationMinutesToday ?? 0,
          completedWorkoutsToday: data.completedWorkoutsToday ?? 0,
          isolatedDailyHistory: Array.isArray(data.isolatedDailyHistory)
            ? data.isolatedDailyHistory
            : [],
        };
      }
    }
  } catch {
    // Fallback local determinista
  }

  return calculateIsolatedDailyCalories(history, athleteProfile);
}
