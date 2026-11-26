import React, { useState, useEffect } from 'react';
import {
  Play,
  Disc,
  Info,
  Shuffle,
  Edit3,
  Trash2,
  Dumbbell,
  Plus,
  RotateCcw,
  Sparkles,
  Layers,
  BookOpen,
  CheckCircle2,
  X,
  Target,
  Flame,
  Zap,
  Upload,
  ArrowLeftRight,
  ArrowUp,
  ArrowDown,
  Minus,
  Search,
  AlertTriangle,
  Camera,
  ShieldCheck,
  Wrench,
  MoreVertical,
  Link2,
} from 'lucide-react';
import { Routine, Exercise, CompletedWorkout } from '../types';
import {
  FITNESS_MODALITIES,
  FITNESS_MODALITY_LIST,
  PRESET_FITNESS_ROUTINES,
  FitnessModalityId,
  FitnessModality,
} from '../data/fitnessModalities';
import {
  EXERCISE_LIBRARY,
  filterExerciseCatalog,
  resolveLibraryExercise,
  findLibraryExerciseCandidates,
  LibraryExercise,
} from '../data/exerciseLibrary';
import { enrichExerciseWithLibrary } from '../utils/enrichRoutines';
import { ACCEPTED_ALL_IMPORTER_EXTENSIONS } from '../utils/imageRoutineImporter';
import {
  CsvImportResult,
  normalizar,
  parseGymCsvData,
  consolidateWeeklyRoutines,
  resolveCanonicalDay,
} from '../utils/csvImporter';
import { evaluateWeeklyDaysCompletion, resolveCanonicalWeekday } from '../utils/exportReport';
import { isSameWeekday } from '../utils/workoutAnalyticsEngine';
import {
  isLikelyRestValue,
  parseRestToSeconds,
  RoutineImportValidationReport,
  validateRoutineImportIntegrity,
} from '../utils/routineImporterHelpers';
import {
  PreImportBackupSnapshot,
  SafeImportPayload,
} from '../utils/safeImportPersistence';
import RoutineUploader from '../components/RoutineUploader';
import { ImageRoutineImporterModal } from '../components/ImageRoutineImporterModal';
import { ExerciseThumbnail, preloadExerciseImage } from '../components/ExerciseThumbnail';
import { QuickRoutineBuilderPanel } from '../components/QuickRoutineBuilderPanel';
import { findPreviousExerciseSessions } from '../utils/progressionEngine';

interface RoutinesViewProps {
  routines: Routine[];
  history?: CompletedWorkout[];
  selectedDayId: string;
  onSelectRoutineId: (id: string) => void;
  onStartWorkout: (routine: Routine) => void;
  onOpenExerciseModal: (exercise: Exercise) => void;
  onOpenPlateCalculator: (weight?: number) => void;
  selectedAlternatives: Record<string, boolean>;
  onToggleAlternative: (exerciseId: string) => void;
  onOpenCreateRoutine: () => void;
  onOpenEditRoutine: (routine: Routine) => void;
  onDeleteRoutine?: (routineId: string) => void;
  onClearAllRoutines?: () => void;
  onOpenAIRoutineModal?: () => void;
  onResetRoutines: () => void;
  onAddRoutine?: (routine: Routine) => void;
  onImportCsv?: (result: CsvImportResult | SafeImportPayload) => any;
  activeProfileName?: string;
  preImportBackup?: PreImportBackupSnapshot | null;
  onRestorePreImportBackup?: () => { success: boolean; message: string };
}

