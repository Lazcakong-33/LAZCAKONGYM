import { CompletedWorkout, Profile } from '../types';
import { resolveApiUrl } from './apiUrl';

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

export const CHILE_TIMEZONE = 'America/Santiago';

export function getChileWeekdayName(dateInput: string | number | Date = new Date()): string {
  const dateKey = getChileLocalDateKey(dateInput);
  if (!dateKey) return 'Entrenamiento';
  const parts = dateKey.split('-');
  if (parts.length < 3) return 'Entrenamiento';
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return 'Entrenamiento';

  // Construct noon in UTC to avoid DST boundary issues
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  try {
    const weekdayShort = new Intl.DateTimeFormat('en-US', {
      timeZone: CHILE_TIMEZONE,
      weekday: 'short',
    }).format(noonUtc);
    const dayMap: Record<string, string> = {
      Sun: 'Domingo',
      Mon: 'Lunes',
      Tue: 'Martes',
      Wed: 'Miércoles',
      Thu: 'Jueves',
      Fri: 'Viernes',
      Sat: 'Sábado',
    };
    return dayMap[weekdayShort] || 'Entrenamiento';
  } catch {
    const jsDay = noonUtc.getUTCDay();
    return WEEKDAY_NAMES_MAP[jsDay] || 'Entrenamiento';
  }
}

export function getChileWeekdayIndex(dateInput: string | number | Date = new Date()): number {
  const dateKey = getChileLocalDateKey(dateInput);
  if (!dateKey) return -1;
  const parts = dateKey.split('-');
  if (parts.length < 3) return -1;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return -1;

  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  try {
    const weekdayShort = new Intl.DateTimeFormat('en-US', {
      timeZone: CHILE_TIMEZONE,
      weekday: 'short',
    }).format(noonUtc);
    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return dayMap[weekdayShort] ?? noonUtc.getUTCDay();
  } catch {
    return noonUtc.getUTCDay();
  }
}

export function parseRobustDate(dateInput: string | number | Date | null | undefined): (Date & { _localDateKey?: string }) | null {
  if (!dateInput && dateInput !== 0) return null;
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? null : dateInput;
  }
  if (typeof dateInput === 'number') {
    if (!Number.isFinite(dateInput) || dateInput <= 0) return null;
    const d = new Date(dateInput);
    return isNaN(d.getTime()) ? null : d;
  }
  const str = String(dateInput).trim();
  if (!str) return null;

  // 1. Explicit UTC (Z) or timezone offset (+HH:MM / -HH:MM)
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
  }

  // 2. Direct YYYY-MM-DD
  const ymdOnly = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymdOnly) {
    const y = parseInt(ymdOnly[1], 10);
    const m = parseInt(ymdOnly[2], 10);
    const day = parseInt(ymdOnly[3], 10);
    const d: any = new Date(y, m - 1, day, 12, 0, 0);
    if (!isNaN(d.getTime())) {
      d._localDateKey = `${ymdOnly[1]}-${ymdOnly[2].padStart(2, '0')}-${ymdOnly[3].padStart(2, '0')}`;
      return d;
    }
  }

  // 3. Format DD-MM-YYYY or DD/MM/YYYY (with optional local time)
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    const hours = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
    const minutes = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const seconds = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
    const d: any = new Date(year, month - 1, day, hours, minutes, seconds);
    if (!isNaN(d.getTime())) {
      d._localDateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return d;
    }
  }

  // 4. Format YYYY-MM-DD or YYYY/MM/DD local time without timezone
  const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    const hours = ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0;
    const minutes = ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0;
    const seconds = ymdMatch[6] ? parseInt(ymdMatch[6], 10) : 0;
    const d: any = new Date(year, month - 1, day, hours, minutes, seconds);
    if (!isNaN(d.getTime())) {
      d._localDateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return d;
    }
  }

  // 5. Standard Date parse
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function getChileLocalDateKey(dateInput: string | number | Date = new Date()): string {
  if (!dateInput && dateInput !== 0) return '';

  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (!trimmed) return '';

    // Direct YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    // DD-MM-YYYY or DD/MM/YYYY
    const dmy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) {
      return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }

    // Local YYYY-MM-DD[T ]HH:mm:ss without Z and without +/- offset
    const ymdLocal = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (ymdLocal && !trimmed.includes('Z') && !trimmed.includes('z') && !/[+-]\d{2}/.test(trimmed)) {
      return `${ymdLocal[1]}-${ymdLocal[2].padStart(2, '0')}-${ymdLocal[3].padStart(2, '0')}`;
    }
  }

  let d: any = dateInput;
  if (typeof d === 'string') {
    d = parseRobustDate(d);
  } else if (typeof d === 'number') {
    d = new Date(d);
  }

  if (!d || isNaN(d.getTime())) return '';

  if (d._localDateKey) {
    return d._localDateKey;
  }

  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: CHILE_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

