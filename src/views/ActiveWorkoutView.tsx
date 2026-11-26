import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Play,
  Check,
  Plus,
  Minus,
  Timer,
  Flame,
  Disc,
  Info,
  X,
  Dumbbell,
  Sparkles,
  Search,
  Trash2,
  Zap,
  AlertTriangle,
  TrendingDown,
  ScanEye,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Pause,
  RotateCcw,
  SkipForward,
  CheckCircle2,
  Eye,
  LayoutList,
  Clock,
  Layers,
  Calendar,
  Activity,
  MoreHorizontal,
  History,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Smartphone,
  Bot,
  Trophy,
  TrendingUp,
} from 'lucide-react';
import {
  ActiveWorkoutSession,
  CoachVoiceMode,
  CompletedWorkout,
  Exercise,
  LibraryExercise,
  LiveSetCoachEvaluation,
  PersonalRecord,
  Profile,
  RestTimerState,
  RestCompleteNotice,
  Routine,
  WorkoutExerciseState,
  WorkoutSyncStatus,
} from '../types';
import {
  resolveWorkoutSyncDisplay,
  computeActiveSessionElapsedMs,
  loadActiveSessionUiState,
  saveActiveSessionUiState,
} from '../utils/workoutPersistence';
import { formatDetailedRest, formatRestMmSs } from '../utils/restFormatter';
import {
  isRdlBarbellExercise,
  isBulgarianDumbbellExercise,
} from '../utils/routineImporterHelpers';
import {
  CATALOG_MUSCLE_FILTERS,
  EXERCISE_LIBRARY,
  exerciseMatchesCompatibleMuscles,
  exerciseMatchesMuscleFilter,
  filterExerciseCatalog,
  matchesCatalogEquipment,
  normalizeExerciseName,
  resolveLibraryExercise,
} from '../data/exerciseLibrary';
import {
  evaluateDoubleProgression,
  calculateNextSetByRpe,
} from '../utils/progressionEngine';
import { ExerciseThumbnail } from '../components/ExerciseThumbnail';
import { MachineScannerModal } from '../components/MachineScannerModal';
import { RecommendedLoadForecastWidget } from '../components/RecommendedLoadForecastWidget';
import { MUSCLE_CONFIG, resolveExerciseMuscleImpact } from '../utils/muscleRecoveryEngine';
import { isSameWeekday } from '../utils/workoutAnalyticsEngine';
import { formatDateKeyYYYYMMDD } from '../utils/exportReport';
import {
  getChileLocalDateKey,
  getChileWeekdayIndex,
  getChileWeekdayName,
} from '../utils/calorieCalculator';
import {
  evaluateWeeklyRoutineCompliance,
  resolveCanonicalWeekdayStrict,
} from '../utils/routineCompletionEngine';
import { buildRestCompleteNotificationBody } from '../utils/backgroundTimer';
import {
  getNativeRestTimerCapabilities,
  isCapacitorAndroidRuntime,
  openNativeRestSettingScreen,
  requestNativeNotificationPermission,
  NATIVE_REST_PERMISSION_NEEDED_EVENT,
  type NativeRestTimerCapabilities,
} from '../utils/nativeNotifications';
import {
  buildTechniqueProProfile,
  resolveMovementPattern as resolveBiomechPattern,
} from '../utils/exerciseAlternatives';
import {
  buildPreWorkoutCoachBriefing,
  evaluateCompletedSetWithCoach,
} from '../utils/coachContextEngine';
import {
  loadCoachVoiceMode,
  saveCoachVoiceMode,
  speakProactiveCoachMessage,
} from '../utils/coachVoiceEngine';

interface ActiveWorkoutViewProps {
  activeSession: ActiveWorkoutSession | null;
  routines: Routine[];
  prs: Record<string, PersonalRecord>;
  history?: CompletedWorkout[];
  activeProfile?: Profile;
  restTimer: RestTimerState;
  restCompleteNotice?: RestCompleteNotice | null;
  onDismissRestCompleteNotice?: () => void;
  isHistorySyncing?: boolean;
  historySyncError?: string | null;
  workoutSyncStatus?: WorkoutSyncStatus;
  workoutSyncError?: string | null;
  onRetryWorkoutSync?: () => Promise<{ success: boolean; message: string }>;
  isOnline?: boolean;
  isOfflineSession?: boolean;
  pendingSyncCount?: number;
  onStartWorkout: (routine: Routine) => void;
  onStartFreeWorkout: (customTitle?: string, initialExercises?: Exercise[]) => void;
  onAddExerciseToSession: (exercise: Exercise) => void;
  onRemoveExerciseFromSession: (exerciseId: string) => void;
  onAddWarmupSets: (exerciseId: string, baseWeight?: number) => void;
  onStartRestTimer: (seconds: number, exerciseName?: string, nextSetNumber?: number) => void;
  onStopRestTimer?: () => void;
  onPauseRestTimer?: () => void;
  onResumeRestTimer?: () => void;
  onRestartRestTimer?: () => void;
  onAdjustRestTimer?: (deltaSeconds: number) => void;
  onUpdateExerciseRest?: (exerciseId: string, restSeconds: number) => void;
  onUpdateSet: (
    exerciseId: string,
    setIndex: number,
    field: 'weight' | 'reps' | 'rpe' | 'completed',
    value: unknown
  ) => void;
  onAddSet: (exerciseId: string) => void;
  onRemoveSet: (exerciseId: string, setIndex: number) => void;
  onToggleAlternative: (exerciseId: string) => void;
  onReplaceActiveExercise?: (
    exerciseId: string,
    replacement: {
      newName: string;
      libraryExerciseId?: string;
      targetMuscles?: string;
      equipment?: string;
      notes?: string;
      restSeconds?: number;
    }
  ) => void;
  onUpdateNotes: (exerciseId: string, notes: string) => void;
  onFinishWorkout: () => void;
  onCancelWorkout: () => void;
  onPauseWorkoutSession?: () => void;
  onResumeWorkoutSession?: () => void;
  onOpenExerciseModal: (exercise: Exercise) => void;
  onOpenPlateCalculator: (weight?: number) => void;
  onNavigateRoutines: () => void;
  onUpdateRoutine?: (routine: Routine) => void;
  onUpdateProfile?: (updates: Partial<Profile>) => void;
}

const MUSCLE_GROUPS = CATALOG_MUSCLE_FILTERS;

const EQUIPMENT_FILTERS = [
  'Todos',
  'Mancuernas',
  'Barras',
  'Poleas',
  'Máquinas',
  'Peso corporal',
] as const;

type EquipmentFilterType = (typeof EQUIPMENT_FILTERS)[number];

const REST_PRESET_SECONDS = [15, 45, 60, 90, 120, 150, 180];

const ORDERED_WEEKDAYS = [
  { name: 'Lunes', jsDay: 1 },
  { name: 'Martes', jsDay: 2 },
  { name: 'Miércoles', jsDay: 3 },
  { name: 'Jueves', jsDay: 4 },
  { name: 'Viernes', jsDay: 5 },
  { name: 'Sábado', jsDay: 6 },
  { name: 'Domingo', jsDay: 0 },
] as const;

interface PrepActivityItem {
  id: string;
  order: number;
  title: string;
  durationLabel: string;
  recommendedSeconds: number;
  description: string;
}

const PRE_WORKOUT_ACTIVITIES: PrepActivityItem[] = [
  {
    id: 'prep-1',
    order: 1,
    title: 'Movilidad Escapular y Columna Torácica',
    durationLabel: '90 seg',
    recommendedSeconds: 90,
    description:
      'Retracción y protracción escapular controlada + rotaciones torácicas para liberar la cintura escapular antes de cargar peso.',
  },
  {
    id: 'prep-2',
    order: 2,
    title: 'Activación de Manguito Rotador y Cápsula Articular',
    durationLabel: '90 seg',
    recommendedSeconds: 90,
    description:
      'Rotaciones externas e internas con banda o polea ligera y dislocaciones suaves para estabilizar la articulación glenohumeral.',
  },
  {
    id: 'prep-3',
    order: 3,
    title: 'Activación de Core y Bisagra de Cadera',
    durationLabel: '60 seg',
    recommendedSeconds: 60,
    description:
      'Presión intraabdominal (bracing), puente de glúteo isométrico y bisagra dinámica para proteger la zona lumbopélvica.',
  },
  {
    id: 'prep-4',
    order: 4,
    title: 'Movilidad Dinámica de Rodilla y Tobillo',
    durationLabel: '60 seg',
    recommendedSeconds: 60,
    description:
      'Dorsiflexión dinámica de tobillo y flexo-extensión articular controlada para optimizar la profundidad y alineación mecánica.',
  },
  {
    id: 'prep-5',
    order: 5,
    title: 'Series de Potenciación y Aproximación Progresiva',
    durationLabel: '120 seg',
    recommendedSeconds: 120,
    description:
      'Ejecuta 2 series de aproximación (50% × 10 reps y 75% × 5 reps) en el primer ejercicio compuesto sin llegar a la fatiga.',
  },
];

function normalizeTextSimple(val?: string): string {
  return (val || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function matchesEquipmentCategory(
  item: Pick<LibraryExercise, 'equipment' | 'allEquipment'> | string | undefined,
  filter: EquipmentFilterType
): boolean {
  if (typeof item === 'string' || item === undefined) {
    return matchesCatalogEquipment({ equipment: item }, filter);
  }
  return matchesCatalogEquipment(item, filter);
}

function resolveMovementPattern(name: string, muscleGroup?: string): string {
  return resolveBiomechPattern(name, muscleGroup);
}

function libraryItemToExercise(item: LibraryExercise): Exercise {
  const profile = buildTechniqueProProfile({
    id: `cat-${item.id}`,
    libraryExerciseId: item.id,
    name: item.name,
    targetMuscles: item.muscleGroup,
    equipment: item.equipment || 'Equipamiento Estándar',
    defaultVideoUrl: item.videoUrl || item.url,
    thumbnailUrl: item.thumbnailUrl || undefined,
  });

  return {
    id: `cat-${item.id}`,
    libraryExerciseId: item.id,
    name: item.name,
    targetMuscles: item.muscleGroup,
    defaultSets: 4,
    repRange: '8 - 12 reps',
    restSeconds: 90,
    restText: '90 seg de descanso',
    objective: `Hipertrofia y control biomecánico en ${item.muscleGroup.toLowerCase()}.`,
    defaultVideoUrl: item.videoUrl || item.url,
    thumbnailUrl: item.thumbnailUrl || undefined,
    secondaryThumbnailUrl: item.secondaryThumbnailUrl || undefined,
    equipment: item.equipment || 'Equipamiento Estándar',
    techniqueCues: profile.specificTips,
    techniquePro: profile,
    customTempo: profile.defaultTempo.notation,
  };
}

/**
 * Calcula una duración estimada fundamentada para una rutina en minutos:
 * Suma el tiempo bajo tensión y transición por serie (~50s por serie) más
 * los descansos programados reales de cada ejercicio.
 */
function calculateGroundedDurationMinutes(routine: Routine | null): number {
  if (!routine || !Array.isArray(routine.exercises) || routine.exercises.length === 0) {
    return 0;
  }
  let totalSeconds = 0;
  routine.exercises.forEach((ex) => {
    const sets = Math.max(1, Number(ex.defaultSets) || 3);
    const restSec = Math.max(30, Number(ex.restSeconds) || 90);
    // ~45s ejecución/repeticiones por serie + descansos programados + 50s transición de estación
    totalSeconds += sets * 45 + Math.max(0, sets - 1) * restSec + 50;
  });
  return Math.max(15, Math.round(totalSeconds / 60));
}

function getMondayOfCurrentWeek(): Date {
  const todayKey = getChileLocalDateKey(new Date());
  const idx = getChileWeekdayIndex(todayKey);
  const [y, m, d] = todayKey.split('-').map(Number);
  const mondayUtc = new Date(Date.UTC(y || 2026, (m || 11) - 1, d || 19, 12, 0, 0));
  mondayUtc.setUTCDate(mondayUtc.getUTCDate() + (idx === 0 ? -6 : 1 - idx));
  return mondayUtc;
}

function formatPreviousCompact(rawPrev?: string): string {
  if (!rawPrev || !rawPrev.trim()) return '—';
  const trimmed = rawPrev.trim();
  if (/aprox/i.test(trimmed)) return trimmed.replace(/\s*Aprox\.?/i, '');
  const match = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:kg)?\s*[×x]\s*(\d+)/i);
  if (match) {
    return `${match[1]}×${match[2]}`;
  }
  return trimmed;
}

function parsePreviousPair(rawPrev?: string): { weight: number; reps: number } | null {
  if (!rawPrev) return null;
  const match = rawPrev.match(/(\d+(?:\.\d+)?)\s*(?:kg)?\s*[×x]\s*(\d+)/i);
  if (!match) return null;
  const weight = Number(match[1]);
  const reps = Number(match[2]);
  if (Number.isNaN(weight) || Number.isNaN(reps) || reps <= 0) return null;
  return { weight, reps };
}

function abbreviateRoutineHeadline(
  title: string,
  tagline?: string,
  exercises?: ActiveWorkoutSession['exercises']
): { shortTitle: string; secondaryDesc: string } {
  const cleanTitle = (title || 'ENTRENAMIENTO ACTIVO').trim();
  let shortTitle = cleanTitle;
  let extractedSubtitle = '';

  const sepMatch = cleanTitle.match(/^(.{3,24}?)\s*(?::|—|-|\||·)\s*(.+)$/);
  if (sepMatch) {
    shortTitle = sepMatch[1].trim();
    extractedSubtitle = sepMatch[2].trim();
  } else {
    const parenMatch = cleanTitle.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (parenMatch) {
      shortTitle = parenMatch[1].trim();
      extractedSubtitle = parenMatch[2].trim();
    } else if (cleanTitle.length > 26) {
      const words = cleanTitle.split(/\s+/);
      shortTitle = words.slice(0, 3).join(' ');
    }
  }

  const muscleDesc =
    exercises && exercises.length > 0
      ? Array.from(new Set(exercises.map((e) => e.targetMuscles).filter(Boolean)))
          .slice(0, 3)
          .join(' · ')
      : '';

  const secondaryDesc =
    (tagline && tagline.trim()) ||
    extractedSubtitle ||
    muscleDesc ||
    'Sesión de fuerza e hipertrofia';

  return { shortTitle, secondaryDesc };
}

function isValidSetValues(weight: number | '' | undefined, reps: number | '' | undefined): boolean {
  if (weight === '' || weight === undefined || weight === null) return false;
  if (reps === '' || reps === undefined || reps === null) return false;
  const w = Number(weight);
  const r = Number(reps);
  return !Number.isNaN(w) && w >= 0 && !Number.isNaN(r) && r > 0;
}

