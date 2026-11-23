import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Check,
  TrendingUp,
  History,
  X,
  Info,
  Trophy,
  AlertCircle,
} from 'lucide-react';
import { CompletedWorkout, Exercise, LoggedSet, PersonalRecord } from '../types';
import {
  evaluateNextSessionProgression,
  findPreviousExerciseSessions,
  MatchedPreviousExerciseSession,
  SessionProgressionStatus,
} from '../utils/progressionEngine';

import { CHILE_TIMEZONE, getChileLocalDateKey } from '../utils/calorieCalculator';

function formatChileTimeHHMM(dateInput: number | string | Date): string {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: CHILE_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function formatSessionDateLabel(rawDate?: string, timestamp?: number, includeTime = false): string {
  const effectiveInput =
    timestamp && Number.isFinite(timestamp) && timestamp > 0
      ? timestamp
      : rawDate
      ? rawDate.trim()
      : null;

  if (!effectiveInput) return 'Reciente';

  const chileKey = getChileLocalDateKey(effectiveInput);
  if (chileKey && /^\d{4}-\d{2}-\d{2}$/.test(chileKey)) {
    const [yyyy, mm, dd] = chileKey.split('-');
    const baseDate = `${dd}/${mm}/${yyyy}`;
    if (includeTime && (typeof effectiveInput === 'number' || String(effectiveInput).includes('T'))) {
      const hhmm = formatChileTimeHHMM(effectiveInput);
      if (hhmm) return `${baseDate} · ${hhmm}`;
    }
    return baseDate;
  }

  return typeof effectiveInput === 'string' ? effectiveInput : 'Reciente';
}

function getLocalDayKeyFromTimestamp(ts?: number, fallbackDate?: string): string {
  if (ts && Number.isFinite(ts) && ts > 0) {
    const key = getChileLocalDateKey(ts);
    if (key) return key;
  }
  if (fallbackDate) {
    const key = getChileLocalDateKey(fallbackDate);
    if (key) return key;
  }
  return '';
}

interface RecommendedLoadForecastWidgetProps {
  exerciseId: string;
  originalExerciseId?: string;
  libraryExerciseId?: string;
  exerciseName: string;
  activeExerciseName: string;
  originalExerciseName?: string;
  useAlternative?: boolean;
  sets: LoggedSet[];
  history?: CompletedWorkout[];
  existingPR?: PersonalRecord;
  rawExercise?: Exercise;
  equipmentHint?: string;
  repRange?: string;
  routineModality?: string;
  exerciseObjective?: string;
  currentSessionId?: string;
  currentSessionStartTime?: number;
  activeProfileId?: string;
  isHistoryExpanded?: boolean;
  isHistorySyncing?: boolean;
  historySyncError?: string | null;
  onApplySuggestedLoad: (
    weight: number,
    reps: number,
    targetSetIndex: number,
    options?: { applyToAllPending?: boolean }
  ) => void;
}

function getStatusVisuals(status: SessionProgressionStatus): {
  containerBorder: string;
  badgeClasses: string;
  iconColor: string;
} {
  switch (status) {
    case 'increase_load':
      return {
        containerBorder: 'border-accent/60',
        badgeClasses: 'text-accent-contrast bg-accent border-accent',
        iconColor: 'text-accent-text',
      };
    case 'hold_improve_reps':
      return {
        containerBorder: 'border-emerald-500/40',
        badgeClasses: 'text-emerald-300 bg-emerald-950/50 border-emerald-500/40',
        iconColor: 'text-emerald-400',
      };
    case 'review_load':
      return {
        containerBorder: 'border-amber-500/50',
        badgeClasses: 'text-amber-300 bg-amber-950/50 border-amber-500/50',
        iconColor: 'text-amber-400',
      };
    case 'incomplete_data':
    case 'incompatible_objective':
      return {
        containerBorder: 'border-[#303030]',
        badgeClasses: 'text-zinc-200 bg-[#090909] border-[#303030]',
        iconColor: 'text-zinc-300',
      };
    case 'first_session':
    default:
      return {
        containerBorder: 'border-[#303030]',
        badgeClasses: 'text-accent-text bg-[#090909] border-accent/40',
        iconColor: 'text-accent-text',
      };
  }
}

export const RecommendedLoadForecastWidget: React.FC<RecommendedLoadForecastWidgetProps> = ({
  exerciseId,
  originalExerciseId,
  libraryExerciseId,
  exerciseName,
  activeExerciseName,
  originalExerciseName,
  useAlternative,
  sets,
  history = [],
  existingPR,
  rawExercise,
  equipmentHint,
  repRange,
  routineModality,
  exerciseObjective,
  currentSessionId,
  currentSessionStartTime,
  activeProfileId,
  isHistoryExpanded = false,
  isHistorySyncing = false,
  historySyncError = null,
  onApplySuggestedLoad,
}) => {
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);
  const [appliedLabel, setAppliedLabel] = useState<string | null>(null);
  const [editedWeight, setEditedWeight] = useState<string>('');
  const [editedReps, setEditedReps] = useState<string>('');

  // Pending working sets ONLY (never touch completed or warmup sets)
  const pendingWorkingIndices = useMemo(() => {
    const indices: number[] = [];
    sets.forEach((s, idx) => {
      if (!s.completed && !s.isWarmup) indices.push(idx);
    });
    return indices;
  }, [sets]);

  const nextPendingWorkingIndex = pendingWorkingIndices.length > 0 ? pendingWorkingIndices[0] : -1;
  const nextPendingSet = nextPendingWorkingIndex >= 0 ? sets[nextPendingWorkingIndex] : null;
  const workingSetsCount = useMemo(
    () => Math.max(1, sets.filter((s) => !s.isWarmup).length),
    [sets]
  );

  // Lookup strictly finished prior workouts of the same athlete, exercise, equipment & biomechanical variant
  const matchedSessions: MatchedPreviousExerciseSession[] = useMemo(() => {
    return findPreviousExerciseSessions({
      history,
      exercise: {
        exerciseId,
        originalExerciseId,
        libraryExerciseId: libraryExerciseId || rawExercise?.libraryExerciseId,
        activeExerciseName,
        originalExerciseName: originalExerciseName || exerciseName,
        equipment: equipmentHint || rawExercise?.equipment,
        useAlternative,
      },
      currentSessionId,
      currentSessionStartTime,
      activeProfileId,
      limit: 50,
    });
  }, [
    history,
    exerciseId,
    originalExerciseId,
    libraryExerciseId,
    rawExercise?.libraryExerciseId,
    rawExercise?.equipment,
    activeExerciseName,
    originalExerciseName,
    exerciseName,
    equipmentHint,
    useAlternative,
    currentSessionId,
    currentSessionStartTime,
    activeProfileId,
  ]);

  const latestSession = matchedSessions[0] || null;

  // Determine whether timestamps should display HH:mm (if same calendar day as current session or multiple sessions share a date)
  const showDateTimeForLatest = useMemo(() => {
    if (!latestSession) return false;
    const latestDay = getLocalDayKeyFromTimestamp(latestSession.timestamp, latestSession.date);
    const todayDay = getLocalDayKeyFromTimestamp(currentSessionStartTime || Date.now());
    if (latestDay && todayDay && latestDay === todayDay) return true;
    return (
      matchedSessions.filter(
        (s) => getLocalDayKeyFromTimestamp(s.timestamp, s.date) === latestDay
      ).length > 1
    );
  }, [latestSession, matchedSessions, currentSessionStartTime]);

  const recommendation = useMemo(() => {
    return evaluateNextSessionProgression({
      previousSession: latestSession,
      exerciseName: activeExerciseName,
      equipmentHint: equipmentHint || rawExercise?.equipment,
      repRangeStr: repRange || rawExercise?.repRange,
      targetSetsCount: workingSetsCount,
      routineModality,
      exerciseObjective: exerciseObjective || rawExercise?.objective,
    });
  }, [
    latestSession,
    activeExerciseName,
    equipmentHint,
    rawExercise?.equipment,
    rawExercise?.repRange,
    rawExercise?.objective,
    repRange,
    workingSetsCount,
    routineModality,
    exerciseObjective,
  ]);

  // Sync editable weight/reps inputs whenever the exercise or evaluated recommendation changes
  useEffect(() => {
    setDismissedSuggestion(false);
    setAppliedLabel(null);
    setEditedWeight(
      typeof recommendation.suggestedWeightKg === 'number' && recommendation.suggestedWeightKg > 0
        ? String(recommendation.suggestedWeightKg)
        : ''
    );
    setEditedReps(
      typeof recommendation.suggestedReps === 'number' && recommendation.suggestedReps > 0
        ? String(recommendation.suggestedReps)
        : ''
    );
  }, [
    exerciseId,
    activeExerciseName,
    recommendation.status,
    recommendation.suggestedWeightKg,
    recommendation.suggestedReps,
  ]);

  const verifiedPR = useMemo(() => {
    const isSwapped =
      (originalExerciseName || exerciseName).trim().toLowerCase() !==
      activeExerciseName.trim().toLowerCase();
    if (!isSwapped && existingPR && existingPR.maxWeight > 0) {
      return existingPR;
    }
    if (
      existingPR &&
      existingPR.maxWeight > 0 &&
      existingPR.exerciseName.trim().toLowerCase() === activeExerciseName.trim().toLowerCase()
    ) {
      return existingPR;
    }
    return undefined;
  }, [existingPR, activeExerciseName, exerciseName, originalExerciseName]);

  const visuals = getStatusVisuals(recommendation.status);

  const parsedEditedWeight = Number(editedWeight);
  const parsedEditedReps = Math.round(Number(editedReps));
  const isEditedSuggestionValid =
    Number.isFinite(parsedEditedWeight) &&
    parsedEditedWeight > 0 &&
    Number.isFinite(parsedEditedReps) &&
    parsedEditedReps > 0;

  const handleApply = (applyToAllPending: boolean) => {
    if (nextPendingWorkingIndex < 0 || !isEditedSuggestionValid) return;
    onApplySuggestedLoad(parsedEditedWeight, parsedEditedReps, nextPendingWorkingIndex, {
      applyToAllPending,
    });
    setAppliedLabel(
      applyToAllPending
        ? `Aplicado (${pendingWorkingIndices.length} pendientes)`
        : `Aplicado a Serie #${nextPendingSet?.setNumber ?? nextPendingWorkingIndex + 1}`
    );
    window.setTimeout(() => setAppliedLabel(null), 2000);
  };

  return (
    <div
      data-testid="last-session-progression-card"
      className="space-y-2"
    >
      {/* 1. TARJETA COMPACTA: ÚLTIMA SESIÓN REAL + SUGERENCIA PARA HOY */}
      <div className="rounded-2xl bg-[#090909] border border-[#303030] p-3 space-y-2.5">
        {/* Cabecera Última Sesión */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-[#171717] border border-[#303030] flex items-center justify-center text-accent-text shrink-0">
              <History className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                  Última sesión
                </span>
                {latestSession && (
                  <span className="text-[11px] font-mono font-bold text-accent-text tabular-nums">
                    {formatSessionDateLabel(
                      latestSession.date,
                      latestSession.timestamp,
                      showDateTimeForLatest
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>

          {verifiedPR && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#171717] border border-accent/40 text-accent-text text-[10px] font-mono font-bold tabular-nums"
              title={`Récord personal verificado el ${formatSessionDateLabel(verifiedPR.date)}`}
            >
              <Trophy className="w-3 h-3 fill-current" />
              <span>
                PR {verifiedPR.maxWeight}kg×{verifiedPR.repsAtMaxWeight}
              </span>
            </span>
          )}
        </div>

        {/* Detalle serie por serie o mensaje Primera Sesión */}
        {latestSession ? (
          <div className="space-y-1.5">
            {latestSession.hasPerSetDetail && latestSession.setsDetail.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {latestSession.setsDetail.map((snap, idx) => (
                  <span
                    key={`prev-set-${snap.setNumber}-${idx}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#141414] border border-[#303030] text-[11px] font-mono tabular-nums text-[#F5F5F5]"
                  >
                    <span className="text-zinc-500 font-bold">S{snap.setNumber}:</span>
                    <strong className="text-accent-text font-black">
                      {snap.weight > 0 ? `${snap.weight} kg` : 'PC'}
                    </strong>
                    <span className="text-zinc-400">× {snap.reps}</span>
                    {typeof snap.rpe === 'number' && (
                      <span className="text-zinc-400 text-[10px]">
                        @{snap.rpe}
                        {typeof snap.rir === 'number' ? ` (${snap.rir} RIR)` : ''}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono tabular-nums text-[#F5F5F5]">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141414] border border-[#303030]">
                  <strong className="text-accent-text font-black">
                    {latestSession.maxWeight > 0 ? `${latestSession.maxWeight} kg` : 'Sin carga'}
                  </strong>
                  <span className="text-zinc-400">× {latestSession.maxReps} reps máx</span>
                  <span className="text-zinc-500">· {latestSession.setsCount} series (resumen)</span>
                  {typeof latestSession.avgRpe === 'number' && (
                    <span className="text-zinc-400">
                      · @{latestSession.avgRpe} ({Math.max(0, Number((10 - latestSession.avgRpe).toFixed(1)))} RIR)
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        ) : isHistorySyncing ? (
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-300 bg-[#141414] border border-[#303030] rounded-lg px-2.5 py-2">
            <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
            <span>Pendiente de sincronización: consultando historial en la nube...</span>
          </div>
        ) : historySyncError ? (
          <div className="flex items-center gap-2 text-xs font-mono text-amber-300 bg-amber-950/30 border border-amber-500/40 rounded-lg px-2.5 py-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Error de permisos: no se pudo sincronizar el historial</span>
          </div>
        ) : history.length > 0 ? (
          <p className="text-xs font-bold text-zinc-300 bg-[#141414] border border-[#303030] rounded-lg px-2.5 py-2 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span>Historial no encontrado para esta variante: registra tu carga inicial</span>
          </p>
        ) : (
          <p className="text-xs font-bold text-accent-text bg-[#141414] border border-[#303030] rounded-lg px-2.5 py-2">
            Primera sesión: registra tu carga inicial
          </p>
        )}

        {/* Desplegable de sesiones anteriores extra (si el botón Historial del encabezado está abierto) */}
        {isHistoryExpanded && matchedSessions.length > 1 && (
          <div className="pt-2 border-t border-[#303030]/70 space-y-1">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Historial reciente ({matchedSessions.length} sesiones)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {matchedSessions.slice(1).map((prevS, idx) => (
                <span
                  key={`${prevS.workoutId}-${idx}`}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#141414] border border-[#303030] text-[10px] font-mono tabular-nums text-zinc-300"
                >
                  <span className="text-zinc-500">
                    {formatSessionDateLabel(prevS.date, prevS.timestamp, true)}:
                  </span>
                  <strong className="text-[#F5F5F5]">
                    {prevS.hasPerSetDetail
                      ? prevS.setsDetail.map((s) => `${s.weight}×${s.reps}`).join(' · ')
                      : `${prevS.maxWeight}kg×${prevS.maxReps} (${prevS.setsCount}s)`}
                  </strong>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 2. SUGERENCIA PARA HOY (cuando no ha sido descartada) */}
        {!dismissedSuggestion ? (
          <div className={`rounded-xl bg-[#141414] border ${visuals.containerBorder} p-2.5 space-y-2`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-zinc-300">
                    <Sparkles className={`w-3 h-3 ${visuals.iconColor}`} />
                    <span>Sugerencia para hoy</span>
                  </span>
                  <span
                    className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${visuals.badgeClasses}`}
                  >
                    {isHistorySyncing
                      ? 'SINCRONIZANDO'
                      : historySyncError
                      ? 'PERMISOS'
                      : !latestSession && history.length > 0
                      ? 'CALIBRAR'
                      : recommendation.badgeText}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-400 bg-[#090909] border border-[#303030] px-1.5 py-0.5 rounded">
                    {recommendation.objectiveLabel} · {recommendation.targetMinReps}–{recommendation.targetMaxReps} reps
                  </span>
                </div>

                {isHistorySyncing ? (
                  <p className="text-xs font-bold text-zinc-300 leading-snug">
                    Sincronización en curso
                  </p>
                ) : historySyncError ? (
                  <p className="text-xs font-bold text-amber-300 leading-snug">
                    Permisos de historial no validados
                  </p>
                ) : !latestSession && history.length > 0 ? (
                  <p className="text-xs font-bold text-[#F5F5F5] leading-snug">
                    Carga inicial para esta variante
                  </p>
                ) : recommendation.status !== 'first_session' && (
                  <p className="text-xs font-bold text-[#F5F5F5] leading-snug">
                    {recommendation.summaryLine}
                  </p>
                )}

                <p className="text-[11px] text-zinc-400 leading-relaxed flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
                  <span>
                    {isHistorySyncing
                      ? 'Esperando respuesta del servidor remoto para evaluar tu progresión real.'
                      : historySyncError
                      ? 'No fue posible acceder a tus entrenamientos previos. Puedes continuar registrando series de forma local.'
                      : !latestSession && history.length > 0
                      ? 'No hay registros previos específicos de este ejercicio. Registra tu peso y repeticiones de hoy para calibrar la progresión.'
                      : recommendation.detailReason}
                  </span>
                </p>
              </div>

              {recommendation.status !== 'first_session' && (
                <button
                  type="button"
                  onClick={() => setDismissedSuggestion(true)}
                  className="p-1 rounded-lg text-zinc-500 hover:text-[#F5F5F5] hover:bg-[#090909] transition-colors shrink-0 cursor-pointer"
                  title="Ignorar sugerencia"
                  aria-label="Ignorar sugerencia"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Control del atleta: editar o aplicar sugerencia sin sobrescribir completadas */}
            {recommendation.canApplySuggestion && (
              <div className="pt-2 border-t border-[#303030]/70 space-y-2">
                {nextPendingWorkingIndex >= 0 ? (
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div>
                        <label className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400 mb-0.5">
                          Peso (kg)
                        </label>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          min="0"
                          aria-label="Peso sugerido editable kg"
                          value={editedWeight}
                          onChange={(e) => setEditedWeight(e.target.value)}
                          className="w-20 min-h-[34px] px-2 rounded-lg bg-[#090909] border border-[#303030] focus:border-accent text-center font-mono tabular-nums text-xs font-black text-accent-text focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400 mb-0.5">
                          Reps obj.
                        </label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          aria-label="Repeticiones sugeridas editables"
                          value={editedReps}
                          onChange={(e) => setEditedReps(e.target.value)}
                          className="w-16 min-h-[34px] px-2 rounded-lg bg-[#090909] border border-[#303030] focus:border-accent text-center font-mono tabular-nums text-xs font-black text-[#F5F5F5] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                      <button
                        type="button"
                        onClick={() => setDismissedSuggestion(true)}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#090909] hover:bg-[#1f1f1f] border border-[#303030] text-zinc-400 hover:text-[#F5F5F5] text-[11px] font-bold transition-colors cursor-pointer"
                      >
                        Ignorar
                      </button>

                      {pendingWorkingIndices.length > 1 && (
                        <button
                          type="button"
                          disabled={!isEditedSuggestionValid}
                          onClick={() => handleApply(true)}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#090909] hover:bg-[#1f1f1f] border border-accent/40 text-accent-text text-[11px] font-bold transition-colors disabled:opacity-40 cursor-pointer"
                          title="Aplicar a todas las series pendientes sin tocar las completadas"
                        >
                          A pendientes ({pendingWorkingIndices.length})
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={!isEditedSuggestionValid}
                        onClick={() => handleApply(false)}
                        className={`min-h-[34px] px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-40 cursor-pointer ${
                          appliedLabel
                            ? 'bg-accent/20 border border-accent text-accent-text'
                            : 'bg-accent hover:bg-accent-hover text-accent-contrast'
                        }`}
                      >
                        {appliedLabel ? (
                          <>
                            <Check className="w-3.5 h-3.5 stroke-[2.8]" />
                            <span>{appliedLabel}</span>
                          </>
                        ) : (
                          <>
                            <TrendingUp className="w-3.5 h-3.5 stroke-[2.5]" />
                            <span>Aplicar sugerencia</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] font-mono text-zinc-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-accent-text shrink-0" />
                    <span>Todas las series efectivas están completadas; no se modifican cargas registradas.</span>
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#303030] text-[11px] text-zinc-400">
            <span>Sugerencia oculta para este ejercicio.</span>
            <button
              type="button"
              onClick={() => setDismissedSuggestion(false)}
              className="font-bold text-accent-text hover:underline cursor-pointer"
            >
              Ver sugerencia
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecommendedLoadForecastWidget;
