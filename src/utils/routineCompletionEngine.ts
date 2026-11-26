/**
 * LAZCAKONG GYM — Canonical Routine Completion & Retroactive Repair Engine
 *
 * Strictly separates:
 *  - routineId & scheduledDay: WHICH scheduled routine was performed (e.g., "Miércoles")
 *  - startedAt, completedAt & executionDateKey: WHEN it was actually performed in America/Santiago (e.g., "2026-11-26" Jueves)
 *
 * Guarantees:
 *  - Routine completion checkmarks mark ONLY the executed routine's ID & scheduledDay (never today's weekday by mistake).
 *  - Calories, daily history, volume, and muscle recovery remain strictly anchored to real execution time in America/Santiago.
 *  - Delayed or early routines and multiple routines on the same day all register accurately without overwriting other days.
 *  - Legacy/corrupted historical records are repaired non-destructively ONLY when history unambiguously identifies the executed routine.
 */
import type { CompletedWorkout, Routine } from '../types/index.ts';
import {
  getChileLocalDateKey,
  getChileWeekdayIndex,
  getChileWeekdayName,
  resolveWorkoutChileDateKey,
} from './calorieCalculator.ts';
import { getWeekIdentifier } from './weeklyCycleManager.ts';

export type CanonicalWeekday =
  | 'Lunes'
  | 'Martes'
  | 'Miércoles'
  | 'Jueves'
  | 'Viernes'
  | 'Sábado'
  | 'Domingo';

export const CANONICAL_WEEKDAYS_ORDERED: readonly CanonicalWeekday[] = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

function normalizeKey(raw?: string | null): string {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves a canonical Spanish weekday ONLY if explicitly present in the string.
 * Unlike permissive resolvers, NEVER falls back to 'Lunes' or execution date.
 */
export function resolveCanonicalWeekdayStrict(raw?: string | null): CanonicalWeekday | null {
  const norm = normalizeKey(raw);
  if (!norm) return null;

  if (/\blunes\b/.test(norm) || norm === 'lun' || /\bdia\s*1\b/.test(norm) || /\bday\s*1\b/.test(norm)) {
    return 'Lunes';
  }
  if (/\bmartes\b/.test(norm) || norm === 'mar' || /\bdia\s*2\b/.test(norm) || /\bday\s*2\b/.test(norm)) {
    return 'Martes';
  }
  if (/\bmiercoles\b/.test(norm) || norm === 'mie' || /\bdia\s*3\b/.test(norm) || /\bday\s*3\b/.test(norm)) {
    return 'Miércoles';
  }
  if (/\bjueves\b/.test(norm) || norm === 'jue' || /\bdia\s*4\b/.test(norm) || /\bday\s*4\b/.test(norm)) {
    return 'Jueves';
  }
  if (/\bviernes\b/.test(norm) || norm === 'vie' || /\bdia\s*5\b/.test(norm) || /\bday\s*5\b/.test(norm)) {
    return 'Viernes';
  }
  if (/\bsabado\b/.test(norm) || norm === 'sab' || /\bdia\s*6\b/.test(norm) || /\bday\s*6\b/.test(norm)) {
    return 'Sábado';
  }
  if (/\bdomingo\b/.test(norm) || norm === 'dom' || /\bdia\s*7\b/.test(norm) || /\bday\s*7\b/.test(norm)) {
    return 'Domingo';
  }
  return null;
}

export function isGenericExecutionDayTitle(rawTitle?: string | null): boolean {
  const norm = normalizeKey(rawTitle);
  return /^(rutina\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)$/.test(norm);
}

export function isGenericOrMissingRoutineId(routineId?: string | null): boolean {
  const clean = String(routineId || '').trim().toLowerCase();
  return (
    !clean ||
    clean === 'rutina-historica' ||
    clean === 'unknown' ||
    clean.startsWith('csv-routine-') ||
    clean.startsWith('recovered-')
  );
}

export function isFreeWorkoutRoutineId(routineId?: string | null): boolean {
  const clean = String(routineId || '').trim().toLowerCase();
  return clean.startsWith('libre-') || clean === 'libre' || clean === 'free-workout';
}

export interface ChileWeekBounds {
  todayDateKey: string;
  todayIndex: number; // 0 = Dom, 1 = Lun, ..., 6 = Sáb
  mondayDateKey: string;
  sundayDateKey: string;
  weekId: string;
  mondayUtc: Date;
}

/**
 * Computes exact Monday -> Sunday week boundaries in America/Santiago.
 * Immune to UTC rollover around midnight and DST changes (UTC-3 / UTC-4).
 */
export function getChileWeekBounds(
  referenceDate: Date = new Date(),
  weekOffset: number = 0
): ChileWeekBounds {
  const todayDateKey = getChileLocalDateKey(referenceDate);
  const todayIndex = getChileWeekdayIndex(todayDateKey);
  const [y, m, d] = todayDateKey.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(y || 2026, (m || 11) - 1, d || 26, 12, 0, 0));

  const diffToMonday = todayIndex === 0 ? -6 : 1 - todayIndex;
  const mondayUtc = new Date(noonUtc);
  mondayUtc.setUTCDate(noonUtc.getUTCDate() + diffToMonday + weekOffset * 7);

  const sundayUtc = new Date(mondayUtc);
  sundayUtc.setUTCDate(mondayUtc.getUTCDate() + 6);

  const mondayDateKey = mondayUtc.toISOString().slice(0, 10);
  const sundayDateKey = sundayUtc.toISOString().slice(0, 10);
  const weekId = getWeekIdentifier(mondayUtc);

  return {
    todayDateKey,
    todayIndex,
    mondayDateKey,
    sundayDateKey,
    weekId,
    mondayUtc,
  };
}

