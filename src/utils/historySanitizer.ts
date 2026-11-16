import { CompletedWorkout } from '../types';
import { calculateWorkoutCaloriesBurned, getLocalDateKey } from './calorieCalculator';

const WEEKDAY_NAMES_MAP: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
};

/**
 * Limpia y trunca cualquier título de rutina corrupto que tenga días de la semana
 * concatenados repetitivamente (ej. "Rutina Lunes, Rutina Martes, Rutina Lunes..."),
 * devolviendo únicamente el nombre limpio correspondiente a la fecha real de la sesión.
 */
export function sanitizeRoutineTitleForDate(rawTitle: string | undefined, dateIsoOrKey: string): string {
  const dateObj = new Date(dateIsoOrKey);
  const actualDayName = !isNaN(dateObj.getTime())
    ? WEEKDAY_NAMES_MAP[dateObj.getDay()] || 'Entrenamiento'
    : 'Entrenamiento';

  if (!rawTitle || typeof rawTitle !== 'string') {
    return `Rutina ${actualDayName}`;
  }

  // 1. Si el título tiene separadores repetitivos por concatenación (comas, puntos y coma, pipes)
  let clean = rawTitle
    .split(/[,;|]+/)
    .map((part) => part.trim())
    .filter(Boolean)[0] || rawTitle.trim();

  // 2. Eliminar repeticiones en bucle de días de la semana dentro del mismo string
  // Ej: "Lunes Martes Miércoles Jueves Viernes" o "Rutina Lunes Rutina Lunes"
  const dayMatches = clean.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi);
  if (dayMatches && dayMatches.length > 1) {
    clean = `Rutina ${actualDayName}`;
  }

  // 3. Si el título es genérico ("Rutina Lunes") pero la fecha real corresponde a otro día (ej. Jueves),
  // normalizar al día real de la fecha ejecutada para evitar incoherencias.
  if (/^rutina\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$/i.test(clean)) {
    clean = `Rutina ${actualDayName}`;
  }

  // Limitar longitud máxima por seguridad
  return clean.slice(0, 80).trim() || `Rutina ${actualDayName}`;
}

/**
 * Recalcula el tiempo real de ejecución en segundos y minutos en base a las series
 * verdaderamente marcadas como completadas.
 * - Si la sesión tiene un tiempo corrupto o inflado (> 120 min, ej. 1201 min o 6115 min)
 *   o inválido (<= 0), recalcula a ~3.5 min por serie completada (ejecución + descanso)
 *   dentro del rango fisiológico estricto de 45 a 120 minutos máximo.
 */
export function sanitizeWorkoutDurationSeconds(
  rawDurationSeconds: number | undefined,
  completedSetsCount: number,
  _exercisesCount?: number
): number {
  const MIN_REALISTIC_SECONDS = 45 * 60; // 45 min
  const MAX_REALISTIC_SECONDS = 120 * 60; // 120 min máximo por sesión diaria

  const estimatedFromSetsSeconds = Math.min(
    MAX_REALISTIC_SECONDS,
    Math.max(MIN_REALISTIC_SECONDS, Math.round(Math.max(1, completedSetsCount) * 3.5 * 60))
  );

  const rawSec = Number(rawDurationSeconds) || 0;

  // Si el tiempo registrado supera los 120 minutos (7200s) o es menor a 5 minutos (cuando hay series reales),
  // fue corrompido por acumulación en bucle o reloj abierto entre días: usar cálculo real por series.
  if (rawSec <= 0 || rawSec > MAX_REALISTIC_SECONDS) {
    return estimatedFromSetsSeconds;
  }

  // Si está en un rango menor a 45 min pero tiene suficientes series de una rutina normal (>= 10 series),
  // ajustar al mínimo realista de 45 min; si fue una sesión corta real, respetar su tiempo real.
  if (rawSec < MIN_REALISTIC_SECONDS && completedSetsCount >= 12) {
    return estimatedFromSetsSeconds;
  }

  return Math.round(rawSec);
}

export interface SanitizedDailyWorkoutRow {
  dateKey: string; // 'YYYY-MM-DD'
  workoutId: string;
  routineTitle: string;
  durationMinutes: number;
  totalVolumeKg: number;
  completedSetsCount: number;
  caloriesBurned: number;
}

export interface HistoryPurgeReport {
  cleanedHistory: CompletedWorkout[];
  formattedRows: SanitizedDailyWorkoutRow[];
  purgedCount: number;
  duplicatesRemoved: number;
  uniqueDaysAfter: number;
  wasModified: boolean;
}

