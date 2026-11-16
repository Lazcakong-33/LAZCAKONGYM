import React, { useMemo, useState } from 'react';
import {
  Sparkles,
  Check,
  TrendingUp,
  History,
  Copy,
  X,
  Info,
  Trophy,
} from 'lucide-react';
import { CompletedWorkout, Exercise, LoggedSet, PersonalRecord } from '../types';

function formatDateDDMMYYYY(rawDate?: string): string {
  if (!rawDate) return 'Reciente';
  const trimmed = rawDate.trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const [yyyy, mm, dd] = trimmed.slice(0, 10).split('-');
    return `${dd}/${mm}/${yyyy}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const dd = String(parsed.getDate()).padStart(2, '0');
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const yyyy = parsed.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return trimmed;
}

interface RecommendedLoadForecastWidgetProps {
  exerciseId: string;
  exerciseName: string;
  activeExerciseName: string;
  sets: LoggedSet[];
  history?: CompletedWorkout[];
  existingPR?: PersonalRecord;
  rawExercise?: Exercise;
  equipmentHint?: string;
  onApplySuggestedLoad: (weight: number, reps: number, targetSetIndex: number) => void;
  onCopyPreviousSessionToSets?: (weight: number, reps: number) => void;
}

interface SessionSnapshot {
  date: string;
  weight: number;
  reps: number;
  setsCount: number;
  tonnage: number;
  estimated1RM: number;
  rpe?: number;
}

function normalizeName(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function parseRepRangeTarget(
  repRange?: string,
  fallbackReps = 8
): { minReps: number; maxReps: number; targetReps: number } {
  if (!repRange) {
    return { minReps: fallbackReps, maxReps: fallbackReps + 2, targetReps: fallbackReps };
  }
  const matches = repRange.match(/\d+/g);
  if (!matches || matches.length === 0) {
    return { minReps: fallbackReps, maxReps: fallbackReps + 2, targetReps: fallbackReps };
  }
  if (matches.length === 1) {
    const val = Math.max(1, parseInt(matches[0], 10));
    return { minReps: val, maxReps: val, targetReps: val };
  }
  const minReps = Math.max(1, parseInt(matches[0], 10));
  const maxReps = Math.max(minReps, parseInt(matches[1], 10));
  return { minReps, maxReps, targetReps: minReps };
}

function resolveEquipmentIncrementKg(exerciseName: string, equipment?: string): {
  stepKg: number;
  equipmentLabel: string;
} {
  const norm = `${normalizeName(exerciseName)} ${normalizeName(equipment || '')}`;
  if (/prensa|leg press|hack squat|jaca/.test(norm)) {
    return { stepKg: 5, equipmentLabel: 'Máquina de carga / Prensa (+5 kg)' };
  }
  if (/mancuerna|dumbbell|polea|cable|elevacion lateral|curl|extension de tricep|pajaros/.test(norm)) {
    return { stepKg: 1.25, equipmentLabel: 'Mancuernas / Polea (+1.25 kg)' };
  }
  return { stepKg: 2.5, equipmentLabel: 'Barra / Máquina (+2.5 kg)' };
}

function roundToIncrement(weight: number, step = 2.5): number {
  if (weight <= 0) return step;
  return Math.round((weight / step) * 100) / (100 / step);
}

export const RecommendedLoadForecastWidget: React.FC<RecommendedLoadForecastWidgetProps> = ({
  exerciseId,
  exerciseName,
  activeExerciseName,
  sets,
  history = [],
  existingPR,
  rawExercise,
  equipmentHint,
  onApplySuggestedLoad,
  onCopyPreviousSessionToSets,
}) => {
  const [justAppliedSetNumber, setJustAppliedSetNumber] = useState<number | null>(null);
  const [justCopiedPrevious, setJustCopiedPrevious] = useState(false);
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);

  // Locate next uncompleted work set index
  const activeSetIndex = useMemo(() => {
    const nextWorkIdx = sets.findIndex((s) => !s.completed && !s.isWarmup);
    if (nextWorkIdx !== -1) return nextWorkIdx;
    const nextAnyIdx = sets.findIndex((s) => !s.completed);
    if (nextAnyIdx !== -1) return nextAnyIdx;
    return Math.max(0, sets.length - 1);
  }, [sets]);

  const activeSet = sets[activeSetIndex];

  // Extract real historical sessions for the currently active exercise
  const matchedSessions = useMemo(() => {
    const targetNorm = normalizeName(activeExerciseName);
    const isSwapped = normalizeName(activeExerciseName) !== normalizeName(exerciseName);
    const list: SessionSnapshot[] = [];

    const sortedHistory = [...history].sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

    for (const workout of sortedHistory) {
      if (!workout.exercisesSummary || workout.exercisesSummary.length === 0) continue;
      const match = workout.exercisesSummary.find((ex) => {
        if (!isSwapped && ex.exerciseId && ex.exerciseId === exerciseId) return true;
        const normEx = normalizeName(ex.name || '');
        return normEx === targetNorm;
      });

      if (match && match.maxWeight > 0) {
        const w = Number(match.maxWeight) || 0;
        const r = Math.max(1, Number(match.maxReps) || 8);
        const sCount = Math.max(1, Number(match.sets) || 3);
        const tonnage =
          match.volumeKg && match.volumeKg > 0 ? Math.round(match.volumeKg) : Math.round(w * r * sCount);
        const e1rm =
          match.estimated1RM && match.estimated1RM > 0
            ? Math.round(match.estimated1RM * 10) / 10
            : Math.round(w * (1 + r / 30) * 10) / 10;

        list.push({
          date: workout.date,
          weight: w,
          reps: r,
          setsCount: sCount,
          tonnage,
          estimated1RM: e1rm,
          rpe: match.rpe,
        });

        if (list.length === 3) break;
      }
    }

    return list;
  }, [activeExerciseName, exerciseName, exerciseId, history]);

  const latestSession = matchedSessions[0] || null;
  const verifiedPR = useMemo(() => {
    const isSwapped = normalizeName(activeExerciseName) !== normalizeName(exerciseName);
    if (!isSwapped && existingPR && existingPR.maxWeight > 0) {
      return existingPR;
    }
    if (existingPR && normalizeName(existingPR.exerciseName) === normalizeName(activeExerciseName) && existingPR.maxWeight > 0) {
      return existingPR;
    }
    return undefined;
  }, [existingPR, activeExerciseName, exerciseName]);

  // Evaluate progression ONLY when real history exists (Fase 6: No sugerir aumentos sin historial suficiente)
  const progressionSuggestion = useMemo(() => {
    if (!latestSession) return null;

    const { minReps, maxReps } = parseRepRangeTarget(
      rawExercise?.repRange,
      rawExercise?.defaultReps || 8
    );

    const { stepKg, equipmentLabel } = resolveEquipmentIncrementKg(
      activeExerciseName,
      equipmentHint || rawExercise?.equipment
    );

    const completedWorkSets = sets.filter(
      (s) => s.completed && !s.isWarmup && typeof s.weight === 'number' && s.weight > 0
    );
    const lastCompletedLiveSet =
      completedWorkSets.length > 0 ? completedWorkSets[completedWorkSets.length - 1] : null;

    const prevWeight = latestSession.weight;
    const prevReps = latestSession.reps;
    const prevRpe = latestSession.rpe;

    // Case 1: Live set had very high RPE (>= 9.5) -> Recommend holding or slight consolidation
    if (lastCompletedLiveSet && typeof lastCompletedLiveSet.rpe === 'number' && lastCompletedLiveSet.rpe >= 9.5) {
      const holdWeight = Number(lastCompletedLiveSet.weight) || prevWeight;
      const holdReps = Math.max(minReps, Number(lastCompletedLiveSet.reps) || prevReps);
      return {
        type: 'consolidate' as const,
        suggestedWeight: holdWeight,
        suggestedReps: holdReps,
        deltaLabel: 'Mantener carga',
        equipmentLabel,
        reason: `Registraste RPE @${lastCompletedLiveSet.rpe} en la serie previa. Se sugiere mantener ${holdWeight} kg para consolidar la técnica sin comprometer la recuperación.`,
      };
    }

    // Case 2: Previous session completed top of target rep range (prevReps >= maxReps) and RPE was not maximal (< 9.5)
    if (prevReps >= maxReps && (!prevRpe || prevRpe <= 9)) {
      const nextWeight = Number((prevWeight + stepKg).toFixed(2));
      return {
        type: 'increase_weight' as const,
        suggestedWeight: roundToIncrement(nextWeight, stepKg),
        suggestedReps: minReps,
        deltaLabel: `+${stepKg} kg`,
        equipmentLabel,
        reason: `En tu última sesión (${formatDateDDMMYYYY(latestSession.date)}) alcanzaste ${prevWeight} kg × ${prevReps} reps (tope del rango ${minReps}-${maxReps}). Sugerencia opcional: subir +${stepKg} kg e iniciar en ${minReps} reps.`,
      };
    }

    // Case 3: Within rep range -> Suggest adding +1 rep with the same weight (Double Progression)
    if (prevReps < maxReps) {
      const nextReps = Math.min(maxReps, prevReps + 1);
      return {
        type: 'increase_reps' as const,
        suggestedWeight: prevWeight,
        suggestedReps: nextReps,
        deltaLabel: '+1 rep',
        equipmentLabel,
        reason: `En tu última sesión registraste ${prevWeight} kg × ${prevReps} reps. Dentro del rango objetivo (${minReps}-${maxReps}), se sugiere mantener ${prevWeight} kg y buscar ${nextReps} repeticiones.`,
      };
    }

    return {
      type: 'consolidate' as const,
      suggestedWeight: prevWeight,
      suggestedReps: prevReps,
      deltaLabel: 'Consolidar',
      equipmentLabel,
      reason: `Última marca: ${prevWeight} kg × ${prevReps} reps (${formatDateDDMMYYYY(latestSession.date)}). Mantén la carga para consolidar el estímulo.`,
    };
  }, [latestSession, rawExercise, activeExerciseName, equipmentHint, sets]);

  const hasUncompletedSets = sets.some((s) => !s.completed);

  const handleApplySuggestion = () => {
    if (!progressionSuggestion) return;
    onApplySuggestedLoad(
      progressionSuggestion.suggestedWeight,
      progressionSuggestion.suggestedReps,
      activeSetIndex
    );
    setJustAppliedSetNumber(activeSet?.setNumber ?? activeSetIndex + 1);
    window.setTimeout(() => setJustAppliedSetNumber(null), 1800);
  };

  const handleCopyPrevious = () => {
    if (!latestSession || !onCopyPreviousSessionToSets) return;
    onCopyPreviousSessionToSets(latestSession.weight, latestSession.reps);
    setJustCopiedPrevious(true);
    window.setTimeout(() => setJustCopiedPrevious(false), 1800);
  };

  return (
    <div className="space-y-2.5">
      {/* FASE 4: HISTORIAL DE CARGAS Y REFERENCIA ANTERIOR */}
      <div className="rounded-xl bg-[#090909] border border-[#303030] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#171717] border border-[#303030] flex items-center justify-center text-[#CCFF00] shrink-0">
              <History className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-wider text-zinc-400">
                Historial de Cargas Reales
              </span>
              {latestSession ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono tabular-nums text-[#F5F5F5]">
                  <span>
                    Última:{' '}
                    <strong className="text-[#CCFF00] font-black">
                      {latestSession.weight} kg × {latestSession.reps} reps
                    </strong>
                  </span>
                  <span className="text-zinc-500">·</span>
                  <span className="text-zinc-300">{latestSession.setsCount} series</span>
                  <span className="text-zinc-500">·</span>
                  <span className="text-zinc-400 text-[11px]">
                    {formatDateDDMMYYYY(latestSession.date)}
                  </span>
                </div>
              ) : (
                <p className="text-xs font-semibold text-zinc-500">
                  Sin historial previo registrado para este ejercicio
                </p>
              )}
            </div>
          </div>

          {/* Right: PR Badge & Copy Previous Session Button */}
          <div className="flex items-center gap-2 flex-wrap">
            {verifiedPR && (
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#171717] border border-[#CCFF00]/40 text-[#CCFF00] text-[11px] font-mono font-bold tabular-nums"
                title={`Récord personal verificado el ${formatDateDDMMYYYY(verifiedPR.date)}`}
              >
                <Trophy className="w-3 h-3 fill-current" />
                <span>
                  PR: {verifiedPR.maxWeight} kg × {verifiedPR.repsAtMaxWeight}
                </span>
              </span>
            )}

            {latestSession && onCopyPreviousSessionToSets && hasUncompletedSets && (
              <button
                type="button"
                onClick={handleCopyPrevious}
                className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer border ${
                  justCopiedPrevious
                    ? 'bg-[#CCFF00]/20 border-[#CCFF00] text-[#CCFF00]'
                    : 'bg-[#171717] hover:bg-[#222222] border-[#303030] hover:border-[#CCFF00]/50 text-[#F5F5F5]'
                }`}
                title="Copiar peso y repeticiones de la última sesión en las series pendientes"
              >
                {justCopiedPrevious ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#CCFF00]" />
                    <span>Copiado a series</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[#CCFF00]" />
                    <span>Copiar sesión anterior</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Recent 3-Session History Strip */}
        {matchedSessions.length > 1 && (
          <div className="mt-2.5 pt-2 border-t border-[#303030]/60 flex flex-wrap items-center gap-1.5 text-[10px] font-mono tabular-nums">
            <span className="text-zinc-500 uppercase font-sans font-bold tracking-wider mr-1">
              Sesiones previas:
            </span>
            {matchedSessions.map((session, idx) => (
              <span
                key={`${session.date}-${idx}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#171717] border border-[#303030] text-zinc-300"
              >
                <span className="text-zinc-500">{formatDateDDMMYYYY(session.date)}:</span>
                <strong className="text-[#F5F5F5]">{session.weight}kg</strong>×{session.reps}
                <span className="text-zinc-500">({session.setsCount}s)</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* FASE 6: PROGRESIÓN INTELIGENTE (Opcional, prudente, solo con historial real y descartable) */}
      {progressionSuggestion && !dismissedSuggestion && hasUncompletedSets && (
        <div className="rounded-xl bg-[#171717] border border-[#CCFF00]/40 p-3 transition-all">
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-[#CCFF00]/15 border border-[#CCFF00]/40 flex items-center justify-center text-[#CCFF00] shrink-0 mt-0.5">
                <Sparkles className="w-3.5 h-3.5" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#CCFF00] bg-[#090909] border border-[#CCFF00]/30 px-2 py-0.5 rounded">
                    Sugerencia de Progresión · {progressionSuggestion.deltaLabel}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-400 bg-[#090909] border border-[#303030] px-2 py-0.5 rounded">
                    {progressionSuggestion.equipmentLabel}
                  </span>
                </div>

                <p className="text-xs font-bold text-[#F5F5F5] font-mono tabular-nums">
                  Objetivo sugerido para Serie #{activeSet?.setNumber ?? activeSetIndex + 1}:{' '}
                  <span className="text-[#CCFF00] font-black">
                    {progressionSuggestion.suggestedWeight} kg × {progressionSuggestion.suggestedReps} reps
                  </span>
                </p>

                <p className="text-[11px] text-zinc-400 leading-relaxed mt-1">
                  {progressionSuggestion.reason}
                </p>

                <p className="text-[10px] text-zinc-500 flex items-center gap-1 mt-1.5">
                  <Info className="w-3 h-3 shrink-0 text-zinc-500" />
                  <span>
                    Sugerencia orientativa basada en tus registros; ajusta la carga según tu control técnico y sensación del día.
                  </span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setDismissedSuggestion(true)}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-[#F5F5F5] hover:bg-[#090909] transition-colors shrink-0 cursor-pointer"
              title="Ignorar sugerencia"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2.5 pt-2 border-t border-[#303030]/70 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDismissedSuggestion(true)}
              className="min-h-[34px] px-3 py-1 rounded-lg bg-[#090909] hover:bg-[#222222] border border-[#303030] text-zinc-400 hover:text-[#F5F5F5] text-[11px] font-bold transition-colors cursor-pointer"
            >
              Ignorar
            </button>
            <button
              type="button"
              onClick={handleApplySuggestion}
              className={`min-h-[34px] px-3.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
                justAppliedSetNumber !== null
                  ? 'bg-[#CCFF00]/20 border border-[#CCFF00] text-[#CCFF00]'
                  : 'bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909]'
              }`}
            >
              {justAppliedSetNumber !== null ? (
                <>
                  <Check className="w-3.5 h-3.5 stroke-[2.8]" />
                  <span>Aplicado en Serie #{justAppliedSetNumber}</span>
                </>
              ) : (
                <>
                  <TrendingUp className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Aplicar a Serie #{activeSet?.setNumber ?? activeSetIndex + 1}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default RecommendedLoadForecastWidget;