export interface ExecutedRoutineResolution {
  routineId: string;
  scheduledDay: CanonicalWeekday | null;
  matchedRoutine: Routine | null;
  source: 'routineId' | 'scheduledDay' | 'exercises_unambiguous' | 'routineTitle' | 'unscheduled';
}

function collectRoutineExerciseTokens(routine: Routine): {
  ids: Set<string>;
  names: Set<string>;
} {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const ex of routine.exercises || []) {
    if (!ex) continue;
    if (ex.id) ids.add(String(ex.id).trim().toLowerCase());
    if (ex.libraryExerciseId) ids.add(String(ex.libraryExerciseId).trim().toLowerCase());
    const n = normalizeKey(ex.name);
    if (n) names.add(n);
  }
  return { ids, names };
}

function matchRoutineUnambiguouslyByExercises(
  workout: Partial<CompletedWorkout>,
  routines: Routine[]
): { routine: Routine; score: number; matchedCount: number } | null {
  const exList = Array.isArray(workout.exercisesSummary) ? workout.exercisesSummary : [];
  if (exList.length === 0 || routines.length === 0) return null;

  const scored: Array<{ routine: Routine; score: number; matchedCount: number }> = [];

  for (const r of routines) {
    if (!r || !Array.isArray(r.exercises) || r.exercises.length === 0) continue;
    const tokens = collectRoutineExerciseTokens(r);
    let matchedCount = 0;

    for (const wEx of exList) {
      if (!wEx) continue;
      const candIds = [wEx.originalExerciseId, wEx.exerciseId, wEx.libraryExerciseId]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim().toLowerCase());
      const candNames = [wEx.originalExerciseName, wEx.name]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => normalizeKey(v))
        .filter(Boolean);

      const idHit = candIds.some((id) => tokens.ids.has(id));
      const nameHit = candNames.some((n) => tokens.names.has(n));
      if (idHit || nameHit) {
        matchedCount += 1;
      }
    }

    if (matchedCount > 0) {
      const precision = matchedCount / exList.length;
      const recall = matchedCount / r.exercises.length;
      const score = precision * 0.7 + recall * 0.3;
      scored.push({ routine: r, score, matchedCount });
    }
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score || b.matchedCount - a.matchedCount);

  const best = scored[0];
  const second = scored[1];
  const minMatchedRequired = exList.length === 1 ? 1 : 2;

  if (best.matchedCount < minMatchedRequired || best.score < 0.5) {
    return null;
  }

  // Must be strictly unambiguous against runner-up routine
  if (second && best.score - second.score < 0.2) {
    return null;
  }

  return best;
}

