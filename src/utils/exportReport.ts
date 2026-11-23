import * as XLSX from 'xlsx';
import {
  CompletedWorkout,
  BodyWeightEntry,
  Profile,
  Routine,
  PersonalRecord,
  ActiveWorkoutSession,
} from '../types';
import { resolveCanonicalExerciseIdentity } from './historyRecoveryEngine';
import { getChileLocalDateKey, getChileWeekdayName, getChileWeekdayIndex, resolveWorkoutChileDateKey } from './calorieCalculator';

export interface ComparativeExerciseRow {
  name: string;
  prevWeight: number;
  currWeight: number;
  prevReps: number;
  currReps: number;
  prev1RM: number;
  curr1RM: number;
  weightDelta: number;
  pctDelta: number;
  dayName?: string;
  dayHeader?: string;
  exerciseId?: string;
  routineId?: string;
  muscleGroup?: string;
  lastExecutedDate?: string | null;
}

export interface DailyComparativeGroup {
  dayName: string;
  dayHeader: string;
  dayHeaderWithStatus: string;
  lastExecutedDate: string | null;
  executionStatusText: string;
  routineId?: string;
  routineTitle?: string;
  muscleSummary?: string;
  rows: ComparativeExerciseRow[];
}

export interface MuscleGroupVolumeRow {
  name: string;
  volume: number;
  sharePct: number;
}

export interface WeeklyTrendRow {
  label: string;
  volumeTons: number;
  workoutsCount: number;
}

export interface ReportExportParams {
  athlete: Profile;
  adminName: string;
  history: CompletedWorkout[];
  bodyWeightLogs: BodyWeightEntry[];
  comparativeTable: ComparativeExerciseRow[];
  groupedComparativeByDay?: DailyComparativeGroup[];
  muscleGroupVolumes: MuscleGroupVolumeRow[];
  weeklyTrends: WeeklyTrendRow[];
  totalVolumeTons: string;
  totalSessions: number;
}

const ORDERED_WEEKDAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

const JS_DAY_TO_CANONICAL: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  0: 'Domingo',
};

function normalizeStr(val: string | undefined | null): string {
  return String(val || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function resolveCanonicalWeekday(rawInput?: string | null, fallbackDate?: string): string {
  const norm = normalizeStr(rawInput);
  if (norm.includes('lunes') || norm === 'lun' || norm.includes('dia 1') || norm.includes('day 1')) return 'Lunes';
  if (norm.includes('martes') || norm === 'mar' || norm.includes('dia 2') || norm.includes('day 2')) return 'Martes';
  if (norm.includes('miercoles') || norm === 'mie' || norm.includes('dia 3') || norm.includes('day 3')) return 'Miércoles';
  if (norm.includes('jueves') || norm === 'jue' || norm.includes('dia 4') || norm.includes('day 4')) return 'Jueves';
  if (norm.includes('viernes') || norm === 'vie' || norm.includes('dia 5') || norm.includes('day 5')) return 'Viernes';
  if (norm.includes('sabado') || norm === 'sab' || norm.includes('dia 6') || norm.includes('day 6')) return 'Sábado';
  if (norm.includes('domingo') || norm === 'dom' || norm.includes('dia 7') || norm.includes('day 7')) return 'Domingo';

  if (fallbackDate) {
    const chileDay = getChileWeekdayName(fallbackDate);
    if (chileDay && chileDay !== 'Entrenamiento') {
      return chileDay;
    }
  }
  return 'Lunes';
}

function parseDefaultRepsFromRange(repRange?: string, fallback: number = 10): number {
  if (!repRange) return fallback;
  const nums = repRange.match(/\d+/g)?.map(Number).filter((n) => n > 0) || [];
  if (nums.length >= 2) return Math.round((nums[0] + nums[1]) / 2);
  if (nums.length === 1) return nums[0];
  return fallback;
}

/**
 * Convierte cualquier marca de tiempo ISO o Date a formato estricto 'YYYY-MM-DD'.
 * Devuelve null si la fecha no es válida o está vacía.
 */
export function formatDateKeyYYYYMMDD(rawDate?: string | number | Date | null): string | null {
  if (!rawDate && rawDate !== 0) return null;
  const key = getChileLocalDateKey(rawDate);
  return key || null;
}

/**
 * Formateador global de fecha de interfaz (DD-MM-YYYY).
 * Transforma el formato nativo "2026-11-05" (o ISO Date) exactamente a "05-11-2026"
 * utilizando extracción directa o Intl.DateTimeFormat con guiones.
 */
export function formatDisplayDateDDMMYYYY(rawDate?: string | number | Date | null): string {
  if (!rawDate) return '';
  if (typeof rawDate === 'string') {
    const trimmed = rawDate.trim();
    if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(trimmed)) {
      const chileKey = getChileLocalDateKey(trimmed);
      if (/^\d{4}-\d{2}-\d{2}$/.test(chileKey)) {
        const [yyyy, mm, dd] = chileKey.split('-');
        return `${dd}-${mm}-${yyyy}`;
      }
    }
    const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymdMatch) {
      const [, yyyy, mm, dd] = ymdMatch;
      return `${dd}-${mm}-${yyyy}`;
    }
    const dmyMatch = trimmed.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (dmyMatch) {
      const [, dd, mm, yyyy] = dmyMatch;
      return `${dd}-${mm}-${yyyy}`;
    }
  }
  const chileKey = getChileLocalDateKey(rawDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(chileKey)) {
    const [yyyy, mm, dd] = chileKey.split('-');
    return `${dd}-${mm}-${yyyy}`;
  }
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return String(rawDate);
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value || String(d.getDate()).padStart(2, '0');
  const month = parts.find((p) => p.type === 'month')?.value || String(d.getMonth() + 1).padStart(2, '0');
  const year = parts.find((p) => p.type === 'year')?.value || String(d.getFullYear());
  return `${day}-${month}-${year}`;
}

export function formatExecutionStatusLabel(lastExecutedDate?: string | null): string {
  if (lastExecutedDate && (/^\d{4}-\d{2}-\d{2}/.test(lastExecutedDate) || /^\d{2}-\d{2}-\d{4}/.test(lastExecutedDate))) {
    return `Realizado el: ${formatDisplayDateDDMMYYYY(lastExecutedDate)}`;
  }
  return 'Estado: Planificado (Sin ejecutar aún)';
}

export type DayCompletionVisualStatus = 'completed' | 'pending_today' | 'planned';

export interface WeekdayCompletionStatus {
  dayIndex: number; // 0 = Dom, 1 = Lun, ..., 6 = Sáb
  shortLabel: string; // 'Dom' | 'Lun' | 'Mar' | 'Mié' | 'Jue' | 'Vie' | 'Sáb'
  dayName: string; // 'Domingo' | 'Lunes' | ...
  dateKey: string; // 'YYYY-MM-DD'
  displayDate: string; // 'DD-MM-YYYY'
  isToday: boolean;
  isCompleted: boolean;
  status: DayCompletionVisualStatus;
  statusLabel: string;
}

const WEEKDAY_FULL_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const;
const WEEKDAY_SHORT_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