export function getLocalDateKey(dateInput: string | number | Date = new Date()): string {
  return getChileLocalDateKey(dateInput);
}

/**
 * Resuelve la fecha calendario local en Chile ('YYYY-MM-DD') de un entrenamiento finalizado.
 * Si `workout.date` es una fecha sin hora ('YYYY-MM-DD') heredada de un `.toISOString().slice(0, 10)` en UTC
 * y coincide exactamente con la fecha UTC de `endTime`/`startTime`, corrige usando el timestamp real en Chile.
 */
export function resolveWorkoutChileDateKey(
  workout: Partial<CompletedWorkout> | null | undefined
): string {
  if (!workout) return '';
  const rawCompletedAt = typeof workout.completedAt === 'string' ? workout.completedAt.trim() : '';
  const rawDate = typeof workout.date === 'string' ? workout.date.trim() : '';
  const ts =
    (typeof workout.endTime === 'number' && workout.endTime > 1577836800000 ? workout.endTime : 0) ||
    (rawCompletedAt ? parseRobustDate(rawCompletedAt)?.getTime() || 0 : 0) ||
    (typeof workout.startTime === 'number' && workout.startTime > 1577836800000 ? workout.startTime : 0);

  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && ts > 0) {
    const utcFromTs = new Date(ts).toISOString().slice(0, 10);
    if (utcFromTs === rawDate) {
      return getChileLocalDateKey(ts);
    }
    return rawDate;
  }

  if (rawCompletedAt) {
    const fromCompleted = getChileLocalDateKey(rawCompletedAt);
    if (fromCompleted) return fromCompleted;
  }

  if (rawDate) {
    const fromDate = getChileLocalDateKey(rawDate);
    if (fromDate) return fromDate;
  }

  if (ts > 0) {
    return getChileLocalDateKey(ts);
  }

  return '';
}

export function buildWorkoutContentSignature(
  workout: Partial<CompletedWorkout> | null | undefined
): string {
  if (!workout || !Array.isArray(workout.exercisesSummary)) return '';
  return workout.exercisesSummary
    .filter((ex) => ex && (ex.sets || 0) > 0)
    .map((ex) => {
      const normName = String(ex.name || '').trim().toLowerCase();
      const sets = Math.round(Number(ex.sets) || 0);
      const maxW = Math.round((Number(ex.maxWeight) || 0) * 10);
      const maxR = Math.round(Number(ex.maxReps) || 0);
      return `${normName}:${sets}:${maxW}:${maxR}`;
    })
    .filter(Boolean)
    .sort()
    .join('|');
}

/**
 * Determina si dos registros del historial corresponden a un duplicado/reintento
 * de exactamente la misma sesión dentro del mismo día local en Chile (America/Santiago),
 * sin fusionar dos sesiones legítimamente distintas realizadas el mismo día.
 */
