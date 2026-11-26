import { ThemeAccent } from '../utils/theme';

export type CoachVoiceMode = 'silent' | 'important_only' | 'full_coach';

export interface Profile {
  id: string;
  name: string;
  email?: string;
  pin?: string;
  authUid?: string;
  migrationStatus?: string;
  avatar: string;
  goal: string;
  weeklyTargetDays: number;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  restEndAlertEnabled?: boolean;
  coachVoiceMode?: CoachVoiceMode;
  weightUnit: 'kg' | 'lb';
  weightKg?: number;
  heightCm?: number;
  isAdmin?: boolean;
  themeAccent?: ThemeAccent;
  createdAt: string;
}

export interface ExerciseTempo {
  eccentricSec: number;
  bottomPauseSec: number;
  concentricSec: number;
  topPauseSec: number;
  notation: string; // e.g. "3-1-1-0"
  summary: string;
}

export interface ExerciseMuscleBreakdown {
  primary: string[];
  secondary: string[];
}

export interface TechniqueProProfile {
  exerciseId?: string;
  libraryExerciseId?: string;
  exerciseName: string;
  equipment: string;
  movementPattern: string;
  mediaUrl: string;
  posterUrl?: string;
  preSetTip: string; // Consejo breve antes de la primera serie
  specificTips: string[]; // 3 a 5 consejos técnicos específicos
  startingPosition: string[]; // Posición inicial
  stepByStepExecution: string[]; // Ejecución paso a paso
  breathing: {
    eccentricPhase: string;
    concentricPhase: string;
    bracingCue: string;
  };
  commonMistakes: string[]; // Errores frecuentes
  muscles: ExerciseMuscleBreakdown; // Músculos principales y secundarios
  defaultTempo: ExerciseTempo; // Tempo orientativo y ajustable
  safetyRecommendations: string[]; // Recomendaciones de seguridad
}

export interface Exercise {
  id: string;
  libraryExerciseId?: string;
  name: string;
  targetMuscles: string;
  defaultSets: number;
  repRange: string;
  restSeconds: number;
  restText: string;
  alternative?: string;
  objective: string;
  defaultVideoUrl: string;
  thumbnailUrl?: string;
  secondaryThumbnailUrl?: string;
  techniqueCues: string[];
  techniquePro?: TechniqueProProfile;
  customTempo?: string;
  notes?: string;
  notas?: string;
  estrategia?: string;
  equipment?: string;
  dia?: string;
  day?: string;
  descanso?: string | number;
  DESCANSO?: string | number;
  rest?: string | number;
  defaultWeight?: number;
  targetMinutes?: number;
  prevWeight?: number;
  defaultReps?: number;
}

export type FitnessModalityType =
  | 'fuerza_maxima'
  | 'potencia'
  | 'hipertrofia'
  | 'definicion'
  | 'recomposicion'
  | 'resistencia';

export type RoutineImportMode = 'append_new' | 'merge_days' | 'replace_all';

export interface Routine {
  id: string;
  dayName: string;
  title: string;
  tagline: string;
  banner?: string;
  accentColor?: string;
  exercises: Exercise[];
  isCustom?: boolean;
  importedPlanId?: string;
  importedAt?: string;
  sourceFormat?: string;
  // Modalidades Fitness Científicas:
  modality?: FitnessModalityType | string;
  modalityName?: string;
  targetRepRange?: string; // e.g. "1 a 5 reps", "3 a 6 reps (rápidas)", "6 a 12 reps", "8 a 15 reps", "15 a 25+ reps"
  restRange?: string;      // e.g. "3 a 5 min", "2 a 3 min", "1.5 a 3 min", "1 a 2 min", "1.5 a 2.5 min", "30 a 60 seg"
  caloricFocus?: string;   // e.g. "Superávit o Mantenimiento", "Déficit calórico (- calorías)", "Normocalórico (Mantenimiento)"
}

export type WorkoutSyncStatus = 'saved_local' | 'pending_sync' | 'synced' | 'error';

export interface LoggedSet {
  durationMinutes?: number;
  id?: string;
  setNumber: number;
  weight: number | '';
  reps: number | '';
  rpe?: number;
  rir?: number;
  completed: boolean;
  completedAt?: string;
  previous?: string;
  isWarmup?: boolean;
}

export interface ExerciseSetSnapshot {
  durationMinutes?: number;
  id?: string;
  setNumber: number;
  weight: number;
  reps: number;
  rpe?: number;
  rir?: number;
  completed?: boolean;
  completedAt?: string;
}

export interface WorkoutExerciseState {
  exerciseId: string;
  libraryExerciseId?: string;
  exerciseName: string;
  originalExerciseId?: string;
  originalExerciseName?: string;
  targetMuscles: string;
  equipment?: string;
  objective?: string;
  repRange?: string;
  sets: LoggedSet[];
  notes?: string;
  useAlternative?: boolean;
  activeExerciseName: string;
  restSeconds?: number;
  machinePhotoUrl?: string;
  techniqueCues?: string[];
  techniquePro?: TechniqueProProfile;
  customTempo?: string;
}

export interface ActiveWorkoutSession {
  sessionId?: string;
  routineId: string;
  routineTitle: string;
  /** Día programado canónico de la rutina (ej. 'Miércoles', 'Viernes'), independiente de la fecha real de ejecución */
  scheduledDay?: string;
  /** Marca de tiempo ISO-8601 real de inicio del entrenamiento */
  startedAt?: string;
  startTime: number;
  updatedAt?: number;
  isPaused?: boolean;
  pausedAt?: number;
  accumulatedPausedMs?: number;
  exercises: WorkoutExerciseState[];
}

export interface CompletedWorkout {
  id: string;
  profileId?: string;
  routineId: string;
  routineTitle: string;
  /** Día programado canónico de la rutina ejecutada (ej. 'Miércoles'), estrictamente separado de la fecha real de ejecución */
  scheduledDay?: string;
  /** Marca de tiempo ISO-8601 real de inicio del entrenamiento */
  startedAt?: string;
  /** Marca de tiempo ISO-8601 real de finalización del entrenamiento */
  completedAt?: string;
  /** Fecha calendario local real de ejecución en America/Santiago ('YYYY-MM-DD') */
  executionDateKey?: string;
  /** Identificador de ciclo semanal ISO en America/Santiago (ej. '2026-W48') */
  weekId?: string;
  date: string;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  totalVolumeKg: number;
  completedSetsCount: number;
  totalRepsCount?: number;
  completedExercisesCount?: number;
  primaryMusclesWorked?: string[];
  secondaryMusclesWorked?: string[];
  previousSessionComparison?: {
    prevDate: string;
    prevVolumeKg: number;
    volumeDiffKg: number;
    prevSets: number;
  };
  isFinished: boolean;
  avgRpe?: number;
  caloriesBurned?: number;
  exercisesSummary: {
    exerciseId?: string;
    libraryExerciseId?: string;
    originalExerciseId?: string;
    originalExerciseName?: string;
    name: string;
    equipment?: string;
    sets: number;
    setsDetail?: ExerciseSetSnapshot[];
    totalReps?: number;
    maxWeight: number;
    maxReps: number;
    volumeKg?: number;
    muscleGroup?: string;
    estimated1RM?: number;
    rpe?: number;
  }[];
}

export interface BodyWeightEntry {
  id: string;
  date: string;
  weightKg: number;
  bodyFatPct?: number;
  note?: string;
}

export interface PersonalRecord {
  exerciseId: string;
  exerciseName: string;
  maxWeight: number;
  repsAtMaxWeight: number;
  estimated1RM: number;
  date: string;
}

export interface RestTimerState {
  active: boolean;
  restId?: string;
  paused?: boolean;
  totalSeconds: number;
  remainingSeconds: number;
  exerciseName?: string;
  nextSetNumber?: number;
  minimized: boolean;
  targetEndTime?: number;
  startedAt?: number;
}

export interface RestCompleteNotice {
  id: string;
  title: string;
  exerciseName?: string;
  nextSetNumber?: number;
  mode: 'sound' | 'vibrate_only' | 'silent';
  triggeredAt: number;
}

export type ExerciseVisualResourceStatus =
  | 'verified_animation'
  | 'frame_sequence'
  | 'static_image'
  | 'pending_resource';

export type ExerciseDifficultyLevel = 'principiante' | 'intermedio' | 'avanzado';

export type ExerciseMovementType =
  | 'compuesto'
  | 'aislamiento'
  | 'explosivo'
  | 'isometrico'
  | 'movilidad_acondicionamiento';

export type Canonical16MuscleGroupId =
  | 'pecho'
  | 'espalda'
  | 'hombros'
  | 'biceps'
  | 'triceps'
  | 'antebrazos'
  | 'trapecios'
  | 'cuello'
  | 'abdomen_core'
  | 'cuadriceps'
  | 'isquiotibiales'
  | 'gluteos'
  | 'aductores_abductores'
  | 'pantorrillas'
  | 'potencia_explosividad'
  | 'movilidad_acondicionamiento';

export type Canonical9EquipmentId =
  | 'barra'
  | 'mancuernas'
  | 'poleas'
  | 'maquinas'
  | 'smith'
  | 'bandas_elasticas'
  | 'peso_corporal'
  | 'kettlebells'
  | 'equipamiento_funcional';

export interface LibraryExercise {
  id: string;
  sourceId?: string;
  animationUrl?: string;
  frames?: number;
  durationMs?: number;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  name: string;
  muscleGroup: string;
  equipment?: string;
  allEquipment?: string[];
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  secondaryThumbnailUrl?: string | null;
  url: string;
  tags?: string[];
  source?: string;
  movementPattern?: string;
  alternativeNames?: string[];
  difficultyLevel?: ExerciseDifficultyLevel;
  movementType?: ExerciseMovementType;
  variant?: string;
  canonicalGroup16?: Canonical16MuscleGroupId;
  visualResourceStatus?: ExerciseVisualResourceStatus;
  startingPosition?: string;
  activePhase?: string;
  returnPhase?: string;
  shortInstructions?: string[];
  safetyWarnings?: string[];
  contraindications?: string[];
}

export interface EliteExerciseRecord {
  id: string;
  spanishName: string;
  alternativeNames: string[];
  primaryMuscleGroup: string;
  secondaryMuscleGroups: string[];
  canonicalGroup16: Canonical16MuscleGroupId;
  canonicalGroup16Label: string;
  equipment: string;
  equipmentCategory: Canonical9EquipmentId;
  equipmentCategoryLabel: string;
  movementType: ExerciseMovementType;
  biomechanicalPattern: string;
  difficultyLevel: ExerciseDifficultyLevel;
  exerciseVariant: string;
  stepByStepInstructions: string[];
  frequentMistakes: string[];
  safetyRecommendations: string[];
  contraindications?: string[];
  referenceImageUrl: string | null;
  executionAnimationUrl: string | null;
  visualResourceStatus: ExerciseVisualResourceStatus;
  libraryExercise: LibraryExercise;
}

export interface RoutineAssignment {
  id: string;
  routineId: string;
  targetProfileId: string;
  assignedBy: string;
  assignedAt: string;
  note?: string;
}

// ============================================================================
// LAZCAKONG GYM 7.0 — ETAPA 2: COACH INTELLIGENCE PRO & CAPACITOR ADAPTERS
// ============================================================================

