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
} from 'lucide-react';
import {
  ActiveWorkoutSession,
  CompletedWorkout,
  Exercise,
  LibraryExercise,
  PersonalRecord,
  Profile,
  RestTimerState,
  Routine,
} from '../types';
import { EXERCISE_LIBRARY, resolveLibraryExercise } from '../data/exerciseLibrary';
import {
  evaluateDoubleProgression,
  calculateNextSetByRpe,
} from '../utils/progressionEngine';
import { MachineScannerModal } from '../components/MachineScannerModal';
import { RecommendedLoadForecastWidget } from '../components/RecommendedLoadForecastWidget';
import { MUSCLE_CONFIG, resolveExerciseMuscleImpact } from '../utils/muscleRecoveryEngine';
import { isSameWeekday } from '../utils/workoutAnalyticsEngine';
import { formatDateKeyYYYYMMDD } from '../utils/exportReport';

interface ActiveWorkoutViewProps {
  activeSession: ActiveWorkoutSession | null;
  routines: Routine[];
  prs: Record<string, PersonalRecord>;
  history?: CompletedWorkout[];
  activeProfile?: Profile;
  restTimer: RestTimerState;
  onStartWorkout: (routine: Routine) => void;
  onStartFreeWorkout: (customTitle?: string, initialExercises?: Exercise[]) => void;
  onAddExerciseToSession: (exercise: Exercise) => void;
  onRemoveExerciseFromSession: (exerciseId: string) => void;
  onAddWarmupSets: (exerciseId: string, baseWeight?: number) => void;
  onStartRestTimer: (seconds: number, exerciseName?: string) => void;
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
      targetMuscles?: string;
      equipment?: string;
      notes?: string;
      restSeconds?: number;
    }
  ) => void;
  onUpdateNotes: (exerciseId: string, notes: string) => void;
  onFinishWorkout: () => void;
  onCancelWorkout: () => void;
  onOpenExerciseModal: (exercise: Exercise) => void;
  onOpenPlateCalculator: (weight?: number) => void;
  onNavigateRoutines: () => void;
}

const MUSCLE_GROUPS = [
  'Todos',
  'Pectorales',
  'Espalda',
  'Cuádriceps',
  'Isquiotibiales',
  'Glúteos',
  'Hombros',
  'Bíceps',
  'Tríceps',
  'Pantorrillas',
  'Abdominales',
];

const EQUIPMENT_FILTERS = [
  'Todos',
  'Mancuernas',
  'Barras',
  'Poleas',
  'Máquinas',
  'Peso corporal',
] as const;

type EquipmentFilterType = (typeof EQUIPMENT_FILTERS)[number];

const REST_PRESET_SECONDS = [45, 60, 90, 120, 180];

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
  itemEquipment: string | undefined,
  filter: EquipmentFilterType
): boolean {
  if (filter === 'Todos') return true;
  const norm = normalizeTextSimple(itemEquipment);
  if (filter === 'Mancuernas') return /mancuerna|dumbbell|kettlebell|pesa rusa/i.test(norm);
  if (filter === 'Barras') return /barra|barbell|ez|olimpica|hexagonal/i.test(norm);
  if (filter === 'Poleas') return /polea|cable|cuerda/i.test(norm);
  if (filter === 'Máquinas')
    return /maquina|machine|multipower|smith|prensa|jaca|hack|palanca/i.test(norm);
  if (filter === 'Peso corporal')
    return /peso corporal|bodyweight|propio peso|paralelas|dominada|barra fija|suelo/i.test(norm);
  return true;
}

function resolveMovementPattern(name: string, muscleGroup?: string): string {
  const n = normalizeTextSimple(name);
  const m = normalizeTextSimple(muscleGroup);
  if (/press de banca|press plano|press inclinado|press declinado|chest press|fondos/.test(n)) {
    return 'Empuje Horizontal';
  }
  if (/aperturas|fly|cruces en polea|pec deck|contractor/.test(n)) {
    return 'Aducción Pectoral';
  }
  if (/press militar|press hombro|overhead|arnold/.test(n)) {
    return 'Empuje Vertical';
  }
  if (/elevacion lateral|elevaciones laterales|pajaros|face pull|remo al menton/.test(n)) {
    return 'Aislamiento Deltoides';
  }
  if (/dominada|jalon|pulldown|pull up|chin up/.test(n)) {
    return 'Tracción Vertical';
  }
  if (/remo|row|seal row|t-bar/.test(n)) {
    return 'Tracción Horizontal';
  }
  if (/sentadilla|squat|prensa|hack|zancada|bulgara|lunge/.test(n)) {
    return 'Dominante de Rodilla';
  }
  if (/extension de cuadriceps|leg extension/.test(n)) {
    return 'Extensión de Rodilla';
  }
  if (/peso muerto|deadlift|rdl|rumano|buenos dias|hip thrust|puente de gluteo/.test(n)) {
    return 'Dominante de Cadera';
  }
  if (/curl femoral|leg curl|isquio/.test(n)) {
    return 'Flexión de Rodilla';
  }
  if (/curl|bicep|martillo|predicador/.test(n) || /bicep/.test(m)) {
    return 'Flexión de Codo';
  }
  if (/tricep|frances|copa|pushdown|extension.*tricep/.test(n) || /tricep/.test(m)) {
    return 'Extensión de Codo';
  }
  if (/gemelo|pantorrilla|soleo|calf/.test(n) || /pantorrilla|gemelo/.test(m)) {
    return 'Flexión Plantar';
  }
  return 'Patrón Compatible';
}