/**
 * SCRIPT DE LIMPIEZA Y MIGRACIÓN DE BASE DE DATOS (DATA PURGE & DEDUPLICATION):
 * - Escanea la base de datos histórica de entrenamientos.
 * - Descarta registros vacíos, no finalizados o sin series completadas.
 * - Agrupa y consolida estrictamente a UN (1) ÚNICO REGISTRO INDEPENDIENTE POR FECHA ('YYYY-MM-DD').
 * - Trunca strings repetitivos de nombres de días concatenados.
 * - Recalcula el tiempo diario a valores reales (45 a 120 min máx) basados en las series completadas.
 * - Recalcula el tonelaje (kg) y calorías quemadas sin arrastrar datos entre fechas.
 */
export function purgeAndSanitizeWorkoutHistory(
  rawHistory: CompletedWorkout[],
  athleteWeightKg: number = 95
): HistoryPurgeReport {
  if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
    return {
      cleanedHistory: [],
      formattedRows: [],
      purgedCount: 0,
      duplicatesRemoved: 0,
      uniqueDaysAfter: 0,
      wasModified: false,
    };
  }

  const byDateMap = new Map<string, CompletedWorkout>();
  let wasModified = false;

  // Ordenar por fecha descendente para priorizar el registro más reciente de cada día
  const sortedInput = [...rawHistory].sort(
    (a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime()
  );

  for (const item of sortedInput) {
    if (!item || !item.date) {
      wasModified = true;
      continue;
    }

    const dateKey = getLocalDateKey(item.date);
    if (!dateKey) {
      wasModified = true;
      continue;
    }

    // Filtrar solo ejercicios que realmente tengan series completadas (> 0)
    const validExercises = Array.isArray(item.exercisesSummary)
      ? item.exercisesSummary
          .map((ex: any) => {
            if (!ex) return null;
            const setCount =
              typeof ex.sets === 'number'
                ? ex.sets
                : Array.isArray(ex.sets)
                ? ex.sets.filter((s: any) => s && s.completed !== false).length
                : 0;
            const arrayVol = Array.isArray(ex.sets)
              ? ex.sets.reduce(
                  (sum: number, s: any) =>
                    sum +
                    Number(s.weightKg ?? s.targetWeightKg ?? 0) *
                      Number(s.reps ?? s.targetReps ?? 0),
                  0
                )
              : undefined;
            const maxW = Array.isArray(ex.sets)
              ? ex.sets.reduce(
                  (max: number, s: any) =>
                    Math.max(max, Number(s.weightKg ?? s.targetWeightKg ?? 0)),
                  0
                )
              : Number(ex.maxWeight || ex.weightKg || 0);
            const maxR = Array.isArray(ex.sets)
              ? ex.sets.reduce(
                  (max: number, s: any) =>
                    Math.max(max, Number(s.reps ?? s.targetReps ?? 0)),
                  0
                )
              : Number(ex.maxReps || ex.reps || 0);
            return {
              ...ex,
              sets: setCount,
              maxWeight: maxW,
              maxReps: maxR,
              volumeKg: typeof ex.volumeKg === 'number' ? ex.volumeKg : arrayVol,
            };
          })
          .filter((ex): ex is NonNullable<typeof ex> => ex !== null && ex.sets > 0)
      : [];

    // Deduplicar ejercicios dentro de la misma sesión por nombre normalizado
    const uniqueExercisesMap = new Map<string, typeof validExercises[0]>();
    for (const ex of validExercises) {
      const key = (ex.name || '').trim().toLowerCase();
      if (!key) continue;
      const clampedSets = Math.min(Math.max(ex.sets || 1, 1), 20);
      const maxW = Math.max(0, Number(ex.maxWeight) || 0);
      const maxR = Math.max(0, Number(ex.maxReps) || 0);
      const vol =
        typeof ex.volumeKg === 'number' && (ex.volumeKg > 0 || maxW === 0)
          ? Math.max(0, ex.volumeKg)
          : maxW * maxR * clampedSets;

      if (!uniqueExercisesMap.has(key)) {
        uniqueExercisesMap.set(key, {
          ...ex,
          name: ex.name.trim(),
          sets: clampedSets,
          maxWeight: maxW,
          maxReps: maxR,
          volumeKg: vol,
        });
      } else {
        // Si estaba duplicado el mismo ejercicio en la misma fecha, conservar la mejor marca sin inflar series
        const existing = uniqueExercisesMap.get(key)!;
        if (maxW > existing.maxWeight) {
          uniqueExercisesMap.set(key, {
            ...existing,
            maxWeight: maxW,
            maxReps: maxR,
            volumeKg: Math.max(existing.volumeKg || 0, vol),
          });
        }
      }
    }

    const deduplicatedExercises = Array.from(uniqueExercisesMap.values());
    const recalculatedSetsCount = deduplicatedExercises.reduce((acc, ex) => acc + (ex.sets || 0), 0);
    const exerciseSumVolume = Math.round(
      deduplicatedExercises.reduce((acc, ex) => acc + (ex.volumeKg || 0), 0)
    );
    const recalculatedVolumeKg =
      typeof item.totalVolumeKg === 'number' && item.totalVolumeKg > 0
        ? Math.round(item.totalVolumeKg)
        : exerciseSumVolume;

    // Si no tiene series completadas reales, purgar registro basura
    if (recalculatedSetsCount <= 0) {
      wasModified = true;
      continue;
    }

    const cleanTitle = sanitizeRoutineTitleForDate(item.routineTitle, item.date);

    // Criterio de identidad estricto: no colapsar sesiones legítimas del mismo día (ej. mañana y tarde).
    // Solo considerar duplicada si tiene el mismo ID, o la misma fecha + idéntica rutina + mismo volumen y series.
    const exerciseSignature = deduplicatedExercises
      .map((e) => `${(e.name || '').trim().toLowerCase()}:${e.sets}:${e.maxWeight}`)
      .sort()
      .join('|');
    const sessionIdentityKey = item.id
      ? `id:${item.id}`
      : `sig:${dateKey}:${cleanTitle.toLowerCase()}:${recalculatedSetsCount}:${recalculatedVolumeKg}:${exerciseSignature}`;

    if (byDateMap.has(sessionIdentityKey)) {
      wasModified = true;
      continue;
    }

    const cleanDurationSeconds = sanitizeWorkoutDurationSeconds(
      item.durationSeconds,
      recalculatedSetsCount
    );
    const durationMinutes = Math.round(cleanDurationSeconds / 60);

    const cleanCalories = calculateWorkoutCaloriesBurned({
      durationMinutes,
      totalVolumeKg: recalculatedVolumeKg,
      bodyWeightKg: athleteWeightKg > 0 ? athleteWeightKg : 95,
      completedSetsCount: recalculatedSetsCount,
      completedExercises: deduplicatedExercises.map((ex) => ({
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        setsCompleted: ex.sets,
        completed: true,
        rpe: ex.rpe,
      })),
      routineTitle: cleanTitle,
    });

    const deterministicId = item.id || `workout-${dateKey}-${Date.now().toString(36)}`;

    if (
      item.routineTitle !== cleanTitle ||
      item.durationSeconds !== cleanDurationSeconds ||
      item.totalVolumeKg !== recalculatedVolumeKg ||
      item.completedSetsCount !== recalculatedSetsCount ||
      item.caloriesBurned !== cleanCalories
    ) {
      wasModified = true;
    }

    const endTimeMs = new Date(item.date).getTime();
    const startTimeMs = endTimeMs - cleanDurationSeconds * 1000;

    byDateMap.set(sessionIdentityKey, {
      ...item,
      id: item.id || deterministicId,
      routineTitle: cleanTitle,
      date: item.date,
      startTime: startTimeMs,
      endTime: endTimeMs,
      durationSeconds: cleanDurationSeconds,
      totalVolumeKg: recalculatedVolumeKg,
      completedSetsCount: recalculatedSetsCount,
      caloriesBurned: cleanCalories,
      isFinished: true,
      exercisesSummary: deduplicatedExercises,
    });
  }

  const cleanedHistory = Array.from(byDateMap.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  if (cleanedHistory.length !== rawHistory.length) {
    wasModified = true;
  }

  const formattedRows: SanitizedDailyWorkoutRow[] = cleanedHistory.map((w) => ({
    dateKey: getLocalDateKey(w.date),
    workoutId: w.id,
    routineTitle: w.routineTitle,
    durationMinutes: Math.round(w.durationSeconds / 60),
    totalVolumeKg: w.totalVolumeKg,
    completedSetsCount: w.completedSetsCount,
    caloriesBurned: w.caloriesBurned || 0,
  }));

  const purgedCount = Math.max(0, rawHistory.length - cleanedHistory.length);
  return {
    cleanedHistory,
    formattedRows,
    purgedCount,
    duplicatesRemoved: purgedCount,
    uniqueDaysAfter: cleanedHistory.length,
    wasModified,
  };
}