export interface CoachPlatformStorageAdapter {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface CoachPlatformVoiceAdapter {
  isAvailable: () => boolean;
  speak: (
    text: string,
    options?: {
      lang?: string;
      rate?: number;
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (reason: string) => void;
    }
  ) => boolean;
  stop: () => void;
}

export interface CoachPlatformNotificationAdapter {
  isAvailable: () => boolean;
  notify: (title: string, body: string, tag?: string) => void;
}

export interface PreWorkoutPriorityMuscle {
  muscleName: string;
  recoveryPct: number;
  remainingHours: number;
  status: 'ready' | 'recovering' | 'fatigued';
  rationale: string;
}

export interface PreWorkoutInitialLoadItem {
  exerciseId: string;
  exerciseName: string;
  equipment?: string;
  suggestedWeightKg: number | null;
  suggestedReps: number | null;
  repRange: string;
  status: string;
  badgeText: string;
  rationale: string;
  techniqueFocus: string;
  hasSufficientData: boolean;
}

export interface PreWorkoutCoachBriefing {
  routineId?: string;
  routineTitle: string;
  readinessScorePct: number;
  fatigueStatus: 'low' | 'moderate' | 'high';
  priorityMuscles: PreWorkoutPriorityMuscle[];
  intensityAdjustment: {
    action: 'maintain' | 'boost' | 'moderate_deload';
    headline: string;
    rationale: string;
    suggestedRestDeltaSec: number;
  };
  initialLoadRecommendations: PreWorkoutInitialLoadItem[];
  dailyCheckIn?: AthleteDailyRecoveryCheckIn | null;
  recoveryForecast?: RecoveryForecastReport;
  smartPlanning?: SmartRoutinePlanningEvaluation;
}

export type LiveSetPerformanceSignal =
  | 'personal_record'
  | 'progression_opportunity'
  | 'near_failure'
  | 'excessive_effort'
  | 'performance_drop'
  | 'steady_execution'
  | 'insufficient_data';

export interface LiveSetCoachEvaluation {
  evaluationId: string;
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  setIndex: number;
  signals: LiveSetPerformanceSignal[];
  primarySignal: LiveSetPerformanceSignal;
  isImportant: boolean;
  hasSufficientData: boolean;
  loadAction: 'increase' | 'maintain' | 'decrease' | 'insufficient_data';
  currentWeightKg: number;
  currentReps: number;
  currentRpe?: number;
  currentRir?: number;
  suggestedWeightKg: number | null;
  suggestedReps: number | null;
  currentRestSeconds: number;
  suggestedRestSeconds: number;
  restDeltaSeconds: number;
  headline: string;
  rationale: string;
  techniqueCue: string;
  accumulatedExerciseVolumeKg: number;
  historicalComparisonText: string;
  voiceSummaryText: string;
  canApplyToNextSet: boolean;
  nextPendingSetIndex: number;
}

export interface PostWorkoutNextSessionItem {
  exerciseId?: string;
  exerciseName: string;
  recommendation: string;
  suggestedNextWeightKg: number | null;
  suggestedNextReps: number | null;
}

export interface PostWorkoutMuscleRecoveryItem {
  muscleName: string;
  estimatedHoursToRecover: number;
  recoveryPct: number;
  fatigueLevel: 'Baja' | 'Moderada' | 'Alta';
}

export interface PostWorkoutCoachReport {
  overallRating: 'sobresaliente' | 'solido' | 'alta_fatiga' | 'base_registrada';
  headline: string;
  executiveSummary: string;
  totalVolumeKg: number;
  completedSetsCount: number;
  totalRepsCount: number;
  avgRpe: number | null;
  prCount: number;
  prHighlights: string[];
  previousComparison: {
    hasPrevious: boolean;
    volumeDiffKg: number;
    volumeDiffPct: number | null;
    summaryText: string;
  };
  nextSessionRecommendations: PostWorkoutNextSessionItem[];
  estimatedMuscleRecovery: PostWorkoutMuscleRecoveryItem[];
}

// ============================================================================
// LAZCAKONG GYM 7.0 — ETAPA 3: MUSCLE RECOVERY PRO
// ============================================================================

export type PerceivedMuscleSorenessLevel = 'none' | 'mild' | 'moderate' | 'alert';

export interface AthleteDailyRecoveryCheckIn {
  id: string;
  profileId: string;
  dateKey: string; // YYYY-MM-DD
  timestamp: number;
  skipped?: boolean;
  sleepHours: number; // 0 - 14
  sleepQuality: 1 | 2 | 3 | 4 | 5;
  energyLevel: 1 | 2 | 3 | 4 | 5;
  perceivedFatigue: 1 | 2 | 3 | 4 | 5;
  muscleSoreness: PerceivedMuscleSorenessLevel;
  soreMuscleNames?: string[];
  trainingDisposition: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

export interface DailyCheckInReadinessSummary {
  hasCheckIn: boolean;
  isSkipped: boolean;
  perceivedReadinessPct: number;
  recoverySpeedMultiplier: number; // 0.82 to 1.15 orientative modifier
  hasAlertSignal: boolean;
  blocksIntenseRecommendation: boolean;
  headline: string;
  rationale: string;
  safetyDisclaimer: string;
}

export interface RecoveryForecastHorizon {
  horizonHours: 24 | 48 | 72;
  targetTimestamp: number;
  estimatedOverallRecoveryPct: number;
  readyMusclesCount: number;
  recoveringMusclesCount: number;
  highFatigueMusclesCount: number;
  readyMuscleNames: string[];
  recoveringMuscleNames: string[];
  highFatigueMuscleNames: string[];
  summaryText: string;
}

export interface CanonicalMuscleForecastItem {
  groupId: string;
  groupName: string;
  currentRecoveryPct: number;
  h24RecoveryPct: number;
  h48RecoveryPct: number;
  h72RecoveryPct: number;
  remainingHoursNow: number;
}

export interface RecoveryForecastReport {
  generatedAt: number;
  estimationDisclaimer: string;
  uncertaintyLevel: 'low' | 'moderate' | 'high';
  uncertaintyReason: string;
  horizons: {
    h24: RecoveryForecastHorizon;
    h48: RecoveryForecastHorizon;
    h72: RecoveryForecastHorizon;
  };
  byCanonicalMuscle: CanonicalMuscleForecastItem[];
}

export type SmartRoutinePlanningActionType =
  | 'maintain_plan'
  | 'reduce_intensity'
  | 'reduce_volume'
  | 'substitute_exercises'
  | 'switch_routine'
  | 'recommend_rest';

export interface SmartExerciseSubstitutionProposal {
  originalExerciseId: string;
  originalExerciseName: string;
  fatiguedMuscleNames: string[];
  replacementExerciseName: string;
  replacementLibraryId: string;
  replacementEquipment: string;
  replacementTargetMuscles: string;
  rationale: string;
  techniquePro: TechniqueProProfile;
}

export interface SmartRoutinePlanningOption {
  action: SmartRoutinePlanningActionType;
  label: string;
  badgeText: string;
  description: string;
  isRecommended: boolean;
  isBlockedByAlert?: boolean;
  targetAlternativeRoutineId?: string;
  targetAlternativeRoutineTitle?: string;
}

export interface SmartRoutinePlanningEvaluation {
  routineId: string;
  routineTitle: string;
  generatedAt: number;
  estimationDisclaimer: string;
  routineReadinessPct: number;
  hasAlertSignal: boolean;
  alertSafetyNote?: string;
  fatiguedMusclesInRoutine: {
    muscleName: string;
    recoveryPct: number;
    remainingHours: number;
    role: 'primary' | 'secondary';
  }[];
  readyMusclesInRoutine: {
    muscleName: string;
    recoveryPct: number;
  }[];
  recommendedTodayMuscleNames: string[];
  recommendedAction: SmartRoutinePlanningActionType;
  headline: string;
  rationale: string;
  voiceSummaryText: string;
  substitutionProposals: SmartExerciseSubstitutionProposal[];
  recommendedAlternativeRoutine: {
    routineId: string;
    routineTitle: string;
    dayName: string;
    readinessPct: number;
    rationale: string;
  } | null;
  options: SmartRoutinePlanningOption[];
}

/**
 * =========================================================================================
 * LAZCAKONG GYM 7.0 — ETAPA 4: PERFORMANCE LAB PRO
 * =========================================================================================
 */

export type MultiWeekComparativeHorizon = '4w' | '8w' | '12w';

export interface MultiWeekComparativeBlock {
  horizon: MultiWeekComparativeHorizon;
  weeksCount: 4 | 8 | 12;
  label: string;
  hasPreviousBase: boolean;
  currentWorkouts: number;
  previousWorkouts: number;
  diffWorkouts: number;
  diffWorkoutsPct: number | null;
  currentVolumeKg: number;
  previousVolumeKg: number;
  diffVolumeKg: number;
  diffVolumePct: number | null;
  currentCompletedSets: number;
  previousCompletedSets: number;
  diffCompletedSets: number;
  currentWeeklyFrequency: number;
  previousWeeklyFrequency: number;
  diffWeeklyFrequency: number;
  verifiedPRsCount: number;
  routineCompliancePct: number | null;
  topImprovedExercises: {
    exerciseId: string;
    exerciseName: string;
    start1RM: number;
    end1RM: number;
    delta1RM: number;
    deltaPct: number;
  }[];
}

export interface VolumeHorizonSummary {
  weeklyVolumeKg: number;
  monthlyVolumeKg: number;
  annualVolumeKg: number;
  weeklyEffectiveSets: number;
  monthlyEffectiveSets: number;
  annualEffectiveSets: number;
  weeklyWorkoutsCount: number;
  monthlyWorkoutsCount: number;
  annualWorkoutsCount: number;
}

export type ProgressiveOverloadProposalType =
  | 'increase_load'
  | 'increase_reps'
  | 'increase_volume_sets'
  | 'hold_recovery_priority'
  | 'maintain_load';

export interface ProgressiveOverloadProposal {
  id: string;
  routineId: string;
  routineTitle: string;
  dayName: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  equipmentVariant: string;
  currentWeightKg: number;
  proposedWeightKg: number;
  loadIncrementKg: number;
  currentReps: number;
  proposedReps: number;
  currentSets: number;
  proposedSets: number;
  currentEstimated1RM: number;
  projectedEstimated1RM: number;
  avgRecentRpe: number | null;
  avgRecentRir: number | null;
  muscleRecoveryPct: number;
  muscleRemainingHours: number;
  overloadType: ProgressiveOverloadProposalType;
  confidenceLevel: 'high' | 'moderate' | 'conservative';
  headline: string;
  rationale: string;
  requiresExplicitAuthorization: true;
}

export type StagnationDetectionStatus =
  | 'progressing'
  | 'plateau_detected'
  | 'regression_detected'
  | 'equipment_or_variant_changed'
  | 'insufficient_comparable_sessions';

export interface ExerciseStagnationAnalysis {
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  equipmentSignature: string;
  status: StagnationDetectionStatus;
  totalSessionsRecorded: number;
  comparableSessionsCount: number;
  minRequiredComparableSessions: number;
  recent1RMValues: number[];
  recentMaxWeightValues: number[];
  recentVolumeValues: number[];
  delta1RMPct: number | null;
  deltaVolumePct: number | null;
  avgRecentRpe: number | null;
  avgRestSeconds: number | null;
  variantChangeNote?: string;
  techniqueProCue: string;
  techniqueProCommonMistake: string;
  justifiedRecommendation: string;
  suggestedAction:
    | 'micro_overload'
    | 'adjust_rest_or_technique'
    | 'deload_or_reduce_volume'
    | 'switch_compatible_variant'
    | 'collect_more_sessions'
    | 'continue_plan';
}

export type PeriodizationDurationWeeks = 4 | 8 | 12;

export type PeriodizationGoalType =
  | 'fuerza'
  | 'hipertrofia'
  | 'resistencia_muscular'
  | 'rendimiento_deportivo'
  | 'combinado';

export type PeriodizationPhaseType =
  | 'acumulacion'
  | 'intensificacion'
  | 'realizacion'
  | 'descarga';

export interface PeriodizationWeekConfig {
  weekNumber: number;
  phase: PeriodizationPhaseType;
  phaseLabel: string;
  isDeloadWeek: boolean;
  targetRpe: number;
  targetRir: number;
  setsMultiplier: number;
  loadIntensityPct1RM: number;
  repRangeLabel: string;
  coachFocusNote: string;
}

export interface PeriodizationMesocyclePlan {
  id: string;
  profileId: string;
  name: string;
  goal: PeriodizationGoalType;
  goalLabel: string;
  durationWeeks: PeriodizationDurationWeeks;
  currentWeekNumber: number;
  createdAt: number;
  updatedAt: number;
  weeks: PeriodizationWeekConfig[];
  preservesOriginalRoutines: true;
}

export type MuscleMovementPattern =
  | 'push'
  | 'pull'
  | 'lower_anterior'
  | 'lower_posterior'
  | 'core';

export interface MuscleGroupBalanceItem {
  muscleGroup: string;
  primaryEffectiveSets: number;
  secondaryWeightedSets: number;
  totalEffectiveSets: number;
  primaryVolumeKg: number;
  secondaryWeightedVolumeKg: number;
  weeklyFrequency: number;
  currentRecoveryPct: number;
  remainingRecoveryHours: number;
  shareOfTotalSetsPct: number;
  movementPattern: MuscleMovementPattern;
  statusLabel: 'equilibrado' | 'dominante' | 'subentrenado' | 'en_recuperacion';
}

export interface MuscleBalanceReport {
  generatedAt: number;
  periodDays: number;
  nonMedicalDisclaimer: string;
  pushSets: number;
  pullSets: number;
  pushPullRatio: number | null;
  pushPullStatus: 'equilibrado' | 'dominancia_empuje' | 'dominancia_traccion' | 'sin_datos';
  upperBodySets: number;
  lowerBodySets: number;
  upperLowerRatio: number | null;
  upperLowerStatus: 'equilibrado' | 'dominancia_superior' | 'dominancia_inferior' | 'sin_datos';
  muscleGroups: MuscleGroupBalanceItem[];
  planningObservations: string[];
}

export interface SmartWeeklyPerformanceReport {
  generatedAt: number;
  profileId: string;
  weekStartDate: string;
  weekEndDate: string;
  completedWorkoutsCount: number;
  targetWorkoutsCount: number;
  routineCompliancePct: number;
  accumulatedVolumeKg: number;
  previousWeekVolumeKg: number;
  volumeDeltaPct: number | null;
  completedSetsCount: number;
  prsAchievedCount: number;
  prsAchievedList: {
    exerciseName: string;
    weightKg: number;
    reps: number;
    estimated1RM: number;
  }[];
  mostTrainedMuscles: {
    muscleGroup: string;
    effectiveSets: number;
    volumeKg: number;
  }[];
  performanceEvolutionSummary: string;
  nextWeekRecommendations: string[];
  coachVoiceText: string;
}

/**
 * =========================================================================================
 * LAZCAKONG GYM 7.0 — ETAPA 5: ELITE CHALLENGES PRO
 * =========================================================================================
 */

export type EliteRankId =
  | 'RECRUIT'
  | 'WARRIOR'
  | 'TITAN'
  | 'ELITE'
  | 'ALPHA'
  | 'KONG';

export interface EliteRankDefinition {
  id: EliteRankId;
  order: 1 | 2 | 3 | 4 | 5 | 6;
  minXp: number;
  maxXp: number | null;
  title: string;
  motto: string;
  metallicAccent: string;
}

export type XpEventCategory =
  | 'workout_completed'
  | 'weekly_goal_completed'
  | 'verified_pr_achieved'
  | 'deload_week_honored'
  | 'periodization_week_completed'
  | 'controlled_execution_bonus'
  | 'smart_recovery_checkin'
  | 'challenge_completed';

export interface XpLedgerEvent {
  canonicalEventKey: string;
  profileId: string;
  category: XpEventCategory;
  xpAwarded: number;
  dateKey: string;
  label: string;
  detail: string;
}

export type EliteChallengeCadence = 'weekly' | 'monthly';

export type EliteChallengeCategory =
  | 'planned_sessions'
  | 'verified_prs'
  | 'consistency'
  | 'periodization_cycle'
  | 'deload_compliance'
  | 'performance_evolution';

export interface EliteSportChallenge {
  id: string;
  profileId: string;
  cadence: EliteChallengeCadence;
  category: EliteChallengeCategory;
  title: string;
  description: string;
  currentValue: number;
  targetValue: number;
  unitLabel: string;
  progressPct: number;
  isCompleted: boolean;
  completedDateKey: string | null;
  xpReward: number;
  restDayHonored: boolean;
  safetyNote: string;
}

export type EliteBadgeCategoryId =
  | 'disciplina_acero'
  | 'fuerza_elite'
  | 'instinto_kong'
  | 'constancia'
  | 'dominio_tecnico'
  | 'recuperacion_inteligente'
  | 'progresion_continua'
  | 'mentalidad_alpha';

export interface ElitePremiumBadge {
  id: EliteBadgeCategoryId;
  title: string;
  categoryLabel: string;
  description: string;
  verificationBasisNote: string;
  unlocked: boolean;
  unlockedAtDateKey: string | null;
  progressPct: number;
  currentMetricLabel: string;
  tierMetal: 'graphite' | 'steel' | 'titanium' | 'kong_lime';
}

export type SocialCardType =
  | 'new_pr'
  | 'workout_completed'
  | 'new_rank'
  | 'challenge_completed'
  | 'weekly_summary'
  | 'cycle_completed';

export type SocialCardFormat = 'story_9_16' | 'post_4_5';

export interface SocialCardExportPayload {
  cardType: SocialCardType;
  format: SocialCardFormat;
  widthPx: 1080;
  heightPx: 1920 | 1350;
  headline: string;
  subheadline: string;
  primaryMetricValue: string;
  primaryMetricLabel: string;
  secondaryMetrics: { label: string; value: string }[];
  rankId: EliteRankId;
  rankTitle: string;
  badgeTitle?: string;
  dateLabel: string;
  officialAppUrl: string;
  officialLogoPath: string;
  includeAthleteAlias: boolean;
  athleteAlias?: string;
  privacyProtectedByDefault: true;
}

export interface CoachRecognitionMessage {
  id: string;
  eventKey: string;
  milestoneType: 'rank_up' | 'challenge_completed' | 'badge_unlocked' | 'deload_honored' | 'new_pr';
  headline: string;
  message: string;
  voiceText: string;
  isImportant: boolean;
  respectsRestTimer: true;
}

export interface EliteChallengesProfileSnapshot {
  profileId: string;
  generatedAt: number;
  totalXp: number;
  currentRank: EliteRankDefinition;
  nextRank: EliteRankDefinition | null;
  xpIntoCurrentRank: number;
  xpRequiredForNextRank: number | null;
  rankProgressPct: number;
  xpLedger: XpLedgerEvent[];
  skippedUnsafeOrDuplicateCount: number;
  challenges: EliteSportChallenge[];
  completedChallengesCount: number;
  badges: ElitePremiumBadge[];
  unlockedBadgesCount: number;
  coachRecognitions: CoachRecognitionMessage[];
  socialCardPresets: Record<SocialCardType, SocialCardExportPayload>;
}

export interface EliteChallengesPlatformAdapter {
  storage: CoachPlatformStorageAdapter;
  exportCardToPngDataUrl: (payload: SocialCardExportPayload) => Promise<{
    dataUrl: string;
    width: number;
    height: number;
    mimeType: 'image/png';
    fileName: string;
  }>;
  triggerDownloadPng: (dataUrl: string, fileName: string) => Promise<boolean>;
  shareCardPng: (payload: SocialCardExportPayload, dataUrl: string, fileName: string) => Promise<{
    shared: boolean;
    method: 'web_share_files' | 'web_share_text' | 'download_fallback' | 'headless_noop';
  }>;
}

/**
 * =========================================================================================
 * LAZCAKONG GYM 7.0 — ETAPA 6: OFFLINE PERFORMANCE PRO & PRODUCTION READINESS
 * =========================================================================================
 */

export type SyncOperationType =
  | 'workout_patch'
  | 'workout_finish'
  | 'workout_cancel'
  | 'routine_save'
  | 'routine_delete'
  | 'bodyweight_update'
  | 'profile_update'
  | 'import_restore'
  | 'full_sync';

export type SyncOperationStatus =
  | 'pending'
  | 'syncing'
  | 'retry_scheduled'
  | 'error';

export interface PendingOfflineSyncOp {
  id: string;
  profileId: string;
  createdAt: string;
  operationType: SyncOperationType;
  status: SyncOperationStatus;
  attempts: number;
  nextRetryAt: number;
  recordVersion: number;
  lastError?: string;
  payload: Record<string, unknown>;
  /** Legacy compatibility mirror of payload for recovery tools/tests */
  data: Record<string, unknown>;
  /** Legacy compatibility timestamp */
  queuedAt: string;
}

export interface OfflineSessionBinding {
  uid: string;
  athleteId: string;
  isGoogleVerified: boolean;
  isAdminVerified: boolean;
  profileSnapshot: Profile;
  verifiedAt: number;
}

export interface OfflineSyncQueueSummary {
  count: number;
  pendingOps: PendingOfflineSyncOp[];
  lastError: string | null;
  hasRetryScheduled: boolean;
}

export interface OfflineAssetDescriptor {
  url: string;
  exerciseName: string;
  libraryId?: string;
  kind: 'animation' | 'thumbnail' | 'secondary_thumbnail';
}

export interface OfflineLibraryRoutineReport {
  routinesCount: number;
  exercisesCount: number;
  uniqueAssets: OfflineAssetDescriptor[];
  uniqueUrls: string[];
}

export interface OfflineAssetCacheStatus {
  cacheName: string;
  cacheVersion: string;
  targetAssetsCount: number;
  cachedAssetsCount: number;
  missingAssetsCount: number;
  lastUpdatedAt: number | null;
  quotaExceeded: boolean;
  lastError: string | null;
  storageUsageBytes?: number;
  storageQuotaBytes?: number;
}

export interface LogoutSafetyStatus {
  pendingSyncCount: number;
  hasActiveWorkout: boolean;
  isOffline: boolean;
  requiresWarning: boolean;
  warningMessage: string | null;
}
