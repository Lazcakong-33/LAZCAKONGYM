import React, { useState, useMemo } from 'react';
import { Routine, CompletedWorkout } from '../types';
import { CANONICAL_WEEKDAYS, CanonicalWeekday } from '../utils/csvImporter';
import {
  calculatePureRoutineVolume,
  deduplicateRoutinesByDay,
  filterRoutineExercisesByDay,
  isSameWeekday,
} from '../utils/workoutAnalyticsEngine';
import { BarChart2 } from 'lucide-react';
import { DailyExercisesView } from './DailyExercisesView';

interface MuscleHeatmapProps {
  routines?: Routine[];
  history?: CompletedWorkout[];
}

export const MuscleHeatmap: React.FC<MuscleHeatmapProps> = ({
  routines = [],
  history = [],
}) => {
  const [viewMode, setViewMode] = useState<'weekly' | 'daily'>('weekly');
  const [selectedDay, setSelectedDay] = useState<CanonicalWeekday>('Lunes');

  const cleanRoutines = useMemo(
    () => deduplicateRoutinesByDay(Array.isArray(routines) ? routines : []),
    [routines]
  );

  const activeDayFilter = viewMode === 'weekly' ? 'ALL' : selectedDay;

  // Cálculo 100% puro y sin acumuladores residuales
  const pureReport = useMemo(
    () => calculatePureRoutineVolume(cleanRoutines, activeDayFilter, history),
    [cleanRoutines, activeDayFilter, history]
  );

  const countByDay = useMemo(() => {
    const counts: Record<CanonicalWeekday, number> = {
      Lunes: 0,
      Martes: 0,
      Miércoles: 0,
      Jueves: 0,
      Viernes: 0,
      Sábado: 0,
      Domingo: 0,
    };
    CANONICAL_WEEKDAYS.forEach((d) => {
      counts[d] = filterRoutineExercisesByDay(cleanRoutines, d).length;
    });
    return counts;
  }, [cleanRoutines]);

  return (
    <div className="w-full max-w-6xl mx-auto bg-[#070A0F] rounded-3xl border border-zinc-800 p-5 md:p-6 shadow-2xl space-y-6 font-sans">
      {/* Controles de Vista Aislados */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div>
          <span className="text-[10px] font-mono tracking-widest text-accent-text uppercase block">
            ESTÍMULO PLANIFICADO • RUTINA DEL ATLETA
          </span>
          <h2 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-accent-text" />
            <span>MAPA DE VOLUMEN &amp; SERIES</span>
          </h2>
        </div>

        <div className="flex items-center gap-2 bg-[#0B101D] p-1.5 rounded-2xl border border-zinc-800">
          <button
            type="button"
            onClick={() => setViewMode('weekly')}
            className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
              viewMode === 'weekly'
                ? 'bg-accent text-accent-contrast shadow-lg shadow-[0_6px_20px_var(--accent-glow)]'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Toda la Semana
          </button>
          <button
            type="button"
            onClick={() => setViewMode('daily')}
            className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
              viewMode === 'daily'
                ? 'bg-accent text-accent-contrast shadow-lg shadow-[0_6px_20px_var(--accent-glow)]'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Días Individuales
          </button>
        </div>
      </div>

      {/* Selector de días en vista diaria (Normalizado sin tildes ni errores de coincidencia) */}
      {viewMode === 'daily' && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {CANONICAL_WEEKDAYS.map((day) => {
            const isSelected = isSameWeekday(selectedDay, day);
            const count = countByDay[day] || 0;
            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDay(day)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono transition-all shrink-0 flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-zinc-800 text-accent-text border border-accent/40 font-bold'
                    : 'bg-zinc-900/60 text-zinc-400 border border-zinc-800/80 hover:text-white'
                }`}
              >
                <span>{day}</span>
                <span className="text-[10px] opacity-80">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Barras de Volumen Real Puras */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {pureReport.muscleList.map((item) => {
          const isHigh = item.sets > item.targetMaxSets;
          const isOptimal =
            viewMode === 'weekly'
              ? item.sets >= 10 && item.sets <= 20
              : item.sets >= 3 && item.sets <= 8;
          const isLow = item.sets > 0 && !isOptimal && !isHigh;

          return (
            <div
              key={item.muscle}
              className="p-4 rounded-2xl bg-[#090D1A] border border-zinc-800/80 hover:border-zinc-700 transition-colors"
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-white font-mono">{item.muscle}</span>
                <span className="text-xs font-mono text-accent-text font-black">
                  {item.sets} series
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isHigh
                      ? 'bg-red-500'
                      : isOptimal
                      ? 'bg-[#CCFF00]'
                      : isLow
                      ? 'bg-cyan-400'
                      : 'bg-zinc-700'
                  }`}
                  style={{ width: `${item.fatiguePercentage}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-zinc-500 block">
                {item.statusLabel}
              </span>
            </div>
          );
        })}
      </div>

      {/* Lista de Ejercicios Reales Filtrados */}
      <div className="p-5 rounded-2xl bg-[#090D1A] border border-zinc-800">
        <DailyExercisesView
          selectedDay={viewMode === 'daily' ? selectedDay : 'Toda la Semana'}
          routines={cleanRoutines}
        />
      </div>
    </div>
  );
};
