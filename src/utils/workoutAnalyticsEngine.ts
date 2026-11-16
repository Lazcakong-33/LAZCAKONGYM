import { Routine, Exercise, CompletedWorkout } from '../types';
import {
  CanonicalWeekday,
  CANONICAL_WEEKDAYS,
  canonicalizeMuscleGroup,
  normalizeExerciseWithEquipment,
} from './csvImporter';

/**
 * Normaliza cualquier texto eliminando tildes/diacríticos (NFD), convirtiendo a minúsculas,
 * eliminando caracteres especiales redundantes y colapsando espacios múltiples.
 * Ej: "  Miércoles - Pierna " -> "miercoles pierna"
 */
export function normalizeText(value: string | undefined | null): string {
  if (!value) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resuelve de forma determinista el Día Canónico ('Lunes' a 'Domingo')
 * soportando variantes con/sin tilde, mayúsculas, abreviaturas o numeración ("Día 3").
 */
export function resolveCanonicalWeekdayStrict(
  ...candidates: (string | undefined | null)[]
): CanonicalWeekday | null {
  for (const raw of candidates) {
    if (!raw) continue;
    const norm = normalizeText(raw);
    if (!norm) continue;

    if (norm.includes('lunes') || norm.includes('monday') || /\blun\b/.test(norm)) return 'Lunes';
    if (norm.includes('martes') || norm.includes('tuesday') || /\bmar\b/.test(norm)) return 'Martes';
    if (
      norm.includes('miercoles') ||
      norm.includes('wednesday') ||
      /\bmie(r)?\b/.test(norm)
    ) {
      return 'Miércoles';
    }
    if (norm.includes('jueves') || norm.includes('thursday') || /\bjue\b/.test(norm)) return 'Jueves';
    if (norm.includes('viernes') || norm.includes('friday') || /\bvie\b/.test(norm)) return 'Viernes';
    if (norm.includes('sabado') || norm.includes('saturday') || /\bsab\b/.test(norm)) return 'Sábado';
    if (norm.includes('domingo') || norm.includes('sunday') || /\bdom\b/.test(norm)) return 'Domingo';

    if (/\b(dia|day|rutina|sesion)\s*1\b/.test(norm)) return 'Lunes';
    if (/\b(dia|day|rutina|sesion)\s*2\b/.test(norm)) return 'Martes';
    if (/\b(dia|day|rutina|sesion)\s*3\b/.test(norm)) return 'Miércoles';
    if (/\b(dia|day|rutina|sesion)\s*4\b/.test(norm)) return 'Jueves';
    if (/\b(dia|day|rutina|sesion)\s*5\b/.test(norm)) return 'Viernes';
    if (/\b(dia|day|rutina|sesion)\s*6\b/.test(norm)) return 'Sábado';
    if (/\b(dia|day|rutina|sesion)\s*7\b/.test(norm)) return 'Domingo';
  }
  return null;
}

/**
 * Compara dos cadenas de día de la semana de manera insensible a tildes, mayúsculas y espacios.
 * Ej: isSameWeekday("Miércoles", "miercoles ") -> true
 */
export function isSameWeekday(
  dayA: string | undefined | null,
  dayB: string | undefined | null
): boolean {
  if (!dayA || !dayB) return false;
  const canonA = resolveCanonicalWeekdayStrict(dayA);
  const canonB = resolveCanonicalWeekdayStrict(dayB);
  if (canonA && canonB) {
    return canonA === canonB;
  }
  return normalizeText(dayA) === normalizeText(dayB);
}

/**
 * Sanitiza el número de series de un ejercicio para evitar valores corruptos o inflados
 * por múltiples importaciones. Rango fisiológico normal por ejercicio: 1 a 6 series.
 */
export function getSafeExerciseSets(ex: Partial<Exercise> & Record<string, any>): number {
  const raw =
    typeof ex?.defaultSets === 'number' && ex.defaultSets > 0
      ? ex.defaultSets
      : typeof ex?.series === 'number' && ex.series > 0
      ? ex.series
      : Array.isArray(ex?.sets) && ex.sets.length > 0
      ? ex.sets.length
      : Number(ex?.defaultSets ?? ex?.series) || 3;

  return Math.min(Math.max(Math.round(raw), 1), 6);
}

/**
 * Función pura que desglosa, normaliza y deduplica las rutinas del atleta por día canónico
 * ('Lunes' a 'Domingo') y por nombre de ejercicio normalizado.
 *
 * Soluciona:
 * 1. Ejercicios con `dia: "Miércoles"` atrapados dentro de una rutina con `dayName: "Lunes"`.
 * 2. Rutinas duplicadas en caché o re-renderizados que inflaban las series semanales (>50 series).
 */
export function deduplicateRoutinesByDay(routines: Routine[] = []): Routine[] {
  if (!Array.isArray(routines) || routines.length === 0) return [];

  const buckets = new Map<
    CanonicalWeekday,
    {
      baseRoutine: Routine;
      exercisesMap: Map<string, Exercise>;
    }
  >();

  routines.forEach((routine, rIdx) => {
    if (!routine || !Array.isArray(routine.exercises)) return;

    const routineLevelDay: CanonicalWeekday =
      resolveCanonicalWeekdayStrict(routine.dayName, routine.title) ||
      CANONICAL_WEEKDAYS[rIdx % CANONICAL_WEEKDAYS.length];

    routine.exercises.forEach((rawEx: any) => {
      if (!rawEx || !(rawEx.name || rawEx.nombre || rawEx.Ejercicio)) return;

      const rawName = String(rawEx.name || rawEx.nombre || rawEx.Ejercicio).trim();
      const cleanName = normalizeExerciseWithEquipment(rawName);
      const exKey = normalizeText(cleanName);
      if (!exKey) return;

      // Priorizar el día propio del ejercicio si viene informado, luego el de la rutina
      const exerciseDay: CanonicalWeekday =
        resolveCanonicalWeekdayStrict(
          rawEx.dia,
          rawEx.day,
          rawEx.Dia,
          rawEx.Día,
          routine.dayName,
          routine.title
        ) || routineLevelDay;

      if (!buckets.has(exerciseDay)) {
        const cleanTitle =
          resolveCanonicalWeekdayStrict(routine.dayName) === exerciseDay
            ? routine.title || `Rutina ${exerciseDay}`
            : `Rutina ${exerciseDay}`;

        buckets.set(exerciseDay, {
          baseRoutine: {
            ...routine,
            id:
              resolveCanonicalWeekdayStrict(routine.dayName) === exerciseDay && routine.id
                ? routine.id
                : `rutina-${normalizeText(exerciseDay)}`,
            dayName: exerciseDay,
            title: cleanTitle,
            exercises: [],
          },
          exercisesMap: new Map<string, Exercise>(),
        });
      }

      const dayBucket = buckets.get(exerciseDay)!;
      const safeSets = getSafeExerciseSets(rawEx);
      const canonicalMuscle = canonicalizeMuscleGroup(
        rawEx.targetMuscles || rawEx.muscleGroup || rawEx.musculo || rawEx.Musculo || '',
        cleanName
      );

      // Deduplicación estricta: si el ejercicio ya existe en ese mismo día,
      // actualiza sus propiedades sin sumar ni duplicar las series.
      const existing = dayBucket.exercisesMap.get(exKey);
      dayBucket.exercisesMap.set(exKey, {
        ...(existing || {}),
        ...rawEx,
        id: rawEx.id || existing?.id || `ex-${normalizeText(exerciseDay)}-${exKey.replace(/\s+/g, '-')}`,
        name: cleanName,
        targetMuscles: canonicalMuscle,
        defaultSets: safeSets,
        dia: exerciseDay,
        day: exerciseDay,
      });
    });
  });

  const dayOrder = new Map<CanonicalWeekday, number>(
    CANONICAL_WEEKDAYS.map((d, idx) => [d, idx])
  );

  return Array.from(buckets.entries())
    .sort((a, b) => (dayOrder.get(a[0]) ?? 99) - (dayOrder.get(b[0]) ?? 99))
    .map(([, bucket]) => ({
      ...bucket.baseRoutine,
      exercises: Array.from(bucket.exercisesMap.values()),
    }));
}

/**
 * Filtra de manera pura e instantánea los ejercicios correspondientes a:
 * - 'ALL' ("Toda la Semana"): todos los ejercicios únicos de la semana.
 * - Un día específico (ej. "Miércoles", "miercoles", "Lunes", etc.): solo los ejercicios de ese día.
 */
export function filterRoutineExercisesByDay(
  routines: Routine[] = [],
  dayFilter: string = 'ALL'
): (Exercise & { canonicalDay: CanonicalWeekday; routineTitle: string })[] {
  const cleanRoutines = deduplicateRoutinesByDay(routines);
  const normFilter = normalizeText(dayFilter);

  const isAllWeek =
    !normFilter ||
    normFilter === 'all' ||
    normFilter === 'todos' ||
    normFilter === 'toda la semana' ||
    normFilter === 'weekly' ||
    normFilter === 'semanal';

  if (isAllWeek) {
    return cleanRoutines.flatMap((r) => {
      const cDay = resolveCanonicalWeekdayStrict(r.dayName, r.title) || 'Lunes';
      return (r.exercises || []).map((ex) => ({
        ...ex,
        canonicalDay: resolveCanonicalWeekdayStrict(ex.dia, ex.day, cDay) || cDay,
        routineTitle: r.title,
      }));
    });
  }

  const targetCanonicalDay = resolveCanonicalWeekdayStrict(dayFilter);

  return cleanRoutines
    .filter((r) =>
      targetCanonicalDay
        ? isSameWeekday(r.dayName, targetCanonicalDay)
        : isSameWeekday(r.dayName, dayFilter)
    )
    .flatMap((r) => {
      const cDay = resolveCanonicalWeekdayStrict(r.dayName, r.title) || 'Lunes';
      return (r.exercises || []).map((ex) => ({
        ...ex,
        canonicalDay: cDay,
        routineTitle: r.title,
      }));
    });
}

export type StandardMuscleCategory =
  | 'Pectoral'
  | 'Dorsal'
  | 'Cuádriceps'
  | 'Isquiosurales'
  | 'Glúteos'
  | 'Hombros'
  | 'Bíceps'
  | 'Tríceps'
  | 'Gemelos'
  | 'Core';

export const STANDARD_MUSCLE_CATEGORIES: StandardMuscleCategory[] = [
  'Pectoral',
  'Dorsal',
  'Cuádriceps',
  'Isquiosurales',
  'Glúteos',
  'Hombros',
  'Bíceps',
  'Tríceps',
  'Gemelos',
  'Core',
];

export function mapToStandardMuscleCategory(
  rawMuscle?: string,
  exerciseName?: string
): StandardMuscleCategory {
  const canonical = canonicalizeMuscleGroup(rawMuscle || '', exerciseName || '');
  const norm = normalizeText(canonical);

  if (norm.includes('pectoral') || norm.includes('pecho')) return 'Pectoral';
  if (norm.includes('dorsal') || norm.includes('espalda')) return 'Dorsal';
  if (norm.includes('cuadricep') || norm.includes('aductor')) return 'Cuádriceps';
  if (norm.includes('isquio') || norm.includes('femoral')) return 'Isquiosurales';
  if (norm.includes('gluteo')) return 'Glúteos';
  if (norm.includes('deltoide') || norm.includes('hombro')) return 'Hombros';
  if (norm.includes('bicep')) return 'Bíceps';
  if (norm.includes('tricep')) return 'Tríceps';
  if (norm.includes('gemelo') || norm.includes('pantorrilla')) return 'Gemelos';
  if (norm.includes('abdomen') || norm.includes('core')) return 'Core';
  return 'Dorsal';
}

export interface PureMuscleVolumeMetric {
  muscle: StandardMuscleCategory;
  sets: number;
  exercisesCount: number;
  estimatedVolumeKg: number;
  targetMaxSets: number;
  fatiguePercentage: number;
  statusLabel: 'Sin estímulo' | 'Mínimo Efectivo (MEV)' | 'Rango Óptimo (MAV)' | 'Límite MRV / Alta Carga';
}

export interface PureVolumeCalculationReport {
  scope: 'ALL_WEEK' | 'SINGLE_DAY';
  selectedDay: CanonicalWeekday | 'ALL';
  byMuscle: Record<StandardMuscleCategory, PureMuscleVolumeMetric>;
  muscleList: PureMuscleVolumeMetric[];
  filteredExercises: (Exercise & { canonicalDay: CanonicalWeekday; routineTitle: string })[];
  totalSets: number;
  totalExercises: number;
  totalEstimatedVolumeKg: number;
  globalFatiguePct: number;
}

/**
 * FUNCIÓN 100% PURA: Calcula el volumen de series y estímulo muscular
 * exclusivamente a partir de las rutinas reales deduplicadas, sin acumuladores globales
 * ni contaminación entre "Toda la Semana" y "Días Individuales".
 */
export function calculatePureRoutineVolume(
  routines: Routine[] = [],
  dayFilter: string = 'ALL',
  history: CompletedWorkout[] = []
): PureVolumeCalculationReport {
  const normFilter = normalizeText(dayFilter);
  const isAllWeek =
    !normFilter ||
    normFilter === 'all' ||
    normFilter === 'todos' ||
    normFilter === 'toda la semana' ||
    normFilter === 'weekly' ||
    normFilter === 'semanal';

  const resolvedDay: CanonicalWeekday | 'ALL' = isAllWeek
    ? 'ALL'
    : resolveCanonicalWeekdayStrict(dayFilter) || 'Lunes';

  const filteredExercises = filterRoutineExercisesByDay(
    routines,
    isAllWeek ? 'ALL' : resolvedDay
  );

  // Mapa de último peso conocido en historial por ejercicio (solo para estimar tonelaje sin inflar series)
  const latestWeightByEx = new Map<string, { weight: number; reps: number }>();
  if (Array.isArray(history)) {
    history.forEach((w) => {
      w?.exercisesSummary?.forEach((s) => {
        const key = normalizeText(s.name);
        if (key && !latestWeightByEx.has(key) && (s.maxWeight || 0) > 0) {
          latestWeightByEx.set(key, {
            weight: s.maxWeight,
            reps: s.maxReps || 10,
          });
        }
      });
    });
  }

  // Umbral fisiológico de referencia (20 series/semana para vista semanal, 8 series/día para vista diaria)
  const targetMaxSetsPerMuscle = isAllWeek ? 20 : 8;

  const byMuscle = {} as Record<StandardMuscleCategory, PureMuscleVolumeMetric>;
  STANDARD_MUSCLE_CATEGORIES.forEach((m) => {
    byMuscle[m] = {
      muscle: m,
      sets: 0,
      exercisesCount: 0,
      estimatedVolumeKg: 0,
      targetMaxSets: targetMaxSetsPerMuscle,
      fatiguePercentage: 0,
      statusLabel: 'Sin estímulo',
    };
  });

  let totalSets = 0;
  let totalEstimatedVolumeKg = 0;

  filteredExercises.forEach((ex) => {
    const sets = getSafeExerciseSets(ex);
    const category = mapToStandardMuscleCategory(ex.targetMuscles, ex.name);
    const exKey = normalizeText(ex.name);
    const histLoad = latestWeightByEx.get(exKey);

    const refWeight =
      typeof ex.defaultWeight === 'number' && ex.defaultWeight > 0
        ? ex.defaultWeight
        : histLoad?.weight || 40;
    const refReps =
      typeof ex.defaultReps === 'number' && ex.defaultReps > 0
        ? ex.defaultReps
        : histLoad?.reps || 10;

    const exVolKg = Math.round(sets * refWeight * refReps);

    byMuscle[category].sets += sets;
    byMuscle[category].exercisesCount += 1;
    byMuscle[category].estimatedVolumeKg += exVolKg;

    totalSets += sets;
    totalEstimatedVolumeKg += exVolKg;
  });

  // Calcular porcentaje de estímulo/fatiga y etiqueta fisiológica por grupo muscular
  const activeMuscleFatigues: number[] = [];

  STANDARD_MUSCLE_CATEGORIES.forEach((m) => {
    const entry = byMuscle[m];
    const pct = Math.min(100, Math.round((entry.sets / entry.targetMaxSets) * 100));
    entry.fatiguePercentage = pct;

    if (entry.sets === 0) {
      entry.statusLabel = 'Sin estímulo';
    } else if (isAllWeek) {
      if (entry.sets < 10) entry.statusLabel = 'Mínimo Efectivo (MEV)';
      else if (entry.sets <= 20) entry.statusLabel = 'Rango Óptimo (MAV)';
      else entry.statusLabel = 'Límite MRV / Alta Carga';
    } else {
      if (entry.sets <= 4) entry.statusLabel = 'Mínimo Efectivo (MEV)';
      else if (entry.sets <= 8) entry.statusLabel = 'Rango Óptimo (MAV)';
      else entry.statusLabel = 'Límite MRV / Alta Carga';
    }

    if (entry.sets > 0) {
      activeMuscleFatigues.push(pct);
    }
  });

  const globalFatiguePct =
    activeMuscleFatigues.length > 0
      ? Math.min(
          100,
          Math.round(
            activeMuscleFatigues.reduce((acc, v) => acc + v, 0) / activeMuscleFatigues.length
          )
        )
      : 0;

  return {
    scope: isAllWeek ? 'ALL_WEEK' : 'SINGLE_DAY',
    selectedDay: resolvedDay,
    byMuscle,
    muscleList: STANDARD_MUSCLE_CATEGORIES.map((m) => byMuscle[m]),
    filteredExercises,
    totalSets,
    totalExercises: filteredExercises.length,
    totalEstimatedVolumeKg,
    globalFatiguePct,
  };
}