/**
 * Unambiguously identifies which routine (routineId + scheduledDay) a completed workout represents.
 * Strictly independent of the calendar date on which the workout was actually performed.
 */
export function inferExecutedRoutineIdentity(
  workout: Partial<CompletedWorkout> | null | undefined,
  routines: Routine[] = []
): ExecutedRoutineResolution {
  if (!workout) {
    return { routineId: '', scheduledDay: null, matchedRoutine: null, source: 'unscheduled' };
  }

  const safeRoutines = Array.isArray(routines) ? routines.filter(Boolean) : [];
  const rawRoutineId = String(workout.routineId || '').trim();
  const explicitScheduledDay = resolveCanonicalWeekdayStrict(workout.scheduledDay);

  // Free workouts never mark a scheduled routine unless explicitly linked to a real routineId
  if (isFreeWorkoutRoutineId(rawRoutineId) && !explicitScheduledDay) {
    return {
      routineId: rawRoutineId,
      scheduledDay: null,
      matchedRoutine: null,
      source: 'unscheduled',
    };
  }

  // 1. Direct exact match by routineId in current athlete's routines (highest authority)
  if (rawRoutineId && !isGenericOrMissingRoutineId(rawRoutineId)) {
    const byId = safeRoutines.find((r) => r.id === rawRoutineId) || null;
    if (byId) {
      const routineDay =
        resolveCanonicalWeekdayStrict(byId.dayName) ||
        resolveCanonicalWeekdayStrict(byId.title) ||
        explicitScheduledDay;
      return {
        routineId: byId.id,
        scheduledDay: routineDay,
        matchedRoutine: byId,
        source: 'routineId',
      };
    }
  }

  // 2. Explicit scheduledDay saved on the workout record
  if (explicitScheduledDay) {
    const matchingDayRoutines = safeRoutines.filter(
      (r) =>
        (resolveCanonicalWeekdayStrict(r.dayName) || resolveCanonicalWeekdayStrict(r.title)) ===
        explicitScheduledDay
    );
    const matchedRoutine =
      matchingDayRoutines.find((r) => r.id === rawRoutineId) ||
      (matchingDayRoutines.length === 1 ? matchingDayRoutines[0] : null);
    return {
      routineId: matchedRoutine?.id || rawRoutineId,
      scheduledDay: explicitScheduledDay,
      matchedRoutine,
      source: 'scheduledDay',
    };
  }

  // 3. Unambiguous exercise fingerprint match (repairs legacy records with missing routineId or mislabeled execution-day title)
  const exerciseMatch = matchRoutineUnambiguouslyByExercises(workout, safeRoutines);
  const titleDay = resolveCanonicalWeekdayStrict(workout.routineTitle);
  const executionDateKey = resolveWorkoutChileDateKey(workout);
  const executionWeekday = executionDateKey ? resolveCanonicalWeekdayStrict(getChileWeekdayName(executionDateKey)) : null;

  if (exerciseMatch) {
    const matchedDay =
      resolveCanonicalWeekdayStrict(exerciseMatch.routine.dayName) ||
      resolveCanonicalWeekdayStrict(exerciseMatch.routine.title);
    const titleMatchesExecutionDayGenerically =
      Boolean(titleDay && executionWeekday && titleDay === executionWeekday && isGenericExecutionDayTitle(workout.routineTitle));

    // Trust unambiguous exercise match whenever routineId is missing/generic, title has no weekday,
    // or title was generically overwritten with the execution weekday (e.g. "Rutina Jueves" for Wednesday's exercises)
    if (
      isGenericOrMissingRoutineId(rawRoutineId) ||
      !titleDay ||
      titleMatchesExecutionDayGenerically ||
      titleDay === matchedDay
    ) {
      return {
        routineId: isGenericOrMissingRoutineId(rawRoutineId) ? exerciseMatch.routine.id : rawRoutineId,
        scheduledDay: matchedDay,
        matchedRoutine: exerciseMatch.routine,
        source: 'exercises_unambiguous',
      };
    }
  }

  // 4. Exact non-generic routine title match against routines
  const normWorkoutTitle = normalizeKey(workout.routineTitle);
  if (normWorkoutTitle) {
    const exactTitleMatches = safeRoutines.filter((r) => normalizeKey(r.title) === normWorkoutTitle);
    if (exactTitleMatches.length === 1) {
      const r = exactTitleMatches[0];
      return {
        routineId: isGenericOrMissingRoutineId(rawRoutineId) ? r.id : rawRoutineId,
        scheduledDay: resolveCanonicalWeekdayStrict(r.dayName) || resolveCanonicalWeekdayStrict(r.title),
        matchedRoutine: r,
        source: 'routineTitle',
      };
    }
  }

  // 5. Explicit weekday in routineTitle (e.g., "Miércoles", "Viernes: Pierna")
  if (titleDay) {
    const matchingDayRoutines = safeRoutines.filter(
      (r) =>
        (resolveCanonicalWeekdayStrict(r.dayName) || resolveCanonicalWeekdayStrict(r.title)) ===
        titleDay
    );
    const matchedRoutine = matchingDayRoutines.length === 1 ? matchingDayRoutines[0] : null;
    return {
      routineId: isGenericOrMissingRoutineId(rawRoutineId) && matchedRoutine ? matchedRoutine.id : rawRoutineId,
      scheduledDay: titleDay,
      matchedRoutine,
      source: 'routineTitle',
    };
  }

  // 6. Cannot be unambiguously mapped to a scheduled weekday -> keep unscheduled (NEVER guess today's weekday)
  return {
    routineId: rawRoutineId,
    scheduledDay: null,
    matchedRoutine: null,
    source: 'unscheduled',
  };
}