export function areWorkoutsSameSessionRetry(
  a: Partial<CompletedWorkout> | null | undefined,
  b: Partial<CompletedWorkout> | null | undefined
): boolean {
  if (!a || !b) return false;
  const idA = typeof a.id === 'string' ? a.id.trim() : '';
  const idB = typeof b.id === 'string' ? b.id.trim() : '';
  if (idA && idB && idA === idB) return true;

  const keyA = resolveWorkoutChileDateKey(a);
  const keyB = resolveWorkoutChileDateKey(b);
  if (!keyA || !keyB || keyA !== keyB) return false;

  const tA =
    (typeof a.endTime === 'number' && a.endTime > 0 ? a.endTime : 0) ||
    (typeof a.startTime === 'number' && a.startTime > 0 ? a.startTime : 0) ||
    (parseRobustDate(a.date)?.getTime() || 0);
  const tB =
    (typeof b.endTime === 'number' && b.endTime > 0 ? b.endTime : 0) ||
    (typeof b.startTime === 'number' && b.startTime > 0 ? b.startTime : 0) ||
    (parseRobustDate(b.date)?.getTime() || 0);
  const timeDiffMins = tA > 0 && tB > 0 ? Math.abs(tA - tB) / (1000 * 60) : Number.POSITIVE_INFINITY;

  const volA = Math.round(Number(a.totalVolumeKg) || 0);
  const volB = Math.round(Number(b.totalVolumeKg) || 0);
  const setsA =
    typeof a.completedSetsCount === 'number' && a.completedSetsCount > 0
      ? a.completedSetsCount
      : Array.isArray(a.exercisesSummary)
      ? a.exercisesSummary.reduce((acc, ex) => acc + (ex?.sets || 0), 0)
      : 0;
  const setsB =
    typeof b.completedSetsCount === 'number' && b.completedSetsCount > 0
      ? b.completedSetsCount
      : Array.isArray(b.exercisesSummary)
      ? b.exercisesSummary.reduce((acc, ex) => acc + (ex?.sets || 0), 0)
      : 0;

  const sigA = buildWorkoutContentSignature(a);
  const sigB = buildWorkoutContentSignature(b);
  const sameExSig = Boolean(sigA && sigB && sigA === sigB);

  const calA = Math.round(Number(a.caloriesBurned) || 0);
  const calB = Math.round(Number(b.caloriesBurned) || 0);
  const sameCalories = calA > 0 && calB > 0 && Math.abs(calA - calB) <= 5;

  const rIdA = String(a.routineId || '').trim();
  const rIdB = String(b.routineId || '').trim();
  const isGenericId = (rid: string) => !rid || rid === 'rutina-historica' || rid.startsWith('csv-routine-');
  const hasDistinctRealRoutineIds =
    !isGenericId(rIdA) && !isGenericId(rIdB) && rIdA !== rIdB;
  const schedA = String(a.scheduledDay || '').trim().toLowerCase();
  const schedB = String(b.scheduledDay || '').trim().toLowerCase();
  const hasDistinctScheduledDays = Boolean(schedA && schedB && schedA !== schedB);

  const titleA = String(a.routineTitle || '').toLowerCase().trim();
  const titleB = String(b.routineTitle || '').toLowerCase().trim();
  const sameRoutine =
    (!isGenericId(rIdA) && !isGenericId(rIdB) && rIdA === rIdB) ||
    (!hasDistinctRealRoutineIds && !hasDistinctScheduledDays && Boolean(titleA) && titleA === titleB);

  // Dos rutinas genuinamente distintas ejecutadas el mismo día NUNCA deben fusionarse como reintento duplicado
  const eitherIsRecoveredCopy = idA.startsWith('recovered-') || idB.startsWith('recovered-');
  if ((hasDistinctRealRoutineIds || hasDistinctScheduledDays) && !(eitherIsRecoveredCopy && sameExSig)) {
    return false;
  }

  // Reintento cercano dentro de 20 minutos en el mismo día
  if (timeDiffMins <= 20) {
    if (sameExSig) return true;
    if (sameRoutine && setsA === setsB && Math.abs(volA - volB) <= 5) return true;
    if (sameRoutine && volA > 0 && volA === volB && setsA === setsB) return true;
  }

  // Stable IDs and distinct recorded times distinguish separate workouts.
  const hasRecordedTime = (workout: Partial<CompletedWorkout>) =>
    Number(workout.endTime) > 0 || Number(workout.startTime) > 0;
  if (
    idA && idB &&
    !idA.startsWith('recovered-') && !idB.startsWith('recovered-') &&
    hasRecordedTime(a) && hasRecordedTime(b) && timeDiffMins > 20
  ) {
    return false;
  }

  // Copia recuperada / sincronizada del mismo día con idéntico contenido de ejercicios, series y carga/calorías
  if (
    sameExSig &&
    setsA === setsB &&
    (Math.abs(volA - volB) <= 5 || sameCalories) &&
    (sameRoutine || sameCalories || timeDiffMins <= 300)
  ) {
    return true;
  }

  return false;
}

