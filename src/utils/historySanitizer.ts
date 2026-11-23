import { CompletedWorkout } from '../types';
import {
  calculateWorkoutCaloriesBurned,
  getLocalDateKey,
  parseRobustDate,
  getChileWeekdayName,
  areWorkoutsSameSessionRetry,
  resolveWorkoutChileDateKey,
} from './calorieCalculator';

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
 * respetando el nombre legítimo asignado por el usuario (ej. "Viernes" o "Rutina Viernes").
 */
export function sanitizeRoutineTitleForDate(rawTitle: string | undefined, dateIsoOrKey: string): string {
  const actualDayName = getChileWeekdayName(dateIsoOrKey);

  if (!rawTitle || typeof rawTitle !== 'string' || !rawTitle.trim()) {
    return `Rutina ${actualDayName}`;
  }

  // 1. Si el título tiene separadores repetitivos por concatenación
  let clean = rawTitle
    .split(/[;|]+/)
    .map((part) => part.trim())
    .filter(Boolean)[0] || rawTitle.trim();

  // 2. Eliminar repeticiones en bucle de días de la semana dentro del mismo string
  // Ej: "Lunes Martes Miércoles Jueves Viernes" o "Rutina Lunes Rutina Lunes"
  const dayMatches = clean.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi);
  if (dayMatches && dayMatches.length > 1) {
    clean = `Rutina ${actualDayName}`;
  }

  // 3. Se respeta el nombre elegido por el usuario (ej. "Viernes", "Rutina Viernes", "Pecho y Bíceps"),
  // permitiendo que una rutina conserve su nombre aunque se entrene en otro día.
  return clean.slice(0, 80).trim() || `Rutina ${actualDayName}`;
}

/**
 * Valida el tiempo real de ejecución en segundos en base a las series completadas.
 * - Conserva cualquier duración positiva válida registrada (hasta 180 min).
 * - Si la sesión tiene un tiempo corrupto (> 180 min) o inválido (<= 0), estima ~3.5 min por serie.
 */
