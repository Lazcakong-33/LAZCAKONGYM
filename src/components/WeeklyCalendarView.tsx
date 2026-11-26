import React, { useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Moon,
  Play,
  ArrowRight,
  RotateCcw,
  Flame,
} from 'lucide-react';
import { Routine, CompletedWorkout } from '../types';
import { isSameWeekday } from '../utils/workoutAnalyticsEngine';
import { formatDisplayDateDDMMYYYY } from '../utils/exportReport';
import { getChileLocalDateKey, getChileWeekdayIndex } from '../utils/calorieCalculator';
import { purgeAndSanitizeWorkoutHistory } from '../utils/historySanitizer';
import {
  evaluateWeeklyRoutineCompliance,
  type CanonicalWeekday,
} from '../utils/routineCompletionEngine';

interface WeeklyCalendarViewProps {
  routines: Routine[];
  history: CompletedWorkout[];
  onSelectDay: (routine: Routine) => void;
  onStartWorkout: (routine: Routine) => void;
}

const ORDERED_WEEKDAYS = [
  { name: 'Lunes', short: 'LUN', jsDay: 1 },
  { name: 'Martes', short: 'MAR', jsDay: 2 },
  { name: 'Miércoles', short: 'MIÉ', jsDay: 3 },
  { name: 'Jueves', short: 'JUE', jsDay: 4 },
  { name: 'Viernes', short: 'VIE', jsDay: 5 },
  { name: 'Sábado', short: 'SÁB', jsDay: 6 },
  { name: 'Domingo', short: 'DOM', jsDay: 0 },
] as const;

const MONTH_NAMES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function getMondayOfWeek(referenceDate: Date, weekOffset: number): Date {
  const dateKey = getChileLocalDateKey(referenceDate);
  const [y, m, d] = dateKey.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(y || 2026, (m || 11) - 1, d || 19, 12, 0, 0));
  const day = getChileWeekdayIndex(noonUtc);
  const diffToMonday = day === 0 ? -6 : 1 - day;
  noonUtc.setUTCDate(noonUtc.getUTCDate() + diffToMonday + weekOffset * 7);
  return noonUtc;
}