function libraryItemToExercise(item: LibraryExercise): Exercise {
  return {
    id: `cat-${item.id}`,
    name: item.name,
      libraryExerciseId: item.id,
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
    techniqueCues: [
      'Controla la fase excéntrica durante 2-3 segundos.',
      'Mantén estabilidad escapular y core firme en todo el recorrido.',
      'Evita impulsos o rebotes en el punto de máxima tensión.',
    ],
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
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatRestMmSs(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
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
  restTimer,
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
  onOpenExerciseModal,
  onOpenPlateCalculator,
  onNavigateRoutines,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Navigation & view mode inside active session (focus = protagonist exercise card)
  const [viewMode, setViewMode] = useState<'focus' | 'list'>('focus');
  const [focusedExerciseIndex, setFocusedExerciseIndex] = useState(0);
  const [autoRestEnabled, setAutoRestEnabled] = useState<boolean>(true);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [isExerciseDrawerOpen, setIsExerciseDrawerOpen] = useState(false);
  const [expandedHistoryByEx, setExpandedHistoryByEx] = useState<Record<string, boolean>>({});
  const [expandedToolsByEx, setExpandedToolsByEx] = useState<Record<string, boolean>>({});
  const [expandedRestByEx, setExpandedRestByEx] = useState<Record<string, boolean>>({});
  const [selectedSetIndexMap, setSelectedSetIndexMap] = useState<Record<string, number>>({});
  const [setValidationError, setSetValidationError] = useState<{
    exerciseId: string;
    setIndex: number;
    message: string;
  } | null>(null);
  const isCompletingSetRef = useRef(false);
  const lastSessionStartRef = useRef<number | null>(null);

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
    const jsDay = new Date().getDay();
    return ORDERED_WEEKDAYS.find((w) => w.jsDay === jsDay)?.name || 'Lunes';
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

  useEffect(() => {
    if (!overloadNotice) return;
    const t = window.setTimeout(() => setOverloadNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [overloadNotice]);

  useEffect(() => {
    if (!activeSession) {
      setElapsedSeconds(0);
      isFinishingRef.current = false;
      return;
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - activeSession.startTime) / 1000)));
    };
    updateElapsed();

    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [activeSession]);

  // Restore/initialize focused exercise index to first incomplete exercise when starting or recovering a session
  useEffect(() => {
    if (!activeSession) {
      lastSessionStartRef.current = null;
      setIsHeaderMenuOpen(false);
      setIsExerciseDrawerOpen(false);
      setSetValidationError(null);
      return;
    }

    if (lastSessionStartRef.current !== activeSession.startTime) {
      lastSessionStartRef.current = activeSession.startTime;
      const firstIncompleteIdx = activeSession.exercises.findIndex((ex) =>
        ex.sets.some((s) => !s.completed)
      );
      setFocusedExerciseIndex(firstIncompleteIdx >= 0 ? firstIncompleteIdx : 0);
      setViewMode('focus');
    } else if (focusedExerciseIndex >= activeSession.exercises.length) {
      setFocusedExerciseIndex(Math.max(0, activeSession.exercises.length - 1));
    }
  }, [activeSession, focusedExerciseIndex]);

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return EXERCISE_LIBRARY.filter((ex) => {
      const matchesMuscle =
        selectedMuscleFilter === 'Todos' || ex.muscleGroup === selectedMuscleFilter;
      if (!matchesMuscle) return false;
      if (!q) return true;
      return (
        ex.name.toLowerCase().includes(q) ||
        ex.muscleGroup.toLowerCase().includes(q) ||
        (ex.equipment && ex.equipment.toLowerCase().includes(q))
      );
    }).slice(0, 80);
  }, [searchQuery, selectedMuscleFilter]);

  // Compatible Exercise Substitutions List (Fase 7)
  const compatibleSwapList = useMemo(() => {
    if (!manualSwapTarget) return [];
    const targetPattern = resolveMovementPattern(
      manualSwapTarget.name,
      manualSwapTarget.targetMuscles
    );
    const targetNormMuscle = normalizeTextSimple(manualSwapTarget.targetMuscles);
    const q = normalizeTextSimple(manualSwapSearch);

    const scored = EXERCISE_LIBRARY.filter((item) => {
      if (normalizeTextSimple(item.name) === normalizeTextSimple(manualSwapTarget.name)) {
        return false;
      }
      if (!matchesEquipmentCategory(item.equipment, swapEquipmentFilter)) {
        return false;
      }
      if (swapMuscleFilter !== 'Todos' && swapMuscleFilter !== 'Compatible') {
        if (item.muscleGroup !== swapMuscleFilter) return false;
      }
      if (swapMuscleFilter === 'Compatible') {
        const itemMuscle = normalizeTextSimple(item.muscleGroup);
        const sameGroup =
          targetNormMuscle.includes(itemMuscle) ||
          itemMuscle.includes(targetNormMuscle) ||
          (/pecho|pectoral/.test(targetNormMuscle) && /pecho|pectoral/.test(itemMuscle)) ||
          (/espalda|dorsal/.test(targetNormMuscle) && /espalda|dorsal/.test(itemMuscle)) ||
          (/cuadricep|pierna/.test(targetNormMuscle) && /cuadricep/.test(itemMuscle)) ||
          (/isquio|femoral/.test(targetNormMuscle) && /isquio/.test(itemMuscle)) ||
          (/gluteo/.test(targetNormMuscle) && /gluteo/.test(itemMuscle)) ||
          (/hombro|deltoide/.test(targetNormMuscle) && /hombro/.test(itemMuscle)) ||
          (/bicep/.test(targetNormMuscle) && /bicep/.test(itemMuscle)) ||
          (/tricep/.test(targetNormMuscle) && /tricep/.test(itemMuscle));
        if (!sameGroup && !q) return false;
      }
      if (q) {
        return (
          normalizeTextSimple(item.name).includes(q) ||
          normalizeTextSimple(item.muscleGroup).includes(q) ||
          normalizeTextSimple(item.equipment).includes(q)
        );
      }
      return true;
    }).map((item) => {
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

  // Evaluate which routines were completed during the current week (Monday -> Sunday)
  const completedRoutineIdsThisWeek = useMemo(() => {
    const monday = getMondayOfCurrentWeek();
    const mondayMs = monday.getTime();
    const doneSet = new Set<string>();
    history.forEach((w) => {
      const wTime = w.startTime || new Date(w.date).getTime();
      if (wTime >= mondayMs) {
        if (w.routineId) doneSet.add(w.routineId);
        if (w.routineTitle) doneSet.add(normalizeTextSimple(w.routineTitle));
      }
    });
    return doneSet;
  }, [history]);

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

    return (
      <div className="space-y-4 pb-36 font-['Plus_Jakarta_Sans',sans-serif] text-[#F5F5F5]">
        {/* 1. ENCABEZADO COMPACTO ENTRENAMIENTO ELITE */}
        <header className="flex items-center justify-between gap-3 py-2 px-3 sm:px-4 bg-[#171717] border border-[#303030] rounded-2xl shadow-md">
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#CCFF00] leading-none mb-0.5">
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
              <Disc className="w-4 h-4 text-[#CCFF00]" />
              <span className="hidden xs:inline">Discos</span>
            </button>
            <button
              type="button"
              onClick={onNavigateRoutines}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#090909] hover:bg-[#222222] border border-[#303030] text-[#F5F5F5] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer active:scale-95"
            >
              <Dumbbell className="w-4 h-4 text-[#CCFF00]" />
              <span>Rutinas</span>
            </button>
          </div>
        </header>

        {/* 2. TARJETA PROTAGONISTA DE RUTINA + 3. BOTÓN COMENZAR ENTRENAMIENTO */}
        {activePreRoutine ? (
          <section className="rounded-2xl sm:rounded-3xl bg-[#171717] border border-[#303030] p-4 sm:p-5 shadow-[0_12px_36px_rgba(0,0,0,0.55)] space-y-3">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#CCFF00] uppercase tracking-wider">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>
                    {activePreRoutine.dayName}
                    {isSelectedRoutineToday ? ' · RUTINA DEL DÍA' : ' · RUTINA SELECCIONADA'}
                  </span>
                </div>

                {(completedRoutineIdsThisWeek.has(activePreRoutine.id) ||
                  completedRoutineIdsThisWeek.has(
                    normalizeTextSimple(activePreRoutine.title)
                  )) && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#CCFF00]">
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
                <span className="text-[#CCFF00] font-semibold">Enfoque muscular: </span>
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
                <span className="block text-base sm:text-lg font-black font-mono tabular-nums text-[#CCFF00] leading-snug">
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
              className="w-full min-h-[50px] py-3.5 px-5 rounded-xl sm:rounded-2xl bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_6px_22px_rgba(204,255,0,0.22)] active:scale-[0.99] transition-all cursor-pointer"
            >
              <Play className="w-4 h-4 fill-[#090909] text-[#090909]" />
              <span>COMENZAR ENTRENAMIENTO</span>
            </button>
          </section>
        ) : (
          <section className="rounded-2xl sm:rounded-3xl bg-[#171717] border border-[#303030] p-5 text-center space-y-3">
            <Dumbbell className="w-7 h-7 text-[#CCFF00] mx-auto" />
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
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl bg-[#CCFF00] text-[#090909] font-black text-xs uppercase tracking-wider cursor-pointer"
            >
              Configurar Rutinas
            </button>
          </section>
        )}

        {/* 4. TARJETAS DE EJERCICIOS PROGRAMADOS (Nombre destacado sobre categoría, miniatura específica y áreas táctiles >=44px) */}
        {activePreRoutine && activePreRoutine.exercises.length > 0 && (
          <section className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <div>
                <span className="block text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-[#CCFF00]">
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
                const query = normalizeTextSimple(ex.name);
                const libMatch = resolveLibraryExercise(ex);
                const thumbUrl = ex.thumbnailUrl || libMatch?.thumbnailUrl || undefined;
                const restSeconds = ex.restSeconds || 90;
                const restDisplay = ex.restText || `${restSeconds} seg`;
                const equipmentLabel = ex.equipment || libMatch?.equipment || 'Equipamiento Estándar';

                return (
                  <article
                    key={`${ex.id}-${idx}`}
                    className="rounded-xl sm:rounded-2xl bg-[#171717] border border-[#303030] p-3 sm:p-3.5 flex flex-col justify-between gap-2.5 hover:border-zinc-500 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Miniatura específica del catálogo cuando exista */}
                      {thumbUrl ? (
                        <button
                          type="button"
                          onClick={() => onOpenExerciseModal(ex)}
                          className="w-12 h-12 rounded-xl bg-[#090909] border border-[#303030] overflow-hidden shrink-0 relative cursor-pointer group"
                          title={`Ver técnica de ${ex.name}`}
                        >
                          <img
                            src={thumbUrl}
                            alt={ex.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            loading="lazy"
                          />
                          <span className="absolute top-0.5 left-0.5 px-1 rounded bg-[#090909]/90 text-[#CCFF00] font-mono font-black text-[9px]">
                            {idx + 1}
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpenExerciseModal(ex)}
                          className="w-12 h-12 rounded-xl bg-[#090909] border border-[#303030] flex flex-col items-center justify-center shrink-0 cursor-pointer hover:border-[#CCFF00]/50 transition-colors"
                          title={`Ver técnica de ${ex.name}`}
                        >
                          <span className="text-[10px] font-mono font-black text-[#CCFF00] leading-none">
                            #{idx + 1}
                          </span>
                          <Dumbbell className="w-3.5 h-3.5 text-zinc-300 mt-0.5" />
                        </button>
                      )}

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
                          <Clock className="w-3 h-3 text-[#CCFF00]" />
                          <span>{restDisplay}</span>
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => onOpenExerciseModal(ex)}
                        className="min-h-[44px] px-3 py-2 rounded-xl bg-[#090909] hover:bg-[#222222] border border-[#303030] text-xs font-bold text-[#F5F5F5] hover:text-[#CCFF00] flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                      >
                        <Info className="w-3.5 h-3.5 text-[#CCFF00]" />
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
              <div className="w-9 h-9 rounded-xl bg-[#090909] border border-[#303030] flex items-center justify-center text-[#CCFF00] shrink-0">
                <Activity className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-[#CCFF00]">
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
                <span className="px-2 py-0.5 rounded-md bg-[#090909] border border-[#CCFF00] text-[#CCFF00] font-mono font-black text-[11px] tabular-nums">
                  {formatDuration(prepTimerRemainingSec)}
                </span>
              )}
              <div className="w-8 h-8 rounded-lg bg-[#090909] border border-[#303030] flex items-center justify-center text-[#F5F5F5]">
                {isPrepExpanded ? (
                  <ChevronUp className="w-4 h-4 text-[#CCFF00]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-zinc-400" />
                )}
              </div>
            </div>
          </button>

          <div className="w-full h-1 bg-[#090909]">
            <div
              className="h-full bg-[#CCFF00] transition-all duration-300"
              style={{ width: `${prepProgressPct}%` }}
            />
          </div>

          {isPrepExpanded && (
            <div className="p-3.5 sm:p-4 border-t border-[#303030] space-y-3 bg-[#171717]">
              <div className="rounded-xl bg-[#090909] border border-[#303030] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#171717] border border-[#303030] flex items-center justify-center text-[#CCFF00] shrink-0">
                    <Timer className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-[9px] font-black uppercase tracking-wider text-zinc-400">
                      Cronómetro de Movilidad
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl font-black font-mono tabular-nums text-[#CCFF00]">
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
                          ? 'bg-[#CCFF00] text-[#090909] border-[#CCFF00] font-black'
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
                    className="min-h-[36px] px-3 py-1 rounded-lg bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-xs uppercase flex items-center gap-1 cursor-pointer"
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
                          ? 'bg-[#090909] border-[#CCFF00]/60'
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
                            ? 'bg-[#CCFF00] text-[#090909] border-[#CCFF00]'
                            : 'bg-[#171717] text-zinc-400 border-[#303030]'
                        }`}
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                      </button>

                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <h3
                            className={`text-xs font-black leading-snug ${
                              isDone ? 'text-[#CCFF00]' : 'text-[#F5F5F5]'
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
                            className="min-h-[32px] px-2 py-0.5 rounded-md bg-[#171717] hover:bg-[#242424] border border-[#303030] text-[10px] font-mono font-bold text-[#CCFF00] flex items-center gap-1 cursor-pointer shrink-0"
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
                  className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                  <span>Completar y Continuar</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 6. ENTRENAMIENTO LIBRE (Mejorado en descubrimiento móvil sin duplicar módulos) */}
        <section className="rounded-2xl sm:rounded-3xl bg-[#171717] border border-[#CCFF00]/40 p-4 sm:p-5 space-y-3 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#090909] border border-[#CCFF00] flex items-center justify-center text-[#CCFF00] shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="block text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-[#CCFF00]">
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
                className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#090909] border border-[#303030] focus:border-[#CCFF00] focus:outline-none text-xs sm:text-sm font-semibold text-[#F5F5F5]"
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setIsExercisePickerOpen(true)}
                className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-[#090909] hover:bg-[#222222] border border-[#CCFF00] text-[#CCFF00] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer active:scale-95"
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
                      <p className="text-[10px] text-[#CCFF00] font-semibold">
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
              <Info className="w-4 h-4 text-[#CCFF00] shrink-0" />
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
            className="w-full min-h-[48px] py-3 px-4 rounded-xl sm:rounded-2xl bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_4px_18px_rgba(204,255,0,0.18)] active:scale-[0.99] transition-all cursor-pointer"
          >
            {freeDraftExercises.length > 0 ? (
              <>
                <Play className="w-4 h-4 fill-[#090909] text-[#090909]" />
                <span>INICIAR ENTRENAMIENTO LIBRE ({freeDraftExercises.length} EJERCICIOS)</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 stroke-[3] text-[#090909]" />
                <span>SELECCIONAR EJERCICIOS PARA INICIAR</span>
              </>
            )}
          </button>
        </section>

        {/* 7. SELECTOR DE OTRAS RUTINAS SEMANALES (Tarjetas compactas Lunes-Domingo, sin estadísticas repetidas) */}
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div>
              <span className="block text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-[#CCFF00]">
                PLANIFICACIÓN COMPLETA
              </span>
              <h2 className="text-sm sm:text-base font-black text-[#F5F5F5] uppercase">
                Rutinas Semanales ({routines.length})
              </h2>
            </div>

            <button
              type="button"
              onClick={onNavigateRoutines}
              className="min-h-[34px] px-3 py-1 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-xs font-bold text-[#CCFF00] flex items-center gap-1 transition-colors cursor-pointer"
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
              const isCompletedThisWeek =
                completedRoutineIdsThisWeek.has(routine.id) ||
                completedRoutineIdsThisWeek.has(normalizeTextSimple(routine.title));
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
                      ? 'bg-[#171717] border-[#CCFF00]'
                      : 'bg-[#171717] border-[#303030] hover:border-zinc-500'
                  }`}
                >
                  <div className="space-y-1">
                    {/* Fila superior: Día + Estado */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider">
                        <span className="text-[#CCFF00]">{routine.dayName}</span>
                        {isToday && (
                          <span className="px-1.5 py-0.2 rounded bg-[#CCFF00]/15 text-[#CCFF00] font-mono text-[9px] font-black">
                            HOY
                          </span>
                        )}
                      </div>

                      {isCompletedThisWeek ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#CCFF00]">
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
                      <strong className="text-[#CCFF00]">{setsCount}</strong> series
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
                        className="min-h-[32px] px-3 py-1 rounded-lg bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-[11px] uppercase tracking-wider flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-[#090909] text-[#090909]" />
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
                    className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-[#171717] border border-[#303030] focus:border-[#CCFF00] focus:outline-none text-xs text-[#F5F5F5]"
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
                          ? 'bg-[#CCFF00] text-[#090909] font-black'
                          : 'bg-[#171717] text-zinc-400 hover:text-[#F5F5F5] border border-[#303030]'
                      }`}
                    >
                      {muscle}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-[#303030]/60 p-2 bg-[#090909]">
                {filteredCatalog.map((item) => {
                  const alreadyAdded = freeDraftExercises.some((d) => d.name === item.name);
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
                              prev.filter((d) => d.name !== item.name)
                            );
                          }
                        }}
                        className={`min-h-[40px] px-3.5 py-1.5 rounded-xl font-black text-xs flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                          alreadyAdded
                            ? 'bg-[#171717] border border-[#CCFF00] text-[#CCFF00]'
                            : 'bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909]'
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
                })}
              </div>

              <div className="p-3.5 border-t border-[#303030] bg-[#171717] flex items-center justify-between gap-3">
                <span className="text-xs font-mono text-zinc-300">
                  {freeDraftExercises.length} ejercicio(s) seleccionado(s)
                </span>
                <button
                  type="button"
                  onClick={() => setIsExercisePickerOpen(false)}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-[#CCFF00] text-[#090909] font-black text-xs uppercase tracking-wider cursor-pointer"
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
        onStartRestTimer(restToUse, exerciseName);
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
    }
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
            <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-[#CCFF00] leading-none mb-1">
              SESIÓN ACTIVA · AUTOGUARDADO
            </span>
            <h1 className="text-lg sm:text-xl font-black text-[#F5F5F5] uppercase tracking-tight leading-tight truncate">
              {routineShortTitle}
            </h1>
            <p className="text-xs text-zinc-400 leading-snug truncate mt-0.5">
              {routineSecondaryDesc}
            </p>
          </div>

          {/* Derecha: Acción discreta Finalizar + Menú secundario (···) */}
          <div className="flex items-center gap-1.5 shrink-0 relative">
            <button
              type="button"
              onClick={handleRequestFinish}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] hover:border-[#CCFF00]/60 text-[#F5F5F5] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Finalizar y guardar entrenamiento"
            >
              <Check className="w-3.5 h-3.5 text-[#CCFF00] stroke-[2.8]" />
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
                    <Plus className="w-4 h-4 text-[#CCFF00]" />
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
                        <LayoutList className="w-4 h-4 text-[#CCFF00]" />
                        <span>Ver todos los ejercicios</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4 text-[#CCFF00]" />
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
                      <Timer className="w-4 h-4 text-[#CCFF00]" />
                      <span>Auto-descanso</span>
                    </span>
                    <span className="font-mono text-[11px] font-black text-[#CCFF00]">
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
                    <Disc className="w-4 h-4 text-[#CCFF00]" />
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
            <span className="font-mono font-black text-sm sm:text-base text-[#CCFF00] tabular-nums leading-snug">
              {formatDuration(elapsedSeconds)}
            </span>
          </div>

          <div className="rounded-xl bg-[#171717] border border-[#303030] py-2 px-2 text-center">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              Ejercicios
            </span>
            <span className="font-mono font-black text-sm sm:text-base text-[#CCFF00] tabular-nums leading-snug">
              {fullyCompletedExercisesCount}/{activeSession.exercises.length}
            </span>
          </div>

          <div className="rounded-xl bg-[#171717] border border-[#303030] py-2 px-2 text-center">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              Series
            </span>
            <span className="font-mono font-black text-sm sm:text-base text-[#CCFF00] tabular-nums leading-snug">
              {completedSets}/{totalSets}
            </span>
          </div>
        </div>

        {/* Barra de progreso hairline */}
        <div className="w-full h-1 bg-[#171717] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#CCFF00] transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </header>

      {/* 2. EJERCICIO ACTUAL PROTAGONISTA (O LISTA COMPLETA SI EL USUARIO CAMBIA DE MODO) */}
      <div className="space-y-4">
        {exercisesToRender.map(({ exerciseState, exIndex }) => {
          const rawExercise = baseRoutine?.exercises.find(
            (e) => e.id === exerciseState.exerciseId
          );

          const libraryMatch = resolveLibraryExercise({
            ...(exerciseState.activeExerciseName === exerciseState.exerciseName ? rawExercise : {}),
            name: exerciseState.activeExerciseName,
          });

          const thumbnailUrl =
            libraryMatch?.thumbnailUrl || rawExercise?.thumbnailUrl || undefined;
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
          const repRangeTarget = rawExercise?.repRange || '8 - 12 reps';
          const exerciseRestSec = exerciseState.restSeconds || rawExercise?.restSeconds || 90;

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
            exerciseState.sets
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

          return (
            <section
              id={`workout-ex-${exerciseState.exerciseId}`}
              key={exerciseState.exerciseId}
              className={`rounded-3xl border p-3.5 sm:p-5 transition-colors space-y-3.5 ${
                allCompleted
                  ? 'bg-[#171717] border-[#CCFF00]'
                  : 'bg-[#171717] border-[#303030]'
              }`}
            >
              {/* Encabezado del Ejercicio Actual */}
              <div className="space-y-2.5">
                {/* Línea superior: EJERCICIO X DE Y + Siguiente ejercicio contextual + Herramientas desplegable */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#CCFF00] shrink-0">
                      EJERCICIO {exIndex + 1} DE {activeSession.exercises.length}
                    </span>
                    <span className="text-zinc-600 shrink-0" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-[11px] font-bold text-zinc-400 truncate">
                      {muscleDisplay}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {nextIncompleteExIdx >= 0 && viewMode === 'focus' && (
                      <button
                        type="button"
                        onClick={() => setFocusedExerciseIndex(nextIncompleteExIdx)}
                        className="min-h-[32px] px-2.5 py-1 rounded-lg bg-[#090909] border border-[#CCFF00]/40 text-[11px] font-black text-[#CCFF00] hover:bg-[#CCFF00]/10 flex items-center gap-1 transition-colors cursor-pointer"
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
                          ? 'bg-[#CCFF00] text-[#090909] border-[#CCFF00] font-black'
                          : 'bg-[#090909] text-zinc-300 border-[#303030] hover:text-[#F5F5F5]'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>Herramientas {isToolsOpen ? '▲' : '▼'}</span>
                    </button>
                  </div>
                </div>

                {/* Título Protagonista + Miniatura opcional de referencia */}
                <div className="flex items-center gap-3">
                  {thumbnailUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        rawExercise
                          ? onOpenExerciseModal(rawExercise)
                          : libraryMatch
                          ? onOpenExerciseModal(libraryItemToExercise(libraryMatch))
                          : undefined
                      }
                      className="w-12 h-12 rounded-xl bg-[#090909] border border-[#303030] overflow-hidden shrink-0 cursor-pointer group"
                      title="Ver guía técnica y referencia"
                    >
                      <img
                        src={thumbnailUrl}
                        alt={exerciseState.activeExerciseName}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        loading="lazy"
                      />
                    </button>
                  )}

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
                      className="text-[11px] font-bold text-zinc-400 hover:text-[#CCFF00] inline-flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <History className="w-3 h-3 text-[#CCFF00]" />
                      <span>{isHistoryOpen ? 'Ocultar historial' : 'Historial'}</span>
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
                    className="font-mono font-bold text-[#CCFF00] hover:underline flex items-center gap-1 cursor-pointer tabular-nums"
                    title="Toca para ajustar el descanso programado"
                  >
                    <span>Descanso {exerciseRestSec} s</span>
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
                              ? 'bg-[#CCFF00] text-[#090909] font-black'
                              : 'bg-[#171717] text-zinc-300 border border-[#303030]'
                          }`}
                        >
                          {sec}s
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
                      className="min-h-[32px] px-3 py-1 rounded-lg bg-[#CCFF00] text-[#090909] text-[11px] font-black uppercase flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Iniciar {exerciseRestSec}s</span>
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
                      className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#171717] border border-[#CCFF00]/50 text-[#CCFF00] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                      <span>Cambiar</span>
                    </button>

                    {rawExercise?.alternative && (
                      <button
                        type="button"
                        onClick={() => onToggleAlternative(exerciseState.exerciseId)}
                        className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                          exerciseState.useAlternative
                            ? 'bg-[#CCFF00] text-[#090909] border-[#CCFF00] font-black'
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
                        className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#171717] border border-[#303030] text-zinc-300 hover:text-[#CCFF00] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <ScanEye className="w-3.5 h-3.5 text-[#CCFF00]" />
                        <span>Escáner</span>
                      </button>
                    )}

                    {!hasWarmupSets && (
                      <button
                        type="button"
                        onClick={() => onAddWarmupSets(exerciseState.exerciseId)}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#171717] border border-[#303030] text-zinc-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Flame className="w-3.5 h-3.5 text-[#CCFF00]" />
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
                      <Disc className="w-3.5 h-3.5 text-[#CCFF00]" />
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

                {/* Historial de Cargas Reales y Progresión (Desplegable para mantener la tabla limpia arriba) */}
                {isHistoryOpen && (
                  <RecommendedLoadForecastWidget
                    exerciseId={exerciseState.exerciseId}
                    exerciseName={exerciseState.exerciseName}
                    activeExerciseName={exerciseState.activeExerciseName}
                    sets={exerciseState.sets}
                    history={history}
                    existingPR={existingPR}
                    rawExercise={rawExercise}
                    equipmentHint={equipmentLabel}
                    onApplySuggestedLoad={(suggestedWeight, suggestedReps, targetSetIndex) => {
                      onUpdateSet(
                        exerciseState.exerciseId,
                        targetSetIndex,
                        'weight',
                        suggestedWeight
                      );
                      onUpdateSet(
                        exerciseState.exerciseId,
                        targetSetIndex,
                        'reps',
                        suggestedReps
                      );
                    }}
                    onCopyPreviousSessionToSets={(prevWeight, prevReps) => {
                      exerciseState.sets.forEach((s, idx) => {
                        if (!s.completed && !s.isWarmup) {
                          onUpdateSet(exerciseState.exerciseId, idx, 'weight', prevWeight);
                          onUpdateSet(exerciseState.exerciseId, idx, 'reps', prevReps);
                        }
                      });
                    }}
                  />
                )}
              </div>

              <div className="border-t border-[#303030]" />

              {/* 3. SERIE ACTIVA COMO ELEMENTO PRINCIPAL + HISTORIAL COMPACTO DE SERIES */}
              <div className="space-y-4">
                {/* A. TARJETA PROTAGONISTA DE SERIE ACTIVA */}
                {activeSet && activeSetIndex >= 0 ? (
                  <div className="rounded-2xl bg-[#141414] border-2 border-[#CCFF00]/70 p-4 sm:p-5 space-y-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-lg bg-[#CCFF00] text-[#090909] font-mono font-black text-xs uppercase">
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
                          className="min-h-[32px] px-2.5 rounded-lg bg-[#090909] border border-[#303030] text-[11px] font-mono text-[#CCFF00] hover:border-[#CCFF00] flex items-center gap-1 cursor-pointer transition-colors"
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
                          className="w-full min-h-[52px] text-center font-mono tabular-nums font-black text-xl sm:text-2xl rounded-2xl bg-[#090909] border border-[#303030] focus:border-[#CCFF00] text-[#F5F5F5] placeholder:text-zinc-600 focus:outline-none"
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
                          className="w-full min-h-[52px] text-center font-mono tabular-nums font-black text-xl sm:text-2xl rounded-2xl bg-[#090909] border border-[#303030] focus:border-[#CCFF00] text-[#F5F5F5] placeholder:text-zinc-600 focus:outline-none"
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
                          className="min-h-[38px] px-3 rounded-xl bg-[#090909] border border-[#303030] text-[#CCFF00] hover:border-[#CCFF00] text-xs font-mono font-bold active:scale-95 cursor-pointer"
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
                          className="min-h-[38px] px-3 rounded-xl bg-[#090909] border border-[#303030] focus:border-[#CCFF00] focus:outline-none text-xs font-mono font-bold text-zinc-200 cursor-pointer"
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
                      className="w-full min-h-[52px] py-3.5 px-5 rounded-2xl bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-sm sm:text-base uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_6px_22px_rgba(204,255,0,0.22)] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <Check className="w-5 h-5 stroke-[3] text-[#090909]" />
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
                              ? 'bg-[#171717] border-[#CCFF00]'
                              : set.completed
                              ? 'bg-[#090909] border-[#CCFF00]/40'
                              : 'bg-[#121212] border-[#303030] hover:border-zinc-500'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-7 h-7 rounded-lg flex items-center justify-center font-mono font-black text-xs shrink-0 ${
                                set.completed
                                  ? 'bg-[#CCFF00] text-[#090909]'
                                  : isCurrentActive
                                  ? 'bg-[#CCFF00] text-[#090909]'
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
                                      ? 'text-[#CCFF00]'
                                      : set.completed
                                      ? 'text-[#CCFF00]'
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
                                  ? 'bg-[#CCFF00] text-[#090909] border-[#CCFF00]'
                                  : 'bg-[#090909] text-zinc-400 border-[#303030] hover:text-[#CCFF00]'
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
                      className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#090909] hover:bg-[#1a1a1a] border border-[#303030] hover:border-[#CCFF00]/50 text-xs font-black text-[#CCFF00] uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <span>SIGUIENTE EJERCICIO ({activeSession.exercises[nextIncompleteExIdx]?.activeExerciseName})</span>
                      <ChevronRight className="w-4 h-4 stroke-[3]" />
                    </button>
                  </div>
                )}
              </div>

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
                      className="w-full min-h-[52px] py-3 px-5 rounded-2xl bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_6px_22px_rgba(204,255,0,0.22)] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                      <span>EJERCICIO COMPLETADO · SIGUIENTE</span>
                      <ChevronRight className="w-4 h-4 stroke-[3]" />
                    </button>
                  ) : pendingExercisesCount === 0 ? (
                    <button
                      type="button"
                      onClick={handleRequestFinish}
                      className="w-full min-h-[52px] py-3 px-5 rounded-2xl bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_6px_22px_rgba(204,255,0,0.22)] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                      <span>FINALIZAR ENTRENAMIENTO</span>
                    </button>
                  ) : (
                    <div className="w-full min-h-[44px] py-2.5 px-4 rounded-2xl bg-[#090909] border border-[#CCFF00]/50 text-[#CCFF00] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2">
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
                    <Timer className="w-3.5 h-3.5 text-[#CCFF00]" />
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
                        autoRestEnabled ? 'text-[#CCFF00]' : 'text-zinc-500'
                      }`}
                    >
                      ({autoRestEnabled ? 'ON' : 'OFF'})
                    </span>
                  </button>

                  <span className="font-mono font-black text-sm sm:text-base text-[#CCFF00] tabular-nums">
                    {restTimer.active
                      ? formatRestMmSs(restTimer.remainingSeconds)
                      : formatRestMmSs(exerciseRestSec)}
                  </span>
                </div>

                {restTimer.active && (
                  <div className="space-y-2 pt-1 border-t border-[#303030]/80">
                    <div className="w-full h-1 bg-[#171717] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#CCFF00] transition-all duration-300"
                        style={{
                          width: `${
                            restTimer.totalSeconds > 0
                              ? Math.min(
                                  100,
                                  Math.max(
                                    0,
                                    (restTimer.remainingSeconds / restTimer.totalSeconds) * 100
                                  )
                                )
                              : 0
                          }%`,
                        }}
                      />
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
                              className="min-h-[34px] px-2.5 rounded-lg bg-[#171717] border border-[#303030] text-[#CCFF00] text-[11px] font-mono font-bold cursor-pointer"
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
                                <Play className="w-3 h-3 text-[#CCFF00] fill-current" />
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
                            className="min-h-[34px] px-3 rounded-lg bg-[#CCFF00] text-[#090909] text-xs font-black uppercase flex items-center gap-1 cursor-pointer"
                          >
                            <span>Saltar</span>
                            <SkipForward className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Controles sutiles de series + nota técnica */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onAddSet(exerciseState.exerciseId)}
                    className="min-h-[36px] px-3 py-1 rounded-xl bg-[#090909] hover:bg-[#222222] text-[#CCFF00] border border-[#303030] text-xs font-bold flex items-center gap-1 cursor-pointer"
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
                  className="min-h-[36px] rounded-xl bg-[#090909] border border-[#303030] focus:border-[#CCFF00] focus:outline-none px-3 py-1 text-xs text-[#F5F5F5] placeholder:text-zinc-500 sm:w-56"
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
            className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#171717] border border-[#303030] hover:border-[#CCFF00]/60 text-xs font-bold text-[#F5F5F5] flex items-center gap-1.5 cursor-pointer"
          >
            <LayoutList className="w-3.5 h-3.5 text-[#CCFF00]" />
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
            className="min-h-[44px] px-2.5 py-2 rounded-xl text-xs font-black text-[#CCFF00] hover:text-[#b8e600] disabled:opacity-35 flex items-center gap-1 transition-colors cursor-pointer"
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
            className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#171717] border border-[#303030] text-xs font-bold text-[#CCFF00] flex items-center gap-1.5 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Volver a Ejercicio Actual</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExercisePickerOpen(true)}
            className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#171717] border border-[#303030] text-xs font-bold text-[#F5F5F5] flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#CCFF00]" />
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
          <Plus className="w-3.5 h-3.5 text-[#CCFF00]" />
          <span>+ Ejercicio</span>
        </button>

        <button
          type="button"
          onClick={handleRequestFinish}
          className="min-h-[44px] py-2.5 px-3 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#CCFF00]/60 text-[#CCFF00] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
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
                <span className="block text-[10px] font-black uppercase tracking-wider text-[#CCFF00]">
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
                  className="min-h-[36px] px-3 py-1 rounded-lg bg-[#090909] border border-[#303030] text-[11px] font-bold text-[#CCFF00] cursor-pointer"
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
                        ? 'bg-[#171717] border-[#CCFF00]'
                        : 'bg-[#171717] border-[#303030] hover:border-zinc-500'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl font-mono font-black text-xs flex items-center justify-center shrink-0 border ${
                          isDone
                            ? 'bg-[#CCFF00] text-[#090909] border-[#CCFF00]'
                            : isCurrent
                            ? 'bg-[#090909] text-[#CCFF00] border-[#CCFF00]'
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
                          <span className={isDone ? 'text-[#CCFF00] font-bold' : ''}>
                            {doneCount}/{ex.sets.length} series
                          </span>
                        </p>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-black uppercase px-2 py-1 rounded-md shrink-0 ${
                        isCurrent
                          ? 'text-[#CCFF00]'
                          : isDone
                          ? 'text-[#CCFF00]'
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
                <div className="w-10 h-10 rounded-xl bg-[#171717] text-[#CCFF00] border border-[#CCFF00]/40 flex items-center justify-center shrink-0">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[10px] font-black uppercase tracking-wider text-[#CCFF00]">
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

            <div className="space-y-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={manualSwapSearch}
                  onChange={(e) => setManualSwapSearch(e.target.value)}
                  placeholder="Buscar alternativa por nombre o máquina..."
                  className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-[#171717] border border-[#303030] text-xs text-[#F5F5F5] placeholder-zinc-500 focus:outline-none focus:border-[#CCFF00]"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                {EQUIPMENT_FILTERS.map((eq) => (
                  <button
                    key={eq}
                    type="button"
                    onClick={() => setSwapEquipmentFilter(eq)}
                    className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                      swapEquipmentFilter === eq
                        ? 'bg-[#CCFF00] text-[#090909] border-[#CCFF00] font-black'
                        : 'bg-[#171717] text-zinc-400 hover:text-[#F5F5F5] border-[#303030]'
                    }`}
                  >
                    {eq}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                <button
                  type="button"
                  onClick={() => setSwapMuscleFilter('Compatible')}
                  className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                    swapMuscleFilter === 'Compatible'
                      ? 'bg-[#171717] text-[#CCFF00] border-[#CCFF00]'
                      : 'bg-[#090909] text-zinc-400 border-[#303030]'
                  }`}
                >
                  Compatibles ({manualSwapTarget.targetMuscles})
                </button>
                {MUSCLE_GROUPS.filter((m) => m !== 'Todos').map((muscle) => (
                  <button
                    key={muscle}
                    type="button"
                    onClick={() => setSwapMuscleFilter(muscle)}
                    className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                      swapMuscleFilter === muscle
                        ? 'bg-[#171717] text-[#CCFF00] border-[#CCFF00]'
                        : 'bg-[#090909] text-zinc-400 border-[#303030]'
                    }`}
                  >
                    {muscle}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {compatibleSwapList.length === 0 ? (
                <div className="p-6 text-center rounded-2xl bg-[#171717] border border-[#303030] text-xs text-zinc-400">
                  No se encontraron alternativas con ese filtro. Prueba cambiando el filtro de equipo o músculo.
                </div>
              ) : (
                compatibleSwapList.map(({ item: official, itemPattern, isSamePattern }) => (
                  <button
                    key={official.id}
                    type="button"
                    onClick={() => {
                      if (onReplaceActiveExercise) {
                        onReplaceActiveExercise(manualSwapTarget.id, {
                          newName: official.name,
                          targetMuscles: official.muscleGroup,
                          equipment: official.equipment,
                          notes: `Sustituyó a ${manualSwapTarget.originalName}`,
                        });
                      }
                      setManualSwapTarget(null);
                    }}
                    className="w-full text-left p-3.5 rounded-2xl bg-[#171717] hover:bg-[#222222] border border-[#303030] hover:border-[#CCFF00] transition-all flex items-center justify-between gap-3 group cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-0.5 text-[11px] font-mono">
                        {isSamePattern && (
                          <span className="text-[#CCFF00] font-bold">
                            Patrón Equivalente ({itemPattern}) ·
                          </span>
                        )}
                        <span className="text-zinc-400">
                          {official.muscleGroup} · {official.equipment || 'Estándar'}
                        </span>
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-[#F5F5F5] group-hover:text-[#CCFF00] block leading-snug">
                        {official.name}
                      </span>
                    </div>
                    <span className="px-3.5 py-2 rounded-xl bg-[#090909] group-hover:bg-[#CCFF00] text-zinc-200 group-hover:text-[#090909] font-black text-xs uppercase shrink-0 transition-colors">
                      Elegir
                    </span>
                  </button>
                ))
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
                  className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-[#171717] border border-[#303030] focus:border-[#CCFF00] focus:outline-none text-xs text-[#F5F5F5]"
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
                        ? 'bg-[#CCFF00] text-[#090909] font-black'
                        : 'bg-[#171717] text-zinc-400 hover:text-[#F5F5F5] border border-[#303030]'
                    }`}
                  >
                    {muscle}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#303030]/60 p-2">
              {filteredCatalog.map((item) => (
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
                    className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-xs flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Añadir</span>
                  </button>
                </div>
              ))}
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
          <div className="w-full max-w-sm rounded-3xl bg-[#090909] border border-[#CCFF00] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#171717] border border-[#CCFF00]/40 text-[#CCFF00] flex items-center justify-center shrink-0">
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
                  className="flex-1 min-h-[44px] rounded-xl bg-[#CCFF00] text-[#090909] text-xs font-black uppercase cursor-pointer"
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
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md p-3.5 rounded-2xl shadow-2xl flex items-center gap-3 bg-[#090909]/95 border border-[#CCFF00] backdrop-blur-xl">
          <div className="w-9 h-9 rounded-xl bg-[#CCFF00] text-[#090909] flex items-center justify-center shrink-0 font-black">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono font-black uppercase tracking-wider text-[#CCFF00]">
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
          if (onReplaceActiveExercise) {
            onReplaceActiveExercise(exerciseId, replacement);
          }
        }}
      />
    </div>
  );
};