export interface HistoryRoutineRepairReport {
  repairedHistory: CompletedWorkout[];
  repairedCount: number;
  wasModified: boolean;
}

/**
 * Non-destructively enriches and repairs routine attribution metadata (`scheduledDay`, `startedAt`,
 * `completedAt`, `executionDateKey`, `weekId`, and unambiguous legacy `routineId`/`routineTitle`)
 * while preserving 100% of weights, reps, sets, setsDetail, calories, volume, and execution dates.
 */
export function repairWorkoutRoutineMetadata(
  history: CompletedWorkout[] = [],
  routines: Routine[] = [],
  profileId?: string
): HistoryRoutineRepairReport {
  if (!Array.isArray(history) || history.length === 0) {
    return { repairedHistory: [], repairedCount: 0, wasModified: false };
  }

  let repairedCount = 0;
  let wasModified = false;

  const repairedHistory = history.map((w) => {
    if (!w || typeof w !== 'object') return w;
    // Never touch another athlete's record if profileId is specified and mismatches
    if (profileId && w.profileId && w.profileId !== profileId) {
      return w;
    }

    const endMs =
      typeof w.endTime === 'number' && w.endTime > 0
        ? w.endTime
        : new Date(w.completedAt || w.date).getTime();
    const validEndMs = Number.isFinite(endMs) && endMs > 0 ? endMs : Date.now();
    const startMs =
      typeof w.startTime === 'number' && w.startTime > 0
        ? w.startTime
        : validEndMs - Math.max(60, w.durationSeconds || 1800) * 1000;

    const completedAt =
      typeof w.completedAt === 'string' && w.completedAt.trim()
        ? w.completedAt.trim()
        : new Date(validEndMs).toISOString();
    const startedAt =
      typeof w.startedAt === 'string' && w.startedAt.trim()
        ? w.startedAt.trim()
        : new Date(startMs).toISOString();
    const executionDateKey =
      resolveWorkoutChileDateKey({ ...w, completedAt }) || getChileLocalDateKey(validEndMs);
    const weekId =
      executionDateKey
        ? getWeekIdentifier(
            new Date(
              Date.UTC(
                Number(executionDateKey.slice(0, 4)) || 2026,
                (Number(executionDateKey.slice(5, 7)) || 11) - 1,
                Number(executionDateKey.slice(8, 10)) || 26,
                12,
                0,
                0
              )
            )
          )
        : w.weekId;

    const resolved = inferExecutedRoutineIdentity(w, routines);
    const nextScheduledDay = resolved.scheduledDay || undefined;
    const nextRoutineId = resolved.routineId || w.routineId;

    // Only repair a generic execution-day routineTitle (e.g. "Rutina Jueves") if we unambiguously
    // identified a different scheduled routine via routineId or exercises
    let nextRoutineTitle = w.routineTitle;
    if (
      resolved.matchedRoutine &&
      (resolved.source === 'routineId' || resolved.source === 'exercises_unambiguous') &&
      isGenericExecutionDayTitle(w.routineTitle)
    ) {
      const titleDay = resolveCanonicalWeekdayStrict(w.routineTitle);
      if (titleDay && nextScheduledDay && titleDay !== nextScheduledDay) {
        nextRoutineTitle = resolved.matchedRoutine.title || resolved.matchedRoutine.dayName;
      }
    }

    const changed =
      w.scheduledDay !== nextScheduledDay ||
      w.startedAt !== startedAt ||
      w.completedAt !== completedAt ||
      w.executionDateKey !== executionDateKey ||
      w.weekId !== weekId ||
      w.routineId !== nextRoutineId ||
      w.routineTitle !== nextRoutineTitle;

    if (!changed) return w;

    wasModified = true;
    if (w.scheduledDay !== nextScheduledDay || w.routineId !== nextRoutineId || w.routineTitle !== nextRoutineTitle) {
      repairedCount += 1;
    }

    const updated: CompletedWorkout = {
      ...w,
      routineId: nextRoutineId,
      routineTitle: nextRoutineTitle,
      startedAt,
      completedAt,
      executionDateKey,
      weekId,
    };
    if (nextScheduledDay) {
      updated.scheduledDay = nextScheduledDay;
    } else {
      delete updated.scheduledDay;
    }
    return updated;
  });

  return {
    repairedHistory,
    repairedCount,
    wasModified,
  };
}

