import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ExternalLink,
  Video,
  CheckCircle2,
  Shuffle,
  Plus,
  Trash2,
  Bookmark,
  RefreshCw,
  Dumbbell,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  Search,
  Eye,
  Check,
  AlertCircle,
  Info,
  Volume2,
  VolumeX,
  ShieldAlert,
  Wind,
  Activity,
  Timer,
  Play,
  RotateCcw,
} from 'lucide-react';
import {
  Exercise,
  LibraryExercise,
  ActiveWorkoutSession,
  Routine,
  CompletedWorkout,
  ExerciseTempo,
} from '../types';
import { enrichExerciseWithLibrary } from '../utils/enrichRoutines';
import {
  findRecommendedAlternative,
  CandidateAlternative,
  libraryItemToExercise,
  generateTechniqueCuesForExercise,
  buildTechniqueProProfile,
  buildTechniqueSpeechScript,
  createTempoFromValues,
  parseTempoNotation,
} from '../utils/exerciseAlternatives';
import {
  speakTechniqueInstructionText,
  stopActiveSpeechSynthesis,
} from '../utils/coachVoiceEngine';
import { findPreviousExerciseSessions } from '../utils/progressionEngine';
import { ExerciseThumbnail } from './ExerciseThumbnail';

const TEMPO_STORAGE_PREFIX = 'lazcakon_technique_tempo_v1_';

interface ExerciseDetailModalProps {
  exercise: Exercise | null;
  isOpen: boolean;
  onClose: () => void;
  customLinks?: { id: string; title: string; url: string }[];
  onAddCustomLink?: (exerciseId: string, title: string, url: string) => void;
  onDeleteCustomLink?: (exerciseId: string, linkId: string) => void;
  isAlternativeSelected?: boolean;
  onToggleAlternative?: (exerciseId: string) => void;
  activeSession?: ActiveWorkoutSession | null;
  routines?: Routine[];
  history?: CompletedWorkout[];
  activeProfileId?: string;
  onReplaceActiveExercise?: (
    exerciseId: string,
    replacement: {
      newName: string;
      libraryExerciseId?: string;
      targetMuscles?: string;
      equipment?: string;
      notes?: string;
      restSeconds?: number;
      initialWeight?: number;
    }
  ) => void;
  onUpdateRoutine?: (routine: Routine) => void;
}

const EQUIPMENT_OPTIONS = [
  'Todos',
  'Máquinas',
  'Mancuernas',
  'Poleas',
  'Barras',
  'Peso corporal',
] as const;