export function sanitizeWorkoutDurationSeconds(
  rawDurationSeconds: number | undefined,
  completedSetsCount: number,
  _exercisesCount?: number
): number {
  const MIN_ESTIMATED_SECONDS = 25 * 60; // 25 min mínimo al estimar
  const MAX_REALISTIC_SECONDS = 180 * 60; // 180 min máximo fisiológico

  const estimatedFromSetsSeconds = Math.min(
    120 * 60,
    Math.max(MIN_ESTIMATED_SECONDS, Math.round(Math.max(1, completedSetsCount) * 3.5 * 60))
  );

  const rawSec = Number(rawDurationSeconds) || 0;

  if (rawSec <= 0 || rawSec > MAX_REALISTIC_SECONDS) {
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
 * SCRIPT DE LIMPIEZA Y SANEAMIENTO SIN PÉRDIDAS:
 * - Escanea la base de datos histórica de entrenamientos.
 * - Descarta únicamente registros explícitamente eliminados o vacíos sin series completadas.
 * - Conserva múltiples sesiones reales del mismo día (solo deduplica reintentos con idéntico ID de sesión).
 * - Admite formatos históricos (`exercises` o `exercisesSummary`, `weight` o `weightKg`, `sets` numérico o arreglo).
 * - Conserva IDs, fechas, duraciones y valores originales.
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

  const seenIds = new Set<string>();
  const cleanedEntries: CompletedWorkout[] = [];
  let wasModified = false;

  // Ordenar por fecha descendente conservando índice original para evitar colisiones en registros sin ID
  const sortedInput = rawHistory
    .map((item, rawIdx) => ({ item, rawIdx }))
    .sort((a, b) => {
      const tsB = parseRobustDate(b.item?.date)?.getTime() || (b.item?.endTime || b.item?.startTime || 0);
      const tsA = parseRobustDate(a.item?.date)?.getTime() || (a.item?.endTime || a.item?.startTime || 0);
      return tsB - tsA;
    });

  for (const { item, rawIdx } of sortedInput) {
    const anyItem = item as any;
    if (!item || (!item.date && !anyItem?.completedAt && !item.endTime && !item.startTime)) {
      wasModified = true;
      continue;
    }

    if (anyItem.deleted === true || anyItem.isDeleted === true) {
      wasModified = true;
      continue;
    }

    const rawExercisesList: any[] =
      Array.isArray(item.exercisesSummary) && item.exercisesSummary.length > 0
        ? item.exercisesSummary
        : Array.isArray(anyItem.exercises)
          ? anyItem.exercises
          : [];

    const hasAnyCompletedSets =
      (typeof item.completedSetsCount === 'number' && item.completedSetsCount > 0) ||
      rawExercisesList.some((ex: any) => {
        if (!ex) return false;
        if (typeof ex.sets === 'number' && ex.sets > 0) return true;
        if (Array.isArray(ex.sets) && ex.sets.some((s: any) => s && (s.completed !== false || Number(s.weight ?? s.weightKg ?? 0) > 0 || Number(s.reps ?? 0) > 0))) return true;
        if (Array.isArray(ex.setsDetail) && ex.setsDetail.length > 0) return true;
        return false;
      });

    // Si explícitamente se marcó isFinished === false Y no tiene ninguna serie completada, descartar borrador vacío
    if (item.isFinished === false && !hasAnyCompletedSets) {
      wasModified = true;
      continue;
    }

    const executionTimestamp = item.endTime || item.startTime || parseRobustDate(anyItem.completedAt || item.date)?.getTime() || Date.now();
    const effectiveDateStr = new Date(executionTimestamp).toISOString();
    const dateKey = getLocalDateKey(effectiveDateStr);
    if (!dateKey) {
      wasModified = true;
      continue;
    }

    // Filtrar solo ejercicios que realmente tengan series completadas (> 0)
    const validExercises = rawExercisesList
      .map((ex: any) => {
        if (!ex) return null;
        const rawDetailSource: any[] | undefined =
          Array.isArray(ex.setsDetail) && ex.setsDetail.length > 0
            ? ex.setsDetail
            : Array.isArray(ex.sets)
              ? ex.sets
              : undefined;

        const sanitizedDetail = Array.isArray(rawDetailSource)
          ? rawDetailSource
              .filter((s: any) => {
                if (!s || typeof s !== 'object') return false;
                const w = Number(s.weight ?? s.weightKg ?? s.targetWeightKg ?? 0);
                const r = Number(s.reps ?? s.targetReps ?? 0);
                if (s.completed === false && w <= 0 && r <= 0) return false;
                return r > 0 || w > 0;
              })
              .map((s: any, sIdx: number) => {
                const entry: Record<string, unknown> = {
                  setNumber: Number(s.setNumber) > 0 ? Number(s.setNumber) : sIdx + 1,
                  weight: Number(s.weight ?? s.weightKg ?? s.targetWeightKg ?? 0) || 0,
                  reps: Math.max(0, Math.round(Number(s.reps ?? s.targetReps ?? 0) || 0)),
                };
                if (typeof s.id === 'string' && s.id.trim()) {
                  entry.id = s.id.trim();
                }
                if (typeof s.completed === 'boolean') {
                  entry.completed = s.completed;
                }
                if (typeof s.completedAt === 'string' && s.completedAt.trim()) {
                  entry.completedAt = s.completedAt.trim();
                }
                if (typeof s.rpe === 'number' && Number.isFinite(s.rpe) && s.rpe > 0) {
                  entry.rpe = Number(s.rpe);
                }
                if (typeof s.rir === 'number' && Number.isFinite(s.rir) && s.rir >= 0) {
                  entry.rir = Number(s.rir);
                }
                return entry;
              })
          : undefined;

        const setCount =
          typeof ex.sets === 'number' && ex.sets > 0
            ? ex.sets
            : sanitizedDetail && sanitizedDetail.length > 0
              ? sanitizedDetail.length
              : 0;

        const arrayVol = sanitizedDetail && sanitizedDetail.length > 0
          ? sanitizedDetail.reduce(
              (sum: number, s: any) => sum + Number(s.weight || 0) * Number(s.reps || 0),
              0
            )
          : undefined;

        const maxW = sanitizedDetail && sanitizedDetail.length > 0
          ? sanitizedDetail.reduce(
              (max: number, s: any) => Math.max(max, Number(s.weight || 0)),
              Number(ex.maxWeight ?? ex.bestWeightKg ?? ex.weightKg ?? ex.weight ?? 0)
            )
          : Number(ex.maxWeight ?? ex.bestWeightKg ?? ex.weightKg ?? ex.weight ?? 0);

        const maxR = sanitizedDetail && sanitizedDetail.length > 0
          ? sanitizedDetail.reduce(
              (max: number, s: any) => Math.max(max, Number(s.reps || 0)),
              Number(ex.maxReps ?? ex.bestReps ?? ex.reps ?? 0)
            )
          : Number(ex.maxReps ?? ex.bestReps ?? ex.reps ?? 0);

        const exName = String(ex.activeExerciseName || ex.name || ex.exerciseName || 'Ejercicio').trim();
        const cleanedEx: Record<string, unknown> = {
          ...ex,
          name: exName,
          sets: setCount,
          maxWeight: maxW,
          maxReps: maxR,
          volumeKg: typeof ex.volumeKg === 'number' && ex.volumeKg > 0 ? ex.volumeKg : arrayVol,
        };
        if (sanitizedDetail && sanitizedDetail.length > 0) {
          cleanedEx.setsDetail = sanitizedDetail;
        } else {
          delete cleanedEx.setsDetail;
        }
        return cleanedEx as any;
      })
      .filter((ex): ex is NonNullable<typeof ex> => ex !== null && ex.sets > 0);

    // Deduplicar ejercicios dentro de la misma sesión por ID + nombre normalizado sin perder series
    const uniqueExercisesMap = new Map<string, typeof validExercises[0]>();
    for (const ex of validExercises) {
      const key = `${(ex.exerciseId || '').trim().toLowerCase()}::${(ex.name || '').trim().toLowerCase()}`;
      if (!key || key === '::') continue;
      const clampedSets = Math.min(Math.max(ex.sets || 1, 1), 30);
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
        const existing = uniqueExercisesMap.get(key)!;
        const mergedDetail = [
          ...(Array.isArray(existing.setsDetail) ? existing.setsDetail : []),
          ...(Array.isArray(ex.setsDetail) ? ex.setsDetail : []),
        ].map((s, idx) => ({ ...s, setNumber: idx + 1 }));

        uniqueExercisesMap.set(key, {
          ...existing,
          sets: mergedDetail.length > 0 ? mergedDetail.length : Math.max(existing.sets, clampedSets),
          maxWeight: Math.max(existing.maxWeight, maxW),
          maxReps: Math.max(existing.maxReps, maxR),
          volumeKg: Math.max(existing.volumeKg || 0, vol),
          ...(mergedDetail.length > 0 ? { setsDetail: mergedDetail } : {}),
        });
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

    const cleanTitle = sanitizeRoutineTitleForDate(item.routineTitle, effectiveDateStr);

    const fallbackEndMs = parseRobustDate(effectiveDateStr)?.getTime() || Date.now();
    const endTimeMs = typeof item.endTime === 'number' && item.endTime > 0 ? item.endTime : fallbackEndMs;
    const cleanDurationSeconds = sanitizeWorkoutDurationSeconds(
      item.durationSeconds,
      recalculatedSetsCount
    );
    const startTimeMs =
      typeof item.startTime === 'number' && item.startTime > 0
        ? item.startTime
        : endTimeMs - cleanDurationSeconds * 1000;

    // Deduplicación estricta:
    // 1. Por ID estable de sesión (para reintentos)
    const trimmedId = typeof item.id === 'string' ? item.id.trim() : '';
    if (trimmedId) {
      if (seenIds.has(trimmedId)) {
        wasModified = true;
        continue;
      }
      seenIds.add(trimmedId);
    }

    const durationMinutes = Math.round(cleanDurationSeconds / 60);

    const cleanCalories =
      typeof item.caloriesBurned === 'number' && item.caloriesBurned > 0 && item.caloriesBurned <= 2500
        ? Math.round(item.caloriesBurned)
        : calculateWorkoutCaloriesBurned({
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

    const resolvedId = trimmedId || `workout-${dateKey}-entry-${rawIdx}`;

    const candidateEntry: CompletedWorkout = {
      ...item,
      id: resolvedId,
      routineTitle: cleanTitle,
      date: effectiveDateStr,
      startTime: startTimeMs,
      endTime: endTimeMs,
      durationSeconds: cleanDurationSeconds,
      totalVolumeKg: recalculatedVolumeKg,
      completedSetsCount: recalculatedSetsCount,
      caloriesBurned: cleanCalories,
      isFinished: true,
      exercisesSummary: deduplicatedExercises,
    };

    // 2. Comprobar si esta sesión ya existe en el historial del mismo día local de Chile
    // (ej. copia recuperada o reintento de guardado duplicado con distinto ID o título corregido previamente)
    const duplicateIdx = cleanedEntries.findIndex((existing) =>
      areWorkoutsSameSessionRetry(existing, candidateEntry)
    );

    if (duplicateIdx !== -1) {
      const existing = cleanedEntries[duplicateIdx];
      const existingDetailedSets = (existing.exercisesSummary || []).reduce(
        (acc, ex) => acc + (Array.isArray(ex.setsDetail) ? ex.setsDetail.length : 0),
        0
      );
      const candidateDetailedSets = (candidateEntry.exercisesSummary || []).reduce(
        (acc, ex) => acc + (Array.isArray(ex.setsDetail) ? ex.setsDetail.length : 0),
        0
      );
      const isGenericDayTitle = (t: string) =>
        /^rutina\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$/i.test((t || '').trim());

      const existingScore =
        existingDetailedSets * 10 +
        (isGenericDayTitle(existing.routineTitle) ? 0 : 50) +
        (existing.id.startsWith('recovered-') ? 0 : 20);
      const candidateScore =
        candidateDetailedSets * 10 +
        (isGenericDayTitle(candidateEntry.routineTitle) ? 0 : 50) +
        (candidateEntry.id.startsWith('recovered-') ? 0 : 20);

      if (candidateScore > existingScore) {
        // Conservar setsDetail si el existente tenía alguno que el candidato no tiene
        const mergedExercises = candidateEntry.exercisesSummary.map((ex) => {
          if (Array.isArray(ex.setsDetail) && ex.setsDetail.length > 0) return ex;
          const matchEx = existing.exercisesSummary.find(
            (e) => e.name.trim().toLowerCase() === ex.name.trim().toLowerCase()
          );
          return matchEx?.setsDetail?.length ? { ...ex, setsDetail: matchEx.setsDetail } : ex;
        });
        cleanedEntries[duplicateIdx] = {
          ...candidateEntry,
          exercisesSummary: mergedExercises,
        };
      } else if (candidateDetailedSets > 0 && existingDetailedSets === 0) {
        const mergedExercises = existing.exercisesSummary.map((ex) => {
          if (Array.isArray(ex.setsDetail) && ex.setsDetail.length > 0) return ex;
          const matchEx = candidateEntry.exercisesSummary.find(
            (e) => e.name.trim().toLowerCase() === ex.name.trim().toLowerCase()
          );
          return matchEx?.setsDetail?.length ? { ...ex, setsDetail: matchEx.setsDetail } : ex;
        });
        cleanedEntries[duplicateIdx] = {
          ...existing,
          exercisesSummary: mergedExercises,
        };
      }

      wasModified = true;
      continue;
    }

    if (
      item.routineTitle !== cleanTitle ||
      item.date !== effectiveDateStr ||
      item.durationSeconds !== cleanDurationSeconds ||
      item.totalVolumeKg !== recalculatedVolumeKg ||
      item.completedSetsCount !== recalculatedSetsCount ||
      !trimmedId
    ) {
      wasModified = true;
    }

    cleanedEntries.push(candidateEntry);
  }

  const cleanedHistory = cleanedEntries.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  if (cleanedHistory.length !== rawHistory.length) {
    wasModified = true;
  }

  const formattedRows: SanitizedDailyWorkoutRow[] = cleanedHistory.map((w) => ({
    dateKey: resolveWorkoutChileDateKey(w) || getLocalDateKey(w.date),
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