function cleanSingleDayTitle(rawTitle: string | undefined, dateStr: string): string {
  if (rawTitle && typeof rawTitle === 'string' && rawTitle.trim()) {
    const clean = rawTitle.split(/[;|]+/).map((p) => p.trim()).filter(Boolean)[0] || rawTitle.trim();
    // Only clean if there is an artificial loop of multiple weekdays in the title
    const dayMatches = clean.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi);
    if (dayMatches && dayMatches.length > 1) {
      const actualDay = getChileWeekdayName(dateStr);
      return `Rutina ${actualDay}`;
    }
    // Preserve custom or standard routine title (e.g. "Viernes", "Viernes: Pierna", "Piernas", etc.)
    return clean.slice(0, 80).trim();
  }

  const actualDay = getChileWeekdayName(dateStr);
  return `Rutina ${actualDay}`;
}

function clampRealDurationMinutes(rawDurationSeconds: number | undefined, completedSetsCount: number): number {
  const MIN_MINUTES = 25;
  const MAX_MINUTES = 180;
  const estimatedMinutes = Math.min(
    120,
    Math.max(MIN_MINUTES, Math.round(Math.max(1, completedSetsCount) * 3.5))
  );
  const rawMinutes = Math.round((Number(rawDurationSeconds) || 0) / 60);
  if (rawMinutes <= 0 || rawMinutes > MAX_MINUTES) {
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
 * Calcula el gasto calórico y registro de sesión por jornada (24 horas),
 * garantizando:
 * 1. Agrupación por fecha ('YYYY-MM-DD') en hora local de Chile (America/Santiago) sin descartar múltiples sesiones reales completadas en el mismo día.
 * 2. Deduplicación estricta de reintentos por ID estable o huella idéntica de sesión.
 * 3. Respeto de duraciones, tonelajes y series completadas reales.
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

  const todayKey = getChileLocalDateKey(targetDate);
  const daysMap = new Map<string, IsolatedDayCalorieBucket>();
  const seenSessionIds = new Set<string>();
  const acceptedWorkouts: CompletedWorkout[] = [];

  const safeHistory = Array.isArray(history) ? [...history] : [];
  safeHistory.sort((a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime());

  for (const workout of safeHistory) {
    if (!workout || workout.isFinished === false) {
      continue;
    }

    const trimmedId = typeof workout.id === 'string' ? workout.id.trim() : '';
    if (trimmedId) {
      if (seenSessionIds.has(trimmedId)) continue;
      seenSessionIds.add(trimmedId);
    }

    const dateKey = resolveWorkoutChileDateKey(workout);
    if (!dateKey) {
      continue;
    }

    if (acceptedWorkouts.some((existing) => areWorkoutsSameSessionRetry(existing, workout))) {
      continue;
    }

    const rawExercises = Array.isArray(workout.exercisesSummary)
      ? workout.exercisesSummary.filter((ex) => ex && (ex.sets || 0) > 0)
      : [];

    const uniqueExMap = new Map<string, typeof rawExercises[0]>();
    for (const ex of rawExercises) {
      const k = (ex.name || '').trim().toLowerCase();
      if (!k) continue;
      if (!uniqueExMap.has(k)) {
        uniqueExMap.set(k, { ...ex, sets: Math.min(Math.max(ex.sets || 1, 1), 30) });
      }
    }
    const completedSummary = Array.from(uniqueExMap.values());

    const completedSetsCount =
      completedSummary.length > 0
        ? completedSummary.reduce((acc, ex) => acc + (ex.sets || 0), 0)
        : Math.min(Math.max(Number(workout.completedSetsCount) || 0, 0), 40);

    if (completedSetsCount <= 0) {
      continue;
    }

    const cleanTitle = cleanSingleDayTitle(workout.routineTitle, workout.date || dateKey);
    const durationMinutes = clampRealDurationMinutes(workout.durationSeconds, completedSetsCount);

    let totalVolumeKg = Number(workout.totalVolumeKg) || 0;
    if (completedSummary.length > 0 && totalVolumeKg <= 0) {
      const calcVol = completedSummary.reduce((acc, ex) => {
        const v =
          typeof ex.volumeKg === 'number' && ex.volumeKg > 0
            ? ex.volumeKg
            : (Number(ex.maxWeight) || 0) * (Number(ex.maxReps) || 0) * (ex.sets || 1);
        return acc + v;
      }, 0);
      if (calcVol > 0) totalVolumeKg = Math.round(calcVol);
    }

    const recalculatedCalories =
      typeof workout.caloriesBurned === 'number' && workout.caloriesBurned > 0 && workout.caloriesBurned <= 2500
        ? Math.round(workout.caloriesBurned)
        : calculateWorkoutCaloriesBurned({
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

    acceptedWorkouts.push(workout);

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

    const existingDay = daysMap.get(dateKey);
    if (!existingDay) {
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
    } else {
      existingDay.dailyCaloriesBurned += recalculatedCalories;
      existingDay.completedWorkoutsCount += 1;
      existingDay.totalDurationMinutes += durationMinutes;
      existingDay.totalVolumeKg += totalVolumeKg;
      existingDay.sessions.push(singleSessionDetail);
      if (!existingDay.routineTitle.toLowerCase().includes(cleanTitle.toLowerCase())) {
        existingDay.routineTitle = `${existingDay.routineTitle} + ${cleanTitle}`;
      }
    }
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
    const response = await fetch(resolveApiUrl('/api/calories/daily-report'), {
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

const ORDERED_WEEK_DAYS_ES = [
  { weekdayName: 'Lunes', shortLabel: 'LUN' },
  { weekdayName: 'Martes', shortLabel: 'MAR' },
  { weekdayName: 'Miércoles', shortLabel: 'MIE' },
  { weekdayName: 'Jueves', shortLabel: 'JUE' },
  { weekdayName: 'Viernes', shortLabel: 'VIE' },
  { weekdayName: 'Sábado', shortLabel: 'SAB' },
  { weekdayName: 'Domingo', shortLabel: 'DOM' },
] as const;

export interface WeeklyDayCaloriesBucket {
  weekdayName: string;
  shortLabel: string;
  dateKey: string;
  dayNumber: string;
  calories: number;
  workoutsCount: number;
  isToday: boolean;
}

export interface TodayAndWeeklyCaloriesSummary {
  todayDateKey: string;
  todayCalories: number;
  todayWorkoutsCount: number;
  weeklyTotalCalories: number;
  weeklyWorkoutsCount: number;
  weekDays: WeeklyDayCaloriesBucket[];
  isEstimated: true;
}

/**
 * Calcula las calorías estimadas de hoy y el desglose semanal de lunes a domingo
 * únicamente a partir de entrenamientos reales finalizados y deduplicados,
 * asignados estrictamente al día calendario local de ejecución en Chile (America/Santiago).
 * Nunca contabiliza rutinas programadas ni usa el nombre de la rutina (ej. "Viernes") para asignar fecha.
 */
export function summarizeTodayAndWeeklyCalories(
  sanitizedHistory: CompletedWorkout[],
  athleteWeightKg: number = 95,
  referenceDate: Date | string | number = new Date()
): TodayAndWeeklyCaloriesSummary {
  const validWeightKg =
    typeof athleteWeightKg === 'number' && athleteWeightKg > 0 ? athleteWeightKg : 95;
  const todayDateKey = getChileLocalDateKey(referenceDate);

  const [yearStr, monthStr, dayStr] = todayDateKey.split('-');
  const y = parseInt(yearStr, 10) || 2026;
  const m = parseInt(monthStr, 10) || 11;
  const d = parseInt(dayStr, 10) || 19;
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  const jsDay = getChileWeekdayIndex(noonUtc);
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  const mondayUtc = new Date(noonUtc);
  mondayUtc.setUTCDate(noonUtc.getUTCDate() + diffToMonday);

  const bucketsByDate = new Map<string, { calories: number; count: number }>();
  const seenIds = new Set<string>();
  const countedWorkouts: CompletedWorkout[] = [];

  for (const workout of Array.isArray(sanitizedHistory) ? sanitizedHistory : []) {
    if (!workout || workout.isFinished === false) continue;

    const completedSets =
      typeof workout.completedSetsCount === 'number' && workout.completedSetsCount > 0
        ? workout.completedSetsCount
        : Array.isArray(workout.exercisesSummary)
        ? workout.exercisesSummary.reduce((acc, ex) => acc + (ex?.sets || 0), 0)
        : 0;
    if (completedSets <= 0) continue;

    const dateKey = resolveWorkoutChileDateKey(workout);
    if (!dateKey) continue;

    const trimmedId = typeof workout.id === 'string' ? workout.id.trim() : '';
    if (trimmedId) {
      if (seenIds.has(trimmedId)) continue;
      seenIds.add(trimmedId);
    }

    if (countedWorkouts.some((existing) => areWorkoutsSameSessionRetry(existing, workout))) {
      continue;
    }

    const workoutKcal =
      typeof workout.caloriesBurned === 'number' && workout.caloriesBurned > 0
        ? Math.round(workout.caloriesBurned)
        : calculateWorkoutCaloriesBurned({
            durationMinutes: Math.max(45, Math.min(120, Math.round((workout.durationSeconds || 0) / 60) || Math.round(completedSets * 3.5))),
            totalVolumeKg: workout.totalVolumeKg || 0,
            bodyWeightKg: validWeightKg,
            intensityRPEAverage: workout.avgRpe || 8,
            completedSetsCount: completedSets,
            completedExercises: Array.isArray(workout.exercisesSummary)
              ? workout.exercisesSummary.map((ex) => ({
                  name: ex.name,
                  muscleGroup: ex.muscleGroup,
                  setsCompleted: ex.sets,
                  completed: true,
                  rpe: ex.rpe,
                }))
              : [],
            routineTitle: workout.routineTitle,
          });

    countedWorkouts.push(workout);

    const current = bucketsByDate.get(dateKey) || { calories: 0, count: 0 };
    current.calories += Math.max(0, workoutKcal);
    current.count += 1;
    bucketsByDate.set(dateKey, current);
  }

  const weekDays: WeeklyDayCaloriesBucket[] = ORDERED_WEEK_DAYS_ES.map((wd, idx) => {
    const cur = new Date(mondayUtc);
    cur.setUTCDate(mondayUtc.getUTCDate() + idx);
    const dateKey = cur.toISOString().slice(0, 10);
    const dayNumber = String(cur.getUTCDate()).padStart(2, '0');
    const bucket = bucketsByDate.get(dateKey);

    return {
      weekdayName: wd.weekdayName,
      shortLabel: wd.shortLabel,
      dateKey,
      dayNumber,
      calories: bucket ? bucket.calories : 0,
      workoutsCount: bucket ? bucket.count : 0,
      isToday: dateKey === todayDateKey,
    };
  });

  const todayBucket = bucketsByDate.get(todayDateKey);
  const weeklyTotalCalories = weekDays.reduce((sum, d) => sum + d.calories, 0);
  const weeklyWorkoutsCount = weekDays.reduce((sum, d) => sum + d.workoutsCount, 0);

  return {
    todayDateKey,
    todayCalories: todayBucket ? todayBucket.calories : 0,
    todayWorkoutsCount: todayBucket ? todayBucket.count : 0,
    weeklyTotalCalories,
    weeklyWorkoutsCount,
    weekDays,
    isEstimated: true,
  };
}