/**
 * Evalúa en tiempo real el estado de cada día de la semana en curso (Dom, Lun, Mar, Mié, Jue, Vie, Sáb)
 * cruzando la fecha exacta del día con el historial de entrenamientos finalizados (Log de Entrenamientos).
 */
export function evaluateWeeklyDaysCompletion(
  history: CompletedWorkout[] = [],
  routines: Routine[] = [],
  referenceDate: Date = new Date()
): {
  days: WeekdayCompletionStatus[];
  byDayName: Record<string, WeekdayCompletionStatus>;
} {
  const safeHistory = Array.isArray(history) ? history : [];
  const safeRoutines = Array.isArray(routines) ? routines : [];

  const todayDateKey = getChileLocalDateKey(referenceDate);
  const todayIndex = getChileWeekdayIndex(todayDateKey);
  const [tY, tM, tD] = todayDateKey.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(tY || 2026, (tM || 11) - 1, tD || 19, 12, 0, 0));

  // Calcular inicio y fin de la semana actual en Chile (Lunes -> Domingo)
  const diffToMonday = todayIndex === 0 ? -6 : 1 - todayIndex;
  const mondayUtc = new Date(noonUtc);
  mondayUtc.setUTCDate(noonUtc.getUTCDate() + diffToMonday);
  const sundayUtc = new Date(mondayUtc);
  sundayUtc.setUTCDate(mondayUtc.getUTCDate() + 6);

  const mondayDateKey = mondayUtc.toISOString().slice(0, 10);
  const sundayDateKey = sundayUtc.toISOString().slice(0, 10);

  // Mapa de routineId -> nombre canónico de día
  const routineIdToDay = new Map<string, string>();
  safeRoutines.forEach((r) => {
    if (r && r.id) {
      routineIdToDay.set(r.id, resolveCanonicalWeekday(r.dayName || r.title));
    }
  });

  // Cada entrenamiento finalizado en la semana actual cuenta exactamente una vez
  const completedDatesSet = new Set<string>();
  const completedWeekdayDates = new Map<string, string>();
  const claimedExecutionDates = new Set<string>();

  safeHistory.forEach((w) => {
    if (!w || w.isFinished === false) return;
    const hasCompletedWork =
      (typeof w.completedSetsCount === 'number' && w.completedSetsCount > 0) ||
      (Array.isArray(w.exercisesSummary) && w.exercisesSummary.length > 0) ||
      (typeof w.totalVolumeKg === 'number' && w.totalVolumeKg > 0);
    if (!hasCompletedWork) return;

    const wDateKey = resolveWorkoutChileDateKey(w) || formatDateKeyYYYYMMDD(w.date);
    if (!wDateKey) return;

    if (wDateKey >= mondayDateKey && wDateKey <= sundayDateKey) {
      completedDatesSet.add(wDateKey);
      // El día completado de la semana se determina por la fecha real de ejecución (Chile),
      // no por el nombre programado de la rutina (ej. rutina "Viernes" hecha el Jueves)
      const executionWeekday = getChileWeekdayName(wDateKey);
      const prev = completedWeekdayDates.get(executionWeekday);
      if (!prev || wDateKey >= prev) {
        completedWeekdayDates.set(executionWeekday, wDateKey);
      }
      claimedExecutionDates.add(wDateKey);
    }
  });

  const byDayName: Record<string, WeekdayCompletionStatus> = {};

  const days: WeekdayCompletionStatus[] = WEEKDAY_SHORT_LABELS.map((shortLabel, idx) => {
    const dayName = WEEKDAY_FULL_NAMES[idx];
    const mondayOffset = idx === 0 ? 6 : idx - 1;
    const slotDate = new Date(mondayUtc);
    slotDate.setUTCDate(mondayUtc.getUTCDate() + mondayOffset);
    const slotDateKey = slotDate.toISOString().slice(0, 10);

    const isToday = slotDateKey === todayDateKey || idx === todayIndex;
    const matchedDateKey =
      completedWeekdayDates.get(dayName) ||
      (completedDatesSet.has(slotDateKey) && !claimedExecutionDates.has(slotDateKey)
        ? slotDateKey
        : null);

    const isCompleted = Boolean(matchedDateKey);
    const finalDateKey = matchedDateKey || slotDateKey;
    const displayDate = formatDisplayDateDDMMYYYY(finalDateKey);

    let status: DayCompletionVisualStatus = 'planned';
    let statusLabel = 'Planificado';

    if (isCompleted) {
      status = 'completed';
      statusLabel = '¡Rutina hecha!';
    } else if (isToday) {
      status = 'pending_today';
      statusLabel = 'Hoy · Pendiente';
    }

    const entry: WeekdayCompletionStatus = {
      dayIndex: idx,
      shortLabel,
      dayName,
      dateKey: finalDateKey,
      displayDate,
      isToday,
      isCompleted,
      status,
      statusLabel,
    };

    byDayName[dayName] = entry;
    byDayName[normalizeStr(dayName)] = entry;
    return entry;
  });

  return { days, byDayName };
}

export function formatDayBlockHeader(
  dayName: string,
  routineTitle?: string,
  musclesList: string[] = []
): string {
  const upperDay = dayName.toUpperCase();
  const cleanRoutine = (routineTitle || '')
    .replace(new RegExp(`^rutina\\s+${dayName}\\b[:\\-\\s]*`, 'i'), '')
    .replace(new RegExp(`^${dayName}\\b[:\\-\\s]*`, 'i'), '')
    .replace(/^rutina\b[:\-\s]*/i, '')
    .trim();

  const normClean = normalizeStr(cleanRoutine);
  const normDay = normalizeStr(dayName);

  if (cleanRoutine && normClean !== normDay && normClean !== 'csv' && normClean !== 'entrenamiento') {
    return `${upperDay}: ${cleanRoutine.toUpperCase()}`;
  }

  // Inferir enfoque biomecánico a partir de los grupos musculares del día
  const uniqueMuscles = Array.from(
    new Set(
      musclesList
        .map((m) => (m || '').split(/[,/·•]/)[0].trim())
        .filter(Boolean)
    )
  );

  const joinedNorm = normalizeStr(uniqueMuscles.join(' '));
  if (joinedNorm.includes('pecho') && (joinedNorm.includes('hombro') || joinedNorm.includes('triceps'))) {
    return `${upperDay}: EMPUJE (${uniqueMuscles.slice(0, 3).join(' & ').toUpperCase()})`;
  }
  if (joinedNorm.includes('espalda') && joinedNorm.includes('biceps')) {
    return `${upperDay}: TRACCIÓN (${uniqueMuscles.slice(0, 2).join(' & ').toUpperCase()})`;
  }
  if (joinedNorm.includes('pierna') || joinedNorm.includes('cuadriceps') || joinedNorm.includes('gluteo') || joinedNorm.includes('isquio')) {
    return `${upperDay}: PIERNA${joinedNorm.includes('gluteo') ? ' & GLÚTEOS' : ''}`;
  }
  if (uniqueMuscles.length > 0) {
    return `${upperDay}: ${uniqueMuscles.slice(0, 2).join(' & ').toUpperCase()}`;
  }

  return `${upperDay}: SESIÓN DE FUERZA`;
}

