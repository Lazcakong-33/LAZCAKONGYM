import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  History,
  Medal,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import {
  CompletedWorkout,
  PersonalRecord,
  Routine,
} from '../types';
import {
  DailyComparativeGroup,
  formatDisplayDateDDMMYYYY,
} from '../utils/exportReport';
import {
  computeElitePerformanceAnalytics,
  ElitePersonalRecordItem,
  PerformancePeriodFilter,
} from '../utils/elitePerformanceAnalytics';

interface PersonalRecordsHallOfFameProps {
  prs?: Record<string, PersonalRecord>;
  history?: CompletedWorkout[];
  routines?: Routine[];
  comparativeGroups?: DailyComparativeGroup[];
  selectedDayFilter?: string;
  recordsSummary?: {
    surpassedPRsInPeriodCount: number;
    surpassedExercisesInPeriodCount: number;
    baselineMarksInPeriodCount: number;
    records: ElitePersonalRecordItem[];
  };
  periodLabel?: string;
  selectedPeriod?: PerformancePeriodFilter;
}

export const PersonalRecordsHallOfFame: React.FC<PersonalRecordsHallOfFameProps> = ({
  prs = {},
  history = [],
  routines = [],
  recordsSummary: externalSummary,
  periodLabel = 'Período activo',
  selectedPeriod = '30d',
}) => {
  const [isWidgetExpanded, setIsWidgetExpanded] = useState<boolean>(false);
  const [recordFilter, setRecordFilter] = useState<'ALL' | 'NEW_IN_PERIOD' | 'WITH_EVOLUTION'>('ALL');
  const [expandedHistoryExId, setExpandedHistoryExId] = useState<string | null>(null);

  // Fuente única de verdad: usar recordsSummary calculado en ProgresoView o calcularlo de forma pura
  const summary = useMemo(() => {
    if (externalSummary) return externalSummary;
    return computeElitePerformanceAnalytics({
      history,
      routines,
      prs,
      period: selectedPeriod,
    }).recordsSummary;
  }, [externalSummary, history, routines, prs, selectedPeriod]);

  const allRecords = summary.records;

  const filteredRecords = useMemo(() => {
    if (recordFilter === 'NEW_IN_PERIOD') {
      return allRecords.filter((r) => r.hasVerifiedNewRecordInPeriod);
    }
    if (recordFilter === 'WITH_EVOLUTION') {
      return allRecords.filter((r) => r.sessionsCount >= 2);
    }
    return allRecords;
  }, [allRecords, recordFilter]);

  const withEvolutionCount = useMemo(
    () => allRecords.filter((r) => r.sessionsCount >= 2).length,
    [allRecords]
  );

  const top1RMRecord = useMemo(() => {
    if (allRecords.length === 0) return null;
    return allRecords.reduce(
      (best, curr) => (curr.best1RM > best.best1RM ? curr : best),
      allRecords[0]
    );
  }, [allRecords]);

  return (
    <section
      aria-label="Récords Personales Elite"
      className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl shadow-xl font-sans overflow-hidden"
    >
      {/* Cabecera Acordeón Unificada */}
      <button
        type="button"
        onClick={() => setIsWidgetExpanded((prev) => !prev)}
        className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-[#1b1b1b] transition-colors min-h-[64px]"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent-text shrink-0">
            <Trophy className="w-5 h-5" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h3 className="text-sm sm:text-base font-black text-white tracking-tight">
                SALÓN DE LA FAMA · RÉCORDS PERSONALES
              </h3>
            </div>
            <div className="text-xs text-neutral-400 mt-0.5 flex flex-wrap items-center gap-x-2 tabular-nums">
              <span className="text-accent-text font-bold">
                {summary.surpassedPRsInPeriodCount} superado(s) ({periodLabel})
              </span>
              <span className="text-neutral-600" aria-hidden="true">·</span>
              <span>{allRecords.length} ejercicio(s) con marca</span>
              {top1RMRecord && top1RMRecord.best1RM > 0 && (
                <>
                  <span className="text-neutral-600 hidden sm:inline" aria-hidden="true">·</span>
                  <span className="hidden sm:inline text-neutral-300">
                    Top 1RM est.: <strong className="text-white">~{top1RMRecord.best1RM} kg</strong>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-xs font-bold text-accent-text">
          <span className="hidden sm:inline">
            {isWidgetExpanded ? 'Ocultar' : 'Ver detalle'}
          </span>
          <div className="w-9 h-9 rounded-xl bg-[#090909] border border-[#303030] flex items-center justify-center text-neutral-300">
            {isWidgetExpanded ? (
              <ChevronUp className="w-4 h-4 text-accent-text" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        </div>
      </button>

      {/* Cuerpo Desplegable */}
      {isWidgetExpanded && (
        <div className="p-4 sm:p-5 border-t border-[#303030] space-y-4 bg-[#090909]/60">
          {/* Barra de filtros táctil */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRecordFilter('ALL')}
                className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  recordFilter === 'ALL'
                    ? 'bg-accent text-accent-contrast'
                    : 'bg-[#171717] text-neutral-300 border border-[#303030] hover:text-white'
                }`}
              >
                Todos ({allRecords.length})
              </button>
              <button
                type="button"
                onClick={() => setRecordFilter('NEW_IN_PERIOD')}
                className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  recordFilter === 'NEW_IN_PERIOD'
                    ? 'bg-accent text-accent-contrast'
                    : 'bg-[#171717] text-neutral-300 border border-[#303030] hover:text-white'
                }`}
              >
                Nuevos en período ({summary.surpassedExercisesInPeriodCount})
              </button>
              <button
                type="button"
                onClick={() => setRecordFilter('WITH_EVOLUTION')}
                className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  recordFilter === 'WITH_EVOLUTION'
                    ? 'bg-accent text-accent-contrast'
                    : 'bg-[#171717] text-neutral-300 border border-[#303030] hover:text-white'
                }`}
              >
                Con evolución ({withEvolutionCount})
              </button>
            </div>

            <span className="text-[11px] text-neutral-500">
              Solo se etiquetan como &quot;Nuevo Récord&quot; marcas que superan registros previos verificados.
            </span>
          </div>

          {filteredRecords.length === 0 ? (
            <div className="p-6 rounded-2xl bg-[#171717] border border-[#303030] text-center text-xs text-neutral-400">
              No hay récords personales verificados para el filtro seleccionado.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[480px] overflow-y-auto pr-1">
              {filteredRecords.map((rec) => {
                const isHistoryOpen = expandedHistoryExId === rec.id;

                return (
                  <div
                    key={rec.id}
                    className={`p-3.5 rounded-2xl border bg-[#171717] flex flex-col justify-between gap-3 transition-colors ${
                      rec.hasVerifiedNewRecordInPeriod
                        ? 'border-accent/60'
                        : 'border-[#303030] hover:border-neutral-600'
                    }`}
                  >
                    {/* Cabecera ejercicio */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-black text-white truncate">
                          {rec.exerciseName}
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-0.5 flex items-center gap-1.5">
                          <span>{rec.muscleGroup}</span>
                          <span aria-hidden="true">·</span>
                          <span>{rec.sessionsCount} reg.</span>
                        </div>
                      </div>

                      {rec.hasVerifiedNewRecordInPeriod ? (
                        <span className="text-[10px] font-black text-accent-contrast bg-accent px-2 py-0.5 rounded-md shrink-0 whitespace-nowrap">
                          ★ Nuevo Récord
                        </span>
                      ) : (
                        <Medal className="w-4 h-4 text-neutral-500 shrink-0" />
                      )}
                    </div>

                    {/* Separación explícita: Marca Real vs Mejor 1RM Estimado */}
                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-[#090909] border border-[#303030]/70 tabular-nums">
                      <div>
                        <span className="text-[10px] text-neutral-400 block uppercase">
                          Marca Real Máx.
                        </span>
                        <span className="text-sm font-black text-white">
                          {rec.bestWeightKg} kg × {rec.bestWeightReps}r
                        </span>
                        <span className="text-[10px] text-neutral-500 block">
                          {formatDisplayDateDDMMYYYY(rec.bestWeightDate)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-neutral-400 block uppercase">
                          Mejor 1RM Est.
                        </span>
                        <span className="text-sm font-black text-accent-text">
                          ~{rec.best1RM} kg
                        </span>
                        <span className="text-[10px] text-neutral-500 block">
                          Base: {rec.best1RMSourceWeight}×{rec.best1RMSourceReps} ·{' '}
                          {formatDisplayDateDDMMYYYY(rec.best1RMDate)}
                        </span>
                      </div>
                    </div>

                    {/* Evolución histórica & botón de línea de tiempo */}
                    <div className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t border-[#303030]/60 tabular-nums">
                      <div className="flex items-center gap-1.5 text-neutral-300">
                        <TrendingUp className="w-3.5 h-3.5 text-accent-text shrink-0" />
                        {rec.total1RMGainKg !== null && rec.total1RMGainPct !== null ? (
                          <span>
                            1RM: ~{rec.firstRecorded1RM}→~{rec.best1RM} kg (
                            <strong
                              className={
                                rec.total1RMGainKg >= 0 ? 'text-accent-text' : 'text-rose-400'
                              }
                            >
                              {rec.total1RMGainKg >= 0
                                ? `+${rec.total1RMGainKg}`
                                : rec.total1RMGainKg}{' '}
                              kg
                            </strong>
                            )
                          </span>
                        ) : (
                          <span className="text-neutral-500">Marca base única</span>
                        )}
                      </div>

                      {rec.historySnapshots.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedHistoryExId(isHistoryOpen ? null : rec.id)
                          }
                          className="text-[11px] font-bold text-accent-text hover:underline flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <History className="w-3 h-3" />
                          <span>{isHistoryOpen ? 'Cerrar' : 'Historial'}</span>
                        </button>
                      )}
                    </div>

                    {/* Línea temporal compacta de marcas del ejercicio */}
                    {isHistoryOpen && rec.historySnapshots.length > 1 && (
                      <div className="p-2.5 rounded-xl bg-[#090909] border border-[#303030] space-y-1.5 max-h-36 overflow-y-auto text-[11px] tabular-nums">
                        {[...rec.historySnapshots].reverse().map((snap, idx) => (
                          <div
                            key={`${snap.workoutId}-${idx}`}
                            className="flex items-center justify-between gap-2 text-neutral-300"
                          >
                            <span className="text-neutral-400">
                              {formatDisplayDateDDMMYYYY(snap.date)}
                              {snap.isSurpassedPR && (
                                <span className="ml-1 text-accent-text font-bold">★ PR</span>
                              )}
                            </span>
                            <span>
                              <strong className="text-white">
                                {snap.weightKg}kg×{snap.reps}r
                              </strong>{' '}
                              <span className="text-accent-text">(~{snap.estimated1RM}kg)</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