export interface ScheduledDayComplianceEntry {
  scheduledDay: CanonicalWeekday;
  isCompleted: boolean;
  workouts: CompletedWorkout[];
  routineIds: string[];
  lastExecutedDateKey: string | null;
  lastCompletedAt: string | null;
  totalVolumeKg: number;
}

export interface WeeklyRoutineComplianceResult {
  weekId: string;
  mondayDateKey: string;
  sundayDateKey: string;
  todayDateKey: string;
  todayIndex: number;
  mondayUtc: Date;
  completedRoutineIds: Set<string>;
  completedByScheduledDay: Record<CanonicalWeekday, ScheduledDayComplianceEntry>;
  unscheduledWorkoutsByDateKey: Record<string, CompletedWorkout[]>;
  completedWorkoutsInWeek: CompletedWorkout[];
}

/**
 * Evaluates weekly routine compliance strictly by `routineId` and `scheduledDay`
 * within the America/Santiago Monday-to-Sunday weekly cycle.
 */
export function evaluateWeeklyRoutineCompliance(
  history: CompletedWorkout[] = [],
  routines: Routine[] = [],
  referenceDate: Date = new Date(),
  options?: {
    weekOffset?: number;
    profileId?: string;
  }
): WeeklyRoutineComplianceResult {
  const safeHistory = Array.isArray(history) ? history : [];
  const safeRoutines = Array.isArray(routines) ? routines : [];
  const bounds = getChileWeekBounds(referenceDate, options?.weekOffset || 0);

  const completedRoutineIds = new Set<string>();
  const completedWorkoutsInWeek: CompletedWorkout[] = [];
  const unscheduledWorkoutsByDateKey: Record<string, CompletedWorkout[]> = {};

  const completedByScheduledDay = {} as Record<CanonicalWeekday, ScheduledDayComplianceEntry>;
  for (const wd of CANONICAL_WEEKDAYS_ORDERED) {
    completedByScheduledDay[wd] = {
      scheduledDay: wd,
      isCompleted: false,
      workouts: [],
      routineIds: [],
      lastExecutedDateKey: null,
      lastCompletedAt: null,
      totalVolumeKg: 0,
    };
  }

  for (const w of safeHistory) {
    if (!w || w.isFinished === false) continue;

    // Independent per-athlete filtering when profileId is provided
    if (options?.profileId && w.profileId && w.profileId !== options.profileId) {
      continue;
    }

    const hasCompletedWork =
      (typeof w.completedSetsCount === 'number' && w.completedSetsCount > 0) ||
      (Array.isArray(w.exercisesSummary) && w.exercisesSummary.length > 0) ||
      (typeof w.totalVolumeKg === 'number' && w.totalVolumeKg > 0);
    if (!hasCompletedWork) continue;

    const wDateKey = resolveWorkoutChileDateKey(w);
    if (!wDateKey) continue;

    // Strictly belong to this weekly cycle (Monday..Sunday in America/Santiago)
    if (wDateKey < bounds.mondayDateKey || wDateKey > bounds.sundayDateKey) {
      continue;
    }

    completedWorkoutsInWeek.push(w);

    const resolved = inferExecutedRoutineIdentity(w, safeRoutines);
    if (resolved.routineId && !isGenericOrMissingRoutineId(resolved.routineId)) {
      completedRoutineIds.add(resolved.routineId);
    }
    if (resolved.matchedRoutine?.id) {
      completedRoutineIds.add(resolved.matchedRoutine.id);
    }

    if (resolved.scheduledDay) {
      const bucket = completedByScheduledDay[resolved.scheduledDay];
      bucket.isCompleted = true;
      bucket.workouts.push(w);
      if (resolved.routineId && !bucket.routineIds.includes(resolved.routineId)) {
        bucket.routineIds.push(resolved.routineId);
      }
      if (!bucket.lastExecutedDateKey || wDateKey >= bucket.lastExecutedDateKey) {
        bucket.lastExecutedDateKey = wDateKey;
      }
      const completedIso =
        w.completedAt || (typeof w.endTime === 'number' && w.endTime > 0 ? new Date(w.endTime).toISOString() : w.date);
      if (!bucket.lastCompletedAt || (completedIso && completedIso >= bucket.lastCompletedAt)) {
        bucket.lastCompletedAt = completedIso;
      }
      bucket.totalVolumeKg += Math.round(Number(w.totalVolumeKg) || 0);
    } else {
      if (!unscheduledWorkoutsByDateKey[wDateKey]) {
        unscheduledWorkoutsByDateKey[wDateKey] = [];
      }
      unscheduledWorkoutsByDateKey[wDateKey].push(w);
    }
  }

  return {
    weekId: bounds.weekId,
    mondayDateKey: bounds.mondayDateKey,
    sundayDateKey: bounds.sundayDateKey,
    todayDateKey: bounds.todayDateKey,
    todayIndex: bounds.todayIndex,
    mondayUtc: bounds.mondayUtc,
    completedRoutineIds,
    completedByScheduledDay,
    unscheduledWorkoutsByDateKey,
    completedWorkoutsInWeek,
  };
}