export const RoutinesView: React.FC<RoutinesViewProps> = ({
  routines,
  history = [],
  selectedDayId,
  onSelectRoutineId,
  onStartWorkout,
  onOpenExerciseModal,
  onOpenPlateCalculator,
  selectedAlternatives,
  onToggleAlternative,
  onOpenCreateRoutine,
  onOpenEditRoutine,
  onDeleteRoutine,
  onClearAllRoutines,
  onOpenAIRoutineModal,
  onResetRoutines,
  onAddRoutine,
  onImportCsv,
  activeProfileName,
  preImportBackup,
  onRestorePreImportBackup,
}) => {
  const [showModalitiesModal, setShowModalitiesModal] = useState(false);
  const [showUploaderModal, setShowUploaderModal] = useState(false);
  const [showImageImporterModal, setShowImageImporterModal] = useState(false);
  const [pendingImportFiles, setPendingImportFiles] = useState<File[] | null>(null);
  const [selectedPresetModal, setSelectedPresetModal] = useState<Routine | null>(null);
  const [confirmingRestoreBackup, setConfirmingRestoreBackup] = useState(false);
  const [dismissedBackupId, setDismissedBackupId] = useState<string | null>(null);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showRoutineMenu, setShowRoutineMenu] = useState(false);


  useEffect(() => {
    routines.forEach((r) => {
      r.exercises.forEach((ex) => {
        if (ex.thumbnailUrl) preloadExerciseImage(ex.thumbnailUrl);
      });
    });
  }, [routines]);

  const handleRoutineUploadSuccess = (data: any) => {
    let result: CsvImportResult;
    if (Array.isArray(data)) {
      result = parseGymCsvData(data);
    } else if (data && Array.isArray(data.routines)) {
      const normalizedRoutines = consolidateWeeklyRoutines(
        data.routines.map((r: any, idx: number) => {
          const cDay = resolveCanonicalDay(r.dayName, r.dia, r.day, r.title) || 'Lunes';
          return {
            ...r,
            id: r.id || `rutina-ia-${normalizar(cDay)}-${idx}`,
            dayName: cDay,
            exercises: (r.exercises || []).map((ex: any, exIdx: number) => {
              const exDay = resolveCanonicalDay(ex.dia, ex.day, cDay) || cDay;
              const parsedRest = parseRestToSeconds(
                ex.DESCANSO ?? ex.descanso ?? ex.restText ?? ex.rest ?? ex.restSeconds,
                90
              );
              return {
                ...ex,
                id: ex.id || `ex-ia-${normalizar(exDay)}-${exIdx}`,
                defaultSets: Math.min(Math.max(Number(ex.defaultSets || ex.series || 3), 1), 6),
                restSeconds: parsedRest.restSeconds,
                restText: parsedRest.restText,
                objective: ex.objective || 'Hipertrofia',
                defaultVideoUrl: ex.defaultVideoUrl || '',
                techniqueCues: ex.techniqueCues || ['Técnica estricta y control excéntrico'],
                dia: exDay,
                day: exDay,
              };
            }),
          };
        })
      );
      result = {
        routines: normalizedRoutines,
        workouts: data.workouts || [],
        prs: data.prs || {},
        stats: data.stats || {
          totalRows: normalizedRoutines.length,
          routinesCreated: normalizedRoutines.length,
          routineNames: normalizedRoutines.map((r) => r.title),
          workoutsCreated: 0,
          prsCreated: 0,
        },
      };
    } else {
      const routinesList = consolidateWeeklyRoutines(data?.routines || []);
      result = {
        routines: routinesList,
        workouts: [],
        prs: {},
        stats: {
          totalRows: routinesList.length,
          routinesCreated: routinesList.length,
          routineNames: routinesList.map((r) => r.title),
          workoutsCreated: 0,
          prsCreated: 0,
        },
      };
    }

    const safeResult: CsvImportResult = {
      ...result,
      importMode: 'append_new',
      confirmReplaceExisting: false,
      preserveWorkoutsAndHistory: true,
    };

    if (onImportCsv) {
      onImportCsv(safeResult);
    }
    if (safeResult.routines.length > 0) {
      onSelectRoutineId(safeResult.routines[0].id);
    }
    const validation =
      safeResult.validationReport ||
      validateRoutineImportIntegrity(
        Array.isArray(data) ? data : [],
        safeResult.routines
      );
    setImportValidationReport(validation);

    const totalImportedEx = result.routines.reduce(
      (acc, r) => acc + (r.exercises?.length || 0),
      0
    );
    const totalImportedSets = result.routines.reduce(
      (acc, r) =>
        acc + (r.exercises || []).reduce((sAcc, ex) => sAcc + (ex.defaultSets || 3), 0),
      0
    );
    setShowUploaderModal(false);
    setShowToolsMenu(false);
    setAddedRoutineSuccess(
      `¡Rutina importada con éxito: ${result.routines.length} días, ${totalImportedEx} ejercicios y ${totalImportedSets} series!`
    );
    setTimeout(() => setAddedRoutineSuccess(null), 4500);
  };

  const [addedRoutineSuccess, setAddedRoutineSuccess] = useState<string | null>(null);
  const [importValidationReport, setImportValidationReport] =
    useState<RoutineImportValidationReport | null>(null);

  const [exerciseToSwap, setExerciseToSwap] = useState<{ routineId: string; exercise: Exercise } | null>(null);
  const [swapSearchTerm, setSwapSearchTerm] = useState('');
  const [exerciseToLink, setExerciseToLink] = useState<{ routineId: string; exercise: Exercise } | null>(null);
  const [linkSearchTerm, setLinkSearchTerm] = useState('');

  const [homologationState, setHomologationState] = useState<{
    open: boolean;
    rawResult: CsvImportResult;
    unmatchedExercises: { originalName: string; routineId: string; exerciseId: string }[];
    mapping: Record<string, string>;
  } | null>(null);

  const officialMap = new Map(EXERCISE_LIBRARY.map((e) => [normalizar(e.name), e]));

  const handleFileImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPendingImportFiles(files);
    setShowImageImporterModal(true);
    setShowToolsMenu(false);
    e.target.value = '';
  };

  const handleConfirmHomologation = () => {
    if (!homologationState) return;
    const { rawResult, mapping } = homologationState;

    const updatedRoutines = rawResult.routines.map((r: Routine) => ({
      ...r,
      exercises: r.exercises.map((ex: Exercise) => {
        const selectedOfficialName = mapping[ex.name];
        if (
          selectedOfficialName &&
          selectedOfficialName !== ex.name &&
          officialMap.has(normalizar(selectedOfficialName))
        ) {
          const official = officialMap.get(normalizar(selectedOfficialName))!;
          return {
            ...ex,
            name: official.name,
            targetMuscles: official.muscleGroup || ex.targetMuscles,
            equipment: official.equipment || ex.equipment,
          };
        }
        return ex;
      }),
    }));

    const finalResult = {
      ...rawResult,
      routines: updatedRoutines,
    };

    if (onImportCsv) {
      onImportCsv(finalResult);
    }
    if (finalResult.routines.length > 0) {
      onSelectRoutineId(finalResult.routines[0].id);
    }
    setHomologationState(null);
    setAddedRoutineSuccess('¡Ejercicios homologados y rutina guardada correctamente!');
    setTimeout(() => setAddedRoutineSuccess(null), 4000);
  };

  const activeRoutine =
    routines.find((r) => r.id === selectedDayId) ||
    routines.find((r) => isSameWeekday(r.dayName, selectedDayId)) ||
    routines[0];

  const activeDayPlans = activeRoutine
    ? routines.filter(
        (r) =>
          isSameWeekday(r.dayName || r.title, activeRoutine.dayName) &&
          Array.isArray(r.exercises) &&
          r.exercises.length > 0
      )
    : [];

  const handleConfirmSwap = (selectedOfficial: typeof EXERCISE_LIBRARY[0]) => {
    if (!exerciseToSwap || !activeRoutine) return;
    const updatedRoutine: Routine = {
      ...activeRoutine,
      exercises: activeRoutine.exercises.map((ex) => {
        if (ex.id === exerciseToSwap.exercise.id) {
          return enrichExerciseWithLibrary({
            ...ex,
            name: selectedOfficial.name,
            libraryExerciseId: selectedOfficial.id,
            thumbnailUrl: selectedOfficial.thumbnailUrl || undefined,
            secondaryThumbnailUrl: selectedOfficial.secondaryThumbnailUrl || undefined,
            defaultVideoUrl: selectedOfficial.videoUrl || selectedOfficial.url || ex.defaultVideoUrl,
            targetMuscles: selectedOfficial.muscleGroup || ex.targetMuscles,
            equipment: selectedOfficial.equipment || ex.equipment,
            alternative: selectedOfficial.equipment || ex.alternative,
          });
        }
        return ex;
      }),
    };

    if (onAddRoutine) {
      onAddRoutine(updatedRoutine);
    }
    setExerciseToSwap(null);
  };

  const handleConfirmLinkCorrespondence = (selectedOfficial: LibraryExercise) => {
    if (!exerciseToLink || !activeRoutine || !onAddRoutine) return;
    const updatedRoutine: Routine = {
      ...activeRoutine,
      exercises: activeRoutine.exercises.map((ex) => {
        if (ex.id !== exerciseToLink.exercise.id) return ex;
        // Conserva ex.id, nombre original, cargas, series, repeticiones, notas e historial sin alterarlos
        return enrichExerciseWithLibrary({
          ...ex,
          libraryExerciseId: selectedOfficial.id,
          thumbnailUrl: selectedOfficial.thumbnailUrl || undefined,
          secondaryThumbnailUrl: selectedOfficial.secondaryThumbnailUrl || undefined,
          defaultVideoUrl: selectedOfficial.videoUrl || selectedOfficial.url || ex.defaultVideoUrl,
        });
      }),
    };
    onAddRoutine(updatedRoutine);
    setAddedRoutineSuccess(
      `Correspondencia guardada: "${exerciseToLink.exercise.name}" → "${selectedOfficial.name}"`
    );
    setTimeout(() => setAddedRoutineSuccess(null), 4000);
    setExerciseToLink(null);
    setLinkSearchTerm('');
  };

  const handleMoveExerciseOrder = (index: number, direction: 'up' | 'down') => {
    if (!activeRoutine || !onAddRoutine) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= activeRoutine.exercises.length) return;

    const reordered = [...activeRoutine.exercises];
    const [movedItem] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, movedItem);

    onAddRoutine({
      ...activeRoutine,
      exercises: reordered,
    });
  };

  const handleRemoveExerciseFromRoutine = (exerciseId: string) => {
    if (!activeRoutine || !onAddRoutine) return;
    const filtered = activeRoutine.exercises.filter((ex) => ex.id !== exerciseId);
    if (filtered.length === 0 && onDeleteRoutine) {
      onDeleteRoutine(activeRoutine.id);
      return;
    }
    onAddRoutine({
      ...activeRoutine,
      exercises: filtered,
    });
  };

  const detectedModalityId = activeRoutine
    ? ((activeRoutine.modality as FitnessModalityId) || (
        activeRoutine.title.toLowerCase().includes('fuerza') || activeRoutine.tagline.toLowerCase().includes('fuerza')
          ? 'fuerza_maxima'
          : activeRoutine.title.toLowerCase().includes('potencia') || activeRoutine.tagline.toLowerCase().includes('potencia')
          ? 'potencia'
          : activeRoutine.title.toLowerCase().includes('definici') || activeRoutine.tagline.toLowerCase().includes('definici')
          ? 'definicion'
          : activeRoutine.title.toLowerCase().includes('recomposici') || activeRoutine.tagline.toLowerCase().includes('recomposici')
          ? 'recomposicion'
          : activeRoutine.title.toLowerCase().includes('resistencia') || activeRoutine.tagline.toLowerCase().includes('resistencia')
          ? 'resistencia'
          : 'hipertrofia'
      ))
    : 'hipertrofia';

  const activeModality = activeRoutine ? FITNESS_MODALITIES[detectedModalityId] : null;

  const handleAddPresetRoutine = (preset: Routine) => {
    if (onAddRoutine) {
      const cloned: Routine = {
        ...preset,
        id: `rutina-fitness-${preset.modality}-${Date.now()}`,
        isCustom: true,
      };
      onAddRoutine(cloned);
      onSelectRoutineId(cloned.id);
      setAddedRoutineSuccess(`¡Rutina "${preset.title}" agregada a tu plan!`);
      setTimeout(() => {
        setAddedRoutineSuccess(null);
        setShowModalitiesModal(false);
      }, 1500);
    }
  };

  return (
    <div className="space-y-6 pb-16 font-sans bg-[#090909] text-[#F5F5F5] min-h-screen">
      {/* 1. CABECERA DE RUTINAS ELITE 5.0 */}
      <div
        style={{ position: 'sticky', top: '3.5rem', zIndex: 1000 }}
        className="sticky top-14 z-50 -mx-4 px-4 py-4 bg-[#090909]/95 backdrop-blur-md border-b border-[#303030] shadow-2xl space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h1 className="text-xl sm:text-2xl font-black text-[#F5F5F5] tracking-tight">
              RUTINAS
            </h1>
            <p className="text-xs text-[#F5F5F5]/65 font-mono">
              Planifica. Entrena. Evoluciona.
            </p>
          </div>

          {/* Botones principales: + Nueva Rutina y menú Herramientas */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onOpenCreateRoutine}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs flex items-center justify-center gap-2 transition-all active:scale-95 shadow-[0_0_15px_var(--accent-glow)] cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>+ NUEVA RUTINA</span>
            </button>

            {/* Menú Secundario: HERRAMIENTAS */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowToolsMenu(!showToolsMenu)}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-[#F5F5F5] font-bold text-xs flex items-center gap-2 transition-all cursor-pointer"
              >
                <Wrench className="w-4 h-4 text-accent-text" />
                <span>HERRAMIENTAS</span>
              </button>

              {showToolsMenu && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-[#171717] border border-[#303030] shadow-2xl py-2 z-50 animate-in fade-in duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setShowImageImporterModal(true);
                    }}
                    className="w-full text-left px-4 py-2.5 text-xs font-bold text-[#F5F5F5] hover:bg-[#252525] flex items-center gap-2.5 cursor-pointer"
                  >
                    <Camera className="w-4 h-4 text-accent-text" />
                    <span>Importar desde imagen</span>
                  </button>

                  <label className="w-full text-left px-4 py-2.5 text-xs font-bold text-[#F5F5F5] hover:bg-[#252525] flex items-center gap-2.5 cursor-pointer">
                    <Upload className="w-4 h-4 text-accent-text" />
                    <span>Importar Excel / CSV</span>
                    <input
                      type="file"
                      accept={ACCEPTED_ALL_IMPORTER_EXTENSIONS}
                      multiple
                      onChange={handleFileImportChange}
                      className="hidden"
                    />
                  </label>

                  {onOpenAIRoutineModal && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowToolsMenu(false);
                        onOpenAIRoutineModal();
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-[#F5F5F5] hover:bg-[#252525] flex items-center gap-2.5 cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-accent-text" />
                      <span>Generar con IA</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setShowModalitiesModal(true);
                    }}
                    className="w-full text-left px-4 py-2.5 text-xs font-bold text-[#F5F5F5] hover:bg-[#252525] flex items-center gap-2.5 cursor-pointer border-t border-[#303030] mt-1 pt-2"
                  >
                    <BookOpen className="w-4 h-4 text-accent-text" />
                    <span>6 Modalidades Científicas</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. SELECTOR SEMANAL COMPACTO ELITE 5.0 */}
        {routines.length > 0 && (() => {
          const weeklyCompletion = evaluateWeeklyDaysCompletion(history, routines);
          const FULL_WEEK_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

          return (
            <div className="space-y-2 pt-1">
              <div className="flex flex-row items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                {FULL_WEEK_DAYS.map((weekdayName) => {
                  const dayMatches = routines.filter(
                    (r) =>
                      isSameWeekday(r.dayName || r.title, weekdayName) &&
                      Array.isArray(r.exercises) &&
                      r.exercises.length > 0
                  );
                  const matchedRoutine =
                    dayMatches.find((r) => r.id === (activeRoutine?.id || selectedDayId)) ||
                    dayMatches[0];

                  if (!matchedRoutine) {
                    return (
                      <div
                        key={weekdayName}
                        title={`${weekdayName} · Descanso`}
                        className="min-h-[38px] bg-[#171717]/60 border border-[#303030] text-[#F5F5F5]/40 rounded-xl px-3 py-1.5 text-xs font-mono uppercase tracking-wider whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 select-none"
                      >
                        <span>{weekdayName.substring(0, 3)}</span>
                        <span className="text-[9px] font-bold text-[#F5F5F5]/30">Z</span>
                      </div>
                    );
                  }

                  const isSelected = matchedRoutine.id === (activeRoutine?.id || selectedDayId);
                  const canonicalDay = resolveCanonicalWeekday(matchedRoutine.dayName || matchedRoutine.title);
                  const dayStatus = weeklyCompletion.byDayName[canonicalDay];
                  const isCompleted = Boolean(dayStatus?.isCompleted);

                  const stateClasses = isSelected
                    ? 'bg-accent text-accent-contrast border border-accent font-black shadow-[0_0_15px_var(--accent-glow)]'
                    : 'bg-[#171717] text-[#F5F5F5]/80 border border-[#303030] hover:border-accent/50 font-semibold';

                  return (
                    <button
                      key={matchedRoutine.id}
                      type="button"
                      onClick={() => onSelectRoutineId(matchedRoutine.id)}
                      className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all duration-200 shrink-0 inline-flex items-center gap-1.5 cursor-pointer ${stateClasses}`}
                    >
                      <span className="font-bold">{matchedRoutine.dayName}</span>
                      {isCompleted && (
                        <CheckCircle2 className={`w-3 h-3 ${isSelected ? 'text-accent-contrast' : 'text-accent-text'}`} />
                      )}
                    </button>
                  );
                })}
              </div>

              {activeDayPlans.length > 1 && activeRoutine && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#F5F5F5]/50 whitespace-nowrap shrink-0">
                    Planes ({activeRoutine.dayName}):
                  </span>
                  {activeDayPlans.map((plan, pIdx) => {
                    const isPlanSelected = plan.id === activeRoutine.id;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => onSelectRoutineId(plan.id)}
                        className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 border transition-all cursor-pointer ${
                          isPlanSelected
                            ? 'bg-accent text-accent-contrast border-accent'
                            : 'bg-[#171717] text-[#F5F5F5]/80 border-[#303030] hover:border-accent/50'
                        }`}
                      >
                        {plan.title || `Plan ${pIdx + 1}`}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Success Notification */}
      {addedRoutineSuccess && (
        <div className="p-4 rounded-2xl bg-[#171717] border border-accent text-accent-text text-xs font-bold flex items-center gap-3 shadow-lg">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-accent-text" />
          <span>{addedRoutineSuccess}</span>
        </div>
      )}

      {/* Pre-Import Backup Recovery Card */}
      {preImportBackup &&
        onRestorePreImportBackup &&
        dismissedBackupId !== preImportBackup.id && (
          <div className="p-4 rounded-2xl bg-[#171717] border border-[#303030] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
            <div className="flex items-start gap-3 min-w-0">
              <ShieldCheck className="w-5 h-5 text-accent-text shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-black text-[#F5F5F5]">
                  Respaldo disponible ({new Date(preImportBackup.createdAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })})
                </p>
                <p className="text-[11px] text-[#F5F5F5]/60 font-mono">
                  {preImportBackup.routinesCount} rutinas · {preImportBackup.historyCount} entrenamientos · {preImportBackup.prsCount} PRs
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {confirmingRestoreBackup ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const res = onRestorePreImportBackup();
                      setConfirmingRestoreBackup(false);
                      setAddedRoutineSuccess(res.message);
                      setTimeout(() => setAddedRoutineSuccess(null), 4500);
                    }}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-accent text-accent-contrast text-xs font-black cursor-pointer"
                  >
                    Sí, restaurar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRestoreBackup(false)}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#090909] border border-[#303030] text-xs font-bold text-[#F5F5F5]/80 cursor-pointer"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmingRestoreBackup(true)}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#090909] border border-accent/50 text-accent-text hover:bg-accent/10 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurar respaldo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissedBackupId(preImportBackup.id)}
                    className="min-h-[38px] min-w-[38px] rounded-xl bg-[#090909] border border-[#303030] text-[#F5F5F5]/60 hover:text-[#F5F5F5] flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}

      {/* 3. CONSTRUCTOR RÁPIDO (CONSTRUCTOR ELITE PLEGABLE) */}
      {onAddRoutine && (
        <div className="bg-[#171717] border border-[#303030] rounded-2xl shadow-xl overflow-hidden transition-all">
          <QuickRoutineBuilderPanel
            routines={routines}
            activeRoutine={activeRoutine}
            onSelectRoutineId={onSelectRoutineId}
            onSaveRoutine={onAddRoutine}
            onDeleteRoutine={onDeleteRoutine}
            isOpenByDefault={routines.length === 0}
          />
        </div>
      )}

      {/* Empty State */}
      {routines.length === 0 && (
        <div className="bg-[#171717] rounded-3xl p-8 border border-[#303030] text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-accent/10 border border-accent/30 flex items-center justify-center text-accent-text">
            <Dumbbell className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-black text-[#F5F5F5]">Tu lista de rutinas está vacía</h3>
            <p className="text-xs text-[#F5F5F5]/65 max-w-md mx-auto">
              Crea tu primera rutina, impórtala o explora las 6 modalidades científicas.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={onOpenCreateRoutine}
              className="w-full sm:w-auto min-h-[46px] py-3 px-5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_18px_var(--accent-glow)]"
            >
              <Plus className="w-4 h-4" />
              <span>+ NUEVA RUTINA</span>
            </button>
            <button
              type="button"
              onClick={() => setShowImageImporterModal(true)}
              className="w-full sm:w-auto min-h-[46px] py-3 px-5 rounded-xl bg-[#090909] border border-[#303030] hover:border-accent/50 text-[#F5F5F5] font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Camera className="w-4 h-4 text-accent-text" />
              <span>Importar Imagen</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. TARJETA DE RUTINA ACTIVA (PROTAGONISTA) & 5. TARJETAS DE EJERCICIOS */}
      {routines.length > 0 && activeRoutine && (
        <div className="space-y-6">
          {/* Tarjeta Protagonista Elite 5.0 */}
          <div className="bg-[#171717] border border-[#303030] rounded-3xl p-6 shadow-2xl space-y-5 relative">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-mono text-accent-text uppercase tracking-wider">
                  <span>{activeRoutine.dayName}</span>
                  <span>·</span>
                  <span className="text-[#F5F5F5]/70">
                    {activeRoutine.exercises.length} ejercicios · {activeRoutine.exercises.reduce((acc, ex) => acc + (ex.defaultSets || 3), 0)} series
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-[#F5F5F5] tracking-tight">
                  {activeRoutine.title}
                </h2>
                <p className="text-xs text-[#F5F5F5]/70 leading-relaxed font-sans">{activeRoutine.tagline}</p>
              </div>

              {/* Menú de tres puntos para editar / eliminar */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowRoutineMenu(!showRoutineMenu)}
                  className="min-h-[40px] min-w-[40px] rounded-xl bg-[#090909] border border-[#303030] text-[#F5F5F5] hover:border-accent flex items-center justify-center transition-colors cursor-pointer"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {showRoutineMenu && (
                  <div className="absolute right-0 mt-2 w-48 rounded-2xl bg-[#090909] border border-[#303030] shadow-2xl py-2 z-50 animate-in fade-in duration-150">
                    <button
                      type="button"
                      onClick={() => {
                        setShowRoutineMenu(false);
                        onOpenEditRoutine(activeRoutine);
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-[#F5F5F5] hover:bg-[#171717] flex items-center gap-2 cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4 text-accent-text" />
                      <span>Editar rutina</span>
                    </button>
                    {onDeleteRoutine && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowRoutineMenu(false);
                          if (confirm(`¿Eliminar la rutina "${activeRoutine.title}"?`)) {
                            onDeleteRoutine(activeRoutine.id);
                          }
                        }}
                        className="w-full text-left px-4 py-2.5 text-xs font-bold text-red-400 hover:bg-red-950/30 flex items-center gap-2 cursor-pointer border-t border-[#303030] mt-1 pt-2"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                        <span>Eliminar rutina</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Botón Grande INICIAR ENTRENAMIENTO con color de acento */}
            <button
              type="button"
              onClick={() => onStartWorkout(activeRoutine)}
              className="w-full min-h-[50px] py-4 rounded-2xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-sm uppercase tracking-wider active:scale-98 transition-all flex items-center justify-center gap-2.5 shadow-[0_0_20px_var(--accent-glow)] cursor-pointer"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>INICIAR ENTRENAMIENTO</span>
            </button>
          </div>

          {/* Tarjetas de Ejercicios Elite 5.0 */}
          <div className="space-y-3.5">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#F5F5F5]/50 px-1">
              Ejercicios Programados ({activeRoutine.exercises.length})
            </h3>

            {activeRoutine.exercises.map((exercise, index) => {
              const isAltSelected = !!selectedAlternatives[exercise.id];
              const displayedName =
                isAltSelected && exercise.alternative ? exercise.alternative : exercise.name;
              const activeThumbnailQuery =
                isAltSelected && exercise.alternative
                  ? { name: exercise.alternative }
                  : exercise;
              const resolvedMatch = resolveLibraryExercise(activeThumbnailQuery);
              const candidateLookup =
                !isAltSelected && !resolvedMatch
                  ? findLibraryExerciseCandidates(exercise, 10)
                  : null;

              return (
                <div
                  key={exercise.id}
                  className="bg-[#171717] border border-[#303030] rounded-2xl p-4 hover:border-accent/50 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg"
                >
                  {/* Izquierda: Número, Thumbnail, Nombre y Músculo */}
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <span className="font-mono text-sm text-accent-text font-black tabular-nums shrink-0 w-6">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <ExerciseThumbnail
                      src={isAltSelected ? undefined : exercise.thumbnailUrl}
                      alt={displayedName}
                      muscleGroup={exercise.targetMuscles}
                      exercise={activeThumbnailQuery}
                      showSpinner
                      allowRetry
                      onClick={() => onOpenExerciseModal(exercise)}
                      className="w-12 h-12 rounded-xl shrink-0 border border-[#303030]"
                    />
                    <div className="min-w-0 space-y-0.5">
                      <h4 className="text-sm font-black text-[#F5F5F5] tracking-tight truncate">
                        {displayedName}
                      </h4>
                      <p className="text-xs text-[#F5F5F5]/60 font-mono truncate">
                        {exercise.targetMuscles}
                      </p>
                      <div className="text-xs font-mono font-bold text-accent-text pt-0.5">
                        {exercise.defaultSets} series · {exercise.repRange} repeticiones
                      </div>
                      {!isAltSelected && !resolvedMatch && onAddRoutine && (
                        <button
                          type="button"
                          onClick={() => {
                            setLinkSearchTerm('');
                            setExerciseToLink({ routineId: activeRoutine.id, exercise });
                          }}
                          className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-400 hover:text-accent-text transition-colors cursor-pointer"
                        >
                          <Link2 className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {candidateLookup && candidateLookup.candidates.length > 0
                              ? `Elegir correspondencia (${candidateLookup.candidates.length} variantes)`
                              : 'Vincular correspondencia visual'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Derecha: Carga planificada, última sesión y acciones */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between sm:justify-end w-full sm:w-auto gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#303030]">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 font-mono text-xs text-[#F5F5F5]/80 bg-[#090909] px-3 py-2 rounded-xl border border-[#303030]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#F5F5F5]/50 text-[10px]" title="Carga planificada en rutina">Plan:</span>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          placeholder="Sin carga"
                          value={exercise.defaultWeight ?? ''}
                          onChange={(e) => {
                            if (!onAddRoutine) return;
                            const rawVal = e.target.value;
                            const nextWeight = rawVal === '' ? undefined : Number(rawVal);
                            const updatedRoutine: Routine = {
                              ...activeRoutine,
                              exercises: activeRoutine.exercises.map((ex) =>
                                ex.id === exercise.id
                                  ? {
                                      ...ex,
                                      prevWeight:
                                        ex.defaultWeight &&
                                        ex.defaultWeight > 0 &&
                                        nextWeight !== ex.defaultWeight
                                          ? ex.defaultWeight
                                          : ex.prevWeight,
                                      defaultWeight: nextWeight,
                                      dia: ex.dia || activeRoutine.dayName,
                                      day: ex.day || activeRoutine.dayName,
                                    }
                                  : ex
                              ),
                            };
                            onAddRoutine(updatedRoutine);
                          }}
                          className="w-16 bg-transparent text-accent-text font-black focus:outline-none text-right"
                        />
                        <span className="text-[#F5F5F5]/50 text-[10px]">kg</span>
                      </div>
                      {/* Última sesión real */}
                      <div className="text-[10px] text-slate-400 border-t sm:border-t-0 sm:border-l border-[#303030] sm:pl-2 pt-1 sm:pt-0">
                        {(() => {
                          const prevSessions = findPreviousExerciseSessions({
                            history,
                            exercise: {
                              exerciseId: exercise.id,
                              libraryExerciseId: exercise.libraryExerciseId,
                              activeExerciseName: displayedName,
                              equipment: exercise.equipment,
                              useAlternative: isAltSelected,
                            },
                            limit: 1,
                          });
                          const lastMatch = prevSessions[0] || null;
                          if (lastMatch) {
                            const dateStr = new Date(lastMatch.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
                            const setsSummary = lastMatch.setsDetail.length > 0
                              ? lastMatch.setsDetail.map(s => `${s.weight}kg×${s.reps}`).join(', ')
                              : `${lastMatch.maxWeight}kg×${lastMatch.maxReps}`;
                            return (
                              <span className="text-emerald-400 font-medium" title={`Última sesión el ${dateStr}: ${setsSummary}`}>
                                Última ({dateStr}): {setsSummary}
                              </span>
                            );
                          }
                          return <span className="text-slate-500 italic">Sin registro previo</span>;
                        })()}
                      </div>
                    </div>

                    {/* Acciones secundarias (Correspondencia, Reemplazar, Info, Eliminar) */}
                    <div className="flex items-center gap-1.5">
                      {onAddRoutine && (
                        <button
                          type="button"
                          onClick={() => {
                            setLinkSearchTerm('');
                            setExerciseToLink({ routineId: activeRoutine.id, exercise });
                          }}
                          className="p-2 rounded-xl bg-[#090909] hover:bg-[#222222] text-zinc-300 hover:text-accent-text border border-[#303030] transition-colors cursor-pointer"
                          title="Vincular o cambiar imagen de biblioteca"
                        >
                          <Link2 className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setExerciseToSwap({ routineId: activeRoutine.id, exercise })}
                        className="p-2 rounded-xl bg-[#090909] hover:bg-[#222222] text-accent-text border border-[#303030] transition-colors cursor-pointer"
                        title="Reemplazar ejercicio"
                      >
                        <ArrowLeftRight className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenExerciseModal(exercise)}
                        className="p-2 rounded-xl bg-[#090909] hover:bg-[#222222] text-[#F5F5F5] border border-[#303030] transition-colors cursor-pointer"
                        title="Ficha técnica"
                      >
                        <Info className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveExerciseFromRoutine(exercise.id)}
                        className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors cursor-pointer"
                        title="Eliminar ejercicio"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Zona de peligro / Eliminar todas las rutinas */}
          {onClearAllRoutines && routines.length > 0 && (
            <div className="pt-4">
              <button
                onClick={() => {
                  if (confirm('¿Eliminar todas las rutinas cargadas y dejar tu lista completamente limpia?')) {
                    onClearAllRoutines();
                  }
                }}
                className="w-full bg-red-500/10 text-red-400 border border-red-500/30 rounded-xl py-3.5 hover:bg-red-500/20 transition-all font-bold uppercase tracking-widest text-xs cursor-pointer"
              >
                Eliminar todas las rutinas cargadas
              </button>
            </div>
          )}
        </div>
      )}

      {/* Fitness Modalities Modal */}
      {showModalitiesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-[#171717] border border-[#303030] rounded-3xl p-6 shadow-2xl text-[#F5F5F5] max-h-[92vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#303030]">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-accent/15 text-accent-text border border-accent/30">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Modalidades de Fitness Científicas</h3>
                  <p className="text-[11px] text-[#F5F5F5]/60">6 tipos con rangos de repetición y descanso</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowModalitiesModal(false);
                  setSelectedPresetModal(null);
                }}
                className="p-1.5 rounded-full hover:bg-[#222222] text-[#F5F5F5]/60 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-[#303030] bg-[#090909] p-1">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#303030] text-[10px] text-[#F5F5F5]/50 uppercase tracking-wider font-bold">
                    <th className="py-3 px-3">Modalidad</th>
                    <th className="py-3 px-3">Repeticiones</th>
                    <th className="py-3 px-3">Descanso</th>
                    <th className="py-3 px-3">Enfoque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#303030]/60 font-medium">
                  {FITNESS_MODALITY_LIST.map((m) => (
                    <tr key={m.id} className="hover:bg-[#171717]/60 transition-colors">
                      <td className="py-2.5 px-3 font-bold text-white flex items-center gap-2 whitespace-nowrap">
                        <span>{m.emoji}</span>
                        <span>{m.name}</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-accent-text whitespace-nowrap">
                        {m.repRange}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-cyan-300 whitespace-nowrap">
                        {m.restRange}
                      </td>
                      <td className="py-2.5 px-3 text-[#F5F5F5]/80 text-[11px] whitespace-nowrap">
                        {m.caloricFocus}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-[#F5F5F5]">
                Rutinas Pre-configuradas Disponibles
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {PRESET_FITNESS_ROUTINES.map((preset) => {
                  const mod = preset.modality ? FITNESS_MODALITIES[preset.modality as FitnessModalityId] : null;
                  return (
                    <div
                      key={preset.id}
                      className="p-4 rounded-2xl bg-[#090909] border border-[#303030] hover:border-accent/50 transition-all space-y-3 flex flex-col justify-between"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold text-accent-text font-mono">
                            {preset.dayName}
                          </span>
                          {mod && (
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${mod.badgeClass}`}>
                              {mod.emoji} {mod.shortName}
                            </span>
                          )}
                        </div>
                        <h5 className="text-sm font-black text-white leading-tight">
                          {preset.title}
                        </h5>
                        <p className="text-[11px] text-[#F5F5F5]/65 leading-snug">
                          {preset.tagline}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-[#303030]">
                        <button
                          type="button"
                          onClick={() => handleAddPresetRoutine(preset)}
                          className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                        >
                          <Plus className="w-3.5 h-3.5 stroke-[3]" />
                          <span>Añadir</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onStartWorkout(preset);
                            setShowModalitiesModal(false);
                          }}
                          className="px-3.5 py-2.5 rounded-xl bg-[#171717] hover:bg-[#222222] text-white font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 border border-[#303030] cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" />
                          <span>Entrenar</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Homologation Modal */}
      {homologationState && homologationState.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-[#171717] border border-[#303030] rounded-3xl p-6 shadow-2xl text-[#F5F5F5] max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#303030]">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-accent/15 text-accent-text border border-accent/30">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Homologar Ejercicios de la Planilla</h3>
                  <p className="text-[11px] text-[#F5F5F5]/60 font-mono">
                    Vincula los ejercicios detectados con la biblioteca oficial
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHomologationState(null)}
                className="p-1.5 rounded-full hover:bg-[#222222] text-[#F5F5F5]/60 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-[#F5F5F5]/80 leading-relaxed">
                Se detectaron {homologationState.unmatchedExercises.length} ejercicios que no coinciden exactamente. Selecciona el ejercicio oficial correspondiente:
              </p>

              <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
                {homologationState.unmatchedExercises.map((item, idx) => (
                  <div key={idx} className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] space-y-2">
                    <div className="text-[11px] font-mono text-accent-text font-bold">
                      Detectado: <span className="text-white">"{item.originalName}"</span>
                    </div>
                    <div>
                      <select
                        value={homologationState.mapping[item.originalName] || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setHomologationState((prev) => prev ? {
                            ...prev,
                            mapping: { ...prev.mapping, [item.originalName]: val },
                          } : null);
                        }}
                        className="w-full text-xs font-mono bg-[#171717] border border-[#303030] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-accent"
                      >
                        {EXERCISE_LIBRARY.map((ex) => (
                          <option key={ex.id} value={ex.name}>
                            {ex.name} ({ex.muscleGroup} - {ex.equipment})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setHomologationState(null)}
                className="flex-1 py-3 rounded-xl bg-[#090909] hover:bg-[#222222] border border-[#303030] text-[#F5F5F5]/80 font-bold text-xs active:scale-95 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmHomologation}
                className="flex-1 py-3 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs active:scale-95 transition-all shadow-[0_0_18px_var(--accent-glow)] flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Vincular y Guardar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Swap Exercise Modal */}
      {exerciseToSwap && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-[#171717] border border-[#303030] rounded-3xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col font-sans">
            <div className="flex items-center justify-between pb-3 border-b border-[#303030]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-accent/15 text-accent-text border border-accent/30">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Cambiar Ejercicio</h3>
                  <p className="text-xs text-[#F5F5F5]/65 font-mono">
                    Sustituyendo: <span className="text-accent-text font-bold">"{exerciseToSwap.exercise.name}"</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExerciseToSwap(null)}
                className="p-1.5 rounded-full hover:bg-[#222222] text-[#F5F5F5]/60 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-[#F5F5F5]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={swapSearchTerm}
                onChange={(e) => setSwapSearchTerm(e.target.value)}
                placeholder="Buscar ejercicio en la biblioteca..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#090909] border border-[#303030] text-xs font-mono text-white placeholder-[#F5F5F5]/40 focus:outline-none focus:border-accent"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 divide-y divide-[#303030]">
              {filterExerciseCatalog(EXERCISE_LIBRARY, { searchQuery: swapSearchTerm }).map(
                (official) => (
                  <button
                    key={official.id}
                    type="button"
                    onClick={() => handleConfirmSwap(official)}
                    className="w-full text-left p-3 rounded-xl hover:bg-[#222222] transition-all flex items-center justify-between group cursor-pointer"
                  >
                    <div>
                      <span className="text-xs font-bold text-white group-hover:text-accent-text block">
                        {official.name}
                      </span>
                      <span className="text-[10px] font-mono text-[#F5F5F5]/50">
                        {official.muscleGroup} • {official.equipment}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-accent-text group-hover:underline">
                      Elegir →
                    </span>
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Correspondence Picker Modal (links libraryExerciseId without changing ID, loads, sets, reps, or history) */}
      {exerciseToLink && (() => {
        const candidateResult = findLibraryExerciseCandidates(exerciseToLink.exercise, 12);
        const normQuery = normalizar(linkSearchTerm);
        const searchMatches = normQuery
          ? filterExerciseCatalog(EXERCISE_LIBRARY, { searchQuery: linkSearchTerm }).slice(0, 40)
          : candidateResult.candidates.length > 0
          ? candidateResult.candidates
          : EXERCISE_LIBRARY.slice(0, 30);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
            <div className="w-full max-w-lg bg-[#171717] border border-[#303030] rounded-3xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col font-sans">
              <div className="flex items-center justify-between pb-3 border-b border-[#303030]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                    <Link2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-black text-white">Elegir Correspondencia Visual</h3>
                    <p className="text-xs text-[#F5F5F5]/65 font-mono truncate">
                      Ejercicio: <span className="text-accent-text font-bold">"{exerciseToLink.exercise.name}"</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setExerciseToLink(null);
                    setLinkSearchTerm('');
                  }}
                  className="p-1.5 rounded-full hover:bg-[#222222] text-[#F5F5F5]/60 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Selecciona la variante exacta para mostrar su miniatura y animación sin alterar el ID original, cargas, series ni historial del ejercicio.
              </p>

              <div className="relative">
                <Search className="w-4 h-4 text-[#F5F5F5]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={linkSearchTerm}
                  onChange={(e) => setLinkSearchTerm(e.target.value)}
                  placeholder="Buscar variante o equipo (ej. prensa 45, máquina, barra...)"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#090909] border border-[#303030] text-xs font-mono text-white placeholder-[#F5F5F5]/40 focus:outline-none focus:border-accent"
                  autoFocus
                />
              </div>

              {!normQuery && candidateResult.candidates.length > 0 && (
                <div className="text-[10px] font-black uppercase tracking-wider text-amber-400 px-1">
                  Variantes sugeridas ({candidateResult.candidates.length})
                </div>
              )}

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {searchMatches.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-6">
                    No se encontraron variantes que coincidan con "{linkSearchTerm}".
                  </p>
                ) : (
                  searchMatches.map((official) => (
                    <button
                      key={official.id}
                      type="button"
                      onClick={() => handleConfirmLinkCorrespondence(official)}
                      className="w-full text-left p-2.5 rounded-xl bg-[#090909]/60 border border-[#303030] hover:border-accent/60 hover:bg-[#222222] transition-all flex items-center justify-between gap-3 group cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <ExerciseThumbnail
                          src={official.thumbnailUrl}
                          alt={official.name}
                          muscleGroup={official.muscleGroup}
                          exercise={official}
                          showSpinner
                          className="w-11 h-11 rounded-lg shrink-0 border border-[#303030]"
                        />
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-white group-hover:text-accent-text block truncate">
                            {official.name}
                          </span>
                          <span className="text-[10px] font-mono text-[#F5F5F5]/55 block truncate">
                            {official.muscleGroup} · {official.equipment || 'Estándar'}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-mono text-accent-text group-hover:underline shrink-0">
                        Vincular →
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {showUploaderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-[#171717] border border-[#303030] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#303030]">
              <h3 className="text-base font-black text-[#F5F5F5]">Importar Rutina (Excel / Word / PDF / CSV)</h3>
              <button
                type="button"
                onClick={() => setShowUploaderModal(false)}
                className="p-1.5 rounded-full hover:bg-[#222222] text-[#F5F5F5]/60 hover:text-[#F5F5F5]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <RoutineUploader
              onUploadSuccess={(data) => {
                handleRoutineUploadSuccess(data);
              }}
              onOpenImageImporter={() => {
                setShowUploaderModal(false);
                setShowImageImporterModal(true);
              }}
              onSelectFilesForUnifiedPreview={(files) => {
                setShowUploaderModal(false);
                setPendingImportFiles(files);
                setShowImageImporterModal(true);
              }}
            />
          </div>
        </div>
      )}

      <ImageRoutineImporterModal
        isOpen={showImageImporterModal}
        onClose={() => {
          setShowImageImporterModal(false);
          setPendingImportFiles(null);
        }}
        existingRoutines={routines}
        activeProfileName={activeProfileName}
        initialFiles={pendingImportFiles}
        onConsumeInitialFiles={() => setPendingImportFiles(null)}
        onConfirmSave={(result) => {
          if (onImportCsv) {
            onImportCsv(result);
          }
          const newlyAddedRoutine =
            result.routines.find(
              (r) => r.importedPlanId && result.stats.routineNames.includes(r.title)
            ) || result.routines[result.routines.length - 1];
          if (newlyAddedRoutine) {
            onSelectRoutineId(newlyAddedRoutine.id);
          }
          setDismissedBackupId(null);
          const createdDays = result.stats.routinesCreated || result.routines.length;
          setAddedRoutineSuccess(
            `¡Rutina importada de forma segura (${createdDays} día(s)). Entrenamientos y PRs intactos!`
          );
          setTimeout(() => setAddedRoutineSuccess(null), 5000);
        }}
      />
    </div>
  );
};