export const WeeklyCalendarView: React.FC<WeeklyCalendarViewProps> = ({
  routines,
  history,
  onSelectDay,
  onStartWorkout,
}) => {
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [selectedWeekdayName, setSelectedWeekdayName] = useState<string | null>(null);

  const todayDateKey = useMemo(() => getChileLocalDateKey(new Date()), []);

  // Construimos los 7 días (Lunes a Domingo) para la semana correspondiente a weekOffset
  const calendarWeek = useMemo(() => {
    const now = new Date();
    const monday = getMondayOfWeek(now, weekOffset);

    // Evaluar cumplimiento semanal estricto por routineId y scheduledDay dentro del ciclo Lunes-Domingo Chile
    const sanitized = purgeAndSanitizeWorkoutHistory(Array.isArray(history) ? history : []).cleanedHistory;
    const compliance = evaluateWeeklyRoutineCompliance(sanitized, routines, now, { weekOffset });

    const days = ORDERED_WEEKDAYS.map((wd, idx) => {
      const cellDate = new Date(monday);
      cellDate.setUTCDate(monday.getUTCDate() + idx);
      const dateKey = cellDate.toISOString().slice(0, 10);
      const displayDate = formatDisplayDateDDMMYYYY(dateKey);
      const dayNumber = String(cellDate.getUTCDate()).padStart(2, '0');
      const monthNameShort = MONTH_NAMES_ES[cellDate.getUTCMonth()].slice(0, 3);

      // Rutina asignada a este día de la semana (si tiene ejercicios cargados)
      const assignedRoutine =
        routines.find(
          (r) =>
            isSameWeekday(r.dayName || r.title, wd.name) &&
            Array.isArray(r.exercises) &&
            r.exercises.length > 0
        ) || null;

      const isRestDay = !assignedRoutine;
      const scheduledCompliance = compliance.completedByScheduledDay[wd.name as CanonicalWeekday];
      const extraUnscheduledWorkouts = compliance.unscheduledWorkoutsByDateKey[dateKey] || [];

      // Si el día tiene rutina programada, se marca SOLO si se ejecutó esa rutina (routineId / scheduledDay).
      // Si es día de descanso, solo se marca si hubo una sesión libre/no programada en esa fecha real.
      const matchedWorkouts = isRestDay
        ? extraUnscheduledWorkouts
        : scheduledCompliance?.workouts || [];
      const isCompleted = isRestDay
        ? extraUnscheduledWorkouts.length > 0
        : Boolean(
            (assignedRoutine && compliance.completedRoutineIds.has(assignedRoutine.id)) ||
              scheduledCompliance?.isCompleted
          );
      const executedDateKey = isRestDay
        ? extraUnscheduledWorkouts.length > 0
          ? dateKey
          : null
        : scheduledCompliance?.lastExecutedDateKey || null;
      const isToday = dateKey === todayDateKey;
      const isPastDate = dateKey < todayDateKey;
      const isFutureDate = dateKey > todayDateKey;

      // Volumen total ejecutado en la rutina correspondiente
      const executedVolumeKg = matchedWorkouts.reduce((acc, w) => {
        if (typeof w.totalVolumeKg === 'number' && w.totalVolumeKg > 0) {
          return acc + w.totalVolumeKg;
        }
        const summaryVol = (w.exercisesSummary || []).reduce((eAcc, ex) => {
          return (
            eAcc +
            (typeof ex.volumeKg === 'number'
              ? ex.volumeKg
              : (Number(ex.maxWeight) || 0) * (Number(ex.maxReps) || 0) * (Number(ex.sets) || 1))
          );
        }, 0);
        return acc + summaryVol;
      }, 0);

      // Grupos musculares únicos de la rutina asignada
      const muscleGroups = assignedRoutine
        ? Array.from(
            new Set(
              assignedRoutine.exercises
                .map((ex) => ex.targetMuscles?.split(/[,/·]/)[0]?.trim())
                .filter((m): m is string => Boolean(m))
            )
          ).slice(0, 2)
        : [];

      return {
        weekdayName: wd.name,
        shortLabel: wd.short,
        dateObj: cellDate,
        dateKey,
        displayDate,
        dayNumber,
        monthNameShort,
        assignedRoutine,
        completedWorkouts: matchedWorkouts,
        executedDateKey,
        isCompleted,
        isToday,
        isPastDate,
        isFutureDate,
        isRestDay,
        executedVolumeKg,
        muscleGroups,
      };
    });

    const firstDay = days[0];
    const lastDay = days[6];
    const activeRoutineDaysCount = days.filter((d) => !d.isRestDay).length;
    const restDaysCount = days.filter((d) => d.isRestDay).length;
    const completedDaysCount = days.filter((d) => d.isCompleted).length;

    const monthHeaderLabel =
      firstDay.dateObj.getUTCMonth() === lastDay.dateObj.getUTCMonth()
        ? `${MONTH_NAMES_ES[firstDay.dateObj.getUTCMonth()]} ${firstDay.dateObj.getUTCFullYear()}`
        : `${MONTH_NAMES_ES[firstDay.dateObj.getUTCMonth()].slice(0, 3)} - ${MONTH_NAMES_ES[
            lastDay.dateObj.getUTCMonth()
          ].slice(0, 3)} ${lastDay.dateObj.getUTCFullYear()}`;

    return {
      days,
      rangeLabel: `${firstDay.displayDate} — ${lastDay.displayDate}`,
      monthHeaderLabel,
      activeRoutineDaysCount,
      restDaysCount,
      completedDaysCount,
    };
  }, [routines, history, weekOffset, todayDateKey]);

  // Día seleccionado para vista rápida en el pie del calendario
  const activeDayDetail = useMemo(() => {
    if (selectedWeekdayName) {
      const found = calendarWeek.days.find((d) => d.weekdayName === selectedWeekdayName);
      if (found) return found;
    }
    return (
      calendarWeek.days.find((d) => d.isToday) ||
      calendarWeek.days.find((d) => !d.isRestDay) ||
      calendarWeek.days[0]
    );
  }, [calendarWeek.days, selectedWeekdayName]);

  const weekBadgeText =
    weekOffset === 0
      ? 'Semana Actual'
      : weekOffset < 0
      ? `Hace ${Math.abs(weekOffset)} ${Math.abs(weekOffset) === 1 ? 'semana' : 'semanas'}`
      : `En +${weekOffset} ${weekOffset === 1 ? 'semana' : 'semanas'}`;

  const activeSharePct = Math.round((calendarWeek.activeRoutineDaysCount / 7) * 100);

  return (
    <section className="p-4 sm:p-5 rounded-2xl bg-slate-900/50 border border-slate-800/80 shadow-xl backdrop-blur-md space-y-4 font-sans">
      {/* Cabecera y Controles de Navegación Semanal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-800/80">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-950/60 border border-blue-800/50 text-blue-400">
              <CalendarIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                  Calendario Semanal de Rutinas y Descanso
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                    weekOffset === 0
                      ? 'bg-emerald-950/60 text-emerald-400 border-emerald-700/50'
                      : weekOffset < 0
                      ? 'bg-amber-950/50 text-amber-300 border-amber-700/50'
                      : 'bg-blue-950/60 text-blue-300 border-blue-700/50'
                  }`}
                >
                  {weekBadgeText}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                {calendarWeek.monthHeaderLabel} · {calendarWeek.rangeLabel}
              </p>
            </div>
          </div>
        </div>

        {/* Botonera de Navegación Temporal (Pasadas / Hoy / Futuras) */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setWeekOffset((prev) => prev - 1)}
            className="px-2.5 py-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800/90 text-xs font-semibold flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
            title="Ver semana anterior"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
            <span>Anterior</span>
          </button>

          {weekOffset !== 0 && (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="px-2.5 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-xs font-bold flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
              title="Volver a la semana actual"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Hoy</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setWeekOffset((prev) => prev + 1)}
            className="px-2.5 py-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800/90 text-xs font-semibold flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
            title="Ver semana siguiente"
          >
            <span>Siguiente</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Barra de Distribución: Días de Carga vs Días de Descanso */}
      <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/70 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-semibold text-blue-400">
              <span className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_6px_#60a5fa]" />
              <span className="tabular-nums font-bold">{calendarWeek.activeRoutineDaysCount}</span> días de rutina
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-400">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              <span className="tabular-nums font-bold">{calendarWeek.restDaysCount}</span> días de descanso
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-300 tabular-nums">
              {calendarWeek.completedDaysCount} de {calendarWeek.activeRoutineDaysCount} sesiones completadas
            </span>
          </div>
        </div>

        {/* Barra visual proporcional 7 días */}
        <div className="w-full h-2 rounded-full bg-slate-800/90 overflow-hidden flex">
          <div
            style={{ width: `${activeSharePct}%` }}
            className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 transition-all duration-300"
            title={`${calendarWeek.activeRoutineDaysCount} días activos (${activeSharePct}%)`}
          />
        </div>
      </div>

      {/* Cuadrícula Semanal de 7 Días (Lunes a Domingo) */}
      <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
        {calendarWeek.days.map((day) => {
          const isSelected = activeDayDetail?.weekdayName === day.weekdayName;

          const cardStyle = day.isCompleted
            ? 'bg-emerald-950/25 border-emerald-500/50 hover:border-emerald-400'
            : day.isToday && !day.isRestDay
            ? 'bg-amber-950/25 border-amber-500/60 hover:border-amber-400'
            : day.isRestDay
            ? 'bg-slate-950/40 border-slate-800/50 hover:border-slate-700/70'
            : 'bg-slate-950/80 border-slate-800/90 hover:border-blue-500/50';

          return (
            <button
              key={day.dateKey}
              type="button"
              onClick={() => setSelectedWeekdayName(day.weekdayName)}
              className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between gap-2.5 cursor-pointer relative overflow-hidden ${cardStyle} ${
                isSelected ? 'ring-2 ring-blue-400/70 shadow-lg shadow-blue-950/40' : ''
              }`}
            >
              {/* Encabezado del Día: Nombre corto + Número de fecha */}
              <div className="flex items-center justify-between gap-1 w-full">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[10px] font-mono font-black uppercase tracking-wider ${
                      day.isToday
                        ? 'text-amber-400'
                        : day.isRestDay
                        ? 'text-slate-500'
                        : 'text-slate-300'
                    }`}
                  >
                    {day.shortLabel}
                  </span>
                  {day.isToday && (
                    <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 border border-amber-400/50 text-[9px] font-black text-amber-300 uppercase">
                      Hoy
                    </span>
                  )}
                </div>

                <span
                  className={`text-xs font-mono font-bold tabular-nums px-1.5 py-0.5 rounded-md ${
                    day.isCompleted
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : day.isToday
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  {day.dayNumber}
                </span>
              </div>

              {/* Cuerpo Central: Rutina Asignada vs Etiqueta DESCANSO */}
              <div className="my-0.5 min-h-[44px] flex flex-col justify-center">
                {day.isRestDay ? (
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900/70 border border-slate-800/80 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <Moon className="w-2.5 h-2.5 text-slate-500" />
                      DESCANSO
                    </span>
                    <p className="text-[10px] text-slate-500 leading-tight line-clamp-1">
                      {day.isCompleted ? 'Sesión extra registrada' : 'Recuperación SNC'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-white leading-snug line-clamp-1">
                      {day.assignedRoutine?.title}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] font-mono text-blue-400 tabular-nums font-semibold">
                        {day.assignedRoutine?.exercises.length} ej.
                      </span>
                      {day.muscleGroups[0] && (
                        <span className="px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-blue-950/60 text-blue-300 border border-blue-800/40 truncate max-w-[90px]">
                          {day.muscleGroups[0]}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Pie de Tarjeta: Estado (Completada / Planificada / Descanso) */}
              <div className="pt-1.5 border-t border-slate-800/60 flex items-center justify-between gap-1 text-[10px] w-full">
                {day.isCompleted ? (
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-400 truncate">
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    <span>
                      {day.executedDateKey && day.executedDateKey !== day.dateKey
                        ? `Hecha ${formatDisplayDateDDMMYYYY(day.executedDateKey).slice(0, 5)}`
                        : 'Hecha'}
                    </span>
                  </span>
                ) : day.isRestDay ? (
                  <span className="text-slate-500 font-medium truncate">Día libre</span>
                ) : day.isPastDate ? (
                  <span className="text-rose-400/80 font-medium truncate">Sin registro</span>
                ) : (
                  <span className="text-blue-400/90 font-semibold truncate">Programada</span>
                )}

                <span className="text-[9px] font-mono text-slate-500 tabular-nums shrink-0">
                  {day.displayDate.slice(0, 5)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Panel Inferior de Inspección Rápida del Día Seleccionado */}
      {activeDayDetail && (
        <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950/90 border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-extrabold text-white">
                {activeDayDetail.weekdayName} ({activeDayDetail.displayDate})
              </span>
              {activeDayDetail.isRestDay ? (
                <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  DESCANSO
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-blue-950/60 border border-blue-800/50 text-[10px] font-semibold text-blue-300">
                  {activeDayDetail.assignedRoutine?.exercises.length} ejercicios asignados
                </span>
              )}
              {activeDayDetail.isCompleted && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-700/50 text-[10px] font-bold text-emerald-300 tabular-nums">
                  <Flame className="w-3 h-3 text-emerald-400" />
                  {activeDayDetail.executedVolumeKg.toLocaleString('es-ES')} kg movidos
                </span>
              )}
            </div>

            {activeDayDetail.isRestDay ? (
              <p className="text-xs text-slate-400">
                Jornada destinada a supercompensación muscular, hidratación y descarga del sistema nervioso central.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {activeDayDetail.assignedRoutine?.exercises.slice(0, 5).map((ex) => (
                  <span
                    key={ex.id}
                    className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[11px] text-slate-300 truncate max-w-[180px]"
                  >
                    {ex.name}
                  </span>
                ))}
                {(activeDayDetail.assignedRoutine?.exercises.length || 0) > 5 && (
                  <span className="text-[11px] text-slate-500 font-mono">
                    +{(activeDayDetail.assignedRoutine?.exercises.length || 0) - 5} más
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Acciones directas si el día tiene rutina */}
          {activeDayDetail.assignedRoutine && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onSelectDay(activeDayDetail.assignedRoutine!)}
                className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Ver Rutina</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
              <button
                type="button"
                onClick={() => onStartWorkout(activeDayDetail.assignedRoutine!)}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-slate-950" />
                <span>Entrenar</span>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