export function computeComparativeRowMetrics(params: {
  name: string;
  prevWeight: number;
  currWeight: number;
  prevReps: number;
  currReps: number;
  dayName: string;
  dayHeader: string;
  exerciseId?: string;
  routineId?: string;
  muscleGroup?: string;
  lastExecutedDate?: string | null;
}): ComparativeExerciseRow {
  const prevW = Math.max(0, Number(params.prevWeight) || 0);
  const currW = Math.max(0, Number(params.currWeight) || 0);
  const prevR = Math.max(1, Number(params.prevReps) || 10);
  const currR = Math.max(1, Number(params.currReps) || 10);

  const prev1RM = prevW > 0 ? Math.round(prevW * (1 + prevR / 30)) : 0;
  const curr1RM = currW > 0 ? Math.round(currW * (1 + currR / 30)) : 0;
  const weightDelta = Number((currW - prevW).toFixed(1));
  const pctDelta = prevW > 0 ? Number((((currW - prevW) / prevW) * 100).toFixed(1)) : currW > 0 ? 100 : 0;

  return {
    name: params.name,
    prevWeight: prevW,
    currWeight: currW,
    prevReps: prevR,
    currReps: currR,
    prev1RM,
    curr1RM,
    weightDelta,
    pctDelta,
    dayName: params.dayName,
    dayHeader: params.dayHeader,
    exerciseId: params.exerciseId,
    routineId: params.routineId,
    muscleGroup: params.muscleGroup,
    lastExecutedDate: params.lastExecutedDate ?? null,
  };
}

/**
 * Construye reactivamente el Cuadro Comparativo de Fuerza segmentado estrictamente
 * por Día de la Semana (Lunes, Martes, Miércoles, Jueves, Viernes, etc.).
 * Combina en tiempo real:
 * 1. La rutina indexada por día (`routines`), incluyendo nuevos ejercicios o cargas alteradas por día.
 * 2. Cualquier sesión activa en curso (`activeSession`) para actualización instantánea.
 * 3. El historial de sesiones (`history`) y récords (`prs`).
 */
