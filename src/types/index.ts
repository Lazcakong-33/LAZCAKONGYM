import { ThemeAccent } from '../utils/theme';

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
  weightUnit: 'kg' | 'lb';
  weightKg?: number;
  heightCm?: number;
  isAdmin?: boolean;
  themeAccent?: ThemeAccent;
  createdAt: string;
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

export interface LoggedSet {
  setNumber: number;
  weight: number | '';
  reps: number | '';
  rpe?: number;
  completed: boolean;
  previous?: string;
  isWarmup?: boolean;
}

export interface WorkoutExerciseState {
  exerciseId: string;
  exerciseName: string;
  originalExerciseId?: string;
  originalExerciseName?: string;
  targetMuscles: string;
  equipment?: string;
  sets: LoggedSet[];
  notes?: string;
  useAlternative?: boolean;
  activeExerciseName: string;
  restSeconds?: number;
  machinePhotoUrl?: string;
}

export interface ActiveWorkoutSession {
  routineId: string;
  routineTitle: string;
  startTime: number;
  exercises: WorkoutExerciseState[];
}

export interface CompletedWorkout {
  id: string;
  routineId: string;
  routineTitle: string;
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
    originalExerciseId?: string;
    originalExerciseName?: string;
    name: string;
    sets: number;
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
  paused?: boolean;
  totalSeconds: number;
  remainingSeconds: number;
  exerciseName?: string;
  minimized: boolean;
  targetEndTime?: number;
  startedAt?: number;
}

export interface LibraryExercise {
  shortInstructions?: string[];
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
}

export interface RoutineAssignment {
  id: string;
  routineId: string;
  targetProfileId: string;
  assignedBy: string;
  assignedAt: string;
  note?: string;
}
