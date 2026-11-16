import React, { useMemo } from 'react';
import { Exercise, Routine } from '../types';
import {
  deduplicateRoutinesByDay,
  getSafeExerciseSets,
  isSameWeekday,
  normalizeText,
  resolveCanonicalWeekdayStrict,
} from '../utils/workoutAnalyticsEngine';
import { isLikelyRestValue } from '../utils/routineImporterHelpers';

export interface DailyExerciseItem extends Partial<Exercise> {
  id?: string;
  nombre?: string;
  name?: string;
  dia?: string;
  day?: string;
  canonicalDay?: string;
  series?: number | string;
  repeticiones?: number | string;
  reps?: number | string;
  descanso?: number | string;
  rest?: number | string;
  rpe?: number | string;
  notas?: string;
  [key: string]: any;
}

export interface DailyExercisesViewProps {
  selectedDay: string;
  exercisesData?: DailyExerciseItem[];
  routines?: Routine[];
}

export const DailyExercisesView: React.FC<DailyExercisesViewProps> = ({
  selectedDay,
  exercisesData = [],
  routines = [],
}) => {
  // Normalizamos el día seleccionado para evitar problemas con tildes, espacios o mayúsculas
  const normalizedSelectedDay = normalizeText(selectedDay);
  const canonicalSelectedDay = resolveCanonicalWeekdayStrict(selectedDay);

  const isAllWeek =
    !normalizedSelectedDay ||
    normalizedSelectedDay === 'all' ||
    normalizedSelectedDay === 'todos' ||
    normalizedSelectedDay === 'toda la semana' ||
    normalizedSelectedDay === 'weekly' ||
    normalizedSelectedDay === 'semanal';

  // Consolidamos la fuente de datos (soporta tanto `exercisesData` plano como `routines` estructuradas)
  const sourceExercises = useMemo<DailyExerciseItem[]>(() => {
    if (Array.isArray(exercisesData) && exercisesData.length > 0) {
      return exercisesData;
    }
    if (Array.isArray(routines) && routines.length > 0) {
      const cleanRoutines = deduplicateRoutinesByDay(routines);
      return cleanRoutines.flatMap((routine) =>
        (routine.exercises || []).map((ex) => ({
          ...ex,
          dia: ex.dia || ex.day || routine.dayName,
          day: ex.day || ex.dia || routine.dayName,
          canonicalDay: routine.dayName,
        }))
      );
    }
    return [];
  }, [exercisesData, routines]);

  // Filtramos asegurando que coincida exactamente con el día correspondiente y sin duplicados
  const filteredExercises = useMemo(() => {
    const seenKeys = new Set<string>();
    const result: DailyExerciseItem[] = [];

    for (const ex of sourceExercises) {
      if (!ex) continue;
      const rawExDay = ex.dia || ex.day || ex.canonicalDay || '';
      const exDayNorm = normalizeText(rawExDay);

      const matchesDay = isAllWeek
        ? true
        : canonicalSelectedDay
        ? isSameWeekday(rawExDay, canonicalSelectedDay)
        : exDayNorm === normalizedSelectedDay;

      if (!matchesDay) continue;

      const exName = String(ex.nombre || ex.name || '').trim();
      if (!exName) continue;

      const dedupeKey = `${resolveCanonicalWeekdayStrict(rawExDay) || exDayNorm}::${normalizeText(exName)}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      result.push(ex);
    }

    return result;
  }, [sourceExercises, isAllWeek, canonicalSelectedDay, normalizedSelectedDay]);

  const totalSeriesCount = useMemo(
    () => filteredExercises.reduce((acc, ex) => acc + getSafeExerciseSets(ex), 0),
    [filteredExercises]
  );

  return (
    <div className="w-full flex flex-col gap-3">

      {/* Contenedor con altura flexible y scroll vertical para evitar que se corten */}
      <div className="w-full max-h-[600px] overflow-y-auto flex flex-col gap-3 pr-2">
        {filteredExercises.length > 0 ? (
          filteredExercises.map((exercise, index) => {
            const displayName = exercise.nombre || exercise.name || `Ejercicio ${index + 1}`;
            const displayRpe = exercise.rpe ?? exercise.targetRpe ?? '8';
            const displaySeries = getSafeExerciseSets(exercise);
            const displayReps =
              exercise.repeticiones ||
              exercise.reps ||
              exercise.repRange ||
              exercise.defaultReps ||
              '8-12';
            const rawRestField = exercise.descanso || exercise.rest || exercise.restText;
            const displayRest =
              rawRestField && isLikelyRestValue(rawRestField)
                ? rawRestField
                : exercise.restSeconds
                ? `${exercise.restSeconds} seg`
                : '90 seg';
            const displayNotes =
              exercise.notas ||
              exercise.notes ||
              exercise.estrategia ||
              (rawRestField && !isLikelyRestValue(rawRestField) ? String(rawRestField) : undefined);
            const displayMuscle = exercise.targetMuscles || exercise.muscleGroup || exercise.musculo;
            const displayDay = exercise.canonicalDay || exercise.dia || exercise.day;

            return (
              <div
                key={exercise.id || `${normalizeText(displayName)}-${index}`}
                className="p-4 rounded-xl border border-white/10 bg-white/5 hover:border-white/20 transition-colors flex flex-col gap-2"
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-white block truncate">
                      {index + 1}. {displayName}
                    </span>
                    {(displayMuscle || (isAllWeek && displayDay)) && (
                      <span className="text-[11px] font-mono text-cyan-400 uppercase">
                        {isAllWeek && displayDay ? `${displayDay} • ` : ''}
                        {displayMuscle}
                      </span>
                    )}
                  </div>
                  <span className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-300 font-mono shrink-0">
                    RPE {displayRpe || 'N/A'}
                  </span>
                </div>

                <div className="text-sm text-gray-300 grid grid-cols-3 gap-2 mt-1 font-mono">
                  <div>
                    <strong className="text-white">Series:</strong> {displaySeries}
                  </div>
                  <div>
                    <strong className="text-white">Reps:</strong> {displayReps}
                  </div>
                  <div>
                    <strong className="text-white">Descanso:</strong> {displayRest}
                  </div>
                </div>

                {displayNotes && (
                  <p className="text-xs text-gray-400 mt-1 italic">Nota: {displayNotes}</p>
                )}
              </div>
            );
          })
        ) : (
          <div className="bg-slate-900/30 border border-slate-800/40 text-slate-500 rounded-xl py-3 px-4 text-xs font-semibold uppercase tracking-wider flex items-center justify-between">
            <span>{isAllWeek ? 'Sin rutina asignada' : `${selectedDay} · Jornada de recuperación`}</span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-slate-800/60 text-slate-400 font-bold tracking-widest">
              DESCANSO
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default DailyExercisesView;