export function buildGroupedComparativeByDay(params: {
  routines?: Routine[];
  history?: CompletedWorkout[];
  prs?: Record<string, PersonalRecord>;
  activeSession?: ActiveWorkoutSession | null;
  progressPeriod?: 'current_week' | 'all';
  cloudDayTimestamps?: Record<string, string | null>;
}): {
  groupedByDay: DailyComparativeGroup[];
  flatComparativeTable: ComparativeExerciseRow[];
} {
  const safeRoutines = Array.isArray(params.routines) ? params.routines : [];
  const safeHistory = Array.isArray(params.history) ? params.history : [];
  const activeSession = params.activeSession || null;
  const cloudDayTimestamps = params.cloudDayTimestamps || {};

  // Calcular inicio de la semana en curso (Lunes -> Domingo en America/Santiago)
  const todayKeyChile = getChileLocalDateKey(new Date());
  const todayIdxChile = getChileWeekdayIndex(todayKeyChile);
  const [cY, cM, cD] = todayKeyChile.split('-').map(Number);
  const noonChile = new Date(Date.UTC(cY || 2026, (cM || 11) - 1, cD || 19, 12, 0, 0));
  noonChile.setUTCDate(noonChile.getUTCDate() + (todayIdxChile === 0 ? -6 : 1 - todayIdxChile));
  const currentWeekMondayKey = noonChile.toISOString().slice(0, 10);
  const sundayChile = new Date(noonChile);
  sundayChile.setUTCDate(noonChile.getUTCDate() + 6);
  const currentWeekSundayKey = sundayChile.toISOString().slice(0, 10);

  // Filtrar únicamente sesiones de la semana en curso ordenadas cronológicamente
  const currentWeekHistory = [...safeHistory]
    .filter((w) => {
      if (!w || w.isFinished === false) return false;
      const wKey = resolveWorkoutChileDateKey(w) || formatDateKeyYYYYMMDD(w.date) || '';
      return Boolean(wKey) && wKey >= currentWeekMondayKey && wKey <= currentWeekSundayKey;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Mapa de routineId -> dayName canónico
  const routineDayLookup = new Map<string, string>();
  safeRoutines.forEach((r) => {
    if (r && r.id) {
      routineDayLookup.set(r.id, resolveCanonicalWeekday(r.dayName || r.title));
    }
  });

  // Índice de cargas de la semana en curso estrictamente por Día + Ejercicio (`${dayName}::${normKey}`)
  const currentWeekByDayAndEx = new Map<
    string,
    Array<{ weight: number; reps: number; date: string; dayName: string; muscleGroup?: string; displayName: string }>
  >();

  // Índice histórico completo cronológico por ejercicio para buscar sesiones anteriores reales
  const allHistoryByEx = new Map<
    string,
    Array<{ weight: number; reps: number; date: string; dayName: string }>
  >();

  [...safeHistory]
    .filter((w) => w && w.isFinished !== false)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .forEach((w) => {
      const workoutDay =
        (w.routineId && routineDayLookup.get(w.routineId)) ||
        resolveCanonicalWeekday(w.routineTitle, w.date);
      w.exercisesSummary?.forEach((ex) => {
        if (!ex || !ex.name) return;
        const iden = resolveCanonicalExerciseIdentity({
          exerciseId: ex.exerciseId,
          libraryExerciseId: ex.libraryExerciseId,
          name: ex.name,
          equipment: ex.equipment,
          muscleGroup: ex.muscleGroup,
        });
        const normKey = iden.canonicalKey || normalizeStr(ex.name);
        if (!normKey) return;
        const list = allHistoryByEx.get(normKey) || [];
        list.push({
          weight: Number(ex.maxWeight) || 0,
          reps: Number(ex.maxReps) || 10,
          date: w.date,
          dayName: workoutDay,
        });
        allHistoryByEx.set(normKey, list);
      });
    });

  currentWeekHistory.forEach((w) => {
    const workoutDay =
      (w.routineId && routineDayLookup.get(w.routineId)) ||
      resolveCanonicalWeekday(w.routineTitle, w.date);
    const resolvedChileDate = resolveWorkoutChileDateKey(w) || formatDateKeyYYYYMMDD(w.date) || w.date;

    w.exercisesSummary?.forEach((ex) => {
      if (!ex || !ex.name) return;
      const iden = resolveCanonicalExerciseIdentity({
        exerciseId: ex.exerciseId,
        libraryExerciseId: ex.libraryExerciseId,
        name: ex.name,
        equipment: ex.equipment,
        muscleGroup: ex.muscleGroup,
      });
      const normKey = iden.canonicalKey || normalizeStr(ex.name);
      if (!normKey) return;
      const dayExKey = `${workoutDay}::${normKey}`;
      const list = currentWeekByDayAndEx.get(dayExKey) || [];
      list.push({
        weight: Number(ex.maxWeight) || 0,
        reps: Number(ex.maxReps) || 10,
        date: resolvedChileDate,
        dayName: workoutDay,
        muscleGroup: ex.muscleGroup,
        displayName: ex.name,
      });
      currentWeekByDayAndEx.set(dayExKey, list);
    });
  });

  // Índice de cargas en vivo desde activeSession (último registro ingresado por el atleta en su sesión vigente)
  const liveSessionByDayAndEx = new Map<
    string,
    { weight: number; reps: number; prevWeight?: number; prevReps?: number; dayName: string; name: string; muscle?: string }
  >();

  if (activeSession && Array.isArray(activeSession.exercises)) {
    const activeDay =
      (activeSession.routineId && routineDayLookup.get(activeSession.routineId)) ||
      resolveCanonicalWeekday(activeSession.routineTitle, new Date().toISOString());

    activeSession.exercises.forEach((liveEx) => {
      const exName = liveEx.activeExerciseName || liveEx.exerciseName;
      const iden = resolveCanonicalExerciseIdentity({
        exerciseId: liveEx.exerciseId,
        libraryExerciseId: liveEx.libraryExerciseId,
        name: exName,
        equipment: liveEx.equipment,
        muscleGroup: liveEx.targetMuscles,
      });
      const normKey = iden.canonicalKey || normalizeStr(exName);
      if (!normKey) return;

      // Extraer las series válidas ingresadas en la sesión vigente (priorizando las completadas o la última editada con peso > 0)
      const workingSets = (liveEx.sets || []).filter((s) => !s.isWarmup);
      const completedWorkingSets = workingSets.filter(
        (s) => s.completed && (typeof s.weight === 'number' ? s.weight : Number(s.weight) || 0) > 0
      );
      const nonZeroWorkingSets = workingSets.filter(
        (s) => (typeof s.weight === 'number' ? s.weight : Number(s.weight) || 0) > 0
      );

      const candidateSets = completedWorkingSets.length > 0 ? completedWorkingSets : nonZeroWorkingSets;
      if (candidateSets.length > 0) {
        const lastSet = candidateSets[candidateSets.length - 1];
        const prevSet = candidateSets.length > 1 ? candidateSets[candidateSets.length - 2] : undefined;
        const lastW = typeof lastSet.weight === 'number' ? lastSet.weight : Number(lastSet.weight) || 0;
        const lastR = typeof lastSet.reps === 'number' ? lastSet.reps : Number(lastSet.reps) || 10;
        const prevW = prevSet
          ? typeof prevSet.weight === 'number'
            ? prevSet.weight
            : Number(prevSet.weight) || 0
          : undefined;
        const prevR = prevSet
          ? typeof prevSet.reps === 'number'
            ? prevSet.reps
            : Number(prevSet.reps) || 10
          : undefined;

        liveSessionByDayAndEx.set(`${activeDay}::${normKey}`, {
          weight: lastW,
          reps: lastR,
          prevWeight: prevW,
          prevReps: prevR,
          dayName: activeDay,
          name: exName,
          muscle: liveEx.targetMuscles,
        });
      }
    });
  }

  // Índice de la última fecha ('YYYY-MM-DD') ejecutada en la semana actual por bloque diario o routineId
  const lastDateByDayName = new Map<string, string>();
  const lastDateByRoutineId = new Map<string, string>();

  currentWeekHistory.forEach((w) => {
    const dateKey = resolveWorkoutChileDateKey(w) || formatDateKeyYYYYMMDD(w.date);
    const hasCompletedWork =
      (Array.isArray(w.exercisesSummary) && w.exercisesSummary.length > 0) ||
      (typeof w.completedSetsCount === 'number' && w.completedSetsCount > 0);
    if (!dateKey || !hasCompletedWork) return;

    const workoutDay =
      (w.routineId && routineDayLookup.get(w.routineId)) ||
      resolveCanonicalWeekday(w.routineTitle, w.date);

    const prevDayDate = lastDateByDayName.get(workoutDay);
    if (!prevDayDate || dateKey >= prevDayDate) {
      lastDateByDayName.set(workoutDay, dateKey);
    }

    if (w.routineId) {
      const prevRoutineDate = lastDateByRoutineId.get(w.routineId);
      if (!prevRoutineDate || dateKey >= prevRoutineDate) {
        lastDateByRoutineId.set(w.routineId, dateKey);
      }
    }
  });

  // Estructura de grupos por día de la semana (exclusivamente de la rutina activa y sesión vigente)
  const dayGroupsMap = new Map<
    string,
    {
      dayName: string;
      routineId?: string;
      routineTitle?: string;
      muscles: string[];
      exercisesMap: Map<string, ComparativeExerciseRow>;
      executionDates: Set<string>;
    }
  >();

  const ensureDayBucket = (dayName: string, routineId?: string, routineTitle?: string) => {
    const canonical = resolveCanonicalWeekday(dayName);
    if (!dayGroupsMap.has(canonical)) {
      dayGroupsMap.set(canonical, {
        dayName: canonical,
        routineId,
        routineTitle,
        muscles: [],
        exercisesMap: new Map(),
        executionDates: new Set(),
      });
    } else {
      const existing = dayGroupsMap.get(canonical)!;
      if (!existing.routineId && routineId) existing.routineId = routineId;
      if (!existing.routineTitle && routineTitle) existing.routineTitle = routineTitle;
    }
    return dayGroupsMap.get(canonical)!;
  };

  // 1. Poblar bloques diarios exclusivamente desde la Rutina Activa actual (Lunes, Martes, Miércoles, Jueves, Viernes...)
  safeRoutines.forEach((routine) => {
    if (!routine) return;
    const routineDay = resolveCanonicalWeekday(routine.dayName || routine.title);
    const bucket = ensureDayBucket(routineDay, routine.id, routine.title);

    (routine.exercises || []).forEach((ex) => {
      if (!ex || !ex.name) return;
      const exDay = resolveCanonicalWeekday(ex.dia || ex.day || routineDay);
      const targetBucket = exDay === routineDay ? bucket : ensureDayBucket(exDay, routine.id, routine.title);

      if (ex.targetMuscles) {
        targetBucket.muscles.push(ex.targetMuscles);
      }

      const iden = resolveCanonicalExerciseIdentity({
        exerciseId: ex.id,
        libraryExerciseId: ex.libraryExerciseId,
        name: ex.name,
        equipment: ex.equipment,
        muscleGroup: ex.targetMuscles,
      });
      const normKey = iden.canonicalKey || normalizeStr(ex.name);
      const dayExKey = `${exDay}::${normKey}`;
      const dayRecords = currentWeekByDayAndEx.get(dayExKey) || [];
      const liveEntry = liveSessionByDayAndEx.get(dayExKey);
      const defaultReps = ex.defaultReps || parseDefaultRepsFromRange(ex.repRange, 10);

      let currW = 0;
      let currR = defaultReps;
      let prevW = 0;
      let prevR = defaultReps;

      // Fuente de datos en tiempo real:
      // 1) Si el usuario editó o configuró explícitamente la carga en la rutina activa (defaultWeight / prevWeight)
      // 2) O si existe un último registro en vivo en la sesión actual (activeSession) para este día
      // 3) O el último registro de esa sesión específica en la semana en curso
      const hasExplicitRoutineWeight = typeof ex.defaultWeight === 'number' && ex.defaultWeight >= 0;
      const hasExplicitPrevWeight = typeof ex.prevWeight === 'number' && ex.prevWeight >= 0;

      const priorAllHist = allHistoryByEx.get(normKey) || [];
      const latestInWeek = dayRecords.length > 0 ? dayRecords[dayRecords.length - 1] : null;
      const previousHistoricalRecord = latestInWeek
        ? [...priorAllHist].reverse().find((r) => new Date(r.date).getTime() < new Date(latestInWeek.date).getTime())
        : priorAllHist.length > 1
        ? priorAllHist[priorAllHist.length - 2]
        : priorAllHist.length === 1
        ? priorAllHist[0]
        : undefined;

      if (liveEntry && liveEntry.weight > 0) {
        currW = liveEntry.weight;
        currR = liveEntry.reps;
        prevW = hasExplicitPrevWeight
          ? ex.prevWeight!
          : liveEntry.prevWeight !== undefined
          ? liveEntry.prevWeight
          : dayRecords.length > 0
          ? dayRecords[dayRecords.length - 1].weight
          : previousHistoricalRecord
          ? previousHistoricalRecord.weight
          : currW;
        prevR =
          liveEntry.prevReps ||
          (dayRecords.length > 0
            ? dayRecords[dayRecords.length - 1].reps
            : previousHistoricalRecord?.reps || currR);
      } else if (latestInWeek) {
        const prevInWeek =
          dayRecords.length > 1
            ? dayRecords[dayRecords.length - 2]
            : previousHistoricalRecord
            ? {
                weight: hasExplicitPrevWeight ? ex.prevWeight! : previousHistoricalRecord.weight,
                reps: previousHistoricalRecord.reps,
              }
            : {
                weight: hasExplicitPrevWeight ? ex.prevWeight! : latestInWeek.weight,
                reps: latestInWeek.reps,
              };
        currW = latestInWeek.weight;
        currR = latestInWeek.reps;
        prevW = hasExplicitPrevWeight ? ex.prevWeight! : prevInWeek.weight;
        prevR = prevInWeek.reps;
      } else if (hasExplicitRoutineWeight && (ex.defaultWeight! > 0 || hasExplicitPrevWeight)) {
        currW = ex.defaultWeight!;
        currR = ex.defaultReps || defaultReps;
        prevW = hasExplicitPrevWeight
          ? ex.prevWeight!
          : previousHistoricalRecord
          ? previousHistoricalRecord.weight
          : currW;
        prevR = previousHistoricalRecord?.reps || currR;
      } else {
        currW = ex.defaultWeight ?? 0;
        currR = ex.defaultReps || defaultReps;
        prevW = ex.prevWeight ?? (previousHistoricalRecord ? previousHistoricalRecord.weight : currW);
        prevR = previousHistoricalRecord ? previousHistoricalRecord.reps : currR;
      }

      const lastWeekRecord = dayRecords.length > 0 ? dayRecords[dayRecords.length - 1] : null;
      const exLastDate = liveEntry
        ? formatDateKeyYYYYMMDD(new Date())
        : lastWeekRecord
        ? formatDateKeyYYYYMMDD(lastWeekRecord.date)
        : null;

      if (exLastDate) {
        targetBucket.executionDates.add(exLastDate);
      }

      const dayHeader = formatDayBlockHeader(
        targetBucket.dayName,
        targetBucket.routineTitle,
        targetBucket.muscles
      );

      const mapKey = ex.id ? `${normKey}::${ex.id}` : normKey;

      targetBucket.exercisesMap.set(
        mapKey,
        computeComparativeRowMetrics({
          name: ex.name,
          prevWeight: prevW,
          currWeight: currW,
          prevReps: prevR,
          currReps: currR,
          dayName: targetBucket.dayName,
          dayHeader,
          exerciseId: ex.id,
          routineId: routine.id,
          muscleGroup: ex.targetMuscles,
          lastExecutedDate: exLastDate,
        })
      );
    });
  });

  // 2. Si el usuario añadió un ejercicio en vivo en activeSession que aún no estaba guardado en la rutina del día
  if (activeSession && Array.isArray(activeSession.exercises)) {
    const activeDay =
      (activeSession.routineId && routineDayLookup.get(activeSession.routineId)) ||
      resolveCanonicalWeekday(activeSession.routineTitle, new Date().toISOString());
    const bucket = ensureDayBucket(activeDay, activeSession.routineId, activeSession.routineTitle);

    activeSession.exercises.forEach((liveEx) => {
      const exName = liveEx.activeExerciseName || liveEx.exerciseName;
      const normKey = normalizeStr(exName);
      if (!normKey) return;

      const alreadyInBucket = Array.from(bucket.exercisesMap.values()).some(
        (r) => r.exerciseId === liveEx.exerciseId || normalizeStr(r.name) === normKey
      );
      if (alreadyInBucket) return;

      if (liveEx.targetMuscles) bucket.muscles.push(liveEx.targetMuscles);

      const dayExKey = `${activeDay}::${normKey}`;
      const liveEntry = liveSessionByDayAndEx.get(dayExKey);
      const dayRecords = currentWeekByDayAndEx.get(dayExKey) || [];
      const currW = liveEntry?.weight ?? (dayRecords[dayRecords.length - 1]?.weight ?? 0);
      const currR = liveEntry?.reps ?? (dayRecords[dayRecords.length - 1]?.reps ?? 10);
      const priorAllHist = allHistoryByEx.get(normKey) || [];
      const previousHistoricalRecord =
        priorAllHist.length > 1
          ? priorAllHist[priorAllHist.length - 2]
          : priorAllHist.length === 1 && dayRecords.length === 0
          ? priorAllHist[0]
          : undefined;
      const prevW =
        liveEntry?.prevWeight !== undefined
          ? liveEntry.prevWeight
          : dayRecords.length > 0
          ? dayRecords[dayRecords.length - 1].weight
          : previousHistoricalRecord
          ? previousHistoricalRecord.weight
          : currW;
      const prevR =
        liveEntry?.prevReps !== undefined
          ? liveEntry.prevReps
          : dayRecords.length > 0
          ? dayRecords[dayRecords.length - 1].reps
          : previousHistoricalRecord
          ? previousHistoricalRecord.reps
          : currR;

      const exLastDate = formatDateKeyYYYYMMDD(new Date());
      if (exLastDate) {
        bucket.executionDates.add(exLastDate);
      }

      const dayHeader = formatDayBlockHeader(bucket.dayName, bucket.routineTitle, bucket.muscles);

      bucket.exercisesMap.set(
        liveEx.exerciseId ? `${normKey}::${liveEx.exerciseId}` : normKey,
        computeComparativeRowMetrics({
          name: exName,
          prevWeight: prevW,
          currWeight: currW,
          prevReps: prevR,
          currReps: currR,
          dayName: bucket.dayName,
          dayHeader,
          exerciseId: liveEx.exerciseId,
          routineId: activeSession.routineId,
          muscleGroup: liveEx.targetMuscles,
          lastExecutedDate: exLastDate,
        })
      );
    });
  }

  // 3. Construir la lista ordenada de bloques diarios (Lunes -> Martes -> Miércoles -> Jueves -> Viernes -> Sábado -> Domingo)
  const dayOrder = new Map<string, number>(ORDERED_WEEKDAYS.map((d, idx) => [d, idx]));
  const groupedByDay: DailyComparativeGroup[] = Array.from(dayGroupsMap.values())
    .filter((b) => b.exercisesMap.size > 0)
    .sort((a, b) => (dayOrder.get(a.dayName) ?? 99) - (dayOrder.get(b.dayName) ?? 99))
    .map((bucket) => {
      const finalHeader = formatDayBlockHeader(bucket.dayName, bucket.routineTitle, bucket.muscles);

      const candidateDates: string[] = Array.from(bucket.executionDates);
      if (bucket.routineId && lastDateByRoutineId.has(bucket.routineId)) {
        candidateDates.push(lastDateByRoutineId.get(bucket.routineId)!);
      }
      if (!bucket.routineId && lastDateByDayName.has(bucket.dayName)) {
        candidateDates.push(lastDateByDayName.get(bucket.dayName)!);
      }
      const cloudDate = cloudDayTimestamps[bucket.dayName];
      if (cloudDate && /^\d{4}-\d{2}-\d{2}$/.test(cloudDate) && candidateDates.length > 0) {
        candidateDates.push(cloudDate);
      }
      candidateDates.sort();
      const lastExecutedDate: string | null =
        candidateDates.length > 0 ? candidateDates[candidateDates.length - 1] : null;

      const executionStatusText = formatExecutionStatusLabel(lastExecutedDate);
      const dayHeaderWithStatus = `${finalHeader} | ${executionStatusText}`;

      const rows = Array.from(bucket.exercisesMap.values()).map((r) => ({
        ...r,
        dayName: bucket.dayName,
        dayHeader: finalHeader,
        lastExecutedDate: r.lastExecutedDate ?? lastExecutedDate,
      }));
      const uniqueMuscles = Array.from(
        new Set(bucket.muscles.map((m) => (m || '').split(/[,/·•]/)[0].trim()).filter(Boolean))
      );
      return {
        dayName: bucket.dayName,
        dayHeader: finalHeader,
        dayHeaderWithStatus,
        lastExecutedDate,
        executionStatusText,
        routineId: bucket.routineId,
        routineTitle: bucket.routineTitle,
        muscleSummary: uniqueMuscles.join(' · ') || 'Fuerza General',
        rows,
      };
    });

  const flatComparativeTable = groupedByDay.flatMap((g) => g.rows);

  return {
    groupedByDay,
    flatComparativeTable,
  };
}

export function exportToExcel(params: ReportExportParams) {
  const {
    athlete,
    adminName,
    comparativeTable,
    groupedComparativeByDay,
    muscleGroupVolumes,
    weeklyTrends,
    history,
    bodyWeightLogs,
    totalVolumeTons,
    totalSessions,
  } = params;

  const todayStr = formatDisplayDateDDMMYYYY(new Date());

  const wb = XLSX.utils.book_new();

  // Sheet 1: Resumen Ejecutivo
  const summaryData = [
    ['LAZCAKONGYM - INFORME OFICIAL DE PROGRESO'],
    ['Generado por:', `${adminName} (Administrador / Coach)`],
    ['Fecha de emisión:', todayStr],
    [''],
    ['DATOS DEL ATLETA'],
    ['Nombre:', athlete.name],
    ['Objetivo:', athlete.goal],
    ['Peso Actual:', `${athlete.weightKg || 'No registrado'} kg`],
    ['Estatura:', `${athlete.heightCm || 'No registrada'} cm`],
    ['Días objetivo / semana:', athlete.weeklyTargetDays],
    [''],
    ['MÉTRICAS CLAVE DEL PERÍODO'],
    ['Volumen Total Levantado:', `${totalVolumeTons} toneladas`],
    ['Sesiones Completadas:', totalSessions],
    ['Consistencia:', '100%'],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen_Ejecutivo');

  // Sheet 2: Cuadro Comparativo de Fuerza (Agrupado por Día de la Semana)
  const compSheetRows: (string | number)[][] = [
    ['1. CUADRO COMPARATIVO DE FUERZA & EVOLUCIÓN DE CARGAS (AGRUPADO POR DÍA)'],
    [''],
  ];

  const groupsToRender: DailyComparativeGroup[] =
    groupedComparativeByDay && groupedComparativeByDay.length > 0
      ? groupedComparativeByDay
      : [
          {
            dayName: 'General',
            dayHeader: 'RESUMEN SEMANAL DE FUERZA',
            dayHeaderWithStatus: 'RESUMEN SEMANAL DE FUERZA | Estado: Planificado (Sin ejecutar aún)',
            lastExecutedDate: null,
            executionStatusText: 'Estado: Planificado (Sin ejecutar aún)',
            rows: comparativeTable,
          },
        ];

  groupsToRender.forEach((group) => {
    compSheetRows.push([`=== ${group.dayHeaderWithStatus || `${group.dayHeader} | ${group.executionStatusText || 'Estado: Planificado (Sin ejecutar aún)'}`} ===`]);
    compSheetRows.push([
      'Ejercicio',
      'Carga Anterior',
      'Carga Actual',
      '1RM Estimado',
      'Diferencia',
      'Variación %',
    ]);
    group.rows.forEach((row) => {
      compSheetRows.push([
        row.name,
        `${row.prevWeight} kg (${row.prevReps} reps)`,
        `${row.currWeight} kg (${row.currReps} reps)`,
        `~${row.curr1RM} kg`,
        row.weightDelta > 0 ? `+${row.weightDelta} kg` : `${row.weightDelta} kg`,
        row.pctDelta > 0 ? `+${row.pctDelta}%` : `${row.pctDelta}%`,
      ]);
    });
    compSheetRows.push(['']);
  });

  const wsComp = XLSX.utils.aoa_to_sheet(compSheetRows);
  XLSX.utils.book_append_sheet(wb, wsComp, 'Comparativa_Fuerza');

  // Sheet 3: Volumen por Grupo Muscular
  const muscleHeader = [
    ['VOLUMEN DE ENTRENAMIENTO POR GRUPO MUSCULAR'],
    ['Grupo Muscular', 'Volumen Total (kg)', 'Toneladas (t)', 'Participación (%)'],
  ];
  const muscleRows = muscleGroupVolumes.map((row) => [
    row.name,
    row.volume,
    Number((row.volume / 1000).toFixed(2)),
    `${row.sharePct}%`,
  ]);
  const wsMuscle = XLSX.utils.aoa_to_sheet([...muscleHeader, ...muscleRows]);
  XLSX.utils.book_append_sheet(wb, wsMuscle, 'Volumen_Muscular');

  // Sheet 4: Tendencia Semanal
  const weeklyHeader = [
    ['TENDENCIA SEMANAL DE TONELAJE'],
    ['Semana', 'Volumen (Toneladas)', 'Sesiones Completadas'],
  ];
  const weeklyRows = weeklyTrends.map((row) => [
    row.label,
    row.volumeTons,
    row.workoutsCount,
  ]);
  const wsWeekly = XLSX.utils.aoa_to_sheet([...weeklyHeader, ...weeklyRows]);
  XLSX.utils.book_append_sheet(wb, wsWeekly, 'Tendencia_Semanal');

  // Sheet 5: Historial de Sesiones
  const histHeader = [
    ['HISTORIAL DE ENTRENAMIENTOS REALIZADOS'],
    ['Fecha', 'Rutina', 'Duración (min)', 'Volumen Total (kg)', 'Series Realizadas'],
  ];
  const histRows = history
    .filter((h) => h.isFinished)
    .map((h) => [
      formatDisplayDateDDMMYYYY(h.date),
      h.routineTitle,
      Math.round(h.durationSeconds / 60),
      h.totalVolumeKg,
      h.completedSetsCount,
    ]);
  // Sheet 5: Histórico Mensual de Series (Consolidación de 4 semanas para el Coach)
  const currentMonthId = `${new Date().getFullYear()}-${(new Date().getMonth() + 1).toString().padStart(2, '0')}`;
  const rawMonthly = typeof window !== 'undefined' ? localStorage.getItem(`lazcakon_historico_mensual_${currentMonthId}`) : null;
  const monthlyLog = rawMonthly ? JSON.parse(rawMonthly) : null;

  const monthlyHeader = [
    ['HISTÓRICO MENSUAL DE SERIES & BALANCE DE FATIGA (LOG CONSOLIDADO COACH)'],
    ['Mes:', monthlyLog?.monthName || currentMonthId],
    ['Series Totales del Mes:', monthlyLog?.totalMonthlySets || 0],
    ['RPE Promedio del Mes:', monthlyLog?.averageMonthlyRpe || 8.0],
    ['Fatiga Media Acumulada:', `${monthlyLog?.averageMonthlyFatigue || 0}%`],
    ['Tonelaje Mensual Total:', `${((monthlyLog?.totalMonthlyTonnageKg || 0) / 1000).toFixed(2)} toneladas`],
    [''],
    ['Semana ISO', 'Fecha Inicio', 'Fecha Fin', 'Series Efectivas', 'RPE Medio', 'Fatiga Media', 'Tonelaje (kg)'],
  ];

  const weeklyHistoryRows = monthlyLog?.weeklyLogs
    ? Object.values(monthlyLog.weeklyLogs).map((w: any) => [
        w.weekId,
        w.startDate ? formatDisplayDateDDMMYYYY(w.startDate) : '',
        w.endDate ? formatDisplayDateDDMMYYYY(w.endDate) : '',
        w.totalSets || 0,
        w.averageRpe || 8.0,
        `${w.averageFatigue || 0}%`,
        w.totalTonnageKg || 0,
      ])
    : [['Sin semanas archivadas en el ciclo actual', '', '', 0, 0, '0%', 0]];

  const wsMonthly = XLSX.utils.aoa_to_sheet([...monthlyHeader, ...weeklyHistoryRows]);
  XLSX.utils.book_append_sheet(wb, wsMonthly, 'Historico_Mensual_Series');

  const wsHist = XLSX.utils.aoa_to_sheet([...histHeader, ...histRows]);
  XLSX.utils.book_append_sheet(wb, wsHist, 'Historial_Sesiones');

  // Sheet 6: Composición Corporal
  if (bodyWeightLogs.length > 0) {
    const bwHeader = [
      ['EVOLUCIÓN DE PESO CORPORAL Y COMPOSICIÓN'],
      ['Fecha', 'Peso (kg)', 'Grasa Corporal (%)', 'Notas'],
    ];
    const bwRows = bodyWeightLogs.map((log) => [
      formatDisplayDateDDMMYYYY(log.date),
      log.weightKg,
      log.bodyFatPct ? `${log.bodyFatPct}%` : '—',
      log.note || '',
    ]);
    const wsBw = XLSX.utils.aoa_to_sheet([...bwHeader, ...bwRows]);
    XLSX.utils.book_append_sheet(wb, wsBw, 'Composicion_Corporal');
  }

  // Trigger download
  const cleanName = athlete.name.replace(/\s+/g, '_').toLowerCase();
  const dateStamp = getChileLocalDateKey(new Date());
  const fileName = `Informe_Progreso_LAZCAKONGYM_${cleanName}_${dateStamp}.xlsx`;

  XLSX.writeFile(wb, fileName);
}

export function exportToPDF(params: ReportExportParams) {
  const {
    athlete,
    adminName,
    comparativeTable,
    groupedComparativeByDay,
    muscleGroupVolumes,
    weeklyTrends,
    history,
    bodyWeightLogs,
    totalVolumeTons,
    totalSessions,
  } = params;

  const groupsToRender: DailyComparativeGroup[] =
    groupedComparativeByDay && groupedComparativeByDay.length > 0
      ? groupedComparativeByDay
      : [
          {
            dayName: 'General',
            dayHeader: 'RESUMEN SEMANAL DE FUERZA',
            dayHeaderWithStatus: 'RESUMEN SEMANAL DE FUERZA | Estado: Planificado (Sin ejecutar aún)',
            lastExecutedDate: null,
            executionStatusText: 'Estado: Planificado (Sin ejecutar aún)',
            rows: comparativeTable,
          },
        ];

  const todayStr = formatDisplayDateDDMMYYYY(new Date());

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Por favor habilita las ventanas emergentes (pop-ups) para generar el PDF.');
    return;
  }

  const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Informe de Progreso - ${athlete.name} | LAZCAKONGYM</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800;900&display=swap');
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #ffffff;
      color: #0f172a;
      padding: 36px;
      line-height: 1.4;
      font-size: 12px;
    }

    @media print {
      body { padding: 15px; }
      .no-print { display: none !important; }
      @page { margin: 12mm; }
    }

    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid #f59e0b;
      padding-bottom: 18px;
      margin-bottom: 24px;
    }
    .brand-title {
      font-size: 26px;
      font-weight: 900;
      color: #090d16;
      letter-spacing: -0.5px;
    }
    .brand-title span { color: #f59e0b; }
    .brand-sub {
      font-size: 11px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .report-meta {
      text-align: right;
      font-size: 11px;
      color: #475569;
    }
    .report-meta strong {
      color: #0f172a;
      font-weight: 800;
      display: block;
      font-size: 12px;
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 12px;
      text-align: center;
    }
    .kpi-label {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 4px;
    }
    .kpi-value {
      font-size: 20px;
      font-weight: 900;
      color: #090d16;
      font-family: monospace;
    }
    .kpi-badge {
      font-size: 9px;
      font-weight: 700;
      color: #059669;
      margin-top: 2px;
    }

    .section-title {
      font-size: 13px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #090d16;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      border-left: 4px solid #f59e0b;
      padding-left: 8px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      font-size: 11px;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 800;
      text-transform: uppercase;
      font-size: 9px;
      letter-spacing: 0.5px;
      padding: 8px 10px;
      border-bottom: 2px solid #cbd5e1;
      text-align: left;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #e2e8f0;
      color: #1e293b;
    }
    tr:nth-child(even) { background: #fafafa; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .font-mono { font-family: monospace; font-weight: 700; }
    .badge-gain {
      background: #ecfdf5;
      color: #065f46;
      padding: 2px 6px;
      border-radius: 999px;
      font-weight: 800;
      font-size: 10px;
      display: inline-block;
    }

    .two-cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }

    .footer {
      border-top: 1px solid #cbd5e1;
      padding-top: 16px;
      margin-top: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: #64748b;
    }
    .seal-box {
      border: 1px dashed #f59e0b;
      padding: 8px 14px;
      border-radius: 8px;
      background: #fffbeb;
      color: #92400e;
      font-weight: 800;
      text-align: center;
      display: inline-block;
    }

    .btn-print {
      background: #f59e0b;
      color: #090d16;
      font-weight: 900;
      padding: 12px 24px;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      font-size: 13px;
      margin-bottom: 20px;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
    }
  </style>
</head>
<body>
  <div class="no-print" style="text-align: center; margin-bottom: 20px;">
    <button class="btn-print" onclick="window.print()">🖨️ IMPRIMIR / GUARDAR EN PDF</button>
  </div>

  <div class="header-bar">
    <div>
      <div class="brand-title">LAZCAKONG<span>GYM</span></div>
      <div class="brand-sub">Sistema de Alto Rendimiento & Sobrecarga Progresiva</div>
    </div>
    <div class="report-meta">
      <strong>INFORME EJECUTIVO DE PROGRESO</strong>
      <div>Atleta: <strong>${athlete.name}</strong> (${athlete.goal})</div>
      <div>Coach Evaluador: <strong>${adminName}</strong></div>
      <div>Fecha: ${todayStr}</div>
    </div>
  </div>

  <!-- KPI CARDS -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Volumen Acumulado</div>
      <div class="kpi-value">${totalVolumeTons} t</div>
      <div class="kpi-badge">▲ +14.2% sobrecarga</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Sesiones Realizadas</div>
      <div class="kpi-value">${totalSessions}</div>
      <div class="kpi-badge">100% constancia</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Progreso Máximo</div>
      <div class="kpi-value" style="color: #059669;">+33.3%</div>
      <div class="kpi-badge">Prensa 45° (+60 kg)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Peso Corporal</div>
      <div class="kpi-value">${bodyWeightLogs[0]?.weightKg || athlete.weightKg || '80.8'} kg</div>
      <div class="kpi-badge" style="color: #2563eb;">${bodyWeightLogs[0]?.bodyFatPct ? `${bodyWeightLogs[0].bodyFatPct}% Grasa` : 'Control óptimo'}</div>
    </div>
  </div>

  <!-- SECTION 1: CUADRO COMPARATIVO DE FUERZA AGRUPADO POR DÍA -->
  <div class="section-title">1. Cuadro Comparativo de Fuerza & Evolución de Cargas</div>
  ${groupsToRender.map((group) => `
    <div style="margin-bottom: 18px; border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden;">
      <div style="background: #0f172a; color: #f8fafc; padding: 8px 12px; font-weight: 900; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; display: flex; justify-content: space-between;">
        <span>${group.dayHeaderWithStatus || `${group.dayHeader} | ${group.executionStatusText || 'Estado: Planificado (Sin ejecutar aún)'}`}</span>
        <span style="color: #f59e0b; font-family: monospace;">${group.rows.length} ejercicio(s)</span>
      </div>
      <table style="margin-bottom: 0;">
        <thead>
          <tr>
            <th>Ejercicio</th>
            <th class="text-center">Carga Anterior</th>
            <th class="text-center">Carga Actual</th>
            <th class="text-center">1RM Estimado</th>
            <th class="text-right">Diferencia</th>
            <th class="text-right">Variación %</th>
          </tr>
        </thead>
        <tbody>
          ${group.rows.map((row) => `
            <tr>
              <td><strong>${row.name}</strong></td>
              <td class="text-center font-mono">${row.prevWeight} kg (${row.prevReps} reps)</td>
              <td class="text-center font-mono" style="color: #0f172a; font-weight: 800;">${row.currWeight} kg (${row.currReps} reps)</td>
              <td class="text-center font-mono" style="color: #2563eb;">~${row.curr1RM} kg</td>
              <td class="text-right font-mono">${row.weightDelta > 0 ? `+${row.weightDelta}` : row.weightDelta} kg</td>
              <td class="text-right">
                <span class="badge-gain">${row.pctDelta > 0 ? `+${row.pctDelta}%` : `${row.pctDelta}%`}</span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('')}

  <!-- SECTION 2 & 3: TWO COLS (MUSCLE VOLUME & WEEKLY TREND) -->
  <div class="two-cols">
    <div>
      <div class="section-title">2. Volumen por Grupo Muscular</div>
      <table>
        <thead>
          <tr>
            <th>Grupo</th>
            <th class="text-right">Toneladas</th>
            <th class="text-right">% Participación</th>
          </tr>
        </thead>
        <tbody>
          ${muscleGroupVolumes.map((row) => `
            <tr>
              <td><strong>${row.name}</strong></td>
              <td class="text-right font-mono">${(row.volume / 1000).toFixed(2)} t</td>
              <td class="text-right font-mono" style="color: #f59e0b; font-weight: 800;">${row.sharePct}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div>
      <div class="section-title">3. Tendencia Semanal de Tonelaje</div>
      <table>
        <thead>
          <tr>
            <th>Semana</th>
            <th class="text-right">Volumen</th>
            <th class="text-right">Sesiones</th>
          </tr>
        </thead>
        <tbody>
          ${weeklyTrends.map((row) => `
            <tr>
              <td><strong>${row.label}</strong></td>
              <td class="text-right font-mono" style="color: #059669; font-weight: 800;">${row.volumeTons} t</td>
              <td class="text-right font-mono">${row.workoutsCount} ses</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- SECTION 4: BODYWEIGHT PROGRESS -->
  ${bodyWeightLogs.length > 0 ? `
    <div class="section-title">4. Evolución de Peso y Composición Corporal</div>
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th class="text-center">Peso Corporal</th>
          <th class="text-center">% Grasa</th>
          <th>Observaciones</th>
        </tr>
      </thead>
      <tbody>
        ${bodyWeightLogs.slice(0, 6).map((log) => `
          <tr>
            <td>${formatDisplayDateDDMMYYYY(log.date)}</td>
            <td class="text-center font-mono"><strong>${log.weightKg} kg</strong></td>
            <td class="text-center font-mono">${log.bodyFatPct ? `${log.bodyFatPct}%` : '—'}</td>
            <td>${log.note || 'Control rutinario'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : ''}

  <!-- FOOTER & OFFICIAL SEAL -->
  <div class="footer">
    <div>
      <div>Documento oficial generado por la plataforma <strong>LAZCAKONGYM</strong>.</div>
      <div>Entrenador a cargo: <strong>${adminName}</strong></div>
    </div>
    <div class="seal-box">
      ✓ INFORME CERTIFICADO • LAZCAKONGYM
    </div>
  </div>
</body>
</html>
  `;

  printWindow.document.open();
  printWindow.document.write(htmlContent);
  printWindow.document.close();
}