export const ActiveWorkoutView: React.FC<ActiveWorkoutViewProps> = ({
  activeSession,
  routines,
  prs,
  history = [],
  activeProfile,
  restTimer,
  restCompleteNotice = null,
  onDismissRestCompleteNotice,
  isHistorySyncing = false,
  historySyncError = null,
  workoutSyncStatus = 'saved_local',
  workoutSyncError = null,
  onRetryWorkoutSync,
  isOnline = true,
  isOfflineSession = false,
  pendingSyncCount = 0,
  onStartWorkout,
  onStartFreeWorkout,
  onAddExerciseToSession,
  onRemoveExerciseFromSession,
  onAddWarmupSets,
  onStartRestTimer,
  onStopRestTimer,
  onPauseRestTimer,
  onResumeRestTimer,
  onRestartRestTimer,
  onAdjustRestTimer,
  onUpdateExerciseRest,
  onUpdateSet,
  onAddSet,
  onRemoveSet,
  onToggleAlternative,
  onReplaceActiveExercise,
  onUpdateNotes,
  onFinishWorkout,
  onCancelWorkout,
  onPauseWorkoutSession,
  onResumeWorkoutSession,
  onOpenExerciseModal,
  onOpenPlateCalculator,
  onNavigateRoutines,
  onUpdateRoutine,
  onUpdateProfile,
}) => {
  const initialSessionKey = activeSession?.sessionId || (activeSession ? String(activeSession.startTime) : undefined);
  const initialSavedUi = initialSessionKey ? loadActiveSessionUiState(initialSessionKey) : null;
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    computeActiveSessionElapsedMs(activeSession) > 0
      ? Math.floor(computeActiveSessionElapsedMs(activeSession) / 1000)
      : 0
  );
  const [liveRestRemaining, setLiveRestRemaining] = useState<number>(restTimer.remainingSeconds);
  const [androidRestCaps, setAndroidRestCaps] = useState<NativeRestTimerCapabilities | null>(null);

  useEffect(() => {
    if (!isCapacitorAndroidRuntime() || typeof window === 'undefined') return;
    const syncAndroidCaps = () => {
      void getNativeRestTimerCapabilities()
        .then((caps) => {
          if (caps) setAndroidRestCaps(caps);
        })
        .catch(() => {});
    };
    syncAndroidCaps();
    window.addEventListener('focus', syncAndroidCaps);
    window.addEventListener(NATIVE_REST_PERMISSION_NEEDED_EVENT, syncAndroidCaps);
    return () => {
      window.removeEventListener('focus', syncAndroidCaps);
      window.removeEventListener(NATIVE_REST_PERMISSION_NEEDED_EVENT, syncAndroidCaps);
    };
  }, []);

  // Navigation & view mode inside active session (focus = protagonist exercise card)
  const [viewMode, setViewMode] = useState<'focus' | 'list'>(() => initialSavedUi?.viewMode || 'focus');
  const [focusedExerciseIndex, setFocusedExerciseIndex] = useState(() => {
    if (initialSavedUi && activeSession && activeSession.exercises.length > 0) {
      return Math.min(Math.max(0, initialSavedUi.focusedExerciseIndex), activeSession.exercises.length - 1);
    }
    if (activeSession && activeSession.exercises.length > 0) {
      const idx = activeSession.exercises.findIndex((ex) => ex.sets.some((s) => !s.completed));
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });
  const [autoRestEnabled, setAutoRestEnabled] = useState<boolean>(() =>
    initialSavedUi ? initialSavedUi.autoRestEnabled : true
  );
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [isExerciseDrawerOpen, setIsExerciseDrawerOpen] = useState(false);
  const [expandedHistoryByEx, setExpandedHistoryByEx] = useState<Record<string, boolean>>({});
  const [expandedToolsByEx, setExpandedToolsByEx] = useState<Record<string, boolean>>({});
  const [expandedRestByEx, setExpandedRestByEx] = useState<Record<string, boolean>>({});
  const [selectedSetIndexMap, setSelectedSetIndexMap] = useState<Record<string, number>>(
    () => initialSavedUi?.selectedSetIndexMap || {}
  );
  const [setValidationError, setSetValidationError] = useState<{
    exerciseId: string;
    setIndex: number;
    message: string;
  } | null>(null);
  const isCompletingSetRef = useRef(false);
  const lastSessionStartRef = useRef<number | null>(
    activeSession ? activeSession.startTime : null
  );

  // Confirmation modals (Fase 8: never use window.confirm)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showFinishIncompleteConfirm, setShowFinishIncompleteConfirm] = useState(false);
  const isFinishingRef = useRef(false);

  // Exercise Picker Modal (for adding mid-session or building free session)
  const [isExercisePickerOpen, setIsExercisePickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMuscleFilter, setSelectedMuscleFilter] = useState('Todos');

  // Express / Free Workout Builder state (when no active session)
  const [freeWorkoutTitle, setFreeWorkoutTitle] = useState('Sesión Libre de Fuerza');
  const [freeDraftExercises, setFreeDraftExercises] = useState<Exercise[]>([]);

  // Determine today's weekday name for default routine selection
  const todayWeekdayName = useMemo(() => {
    const chileDay = getChileWeekdayName(new Date());
    return chileDay !== 'Entrenamiento' ? chileDay : 'Lunes';
  }, []);

  const defaultTodayRoutine = useMemo(() => {
    return (
      routines.find((r) => isSameWeekday(r.dayName || r.title, todayWeekdayName)) ||
      routines[0] ||
      null
    );
  }, [routines, todayWeekdayName]);

  const [selectedPreDayId, setSelectedPreDayId] = useState<string>('');

  // Pre-Workout Preparation (Collapsible Accordion + Checkboxes + Timer)
  const [isPrepExpanded, setIsPrepExpanded] = useState<boolean>(false);
  const [completedPrepIds, setCompletedPrepIds] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('lazcakon_prep_completed_today');
      if (saved) {
        const parsed = JSON.parse(saved);
        const todayKey = formatDateKeyYYYYMMDD(new Date());
        if (parsed.dateKey === todayKey && parsed.map) {
          return parsed.map;
        }
      }
    } catch {}
    return {};
  });
  const [prepTimerTotalSec, setPrepTimerTotalSec] = useState<number>(90);
  const [prepTimerRemainingSec, setPrepTimerRemainingSec] = useState<number>(90);
  const [prepTimerRunning, setPrepTimerRunning] = useState<boolean>(false);

  useEffect(() => {
    if (!prepTimerRunning) return;
    const id = window.setInterval(() => {
      setPrepTimerRemainingSec((prev) => {
        if (prev <= 1) {
          setPrepTimerRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [prepTimerRunning]);

  const togglePrepActivity = (id: string) => {
    setCompletedPrepIds((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(
          'lazcakon_prep_completed_today',
          JSON.stringify({
            dateKey: formatDateKeyYYYYMMDD(new Date()),
            map: next,
          })
        );
      } catch {}
      return next;
    });
  };

  const completeAllPrepActivities = () => {
    const allMap: Record<string, boolean> = {};
    PRE_WORKOUT_ACTIVITIES.forEach((item) => {
      allMap[item.id] = true;
    });
    setCompletedPrepIds(allMap);
    try {
      localStorage.setItem(
        'lazcakon_prep_completed_today',
        JSON.stringify({
          dateKey: formatDateKeyYYYYMMDD(new Date()),
          map: allMap,
        })
      );
    } catch {}
    setIsPrepExpanded(false);
  };

  // Overload & Fatigue notification banner
  const [overloadNotice, setOverloadNotice] = useState<{
    exerciseName: string;
    message: string;
    type: 'overload' | 'progress' | 'fatigue';
  } | null>(null);

  // Coach Intelligence Pro 7.0 State (Voice Mode, Pre-Workout Briefing & Live Set Evaluations)
  const [coachVoiceMode, setCoachVoiceMode] = useState<CoachVoiceMode>(() =>
    activeProfile?.coachVoiceMode || loadCoachVoiceMode()
  );
  const [isPreCoachLoadsExpanded, setIsPreCoachLoadsExpanded] = useState<boolean>(false);
  const [liveCoachEvaluationsByEx, setLiveCoachEvaluationsByEx] = useState<
    Record<string, LiveSetCoachEvaluation>
  >({});
  const [resolvedCoachEvalStatus, setResolvedCoachEvalStatus] = useState<
    Record<string, 'accepted' | 'rejected'>
  >({});
  const spokenCoachEventKeysRef = useRef<Set<string>>(new Set());

  const handleSelectCoachVoiceMode = (nextMode: CoachVoiceMode) => {
    setCoachVoiceMode(nextMode);
    saveCoachVoiceMode(nextMode);
    if (onUpdateProfile) {
      onUpdateProfile({ coachVoiceMode: nextMode });
    }
  };

  // Machine Vision Scanner Modal state
  const [exerciseToScan, setExerciseToScan] = useState<{
    id: string;
    name: string;
    targetMuscles: string;
  } | null>(null);

  // Enhanced Manual Substitution Modal state (Fase 7)
  const [manualSwapTarget, setManualSwapTarget] = useState<{
    id: string;
    name: string;
    originalName: string;
    targetMuscles: string;
    equipment?: string;
  } | null>(null);
  const [manualSwapSearch, setManualSwapSearch] = useState('');
  const [swapMuscleFilter, setSwapMuscleFilter] = useState<string>('Compatible');
  const [swapEquipmentFilter, setSwapEquipmentFilter] = useState<EquipmentFilterType>('Todos');
  const [swapReason, setSwapReason] = useState<'occupied' | 'no_equipment' | 'pain_restriction' | 'other'>('occupied');
  const [swapScope, setSwapScope] = useState<'session' | 'permanent'>('session');
  const [replacementWeight, setReplacementWeight] = useState<number | ''>('');

  useEffect(() => {
    if (!overloadNotice) return;
    const t = window.setTimeout(() => setOverloadNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [overloadNotice]);

  useEffect(() => {
    if (!activeSession) {
      setElapsedSeconds(0);
      setLiveCoachEvaluationsByEx({});
      setResolvedCoachEvalStatus({});
      spokenCoachEventKeysRef.current.clear();
      isFinishingRef.current = false;
      return;
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.floor(computeActiveSessionElapsedMs(activeSession) / 1000));
    };
    updateElapsed();

    if (activeSession.isPaused) {
      return;
    }

    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [activeSession]);

  // Keep integrated rest display synchronized with real wall-clock targetEndTime
  useEffect(() => {
    if (!restTimer.active) {
      setLiveRestRemaining(0);
      return;
    }
    if (restTimer.paused) {
      setLiveRestRemaining(restTimer.remainingSeconds);
      return;
    }
    const syncRemaining = () => {
      if (restTimer.targetEndTime) {
        setLiveRestRemaining(Math.max(0, Math.ceil((restTimer.targetEndTime - Date.now()) / 1000)));
      } else {
        setLiveRestRemaining(restTimer.remainingSeconds);
      }
    };
    syncRemaining();
    const interval = window.setInterval(syncRemaining, 250);
    window.addEventListener('focus', syncRemaining);
    document.addEventListener('visibilitychange', syncRemaining);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', syncRemaining);
      document.removeEventListener('visibilitychange', syncRemaining);
    };
  }, [restTimer.active, restTimer.paused, restTimer.targetEndTime, restTimer.remainingSeconds]);

  // Restore/initialize focused exercise index & UI mode when starting or switching back to active session
  useEffect(() => {
    if (!activeSession) {
      lastSessionStartRef.current = null;
      setIsHeaderMenuOpen(false);
      setIsExerciseDrawerOpen(false);
      setSetValidationError(null);
      return;
    }

    const sessionKey = activeSession.sessionId || String(activeSession.startTime);
    if (lastSessionStartRef.current !== activeSession.startTime) {
      lastSessionStartRef.current = activeSession.startTime;
      const savedUi = loadActiveSessionUiState(sessionKey);
      if (savedUi) {
        const clampedIdx =
          activeSession.exercises.length > 0
            ? Math.min(Math.max(0, savedUi.focusedExerciseIndex), activeSession.exercises.length - 1)
            : 0;
        setFocusedExerciseIndex(clampedIdx);
        setViewMode(savedUi.viewMode);
        setAutoRestEnabled(savedUi.autoRestEnabled);
        setSelectedSetIndexMap(savedUi.selectedSetIndexMap);
      } else {
        const firstIncompleteIdx = activeSession.exercises.findIndex((ex) =>
          ex.sets.some((s) => !s.completed)
        );
        setFocusedExerciseIndex(firstIncompleteIdx >= 0 ? firstIncompleteIdx : 0);
        setViewMode('focus');
      }
    } else if (focusedExerciseIndex >= activeSession.exercises.length) {
      setFocusedExerciseIndex(Math.max(0, activeSession.exercises.length - 1));
    }
  }, [activeSession, focusedExerciseIndex]);

  // Persist active workout UI focus/viewMode/set selection across tab switches & restarts
  useEffect(() => {
    if (!activeSession) return;
    const sessionKey = activeSession.sessionId || String(activeSession.startTime);
    saveActiveSessionUiState(sessionKey, {
      focusedExerciseIndex,
      viewMode,
      autoRestEnabled,
      selectedSetIndexMap,
    });
  }, [activeSession, focusedExerciseIndex, viewMode, autoRestEnabled, selectedSetIndexMap]);

  const filteredCatalog = useMemo(() => {
    return filterExerciseCatalog(EXERCISE_LIBRARY, {
      muscle: selectedMuscleFilter,
      searchQuery,
    });
  }, [searchQuery, selectedMuscleFilter]);

  // Compatible Exercise Substitutions List (Fase 7) - uses centralized catalog & normalized muscle matching
  const compatibleSwapList = useMemo(() => {
    if (!manualSwapTarget) return [];
    const targetPattern = resolveMovementPattern(
      manualSwapTarget.name,
      manualSwapTarget.targetMuscles
    );

    const searchFiltered = filterExerciseCatalog(EXERCISE_LIBRARY, {
      muscle:
        swapMuscleFilter !== 'Todos' && swapMuscleFilter !== 'Compatible'
          ? swapMuscleFilter
          : 'Todos',
      searchQuery: manualSwapSearch,
      equipment: swapEquipmentFilter,
    });

    const scored = searchFiltered
      .filter((item) => {
        if (normalizeExerciseName(item.name) === normalizeExerciseName(manualSwapTarget.name)) {
          return false;
        }
        if (swapMuscleFilter === 'Compatible') {
          if (!exerciseMatchesCompatibleMuscles(manualSwapTarget.targetMuscles, item) && !manualSwapSearch.trim()) {
            return false;
          }
        } else if (swapMuscleFilter !== 'Todos') {
          if (!exerciseMatchesMuscleFilter(item, swapMuscleFilter)) {
            return false;
          }
        }
        return true;
      })
      .map((item) => {
        const itemPattern = resolveMovementPattern(item.name, item.muscleGroup);
        const isSamePattern = itemPattern === targetPattern;
        return {
          item,
          itemPattern,
          isSamePattern,
        };
      });

    scored.sort((a, b) => Number(b.isSamePattern) - Number(a.isSamePattern));
    return scored.slice(0, 60);
  }, [manualSwapTarget, manualSwapSearch, swapMuscleFilter, swapEquipmentFilter]);

  // Evaluate which routines were completed during the current week (Monday -> Sunday in America/Santiago)
  const weeklyCompliance = useMemo(
    () =>
      evaluateWeeklyRoutineCompliance(history, routines, new Date(), {
        profileId: activeProfile?.id,
      }),
    [history, routines, activeProfile?.id]
  );

  const isRoutineCompletedThisWeek = (routine: Routine | null | undefined): boolean => {
    if (!routine) return false;
    if (weeklyCompliance.completedRoutineIds.has(routine.id)) return true;
    const schedDay = resolveCanonicalWeekdayStrict(routine.dayName || routine.title);
    if (schedDay && weeklyCompliance.completedByScheduledDay[schedDay]?.isCompleted) {
      // Si existen múltiples rutinas para el mismo día, priorizar coincidencia por ID si hay alguna registrada con ID explícito
      const entry = weeklyCompliance.completedByScheduledDay[schedDay];
      if (entry.routineIds.length === 0) return true;
      const sameDayRoutines = routines.filter(
        (r) => resolveCanonicalWeekdayStrict(r.dayName || r.title) === schedDay
      );
      if (sameDayRoutines.length <= 1) return true;
      return entry.routineIds.includes(routine.id);
    }
    return false;
  };

  const formatDuration = (sec: number) => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${mins < 10 ? '0' : ''}${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  // ============================================================================
  // PANTALLA PRINCIPAL DE ENTRENAR (SIN SESIÓN ACTIVA)
  // Orden obligatorio:
  // 1. Encabezado compacto ENTRENAMIENTO ELITE.
  // 2. Tarjeta protagonista del entrenamiento programado.
  // 3. Botón principal COMENZAR ENTRENAMIENTO.
  // 4. Lista de ejercicios programados.
  // 5. Preparación pre-entreno (compacto y desplegable).
  // 6. Entrenamiento libre (alto contraste).
  // 7. Selector de otras rutinas semanales.
  // ============================================================================
  if (!activeSession) {
    const activePreRoutine =
      routines.find((r) => r.id === selectedPreDayId) || defaultTodayRoutine;

    const totalPlannedSets = activePreRoutine
      ? activePreRoutine.exercises.reduce((acc, ex) => acc + (Number(ex.defaultSets) || 3), 0)
      : 0;

    const estimatedMinutes = calculateGroundedDurationMinutes(activePreRoutine);

    const completedPrepCount = PRE_WORKOUT_ACTIVITIES.filter(
      (item) => completedPrepIds[item.id]
    ).length;
    const prepProgressPct = Math.round(
      (completedPrepCount / PRE_WORKOUT_ACTIVITIES.length) * 100
    );

    const isSelectedRoutineToday =
      activePreRoutine &&
      isSameWeekday(activePreRoutine.dayName || activePreRoutine.title, todayWeekdayName);

    const preWorkoutBriefing = buildPreWorkoutCoachBriefing({
      routine: activePreRoutine,
      history,
      routines,
      activeProfile,
    });

    return (
      <div className="space-y-4 pb-36 font-['Plus_Jakarta_Sans',sans-serif] text-[#F5F5F5]">
        {/* 1. ENCABEZADO COMPACTO ENTRENAMIENTO ELITE */}
        <header className="flex items-center justify-between gap-3 py-2 px-3 sm:px-4 bg-[#171717] border border-[#303030] rounded-2xl shadow-md">
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-accent-text leading-none mb-0.5">
              LAZCAKONG GYM · ELITE PERFORMANCE
            </div>
            <h1 className="text-base sm:text-lg font-black text-[#F5F5F5] tracking-tight uppercase truncate">
              ENTRENAMIENTO ELITE
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onOpenPlateCalculator(100)}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#090909] hover:bg-[#222222] border border-[#303030] text-[#F5F5F5] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer active:scale-95"
              title="Calculadora de discos"
            >
              <Disc className="w-4 h-4 text-accent-text" />
              <span className="hidden xs:inline">Discos</span>
            </button>
            <button
              type="button"
              onClick={onNavigateRoutines}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#090909] hover:bg-[#222222] border border-[#303030] text-[#F5F5F5] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer active:scale-95"
            >
              <Dumbbell className="w-4 h-4 text-accent-text" />
              <span>Rutinas</span>
            </button>
          </div>
        </header>

        {(workoutSyncStatus === 'pending_sync' || workoutSyncStatus === 'error' || !isOnline || isOfflineSession || pendingSyncCount > 0) && (() => {
          const syncDisplay = resolveWorkoutSyncDisplay(workoutSyncStatus, workoutSyncError);
          const offlineDetail =
            !isOnline || isOfflineSession
              ? `Modo offline activo · Tus entrenamientos se guardan localmente${pendingSyncCount > 0 ? ` (${pendingSyncCount} pendiente${pendingSyncCount === 1 ? '' : 's'} de nube)` : ''}.`
              : syncDisplay.detail;
          return (
            <div
              data-testid="workout-sync-banner"
              className={`rounded-2xl px-3.5 py-2.5 border flex items-center justify-between gap-2 text-xs ${
                syncDisplay.status === 'error' && isOnline
                  ? 'bg-[#171717] border-[#EF4444]/60 text-[#EF4444]'
                  : 'bg-[#171717] border-amber-500/40 text-amber-300'
              }`}
            >
              <span className="font-bold truncate">{offlineDetail}</span>
              {(syncDisplay.canRetry || pendingSyncCount > 0) && isOnline && onRetryWorkoutSync && (
                <button
                  type="button"
                  onClick={() => {
                    void onRetryWorkoutSync();
                  }}
                  className="shrink-0 min-h-[32px] px-3 py-1 rounded-lg bg-[#090909] border border-current font-black text-[11px] uppercase tracking-wider cursor-pointer"
                >
                  {syncDisplay.status === 'error' ? 'Error: reintentar' : 'Sincronizar'}
                </button>
              )}
            </div>
          );
        })()}

        {/* 2. TARJETA PROTAGONISTA DE RUTINA + 3. BOTÓN COMENZAR ENTRENAMIENTO */}
        {activePreRoutine ? (
          <section className="rounded-2xl sm:rounded-3xl bg-[#171717] border border-[#303030] p-4 sm:p-5 shadow-[0_12px_36px_rgba(0,0,0,0.55)] space-y-3">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-accent-text uppercase tracking-wider">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>
                    {activePreRoutine.dayName}
                    {isSelectedRoutineToday ? ' · RUTINA DEL DÍA' : ' · RUTINA SELECCIONADA'}
                  </span>
                </div>

                {isRoutineCompletedThisWeek(activePreRoutine) && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-accent-text">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Completada esta semana</span>
                  </span>
                )}
              </div>

              {/* Nombre de rutina permitido en múltiples líneas sin desbordamiento */}
              <h2 className="text-xl sm:text-2xl font-black text-[#F5F5F5] tracking-tight leading-snug uppercase break-words">
                {activePreRoutine.title}
              </h2>

              <p className="text-xs text-zinc-300 leading-snug">
                <span className="text-accent-text font-semibold">Enfoque muscular: </span>
                {Array.from(
                  new Set(activePreRoutine.exercises.map((e) => e.targetMuscles).filter(Boolean))
                ).join(', ') || activePreRoutine.tagline || 'Fuerza y Rendimiento'}
              </p>
            </div>

            {/* Métricas clave */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-[#090909] border border-[#303030] py-2 px-2 text-center">
                <span className="block text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Ejercicios
                </span>
                <span className="block text-base sm:text-lg font-black font-mono tabular-nums text-[#F5F5F5] leading-snug">
                  {activePreRoutine.exercises.length}
                </span>
              </div>

              <div className="rounded-xl bg-[#090909] border border-[#303030] py-2 px-2 text-center">
                <span className="block text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Series
                </span>
                <span className="block text-base sm:text-lg font-black font-mono tabular-nums text-accent-text leading-snug">
                  {totalPlannedSets}
                </span>
              </div>

              <div className="rounded-xl bg-[#090909] border border-[#303030] py-2 px-2 text-center">
                <span className="block text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Duración Est.
                </span>
                <span className="block text-base sm:text-lg font-black font-mono tabular-nums text-[#F5F5F5] leading-snug">
                  {estimatedMinutes > 0 ? `~${estimatedMinutes} min` : '—'}
                </span>
              </div>
            </div>

            {/* 3. BOTÓN PRINCIPAL COMENZAR ENTRENAMIENTO */}
            <button
              type="button"
              onClick={() => onStartWorkout(activePreRoutine)}
              className="w-full min-h-[50px] py-3.5 px-5 rounded-xl sm:rounded-2xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_6px_22px_var(--accent-glow)] active:scale-[0.99] transition-all cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>COMENZAR ENTRENAMIENTO</span>
            </button>
          </section>
        ) : (
          <section className="rounded-2xl sm:rounded-3xl bg-[#171717] border border-[#303030] p-5 text-center space-y-3">
            <Dumbbell className="w-7 h-7 text-accent-text mx-auto" />
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-black text-[#F5F5F5] uppercase">
                Sin rutina programada
              </h2>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Crea o importa tu planificación semanal en la pestaña Rutinas, o inicia una sesión libre más abajo.
              </p>
            </div>
            <button
              type="button"
              onClick={onNavigateRoutines}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs uppercase tracking-wider cursor-pointer"
            >
              Configurar Rutinas
            </button>
          </section>
        )}

        {/* 3.5. COACH INTELLIGENCE PRO 7.0 — INTELIGENCIA ANTES DEL ENTRENAMIENTO */}
        <section
          data-testid="coach-pre-workout-briefing"
          className="rounded-2xl sm:rounded-3xl bg-[#171717] border border-accent/45 p-3.5 sm:p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#090909] border border-accent/60 text-accent-text flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="block text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-accent-text">
                  COACH INTELLIGENCE PRO · PREENTRENAMIENTO
                </span>
                <h2 className="text-xs sm:text-sm font-black text-[#F5F5F5] leading-snug truncate">
                  {preWorkoutBriefing.intensityAdjustment.headline}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="px-2 py-0.5 rounded-lg bg-[#090909] border border-accent/50 text-accent-text font-mono font-black text-[11px] tabular-nums">
                Recuperación {preWorkoutBriefing.readinessScorePct}%
              </span>
            </div>
          </div>

          <p className="text-xs text-zinc-300 leading-snug">
            {preWorkoutBriefing.intensityAdjustment.rationale}
          </p>

          {/* Músculos prioritarios y estado de recuperación */}
          {preWorkoutBriefing.priorityMuscles.length > 0 && (
            <div className="space-y-1.5">
              <span className="block text-[10px] font-black uppercase tracking-wider text-zinc-400">
                Músculos Prioritarios Hoy
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {preWorkoutBriefing.priorityMuscles.map((pm) => (
                  <div
                    key={pm.muscleName}
                    className="rounded-xl bg-[#090909] border border-[#303030] p-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-black text-[#F5F5F5] block truncate">
                        {pm.muscleName}
                      </span>
                      <span className="text-[10px] text-zinc-400 block truncate">
                        {pm.rationale}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-md font-mono font-black text-[10px] shrink-0 border ${
                        pm.status === 'ready'
                          ? 'bg-accent/15 border-accent/50 text-accent-text'
                          : pm.status === 'recovering'
                          ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                          : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                      }`}
                    >
                      {pm.remainingHours > 0 ? `${pm.remainingHours} h` : '100% Listo'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selector de Modo de Voz del Coach + Desplegable de Cargas Iniciales */}
          <div className="pt-2 border-t border-[#303030] flex flex-wrap items-center justify-between gap-2">
            <div
              data-testid="coach-voice-mode-selector"
              className="flex items-center gap-1 flex-wrap"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mr-1">
                Voz Coach:
              </span>
              {(
                [
                  { mode: 'silent', label: 'Silencioso' },
                  { mode: 'important_only', label: 'Importantes' },
                  { mode: 'full_coach', label: 'Coach completo' },
                ] as const
              ).map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  data-testid={`coach-voice-mode-btn-${mode}`}
                  onClick={() => handleSelectCoachVoiceMode(mode)}
                  className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                    coachVoiceMode === mode
                      ? 'bg-accent text-accent-contrast border-accent font-black'
                      : 'bg-[#090909] text-zinc-300 border-[#303030] hover:text-[#F5F5F5]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {preWorkoutBriefing.initialLoadRecommendations.length > 0 && (
              <button
                type="button"
                onClick={() => setIsPreCoachLoadsExpanded((prev) => !prev)}
                className="min-h-[32px] px-2.5 py-1 rounded-lg bg-[#090909] border border-[#303030] hover:border-accent/60 text-[11px] font-bold text-accent-text flex items-center gap-1 cursor-pointer"
              >
                <span>
                  Cargas iniciales ({preWorkoutBriefing.initialLoadRecommendations.length})
                </span>
                {isPreCoachLoadsExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>

          {isPreCoachLoadsExpanded &&
            preWorkoutBriefing.initialLoadRecommendations.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {preWorkoutBriefing.initialLoadRecommendations.map((item) => (
                  <div
                    key={item.exerciseId}
                    className="rounded-xl bg-[#090909] border border-[#303030] p-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black text-[#F5F5F5] truncate">
                        {item.exerciseName}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#171717] border border-accent/40 text-accent-text font-mono font-bold text-[10px] shrink-0">
                        {item.suggestedWeightKg
                          ? `${item.suggestedWeightKg} kg × ${item.suggestedReps ?? item.repRange}`
                          : item.badgeText}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-snug">{item.rationale}</p>
                    <p className="text-[10px] text-zinc-400 leading-snug">
                      <strong className="text-accent-text">Technique Pro:</strong>{' '}
                      {item.techniqueFocus}
                    </p>
                  </div>
                ))}
              </div>
            )}
        </section>

        {/* 4. TARJETAS DE EJERCICIOS PROGRAMADOS (Nombre destacado sobre categoría, miniatura específica y áreas táctiles >=44px) */}
        {activePreRoutine && activePreRoutine.exercises.length > 0 && (
          <section className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <div>
                <span className="block text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-accent-text">
                  ESTRUCTURA DE LA SESIÓN
                </span>
                <h2 className="text-sm sm:text-base font-black text-[#F5F5F5] uppercase">
                  Ejercicios Programados ({activePreRoutine.exercises.length})
                </h2>
              </div>
              <span className="text-xs font-mono text-zinc-400 tabular-nums">
                {totalPlannedSets} series
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {activePreRoutine.exercises.map((ex, idx) => {
                const libMatch = resolveLibraryExercise(ex);
                const isRdl = isRdlBarbellExercise(ex.name);
                const isBulgarian = isBulgarianDumbbellExercise(ex.name);
                let safeSec = ex.restSeconds || 90;
                if (safeSec === 1890) safeSec = 90;
                if (safeSec === 1950) safeSec = 150;
                const restSeconds = isRdl ? 150 : isBulgarian ? 90 : safeSec;
                const restDisplay = formatDetailedRest(restSeconds);
                const equipmentLabel = ex.equipment || libMatch?.equipment || 'Equipamiento Estándar';

                return (
                  <article
                    key={`${ex.id}-${idx}`}
                    className="rounded-xl sm:rounded-2xl bg-[#171717] border border-[#303030] p-3 sm:p-3.5 flex flex-col justify-between gap-2.5 hover:border-zinc-500 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="relative shrink-0">
                        <ExerciseThumbnail
                          src={ex.thumbnailUrl}
                          alt={ex.name}
                          muscleGroup={ex.targetMuscles}
                          exercise={ex}
                          onClick={() => onOpenExerciseModal(ex)}
                          showSpinner
                          allowRetry
                          className="w-12 h-12 rounded-xl border border-[#303030]"
                        />
                        <span className="absolute top-0.5 left-0.5 px-1 rounded bg-[#090909]/90 text-accent-text font-mono font-black text-[9px] pointer-events-none z-20">
                          {idx + 1}
                        </span>
                      </div>

                      {/* Destacar el nombre del ejercicio sobre su categoría muscular */}
                      <div className="min-w-0 flex-1">
                        <h3 className="text-xs sm:text-sm font-black text-[#F5F5F5] leading-snug line-clamp-2">
                          {ex.name}
                        </h3>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mt-0.5">
                          {ex.targetMuscles} <span className="text-zinc-600">·</span> {equipmentLabel}
                        </p>
                        {ex.alternative && (
                          <p className="text-[10px] text-zinc-400 leading-tight mt-0.5 line-clamp-1">
                            Alt: <span className="text-zinc-300">{ex.alternative}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Fila inferior: Series, repeticiones y descansos legibles + Botón Detalle >=44px */}
                    <div className="pt-2 border-t border-[#303030]/80 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums min-w-0">
                        <span className="font-bold text-[#F5F5F5] truncate">
                          {ex.defaultSets} series × {ex.repRange}
                        </span>
                        <span className="text-zinc-600 shrink-0" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-zinc-300 flex items-center gap-1 shrink-0">
                          <Clock className="w-3 h-3 text-accent-text" />
                          <span>{restDisplay}</span>
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => onOpenExerciseModal(ex)}
                        className="min-h-[44px] px-3 py-2 rounded-xl bg-[#090909] hover:bg-[#222222] border border-[#303030] text-xs font-bold text-[#F5F5F5] hover:text-accent-text flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                      >
                        <Info className="w-3.5 h-3.5 text-accent-text" />
                        <span>Detalle</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* 5. PREPARACIÓN PRE-ENTRENO */}
        <section className="rounded-2xl sm:rounded-3xl bg-[#171717] border border-[#303030] overflow-hidden">
          <button
            type="button"
            onClick={() => setIsPrepExpanded((prev) => !prev)}
            className="w-full p-3.5 sm:p-4 flex items-center justify-between gap-3 text-left hover:bg-[#1d1d1d] transition-colors cursor-pointer min-h-[52px]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#090909] border border-[#303030] flex items-center justify-center text-accent-text shrink-0">
                <Activity className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-accent-text">
                    PREPARACIÓN PRE-ENTRENO
                  </span>
                  <span className="text-[11px] font-mono font-bold text-zinc-300 tabular-nums">
                    · {completedPrepCount}/{PRE_WORKOUT_ACTIVITIES.length} ({prepProgressPct}%)
                  </span>
                </div>
                <h2 className="text-xs sm:text-sm font-black text-[#F5F5F5] leading-snug mt-0.5 truncate">
                  Activación Articular y Movilidad (~6 min)
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {prepTimerRunning && (
                <span className="px-2 py-0.5 rounded-md bg-[#090909] border border-accent text-accent-text font-mono font-black text-[11px] tabular-nums">
                  {formatDuration(prepTimerRemainingSec)}
                </span>
              )}
              <div className="w-8 h-8 rounded-lg bg-[#090909] border border-[#303030] flex items-center justify-center text-[#F5F5F5]">
                {isPrepExpanded ? (
                  <ChevronUp className="w-4 h-4 text-accent-text" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-zinc-400" />
                )}
              </div>
            </div>
          </button>

          <div className="w-full h-1 bg-[#090909]">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${prepProgressPct}%` }}
            />
          </div>

          {isPrepExpanded && (
            <div className="p-3.5 sm:p-4 border-t border-[#303030] space-y-3 bg-[#171717]">
              <div className="rounded-xl bg-[#090909] border border-[#303030] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#171717] border border-[#303030] flex items-center justify-center text-accent-text shrink-0">
                    <Timer className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-[9px] font-black uppercase tracking-wider text-zinc-400">
                      Cronómetro de Movilidad
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl font-black font-mono tabular-nums text-accent-text">
                        {formatDuration(prepTimerRemainingSec)}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400">
                        bloques de activación
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {[60, 90, 120, 180].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => {
                        setPrepTimerRunning(false);
                        setPrepTimerTotalSec(sec);
                        setPrepTimerRemainingSec(sec);
                      }}
                      className={`min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border transition-colors cursor-pointer ${
                        prepTimerTotalSec === sec
                          ? 'bg-accent text-accent-contrast border-accent font-black'
                          : 'bg-[#171717] text-zinc-300 border-[#303030] hover:text-[#F5F5F5]'
                      }`}
                    >
                      {sec}s
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => {
                      if (prepTimerRemainingSec === 0) {
                        setPrepTimerRemainingSec(prepTimerTotalSec);
                      }
                      setPrepTimerRunning((r) => !r);
                    }}
                    className="min-h-[36px] px-3 py-1 rounded-lg bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs uppercase flex items-center gap-1 cursor-pointer"
                  >
                    {prepTimerRunning ? (
                      <>
                        <Pause className="w-3 h-3 fill-current" />
                        <span>Pausar</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-current" />
                        <span>Iniciar</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPrepTimerRunning(false);
                      setPrepTimerRemainingSec(prepTimerTotalSec);
                    }}
                    className="min-h-[36px] w-9 rounded-lg bg-[#171717] border border-[#303030] text-zinc-300 hover:text-[#F5F5F5] flex items-center justify-center cursor-pointer"
                    title="Reiniciar cronómetro"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {PRE_WORKOUT_ACTIVITIES.map((item) => {
                  const isDone = Boolean(completedPrepIds[item.id]);
                  return (
                    <div
                      key={item.id}
                      onClick={() => togglePrepActivity(item.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          togglePrepActivity(item.id);
                        }
                      }}
                      className={`p-3 rounded-xl border flex items-start gap-3 transition-all cursor-pointer ${
                        isDone
                          ? 'bg-[#090909] border-accent/60'
                          : 'bg-[#090909] border-[#303030] hover:border-zinc-500'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePrepActivity(item.id);
                        }}
                        aria-label={`Marcar ${item.title}`}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border transition-colors cursor-pointer ${
                          isDone
                            ? 'bg-accent text-accent-contrast border-accent'
                            : 'bg-[#171717] text-zinc-400 border-[#303030]'
                        }`}
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                      </button>

                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <h3
                            className={`text-xs font-black leading-snug ${
                              isDone ? 'text-accent-text' : 'text-[#F5F5F5]'
                            }`}
                          >
                            {item.order}. {item.title}
                          </h3>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPrepTimerTotalSec(item.recommendedSeconds);
                              setPrepTimerRemainingSec(item.recommendedSeconds);
                              setPrepTimerRunning(true);
                            }}
                            className="min-h-[32px] px-2 py-0.5 rounded-md bg-[#171717] hover:bg-[#242424] border border-[#303030] text-[10px] font-mono font-bold text-accent-text flex items-center gap-1 cursor-pointer shrink-0"
                            title="Iniciar cronómetro para esta actividad"
                          >
                            <Timer className="w-3 h-3" />
                            <span>{item.durationLabel}</span>
                          </button>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-snug">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-1">
                <p className="text-[11px] text-zinc-400">
                  La preparación articular es opcional para optimizar tus rangos articulares.
                </p>
                <button
                  type="button"
                  onClick={completeAllPrepActivities}
                  className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                  <span>Completar y Continuar</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 6. ENTRENAMIENTO LIBRE (Mejorado en descubrimiento móvil sin duplicar módulos) */}
        <section className="rounded-2xl sm:rounded-3xl bg-[#171717] border border-accent/40 p-4 sm:p-5 space-y-3 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#090909] border border-accent flex items-center justify-center text-accent-text shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="block text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-accent-text">
                SESIÓN PERSONALIZADA
              </span>
              <h2 className="text-base sm:text-lg font-black text-[#F5F5F5] uppercase">
                Entrenamiento Libre
              </h2>
              <p className="text-xs text-zinc-300 mt-0.5 leading-snug">
                Diseña una sesión eligiendo ejercicios del catálogo o nómbrala y añade ejercicios antes de iniciar.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
            <div>
              <label className="block text-[10px] font-bold text-zinc-300 uppercase tracking-wider mb-1">
                Nombre de tu sesión libre
              </label>
              <input
                type="text"
                value={freeWorkoutTitle}
                onChange={(e) => setFreeWorkoutTitle(e.target.value)}
                placeholder="Ej. Empuje Pesado, Brazos & Hombros..."
                className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#090909] border border-[#303030] focus:border-accent focus:outline-none text-xs sm:text-sm font-semibold text-[#F5F5F5]"
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setIsExercisePickerOpen(true)}
                className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-[#090909] hover:bg-[#222222] border border-accent text-accent-text font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer active:scale-95"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>
                  {freeDraftExercises.length > 0
                    ? `Ejercicios Seleccionados (${freeDraftExercises.length})`
                    : 'Elegir del Catálogo'}
                </span>
              </button>
            </div>
          </div>

          {freeDraftExercises.length > 0 ? (
            <div className="space-y-1.5 pt-0.5">
              <span className="block text-[9px] font-black uppercase tracking-wider text-zinc-400">
                Ejercicios preparados ({freeDraftExercises.length}):
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
                {freeDraftExercises.map((ex, idx) => (
                  <div
                    key={`${ex.id}-${idx}`}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#090909] border border-[#303030]"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#F5F5F5] leading-snug truncate">
                        {idx + 1}. {ex.name}
                      </p>
                      <p className="text-[10px] text-accent-text font-semibold">
                        {ex.targetMuscles} · {ex.defaultSets} × {ex.repRange}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setFreeDraftExercises((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="w-8 h-8 rounded bg-[#171717] border border-[#303030] text-zinc-400 hover:text-[#EF4444] flex items-center justify-center transition-colors cursor-pointer shrink-0"
                      title="Quitar ejercicio"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-400 flex items-center gap-1.5 bg-[#090909] p-3 rounded-xl border border-[#303030]/60">
              <Info className="w-4 h-4 text-accent-text shrink-0" />
              <span>Selecciona al menos 1 ejercicio desde el catálogo para estructurar tu sesión libre antes de comenzar.</span>
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              if (freeDraftExercises.length === 0) {
                setIsExercisePickerOpen(true);
              } else {
                onStartFreeWorkout(
                  freeWorkoutTitle.trim() || 'Sesión Libre de Fuerza',
                  freeDraftExercises
                );
              }
            }}
            className="w-full min-h-[48px] py-3 px-4 rounded-xl sm:rounded-2xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_4px_18px_var(--accent-glow)] active:scale-[0.99] transition-all cursor-pointer"
          >
            {freeDraftExercises.length > 0 ? (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>INICIAR ENTRENAMIENTO LIBRE ({freeDraftExercises.length} EJERCICIOS)</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>SELECCIONAR EJERCICIOS PARA INICIAR</span>
              </>
            )}
          </button>
        </section>

        {/* 7. SELECTOR DE OTRAS RUTINAS SEMANALES (Tarjetas compactas Lunes-Domingo, sin estadísticas repetidas) */}
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div>
              <span className="block text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-accent-text">
                PLANIFICACIÓN COMPLETA
              </span>
              <h2 className="text-sm sm:text-base font-black text-[#F5F5F5] uppercase">
                Rutinas Semanales ({routines.length})
              </h2>
            </div>

            <button
              type="button"
              onClick={onNavigateRoutines}
              className="min-h-[34px] px-3 py-1 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-xs font-bold text-accent-text flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span>Editar Rutinas</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {routines.map((routine) => {
              const isSelected = activePreRoutine?.id === routine.id;
              const isToday = isSameWeekday(
                routine.dayName || routine.title,
                todayWeekdayName
              );
              const isCompletedThisWeek = isRoutineCompletedThisWeek(routine);
              const exCount = routine.exercises.length;
              const setsCount = routine.exercises.reduce(
                (acc, ex) => acc + (Number(ex.defaultSets) || 3),
                0
              );
              const primaryMuscleSummary =
                routine.tagline ||
                Array.from(
                  new Set(routine.exercises.map((e) => e.targetMuscles).filter(Boolean))
                )
                  .slice(0, 3)
                  .join(' · ') ||
                'Fuerza & Hipertrofia';

              return (
                <article
                  key={routine.id}
                  className={`rounded-xl sm:rounded-2xl p-3 sm:p-3.5 border flex flex-col justify-between gap-2.5 transition-all ${
                    isSelected
                      ? 'bg-[#171717] border-accent'
                      : 'bg-[#171717] border-[#303030] hover:border-zinc-500'
                  }`}
                >
                  <div className="space-y-1">
                    {/* Fila superior: Día + Estado */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider">
                        <span className="text-accent-text">{routine.dayName}</span>
                        {isToday && (
                          <span className="px-1.5 py-0.2 rounded bg-accent/15 text-accent-text font-mono text-[9px] font-black">
                            HOY
                          </span>
                        )}
                      </div>

                      {isCompletedThisWeek ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-accent-text">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Realizada</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-zinc-400">
                          Programada
                        </span>
                      )}
                    </div>

                    {/* Nombre completo de la rutina (hasta 2 líneas, sin cortar) */}
                    <h3 className="text-xs sm:text-sm font-black text-[#F5F5F5] leading-snug line-clamp-2 uppercase">
                      {routine.title}
                    </h3>

                    {/* Grupo muscular enfocado (sin repetir estadísticas de ejercicios ni series) */}
                    <p className="text-[11px] text-zinc-400 leading-tight line-clamp-1">
                      {primaryMuscleSummary}
                    </p>
                  </div>

                  {/* Fila inferior: Conteo conciso + Botones Ver e Iniciar */}
                  <div className="pt-2 border-t border-[#303030]/80 flex items-center justify-between gap-2">
                    <div className="text-[11px] font-mono tabular-nums text-zinc-300">
                      <strong className="text-[#F5F5F5]">{exCount}</strong> ej ·{' '}
                      <strong className="text-accent-text">{setsCount}</strong> series
                    </div>

                    <div className="flex items-center gap-1.5">
                      {!isSelected && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPreDayId(routine.id);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="min-h-[32px] px-2.5 py-1 rounded-lg bg-[#090909] hover:bg-[#222222] border border-[#303030] text-[11px] font-bold text-[#F5F5F5] transition-colors cursor-pointer"
                        >
                          Ver
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onStartWorkout(routine)}
                        className="min-h-[32px] px-3 py-1 rounded-lg bg-accent hover:bg-accent-hover text-accent-contrast font-black text-[11px] uppercase tracking-wider flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Iniciar</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Modal de Catálogo de Ejercicios para Entrenamiento Libre */}
        {isExercisePickerOpen && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
            <div className="w-full max-w-xl bg-[#090909] border-t sm:border border-[#303030] rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-[#303030] flex items-center justify-between gap-3 bg-[#171717]">
                <div>
                  <h3 className="text-base font-black text-[#F5F5F5] uppercase">
                    Catálogo de Ejercicios
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Selecciona los ejercicios para tu sesión libre ({freeDraftExercises.length} añadidos)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsExercisePickerOpen(false)}
                  className="w-10 h-10 rounded-xl bg-[#090909] border border-[#303030] text-zinc-400 hover:text-[#F5F5F5] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 border-b border-[#303030] space-y-3 bg-[#090909]">
                <div className="relative">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por nombre o equipo..."
                    className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-[#171717] border border-[#303030] focus:border-accent focus:outline-none text-xs text-[#F5F5F5]"
                  />
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {MUSCLE_GROUPS.map((muscle) => (
                    <button
                      key={muscle}
                      type="button"
                      onClick={() => setSelectedMuscleFilter(muscle)}
                      className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        selectedMuscleFilter === muscle
                          ? 'bg-accent text-accent-contrast font-black'
                          : 'bg-[#171717] text-zinc-400 hover:text-[#F5F5F5] border border-[#303030]'
                      }`}
                    >
                      {muscle}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400 px-0.5">
                  <span>
                    Mostrando{' '}
                    <strong className="text-[#F5F5F5] tabular-nums">{filteredCatalog.length}</strong>{' '}
                    de{' '}
                    <strong className="text-[#F5F5F5] tabular-nums">{EXERCISE_LIBRARY.length}</strong>{' '}
                    ejercicios
                  </span>
                  {selectedMuscleFilter !== 'Todos' && (
                    <span className="font-bold text-accent-text">{selectedMuscleFilter}</span>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-[#303030]/60 p-2 bg-[#090909]">
                {filteredCatalog.length === 0 ? (
                  <div className="p-8 text-center space-y-3">
                    <p className="text-xs text-zinc-400">
                      No hay ejercicios que coincidan con los filtros actuales.
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="px-3 py-1.5 rounded-lg bg-[#171717] border border-[#303030] text-xs font-bold text-[#F5F5F5] hover:border-accent cursor-pointer"
                        >
                          Limpiar búsqueda
                        </button>
                      )}
                      {selectedMuscleFilter !== 'Todos' && (
                        <button
                          type="button"
                          onClick={() => setSelectedMuscleFilter('Todos')}
                          className="px-3 py-1.5 rounded-lg bg-accent text-accent-contrast text-xs font-black cursor-pointer"
                        >
                          Ver todos
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  filteredCatalog.map((item) => {
                    const alreadyAdded = freeDraftExercises.some(
                      (d) =>
                        d.libraryExerciseId === item.id ||
                        d.id === `cat-${item.id}` ||
                        normalizeExerciseName(d.name) === normalizeExerciseName(item.name)
                    );
                    return (
                      <div
                        key={item.id}
                        className="p-3 flex items-center justify-between gap-3 hover:bg-[#171717] rounded-xl transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-bold text-[#F5F5F5] leading-snug line-clamp-2">
                            {item.name}
                          </p>
                          <p className="text-[11px] text-zinc-400 mt-0.5">
                            {item.muscleGroup} {item.equipment ? `· ${item.equipment}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!alreadyAdded) {
                              setFreeDraftExercises((prev) => [
                                ...prev,
                                libraryItemToExercise(item),
                              ]);
                            } else {
                              setFreeDraftExercises((prev) =>
                                prev.filter(
                                  (d) =>
                                    d.libraryExerciseId !== item.id &&
                                    d.id !== `cat-${item.id}` &&
                                    normalizeExerciseName(d.name) !==
                                      normalizeExerciseName(item.name)
                                )
                              );
                            }
                          }}
                          className={`min-h-[40px] px-3.5 py-1.5 rounded-xl font-black text-xs flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                            alreadyAdded
                              ? 'bg-[#171717] border border-accent text-accent-text'
                              : 'bg-accent hover:bg-accent-hover text-accent-contrast'
                          }`}
                        >
                          {alreadyAdded ? (
                            <>
                              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                              <span>Añadido</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                              <span>Añadir</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-3.5 border-t border-[#303030] bg-[#171717] flex items-center justify-between gap-3">
                <span className="text-xs font-mono text-zinc-300">
                  {freeDraftExercises.length} ejercicio(s) seleccionado(s)
                </span>
                <button
                  type="button"
                  onClick={() => setIsExercisePickerOpen(false)}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs uppercase tracking-wider cursor-pointer"
                >
                  Listo
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // 8. PANTALLA DE ENTRENAMIENTO ACTIVO (REDISEÑO ELITE 2.0)
  // ============================================================================
  const baseRoutine = routines.find((r) => r.id === activeSession.routineId);

  const { shortTitle: routineShortTitle, secondaryDesc: routineSecondaryDesc } =
    abbreviateRoutineHeadline(
      activeSession.routineTitle,
      baseRoutine?.tagline,
      activeSession.exercises
    );

  const totalSets = activeSession.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
  const completedSets = activeSession.exercises.reduce(
    (acc, ex) => acc + ex.sets.filter((s) => s.completed).length,
    0
  );
  const fullyCompletedExercisesCount = activeSession.exercises.filter(
    (ex) => ex.sets.length > 0 && ex.sets.every((s) => s.completed)
  ).length;
  const pendingExercisesCount = Math.max(
    0,
    activeSession.exercises.length - fullyCompletedExercisesCount
  );

  const progressPercentage = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;

  const handleApplyBackoff = (exerciseId: string, backoffKg: number) => {
    const ex = activeSession.exercises.find((e) => e.exerciseId === exerciseId);
    if (!ex) return;
    ex.sets.forEach((s, idx) => {
      if (!s.completed && !s.isWarmup) {
        onUpdateSet(exerciseId, idx, 'weight', backoffKg);
      }
    });
    setOverloadNotice({
      exerciseName: ex.activeExerciseName,
      message: `Back-off aplicado: series restantes ajustadas a ${backoffKg} kg.`,
      type: 'fatigue',
    });
  };

  const handleApplyReducedReps = (exerciseId: string, targetReducedReps: number) => {
    const ex = activeSession.exercises.find((e) => e.exerciseId === exerciseId);
    if (!ex) return;
    ex.sets.forEach((s, idx) => {
      if (!s.completed && !s.isWarmup) {
        onUpdateSet(exerciseId, idx, 'reps', targetReducedReps);
      }
    });
    setOverloadNotice({
      exerciseName: ex.activeExerciseName,
      message: `Ajuste por fatiga: series restantes ajustadas a ${targetReducedReps} reps.`,
      type: 'fatigue',
    });
  };

  const handleRequestFinish = () => {
    if (isFinishingRef.current) return;
    if (completedSets === 0 || pendingExercisesCount > 0) {
      setShowFinishIncompleteConfirm(true);
      return;
    }
    isFinishingRef.current = true;
    onFinishWorkout();
  };

  const handleConfirmFinish = () => {
    if (isFinishingRef.current) return;
    isFinishingRef.current = true;
    setShowFinishIncompleteConfirm(false);
    onFinishWorkout();
  };

  const handleCompleteSetSafely = (
    exerciseId: string,
    setIndex: number,
    exerciseName: string,
    exerciseRestSec: number
  ) => {
    if (isCompletingSetRef.current) return;
    const ex = activeSession.exercises.find((e) => e.exerciseId === exerciseId);
    const targetSet = ex?.sets[setIndex];
    if (!ex || !targetSet) return;

    const willBeCompleted = !targetSet.completed;

    if (willBeCompleted && !isValidSetValues(targetSet.weight, targetSet.reps)) {
      setSetValidationError({
        exerciseId,
        setIndex,
        message: `Ingresa peso (kg) y repeticiones (> 0) para completar la Serie ${targetSet.setNumber}.`,
      });
      return;
    }

    isCompletingSetRef.current = true;
    window.setTimeout(() => {
      isCompletingSetRef.current = false;
    }, 260);

    if (activeSession.isPaused && onResumeWorkoutSession) {
      onResumeWorkoutSession();
    }

    setSetValidationError(null);
    onUpdateSet(exerciseId, setIndex, 'completed', willBeCompleted);

    if (willBeCompleted) {
      const nextUncompleted = ex.sets.findIndex((s, i) => i > setIndex && !s.completed);
      const fallbackUncompleted = ex.sets.findIndex((s) => !s.completed);
      const targetNext = nextUncompleted >= 0 ? nextUncompleted : (fallbackUncompleted >= 0 ? fallbackUncompleted : setIndex);
      setSelectedSetIndexMap((prev) => ({
        ...prev,
        [exerciseId]: targetNext,
      }));

      if (autoRestEnabled) {
        const restToUse = targetSet.isWarmup ? 45 : exerciseRestSec;
        const nextSetCandidate = ex.sets[targetNext];
        const explicitNextSetNumber =
          nextSetCandidate && !nextSetCandidate.completed && targetNext !== setIndex
            ? nextSetCandidate.setNumber
            : undefined;
        onStartRestTimer(restToUse, exerciseName, explicitNextSetNumber);
      }

      const currWeight = typeof targetSet.weight === 'number' ? targetSet.weight : 0;
      const currReps = typeof targetSet.reps === 'number' ? targetSet.reps : 0;
      if (currWeight > 0 && currReps > 0) {
        const prescription = calculateNextSetByRpe({
          Series_Completadas: true,
          Peso_Actual: currWeight,
          Reps: currReps,
          RPE_Value: targetSet.rpe,
        });

        if (prescription.decision === 'FAILURE_DROP_OR_REPS') {
          setOverloadNotice({
            exerciseName,
            message: prescription.explanation,
            type: 'fatigue',
          });
        }
      }

      if (!targetSet.isWarmup) {
        const updatedSets = ex.sets.map((s, idx) =>
          idx === setIndex ? { ...s, completed: true } : s
        );
        const updatedExSnapshot: WorkoutExerciseState = {
          ...ex,
          sets: updatedSets,
        };
        const liveEval = evaluateCompletedSetWithCoach({
          exerciseState: updatedExSnapshot,
          completedSetIndex: setIndex,
          history: history || [],
          prs,
          routineModality: baseRoutine?.modality,
          activeSessionId: activeSession.sessionId,
          activeSessionStartTime: activeSession.startTime,
          activeProfileId: activeProfile?.id,
          currentRestSeconds: exerciseRestSec,
        });

        setLiveCoachEvaluationsByEx((prev) => ({
          ...prev,
          [exerciseId]: liveEval,
        }));
        setResolvedCoachEvalStatus((prev) => {
          if (!prev[liveEval.evaluationId]) return prev;
          const next = { ...prev };
          delete next[liveEval.evaluationId];
          return next;
        });

        speakProactiveCoachMessage({
          rawText: liveEval.voiceSummaryText,
          mode: coachVoiceMode,
          isImportant: liveEval.isImportant,
          eventKey: liveEval.evaluationId,
          spokenEventKeys: spokenCoachEventKeysRef.current,
          restTimerActive: restTimer.active,
          restTimerPaused: restTimer.paused,
          restTimerRemainingSeconds: restTimer.remainingSeconds,
          restAlertRecentlyTriggeredAt: restCompleteNotice?.triggeredAt,
        });
      }
    }
  };

  const handleAcceptCoachAdjustment = (
    exerciseId: string,
    evaluation: LiveSetCoachEvaluation
  ) => {
    const ex = activeSession.exercises.find((e) => e.exerciseId === exerciseId);
    if (!ex) return;

    const targetPendingIdx =
      evaluation.nextPendingSetIndex >= 0
        ? evaluation.nextPendingSetIndex
        : ex.sets.findIndex((s) => !s.completed && !s.isWarmup);

    if (targetPendingIdx >= 0) {
      if (typeof evaluation.suggestedWeightKg === 'number' && evaluation.suggestedWeightKg > 0) {
        onUpdateSet(exerciseId, targetPendingIdx, 'weight', evaluation.suggestedWeightKg);
      }
      if (typeof evaluation.suggestedReps === 'number' && evaluation.suggestedReps > 0) {
        onUpdateSet(exerciseId, targetPendingIdx, 'reps', evaluation.suggestedReps);
      }
    }

    if (onUpdateExerciseRest && evaluation.restDeltaSeconds !== 0) {
      onUpdateExerciseRest(exerciseId, evaluation.suggestedRestSeconds);
    }

    setResolvedCoachEvalStatus((prev) => ({
      ...prev,
      [evaluation.evaluationId]: 'accepted',
    }));
  };

  const handleRejectCoachAdjustment = (evaluationId: string) => {
    setResolvedCoachEvalStatus((prev) => ({
      ...prev,
      [evaluationId]: 'rejected',
    }));
  };

  const findNextIncompleteExerciseIndex = (fromIndex: number): number => {
    const total = activeSession.exercises.length;
    for (let offset = 1; offset < total; offset++) {
      const idx = (fromIndex + offset) % total;
      if (activeSession.exercises[idx].sets.some((s) => !s.completed)) {
        return idx;
      }
    }
    return -1;
  };

  const exercisesToRender =
    viewMode === 'focus' && activeSession.exercises[focusedExerciseIndex]
      ? [
          {
            exerciseState: activeSession.exercises[focusedExerciseIndex],
            exIndex: focusedExerciseIndex,
          },
        ]
      : activeSession.exercises.map((exerciseState, exIndex) => ({
          exerciseState,
          exIndex,
        }));

  return (
    <div className="space-y-3.5 pb-6 font-['Plus_Jakarta_Sans',sans-serif] text-[#F5F5F5]">
      {/* 1. ENCABEZADO COMPACTO DE SESIÓN ACTIVA */}
      <header className="space-y-2.5">
        <div className="flex items-start justify-between gap-2.5">
          {/* Izquierda: Estado, Nombre abreviado y Descripción muscular secundaria */}
          <div className="min-w-0 flex-1">
            {(() => {
              const syncDisplay = resolveWorkoutSyncDisplay(workoutSyncStatus, workoutSyncError);
              const showOfflineBadge = !isOnline || isOfflineSession;
              const effectiveLabel = showOfflineBadge
                ? `Offline · Guardado local${pendingSyncCount > 0 ? ` (${pendingSyncCount})` : ''}`
                : syncDisplay.label;
              const statusColorClass = showOfflineBadge
                ? 'text-amber-300'
                : syncDisplay.status === 'synced'
                ? 'text-accent-text'
                : syncDisplay.status === 'pending_sync'
                ? 'text-amber-400'
                : syncDisplay.status === 'error'
                ? 'text-[#EF4444]'
                : 'text-zinc-300';

              return (
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-accent-text leading-none">
                    SESIÓN ACTIVA
                  </span>
                  <span className="text-zinc-600 text-[10px]" aria-hidden="true">·</span>
                  {syncDisplay.status === 'error' && isOnline && onRetryWorkoutSync ? (
                    <button
                      type="button"
                      data-testid="workout-sync-status"
                      onClick={() => {
                        void onRetryWorkoutSync();
                      }}
                      title={syncDisplay.detail}
                      className="text-[10px] font-black uppercase tracking-wider text-[#EF4444] underline underline-offset-2 hover:text-red-300 cursor-pointer leading-none"
                    >
                      {effectiveLabel}
                    </button>
                  ) : (
                    <span
                      data-testid="workout-sync-status"
                      title={showOfflineBadge ? 'Entrenando sin conexión con autoguardado local continuo.' : syncDisplay.detail}
                      className={`text-[10px] font-bold tracking-wide leading-none ${statusColorClass}`}
                    >
                      {effectiveLabel}
                    </span>
                  )}
                </div>
              );
            })()}
            <h1 className="text-lg sm:text-xl font-black text-[#F5F5F5] uppercase tracking-tight leading-tight truncate">
              {routineShortTitle}
            </h1>
            <p className="text-xs text-zinc-400 leading-snug truncate mt-0.5">
              {routineSecondaryDesc}
            </p>
          </div>

          {/* Derecha: Acción Pausar/Reanudar + Finalizar + Menú secundario (···) */}
          <div className="flex items-center gap-1.5 shrink-0 relative">
            {onPauseWorkoutSession && onResumeWorkoutSession && (
              <button
                type="button"
                data-testid="workout-pause-resume-btn"
                onClick={() =>
                  activeSession.isPaused ? onResumeWorkoutSession() : onPauseWorkoutSession()
                }
                className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                  activeSession.isPaused
                    ? 'bg-accent hover:bg-accent-hover border-accent text-accent-contrast font-black'
                    : 'bg-[#171717] hover:bg-[#222222] border-[#303030] text-zinc-200'
                }`}
                title={activeSession.isPaused ? 'Reanudar sesión de entrenamiento' : 'Pausar sesión de entrenamiento'}
              >
                {activeSession.isPaused ? (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Reanudar</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5 text-amber-400" />
                    <span className="hidden sm:inline">Pausar</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleRequestFinish}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] hover:border-accent/60 text-[#F5F5F5] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Finalizar y guardar entrenamiento"
            >
              <Check className="w-3.5 h-3.5 text-accent-text stroke-[2.8]" />
              <span>Finalizar</span>
            </button>

            <button
              type="button"
              onClick={() => setIsHeaderMenuOpen((o) => !o)}
              aria-label="Opciones de la sesión"
              className="min-h-[38px] w-[38px] rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-zinc-300 hover:text-[#F5F5F5] flex items-center justify-center transition-colors cursor-pointer"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {isHeaderMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsHeaderMenuOpen(false)}
                />
                <div className="absolute right-0 top-11 z-40 w-56 rounded-2xl bg-[#171717] border border-[#303030] shadow-[0_18px_40px_rgba(0,0,0,0.92)] p-1.5 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      setIsExercisePickerOpen(true);
                    }}
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl text-left text-xs font-bold text-[#F5F5F5] hover:bg-[#090909] flex items-center gap-2.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4 text-accent-text" />
                    <span>Agregar ejercicio</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      setViewMode((m) => (m === 'focus' ? 'list' : 'focus'));
                    }}
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl text-left text-xs font-bold text-[#F5F5F5] hover:bg-[#090909] flex items-center gap-2.5 cursor-pointer"
                  >
                    {viewMode === 'focus' ? (
                      <>
                        <LayoutList className="w-4 h-4 text-accent-text" />
                        <span>Ver todos los ejercicios</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4 text-accent-text" />
                        <span>Modo ejercicio actual</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAutoRestEnabled((prev) => !prev);
                    }}
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl text-left text-xs font-bold text-[#F5F5F5] hover:bg-[#090909] flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5">
                      <Timer className="w-4 h-4 text-accent-text" />
                      <span>Auto-descanso</span>
                    </span>
                    <span className="font-mono text-[11px] font-black text-accent-text">
                      {autoRestEnabled ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      const currentEx = activeSession.exercises[focusedExerciseIndex];
                      const firstEnteredWeight = currentEx?.sets.find(
                        (s) => typeof s.weight === 'number' && s.weight > 0
                      )?.weight;
                      onOpenPlateCalculator(
                        typeof firstEnteredWeight === 'number' ? firstEnteredWeight : 60
                      );
                    }}
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl text-left text-xs font-bold text-[#F5F5F5] hover:bg-[#090909] flex items-center gap-2.5 cursor-pointer"
                  >
                    <Disc className="w-4 h-4 text-accent-text" />
                    <span>Calculadora de discos</span>
                  </button>

                  <div className="my-1 border-t border-[#303030]" />

                  <button
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      setShowDiscardConfirm(true);
                    }}
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl text-left text-xs font-bold text-[#EF4444] hover:bg-[#EF4444]/10 flex items-center gap-2.5 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Descartar sesión</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Franja de 3 Métricas: TIEMPO | EJERCICIOS | SERIES */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-[#171717] border border-[#303030] py-2 px-2 text-center">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              Tiempo
            </span>
            <span className="font-mono font-black text-sm sm:text-base text-accent-text tabular-nums leading-snug">
              {formatDuration(elapsedSeconds)}
            </span>
          </div>

          <div className="rounded-xl bg-[#171717] border border-[#303030] py-2 px-2 text-center">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              Ejercicios
            </span>
            <span className="font-mono font-black text-sm sm:text-base text-accent-text tabular-nums leading-snug">
              {fullyCompletedExercisesCount}/{activeSession.exercises.length}
            </span>
          </div>

          <div className="rounded-xl bg-[#171717] border border-[#303030] py-2 px-2 text-center">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              Series
            </span>
            <span className="font-mono font-black text-sm sm:text-base text-accent-text tabular-nums leading-snug">
              {completedSets}/{totalSets}
            </span>
          </div>
        </div>

        {/* Barra de progreso hairline */}
        <div className="w-full h-1 bg-[#171717] rounded-full overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {activeSession.isPaused && (
          <div
            data-testid="workout-paused-banner"
            className="rounded-xl bg-amber-500/10 border border-amber-400/50 px-3 py-2 flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Pause className="w-4 h-4 text-amber-300 shrink-0" />
              <div className="min-w-0">
                <span className="text-[11px] font-black uppercase tracking-wider text-amber-300 block">
                  Sesión en pausa · Tiempo congelado
                </span>
                <span className="text-[11px] text-zinc-300 block truncate">
                  Pulsa reanudar o completa una serie para continuar.
                </span>
              </div>
            </div>
            {onResumeWorkoutSession && (
              <button
                type="button"
                onClick={onResumeWorkoutSession}
                className="min-h-[32px] px-3 py-1 rounded-lg bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black uppercase shrink-0 cursor-pointer"
              >
                Reanudar
              </button>
            )}
          </div>
        )}
      </header>

      {/* 2. EJERCICIO ACTUAL PROTAGONISTA (O LISTA COMPLETA SI EL USUARIO CAMBIA DE MODO) */}
      <div className="space-y-4">
        {exercisesToRender.map(({ exerciseState, exIndex }) => {
          const rawExercise = baseRoutine?.exercises.find(
            (e) => e.id === exerciseState.exerciseId
          );

          const isSwappedName =
            rawExercise &&
            normalizeTextSimple(rawExercise.name) !==
              normalizeTextSimple(exerciseState.activeExerciseName);

          const libraryMatch = resolveLibraryExercise(
            isSwappedName
              ? {
                  name: exerciseState.activeExerciseName,
                  equipment: exerciseState.equipment,
                }
              : {
                  id: rawExercise?.id || exerciseState.exerciseId,
                  libraryExerciseId: rawExercise?.libraryExerciseId,
                  name: exerciseState.activeExerciseName,
                  equipment: exerciseState.equipment || rawExercise?.equipment,
                }
          );

          const thumbnailUrl = isSwappedName
            ? libraryMatch?.thumbnailUrl || undefined
            : libraryMatch?.thumbnailUrl || rawExercise?.thumbnailUrl || undefined;
          const equipmentLabel =
            exerciseState.equipment ||
            rawExercise?.equipment ||
            libraryMatch?.equipment ||
            '';

          const existingPR =
            prs[exerciseState.exerciseId] ||
            prs[`swap_${normalizeTextSimple(exerciseState.activeExerciseName)}`];

          const workingSetsCount = exerciseState.sets.filter((s) => !s.isWarmup).length;
          const allCompleted =
            exerciseState.sets.length > 0 &&
            exerciseState.sets.every((s) => s.completed);

          const hasWarmupSets = exerciseState.sets.some((s) => s.isWarmup);
          const repRangeTarget = exerciseState.repRange || rawExercise?.repRange || '8 - 12 reps';
          const isRdl =
            isRdlBarbellExercise(exerciseState.activeExerciseName) ||
            isRdlBarbellExercise(exerciseState.exerciseName) ||
            isRdlBarbellExercise(rawExercise?.name);
          const isBulgarian =
            isBulgarianDumbbellExercise(exerciseState.activeExerciseName) ||
            isBulgarianDumbbellExercise(exerciseState.exerciseName) ||
            isBulgarianDumbbellExercise(rawExercise?.name);

          let safeSec = exerciseState.restSeconds || rawExercise?.restSeconds || 90;
          if (safeSec === 1890) safeSec = 90;
          if (safeSec === 1950) safeSec = 150;

          const exerciseRestSec = isRdl ? 150 : isBulgarian ? 90 : safeSec;

          const muscleImpact = resolveExerciseMuscleImpact(
            exerciseState.activeExerciseName,
            exerciseState.targetMuscles
          );
          const primaryMuscleNames = Array.from(
            new Set(
              muscleImpact.primary
                .map((id) => MUSCLE_CONFIG[id]?.standardCategory || MUSCLE_CONFIG[id]?.name)
                .filter(Boolean)
            )
          );
          const muscleDisplay =
            primaryMuscleNames.join(' · ') || exerciseState.targetMuscles || 'Fuerza';

          const progressionEval = evaluateDoubleProgression(
            exerciseState.activeExerciseName,
            repRangeTarget,
            exerciseState.sets,
            baseRoutine?.modality
          );

          // Active set to complete via Hero CTA (prioritizes user selected set or first uncompleted)
          const firstIncompleteIdx = exerciseState.sets.findIndex((s) => !s.completed);
          const activeSetIndex =
            selectedSetIndexMap[exerciseState.exerciseId] ??
            (firstIncompleteIdx >= 0 ? firstIncompleteIdx : 0);
          const activeSet =
            activeSetIndex >= 0 && activeSetIndex < exerciseState.sets.length
              ? exerciseState.sets[activeSetIndex]
              : exerciseState.sets[0] || null;
          const nextIncompleteExIdx = findNextIncompleteExerciseIndex(exIndex);

          const isHistoryOpen = Boolean(expandedHistoryByEx[exerciseState.exerciseId]);
          const isToolsOpen = Boolean(expandedToolsByEx[exerciseState.exerciseId]);
          const isRestConfigOpen = Boolean(expandedRestByEx[exerciseState.exerciseId]);

          // Perfil Technique Pro 7.0 sincronizado en tiempo real (incluso tras sustituir por máquina ocupada)
          const activeTechniqueProfile =
            exerciseState.techniquePro &&
            normalizeTextSimple(exerciseState.techniquePro.exerciseName) ===
              normalizeTextSimple(exerciseState.activeExerciseName)
              ? exerciseState.techniquePro
              : buildTechniqueProProfile({
                  id: exerciseState.exerciseId,
                  libraryExerciseId: isSwappedName
                    ? libraryMatch?.id || exerciseState.libraryExerciseId
                    : exerciseState.libraryExerciseId || rawExercise?.libraryExerciseId,
                  name: exerciseState.activeExerciseName,
                  targetMuscles: exerciseState.targetMuscles,
                  equipment: equipmentLabel,
                  defaultVideoUrl:
                    libraryMatch?.videoUrl ||
                    libraryMatch?.url ||
                    (!isSwappedName ? rawExercise?.defaultVideoUrl : ''),
                  thumbnailUrl,
                });

          const hasCompletedWorkingSet = exerciseState.sets.some(
            (s) => s.completed && !s.isWarmup
          );

          const handleOpenActiveTechniqueModal = () => {
            const modalExercise: Exercise = {
              id: exerciseState.exerciseId,
              libraryExerciseId: activeTechniqueProfile.libraryExerciseId,
              name: exerciseState.activeExerciseName,
              targetMuscles: exerciseState.targetMuscles,
              defaultSets: workingSetsCount || rawExercise?.defaultSets || 4,
              repRange: repRangeTarget,
              restSeconds: exerciseRestSec,
              restText: formatDetailedRest(exerciseRestSec),
              alternative: !isSwappedName ? rawExercise?.alternative : rawExercise?.name,
              objective:
                exerciseState.objective ||
                rawExercise?.objective ||
                'Hipertrofia y Fuerza',
              defaultVideoUrl: activeTechniqueProfile.mediaUrl,
              thumbnailUrl: activeTechniqueProfile.posterUrl || thumbnailUrl,
              techniqueCues: activeTechniqueProfile.specificTips,
              techniquePro: activeTechniqueProfile,
              customTempo:
                exerciseState.customTempo || activeTechniqueProfile.defaultTempo.notation,
              equipment: activeTechniqueProfile.equipment,
            };
            onOpenExerciseModal(modalExercise);
          };

          return (
            <section
              id={`workout-ex-${exerciseState.exerciseId}`}
              key={exerciseState.exerciseId}
              className={`rounded-3xl border p-3.5 sm:p-5 transition-colors space-y-3.5 ${
                allCompleted
                  ? 'bg-[#171717] border-accent'
                  : 'bg-[#171717] border-[#303030]'
              }`}
            >
              {/* Encabezado del Ejercicio Actual */}
              <div className="space-y-2.5">
                {/* Línea superior: EJERCICIO X DE Y + Ver técnica compacto + Siguiente + Herramientas */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-accent-text shrink-0">
                      EJERCICIO {exIndex + 1} DE {activeSession.exercises.length}
                    </span>
                    <span className="text-zinc-600 shrink-0" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-[11px] font-bold text-zinc-400 truncate">
                      {muscleDisplay}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <button
                      type="button"
                      data-testid={`active-ver-tecnica-btn-${exerciseState.exerciseId}`}
                      onClick={handleOpenActiveTechniqueModal}
                      className="min-h-[32px] px-2.5 py-1 rounded-lg bg-[#090909] hover:bg-[#222222] border border-accent/60 text-[11px] font-black text-accent-text flex items-center gap-1 transition-colors cursor-pointer"
                      title="Ver animación exacta, técnica paso a paso, tempo y guía por voz"
                    >
                      <Eye className="w-3.5 h-3.5 text-accent-text" />
                      <span>Ver técnica</span>
                    </button>

                    {nextIncompleteExIdx >= 0 && viewMode === 'focus' && (
                      <button
                        type="button"
                        onClick={() => setFocusedExerciseIndex(nextIncompleteExIdx)}
                        className="min-h-[32px] px-2.5 py-1 rounded-lg bg-[#090909] border border-accent/40 text-[11px] font-black text-accent-text hover:bg-accent/10 flex items-center gap-1 transition-colors cursor-pointer"
                        title="Saltar al siguiente ejercicio pendiente"
                      >
                        <span>Siguiente</span>
                        <ChevronRight className="w-3.5 h-3.5 stroke-[3]" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedToolsByEx((prev) => ({
                          ...prev,
                          [exerciseState.exerciseId]: !prev[exerciseState.exerciseId],
                        }))
                      }
                      aria-label="Herramientas del ejercicio"
                      title="Herramientas de modificación, discos y aproximación"
                      className={`min-h-[32px] px-2.5 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                        isToolsOpen
                          ? 'bg-accent text-accent-contrast border-accent font-black'
                          : 'bg-[#090909] text-zinc-300 border-[#303030] hover:text-[#F5F5F5]'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>Herramientas {isToolsOpen ? '▲' : '▼'}</span>
                    </button>
                  </div>
                </div>

                {/* Título Protagonista + Miniatura de referencia */}
                <div className="flex items-center gap-3">
                  <ExerciseThumbnail
                    src={thumbnailUrl}
                    alt={exerciseState.activeExerciseName}
                    muscleGroup={exerciseState.targetMuscles}
                    exercise={
                      isSwappedName
                        ? {
                            id: libraryMatch?.id,
                            libraryExerciseId: libraryMatch?.id || exerciseState.libraryExerciseId,
                            name: exerciseState.activeExerciseName,
                            equipment: exerciseState.equipment,
                          }
                        : {
                            id: rawExercise?.id || exerciseState.exerciseId,
                            libraryExerciseId:
                              exerciseState.libraryExerciseId || rawExercise?.libraryExerciseId,
                            name: exerciseState.activeExerciseName,
                            equipment: equipmentLabel,
                          }
                    }
                    onClick={handleOpenActiveTechniqueModal}
                    showSpinner
                    allowRetry
                    className="w-12 h-12 rounded-xl border border-[#303030] shrink-0"
                  />

                  <div className="min-w-0 flex-1">
                    <h2 className="text-base sm:text-xl font-black text-[#F5F5F5] leading-snug">
                      {exerciseState.activeExerciseName}
                    </h2>
                    {exerciseState.originalExerciseName &&
                      normalizeTextSimple(exerciseState.originalExerciseName) !==
                        normalizeTextSimple(exerciseState.activeExerciseName) && (
                        <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                          Sustituye a: {exerciseState.originalExerciseName}
                        </p>
                      )}
                  </div>
                </div>

                {/* Consejo técnico breve antes de la primera serie de trabajo */}
                {!hasCompletedWorkingSet && (
                  <div
                    data-testid={`pre-set-technique-tip-${exerciseState.exerciseId}`}
                    className="p-2.5 rounded-xl bg-[#090909] border border-accent/40 flex items-start justify-between gap-2.5"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <Sparkles className="w-3.5 h-3.5 text-accent-text shrink-0 mt-0.5" />
                      <div className="text-xs leading-snug min-w-0">
                        <span className="text-[10px] font-black uppercase tracking-wider text-accent-text block">
                          Consejo técnico antes de tu 1ª serie · Tempo {activeTechniqueProfile.defaultTempo.notation}
                        </span>
                        <span className="text-[#F5F5F5] font-medium block mt-0.5">
                          {activeTechniqueProfile.preSetTip}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenActiveTechniqueModal}
                      className="shrink-0 px-2 py-1 rounded-lg bg-[#171717] hover:bg-[#222222] border border-[#303030] text-[10px] font-bold text-accent-text cursor-pointer"
                    >
                      Guía Pro
                    </button>
                  </div>
                )}

                {/* Fila Objetivo y Descanso Programado */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs">
                  <div className="flex items-center gap-2 text-zinc-300 font-medium">
                    <span>
                      <strong className="text-[#F5F5F5] font-mono tabular-nums">
                        {workingSetsCount}
                      </strong>{' '}
                      series ·{' '}
                      <span className="font-mono tabular-nums">{repRangeTarget}</span>
                    </span>
                    <span className="text-zinc-600" aria-hidden="true">
                      ·
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedHistoryByEx((prev) => ({
                          ...prev,
                          [exerciseState.exerciseId]: !prev[exerciseState.exerciseId],
                        }))
                      }
                      className="text-[11px] font-bold text-zinc-400 hover:text-accent-text inline-flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <History className="w-3 h-3 text-accent-text" />
                      <span>{isHistoryOpen ? 'Menos historial' : 'Más historial'}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedRestByEx((prev) => ({
                        ...prev,
                        [exerciseState.exerciseId]: !prev[exerciseState.exerciseId],
                      }))
                    }
                    className="font-mono font-bold text-accent-text hover:underline flex items-center gap-1 cursor-pointer tabular-nums"
                    title="Toca para ajustar el descanso programado"
                  >
                    <span>Descanso {formatDetailedRest(exerciseRestSec)}</span>
                  </button>
                </div>

                {/* Barra desplegable: Ajustar duración de descanso */}
                {isRestConfigOpen && (
                  <div className="rounded-xl bg-[#090909] border border-[#303030] p-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      {REST_PRESET_SECONDS.map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => {
                            if (onUpdateExerciseRest) {
                              onUpdateExerciseRest(exerciseState.exerciseId, sec);
                            }
                            setExpandedRestByEx((prev) => ({
                              ...prev,
                              [exerciseState.exerciseId]: false,
                            }));
                          }}
                          className={`min-h-[32px] px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-colors cursor-pointer ${
                            exerciseRestSec === sec
                              ? 'bg-accent text-accent-contrast font-black'
                              : 'bg-[#171717] text-zinc-300 border border-[#303030]'
                          }`}
                        >
                          {sec >= 60 ? `${formatRestMmSs(sec)} · ${sec}s` : `${sec}s`}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onStartRestTimer(exerciseRestSec, exerciseState.activeExerciseName);
                        setExpandedRestByEx((prev) => ({
                          ...prev,
                          [exerciseState.exerciseId]: false,
                        }));
                      }}
                      className="min-h-[32px] px-3 py-1 rounded-lg bg-accent hover:bg-accent-hover text-accent-contrast text-[11px] font-black uppercase flex items-center gap-1 cursor-pointer font-mono tabular-nums"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Iniciar {formatRestMmSs(exerciseRestSec)} ({exerciseRestSec} s)</span>
                    </button>
                  </div>
                )}

                {/* Barra desplegable: Herramientas del ejercicio (Cambiar, Variante, Escáner, +Aprox, Quitar) */}
                {isToolsOpen && (
                  <div className="rounded-xl bg-[#090909] border border-[#303030] p-2.5 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setManualSwapTarget({
                          id: exerciseState.exerciseId,
                          name: exerciseState.activeExerciseName,
                          originalName:
                            exerciseState.originalExerciseName || exerciseState.exerciseName,
                          targetMuscles: exerciseState.targetMuscles,
                          equipment: equipmentLabel,
                        });
                        setManualSwapSearch('');
                        setSwapMuscleFilter('Compatible');
                        setSwapEquipmentFilter('Todos');
                      }}
                      className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#171717] border border-accent/50 text-accent-text text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                      <span>Cambiar</span>
                    </button>

                    {rawExercise?.alternative && (
                      <button
                        type="button"
                        onClick={() => {
                          setLiveCoachEvaluationsByEx((prev) => {
                            const next = { ...prev };
                            delete next[exerciseState.exerciseId];
                            return next;
                          });
                          onToggleAlternative(exerciseState.exerciseId);
                        }}
                        className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                          exerciseState.useAlternative
                            ? 'bg-accent text-accent-contrast border-accent font-black'
                            : 'bg-[#171717] border-[#303030] text-zinc-300'
                        }`}
                      >
                        Variante
                      </button>
                    )}

                    {onReplaceActiveExercise && (
                      <button
                        type="button"
                        onClick={() =>
                          setExerciseToScan({
                            id: exerciseState.exerciseId,
                            name: exerciseState.activeExerciseName,
                            targetMuscles: exerciseState.targetMuscles,
                          })
                        }
                        className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#171717] border border-[#303030] text-zinc-300 hover:text-accent-text text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <ScanEye className="w-3.5 h-3.5 text-accent-text" />
                        <span>Escáner</span>
                      </button>
                    )}

                    {!hasWarmupSets && (
                      <button
                        type="button"
                        onClick={() => onAddWarmupSets(exerciseState.exerciseId)}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#171717] border border-[#303030] text-zinc-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Flame className="w-3.5 h-3.5 text-accent-text" />
                        <span>+Aprox.</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        const firstWeight = exerciseState.sets.find(
                          (s) => typeof s.weight === 'number' && s.weight > 0
                        )?.weight;
                        onOpenPlateCalculator(
                          typeof firstWeight === 'number' ? firstWeight : 60
                        );
                      }}
                      className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#171717] border border-[#303030] text-zinc-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Disc className="w-3.5 h-3.5 text-accent-text" />
                      <span>Discos</span>
                    </button>

                    {activeSession.exercises.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRemoveExerciseFromSession(exerciseState.exerciseId)}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#171717] border border-[#303030] text-zinc-400 hover:text-[#EF4444] text-[11px] font-bold flex items-center gap-1 cursor-pointer ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Quitar</span>
                      </button>
                    )}
                  </div>
                )}

              </div>

              <div className="border-t border-[#303030]" />

              {/* 3. ÚLTIMA SESIÓN + SUGERENCIA DE PROGRESIÓN (Visible antes de registrar series) */}
              <RecommendedLoadForecastWidget
                exerciseId={exerciseState.exerciseId}
                originalExerciseId={exerciseState.originalExerciseId}
                libraryExerciseId={
                  isSwappedName || exerciseState.useAlternative
                    ? (libraryMatch?.id || exerciseState.libraryExerciseId)
                    : (exerciseState.libraryExerciseId || rawExercise?.libraryExerciseId)
                }
                exerciseName={exerciseState.exerciseName}
                activeExerciseName={exerciseState.activeExerciseName}
                originalExerciseName={exerciseState.originalExerciseName}
                useAlternative={exerciseState.useAlternative}
                sets={exerciseState.sets}
                history={history}
                existingPR={existingPR}
                rawExercise={rawExercise}
                equipmentHint={equipmentLabel}
                repRange={repRangeTarget}
                routineModality={baseRoutine?.modality}
                exerciseObjective={exerciseState.objective || rawExercise?.objective}
                currentSessionId={activeSession.sessionId}
                currentSessionStartTime={activeSession.startTime}
                activeProfileId={activeProfile?.id}
                isHistoryExpanded={isHistoryOpen}
                isHistorySyncing={isHistorySyncing}
                historySyncError={historySyncError}
                onApplySuggestedLoad={(suggestedWeight, suggestedReps, targetSetIndex, options) => {
                  setSetValidationError(null);
                  if (options?.applyToAllPending) {
                    exerciseState.sets.forEach((s, idx) => {
                      if (!s.completed && !s.isWarmup) {
                        onUpdateSet(exerciseState.exerciseId, idx, 'weight', suggestedWeight);
                        onUpdateSet(exerciseState.exerciseId, idx, 'reps', suggestedReps);
                      }
                    });
                    return;
                  }
                  const targetSet = exerciseState.sets[targetSetIndex];
                  if (!targetSet || targetSet.completed || targetSet.isWarmup) {
                    const safeFallbackIdx = exerciseState.sets.findIndex(
                      (s) => !s.completed && !s.isWarmup
                    );
                    if (safeFallbackIdx < 0) return;
                    onUpdateSet(exerciseState.exerciseId, safeFallbackIdx, 'weight', suggestedWeight);
                    onUpdateSet(exerciseState.exerciseId, safeFallbackIdx, 'reps', suggestedReps);
                    setSelectedSetIndexMap((prev) => ({
                      ...prev,
                      [exerciseState.exerciseId]: safeFallbackIdx,
                    }));
                    return;
                  }
                  onUpdateSet(exerciseState.exerciseId, targetSetIndex, 'weight', suggestedWeight);
                  onUpdateSet(exerciseState.exerciseId, targetSetIndex, 'reps', suggestedReps);
                  setSelectedSetIndexMap((prev) => ({
                    ...prev,
                    [exerciseState.exerciseId]: targetSetIndex,
                  }));
                }}
              />

              {/* 4. SERIE ACTIVA COMO ELEMENTO PRINCIPAL + HISTORIAL COMPACTO DE SERIES */}
              <div className="space-y-4">
                {/* A. TARJETA PROTAGONISTA DE SERIE ACTIVA */}
                {activeSet && activeSetIndex >= 0 ? (
                  <div className="rounded-2xl bg-[#141414] border-2 border-accent/70 p-4 sm:p-5 space-y-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-lg bg-accent text-accent-contrast font-mono font-black text-xs uppercase">
                          {activeSet.isWarmup ? `Aproximación C${activeSetIndex + 1}` : `Serie Activa #${activeSet.setNumber}`}
                        </span>
                        <span className="text-xs text-zinc-400 font-mono">
                          {workingSetsCount} series trabajo
                        </span>
                      </div>

                      {/* Referencia de carga anterior con copia rápida de 1 toque */}
                      {parsePreviousPair(activeSet.previous) && !activeSet.completed ? (
                        <button
                          type="button"
                          onClick={() => {
                            const pair = parsePreviousPair(activeSet.previous)!;
                            onUpdateSet(exerciseState.exerciseId, activeSetIndex, 'weight', pair.weight);
                            onUpdateSet(exerciseState.exerciseId, activeSetIndex, 'reps', pair.reps);
                            setSetValidationError(null);
                          }}
                          className="min-h-[32px] px-2.5 rounded-lg bg-[#090909] border border-[#303030] text-[11px] font-mono text-accent-text hover:border-accent flex items-center gap-1 cursor-pointer transition-colors"
                          title="Copiar registro anterior exacto"
                        >
                          <span>Ant: {activeSet.previous}</span>
                        </button>
                      ) : activeSet.previous ? (
                        <span className="text-[11px] font-mono text-zinc-400">
                          Ant: {formatPreviousCompact(activeSet.previous)}
                        </span>
                      ) : (
                        <span className="text-[11px] font-mono text-zinc-500">Sin historial previo</span>
                      )}
                    </div>

                    {/* Campos KG y Repeticiones de Gran Tamaño (Optimizados para 1 mano) */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                          Peso (KG)
                        </label>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          placeholder="0"
                          aria-label={`Peso kg serie activa ${activeSet.setNumber}`}
                          value={activeSet.weight}
                          onChange={(e) => {
                            setSetValidationError(null);
                            const nextWeight = e.target.value === '' ? '' : Math.max(0, Number(e.target.value));
                            onUpdateSet(exerciseState.exerciseId, activeSetIndex, 'weight', nextWeight);
                            if (activeSet.completed && !isValidSetValues(nextWeight, activeSet.reps)) {
                              onUpdateSet(exerciseState.exerciseId, activeSetIndex, 'completed', false);
                            }
                          }}
                          className="w-full min-h-[52px] text-center font-mono tabular-nums font-black text-xl sm:text-2xl rounded-2xl bg-[#090909] border border-[#303030] focus:border-accent text-[#F5F5F5] placeholder:text-zinc-600 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                          Repeticiones
                        </label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          placeholder="0"
                          aria-label={`Repeticiones serie activa ${activeSet.setNumber}`}
                          value={activeSet.reps}
                          onChange={(e) => {
                            setSetValidationError(null);
                            const nextReps = e.target.value === '' ? '' : Math.max(0, Math.round(Number(e.target.value)));
                            onUpdateSet(exerciseState.exerciseId, activeSetIndex, 'reps', nextReps);
                            if (activeSet.completed && !isValidSetValues(activeSet.weight, nextReps)) {
                              onUpdateSet(exerciseState.exerciseId, activeSetIndex, 'completed', false);
                            }
                          }}
                          className="w-full min-h-[52px] text-center font-mono tabular-nums font-black text-xl sm:text-2xl rounded-2xl bg-[#090909] border border-[#303030] focus:border-accent text-[#F5F5F5] placeholder:text-zinc-600 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Botones de Ajuste Rápido y RPE/RIR Accesible */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            const curr = typeof activeSet.weight === 'number' ? activeSet.weight : 0;
                            setSetValidationError(null);
                            onUpdateSet(
                              exerciseState.exerciseId,
                              activeSetIndex,
                              'weight',
                              Math.max(0, Number((curr - 2.5).toFixed(2)))
                            );
                          }}
                          className="min-h-[38px] px-3 rounded-xl bg-[#090909] border border-[#303030] text-zinc-300 hover:text-[#F5F5F5] text-xs font-mono font-bold active:scale-95 cursor-pointer"
                        >
                          -2.5 kg
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const curr = typeof activeSet.weight === 'number' ? activeSet.weight : 0;
                            setSetValidationError(null);
                            onUpdateSet(
                              exerciseState.exerciseId,
                              activeSetIndex,
                              'weight',
                              Number((curr + 2.5).toFixed(2))
                            );
                          }}
                          className="min-h-[38px] px-3 rounded-xl bg-[#090909] border border-[#303030] text-accent-text hover:border-accent text-xs font-mono font-bold active:scale-95 cursor-pointer"
                        >
                          +2.5 kg
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const curr = typeof activeSet.reps === 'number' ? activeSet.reps : 0;
                            setSetValidationError(null);
                            onUpdateSet(exerciseState.exerciseId, activeSetIndex, 'reps', curr + 1);
                          }}
                          className="min-h-[38px] px-3 rounded-xl bg-[#090909] border border-[#303030] text-[#F5F5F5] text-xs font-mono font-bold active:scale-95 cursor-pointer"
                        >
                          +1 rep
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <select
                          aria-label="RPE o RIR de serie activa"
                          value={activeSet.rpe || ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? undefined : Number(e.target.value);
                            onUpdateSet(exerciseState.exerciseId, activeSetIndex, 'rpe', val);
                          }}
                          className="min-h-[38px] px-3 rounded-xl bg-[#090909] border border-[#303030] focus:border-accent focus:outline-none text-xs font-mono font-bold text-zinc-200 cursor-pointer"
                        >
                          <option value="">RPE / RIR</option>
                          <option value="10">@10 · 0 RIR</option>
                          <option value="9.5">@9.5 · 0.5 RIR</option>
                          <option value="9">@9 · 1 RIR</option>
                          <option value="8.5">@8.5 · 1.5 RIR</option>
                          <option value="8">@8 · 2 RIR</option>
                          <option value="7.5">@7.5 · 2.5 RIR</option>
                          <option value="7">@7 · 3 RIR</option>
                          <option value="6">@6 · 4+ RIR</option>
                        </select>
                      </div>
                    </div>

                    {/* Error de validación si existe */}
                    {setValidationError?.exerciseId === exerciseState.exerciseId && (
                      <div className="rounded-xl bg-[#090909] border border-[#EF4444]/60 px-3 py-2 flex items-center gap-2 text-xs text-[#EF4444] font-semibold">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{setValidationError.message}</span>
                      </div>
                    )}

                    {/* 4. BOTÓN DESTACADO COMPLETAR SERIE */}
                    <button
                      type="button"
                      onClick={() =>
                        handleCompleteSetSafely(
                          exerciseState.exerciseId,
                          activeSetIndex,
                          exerciseState.activeExerciseName,
                          exerciseRestSec
                        )
                      }
                      className="w-full min-h-[52px] py-3.5 px-5 rounded-2xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-sm sm:text-base uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_6px_22px_var(--accent-glow)] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <Check className="w-5 h-5 stroke-[3] text-accent-contrast" />
                      <span>
                        COMPLETAR SERIE {activeSet.isWarmup ? `C${activeSetIndex + 1}` : activeSet.setNumber}
                      </span>
                    </button>
                  </div>
                ) : null}

                {/* 2. SERIES DEL EJERCICIO (Listado compacto sin inputs gigantes simultáneos) */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                      SERIES DEL EJERCICIO ({exerciseState.sets.length})
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      Toca una serie para activarla
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {exerciseState.sets.map((set, setIndex) => {
                      const isCurrentActive = setIndex === activeSetIndex;
                      const statusLabel = set.completed
                        ? 'Completada'
                        : isCurrentActive
                        ? 'En curso'
                        : 'Pendiente';
                      const summaryText =
                        typeof set.weight === 'number' && set.weight > 0 && typeof set.reps === 'number' && set.reps > 0
                          ? `${set.weight} kg · ${set.reps} reps${set.rpe ? ` · @${set.rpe}` : ''}`
                          : '— kg · — reps';

                      return (
                        <div
                          key={`compact-set-${set.setNumber}-${setIndex}`}
                          onClick={() => {
                            setSelectedSetIndexMap((prev) => ({
                              ...prev,
                              [exerciseState.exerciseId]: setIndex,
                            }));
                            setSetValidationError(null);
                          }}
                          role="button"
                          tabIndex={0}
                          className={`w-full p-3 rounded-xl border flex items-center justify-between gap-3 transition-all cursor-pointer ${
                            isCurrentActive
                              ? 'bg-[#171717] border-accent'
                              : set.completed
                              ? 'bg-[#090909] border-accent/40'
                              : 'bg-[#121212] border-[#303030] hover:border-zinc-500'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-7 h-7 rounded-lg flex items-center justify-center font-mono font-black text-xs shrink-0 ${
                                set.completed
                                  ? 'bg-accent text-accent-contrast'
                                  : isCurrentActive
                                  ? 'bg-accent text-accent-contrast'
                                  : 'bg-[#1a1a1a] text-zinc-300 border border-[#303030]'
                              }`}
                            >
                              {set.isWarmup ? `C${setIndex + 1}` : set.setNumber}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#F5F5F5] uppercase tracking-wide truncate">
                                Serie {set.isWarmup ? `C${setIndex + 1}` : set.setNumber} —{' '}
                                <span
                                  className={
                                    isCurrentActive
                                      ? 'text-accent-text'
                                      : set.completed
                                      ? 'text-accent-text'
                                      : 'text-zinc-400'
                                  }
                                >
                                  {statusLabel}
                                </span>
                              </p>
                              <p className="text-[11px] font-mono text-zinc-400 tabular-nums truncate">
                                {summaryText}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCompleteSetSafely(
                                  exerciseState.exerciseId,
                                  setIndex,
                                  exerciseState.activeExerciseName,
                                  exerciseRestSec
                                );
                              }}
                              aria-label={set.completed ? `Desmarcar serie ${set.setNumber}` : `Completar serie ${set.setNumber}`}
                              className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all active:scale-95 cursor-pointer ${
                                set.completed
                                  ? 'bg-accent text-accent-contrast border-accent'
                                  : 'bg-[#090909] text-zinc-400 border-[#303030] hover:text-accent-text'
                              }`}
                            >
                              <Check className="w-4 h-4 stroke-[3]" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 4. BOTÓN CONTEXTUAL SIGUIENTE EJERCICIO DEBAJO DEL BLOQUE DE SERIES */}
                {nextIncompleteExIdx >= 0 && viewMode === 'focus' && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setFocusedExerciseIndex(nextIncompleteExIdx)}
                      className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#090909] hover:bg-[#1a1a1a] border border-[#303030] hover:border-accent/50 text-xs font-black text-accent-text uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <span>SIGUIENTE EJERCICIO ({activeSession.exercises[nextIncompleteExIdx]?.activeExerciseName})</span>
                      <ChevronRight className="w-4 h-4 stroke-[3]" />
                    </button>
                  </div>
                )}
              </div>

              {/* COACH INTELLIGENCE PRO 7.0: EVALUACIÓN PROACTIVA TRAS COMPLETAR SERIE */}
              {(() => {
                const liveEval = liveCoachEvaluationsByEx[exerciseState.exerciseId];
                if (!liveEval) return null;
                const evalDecisionStatus = resolvedCoachEvalStatus[liveEval.evaluationId];
                const hasPendingWorkingSet = exerciseState.sets.some(
                  (s) => !s.completed && !s.isWarmup
                );
                const signalLabels: Record<string, { label: string; colorClass: string }> = {
                  personal_record: {
                    label: 'RÉCORD PERSONAL',
                    colorClass: 'border-accent text-accent-text bg-accent/10',
                  },
                  progression_opportunity: {
                    label: 'OPORTUNIDAD DE PROGRESIÓN',
                    colorClass: 'border-accent/60 text-accent-text bg-[#171717]',
                  },
                  near_failure: {
                    label: 'CERCA DEL FALLO',
                    colorClass: 'border-amber-500/60 text-amber-400 bg-amber-500/10',
                  },
                  excessive_effort: {
                    label: 'ESFUERZO EXCESIVO',
                    colorClass: 'border-[#EF4444]/60 text-[#EF4444] bg-[#EF4444]/10',
                  },
                  performance_drop: {
                    label: 'CAÍDA DE RENDIMIENTO',
                    colorClass: 'border-amber-500/60 text-amber-400 bg-amber-500/10',
                  },
                  insufficient_data: {
                    label: 'DATOS INSUFICIENTES',
                    colorClass: 'border-[#303030] text-zinc-300 bg-[#171717]',
                  },
                  steady_execution: {
                    label: 'ZONA ÓPTIMA',
                    colorClass: 'border-[#303030] text-[#F5F5F5] bg-[#171717]',
                  },
                };

                return (
                  <div
                    data-testid={`coach-live-set-evaluation-${exerciseState.exerciseId}`}
                    className="rounded-2xl bg-[#090909] border border-accent/50 p-3.5 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-[#171717] border border-accent/40 text-accent-text flex items-center justify-center shrink-0">
                          <Sparkles className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-accent-text">
                            COACH INTELLIGENCE PRO · SERIE {liveEval.setNumber}
                          </span>
                          <p className="text-xs font-black text-[#F5F5F5] leading-snug">
                            {liveEval.headline}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 flex-wrap">
                        {liveEval.signals.map((sig) => {
                          const badge = signalLabels[sig] || signalLabels.steady_execution;
                          return (
                            <span
                              key={sig}
                              className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${badge.colorClass}`}
                            >
                              {badge.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <p className="text-xs text-zinc-200 leading-snug">
                      {liveEval.rationale}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-xl bg-[#171717] border border-[#303030] p-2.5 space-y-0.5">
                        <span className="block text-[9px] font-black uppercase tracking-wider text-zinc-400">
                          Contexto Histórico y Volumen
                        </span>
                        <p className="text-zinc-300 leading-snug">
                          {liveEval.historicalComparisonText}
                        </p>
                        <p className="text-[10px] font-mono text-zinc-400 pt-0.5">
                          Volumen acumulado: <strong className="text-[#F5F5F5]">{liveEval.accumulatedExerciseVolumeKg} kg</strong>
                        </p>
                      </div>

                      <div className="rounded-xl bg-[#171717] border border-[#303030] p-2.5 space-y-0.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[9px] font-black uppercase tracking-wider text-accent-text">
                            Technique Pro · Foco Técnico
                          </span>
                          <button
                            type="button"
                            onClick={handleOpenActiveTechniqueModal}
                            className="text-[10px] font-black text-accent-text underline underline-offset-2 cursor-pointer"
                          >
                            Ver técnica
                          </button>
                        </div>
                        <p className="text-zinc-200 leading-snug">
                          {liveEval.techniqueCue}
                        </p>
                      </div>
                    </div>

                    {/* Propuesta de ajuste explícito (Nunca modifica automáticamente sin autorización del atleta) */}
                    {hasPendingWorkingSet && (
                      <div className="rounded-xl bg-[#171717] border border-[#303030] p-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <span className="block text-[9px] font-black uppercase tracking-wider text-zinc-400">
                            Propuesta para tu próxima serie
                          </span>
                          <div className="flex flex-wrap items-center gap-2 text-xs font-mono font-black text-[#F5F5F5]">
                            <span className="text-accent-text">
                              {liveEval.suggestedWeightKg} kg × {liveEval.suggestedReps} reps
                            </span>
                            <span className="text-zinc-600">·</span>
                            <span className="text-zinc-300">
                              Descanso: {formatRestMmSs(liveEval.suggestedRestSeconds)} ({liveEval.suggestedRestSeconds} s)
                            </span>
                          </div>
                        </div>

                        {evalDecisionStatus === 'accepted' ? (
                          <span
                            data-testid={`coach-adjustment-status-${exerciseState.exerciseId}`}
                            className="px-2.5 py-1 rounded-lg bg-accent/15 border border-accent/50 text-accent-text text-[11px] font-black uppercase"
                          >
                            ✓ Ajuste aplicado
                          </span>
                        ) : evalDecisionStatus === 'rejected' ? (
                          <span
                            data-testid={`coach-adjustment-status-${exerciseState.exerciseId}`}
                            className="px-2.5 py-1 rounded-lg bg-[#090909] border border-[#303030] text-zinc-400 text-[11px] font-bold uppercase"
                          >
                            Ajuste descartado · Se mantiene plan
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              data-testid={`coach-accept-adjustment-btn-${exerciseState.exerciseId}`}
                              onClick={() =>
                                handleAcceptCoachAdjustment(
                                  exerciseState.exerciseId,
                                  liveEval
                                )
                              }
                              className="min-h-[34px] px-3 py-1 rounded-lg bg-accent hover:bg-accent-hover text-accent-contrast text-[11px] font-black uppercase tracking-wider transition-colors cursor-pointer"
                            >
                              Aceptar ajuste
                            </button>
                            <button
                              type="button"
                              data-testid={`coach-reject-adjustment-btn-${exerciseState.exerciseId}`}
                              onClick={() => handleRejectCoachAdjustment(liveEval.evaluationId)}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#090909] hover:bg-[#222222] border border-[#303030] text-zinc-300 text-[11px] font-bold transition-colors cursor-pointer"
                            >
                              Mantener actual
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Selector compacto de modo de voz durante el entrenamiento */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[10px] text-zinc-400">
                      <span>Modo de Voz del Coach:</span>
                      <div className="flex items-center gap-1">
                        {(['silent', 'important_only', 'full_coach'] as CoachVoiceMode[]).map(
                          (modeOption) => (
                            <button
                              key={modeOption}
                              type="button"
                              onClick={() => handleSelectCoachVoiceMode(modeOption)}
                              className={`px-2 py-0.5 rounded-md border font-bold transition-colors cursor-pointer ${
                                coachVoiceMode === modeOption
                                  ? 'bg-accent text-accent-contrast border-accent font-black'
                                  : 'bg-[#171717] text-zinc-400 border-[#303030] hover:text-[#F5F5F5]'
                              }`}
                            >
                              {modeOption === 'silent'
                                ? 'Silencioso'
                                : modeOption === 'important_only'
                                ? 'Solo importantes'
                                : 'Coach completo'}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Aviso opcional de fatiga cuando se registra RPE 10 */}
              {progressionEval.status === 'RPE10_FATIGUE' && (
                <div className="p-3 rounded-2xl bg-[#090909] border border-[#EF4444]/60 text-zinc-200 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-black text-[#EF4444]">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Esfuerzo Máximo Registrado (@10)</span>
                  </div>
                  <p className="text-xs text-zinc-300 leading-snug">
                    {progressionEval.actionAdvice}
                  </p>
                  {progressionEval.backoffSuggestedKg &&
                    exerciseState.sets.some((s) => !s.completed && !s.isWarmup) && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleApplyBackoff(
                              exerciseState.exerciseId,
                              progressionEval.backoffSuggestedKg!
                            )
                          }
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-[#171717] border border-[#EF4444]/50 text-[#F5F5F5] font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                        >
                          <TrendingDown className="w-3.5 h-3.5 text-[#EF4444]" />
                          <span>Descarga {progressionEval.backoffSuggestedKg} kg (-5%)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const lastCompleted = [...exerciseState.sets]
                              .reverse()
                              .find((s) => s.completed && typeof s.reps === 'number');
                            const baseReps =
                              typeof lastCompleted?.reps === 'number'
                                ? lastCompleted.reps
                                : progressionEval.targetMaxReps;
                            handleApplyReducedReps(
                              exerciseState.exerciseId,
                              Math.max(1, baseReps - 2)
                            );
                          }}
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-[#171717] border border-[#303030] text-zinc-300 font-bold text-[11px] cursor-pointer"
                        >
                          <span>-2 reps</span>
                        </button>
                      </div>
                    )}
                </div>
              )}

              {/* Botón alternativo si ya están todas las series completadas */}
              {activeSetIndex < 0 && (
                <div className="pt-1">
                  {nextIncompleteExIdx >= 0 && viewMode === 'focus' ? (
                    <button
                      type="button"
                      onClick={() => setFocusedExerciseIndex(nextIncompleteExIdx)}
                      className="w-full min-h-[52px] py-3 px-5 rounded-2xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_6px_22px_var(--accent-glow)] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                      <span>EJERCICIO COMPLETADO · SIGUIENTE</span>
                      <ChevronRight className="w-4 h-4 stroke-[3]" />
                    </button>
                  ) : pendingExercisesCount === 0 ? (
                    <button
                      type="button"
                      onClick={handleRequestFinish}
                      className="w-full min-h-[52px] py-3 px-5 rounded-2xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_6px_22px_var(--accent-glow)] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                      <span>FINALIZAR ENTRENAMIENTO</span>
                    </button>
                  ) : (
                    <div className="w-full min-h-[44px] py-2.5 px-4 rounded-2xl bg-[#090909] border border-accent/50 text-accent-text font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Todas las series completadas</span>
                    </div>
                  )}
                </div>
              )}

              {/* 5. DESCANSO AUTOMÁTICO INTEGRADO (Nunca bloquea navegación) */}
              <div className="rounded-2xl bg-[#090909] border border-[#303030] p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setAutoRestEnabled((prev) => !prev)}
                    className="flex items-center gap-2 text-xs font-bold text-zinc-300 hover:text-[#F5F5F5] cursor-pointer"
                    title="Activar o desactivar inicio automático del descanso"
                  >
                    <Timer className="w-3.5 h-3.5 text-accent-text" />
                    <span>
                      {restTimer.active
                        ? restTimer.paused
                          ? 'Descanso en pausa'
                          : 'Descanso en curso'
                        : autoRestEnabled
                        ? 'Descanso automático'
                        : 'Descanso manual'}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold ${
                        autoRestEnabled ? 'text-accent-text' : 'text-zinc-500'
                      }`}
                    >
                      ({autoRestEnabled ? 'ON' : 'OFF'})
                    </span>
                  </button>

                  <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
                    <span className="font-black text-sm sm:text-base text-white drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]">
                      {restTimer.active
                        ? formatRestMmSs(restTimer.paused ? restTimer.remainingSeconds : liveRestRemaining)
                        : formatRestMmSs(exerciseRestSec)}
                    </span>
                    <span className="text-[11px] font-bold text-zinc-300">
                      (
                      {restTimer.active
                        ? `${restTimer.paused ? restTimer.remainingSeconds : liveRestRemaining} s`
                        : `${exerciseRestSec} s`}
                      {restTimer.active &&
                      restTimer.totalSeconds !== (restTimer.paused ? restTimer.remainingSeconds : liveRestRemaining)
                        ? ` / ${restTimer.totalSeconds} s`
                        : ''}
                      )
                    </span>
                  </div>
                </div>

                {!restTimer.active && restCompleteNotice && (
                  <div
                    data-testid="active-workout-rest-complete-notice"
                    role="status"
                    aria-live="assertive"
                    className="rounded-xl bg-[#171717] border border-accent px-3 py-2.5 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src="/notification-icon-192.png"
                          alt="LazcaKong Gym"
                          className="w-8 h-8 rounded-xl object-cover border border-[#CCFF00]/60 bg-[#090909] shrink-0"
                        />
                        <div className="min-w-0">
                          <span className="text-xs font-black uppercase tracking-wider text-accent-text block">
                            {restCompleteNotice.title}
                          </span>
                          <span className="text-xs font-semibold text-zinc-200 block">
                            {buildRestCompleteNotificationBody(
                              restCompleteNotice.exerciseName,
                              restCompleteNotice.nextSetNumber
                            )}
                          </span>
                        </div>
                      </div>
                      {onDismissRestCompleteNotice && (
                        <button
                          type="button"
                          onClick={onDismissRestCompleteNotice}
                          className="w-7 h-7 rounded-lg bg-[#090909] border border-[#303030] text-zinc-300 flex items-center justify-center shrink-0 cursor-pointer"
                          aria-label="Cerrar aviso de descanso terminado"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {onDismissRestCompleteNotice && (
                      <button
                        type="button"
                        onClick={onDismissRestCompleteNotice}
                        className="w-full min-h-[36px] px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Continuar entrenamiento</span>
                      </button>
                    )}
                  </div>
                )}

                {restTimer.active && (
                  <div className="space-y-2 pt-1.5 border-t border-[#303030]/80">
                    <div className="relative w-full h-3.5 bg-[#121212] rounded-lg border border-[#303030] overflow-visible p-0.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.9)]">
                      <div
                        className="h-full rounded-md bg-gradient-to-r from-yellow-400 via-orange-500 to-red-600 transition-all duration-300 shadow-[0_0_12px_rgba(249,115,22,0.6)] relative overflow-visible"
                        style={{
                          width: `${
                            restTimer.totalSeconds > 0
                              ? Math.min(
                                  100,
                                  Math.max(
                                    0,
                                    ((restTimer.paused ? restTimer.remainingSeconds : liveRestRemaining) /
                                      restTimer.totalSeconds) *
                                      100
                                  )
                                )
                              : 0
                          }%`,
                        }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-white/30 to-transparent pointer-events-none rounded-md" />

                        {/* Realistic Animated Flame & Rising Embers at active tip */}
                        <div className="absolute -right-2 -top-3.5 w-6 h-7 pointer-events-none z-20 flex items-center justify-center overflow-visible">
                          <div className="absolute w-5 h-5 bg-orange-500/40 rounded-full blur-sm animate-pulse" />
                          <svg
                            viewBox="0 0 24 32"
                            className="w-5 h-7 animate-rest-flame drop-shadow-[0_0_6px_rgba(255,100,0,0.9)] overflow-visible"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M12 0C12 0 4 8 4 15C4 20.5 8 24 12 32C16 24 20 20.5 20 15C20 8 12 0 12 0Z"
                              fill="url(#flameGrad)"
                            />
                            <path
                              d="M12 6C12 6 8 12 8 17C8 20 10 22 12 26C14 22 16 20 16 17C16 12 12 6 12 6Z"
                              fill="url(#innerFlameGrad)"
                            />
                            <defs>
                              <linearGradient id="flameGrad" x1="12" y1="0" x2="12" y2="32" gradientUnits="userSpaceOnUse">
                                <stop offset="0%" stopColor="#FEF08A" />
                                <stop offset="40%" stopColor="#FB923C" />
                                <stop offset="100%" stopColor="#DC2626" />
                              </linearGradient>
                              <linearGradient id="innerFlameGrad" x1="12" y1="6" x2="12" y2="26" gradientUnits="userSpaceOnUse">
                                <stop offset="0%" stopColor="#FEF08A" />
                                <stop offset="50%" stopColor="#FACC15" />
                                <stop offset="100%" stopColor="#F97316" />
                              </linearGradient>
                            </defs>
                          </svg>
                          <div className="absolute top-0 right-0 w-1 h-1 bg-yellow-300 rounded-full blur-[0.5px] animate-ember-1" />
                          <div className="absolute top-1 left-0.5 w-1 h-1 bg-orange-400 rounded-full blur-[0.5px] animate-ember-2" />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-1.5 flex-wrap">
                      <div className="flex items-center gap-1">
                        {onAdjustRestTimer && (
                          <>
                            <button
                              type="button"
                              onClick={() => onAdjustRestTimer(-15)}
                              className="min-h-[34px] px-2.5 rounded-lg bg-[#171717] border border-[#303030] text-zinc-300 text-[11px] font-mono font-bold cursor-pointer"
                            >
                              -15s
                            </button>
                            <button
                              type="button"
                              onClick={() => onAdjustRestTimer(15)}
                              className="min-h-[34px] px-2.5 rounded-lg bg-[#171717] border border-[#303030] text-accent-text text-[11px] font-mono font-bold cursor-pointer"
                            >
                              +15s
                            </button>
                          </>
                        )}
                        {onRestartRestTimer && (
                          <button
                            type="button"
                            onClick={onRestartRestTimer}
                            className="min-h-[34px] w-8 rounded-lg bg-[#171717] border border-[#303030] text-zinc-300 flex items-center justify-center cursor-pointer"
                            title="Reiniciar descanso"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {onPauseRestTimer && onResumeRestTimer && (
                          <button
                            type="button"
                            onClick={() =>
                              restTimer.paused ? onResumeRestTimer() : onPauseRestTimer()
                            }
                            className="min-h-[34px] px-3 rounded-lg bg-[#171717] border border-[#303030] text-[#F5F5F5] text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            {restTimer.paused ? (
                              <>
                                <Play className="w-3 h-3 text-accent-text fill-current" />
                                <span>Reanudar</span>
                              </>
                            ) : (
                              <>
                                <Pause className="w-3 h-3" />
                                <span>Pausar</span>
                              </>
                            )}
                          </button>
                        )}
                        {onStopRestTimer && (
                          <button
                            type="button"
                            onClick={onStopRestTimer}
                            className="min-h-[34px] px-3 rounded-lg bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black uppercase flex items-center gap-1 cursor-pointer"
                          >
                            <span>Saltar</span>
                            <SkipForward className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {onUpdateProfile && activeProfile && (
                  <div
                    data-testid="rest-alert-mode-selector"
                    className="flex items-center gap-1.5 pt-1 border-t border-[#303030]/60 flex-wrap"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateProfile({ soundEnabled: true, vibrationEnabled: true })
                      }
                      className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                        activeProfile.soundEnabled !== false
                          ? 'bg-accent/15 border-accent text-accent-text'
                          : 'bg-[#171717] border-[#303030] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>Pitido final</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateProfile({ soundEnabled: false, vibrationEnabled: true })
                      }
                      className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                        activeProfile.soundEnabled === false &&
                        activeProfile.vibrationEnabled !== false
                          ? 'bg-accent/15 border-accent text-accent-text'
                          : 'bg-[#171717] border-[#303030] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <Smartphone className="w-3 h-3" />
                      <span>Solo vibración</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateProfile({ soundEnabled: false, vibrationEnabled: false })
                      }
                      className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                        activeProfile.soundEnabled === false &&
                        activeProfile.vibrationEnabled === false
                          ? 'bg-accent/15 border-accent text-accent-text'
                          : 'bg-[#171717] border-[#303030] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <VolumeX className="w-3 h-3" />
                      <span>Silencio</span>
                    </button>
                  </div>
                )}

                {isCapacitorAndroidRuntime() &&
                  androidRestCaps &&
                  (!androidRestCaps.notificationsEnabled || !androidRestCaps.canScheduleExactAlarms) && (
                    <div
                      data-testid="android-rest-setup-banner"
                      className="rounded-xl bg-amber-500/10 border border-amber-500/40 px-2.5 py-2 flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="text-amber-200 font-semibold leading-tight">
                        {!androidRestCaps.notificationsEnabled
                          ? 'Activa notificaciones para ver el cronómetro en barra y pantalla bloqueada.'
                          : 'Activa "Alarmas y recordatorios" para despertar exacto al 00:00.'}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!androidRestCaps.notificationsEnabled) {
                            const perm = await requestNativeNotificationPermission();
                            if (perm !== 'granted') {
                              await openNativeRestSettingScreen('notifications');
                            }
                          } else {
                            await openNativeRestSettingScreen('exact_alarms');
                          }
                          const refreshed = await getNativeRestTimerCapabilities();
                          if (refreshed) setAndroidRestCaps(refreshed);
                        }}
                        className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500 text-black font-black text-[10px] cursor-pointer"
                      >
                        Activar
                      </button>
                    </div>
                  )}
              </div>

              {/* Controles sutiles de series + nota técnica */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onAddSet(exerciseState.exerciseId)}
                    className="min-h-[36px] px-3 py-1 rounded-xl bg-[#090909] hover:bg-[#222222] text-accent-text border border-[#303030] text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agregar serie</span>
                  </button>
                  {exerciseState.sets.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        onRemoveSet(
                          exerciseState.exerciseId,
                          exerciseState.sets.length - 1
                        )
                      }
                      className="min-h-[36px] px-3 py-1 rounded-xl bg-[#090909] hover:bg-[#EF4444]/15 border border-[#303030] text-zinc-400 hover:text-[#EF4444] text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                      <span>Quitar</span>
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="Nota técnica..."
                  value={exerciseState.notes || ''}
                  onChange={(e) => onUpdateNotes(exerciseState.exerciseId, e.target.value)}
                  className="min-h-[36px] rounded-xl bg-[#090909] border border-[#303030] focus:border-accent focus:outline-none px-3 py-1 text-xs text-[#F5F5F5] placeholder:text-zinc-500 sm:w-56"
                />
              </div>
            </section>
          );
        })}
      </div>

      {/* 6. NAVEGACIÓN ENTRE EJERCICIOS (Anterior · Todos · Siguiente) */}
      {viewMode === 'focus' ? (
        <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
          <button
            type="button"
            disabled={focusedExerciseIndex <= 0}
            onClick={() => setFocusedExerciseIndex((i) => Math.max(0, i - 1))}
            className="min-h-[44px] px-2.5 py-2 rounded-xl text-xs font-bold text-zinc-400 hover:text-[#F5F5F5] disabled:opacity-35 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Ejercicio anterior</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExerciseDrawerOpen(true)}
            className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#171717] border border-[#303030] hover:border-accent/60 text-xs font-bold text-[#F5F5F5] flex items-center gap-1.5 cursor-pointer"
          >
            <LayoutList className="w-3.5 h-3.5 text-accent-text" />
            <span>Todos ({activeSession.exercises.length})</span>
          </button>

          <button
            type="button"
            disabled={
              focusedExerciseIndex >= activeSession.exercises.length - 1 &&
              findNextIncompleteExerciseIndex(focusedExerciseIndex) < 0
            }
            onClick={() => {
              if (focusedExerciseIndex < activeSession.exercises.length - 1) {
                setFocusedExerciseIndex((i) => i + 1);
              } else {
                const pendingIdx = findNextIncompleteExerciseIndex(focusedExerciseIndex);
                if (pendingIdx >= 0) setFocusedExerciseIndex(pendingIdx);
              }
            }}
            className="min-h-[44px] px-2.5 py-2 rounded-xl text-xs font-black text-accent-text hover:opacity-85 disabled:opacity-35 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>
              {focusedExerciseIndex >= activeSession.exercises.length - 1 &&
              findNextIncompleteExerciseIndex(focusedExerciseIndex) >= 0
                ? 'Ir a pendiente'
                : 'Siguiente ejercicio'}
            </span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-1">
          <button
            type="button"
            onClick={() => setViewMode('focus')}
            className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#171717] border border-[#303030] text-xs font-bold text-accent-text flex items-center gap-1.5 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Volver a Ejercicio Actual</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExercisePickerOpen(true)}
            className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#171717] border border-[#303030] text-xs font-bold text-[#F5F5F5] flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-accent-text" />
            <span>Agregar Ejercicio</span>
          </button>
        </div>
      )}

      {/* Acción inferior segura para Finalizar cuando el atleta prefiere cerrar al final */}
      <div className="grid grid-cols-2 gap-2.5 pt-1">
        <button
          type="button"
          onClick={() => setIsExercisePickerOpen(true)}
          className="min-h-[44px] py-2.5 px-3 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-zinc-200 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-accent-text" />
          <span>+ Ejercicio</span>
        </button>

        <button
          type="button"
          onClick={handleRequestFinish}
          className="min-h-[44px] py-2.5 px-3 rounded-xl bg-[#171717] hover:bg-[#222222] border border-accent/60 text-accent-text font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Finalizar Sesión</span>
        </button>
      </div>

      {/* ==========================================================================
          DRAWER: VER TODOS LOS EJERCICIOS Y SALTAR / REGRESAR A PENDIENTES
         ========================================================================== */}
      {isExerciseDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-[#090909] border-t sm:border border-[#303030] rounded-t-3xl sm:rounded-3xl max-h-[82vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[#303030] flex items-center justify-between gap-3 bg-[#171717]">
              <div>
                <span className="block text-[10px] font-black uppercase tracking-wider text-accent-text">
                  NAVEGACIÓN DE LA SESIÓN
                </span>
                <h3 className="text-base font-black text-[#F5F5F5] uppercase">
                  Ejercicios ({fullyCompletedExercisesCount}/{activeSession.exercises.length})
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setViewMode((m) => (m === 'focus' ? 'list' : 'focus'));
                    setIsExerciseDrawerOpen(false);
                  }}
                  className="min-h-[36px] px-3 py-1 rounded-lg bg-[#090909] border border-[#303030] text-[11px] font-bold text-accent-text cursor-pointer"
                >
                  {viewMode === 'focus' ? 'Ver lista completa' : 'Modo enfoque'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsExerciseDrawerOpen(false)}
                  className="w-9 h-9 rounded-xl bg-[#090909] border border-[#303030] text-zinc-400 hover:text-[#F5F5F5] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {activeSession.exercises.map((ex, idx) => {
                const doneCount = ex.sets.filter((s) => s.completed).length;
                const isDone = ex.sets.length > 0 && doneCount === ex.sets.length;
                const isCurrent = idx === focusedExerciseIndex;

                return (
                  <button
                    key={ex.exerciseId}
                    type="button"
                    onClick={() => {
                      setFocusedExerciseIndex(idx);
                      setIsExerciseDrawerOpen(false);
                      if (viewMode === 'list') {
                        const el = document.getElementById(`workout-ex-${ex.exerciseId}`);
                        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                    className={`w-full text-left p-3.5 rounded-2xl border flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-[#171717] border-accent'
                        : 'bg-[#171717] border-[#303030] hover:border-zinc-500'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl font-mono font-black text-xs flex items-center justify-center shrink-0 border ${
                          isDone
                            ? 'bg-accent text-accent-contrast border-accent'
                            : isCurrent
                            ? 'bg-[#090909] text-accent-text border-accent'
                            : 'bg-[#090909] text-zinc-400 border-[#303030]'
                        }`}
                      >
                        {isDone ? <Check className="w-4 h-4 stroke-[3]" /> : idx + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-black text-[#F5F5F5] leading-snug line-clamp-2">
                          {ex.activeExerciseName}
                        </p>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          {ex.targetMuscles} ·{' '}
                          <span className={isDone ? 'text-accent-text font-bold' : ''}>
                            {doneCount}/{ex.sets.length} series
                          </span>
                        </p>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-black uppercase px-2 py-1 rounded-md shrink-0 ${
                        isCurrent
                          ? 'text-accent-text'
                          : isDone
                          ? 'text-accent-text'
                          : doneCount > 0
                          ? 'text-zinc-200'
                          : 'text-zinc-500'
                      }`}
                    >
                      {isCurrent
                        ? 'Actual'
                        : isDone
                        ? 'Listo'
                        : doneCount > 0
                        ? 'Incompleto'
                        : 'Pendiente'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          MODAL 1: SUSTITUCIÓN INTELIGENTE DE EJERCICIO (FASE 7)
         ========================================================================== */}
      {manualSwapTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-[#090909] border-t sm:border border-[#303030] rounded-t-3xl sm:rounded-3xl p-4 sm:p-6 shadow-2xl space-y-4 max-h-[88vh] flex flex-col">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#303030]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#171717] text-accent-text border border-accent/40 flex items-center justify-center shrink-0">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[10px] font-black uppercase tracking-wider text-accent-text">
                    SUSTITUCIÓN BIOMECÁNICA DE EJERCICIO
                  </span>
                  <h3 className="text-base font-black text-[#F5F5F5] leading-snug">
                    Cambiar: {manualSwapTarget.name}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Músculo: <strong className="text-zinc-200">{manualSwapTarget.targetMuscles}</strong> · Conserva historial original
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setManualSwapTarget(null)}
                className="w-10 h-10 rounded-xl bg-[#171717] border border-[#303030] text-zinc-400 hover:text-[#F5F5F5] flex items-center justify-center shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {/* 1. Motivo del cambio */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
                  Motivo de la Sustitución:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSwapReason('occupied')}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-center transition-all cursor-pointer ${
                      swapReason === 'occupied'
                        ? 'bg-accent text-accent-contrast border-accent'
                        : 'bg-[#171717] text-zinc-300 border-[#303030]'
                    }`}
                  >
                    🏢 Máquina Ocupada
                  </button>
                  <button
                    type="button"
                    onClick={() => setSwapReason('no_equipment')}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-center transition-all cursor-pointer ${
                      swapReason === 'no_equipment'
                        ? 'bg-accent text-accent-contrast border-accent'
                        : 'bg-[#171717] text-zinc-300 border-[#303030]'
                    }`}
                  >
                    🎒 Sin Equipo
                  </button>
                  <button
                    type="button"
                    onClick={() => setSwapReason('pain_restriction')}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-center transition-all cursor-pointer ${
                      swapReason === 'pain_restriction'
                        ? 'bg-amber-500 text-black border-amber-400'
                        : 'bg-[#171717] text-zinc-300 border-[#303030]'
                    }`}
                  >
                    ⚠️ Dolor / Lesión
                  </button>
                </div>
                {swapReason === 'pain_restriction' && (
                  <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-xl leading-snug font-sans">
                    <strong>Aviso preventivo:</strong> Las recomendaciones biomecánicas no garantizan ausencia de lesión ni sustituyen criterio médico. Consulta a un especialista si experimentas dolor agudo.
                  </p>
                )}
              </div>

              {/* 2. Ámbito de Aplicación (Scope) y Carga */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
                    Ámbito del Cambio:
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSwapScope('session')}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold text-center transition-all cursor-pointer ${
                        swapScope === 'session'
                          ? 'bg-accent text-accent-contrast border-accent'
                          : 'bg-[#171717] text-zinc-300 border-[#303030]'
                      }`}
                    >
                      🔄 Solo Sesión
                    </button>
                    <button
                      type="button"
                      onClick={() => setSwapScope('permanent')}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold text-center transition-all cursor-pointer ${
                        swapScope === 'permanent'
                          ? 'bg-accent text-accent-contrast border-accent'
                          : 'bg-[#171717] text-zinc-300 border-[#303030]'
                      }`}
                    >
                      💾 En Rutina
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
                    Carga Inicial (kg):
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="Definir carga (0 si inicia)"
                    value={replacementWeight}
                    onChange={(e) => setReplacementWeight(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-xl bg-[#171717] border border-[#303030] text-xs font-mono text-accent-text focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="relative pt-1">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 translate-y-0.5" />
                <input
                  type="text"
                  value={manualSwapSearch}
                  onChange={(e) => setManualSwapSearch(e.target.value)}
                  placeholder="Buscar alternativa por nombre o máquina..."
                  className="w-full min-h-[42px] pl-10 pr-4 py-2 rounded-xl bg-[#171717] border border-[#303030] text-xs text-[#F5F5F5] placeholder-zinc-500 focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                {EQUIPMENT_FILTERS.map((eq) => (
                  <button
                    key={eq}
                    type="button"
                    onClick={() => setSwapEquipmentFilter(eq)}
                    className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                      swapEquipmentFilter === eq
                        ? 'bg-accent text-accent-contrast border-accent font-black'
                        : 'bg-[#171717] text-zinc-400 hover:text-[#F5F5F5] border-[#303030]'
                    }`}
                  >
                    {eq}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {compatibleSwapList.length === 0 ? (
                <div className="p-6 text-center rounded-2xl bg-[#171717] border border-[#303030] text-xs text-zinc-400">
                  No se encontraron alternativas con ese filtro. Prueba cambiando el filtro de equipo o músculo.
                </div>
              ) : (
                <>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-accent-text px-1">
                    Top Recomendaciones Destacadas y Alternativas ({compatibleSwapList.length})
                  </div>
                  {compatibleSwapList.map(({ item: official, itemPattern, isSamePattern }, idx) => (
                    <button
                      key={official.id}
                      type="button"
                      onClick={() => {
                        if (onReplaceActiveExercise) {
                          const reasonLabel =
                            swapReason === 'occupied' ? 'Máquina ocupada' :
                            swapReason === 'no_equipment' ? 'Falta de equipo' :
                            swapReason === 'pain_restriction' ? 'Limitación física o dolor' : 'Motivo general';

                          setLiveCoachEvaluationsByEx((prev) => {
                            const next = { ...prev };
                            delete next[manualSwapTarget.id];
                            return next;
                          });

                          onReplaceActiveExercise(manualSwapTarget.id, {
                            newName: official.name,
                            libraryExerciseId: official.id,
                            targetMuscles: official.muscleGroup,
                            equipment: official.equipment,
                            notes: `Sustituyó a ${manualSwapTarget.originalName} (${reasonLabel})`,
                          });

                          if (swapScope === 'permanent' && activeSession && onUpdateRoutine) {
                            const routine = routines.find((r) => r.id === activeSession.routineId);
                            if (routine) {
                              const updatedRoutine: Routine = {
                                ...routine,
                                exercises: routine.exercises.map((ex) =>
                                  ex.id === manualSwapTarget.id || ex.name === manualSwapTarget.originalName
                                    ? {
                                        ...ex,
                                        name: official.name,
                                        targetMuscles: official.muscleGroup,
                                        equipment: official.equipment,
                                        defaultWeight: replacementWeight !== '' ? Number(replacementWeight) : ex.defaultWeight,
                                      }
                                    : ex
                                ),
                              };
                              onUpdateRoutine(updatedRoutine);
                            }
                          }
                        }
                        setManualSwapTarget(null);
                      }}
                      className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 group cursor-pointer ${
                        idx < 3
                          ? 'bg-[#171717] border-accent/60 hover:border-accent shadow-md'
                          : 'bg-[#171717]/80 hover:bg-[#222222] border-[#303030]'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        {official.thumbnailUrl ? (
                          <img
                            src={official.thumbnailUrl}
                            alt={official.name}
                            className="w-12 h-12 rounded-xl object-cover shrink-0 border border-[#303030]"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-[#090909] text-accent-text border border-[#303030] flex items-center justify-center shrink-0">
                            <Dumbbell className="w-5 h-5" />
                          </div>
                        )}
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                            {idx === 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-accent text-accent-contrast font-black uppercase">
                                ★ Top Recomendación
                              </span>
                            )}
                            {isSamePattern && (
                              <span className="text-accent-text font-bold">
                                Patrón Equivalente ({itemPattern})
                              </span>
                            )}
                            <span className="text-zinc-400">
                              {official.muscleGroup} · {official.equipment || 'Estándar'}
                            </span>
                          </div>
                          <span className="text-xs sm:text-sm font-bold text-[#F5F5F5] group-hover:text-accent-text block truncate">
                            {official.name}
                          </span>
                          <p className="text-[11px] text-zinc-400 font-sans truncate">
                            {idx === 0 ? 'Máxima coincidencia biomecánica y de patrón de movimiento.' : 'Alternativa compatible con el grupo objetivo.'}
                          </p>
                        </div>
                      </div>
                      <span className="px-3.5 py-2 rounded-xl bg-[#090909] group-hover:bg-accent text-zinc-200 group-hover:text-accent-contrast font-black text-xs uppercase shrink-0 transition-colors">
                        Elegir
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          MODAL 2: AGREGAR EJERCICIO A LA SESIÓN ACTIVA
         ========================================================================== */}
      {isExercisePickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-[#090909] border-t sm:border border-[#303030] rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-[#303030] flex items-center justify-between gap-3 bg-[#171717]">
              <div>
                <h3 className="text-base font-black text-[#F5F5F5] uppercase">
                  Agregar Ejercicio a la Sesión
                </h3>
                <p className="text-xs text-zinc-400">
                  Selecciona cualquier ejercicio del catálogo biomecánico
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsExercisePickerOpen(false)}
                className="min-h-[40px] min-w-[40px] rounded-xl bg-[#090909] border border-[#303030] text-zinc-400 hover:text-[#F5F5F5] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 border-b border-[#303030] space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por nombre o equipo (ej. Press banca, Polea)..."
                  className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-[#171717] border border-[#303030] focus:border-accent focus:outline-none text-xs text-[#F5F5F5]"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                {MUSCLE_GROUPS.map((muscle) => (
                  <button
                    key={muscle}
                    type="button"
                    onClick={() => setSelectedMuscleFilter(muscle)}
                    className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      selectedMuscleFilter === muscle
                        ? 'bg-accent text-accent-contrast font-black'
                        : 'bg-[#171717] text-zinc-400 hover:text-[#F5F5F5] border border-[#303030]'
                    }`}
                  >
                    {muscle}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400 px-0.5">
                <span>
                  Mostrando{' '}
                  <strong className="text-[#F5F5F5] tabular-nums">{filteredCatalog.length}</strong>{' '}
                  de{' '}
                  <strong className="text-[#F5F5F5] tabular-nums">{EXERCISE_LIBRARY.length}</strong>{' '}
                  ejercicios
                </span>
                {selectedMuscleFilter !== 'Todos' && (
                  <span className="font-bold text-accent-text">{selectedMuscleFilter}</span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#303030]/60 p-2">
              {filteredCatalog.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <p className="text-xs text-zinc-400">
                    No hay ejercicios que coincidan con los filtros actuales.
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="px-3 py-1.5 rounded-lg bg-[#171717] border border-[#303030] text-xs font-bold text-[#F5F5F5] hover:border-accent cursor-pointer"
                      >
                        Limpiar búsqueda
                      </button>
                    )}
                    {selectedMuscleFilter !== 'Todos' && (
                      <button
                        type="button"
                        onClick={() => setSelectedMuscleFilter('Todos')}
                        className="px-3 py-1.5 rounded-lg bg-accent text-accent-contrast text-xs font-black cursor-pointer"
                      >
                        Ver todos
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                filteredCatalog.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 flex items-center justify-between gap-3 hover:bg-[#171717] rounded-xl transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-[#F5F5F5] leading-snug">
                        {item.name}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5">
                        <span>{item.muscleGroup}</span>
                        {item.equipment && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{item.equipment}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onAddExerciseToSession(libraryItemToExercise(item));
                        setIsExercisePickerOpen(false);
                      }}
                      className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Añadir</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          MODAL 3: CONFIRMACIÓN PARA DESCARTAR SESIÓN
         ========================================================================== */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-3xl bg-[#090909] border border-[#EF4444]/60 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#171717] border border-[#EF4444]/40 text-[#EF4444] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-[#F5F5F5] uppercase">
                  ¿Descartar entrenamiento?
                </h3>
                <p className="text-xs text-zinc-400">
                  Se perderán las series registradas en esta sesión activa.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="flex-1 min-h-[44px] rounded-xl bg-[#171717] border border-[#303030] text-[#F5F5F5] text-xs font-bold cursor-pointer"
              >
                Seguir entrenando
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  onCancelWorkout();
                }}
                className="flex-1 min-h-[44px] rounded-xl bg-[#EF4444] text-white text-xs font-black uppercase cursor-pointer"
              >
                Sí, descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          MODAL 4: CONFIRMACIÓN AL FINALIZAR CON EJERCICIOS PENDIENTES
         ========================================================================== */}
      {showFinishIncompleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-3xl bg-[#090909] border border-accent p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#171717] border border-accent/40 text-accent-text flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-[#F5F5F5] uppercase">
                  Finalizar sesión
                </h3>
                <p className="text-xs text-zinc-400">
                  {completedSets === 0
                    ? 'Aún no has marcado ninguna serie como completada.'
                    : `Tienes ${pendingExercisesCount} ejercicio(s) con series pendientes. Solo se guardarán las ${completedSets} series completadas.`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowFinishIncompleteConfirm(false)}
                className="flex-1 min-h-[44px] rounded-xl bg-[#171717] border border-[#303030] text-[#F5F5F5] text-xs font-bold cursor-pointer"
              >
                Volver a la sesión
              </button>
              {completedSets > 0 && (
                <button
                  type="button"
                  onClick={handleConfirmFinish}
                  className="flex-1 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black uppercase cursor-pointer"
                >
                  Guardar ({completedSets} series)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Aviso Flotante de Retroalimentación */}
      {overloadNotice && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md p-3.5 rounded-2xl shadow-2xl flex items-center gap-3 bg-[#090909]/95 border border-accent backdrop-blur-xl">
          <div className="w-9 h-9 rounded-xl bg-accent text-accent-contrast flex items-center justify-center shrink-0 font-black">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono font-black uppercase tracking-wider text-accent-text">
              {overloadNotice.exerciseName}
            </div>
            <div className="text-xs font-bold text-[#F5F5F5] leading-snug">
              {overloadNotice.message}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOverloadNotice(null)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-[#F5F5F5] shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Machine Vision Scanner Modal */}
      <MachineScannerModal
        isOpen={!!exerciseToScan}
        onClose={() => setExerciseToScan(null)}
        exerciseToReplace={exerciseToScan}
        routineTitle={activeSession?.routineTitle}
        onConfirmReplacement={(exerciseId, replacement) => {
          setLiveCoachEvaluationsByEx((prev) => {
            const next = { ...prev };
            delete next[exerciseId];
            return next;
          });
          if (onReplaceActiveExercise) {
            onReplaceActiveExercise(exerciseId, replacement);
          }
        }}
      />
    </div>
  );
};