export const ExerciseDetailModal: React.FC<ExerciseDetailModalProps> = ({
  exercise: savedExercise,
  isOpen,
  onClose,
  customLinks = [],
  onAddCustomLink,
  onDeleteCustomLink,
  isAlternativeSelected = false,
  onToggleAlternative,
  activeSession,
  routines = [],
  history = [],
  activeProfileId,
  onReplaceActiveExercise,
  onUpdateRoutine,
}) => {
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [mediaRetryTick, setMediaRetryTick] = useState(0);

  // Estados del bloque de Variante Alternativa
  const [showOtherAlternatives, setShowOtherAlternatives] = useState(false);
  const [altEquipFilter, setAltEquipFilter] = useState<string>('Todos');
  const [altSearchQuery, setAltSearchQuery] = useState<string>('');
  const [previewSubstitute, setPreviewSubstitute] = useState<LibraryExercise | null>(null);

  // Diálogo para aplicar sustitución (Solo esta sesión vs Guardar en rutina)
  const [applyingCandidate, setApplyingCandidate] = useState<CandidateAlternative | null>(null);
  const [applyScope, setApplyScope] = useState<'session' | 'routine'>('session');
  const [initialWeightInput, setInitialWeightInput] = useState<string>('');

  // Estados Technique Pro 7.0 (Motor de voz + Tempo ajustable)
  const [isSpeakingTechnique, setIsSpeakingTechnique] = useState(false);
  const [voiceFeedbackNotice, setVoiceFeedbackNotice] = useState<string | null>(null);
  const [customTempoState, setCustomTempoState] = useState<ExerciseTempo | null>(null);

  const rawEnriched = savedExercise ? enrichExerciseWithLibrary(savedExercise) : null;

  // Si estamos previsualizando la técnica del reemplazo, construir objeto Exercise temporal
  const activeDisplayExercise: Exercise | null = useMemo(() => {
    if (!rawEnriched) return null;
    if (previewSubstitute) {
      return libraryItemToExercise(previewSubstitute, rawEnriched);
    }
    if (isAlternativeSelected && rawEnriched.alternative) {
      return enrichExerciseWithLibrary({
        ...rawEnriched,
        id: rawEnriched.id,
        libraryExerciseId: undefined,
        name: rawEnriched.alternative,
        defaultVideoUrl: '',
        thumbnailUrl: undefined,
        secondaryThumbnailUrl: undefined,
      });
    }
    return rawEnriched;
  }, [rawEnriched, previewSubstitute, isAlternativeSelected]);

  // Perfil completo Technique Pro 7.0 actualizado dinámicamente para el ejercicio o su reemplazo activo
  const techniqueProfile = useMemo(() => {
    if (!activeDisplayExercise) return null;
    if (
      activeDisplayExercise.techniquePro &&
      activeDisplayExercise.techniquePro.exerciseName === activeDisplayExercise.name
    ) {
      return activeDisplayExercise.techniquePro;
    }
    return buildTechniqueProProfile({
      id: activeDisplayExercise.id,
      libraryExerciseId: activeDisplayExercise.libraryExerciseId,
      name: activeDisplayExercise.name,
      targetMuscles: activeDisplayExercise.targetMuscles,
      equipment: activeDisplayExercise.equipment,
      defaultVideoUrl: activeDisplayExercise.defaultVideoUrl,
      thumbnailUrl: activeDisplayExercise.thumbnailUrl,
      customTempo: activeDisplayExercise.customTempo,
    });
  }, [activeDisplayExercise]);

  // Si no estamos en preview, respetar la variante activa seleccionada para la multimedia
  const mediaExercise = activeDisplayExercise;

  // Cálculo de alternativa recomendada y lista de otras alternativas usando motor biomecánico
  const alternativesResult = useMemo(() => {
    if (!rawEnriched) return { recommended: null, otherCandidates: [], hasDirectAlternative: false, targetPattern: '' };
    return findRecommendedAlternative(rawEnriched, {
      filterEquipment: altEquipFilter,
      searchQuery: altSearchQuery,
      limit: 25,
    });
  }, [rawEnriched, altEquipFilter, altSearchQuery]);

  // Historial previo del candidato que se va a aplicar para sugerir carga real
  const candidatePreviousPerformance = useMemo(() => {
    if (!applyingCandidate) return null;
    const matches = findPreviousExerciseSessions({
      history: history || [],
      exercise: {
        libraryExerciseId: applyingCandidate.exercise.id,
        activeExerciseName: applyingCandidate.exercise.name,
        equipment: applyingCandidate.exercise.equipment,
      },
      activeProfileId,
      limit: 1,
    });
    return matches[0] || null;
  }, [applyingCandidate, history, activeProfileId]);

  // Cuando se selecciona un candidato para aplicar, preconfigurar scope y carga previa
  useEffect(() => {
    if (applyingCandidate) {
      // Si no hay sesión activa, el único ámbito posible es guardar en la rutina
      if (!activeSession) {
        setApplyScope('routine');
      } else {
        setApplyScope('session');
      }

      if (candidatePreviousPerformance && candidatePreviousPerformance.maxWeight > 0) {
        setInitialWeightInput(String(candidatePreviousPerformance.maxWeight));
      } else {
        setInitialWeightInput('');
      }
    }
  }, [applyingCandidate, activeSession, candidatePreviousPerformance]);

  // Reset de estados al abrir/cerrar modal o cambiar de ejercicio
  useEffect(() => {
    setMediaError(false);
    setPreviewSubstitute(null);
    setShowOtherAlternatives(false);
    setAltSearchQuery('');
    setAltEquipFilter('Todos');
    setApplyingCandidate(null);
    setVoiceFeedbackNotice(null);
    stopActiveSpeechSynthesis();
    setIsSpeakingTechnique(false);
  }, [savedExercise?.id, isOpen]);

  // Cargar tempo personalizado guardado por ejercicio o usar el orientativo de Technique Pro
  useEffect(() => {
    if (!techniqueProfile) {
      setCustomTempoState(null);
      return;
    }
    const storageKey = `${TEMPO_STORAGE_PREFIX}${
      techniqueProfile.libraryExerciseId || techniqueProfile.exerciseId || techniqueProfile.exerciseName
    }`;
    try {
      const savedNotation = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
      if (savedNotation) {
        setCustomTempoState(parseTempoNotation(savedNotation, techniqueProfile.defaultTempo));
        return;
      }
    } catch {
      // Ignore storage access errors in private WebViews
    }
    setCustomTempoState(techniqueProfile.defaultTempo);
  }, [techniqueProfile]);

  // Detener síntesis de voz al desmontar
  useEffect(() => {
    return () => {
      stopActiveSpeechSynthesis();
    };
  }, []);

  useEffect(() => {
    setMediaError(false);
  }, [mediaExercise?.defaultVideoUrl]);

  if (!isOpen || !rawEnriched || !activeDisplayExercise || !mediaExercise || !techniqueProfile) return null;

  const activeTempo = customTempoState || techniqueProfile.defaultTempo;

  const handleAdjustTempoPhase = (
    phase: 'eccentricSec' | 'bottomPauseSec' | 'concentricSec' | 'topPauseSec',
    delta: number
  ) => {
    const next = createTempoFromValues(
      phase === 'eccentricSec' ? activeTempo.eccentricSec + delta : activeTempo.eccentricSec,
      phase === 'bottomPauseSec' ? activeTempo.bottomPauseSec + delta : activeTempo.bottomPauseSec,
      phase === 'concentricSec' ? activeTempo.concentricSec + delta : activeTempo.concentricSec,
      phase === 'topPauseSec' ? activeTempo.topPauseSec + delta : activeTempo.topPauseSec
    );
    setCustomTempoState(next);
    const storageKey = `${TEMPO_STORAGE_PREFIX}${
      techniqueProfile.libraryExerciseId || techniqueProfile.exerciseId || techniqueProfile.exerciseName
    }`;
    try {
      window.localStorage.setItem(storageKey, next.notation);
    } catch {}
  };

  const handleResetTempo = () => {
    setCustomTempoState(techniqueProfile.defaultTempo);
    const storageKey = `${TEMPO_STORAGE_PREFIX}${
      techniqueProfile.libraryExerciseId || techniqueProfile.exerciseId || techniqueProfile.exerciseName
    }`;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {}
  };

  const handleToggleVoiceInstruction = () => {
    setVoiceFeedbackNotice(null);
    if (isSpeakingTechnique) {
      stopActiveSpeechSynthesis();
      setIsSpeakingTechnique(false);
      return;
    }
    const script = buildTechniqueSpeechScript(techniqueProfile, activeTempo);
    const started = speakTechniqueInstructionText(script, {
      onStart: () => setIsSpeakingTechnique(true),
      onEnd: () => setIsSpeakingTechnique(false),
      onError: (msg) => {
        setIsSpeakingTechnique(false);
        setVoiceFeedbackNotice(msg);
      },
    });
    if (started) {
      setIsSpeakingTechnique(true);
    }
  };

  const handleAddLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTitle.trim() && newUrl.trim() && onAddCustomLink) {
      onAddCustomLink(rawEnriched.id, newTitle.trim(), newUrl.trim());
      setNewTitle('');
      setNewUrl('');
      setShowAddForm(false);
    }
  };

  const handleConfirmApplication = () => {
    if (!applyingCandidate) return;

    const enteredWeight = initialWeightInput.trim() !== '' && !Number.isNaN(Number(initialWeightInput))
      ? Math.max(0, Number(initialWeightInput))
      : undefined;

    const candidateEx = applyingCandidate.exercise;

    // Caso 1: Aplicar solo a esta sesión activa
    if (applyScope === 'session') {
      if (onReplaceActiveExercise) {
        onReplaceActiveExercise(rawEnriched.id, {
          newName: candidateEx.name,
          libraryExerciseId: candidateEx.id,
          targetMuscles: candidateEx.muscleGroup,
          equipment: candidateEx.equipment,
          initialWeight: enteredWeight,
          notes: `Sustituyó a ${rawEnriched.name} (Variante alternativa)`,
        });
      }
      if (onToggleAlternative) {
        onToggleAlternative(rawEnriched.id);
      }
    }

    // Caso 2: Guardar permanentemente en la rutina
    if (applyScope === 'routine') {
      if (onUpdateRoutine && routines.length > 0) {
        const targetRoutine = routines.find(
          (r) =>
            r.id === activeSession?.routineId ||
            r.exercises.some((e) => e.id === rawEnriched.id || e.name === rawEnriched.name)
        );

        if (targetRoutine) {
          const updatedRoutine: Routine = {
            ...targetRoutine,
            exercises: targetRoutine.exercises.map((ex) =>
              ex.id === rawEnriched.id || ex.name === rawEnriched.name
                ? {
                    ...ex,
                    name: candidateEx.name,
                    libraryExerciseId: candidateEx.id,
                    targetMuscles: candidateEx.muscleGroup || ex.targetMuscles,
                    equipment: candidateEx.equipment || ex.equipment,
                    defaultWeight:
                      enteredWeight !== undefined && enteredWeight > 0
                        ? enteredWeight
                        : ex.defaultWeight,
                    alternative: ex.name, // El original se conserva como alternativa secundaria
                    defaultVideoUrl: candidateEx.videoUrl || ex.defaultVideoUrl,
                    thumbnailUrl: candidateEx.thumbnailUrl || ex.thumbnailUrl,
                  }
                : ex
            ),
          };
          onUpdateRoutine(updatedRoutine);
        }
      }

      // Si además hay una sesión activa, aplicar de inmediato el cambio a la sesión en curso
      if (activeSession && onReplaceActiveExercise) {
        onReplaceActiveExercise(rawEnriched.id, {
          newName: candidateEx.name,
          libraryExerciseId: candidateEx.id,
          targetMuscles: candidateEx.muscleGroup,
          equipment: candidateEx.equipment,
          initialWeight: enteredWeight,
          notes: `Sustituido en rutina desde ${rawEnriched.name}`,
        });
      }
    }

    setApplyingCandidate(null);
    setPreviewSubstitute(null);
    onClose();
  };

  const displayName = previewSubstitute
    ? previewSubstitute.name
    : isAlternativeSelected && rawEnriched.alternative
    ? rawEnriched.alternative
    : rawEnriched.name;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-['Plus_Jakarta_Sans',sans-serif]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#090909] border border-[#303030] rounded-3xl p-4 sm:p-6 shadow-2xl text-[#F5F5F5] max-h-[92vh] overflow-y-auto space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Banner de previsualización de técnica cuando se inspecciona un reemplazo */}
        {previewSubstitute && (
          <div className="p-3 rounded-2xl bg-accent/10 border border-accent/40 flex items-center justify-between gap-2 animate-in fade-in">
            <div className="flex items-center gap-2 min-w-0">
              <Eye className="w-4 h-4 text-accent-text shrink-0" />
              <div className="min-w-0">
                <span className="block text-[10px] font-black uppercase tracking-wider text-accent-text">
                  Previsualizando Reemplazo
                </span>
                <span className="text-xs font-bold text-[#F5F5F5] truncate block">
                  {previewSubstitute.name}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPreviewSubstitute(null)}
              className="px-2.5 py-1.5 rounded-xl bg-[#090909] text-accent-text border border-accent/40 text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0 hover:bg-accent/10"
              title="Volver al ejercicio original"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Volver</span>
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#303030]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-black uppercase tracking-wider text-accent-text">
                {activeDisplayExercise.targetMuscles}
              </span>
              {activeDisplayExercise.equipment && (
                <>
                  <span className="text-zinc-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-zinc-400 font-mono text-[11px]">
                    {activeDisplayExercise.equipment}
                  </span>
                </>
              )}
              {activeDisplayExercise.objective && (
                <>
                  <span className="text-zinc-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-zinc-300">{activeDisplayExercise.objective}</span>
                </>
              )}
            </div>
            <h3 className="text-lg sm:text-xl font-black text-[#F5F5F5] mt-1 leading-snug">
              {displayName}
            </h3>
            {previewSubstitute && (
              <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                Propuesto para sustituir a: {rawEnriched.name}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-zinc-400 hover:text-[#F5F5F5] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
            aria-label="Cerrar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ==========================================================================
            BLOQUE MEJORADO: VARIANTE ALTERNATIVA PROGRAMADA / RECOMENDADA
           ========================================================================== */}
        {!previewSubstitute && (
          <div className="rounded-2xl bg-[#171717] border border-[#303030] p-3.5 sm:p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Shuffle className="w-3.5 h-3.5 text-accent-text shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-wider text-accent-text">
                  {alternativesResult.recommended?.isProgrammedMatch
                    ? 'Variante Alternativa Programada'
                    : 'Variante Alternativa Recomendada'}
                </span>
              </div>
              {isAlternativeSelected && (
                <span className="px-2 py-0.5 rounded-full bg-accent text-accent-contrast font-black text-[9px] uppercase tracking-wider shrink-0">
                  Activa en sesión
                </span>
              )}
            </div>

            {alternativesResult.recommended ? (
              <div className="space-y-3">
                {/* Tarjeta de alternativa principal */}
                <div className="p-3 rounded-2xl bg-[#090909] border border-[#303030] flex items-start gap-3">
                  {/* Miniatura interactiva: al pulsar permite consultar técnica y animación */}
                  <div
                    className="relative group cursor-pointer shrink-0"
                    onClick={() => setPreviewSubstitute(alternativesResult.recommended!.exercise)}
                    title="Toca para previsualizar la técnica y animación del reemplazo"
                  >
                    <ExerciseThumbnail
                      src={alternativesResult.recommended.exercise.thumbnailUrl}
                      alt={alternativesResult.recommended.exercise.name}
                      muscleGroup={alternativesResult.recommended.exercise.muscleGroup}
                      exercise={alternativesResult.recommended.exercise}
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl border border-[#303030] object-cover group-hover:border-accent transition-colors"
                      showSpinner
                      allowRetry
                    />
                    <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Eye className="w-4 h-4 text-accent-text" />
                    </div>
                  </div>

                  {/* Metadatos completos y motivo biomecánico */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-mono font-bold text-zinc-300 bg-[#171717] border border-[#303030] px-2 py-0.5 rounded-md flex items-center gap-1">
                        <Dumbbell className="w-3 h-3 text-accent-text" />
                        <span>{alternativesResult.recommended.exercise.equipment || 'Máquina'}</span>
                      </span>
                      <span className="text-[10px] font-mono text-accent-text">
                        {alternativesResult.recommended.pattern}
                      </span>
                    </div>

                    <h4
                      className="text-sm font-black text-[#F5F5F5] leading-snug hover:text-accent-text cursor-pointer"
                      onClick={() => setPreviewSubstitute(alternativesResult.recommended!.exercise)}
                      title="Ver técnica"
                    >
                      {alternativesResult.recommended.exercise.name}
                    </h4>

                    <p className="text-xs text-zinc-300 leading-snug">
                      {alternativesResult.recommended.rationale}
                    </p>
                  </div>
                </div>

                {/* Acciones del bloque: Usar este ejercicio y Ver otras alternativas */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setApplyingCandidate(alternativesResult.recommended)}
                      className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs uppercase tracking-wider flex items-center gap-1.5 transition-transform active:scale-95 cursor-pointer shadow-md"
                    >
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      <span>Usar este ejercicio</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPreviewSubstitute(alternativesResult.recommended!.exercise)}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#090909] hover:bg-[#202020] border border-[#303030] text-zinc-300 hover:text-accent-text text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                      title="Ver técnica y animación sin perder la sesión"
                    >
                      <Eye className="w-3.5 h-3.5 text-accent-text" />
                      <span>Ver técnica</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowOtherAlternatives(!showOtherAlternatives)}
                    className="text-xs font-bold text-zinc-400 hover:text-accent-text flex items-center gap-1 cursor-pointer transition-colors py-1"
                  >
                    <span>{showOtherAlternatives ? 'Ocultar alternativas' : 'Ver otras alternativas'}</span>
                    <span className="font-mono tabular-nums text-zinc-500">
                      ({alternativesResult.otherCandidates.length})
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] space-y-2.5 text-center">
                <p className="text-xs text-zinc-400 flex items-center justify-center gap-1.5">
                  <Info className="w-4 h-4 text-zinc-400 shrink-0" />
                  <span>No hay una variante directa programada para este ejercicio.</span>
                </p>
                <button
                  type="button"
                  onClick={() => setShowOtherAlternatives(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#171717] hover:bg-[#222222] border border-accent/50 text-accent-text text-xs font-bold cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Buscar manualmente en el catálogo</span>
                </button>
              </div>
            )}

            {/* Desplegable interactivo: Ver otras alternativas y buscador de catálogo */}
            {showOtherAlternatives && (
              <div className="pt-3 border-t border-[#303030] space-y-2.5 animate-in fade-in">
                {/* Barra de búsqueda y filtro por equipo */}
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar por nombre o equipamiento..."
                      value={altSearchQuery}
                      onChange={(e) => setAltSearchQuery(e.target.value)}
                      className="w-full min-h-[38px] pl-9 pr-3 text-xs bg-[#090909] border border-[#303030] rounded-xl text-[#F5F5F5] placeholder:text-zinc-500 focus:outline-none focus:border-accent"
                    />
                  </div>

                  <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
                    {EQUIPMENT_OPTIONS.map((eq) => (
                      <button
                        key={eq}
                        type="button"
                        onClick={() => setAltEquipFilter(eq)}
                        className={`min-h-[28px] px-2.5 py-0.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                          altEquipFilter === eq
                            ? 'bg-accent text-accent-contrast font-black'
                            : 'bg-[#090909] text-zinc-400 border border-[#303030] hover:text-[#F5F5F5]'
                        }`}
                      >
                        {eq}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Lista de alternativas compatibles */}
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {alternativesResult.otherCandidates.length > 0 ? (
                    alternativesResult.otherCandidates.map((cand) => (
                      <div
                        key={cand.exercise.id}
                        className="p-2.5 rounded-xl bg-[#090909] border border-[#303030] hover:border-accent/40 transition-colors flex items-center justify-between gap-2.5"
                      >
                        <div
                          className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1"
                          onClick={() => setPreviewSubstitute(cand.exercise)}
                          title="Toca para previsualizar técnica"
                        >
                          <ExerciseThumbnail
                            src={cand.exercise.thumbnailUrl}
                            alt={cand.exercise.name}
                            muscleGroup={cand.exercise.muscleGroup}
                            exercise={cand.exercise}
                            className="w-11 h-11 rounded-lg border border-[#303030] shrink-0"
                            showSpinner
                            allowRetry
                          />
                          <div className="min-w-0">
                            <span className="block text-xs font-bold text-[#F5F5F5] truncate hover:text-accent-text">
                              {cand.exercise.name}
                            </span>
                            <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono">
                              <span>{cand.exercise.equipment || 'Máquina'}</span>
                              <span>·</span>
                              <span className="text-accent-text truncate">{cand.pattern}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setPreviewSubstitute(cand.exercise)}
                            className="p-2 rounded-lg bg-[#171717] hover:bg-[#222222] border border-[#303030] text-zinc-300 hover:text-accent-text cursor-pointer"
                            title="Ver animación"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setApplyingCandidate(cand)}
                            className="px-2.5 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-contrast font-black text-[11px] uppercase cursor-pointer"
                          >
                            Elegir
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-zinc-500 text-center py-4">
                      No se encontraron alternativas con ese filtro. Prueba buscando en el catálogo completo.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==========================================================================
            MODAL DE CONFIRMACIÓN: ELEGIR ÁMBITO Y GESTIÓN DE CARGA
           ========================================================================== */}
        {applyingCandidate && (
          <div className="p-4 rounded-2xl bg-[#141414] border-2 border-accent space-y-3.5 animate-in zoom-in-95">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-accent-text block">
                  Aplicar sustitución de ejercicio
                </span>
                <h4 className="text-sm font-black text-[#F5F5F5] leading-snug">
                  {applyingCandidate.exercise.name}
                </h4>
                <p className="text-xs text-zinc-400">
                  Sustituye a: <strong className="text-zinc-200">{rawEnriched.name}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setApplyingCandidate(null)}
                className="text-zinc-400 hover:text-[#F5F5F5] p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selección de Ámbito (Solo esta sesión vs Guardar en la rutina) */}
            <div className="space-y-2">
              <span className="block text-[11px] font-bold text-zinc-300">
                ¿Dónde deseas aplicar el cambio?
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!activeSession}
                  onClick={() => setApplyScope('session')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    applyScope === 'session'
                      ? 'bg-accent/15 border-accent text-[#F5F5F5]'
                      : 'bg-[#090909] border-[#303030] text-zinc-400 hover:border-zinc-500'
                  } ${!activeSession ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black">Solo esta sesión</span>
                    {applyScope === 'session' && <Check className="w-3.5 h-3.5 text-accent-text" />}
                  </div>
                  <span className="block text-[10px] text-zinc-400 mt-0.5">
                    {activeSession
                      ? 'Aplica al entrenamiento de hoy sin modificar la rutina.'
                      : 'No hay entrenamiento activo en curso.'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setApplyScope('routine')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    applyScope === 'routine'
                      ? 'bg-accent/15 border-accent text-[#F5F5F5]'
                      : 'bg-[#090909] border-[#303030] text-zinc-400 hover:border-zinc-500'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black">Guardar en la rutina</span>
                    {applyScope === 'routine' && <Check className="w-3.5 h-3.5 text-accent-text" />}
                  </div>
                  <span className="block text-[10px] text-zinc-400 mt-0.5">
                    Modifica permanentemente la rutina y el entrenamiento activo.
                  </span>
                </button>
              </div>
            </div>

            {/* Detección y gestión de carga (no transferir kilos entre ejercicios diferentes) */}
            <div className="p-3 rounded-xl bg-[#090909] border border-[#303030] space-y-2">
              {candidatePreviousPerformance && candidatePreviousPerformance.maxWeight > 0 ? (
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-accent-text font-bold">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Carga histórica propia recuperada</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Último registro detectado: <strong className="text-zinc-200">{candidatePreviousPerformance.maxWeight} kg × {candidatePreviousPerformance.maxReps} reps</strong> ({candidatePreviousPerformance.date}).
                  </p>
                </div>
              ) : (
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Sin historial previo para este ejercicio</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Por seguridad biomecánica no copiamos los kilos de {rawEnriched.name}. Registra tu carga inicial estimada:
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <label htmlFor="initial-weight-input" className="text-xs font-bold text-zinc-300 shrink-0">
                  Carga inicial (kg):
                </label>
                <input
                  id="initial-weight-input"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="Ej: 40"
                  value={initialWeightInput}
                  onChange={(e) => setInitialWeightInput(e.target.value)}
                  className="w-24 min-h-[36px] bg-[#171717] border border-[#303030] rounded-lg px-2.5 text-xs text-[#F5F5F5] font-mono font-bold focus:outline-none focus:border-accent"
                />
                <span className="text-xs text-zinc-500 font-mono">kg</span>
              </div>
            </div>

            {/* Botones de confirmación */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setApplyingCandidate(null)}
                className="px-3.5 py-2 rounded-xl bg-[#090909] border border-[#303030] text-zinc-300 text-xs font-bold cursor-pointer hover:bg-[#1a1a1a]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmApplication}
                className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                <span>Confirmar cambio</span>
              </button>
            </div>
          </div>
        )}

        {/* Prescription Summary */}
        <div className="grid grid-cols-3 gap-2.5 text-center">
          <div className="p-3 rounded-2xl bg-[#171717] border border-[#303030]">
            <span className="text-[10px] uppercase font-bold text-zinc-400 block">Series</span>
            <span className="text-base font-black font-mono tabular-nums text-[#F5F5F5]">
              {activeDisplayExercise.defaultSets}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-[#171717] border border-[#303030]">
            <span className="text-[10px] uppercase font-bold text-zinc-400 block">
              Repeticiones
            </span>
            <span className="text-base font-black font-mono tabular-nums text-accent-text">
              {activeDisplayExercise.repRange}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-[#171717] border border-[#303030]">
            <span className="text-[10px] uppercase font-bold text-zinc-400 block">Descanso</span>
            <span className="text-base font-black font-mono tabular-nums text-[#F5F5F5]">
              {activeDisplayExercise.restText || `${activeDisplayExercise.restSeconds || 90} seg`}
            </span>
          </div>
        </div>

        {/* ==========================================================================
            LAZCAKONG GYM 7.0 — TECHNIQUE PRO: VOZ + ANIMACIÓN EXACTA + BIOMECÁNICA
           ========================================================================== */}
        <div className="rounded-2xl bg-[#171717] border border-[#303030] p-3.5 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-accent-text block">
                TECHNIQUE PRO 7.0 · {techniqueProfile.movementPattern}
              </span>
              <h4 className="text-xs sm:text-sm font-black text-[#F5F5F5]">
                Guía Biomecánica y Ejecución Exacta
              </h4>
            </div>

            <button
              type="button"
              data-testid="technique-voice-btn"
              onClick={handleToggleVoiceInstruction}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                isSpeakingTechnique
                  ? 'bg-accent text-accent-contrast shadow-[0_0_16px_var(--accent-glow)]'
                  : 'bg-[#090909] hover:bg-[#222222] text-accent-text border border-accent/60'
              }`}
              title="Escuchar las instrucciones completas mediante el motor de voz"
            >
              {isSpeakingTechnique ? (
                <>
                  <VolumeX className="w-4 h-4 stroke-[2.5]" />
                  <span>Detener voz</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4 stroke-[2.5]" />
                  <span>Escuchar técnica</span>
                </>
              )}
            </button>
          </div>

          {voiceFeedbackNotice && (
            <div className="p-2.5 rounded-xl bg-[#090909] border border-amber-500/40 text-[11px] text-amber-300 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>{voiceFeedbackNotice}</span>
            </div>
          )}

          {/* Consejo clave pre-serie */}
          <div className="p-3 rounded-xl bg-[#090909] border border-accent/40 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
            <div className="text-xs leading-snug">
              <span className="font-black uppercase tracking-wider text-accent-text block text-[10px] mb-0.5">
                Foco antes de tu primera serie
              </span>
              <span className="text-[#F5F5F5] font-semibold">{techniqueProfile.preSetTip}</span>
            </div>
          </div>

          {/* Ilustración o animación correspondiente al ejercicio exacto */}
          {mediaExercise.defaultVideoUrl &&
          /\.(webp|gif)(?:\?|$)/i.test(mediaExercise.defaultVideoUrl) &&
          !/\-poster\.webp(?:\?|$)/i.test(mediaExercise.defaultVideoUrl) ? (
            <div className="rounded-2xl overflow-hidden bg-[#090909] border border-[#303030]">
              {mediaError ? (
                <div className="p-5 text-center space-y-2.5">
                  <div className="flex justify-center">
                    <ExerciseThumbnail
                      src={mediaExercise.thumbnailUrl}
                      alt={displayName}
                      muscleGroup={activeDisplayExercise.targetMuscles}
                      exercise={mediaExercise}
                      className="w-24 h-24 rounded-2xl border border-[#303030] object-cover"
                    />
                  </div>
                  <p className="text-xs text-zinc-400">
                    Mostrando ilustración estática del ejercicio. Puedes reintentar la animación en bucle:
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setMediaError(false);
                      setMediaRetryTick((t) => t + 1);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#171717] hover:bg-[#242424] border border-accent/50 text-accent-text text-xs font-bold cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reintentar animación</span>
                  </button>
                </div>
              ) : (
                <img
                  key={`${mediaExercise.defaultVideoUrl}::${mediaRetryTick}`}
                  src={mediaExercise.defaultVideoUrl}
                  alt={`Movimiento: ${displayName}`}
                  referrerPolicy="no-referrer"
                  onError={() => setMediaError(true)}
                  className="w-full max-h-[42vh] object-contain bg-black"
                />
              )}
              <p className="text-center text-[11px] font-mono text-accent-text py-1.5 border-t border-[#303030]">
                LazcaKong Gym · Animación Biomecánica Exacta · {displayName}
              </p>
            </div>
          ) : mediaExercise.defaultVideoUrl && /\.mp4(?:\?|$)/i.test(mediaExercise.defaultVideoUrl) ? (
            <div className="rounded-2xl overflow-hidden bg-[#090909] border border-[#303030]">
              <video
                src={mediaExercise.defaultVideoUrl}
                poster={mediaExercise.thumbnailUrl}
                autoPlay
                loop
                muted
                playsInline
                controls
                className="w-full max-h-[42vh] object-contain"
              />
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] flex items-center gap-3">
              {mediaExercise.thumbnailUrl ? (
                <ExerciseThumbnail
                  src={mediaExercise.thumbnailUrl}
                  alt={displayName}
                  muscleGroup={activeDisplayExercise.targetMuscles}
                  exercise={mediaExercise}
                  className="w-20 h-20 rounded-xl border border-[#303030] shrink-0 object-contain bg-[#090909]"
                />
              ) : (
                <div className="w-16 h-16 rounded-xl border border-[#303030] bg-[#171717] shrink-0 flex items-center justify-center text-accent-text/80">
                  <Activity className="w-6 h-6" />
                </div>
              )}
              <div className="min-w-0">
                <span className="text-[10px] font-mono uppercase text-accent-text font-bold block">
                  {mediaExercise.thumbnailUrl
                    ? `Imagen de Referencia · Animación en preparación · ${techniqueProfile.equipment}`
                    : `Recurso Visual Pendiente · ${techniqueProfile.equipment}`}
                </span>
                <p className="text-xs font-bold text-[#F5F5F5] truncate">{displayName}</p>
                <p className="text-[11px] text-zinc-400">
                  Patrón: {techniqueProfile.movementPattern}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Músculos Principales y Secundarios */}
        <div
          data-testid="technique-muscles-section"
          className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
        >
          <div className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] space-y-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-accent-text flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-accent-text" />
              <span>Músculos Principales</span>
            </span>
            <ul className="space-y-1">
              {techniqueProfile.muscles.primary.map((m, idx) => (
                <li key={idx} className="text-xs font-bold text-[#F5F5F5] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] space-y-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Dumbbell className="w-3.5 h-3.5 text-accent-text" />
              <span>Músculos Secundarios / Sinergistas</span>
            </span>
            <ul className="space-y-1">
              {techniqueProfile.muscles.secondary.map((m, idx) => (
                <li key={idx} className="text-xs text-zinc-300 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0" />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Posición Inicial y Ejecución Paso a Paso */}
        <div className="space-y-3">
          {/* Posición Inicial */}
          <div
            data-testid="technique-starting-position"
            className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] space-y-2"
          >
            <h4 className="text-xs font-black uppercase tracking-wider text-accent-text flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-accent-text" />
              <span>1. Posición Inicial</span>
            </h4>
            <ul className="space-y-1.5">
              {techniqueProfile.startingPosition.map((step, idx) => (
                <li key={idx} className="text-xs text-[#F5F5F5] leading-relaxed flex items-start gap-2">
                  <span className="font-mono font-black text-accent-text text-[11px] shrink-0 mt-0.5">
                    •
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Ejecución Paso a Paso */}
          <div
            data-testid="technique-step-by-step"
            className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] space-y-2"
          >
            <h4 className="text-xs font-black uppercase tracking-wider text-accent-text flex items-center gap-1.5">
              <Play className="w-4 h-4 text-accent-text" />
              <span>2. Ejecución Paso a Paso</span>
            </h4>
            <div className="space-y-2">
              {techniqueProfile.stepByStepExecution.map((step, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-xl bg-[#090909] border border-[#303030] text-xs text-[#F5F5F5] leading-relaxed flex items-start gap-2.5"
                >
                  <span className="w-5 h-5 rounded-lg bg-[#171717] border border-accent/60 text-accent-text flex items-center justify-center font-mono font-black text-[10px] shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 3 a 5 Consejos Técnicos Específicos */}
        <div
          data-testid="technique-specific-tips"
          className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] space-y-2"
        >
          <h4 className="text-xs font-black uppercase tracking-wider text-[#F5F5F5] flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-accent-text" />
            <span>3. Claves Biomecánicas Específicas ({techniqueProfile.specificTips.length})</span>
          </h4>
          <div className="space-y-2">
            {techniqueProfile.specificTips.map((cue, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded-xl bg-[#090909] border border-[#303030] text-xs text-zinc-200 leading-relaxed flex items-start gap-2.5"
              >
                <span className="w-5 h-5 rounded-lg bg-accent text-accent-contrast flex items-center justify-center font-mono font-black text-[10px] shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span>{cue}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tempo Orientativo y Ajustable */}
        <div
          data-testid="technique-tempo-section"
          className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-[#F5F5F5] flex items-center gap-1.5">
              <Timer className="w-4 h-4 text-accent-text" />
              <span>4. Tempo Orientativo y Ajustable</span>
            </h4>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-lg bg-[#090909] border border-accent text-accent-text font-mono font-black text-xs tabular-nums">
                {activeTempo.notation}
              </span>
              {activeTempo.notation !== techniqueProfile.defaultTempo.notation && (
                <button
                  type="button"
                  onClick={handleResetTempo}
                  className="p-1.5 rounded-lg bg-[#090909] border border-[#303030] text-zinc-400 hover:text-accent-text cursor-pointer"
                  title="Restaurar tempo orientativo original"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(
              [
                { key: 'eccentricSec', label: 'Excéntrica (Bajada)', val: activeTempo.eccentricSec },
                { key: 'bottomPauseSec', label: 'Pausa Inferior', val: activeTempo.bottomPauseSec },
                { key: 'concentricSec', label: 'Concéntrica (Subida)', val: activeTempo.concentricSec },
                { key: 'topPauseSec', label: 'Isometría Final', val: activeTempo.topPauseSec },
              ] as const
            ).map((phase) => (
              <div
                key={phase.key}
                className="p-2.5 rounded-xl bg-[#090909] border border-[#303030] flex flex-col justify-between gap-2 text-center"
              >
                <span className="text-[10px] font-bold text-zinc-400 leading-tight block">
                  {phase.label}
                </span>
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => handleAdjustTempoPhase(phase.key, -1)}
                    className="w-7 h-7 rounded-lg bg-[#171717] hover:bg-[#242424] border border-[#303030] text-zinc-300 font-mono font-black text-xs cursor-pointer"
                    aria-label={`Reducir ${phase.label}`}
                  >
                    -
                  </button>
                  <span className="font-mono font-black text-sm text-accent-text tabular-nums">
                    {phase.val}s
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAdjustTempoPhase(phase.key, 1)}
                    className="w-7 h-7 rounded-lg bg-[#171717] hover:bg-[#242424] border border-[#303030] text-accent-text font-mono font-black text-xs cursor-pointer"
                    aria-label={`Aumentar ${phase.label}`}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] font-mono text-zinc-400 text-center">
            Cadencia activa: <strong className="text-[#F5F5F5]">{activeTempo.summary}</strong>
          </p>
        </div>

        {/* Respiración Biomecánica */}
        <div
          data-testid="technique-breathing-section"
          className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] space-y-2"
        >
          <h4 className="text-xs font-black uppercase tracking-wider text-[#F5F5F5] flex items-center gap-1.5">
            <Wind className="w-4 h-4 text-accent-text" />
            <span>5. Patrón de Respiración y Bracing</span>
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-[#090909] border border-[#303030]">
              <span className="text-[10px] font-black uppercase text-accent-text block mb-0.5">
                Fase Excéntrica (Inhalar)
              </span>
              <p className="text-zinc-300 leading-snug">{techniqueProfile.breathing.eccentricPhase}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-[#090909] border border-[#303030]">
              <span className="text-[10px] font-black uppercase text-accent-text block mb-0.5">
                Fase Concéntrica (Exhalar)
              </span>
              <p className="text-zinc-300 leading-snug">{techniqueProfile.breathing.concentricPhase}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-[#090909] border border-[#303030]">
              <span className="text-[10px] font-black uppercase text-accent-text block mb-0.5">
                Estabilidad / Core
              </span>
              <p className="text-zinc-300 leading-snug">{techniqueProfile.breathing.bracingCue}</p>
            </div>
          </div>
        </div>

        {/* Errores Frecuentes y Recomendaciones de Seguridad */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Errores Frecuentes */}
          <div
            data-testid="technique-mistakes-section"
            className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] space-y-2"
          >
            <h4 className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>6. Errores Frecuentes a Evitar</span>
            </h4>
            <ul className="space-y-1.5">
              {techniqueProfile.commonMistakes.map((err, idx) => (
                <li key={idx} className="text-xs text-zinc-300 leading-snug flex items-start gap-2">
                  <span className="text-amber-400 font-black font-mono text-xs shrink-0">×</span>
                  <span>{err}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Recomendaciones de Seguridad */}
          <div
            data-testid="technique-safety-section"
            className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] space-y-2"
          >
            <h4 className="text-xs font-black uppercase tracking-wider text-accent-text flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-accent-text shrink-0" />
              <span>7. Recomendaciones de Seguridad</span>
            </h4>
            <ul className="space-y-1.5">
              {techniqueProfile.safetyRecommendations.map((rec, idx) => (
                <li key={idx} className="text-xs text-zinc-200 leading-snug flex items-start gap-2">
                  <span className="text-accent-text font-black font-mono text-xs shrink-0">✓</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* En caso de estar en vista previa, botón para usar el ejercicio previsualizado directamente */}
        {previewSubstitute && (
          <div className="pt-2 flex items-center justify-between gap-2 border-t border-[#303030]">
            <button
              type="button"
              onClick={() => setPreviewSubstitute(null)}
              className="min-h-[42px] px-4 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-xs font-bold text-zinc-300 flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Volver a {rawEnriched.name}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const cand = alternativesResult.recommended?.exercise.id === previewSubstitute.id
                  ? alternativesResult.recommended
                  : alternativesResult.otherCandidates.find((c) => c.exercise.id === previewSubstitute.id) || {
                      exercise: previewSubstitute,
                      pattern: activeDisplayExercise.targetMuscles || 'Compatible',
                      rationale: 'Alternativa seleccionada manualmente desde vista previa.',
                      isSamePattern: true,
                      isProgrammedMatch: false,
                    };
                setApplyingCandidate(cand);
              }}
              className="min-h-[42px] px-4 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-md"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>Usar este ejercicio</span>
            </button>
          </div>
        )}

        {/* User Custom Links / Notes */}
        {!previewSubstitute && (
          <div className="pt-3.5 border-t border-[#303030]">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <Bookmark className="w-4 h-4 text-accent-text" />
                <span>Tus Enlaces Personalizados ({customLinks.length})</span>
              </h4>
              {onAddCustomLink && (
                <button
                  type="button"
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="text-xs font-bold text-accent-text hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showAddForm ? 'Cancelar' : 'Agregar enlace'}</span>
                </button>
              )}
            </div>

            {showAddForm && onAddCustomLink && (
              <form
                onSubmit={handleAddLink}
                className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] mb-3 space-y-2.5"
              >
                <input
                  type="text"
                  placeholder="Título del enlace (ej: Video de técnica)"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full min-h-[40px] text-xs bg-[#090909] border border-[#303030] rounded-xl px-3 py-2 text-[#F5F5F5] focus:outline-none focus:border-accent"
                  required
                />
                <input
                  type="url"
                  placeholder="https://..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="w-full min-h-[40px] text-xs bg-[#090909] border border-[#303030] rounded-xl px-3 py-2 text-[#F5F5F5] focus:outline-none focus:border-accent"
                  required
                />
                <button
                  type="submit"
                  className="w-full min-h-[40px] py-2 bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs uppercase rounded-xl cursor-pointer"
                >
                  Guardar Enlace
                </button>
              </form>
            )}

            {customLinks.length === 0 ? (
              <p className="text-xs text-zinc-500">
                Puedes agregar enlaces a tus propios videos de técnica o apuntes personales.
              </p>
            ) : (
              <div className="space-y-1.5">
                {customLinks.map((link) => (
                  <div
                    key={link.id}
                    className="p-3 rounded-xl bg-[#171717] border border-[#303030] flex items-center justify-between text-xs"
                  >
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-accent-text hover:underline flex items-center gap-1.5 truncate max-w-[260px]"
                    >
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{link.title}</span>
                    </a>
                    {onDeleteCustomLink && (
                      <button
                        type="button"
                        onClick={() => onDeleteCustomLink(rawEnriched.id, link.id)}
                        className="text-zinc-500 hover:text-[#EF4444] p-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Close Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[46px] py-3 rounded-2xl bg-[#171717] hover:bg-[#242424] border border-[#303030] text-[#F5F5F5] font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
