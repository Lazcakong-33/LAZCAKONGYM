import React, { useMemo } from 'react';
import { CalendarCheck2, Flame, Layers, Sparkles, CheckCircle2 } from 'lucide-react';
import {
  calculateExecutedWeekStatus,
  ActiveRoutineConfig,
  WorkoutLogEntryMinimal,
} from '../utils/weeklyCycleManager';
import { formatDisplayDateDDMMYYYY } from '../utils/exportReport';

export interface ExecutedWeekTrackerCardProps {
  /** Historial de entrenamientos completados del atleta */
  history: WorkoutLogEntryMinimal[];
  /** Configuración de la rutina activa (frecuencia N días/semana y total de semanas) */
  routineConfig: ActiveRoutineConfig;
  /** Modo compacto opcional para cabeceras reducidas */
  compact?: boolean;
}

export const ExecutedWeekTrackerCard: React.FC<ExecutedWeekTrackerCardProps> = ({
  history,
  routineConfig,
  compact = false,
}) => {
  const status = useMemo(
    () => calculateExecutedWeekStatus(history, routineConfig),
    [history, routineConfig]
  );

  const lastTrainedDateFormatted = useMemo(() => {
    if (status.uniqueTrainedDates.length === 0) return null;
    const latestKey = status.uniqueTrainedDates[status.uniqueTrainedDates.length - 1];
    return formatDisplayDateDDMMYYYY(latestKey);
  }, [status.uniqueTrainedDates]);

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0d1526]/95 via-[#090e1a]/95 to-[#060911] backdrop-blur-xl border border-white/[0.08] hover:border-accent/35 p-4 sm:p-5 shadow-[0_14px_34px_-10px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.08)] transition-all duration-300 font-sans space-y-3.5">
      {/* Resplandor neón ambiental */}
      <div
        className="pointer-events-none absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl opacity-50"
        style={{ backgroundColor: 'var(--accent-soft-bg)' }}
      />

      {/* Fila Superior: Título + Indicador de Semana Actual vs Total de Semanas */}
      <div className="relative z-10 flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0 shadow-[0_2px_10px_var(--accent-glow)]">
            <CalendarCheck2 className="w-4 h-4 text-accent-text" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-accent-text truncate">
                Semana Actual Ejecutada
              </span>
              <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-[9px] font-semibold text-slate-300">
                Frecuencia: {status.daysPerWeek}d / sem
              </span>
            </div>
            <h3 className="text-xs sm:text-sm font-bold text-white truncate mt-0.5">
              {routineConfig.routineProgramName || 'Progresión por Días Únicos Entrenados'}
            </h3>
          </div>
        </div>

        {/* Contador Principal: SEMANA X / TOTAL */}
        <div className="flex items-baseline gap-1 px-3 py-1.5 rounded-xl bg-slate-950/90 border border-accent/35 shadow-[0_0_16px_var(--accent-glow)] shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">
            Sem
          </span>
          <span className="text-xl sm:text-2xl font-black text-accent-text tabular-nums leading-none">
            {status.currentExecutedWeek}
          </span>
          <span className="text-xs font-bold text-slate-500 tabular-nums">
            / {status.totalWeeks}
          </span>
        </div>
      </div>

      {/* Barra Segmentada de la Semana en Curso (1 segmento por cada día único requerido N) */}
      <div className="relative z-10 space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-300 font-medium">
            Avance de la <strong className="text-white">Semana {status.currentExecutedWeek}</strong>:{' '}
            <span className="text-accent-text font-bold tabular-nums">
              {status.daysInCurrentWeek} de {status.daysPerWeek}
            </span>{' '}
            días únicos
          </span>
          <span className="text-slate-400 font-semibold tabular-nums">
            {status.currentWeekProgressPct}%
          </span>
        </div>

        {/* Segmentos de días (N bloques) */}
        <div
          className="grid gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${Math.min(status.daysPerWeek, 7)}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: Math.min(status.daysPerWeek, 7) }).map((_, idx) => {
            const isDayDone = idx < status.daysInCurrentWeek;
            return (
              <div
                key={idx}
                className={`h-2.5 rounded-full transition-all duration-300 border ${
                  isDayDone
                    ? 'bg-accent border-accent shadow-[0_0_10px_var(--accent-glow)]'
                    : 'bg-slate-900/90 border-slate-800'
                }`}
                title={`Día ${idx + 1} de ${status.daysPerWeek} (${
                  isDayDone ? 'Completado' : 'Pendiente'
                })`}
              />
            );
          })}
        </div>
      </div>

      {/* Barra Continua de Progreso Global del Bloque + Metadatos de Días Únicos */}
      {!compact && (
        <div className="relative z-10 pt-2 border-t border-white/[0.06] space-y-2">
          <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{
                width: `${Math.max(4, status.totalProgramProgressPct)}%`,
                boxShadow: '0 0 10px var(--accent-glow)',
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1 font-medium text-slate-300">
                <CheckCircle2 className="w-3 h-3 text-accent-text" />
                <strong className="text-white tabular-nums">{status.uniqueDaysCount}</strong> días únicos entrenados
              </span>
              <span className="inline-flex items-center gap-1">
                <Layers className="w-3 h-3 text-cyan-400" />
                <strong className="text-slate-200 tabular-nums">{status.completedFullWeeks}</strong> sem. cerradas
              </span>
            </div>

            <div className="flex items-center gap-2">
              {lastTrainedDateFormatted && (
                <span className="text-slate-400 font-mono">
                  Último día: <strong className="text-slate-200">{lastTrainedDateFormatted}</strong>
                </span>
              )}
              <span className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.07] text-slate-300 font-semibold tabular-nums">
                Faltan {status.daysRemainingForNextWeek}d → Sem {status.currentExecutedWeek + 1}
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
