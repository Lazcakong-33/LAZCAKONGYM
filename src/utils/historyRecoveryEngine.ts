import { getLibraryExerciseById, normalizeText, resolveLibraryExercise } from '../data/exerciseLibrary';
import {
  calculateWorkoutCaloriesBurned,
  parseRobustDate,
  getChileLocalDateKey,
  areWorkoutsSameSessionRetry,
} from './calorieCalculator';
import type { CompletedWorkout, ExerciseSetSnapshot, PersonalRecord } from '../types';

export interface CanonicalExerciseIdentity {
  /** Stable canonical key for grouping history, PRs, 1RM charts, and progression */
  canonicalKey: string;
  /** Official or best-known display name */
  canonicalName: string;
  /** Matched catalog ID when an unambiguous catalog match exists */
  libraryExerciseId?: string;
  /** Muscle group if known from catalog or routine mapping */
  muscleGroup?: string;
  /** Normalized variant/equipment signature to prevent mixing incompatible variants */
  variantSignature: string;
}

export interface HistorySourceInventoryItem {
  sourceId: string;
  sourceLabel: string;
  sourceType: 'ui_state' | 'local_storage' | 'local_backup' | 'monthly_archive' | 'offline_queue' | 'firestore_doc' | 'workspace_file';
  accessible: boolean;
  statusNote: string;
  sessionCount: number;
  exerciseCount: number;
  setCount: number;
  minDate: string | null;
  maxDate: string | null;
  profileId?: string;
  boundUid?: string | null;
}

export interface HistoryConflictRecord {
  workoutId: string;
  date: string;
  routineTitle: string;
  keptSource: string;
  conflictingSource: string;
  reason: string;
  keptSummary: { exercises: number; sets: number; totalVolumeKg: number };
  conflictingSummary: { exercises: number; sets: number; totalVolumeKg: number };
  preservedAltWorkout?: CompletedWorkout;
}

export interface AthleteHistoryInventoryReport {
  generatedAt: string;
  activeProfileId: string;
  authUid: string | null;
  authEmail: string | null;
  isAnonymous: boolean;
  uidToAthleteIdBindings: Array<{
    athleteId: string;
    boundUid: string | null;
    isCurrentUid: boolean;
    docExists: boolean;
    sessionCount: number;
  }>;
  sources: HistorySourceInventoryItem[];
  beforeRecovery: {
    sessionCount: number;
    exerciseCount: number;
    setCount: number;
    uniqueExercisesCount: number;
    minDate: string | null;
    maxDate: string | null;
  };
  afterRecovery: {
    sessionCount: number;
    exerciseCount: number;
    setCount: number;
    uniqueExercisesCount: number;
    minDate: string | null;
    maxDate: string | null;
  };
  conflicts: HistoryConflictRecord[];
  rawBackupKey: string;
  rawBackupCreatedAt: string | null;
}

/**
 * Direct mapping of legacy/default routine exercise IDs and known routine names
 * to their exact catalog UUID in `exerciseLibrary.json` (when unambiguous) or
 * a stable canonical key + display name when multiple catalog variants exist.
 */
const ROUTINE_EXERCISE_ID_MAP: Record<string, {
  canonicalKey: string;
  canonicalName: string;
  libraryExerciseId?: string;
  muscleGroup: string;
}> = {
  // Lunes / Miércoles / Jueves / Viernes — Piernas & Glúteos
  'lun-prensa-45': {
    canonicalKey: 'lib:c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    canonicalName: 'Prensa 45°',
    libraryExerciseId: 'c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    muscleGroup: 'Cuádriceps',
  },
  'mie-prensa-45': {
    canonicalKey: 'lib:c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    canonicalName: 'Prensa 45°',
    libraryExerciseId: 'c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    muscleGroup: 'Cuádriceps',
  },
  'jue-prensa-45': {
    canonicalKey: 'lib:c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    canonicalName: 'Prensa 45°',
    libraryExerciseId: 'c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    muscleGroup: 'Cuádriceps',
  },
  'vie-prensa-rugby': {
    canonicalKey: 'lib:c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    canonicalName: 'Prensa 45°',
    libraryExerciseId: 'c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    muscleGroup: 'Cuádriceps',
  },
  'lun-curl-femoral': {
    canonicalKey: 'canon:curl_femoral_maquina',
    canonicalName: 'Curl femoral',
    libraryExerciseId: '47c2fdba-3dc1-4f88-a76f-f1de62cd2bc3',
    muscleGroup: 'Isquiotibiales',
  },
  'mie-curl-femoral': {
    canonicalKey: 'canon:curl_femoral_maquina',
    canonicalName: 'Curl femoral',
    libraryExerciseId: '47c2fdba-3dc1-4f88-a76f-f1de62cd2bc3',
    muscleGroup: 'Isquiotibiales',
  },
  'jue-curl-femoral': {
    canonicalKey: 'canon:curl_femoral_maquina',
    canonicalName: 'Curl femoral',
    libraryExerciseId: '47c2fdba-3dc1-4f88-a76f-f1de62cd2bc3',
    muscleGroup: 'Isquiotibiales',
  },
  'vie-curl-femoral-rugby': {
    canonicalKey: 'canon:curl_femoral_maquina',
    canonicalName: 'Curl femoral',
    libraryExerciseId: '47c2fdba-3dc1-4f88-a76f-f1de62cd2bc3',
    muscleGroup: 'Isquiotibiales',
  },
  'lun-ext-cuadriceps': {
    canonicalKey: 'lib:82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    canonicalName: 'Extensión de cuádriceps',
    libraryExerciseId: '82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    muscleGroup: 'Cuádriceps',
  },
  'jue-ext-cuadriceps': {
    canonicalKey: 'lib:82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    canonicalName: 'Extensión de cuádriceps',
    libraryExerciseId: '82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    muscleGroup: 'Cuádriceps',
  },
  'lun-gemelos': {
    canonicalKey: 'lib:a6da31f4-8d19-4dc6-a9b8-b4fc0fb5da17',
    canonicalName: 'Elevación de talones',
    libraryExerciseId: 'a6da31f4-8d19-4dc6-a9b8-b4fc0fb5da17',
    muscleGroup: 'Gemelos',
  },
  'jue-gemelos': {
    canonicalKey: 'lib:a6da31f4-8d19-4dc6-a9b8-b4fc0fb5da17',
    canonicalName: 'Elevación de talones',
    libraryExerciseId: 'a6da31f4-8d19-4dc6-a9b8-b4fc0fb5da17',
    muscleGroup: 'Gemelos',
  },
  'jue-abductores': {
    canonicalKey: 'lib:25fd6743-c4af-4bf9-8ed2-ffec80b5eb98',
    canonicalName: 'Abductores en máquina',
    libraryExerciseId: '25fd6743-c4af-4bf9-8ed2-ffec80b5eb98',
    muscleGroup: 'Glúteos',
  },
  'jue-sentadilla-banco': {
    canonicalKey: 'lib:8275c556-7f7d-4eb6-b022-b4eeb71bf5e7',
    canonicalName: 'Sentadilla a banco con mancuerna',
    libraryExerciseId: '8275c556-7f7d-4eb6-b022-b4eeb71bf5e7',
    muscleGroup: 'Cuádriceps',
  },
  // Core
  'lun-pallof-press': {
    canonicalKey: 'lib:5d0aa5fe-f112-40d7-a52f-2cfee554c6f9',
    canonicalName: 'Pallof press',
    libraryExerciseId: '5d0aa5fe-f112-40d7-a52f-2cfee554c6f9',
    muscleGroup: 'Core',
  },
  'mie-pallof-press': {
    canonicalKey: 'lib:5d0aa5fe-f112-40d7-a52f-2cfee554c6f9',
    canonicalName: 'Pallof press',
    libraryExerciseId: '5d0aa5fe-f112-40d7-a52f-2cfee554c6f9',
    muscleGroup: 'Core',
  },
  'vie-core-pallof-rugby': {
    canonicalKey: 'lib:5d0aa5fe-f112-40d7-a52f-2cfee554c6f9',
    canonicalName: 'Pallof press',
    libraryExerciseId: '5d0aa5fe-f112-40d7-a52f-2cfee554c6f9',
    muscleGroup: 'Core',
  },
  'lun-plancha': {
    canonicalKey: 'lib:b3de44fb-27c0-4a83-94aa-89ff39561084',
    canonicalName: 'Plancha frontal',
    libraryExerciseId: 'b3de44fb-27c0-4a83-94aa-89ff39561084',
    muscleGroup: 'Core',
  },
  'jue-plancha': {
    canonicalKey: 'lib:b3de44fb-27c0-4a83-94aa-89ff39561084',
    canonicalName: 'Plancha frontal',
    libraryExerciseId: 'b3de44fb-27c0-4a83-94aa-89ff39561084',
    muscleGroup: 'Core',
  },
  // Torso / Espalda / Pecho / Hombros / Brazos
  'mar-press-pecho-maq': {
    canonicalKey: 'lib:5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    canonicalName: 'Press de pecho en máquina',
    libraryExerciseId: '5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    muscleGroup: 'Pecho',
  },
  'mie-press-pecho-maq': {
    canonicalKey: 'lib:5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    canonicalName: 'Press de pecho en máquina',
    libraryExerciseId: '5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    muscleGroup: 'Pecho',
  },
  'vie-press-pecho-rugby': {
    canonicalKey: 'lib:5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    canonicalName: 'Press de pecho en máquina',
    libraryExerciseId: '5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    muscleGroup: 'Pecho',
  },
  'mar-remo-sentado': {
    canonicalKey: 'lib:258fc219-dc97-4f8b-9085-23daec1e609c',
    canonicalName: 'Remo sentado en polea',
    libraryExerciseId: '258fc219-dc97-4f8b-9085-23daec1e609c',
    muscleGroup: 'Espalda',
  },
  'mie-remo-sentado': {
    canonicalKey: 'lib:258fc219-dc97-4f8b-9085-23daec1e609c',
    canonicalName: 'Remo sentado en polea',
    libraryExerciseId: '258fc219-dc97-4f8b-9085-23daec1e609c',
    muscleGroup: 'Espalda',
  },
  'vie-remo-polea-rugby': {
    canonicalKey: 'lib:258fc219-dc97-4f8b-9085-23daec1e609c',
    canonicalName: 'Remo sentado en polea',
    libraryExerciseId: '258fc219-dc97-4f8b-9085-23daec1e609c',
    muscleGroup: 'Espalda',
  },
  'mar-jalon-pecho': {
    canonicalKey: 'lib:5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    canonicalName: 'Jalón al pecho',
    libraryExerciseId: '5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    muscleGroup: 'Espalda',
  },
  'mie-jalon-pecho': {
    canonicalKey: 'lib:5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    canonicalName: 'Jalón al pecho',
    libraryExerciseId: '5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    muscleGroup: 'Espalda',
  },
  'vie-jalon-pecho-rugby': {
    canonicalKey: 'lib:5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    canonicalName: 'Jalón al pecho',
    libraryExerciseId: '5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    muscleGroup: 'Espalda',
  },
  'mar-press-hombro-manc': {
    canonicalKey: 'lib:9f11a91b-a970-4821-a8d7-dfea46e1cfbe',
    canonicalName: 'Press de hombros con mancuernas sentado',
    libraryExerciseId: '9f11a91b-a970-4821-a8d7-dfea46e1cfbe',
    muscleGroup: 'Hombros',
  },
  'mie-elev-laterales': {
    canonicalKey: 'lib:494ee6ee-12e5-4f43-825f-ac0a7ca9bf96',
    canonicalName: 'Elevaciones laterales con mancuernas',
    libraryExerciseId: '494ee6ee-12e5-4f43-825f-ac0a7ca9bf96',
    muscleGroup: 'Hombros',
  },
  'vie-hombro-lat-rugby': {
    canonicalKey: 'lib:494ee6ee-12e5-4f43-825f-ac0a7ca9bf96',
    canonicalName: 'Elevaciones laterales con mancuernas',
    libraryExerciseId: '494ee6ee-12e5-4f43-825f-ac0a7ca9bf96',
    muscleGroup: 'Hombros',
  },
  'mar-curl-biceps': {
    canonicalKey: 'lib:4bf7a885-d4a0-4f7c-b3eb-9ef2f25a54ee',
    canonicalName: 'Curl de bíceps con mancuernas',
    libraryExerciseId: '4bf7a885-d4a0-4f7c-b3eb-9ef2f25a54ee',
    muscleGroup: 'Bíceps',
  },
  'mar-triceps-cuerda': {
    canonicalKey: 'lib:05b1b2ab-0a38-4f63-bfeb-b18ef3efee39',
    canonicalName: 'Extensión de tríceps en polea con cuerda',
    libraryExerciseId: '05b1b2ab-0a38-4f63-bfeb-b18ef3efee39',
    muscleGroup: 'Tríceps',
  },
};

/**
 * Historical name & alias equivalence table for exercises whose routine or historical
 * Spanish/English names were logged before `libraryExerciseId` existed, or whose generic
 * routine names intentionally stay unassigned in the visual picker.
 */
const HISTORICAL_NAME_EQUIVALENCE_MAP: Record<string, {
  canonicalKey: string;
  canonicalName: string;
  libraryExerciseId?: string;
  muscleGroup: string;
}> = {
  // Sentadilla Hack family
  'sentadilla hack': {
    canonicalKey: 'lib:6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    canonicalName: 'Sentadilla Hack en Máquina',
    libraryExerciseId: '6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    muscleGroup: 'Cuádriceps',
  },
  'sentadilla hack en maquina': {
    canonicalKey: 'lib:6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    canonicalName: 'Sentadilla Hack en Máquina',
    libraryExerciseId: '6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    muscleGroup: 'Cuádriceps',
  },
  'hack squat': {
    canonicalKey: 'lib:6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    canonicalName: 'Sentadilla Hack en Máquina',
    libraryExerciseId: '6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    muscleGroup: 'Cuádriceps',
  },
  'hack squat / smith': {
    canonicalKey: 'lib:6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    canonicalName: 'Sentadilla Hack en Máquina',
    libraryExerciseId: '6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    muscleGroup: 'Cuádriceps',
  },
  'hack / smith': {
    canonicalKey: 'lib:6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    canonicalName: 'Sentadilla Hack en Máquina',
    libraryExerciseId: '6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    muscleGroup: 'Cuádriceps',
  },
  'maquina hack': {
    canonicalKey: 'lib:6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    canonicalName: 'Sentadilla Hack en Máquina',
    libraryExerciseId: '6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    muscleGroup: 'Cuádriceps',
  },

  // Prensa 45° family
  'prensa 45': {
    canonicalKey: 'lib:c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    canonicalName: 'Prensa 45°',
    libraryExerciseId: 'c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    muscleGroup: 'Cuádriceps',
  },
  'prensa': {
    canonicalKey: 'lib:c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    canonicalName: 'Prensa 45°',
    libraryExerciseId: 'c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    muscleGroup: 'Cuádriceps',
  },
  'prensa de piernas': {
    canonicalKey: 'lib:c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    canonicalName: 'Prensa 45°',
    libraryExerciseId: 'c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    muscleGroup: 'Cuádriceps',
  },
  'prensa de piernas inclinada': {
    canonicalKey: 'lib:c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    canonicalName: 'Prensa 45°',
    libraryExerciseId: 'c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    muscleGroup: 'Cuádriceps',
  },
  'prensa inclinada': {
    canonicalKey: 'lib:c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    canonicalName: 'Prensa 45°',
    libraryExerciseId: 'c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    muscleGroup: 'Cuádriceps',
  },

  // Prensa horizontal (kept separate from Prensa 45°)
  'prensa horizontal': {
    canonicalKey: 'lib:1e70d6ff-98eb-49fd-999b-bbcf32eb2ca8',
    canonicalName: 'Prensa horizontal en máquina',
    libraryExerciseId: '1e70d6ff-98eb-49fd-999b-bbcf32eb2ca8',
    muscleGroup: 'Cuádriceps',
  },
  'prensa horizontal en maquina': {
    canonicalKey: 'lib:1e70d6ff-98eb-49fd-999b-bbcf32eb2ca8',
    canonicalName: 'Prensa horizontal en máquina',
    libraryExerciseId: '1e70d6ff-98eb-49fd-999b-bbcf32eb2ca8',
    muscleGroup: 'Cuádriceps',
  },

  // Curl femoral
  'curl femoral': {
    canonicalKey: 'canon:curl_femoral_maquina',
    canonicalName: 'Curl femoral',
    libraryExerciseId: '47c2fdba-3dc1-4f88-a76f-f1de62cd2bc3',
    muscleGroup: 'Isquiotibiales',
  },
  'curl femoral en maquina': {
    canonicalKey: 'canon:curl_femoral_maquina',
    canonicalName: 'Curl femoral',
    libraryExerciseId: '47c2fdba-3dc1-4f88-a76f-f1de62cd2bc3',
    muscleGroup: 'Isquiotibiales',
  },
  'curl femoral sentado': {
    canonicalKey: 'lib:47c2fdba-3dc1-4f88-a76f-f1de62cd2bc3',
    canonicalName: 'Curl femoral sentado en máquina',
    libraryExerciseId: '47c2fdba-3dc1-4f88-a76f-f1de62cd2bc3',
    muscleGroup: 'Isquiotibiales',
  },
  'curl femoral tumbado': {
    canonicalKey: 'lib:82db8d3a-96aa-4902-8d5c-1102a740d4c3',
    canonicalName: 'Curl femoral tumbado en máquina',
    libraryExerciseId: '82db8d3a-96aa-4902-8d5c-1102a740d4c3',
    muscleGroup: 'Isquiotibiales',
  },
  'curl femoral acostado': {
    canonicalKey: 'lib:82db8d3a-96aa-4902-8d5c-1102a740d4c3',
    canonicalName: 'Curl femoral tumbado en máquina',
    libraryExerciseId: '82db8d3a-96aa-4902-8d5c-1102a740d4c3',
    muscleGroup: 'Isquiotibiales',
  },

  // Extensión de cuádriceps
  'extension de cuadriceps': {
    canonicalKey: 'lib:82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    canonicalName: 'Extensión de cuádriceps',
    libraryExerciseId: '82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    muscleGroup: 'Cuádriceps',
  },
  'extension cuadriceps': {
    canonicalKey: 'lib:82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    canonicalName: 'Extensión de cuádriceps',
    libraryExerciseId: '82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    muscleGroup: 'Cuádriceps',
  },
  'extensiones de cuadriceps': {
    canonicalKey: 'lib:82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    canonicalName: 'Extensión de cuádriceps',
    libraryExerciseId: '82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    muscleGroup: 'Cuádriceps',
  },
  'silla de cuadriceps': {
    canonicalKey: 'lib:82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    canonicalName: 'Extensión de cuádriceps',
    libraryExerciseId: '82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    muscleGroup: 'Cuádriceps',
  },

  // Gemelos / Elevación de talones
  'elevacion de talones': {
    canonicalKey: 'lib:a6da31f4-8d19-4dc6-a9b8-b4fc0fb5da17',
    canonicalName: 'Elevación de talones',
    libraryExerciseId: 'a6da31f4-8d19-4dc6-a9b8-b4fc0fb5da17',
    muscleGroup: 'Gemelos',
  },
  'elevacion de gemelos': {
    canonicalKey: 'lib:a6da31f4-8d19-4dc6-a9b8-b4fc0fb5da17',
    canonicalName: 'Elevación de talones',
    libraryExerciseId: 'a6da31f4-8d19-4dc6-a9b8-b4fc0fb5da17',
    muscleGroup: 'Gemelos',
  },
  'gemelos en prensa': {
    canonicalKey: 'lib:9f12c9ae-3f1d-4d06-a5f6-2de2efdf9a18',
    canonicalName: 'Elevación de talones en prensa',
    libraryExerciseId: '9f12c9ae-3f1d-4d06-a5f6-2de2efdf9a18',
    muscleGroup: 'Gemelos',
  },

  // Abductores / Aductores
  'abductores en maquina': {
    canonicalKey: 'lib:25fd6743-c4af-4bf9-8ed2-ffec80b5eb98',
    canonicalName: 'Abductores en máquina',
    libraryExerciseId: '25fd6743-c4af-4bf9-8ed2-ffec80b5eb98',
    muscleGroup: 'Glúteos',
  },
  'abduccion de cadera en maquina': {
    canonicalKey: 'lib:25fd6743-c4af-4bf9-8ed2-ffec80b5eb98',
    canonicalName: 'Abductores en máquina',
    libraryExerciseId: '25fd6743-c4af-4bf9-8ed2-ffec80b5eb98',
    muscleGroup: 'Glúteos',
  },
  'abduccion con banda': {
    canonicalKey: 'lib:42eb06cb-7be7-44e4-9195-5a7763bc19f6',
    canonicalName: 'Abducción con banda',
    libraryExerciseId: '42eb06cb-7be7-44e4-9195-5a7763bc19f6',
    muscleGroup: 'Glúteos',
  },

  // Sentadilla a banco / Goblet
  'sentadilla a banco con mancuerna': {
    canonicalKey: 'lib:8275c556-7f7d-4eb6-b022-b4eeb71bf5e7',
    canonicalName: 'Sentadilla a banco con mancuerna',
    libraryExerciseId: '8275c556-7f7d-4eb6-b022-b4eeb71bf5e7',
    muscleGroup: 'Cuádriceps',
  },
  'sentadilla goblet a cajon': {
    canonicalKey: 'lib:8275c556-7f7d-4eb6-b022-b4eeb71bf5e7',
    canonicalName: 'Sentadilla a banco con mancuerna',
    libraryExerciseId: '8275c556-7f7d-4eb6-b022-b4eeb71bf5e7',
    muscleGroup: 'Cuádriceps',
  },
  'sentadilla goblet': {
    canonicalKey: 'lib:05b1c23e-9a4e-4d58-a577-31eb2a4e8f77',
    canonicalName: 'Sentadilla Goblet con mancuerna',
    libraryExerciseId: '05b1c23e-9a4e-4d58-a577-31eb2a4e8f77',
    muscleGroup: 'Cuádriceps',
  },

  // Pecho
  'press de pecho en maquina': {
    canonicalKey: 'lib:5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    canonicalName: 'Press de pecho en máquina',
    libraryExerciseId: '5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    muscleGroup: 'Pecho',
  },
  'press pecho maquina': {
    canonicalKey: 'lib:5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    canonicalName: 'Press de pecho en máquina',
    libraryExerciseId: '5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    muscleGroup: 'Pecho',
  },
  'press en maquina': {
    canonicalKey: 'lib:5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    canonicalName: 'Press de pecho en máquina',
    libraryExerciseId: '5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    muscleGroup: 'Pecho',
  },
  'chest press': {
    canonicalKey: 'lib:5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    canonicalName: 'Press de pecho en máquina',
    libraryExerciseId: '5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    muscleGroup: 'Pecho',
  },

  // Espalda
  'remo sentado en polea': {
    canonicalKey: 'lib:258fc219-dc97-4f8b-9085-23daec1e609c',
    canonicalName: 'Remo sentado en polea',
    libraryExerciseId: '258fc219-dc97-4f8b-9085-23daec1e609c',
    muscleGroup: 'Espalda',
  },
  'remo en polea baja': {
    canonicalKey: 'lib:258fc219-dc97-4f8b-9085-23daec1e609c',
    canonicalName: 'Remo sentado en polea',
    libraryExerciseId: '258fc219-dc97-4f8b-9085-23daec1e609c',
    muscleGroup: 'Espalda',
  },
  'remo gironda': {
    canonicalKey: 'lib:258fc219-dc97-4f8b-9085-23daec1e609c',
    canonicalName: 'Remo sentado en polea',
    libraryExerciseId: '258fc219-dc97-4f8b-9085-23daec1e609c',
    muscleGroup: 'Espalda',
  },
  'remo en maquina': {
    canonicalKey: 'lib:5fd12343-348c-4449-9072-7024a782f684',
    canonicalName: 'Remo en máquina',
    libraryExerciseId: '5fd12343-348c-4449-9072-7024a782f684',
    muscleGroup: 'Espalda',
  },
  'remo pecho apoyado': {
    canonicalKey: 'lib:5fd12343-348c-4449-9072-7024a782f684',
    canonicalName: 'Remo en máquina',
    libraryExerciseId: '5fd12343-348c-4449-9072-7024a782f684',
    muscleGroup: 'Espalda',
  },
  'jalon al pecho': {
    canonicalKey: 'lib:5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    canonicalName: 'Jalón al pecho',
    libraryExerciseId: '5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    muscleGroup: 'Espalda',
  },
  'jalon al pecho en polea': {
    canonicalKey: 'lib:5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    canonicalName: 'Jalón al pecho',
    libraryExerciseId: '5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    muscleGroup: 'Espalda',
  },
  'polea al pecho': {
    canonicalKey: 'lib:5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    canonicalName: 'Jalón al pecho',
    libraryExerciseId: '5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    muscleGroup: 'Espalda',
  },
  'lat pulldown': {
    canonicalKey: 'lib:5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    canonicalName: 'Jalón al pecho',
    libraryExerciseId: '5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    muscleGroup: 'Espalda',
  },
  'jalon agarre neutro': {
    canonicalKey: 'lib:348e2fd1-6004-465c-96f9-a0808ff1bc1b',
    canonicalName: 'Jalón al pecho con agarre cerrado',
    libraryExerciseId: '348e2fd1-6004-465c-96f9-a0808ff1bc1b',
    muscleGroup: 'Espalda',
  },

  // Hombros
  'press de hombros con mancuernas sentado': {
    canonicalKey: 'lib:9f11a91b-a970-4821-a8d7-dfea46e1cfbe',
    canonicalName: 'Press de hombros con mancuernas sentado',
    libraryExerciseId: '9f11a91b-a970-4821-a8d7-dfea46e1cfbe',
    muscleGroup: 'Hombros',
  },
  'press militar con mancuernas sentado': {
    canonicalKey: 'lib:9f11a91b-a970-4821-a8d7-dfea46e1cfbe',
    canonicalName: 'Press de hombros con mancuernas sentado',
    libraryExerciseId: '9f11a91b-a970-4821-a8d7-dfea46e1cfbe',
    muscleGroup: 'Hombros',
  },
  'press hombro en maquina': {
    canonicalKey: 'lib:f08c1125-f44b-4b11-94ef-59e04114c425',
    canonicalName: 'Press de hombros en máquina',
    libraryExerciseId: 'f08c1125-f44b-4b11-94ef-59e04114c425',
    muscleGroup: 'Hombros',
  },
  'press de hombro en maquina': {
    canonicalKey: 'lib:f08c1125-f44b-4b11-94ef-59e04114c425',
    canonicalName: 'Press de hombros en máquina',
    libraryExerciseId: 'f08c1125-f44b-4b11-94ef-59e04114c425',
    muscleGroup: 'Hombros',
  },
  'elevaciones laterales con mancuernas': {
    canonicalKey: 'lib:494ee6ee-12e5-4f43-825f-ac0a7ca9bf96',
    canonicalName: 'Elevaciones laterales con mancuernas',
    libraryExerciseId: '494ee6ee-12e5-4f43-825f-ac0a7ca9bf96',
    muscleGroup: 'Hombros',
  },
  'elevaciones laterales': {
    canonicalKey: 'lib:494ee6ee-12e5-4f43-825f-ac0a7ca9bf96',
    canonicalName: 'Elevaciones laterales con mancuernas',
    libraryExerciseId: '494ee6ee-12e5-4f43-825f-ac0a7ca9bf96',
    muscleGroup: 'Hombros',
  },
  'vuelos laterales': {
    canonicalKey: 'lib:494ee6ee-12e5-4f43-825f-ac0a7ca9bf96',
    canonicalName: 'Elevaciones laterales con mancuernas',
    libraryExerciseId: '494ee6ee-12e5-4f43-825f-ac0a7ca9bf96',
    muscleGroup: 'Hombros',
  },
  'elevacion lateral en polea': {
    canonicalKey: 'lib:60d822bf-a435-4810-9142-c62520e3f273',
    canonicalName: 'Elevaciones laterales en polea',
    libraryExerciseId: '60d822bf-a435-4810-9142-c62520e3f273',
    muscleGroup: 'Hombros',
  },

  // Brazos
  'curl de biceps': {
    canonicalKey: 'lib:4bf7a885-d4a0-4f7c-b3eb-9ef2f25a54ee',
    canonicalName: 'Curl de bíceps con mancuernas',
    libraryExerciseId: '4bf7a885-d4a0-4f7c-b3eb-9ef2f25a54ee',
    muscleGroup: 'Bíceps',
  },
  'curl de biceps con mancuernas': {
    canonicalKey: 'lib:4bf7a885-d4a0-4f7c-b3eb-9ef2f25a54ee',
    canonicalName: 'Curl de bíceps con mancuernas',
    libraryExerciseId: '4bf7a885-d4a0-4f7c-b3eb-9ef2f25a54ee',
    muscleGroup: 'Bíceps',
  },
  'curl biceps mancuernas': {
    canonicalKey: 'lib:4bf7a885-d4a0-4f7c-b3eb-9ef2f25a54ee',
    canonicalName: 'Curl de bíceps con mancuernas',
    libraryExerciseId: '4bf7a885-d4a0-4f7c-b3eb-9ef2f25a54ee',
    muscleGroup: 'Bíceps',
  },
  'curl en polea': {
    canonicalKey: 'lib:f129818f-379e-46ee-a2d8-8f1a81506186',
    canonicalName: 'Curl de bíceps en polea baja',
    libraryExerciseId: 'f129818f-379e-46ee-a2d8-8f1a81506186',
    muscleGroup: 'Bíceps',
  },
  'extension de triceps en polea con cuerda': {
    canonicalKey: 'lib:05b1b2ab-0a38-4f63-bfeb-b18ef3efee39',
    canonicalName: 'Extensión de tríceps en polea con cuerda',
    libraryExerciseId: '05b1b2ab-0a38-4f63-bfeb-b18ef3efee39',
    muscleGroup: 'Tríceps',
  },
  'triceps en polea con cuerda': {
    canonicalKey: 'lib:05b1b2ab-0a38-4f63-bfeb-b18ef3efee39',
    canonicalName: 'Extensión de tríceps en polea con cuerda',
    libraryExerciseId: '05b1b2ab-0a38-4f63-bfeb-b18ef3efee39',
    muscleGroup: 'Tríceps',
  },
  'triceps con barra recta': {
    canonicalKey: 'lib:6b8ff589-80a2-4a2b-a214-2ee411955598',
    canonicalName: 'Extensión de tríceps en polea con barra',
    libraryExerciseId: '6b8ff589-80a2-4a2b-a214-2ee411955598',
    muscleGroup: 'Tríceps',
  },

  // Core
  'pallof press': {
    canonicalKey: 'lib:5d0aa5fe-f112-40d7-a52f-2cfee554c6f9',
    canonicalName: 'Pallof press',
    libraryExerciseId: '5d0aa5fe-f112-40d7-a52f-2cfee554c6f9',
    muscleGroup: 'Core',
  },
  'press pallof': {
    canonicalKey: 'lib:5d0aa5fe-f112-40d7-a52f-2cfee554c6f9',
    canonicalName: 'Pallof press',
    libraryExerciseId: '5d0aa5fe-f112-40d7-a52f-2cfee554c6f9',
    muscleGroup: 'Core',
  },
  'plancha frontal': {
    canonicalKey: 'lib:b3de44fb-27c0-4a83-94aa-89ff39561084',
    canonicalName: 'Plancha frontal',
    libraryExerciseId: 'b3de44fb-27c0-4a83-94aa-89ff39561084',
    muscleGroup: 'Core',
  },
  'plancha abdominal': {
    canonicalKey: 'lib:b3de44fb-27c0-4a83-94aa-89ff39561084',
    canonicalName: 'Plancha frontal',
    libraryExerciseId: 'b3de44fb-27c0-4a83-94aa-89ff39561084',
    muscleGroup: 'Core',
  },
  'plancha lateral': {
    canonicalKey: 'lib:51bd86e2-66ea-410c-9f28-8e442f01bc40',
    canonicalName: 'Plancha lateral',
    libraryExerciseId: '51bd86e2-66ea-410c-9f28-8e442f01bc40',
    muscleGroup: 'Core',
  },
  'dead bug': {
    canonicalKey: 'lib:c93a5a8f-0e02-403e-b8c4-5d06ab8b7dc8',
    canonicalName: 'Dead bug',
    libraryExerciseId: 'c93a5a8f-0e02-403e-b8c4-5d06ab8b7dc8',
    muscleGroup: 'Core',
  },
  'bird dog': {
    canonicalKey: 'lib:821e6ca2-00fd-4287-8b5b-dc9502ca9dc0',
    canonicalName: 'Bird dog',
    libraryExerciseId: '821e6ca2-00fd-4287-8b5b-dc9502ca9dc0',
    muscleGroup: 'Core',
  },
};

function computeVariantSignatureToken(rawName?: string, rawEquipment?: string): string {
  const norm = normalizeText(`${rawName || ''} ${rawEquipment || ''}`);
  if (!norm) return 'base';

  const parts: string[] = [];
  if (/\b(inclinad[oa]|incline)\b/.test(norm) && !/\bprensa\b/.test(norm)) parts.push('incline');
  if (/\b(declinad[oa]|decline)\b/.test(norm)) parts.push('decline');
  if (/\b(unilateral|una mano|una pierna|1 mano|1 pierna|single arm|single leg|alternad[oa]|bulgara)\b/.test(norm)) {
    parts.push('unilateral');
  }
  if (/\b(agarre cerrad[oa]|cerrad[oa]|estrech[oa]|close grip)\b/.test(norm)) parts.push('close');
  if (/\b(agarre ancho|agarre amplio|ancho|amplio|abierto|wide grip)\b/.test(norm)) parts.push('wide');
  if (/\b(supin[oa]|underhand|reverse grip)\b/.test(norm)) parts.push('supinated');
  if (/\b(pron[oa]|overhand)\b/.test(norm)) parts.push('pronated');

  return parts.length > 0 ? parts.join('_') : 'base';
}

export function calculateEpley1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return Math.round(weight * 10) / 10;
  return Math.round(weight * (1 + Math.min(reps, 30) / 30) * 10) / 10;
}

/**
 * Resolves any historical or active exercise reference (`exerciseId`, `libraryExerciseId`, `name`)
 * into a unified `CanonicalExerciseIdentity`.
 *
 * Guarantees:
 * 1. Reconciles legacy routine IDs (`lun-prensa-45`, `mar-press-pecho-maq`, etc.), catalog UUIDs,
 *    and historical Spanish/English names (`Sentadilla Hack`, `Hack squat / Smith`, `Prensa 45°`, etc.).
 * 2. Preserves custom/legacy exercises that have no match in the new catalog (`custom:<normalized_name>`).
 * 3. Never mixes distinct exercises, equipment, or biomechanical variants.
 */
export function resolveCanonicalExerciseIdentity(input: {
  exerciseId?: string;
  libraryExerciseId?: string;
  name?: string;
  muscleGroup?: string;
  equipment?: string;
}): CanonicalExerciseIdentity {
  const rawExId = String(input.exerciseId || '').trim();
  const rawLibId = String(input.libraryExerciseId || '').trim();
  const rawName = String(input.name || '').trim();
  const normName = normalizeText(rawName);
  const variantSig = computeVariantSignatureToken(rawName, input.equipment);

  // 1. Direct libraryExerciseId match
  if (rawLibId) {
    const libItem = getLibraryExerciseById(rawLibId);
    if (libItem) {
      return {
        canonicalKey: `lib:${libItem.id}`,
        canonicalName: rawName || libItem.name,
        libraryExerciseId: libItem.id,
        muscleGroup: input.muscleGroup || libItem.muscleGroup || libItem.primaryMuscles?.[0] || undefined,
        variantSignature: variantSig,
      };
    }
  }

  // 2. Check if exerciseId is itself a catalog UUID
  if (rawExId) {
    const libByExId = getLibraryExerciseById(rawExId);
    if (libByExId) {
      return {
        canonicalKey: `lib:${libByExId.id}`,
        canonicalName: rawName || libByExId.name,
        libraryExerciseId: libByExId.id,
        muscleGroup: input.muscleGroup || libByExId.muscleGroup || libByExId.primaryMuscles?.[0] || undefined,
        variantSignature: variantSig,
      };
    }
  }

  // 3. Check historical name equivalence map FIRST when a name is present
  // (in case a routine slot was swapped to an alternative like "Sentadilla Hack" while keeping routine slot ID)
  if (normName && HISTORICAL_NAME_EQUIVALENCE_MAP[normName]) {
    const entry = HISTORICAL_NAME_EQUIVALENCE_MAP[normName];
    return {
      canonicalKey: entry.canonicalKey,
      canonicalName: rawName || entry.canonicalName,
      libraryExerciseId: entry.libraryExerciseId,
      muscleGroup: input.muscleGroup || entry.muscleGroup,
      variantSignature: variantSig,
    };
  }

  // 4. Check catalog resolver (`resolveLibraryExercise` handles exact names & `exerciseAliases.json`)
  if (rawName || rawExId) {
    const resolved = resolveLibraryExercise({
      id: rawExId || undefined,
      libraryExerciseId: rawLibId || undefined,
      name: rawName || undefined,
      equipment: input.equipment,
    });
    if (resolved) {
      return {
        canonicalKey: `lib:${resolved.id}`,
        canonicalName: rawName || resolved.name,
        libraryExerciseId: resolved.id,
        muscleGroup: input.muscleGroup || resolved.muscleGroup || resolved.primaryMuscles?.[0] || undefined,
        variantSignature: variantSig,
      };
    }
  }

  // 5. Check routine exercise ID map (when name wasn't overridden by a different exercise)
  if (rawExId && ROUTINE_EXERCISE_ID_MAP[rawExId]) {
    const routineMapped = ROUTINE_EXERCISE_ID_MAP[rawExId];
    const normMappedName = normalizeText(routineMapped.canonicalName);
    if (
      !normName ||
      normName === normMappedName ||
      normName.includes(normMappedName) ||
      normMappedName.includes(normName)
    ) {
      return {
        canonicalKey: routineMapped.canonicalKey,
        canonicalName: rawName || routineMapped.canonicalName,
        libraryExerciseId: routineMapped.libraryExerciseId,
        muscleGroup: input.muscleGroup || routineMapped.muscleGroup,
        variantSignature: variantSig,
      };
    }
  }

  // 6. Fallback for custom or legacy exercises not in the catalog — preserve intact!
  const fallbackKey = normName
    ? `custom:${normName}:${variantSig}`
    : rawExId
      ? `legacy_id:${rawExId.toLowerCase()}`
      : 'unknown_exercise';

  return {
    canonicalKey: fallbackKey,
    canonicalName: rawName || rawExId || 'Ejercicio Histórico',
    libraryExerciseId: undefined,
    muscleGroup: input.muscleGroup || 'General',
    variantSignature: variantSig,
  };
}

export const RAW_UNFILTERED_BACKUP_KEY = 'lazcakon_raw_unfiltered_backup_v1';

/**
 * Step 2: RESPALDO ANTES DE REPARAR
 * Captures an intact, unfiltered snapshot of all available localStorage keys and raw cloud
 * snapshots BEFORE any sanitizer or migration runs. Never overwrites an existing raw backup
 * with empty data.
 */
export function backupAllRawSourcesBeforeRepair(
  activeProfileId: string,
  cloudRawSnapshots?: Record<string, unknown>
): { backupKey: string; createdAt: string; keysBackedUp: string[] } {
  const nowIso = new Date().toISOString();
  if (typeof window === 'undefined' || !window.localStorage) {
    return { backupKey: RAW_UNFILTERED_BACKUP_KEY, createdAt: nowIso, keysBackedUp: [] };
  }

  try {
    const existingRawStr = window.localStorage.getItem(RAW_UNFILTERED_BACKUP_KEY);
    let existingPayload: Record<string, any> = {};
    if (existingRawStr) {
      try {
        existingPayload = JSON.parse(existingRawStr) || {};
      } catch {
        existingPayload = {};
      }
    }

    const localSnapshot: Record<string, string> = { ...(existingPayload.localSnapshot || {}) };
    const keysBackedUp: string[] = [];

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key === RAW_UNFILTERED_BACKUP_KEY) continue;
      if (
        key.startsWith('lazcakon_') &&
        (key.includes('history') ||
          key.includes('prs') ||
          key.includes('routines') ||
          key.includes('bodyweight') ||
          key.includes('backup') ||
          key.includes('historico') ||
          key.includes('sync_queue') ||
          key.includes('profiles'))
      ) {
        const val = window.localStorage.getItem(key);
        if (val !== null) {
          const isEmptyArrayStr = val.trim() === '[]' || val.trim() === '{}';
          if (!localSnapshot[key] || !isEmptyArrayStr) {
            localSnapshot[key] = val;
          }
          keysBackedUp.push(key);
        }
      }
    }

    const mergedCloudSnapshots: Record<string, unknown> = {
      ...(existingPayload.cloudRawSnapshots || {}),
    };
    if (cloudRawSnapshots) {
      for (const [docKey, rawDoc] of Object.entries(cloudRawSnapshots)) {
        if (rawDoc !== undefined && rawDoc !== null) {
          mergedCloudSnapshots[docKey] = rawDoc;
        }
      }
    }

    const payload = {
      version: 1,
      firstCreatedAt: existingPayload.firstCreatedAt || nowIso,
      lastUpdatedAt: nowIso,
      activeProfileId,
      localSnapshot,
      cloudRawSnapshots: mergedCloudSnapshots,
    };

    window.localStorage.setItem(RAW_UNFILTERED_BACKUP_KEY, JSON.stringify(payload));
    return {
      backupKey: RAW_UNFILTERED_BACKUP_KEY,
      createdAt: payload.firstCreatedAt,
      keysBackedUp,
    };
  } catch (err) {
    console.warn('[HistoryRecoveryEngine] Could not write raw backup to localStorage:', err);
    return { backupKey: RAW_UNFILTERED_BACKUP_KEY, createdAt: nowIso, keysBackedUp: [] };
  }
}

/**
 * Losslessly normalizes a single raw historical workout record from any legacy or current format
 * into a valid `CompletedWorkout` object while preserving original IDs, dates, durations, sets,
 * weights, reps, RPE/RIR, and custom exercises.
 */
export function normalizeHistoricalWorkoutRecord(
  rawItem: any,
  fallbackIndex: number = 0,
  athleteWeightKg: number = 95
): CompletedWorkout | null {
  if (!rawItem || typeof rawItem !== 'object') return null;

  // Respect explicit deletion tombstones
  if (rawItem.deleted === true || rawItem.isDeleted === true) return null;

  // Accept either `exercisesSummary` or legacy `exercises` array
  const rawExList: any[] = Array.isArray(rawItem.exercisesSummary) && rawItem.exercisesSummary.length > 0
    ? rawItem.exercisesSummary
    : Array.isArray(rawItem.exercises)
      ? rawItem.exercises
      : [];

  if (rawExList.length === 0) return null;

  const rawDateStr = String(
    rawItem.date ||
    rawItem.completedAt ||
    (typeof rawItem.endTime === 'number' && rawItem.endTime > 0 ? new Date(rawItem.endTime).toISOString() : '') ||
    (typeof rawItem.startTime === 'number' && rawItem.startTime > 0 ? new Date(rawItem.startTime).toISOString() : '')
  ).trim();
  if (!rawDateStr) return null;

  const parsedDateObj = parseRobustDate(rawDateStr);
  const parsedDateMs = parsedDateObj && !Number.isNaN(parsedDateObj.getTime())
    ? parsedDateObj.getTime()
    : new Date(rawDateStr).getTime();

  if (Number.isNaN(parsedDateMs)) return null;

  const normalizedExercises: CompletedWorkout['exercisesSummary'] = [];
  let workoutTotalSets = 0;
  let workoutTotalVolume = 0;

  for (let exIdx = 0; exIdx < rawExList.length; exIdx++) {
    const ex = rawExList[exIdx];
    if (!ex || typeof ex !== 'object') continue;

    const rawSetsArray: any[] | null = Array.isArray(ex.setsDetail) && ex.setsDetail.length > 0
      ? ex.setsDetail
      : Array.isArray(ex.sets)
        ? ex.sets
        : null;

    const setsDetail: ExerciseSetSnapshot[] = [];
    if (rawSetsArray) {
      for (let sIdx = 0; sIdx < rawSetsArray.length; sIdx++) {
        const s = rawSetsArray[sIdx];
        if (!s || typeof s !== 'object') continue;

        const wRaw = s.weight ?? s.weightKg ?? s.targetWeightKg ?? 0;
        const rRaw = s.reps ?? s.targetReps ?? 0;
        const wNum = Number(wRaw);
        const rNum = Number(rRaw);
        const weight = Number.isFinite(wNum) && wNum >= 0 ? wNum : 0;
        const reps = Number.isFinite(rNum) && rNum >= 0 ? Math.round(rNum) : 0;

        if (s.completed === false && weight <= 0 && reps <= 0) continue;
        if (reps <= 0 && weight <= 0) continue;

        const rpeVal = s.rpe !== undefined && s.rpe !== null && Number.isFinite(Number(s.rpe)) && Number(s.rpe) > 0
          ? Number(s.rpe)
          : undefined;
        const rirVal = s.rir !== undefined && s.rir !== null && Number.isFinite(Number(s.rir)) && Number(s.rir) >= 0
          ? Number(s.rir)
          : undefined;

        setsDetail.push({
          ...(typeof s.id === 'string' && s.id.trim() ? { id: s.id.trim() } : {}),
          setNumber: Number.isFinite(Number(s.setNumber)) && Number(s.setNumber) > 0
            ? Number(s.setNumber)
            : setsDetail.length + 1,
          weight,
          reps: reps > 0 ? reps : 1,
          completed: true,
          ...(typeof s.completedAt === 'string' && s.completedAt.trim() ? { completedAt: s.completedAt.trim() } : {}),
          ...(rpeVal !== undefined ? { rpe: rpeVal } : {}),
          ...(rirVal !== undefined ? { rir: rirVal } : {}),
        });
      }
    }

    const numericSetsCount = typeof ex.sets === 'number' && Number.isFinite(ex.sets) && ex.sets > 0
      ? Math.round(ex.sets)
      : setsDetail.length;

    const maxWeightFromSets = setsDetail.reduce((max, s) => Math.max(max, s.weight), 0);
    const maxWeight = Math.max(
      maxWeightFromSets,
      Number.isFinite(Number(ex.maxWeight)) ? Number(ex.maxWeight) : 0,
      Number.isFinite(Number(ex.bestWeightKg)) ? Number(ex.bestWeightKg) : 0,
      Number.isFinite(Number(ex.weightKg)) ? Number(ex.weightKg) : 0,
      Number.isFinite(Number(ex.weight)) ? Number(ex.weight) : 0
    );

    const maxRepsFromSets = setsDetail.reduce((max, s) => Math.max(max, s.reps), 0);
    const maxReps = Math.max(
      maxRepsFromSets,
      Number.isFinite(Number(ex.maxReps)) ? Math.round(Number(ex.maxReps)) : 0,
      Number.isFinite(Number(ex.bestReps)) ? Math.round(Number(ex.bestReps)) : 0,
      Number.isFinite(Number(ex.reps)) ? Math.round(Number(ex.reps)) : 0
    );

    const finalSetsCount = setsDetail.length > 0 ? setsDetail.length : numericSetsCount;
    if (finalSetsCount <= 0 && maxWeight <= 0 && maxReps <= 0) continue;

    const effectiveName = String(ex.activeExerciseName || ex.name || ex.exerciseName || '').trim();
    const identity = resolveCanonicalExerciseIdentity({
      exerciseId: ex.exerciseId || ex.id,
      libraryExerciseId: ex.libraryExerciseId,
      name: effectiveName,
      muscleGroup: ex.muscleGroup || ex.targetMuscles,
      equipment: ex.equipment,
    });

    const exVolume = setsDetail.length > 0
      ? setsDetail.reduce((acc, s) => acc + s.weight * s.reps, 0)
      : typeof ex.volumeKg === 'number' && ex.volumeKg > 0
        ? ex.volumeKg
        : finalSetsCount * maxWeight * (maxReps || 1);

    const best1RM = setsDetail.length > 0
      ? setsDetail.reduce((max, s) => Math.max(max, calculateEpley1RM(s.weight, s.reps)), 0)
      : calculateEpley1RM(maxWeight, maxReps || 1);

    workoutTotalSets += finalSetsCount;
    workoutTotalVolume += exVolume;

    normalizedExercises.push({
      ...ex,
      exerciseId: String(ex.exerciseId || ex.id || identity.libraryExerciseId || `hist-ex-${exIdx}`),
      libraryExerciseId: ex.libraryExerciseId || identity.libraryExerciseId,
      originalExerciseId: ex.originalExerciseId,
      originalExerciseName: ex.originalExerciseName,
      name: effectiveName || identity.canonicalName,
      equipment: ex.equipment,
      muscleGroup: String(ex.muscleGroup || ex.targetMuscles || identity.muscleGroup || 'General').trim(),
      sets: finalSetsCount,
      maxWeight,
      maxReps,
      volumeKg: Math.round(exVolume),
      estimated1RM: typeof ex.estimated1RM === 'number' && ex.estimated1RM > 0 ? ex.estimated1RM : best1RM,
      setsDetail: setsDetail.length > 0 ? setsDetail : undefined,
    });
  }

  if (normalizedExercises.length === 0 || workoutTotalSets <= 0) return null;

  // If explicitly marked `isFinished === false` and had no completed sets, we already returned null above.
  const rawDuration = Number(rawItem.durationSeconds);
  const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0 && rawDuration <= 180 * 60
    ? Math.round(rawDuration)
    : Math.min(120 * 60, Math.max(25 * 60, Math.round(workoutTotalSets * 3.5 * 60)));

  const endTime = typeof rawItem.endTime === 'number' && rawItem.endTime > 0
    ? rawItem.endTime
    : parsedDateMs;
  const startTime = typeof rawItem.startTime === 'number' && rawItem.startTime > 0
    ? rawItem.startTime
    : endTime - durationSeconds * 1000;

  const routineTitle = String(rawItem.routineTitle || rawItem.title || 'Entrenamiento Registrado').trim();
  const totalVolumeKg = typeof rawItem.totalVolumeKg === 'number' && rawItem.totalVolumeKg > 0 && workoutTotalVolume === 0
    ? Math.round(rawItem.totalVolumeKg)
    : Math.round(workoutTotalVolume);

  const rawCalories = Number(rawItem.caloriesBurned);
  const caloriesBurned = Number.isFinite(rawCalories) && rawCalories > 0 && rawCalories <= 2500
    ? Math.round(rawCalories)
    : calculateWorkoutCaloriesBurned({
        durationMinutes: Math.round(durationSeconds / 60),
        totalVolumeKg,
        bodyWeightKg: athleteWeightKg > 0 ? athleteWeightKg : 95,
        completedSetsCount: workoutTotalSets,
        completedExercises: normalizedExercises.map(ex => ({
          name: ex.name,
          muscleGroup: ex.muscleGroup,
          setsCompleted: ex.sets,
          completed: true,
          rpe: ex.rpe,
        })),
        routineTitle,
      });

  const chileDateKey = getChileLocalDateKey(parsedDateMs) || rawDateStr.slice(0, 10);
  const stableId = String(rawItem.id || '').trim() ||
    `recovered-${chileDateKey}-${normalizeText(routineTitle).replace(/\s+/g, '-')}-${fallbackIndex}`;

  return {
    ...rawItem,
    id: stableId,
    routineId: String(rawItem.routineId || 'rutina-historica'),
    routineTitle,
    date: rawItem.date || new Date(parsedDateMs).toISOString(),
    startTime,
    endTime,
    durationSeconds,
    totalVolumeKg,
    completedSetsCount: workoutTotalSets,
    caloriesBurned,
    isFinished: true,
    exercisesSummary: normalizedExercises,
  };
}

function computeWorkoutCompletenessScore(w: CompletedWorkout): number {
  const exList = w.exercisesSummary || [];
  let detailedSetsCount = 0;
  let rpeCount = 0;
  for (const ex of exList) {
    if (Array.isArray(ex.setsDetail)) {
      detailedSetsCount += ex.setsDetail.length;
      for (const s of ex.setsDetail) {
        if (s.rpe !== undefined || s.rir !== undefined) rpeCount++;
      }
    }
  }
  return (
    exList.length * 100 +
    (w.completedSetsCount || 0) * 25 +
    detailedSetsCount * 30 +
    rpeCount * 10 +
    (w.totalVolumeKg > 0 ? 50 : 0)
  );
}

function createWorkoutContentFingerprint(w: CompletedWorkout): string {
  const exParts = (w.exercisesSummary || []).map(ex => {
    const iden = resolveCanonicalExerciseIdentity({
      exerciseId: ex.exerciseId,
      libraryExerciseId: ex.libraryExerciseId,
      name: ex.name,
      equipment: ex.equipment,
    });
    const setsSig = (ex.setsDetail || [])
      .map(s => `${s.weight}x${s.reps}`)
      .join(',');
    return `${iden.canonicalKey}[${ex.sets}:${ex.maxWeight}x${ex.maxReps}:${setsSig}]`;
  });
  return exParts.join('|');
}

export interface NamedHistorySourceInput {
  sourceId: string;
  sourceLabel: string;
  sourceType: HistorySourceInventoryItem['sourceType'];
  rawRecords: any[];
  profileId?: string;
  boundUid?: string | null;
}

/**
 * Step 3: RECUPERACIÓN COMPLETA Y UNIÓN SIN PÉRDIDAS
 * Combines workout records from all available sources for the athlete:
 * - Deduplicates retries strictly by stable `workout.id`.
 * - NEVER deletes two distinct sessions on the same day even if they have identical exercises/sets.
 * - If two sources have the same `workout.id` with different content, keeps the more complete record
 *   and records a `HistoryConflictRecord` (preserving the alternative snapshot for inspection).
 */
export function reconcileAndUnifyAthleteHistory(
  sources: NamedHistorySourceInput[],
  athleteWeightKg: number = 95
): {
  unifiedHistory: CompletedWorkout[];
  conflicts: HistoryConflictRecord[];
  sourceInventory: HistorySourceInventoryItem[];
} {
  const byId = new Map<string, { workout: CompletedWorkout; sourceLabel: string; fingerprint: string; score: number }>();
  const conflicts: HistoryConflictRecord[] = [];
  const sourceInventory: HistorySourceInventoryItem[] = [];

  for (const src of sources) {
    const rawArr = Array.isArray(src.rawRecords) ? src.rawRecords : [];
    let validSessions = 0;
    let totalEx = 0;
    let totalSets = 0;
    let minDate: string | null = null;
    let maxDate: string | null = null;

    for (let i = 0; i < rawArr.length; i++) {
      const normalized = normalizeHistoricalWorkoutRecord(rawArr[i], i, athleteWeightKg);
      if (!normalized) continue;

      validSessions++;
      const exCount = normalized.exercisesSummary?.length || 0;
      const setCount = normalized.completedSetsCount || 0;
      totalEx += exCount;
      totalSets += setCount;

      const dIso = normalized.date;
      if (!minDate || dIso < minDate) minDate = dIso;
      if (!maxDate || dIso > maxDate) maxDate = dIso;

      const fp = createWorkoutContentFingerprint(normalized);
      const score = computeWorkoutCompletenessScore(normalized);

      const existing = byId.get(normalized.id);
      if (!existing) {
        byId.set(normalized.id, {
          workout: normalized,
          sourceLabel: src.sourceLabel,
          fingerprint: fp,
          score,
        });
      } else if (existing.fingerprint !== fp) {
        const keepNew = score > existing.score ||
          (score === existing.score && (normalized.endTime || 0) > (existing.workout.endTime || 0));

        const winner = keepNew ? normalized : existing.workout;
        const loser = keepNew ? existing.workout : normalized;
        const winnerSource = keepNew ? src.sourceLabel : existing.sourceLabel;
        const loserSource = keepNew ? existing.sourceLabel : src.sourceLabel;

        if (
          (winner.exercisesSummary?.length || 0) !== (loser.exercisesSummary?.length || 0) ||
          winner.completedSetsCount !== loser.completedSetsCount ||
          Math.abs((winner.totalVolumeKg || 0) - (loser.totalVolumeKg || 0)) > 1
        ) {
          conflicts.push({
            workoutId: normalized.id,
            date: winner.date,
            routineTitle: winner.routineTitle,
            keptSource: winnerSource,
            conflictingSource: loserSource,
            reason: 'Mismo ID de sesión con diferencias en series o volumen entre fuentes; se conservó la versión más completa y se respaldó la variante.',
            keptSummary: {
              exercises: winner.exercisesSummary?.length || 0,
              sets: winner.completedSetsCount,
              totalVolumeKg: winner.totalVolumeKg,
            },
            conflictingSummary: {
              exercises: loser.exercisesSummary?.length || 0,
              sets: loser.completedSetsCount,
              totalVolumeKg: loser.totalVolumeKg,
            },
            preservedAltWorkout: loser,
          });
        }

        if (keepNew) {
          byId.set(normalized.id, {
            workout: normalized,
            sourceLabel: src.sourceLabel,
            fingerprint: fp,
            score,
          });
        }
      }
    }

    sourceInventory.push({
      sourceId: src.sourceId,
      sourceLabel: src.sourceLabel,
      sourceType: src.sourceType,
      accessible: true,
      statusNote: validSessions > 0 ? `${validSessions} sesiones válidas` : 'Accesible (0 sesiones)',
      sessionCount: validSessions,
      exerciseCount: totalEx,
      setCount: totalSets,
      minDate,
      maxDate,
      profileId: src.profileId,
      boundUid: src.boundUid,
    });
  }

  const dedupedList: { workout: CompletedWorkout; score: number }[] = [];
  const candidatesSorted = Array.from(byId.values()).sort((a, b) => {
    const tsB = parseRobustDate(b.workout.date)?.getTime() || b.workout.endTime || 0;
    const tsA = parseRobustDate(a.workout.date)?.getTime() || a.workout.endTime || 0;
    return tsB - tsA;
  });

  const isGenericDayTitle = (t: string) =>
    /^rutina\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$/i.test((t || '').trim());

  for (const cand of candidatesSorted) {
    const existingIdx = dedupedList.findIndex((item) =>
      areWorkoutsSameSessionRetry(item.workout, cand.workout)
    );
    if (existingIdx === -1) {
      dedupedList.push({ workout: cand.workout, score: cand.score });
      continue;
    }

    const existing = dedupedList[existingIdx];
    const existingEffectiveScore =
      existing.score +
      (isGenericDayTitle(existing.workout.routineTitle) ? 0 : 50) +
      (existing.workout.id.startsWith('recovered-') ? 0 : 20);
    const candEffectiveScore =
      cand.score +
      (isGenericDayTitle(cand.workout.routineTitle) ? 0 : 50) +
      (cand.workout.id.startsWith('recovered-') ? 0 : 20);

    if (candEffectiveScore > existingEffectiveScore) {
      const mergedExercises = cand.workout.exercisesSummary.map((ex) => {
        if (Array.isArray(ex.setsDetail) && ex.setsDetail.length > 0) return ex;
        const matchEx = existing.workout.exercisesSummary.find(
          (e) => e.name.trim().toLowerCase() === ex.name.trim().toLowerCase()
        );
        return matchEx?.setsDetail?.length ? { ...ex, setsDetail: matchEx.setsDetail } : ex;
      });
      dedupedList[existingIdx] = {
        workout: { ...cand.workout, exercisesSummary: mergedExercises },
        score: cand.score,
      };
    } else {
      const mergedExercises = existing.workout.exercisesSummary.map((ex) => {
        if (Array.isArray(ex.setsDetail) && ex.setsDetail.length > 0) return ex;
        const matchEx = cand.workout.exercisesSummary.find(
          (e) => e.name.trim().toLowerCase() === ex.name.trim().toLowerCase()
        );
        return matchEx?.setsDetail?.length ? { ...ex, setsDetail: matchEx.setsDetail } : ex;
      });
      dedupedList[existingIdx] = {
        ...existing,
        workout: { ...existing.workout, exercisesSummary: mergedExercises },
      };
    }
  }

  const unifiedHistory = dedupedList
    .map((entry) => entry.workout)
    .sort((a, b) => {
      const tsB = parseRobustDate(b.date)?.getTime() || b.endTime || 0;
      const tsA = parseRobustDate(a.date)?.getTime() || a.endTime || 0;
      return tsB - tsA;
    });

  return {
    unifiedHistory,
    conflicts,
    sourceInventory,
  };
}

/**
 * Derives and reconciles Personal Records (`PersonalRecord[]`) across both stored PRs
 * and the full recovered workout history so no historical PR is ever lost.
 */
export function reconcilePersonalRecordsFromHistory(
  existingPrs: PersonalRecord[],
  unifiedHistory: CompletedWorkout[]
): PersonalRecord[] {
  const prByCanonicalKey = new Map<string, PersonalRecord>();

  // 1. Seed with existing stored PRs
  if (Array.isArray(existingPrs)) {
    for (const pr of existingPrs) {
      if (!pr || typeof pr !== 'object') continue;
      const w = Number(pr.maxWeight ?? (pr as any).weightKg ?? 0);
      const r = Number(pr.repsAtMaxWeight ?? (pr as any).reps ?? 0);
      if (w <= 0 || r <= 0) continue;

      const iden = resolveCanonicalExerciseIdentity({
        exerciseId: pr.exerciseId,
        name: pr.exerciseName,
      });
      const calc1Rm = calculateEpley1RM(w, r);
      const estimated1RM = Math.max(Number(pr.estimated1RM) || 0, calc1Rm);
      const current = prByCanonicalKey.get(iden.canonicalKey);

      if (
        !current ||
        w > current.maxWeight ||
        (w === current.maxWeight && estimated1RM > current.estimated1RM)
      ) {
        prByCanonicalKey.set(iden.canonicalKey, {
          exerciseId: pr.exerciseId || iden.libraryExerciseId || iden.canonicalKey,
          exerciseName: pr.exerciseName || iden.canonicalName,
          maxWeight: w,
          repsAtMaxWeight: r,
          estimated1RM,
          date: pr.date || new Date().toISOString(),
        });
      }
    }
  }

  // 2. Scan all recovered workouts from oldest to newest
  const chronological = [...unifiedHistory].sort((a, b) => {
    const tsA = parseRobustDate(a.date)?.getTime() || a.endTime || 0;
    const tsB = parseRobustDate(b.date)?.getTime() || b.endTime || 0;
    return tsA - tsB;
  });

  for (const workout of chronological) {
    const exList = workout.exercisesSummary || [];
    for (const ex of exList) {
      const iden = resolveCanonicalExerciseIdentity({
        exerciseId: ex.exerciseId,
        libraryExerciseId: ex.libraryExerciseId,
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        equipment: ex.equipment,
      });

      const candidateSets: Array<{ weight: number; reps: number }> = [];
      if (Array.isArray(ex.setsDetail) && ex.setsDetail.length > 0) {
        for (const s of ex.setsDetail) {
          if (s.weight > 0 && s.reps > 0) {
            candidateSets.push({ weight: s.weight, reps: s.reps });
          }
        }
      } else if (ex.maxWeight > 0 && ex.maxReps > 0) {
        candidateSets.push({ weight: ex.maxWeight, reps: ex.maxReps });
      }

      for (const s of candidateSets) {
        const oneRm = calculateEpley1RM(s.weight, s.reps);
        const current = prByCanonicalKey.get(iden.canonicalKey);
        if (
          !current ||
          s.weight > current.maxWeight ||
          (s.weight === current.maxWeight && s.reps > current.repsAtMaxWeight)
        ) {
          prByCanonicalKey.set(iden.canonicalKey, {
            exerciseId: ex.exerciseId || iden.libraryExerciseId || iden.canonicalKey,
            exerciseName: ex.name || iden.canonicalName,
            maxWeight: s.weight,
            repsAtMaxWeight: s.reps,
            estimated1RM: Math.max(oneRm, current?.estimated1RM || 0),
            date: workout.date,
          });
        }
      }
    }
  }

  return Array.from(prByCanonicalKey.values()).sort((a, b) => b.maxWeight - a.maxWeight);
}

/**
 * Collects all localStorage sources (profile history keys, pre-import backups,
 * monthly archives, offline sync queue, and raw unfiltered backup) for the athlete.
 */
export function collectAllLocalHistorySources(activeProfileId: string): NamedHistorySourceInput[] {
  const sources: NamedHistorySourceInput[] = [];
  if (typeof window === 'undefined' || !window.localStorage) return sources;

  const parseJsonSafe = (raw: string | null): any => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const isLegacyPrimaryProfile =
    activeProfileId === 'perfil_admin_master' ||
    activeProfileId === 'perfil_1' ||
    activeProfileId === 'perfil_default';

  const candidateProfileIds = Array.from(
    new Set(
      isLegacyPrimaryProfile
        ? [activeProfileId, 'perfil_admin_master', 'perfil_1', 'perfil_default']
        : [activeProfileId]
    )
  ).filter(Boolean);

  const allowedHistoryKeys = new Set(candidateProfileIds.map((pid) => `lazcakon_${pid}_history`));
  const matchesAllowedProfileKey = (key: string): boolean =>
    candidateProfileIds.some(
      (pid) =>
        key === `lazcakon_${pid}_pre_import_backup` ||
        key.startsWith(`lazcakon_${pid}_pre_import_backup`) ||
        key === `lazcakon_historico_mensual_${pid}` ||
        key.includes(`_${pid}_`)
    );

  // 1. Direct profile history keys in localStorage
  for (const pid of candidateProfileIds) {
    const key = `lazcakon_${pid}_history`;
    const rawStr = window.localStorage.getItem(key);
    if (rawStr !== null) {
      const parsed = parseJsonSafe(rawStr);
      sources.push({
        sourceId: `local:${key}`,
        sourceLabel: `LocalStorage (${key})`,
        sourceType: 'local_storage',
        rawRecords: Array.isArray(parsed) ? parsed : [],
        profileId: pid,
      });
    }
  }

  // 2. Scan scoped keys in localStorage for backups, monthly archives, or offline queue of this profile
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key) continue;

    if (key.includes('_pre_import_backup') && matchesAllowedProfileKey(key)) {
      const parsed = parseJsonSafe(window.localStorage.getItem(key));
      const histArr = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.history)
          ? parsed.history
          : [];
      sources.push({
        sourceId: `backup:${key}`,
        sourceLabel: `Respaldo Pre-Importación (${key})`,
        sourceType: 'local_backup',
        rawRecords: histArr,
        profileId: activeProfileId,
      });
    } else if (key.startsWith('lazcakon_historico_mensual_') && (matchesAllowedProfileKey(key) || (isLegacyPrimaryProfile && key === 'lazcakon_historico_mensual_v1'))) {
      const parsed = parseJsonSafe(window.localStorage.getItem(key));
      if (parsed && typeof parsed === 'object') {
        const archiveWorkouts: any[] = [];
        for (const monthBucket of Object.values(parsed as Record<string, any>)) {
          if (Array.isArray(monthBucket)) {
            archiveWorkouts.push(...monthBucket);
          } else if (monthBucket && Array.isArray(monthBucket.workouts)) {
            archiveWorkouts.push(...monthBucket.workouts);
          }
        }
        sources.push({
          sourceId: `monthly:${key}`,
          sourceLabel: `Archivo Histórico Mensual (${key})`,
          sourceType: 'monthly_archive',
          rawRecords: archiveWorkouts,
          profileId: activeProfileId,
        });
      }
    } else if (key === 'lazcakon_pending_offline_sync_queue') {
      const parsed = parseJsonSafe(window.localStorage.getItem(key));
      if (Array.isArray(parsed)) {
        const queuedWorkouts: any[] = [];
        for (const item of parsed) {
          if (!item || (item.profileId && !candidateProfileIds.includes(item.profileId))) {
            continue;
          }
          const sourcePayload = item.payload || item.data;
          if (sourcePayload && Array.isArray(sourcePayload.history)) {
            queuedWorkouts.push(...sourcePayload.history);
          }
        }
        if (queuedWorkouts.length > 0) {
          sources.push({
            sourceId: `queue:${key}`,
            sourceLabel: `Cola Offline Pendiente (${key})`,
            sourceType: 'offline_queue',
            rawRecords: queuedWorkouts,
            profileId: activeProfileId,
          });
        }
      }
    }
  }

  // 3. Also inspect the raw unfiltered backup strictly for this athlete's history keys
  const rawBackup = parseJsonSafe(window.localStorage.getItem(RAW_UNFILTERED_BACKUP_KEY));
  if (rawBackup && rawBackup.localSnapshot && typeof rawBackup.localSnapshot === 'object') {
    const rawSnapshotWorkouts: any[] = [];
    for (const [snapKey, snapValStr] of Object.entries(rawBackup.localSnapshot as Record<string, string>)) {
      if (allowedHistoryKeys.has(snapKey)) {
        const arr = parseJsonSafe(snapValStr);
        if (Array.isArray(arr)) {
          rawSnapshotWorkouts.push(...arr);
        }
      }
    }
    if (rawSnapshotWorkouts.length > 0) {
      sources.push({
        sourceId: `raw_backup:${RAW_UNFILTERED_BACKUP_KEY}`,
        sourceLabel: `Respaldo Íntegro Sin Filtros (${RAW_UNFILTERED_BACKUP_KEY})`,
        sourceType: 'local_backup',
        rawRecords: rawSnapshotWorkouts,
        profileId: activeProfileId,
      });
    }
  }

  return sources;
}

export function summarizeHistoryMetrics(history: CompletedWorkout[]) {
  let exerciseCount = 0;
  let setCount = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  const uniqueCanonicalKeys = new Set<string>();

  for (const w of history) {
    if (!w) continue;
    const exList = w.exercisesSummary || [];
    exerciseCount += exList.length;
    setCount += w.completedSetsCount || exList.reduce((acc, e) => acc + (e.sets || 0), 0);
    if (w.date) {
      if (!minDate || w.date < minDate) minDate = w.date;
      if (!maxDate || w.date > maxDate) maxDate = w.date;
    }
    for (const ex of exList) {
      const iden = resolveCanonicalExerciseIdentity({
        exerciseId: ex.exerciseId,
        libraryExerciseId: ex.libraryExerciseId,
        name: ex.name,
        equipment: ex.equipment,
      });
      uniqueCanonicalKeys.add(iden.canonicalKey);
    }
  }

  return {
    sessionCount: history.length,
    exerciseCount,
    setCount,
    uniqueExercisesCount: uniqueCanonicalKeys.size,
    minDate,
    maxDate,
  };
}

export interface LegacyUuidResolutionAuditItem {
  legacyUuid: string;
  historicalLabel: string;
  classification: 'unequivocal_compatible' | 'ambiguous_preserve_original' | 'absent_preserve_original';
  mappedCurrentUuid: string | null;
  mappedCurrentName: string | null;
  note: string;
}

/**
 * Etapa 2A — Auditoría documentada de las 30 referencias UUID históricas detectadas en
 * ROUTINE_EXERCISE_ID_MAP y HISTORICAL_NAME_EQUIVALENCE_MAP.
 * - Las 17 equivalencias 1:1 inequívocas se resuelven de forma retrocompatible mediante `exerciseAliases.json -> ids`.
 * - Las 6 referencias ambiguas y 7 ausentes del catálogo conservan sus UUID históricos originales sin reasignación automática.
 */
export const LEGACY_UUID_RESOLUTION_AUDIT: readonly LegacyUuidResolutionAuditItem[] = [
  // 17 Equivalencias inequívocas (compatibles vía exerciseAliases.json -> ids)
  {
    legacyUuid: 'c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    historicalLabel: 'Prensa 45°',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: 'e17ca855-8185-fbc6-bb54-ab9c4334f0f7',
    mappedCurrentName: 'Prensa de Piernas Inclinada',
    note: 'Equivalencia directa 1:1 de prensa inclinada 45° conservando UUID histórico en registros.',
  },
  {
    legacyUuid: '1e70d6ff-98eb-49fd-999b-bbcf32eb2ca8',
    historicalLabel: 'Prensa horizontal en máquina',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: 'ccc8321a-3db5-40a3-b687-0cb47f4ee2c9',
    mappedCurrentName: 'Prensa de Piernas Horizontal',
    note: 'Equivalencia directa 1:1 de prensa horizontal en máquina.',
  },
  {
    legacyUuid: '82db8d3a-96aa-4902-8d5c-1102a740d4c3',
    historicalLabel: 'Curl femoral tumbado en máquina',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: 'bdfbf8c4-7d96-f9bd-f441-523c1a434312',
    mappedCurrentName: 'Curl femoral acostado en máquina',
    note: 'Equivalencia directa 1:1 de curl femoral prono/acostado.',
  },
  {
    legacyUuid: '82f8fb17-fbef-4b64-a316-0dfad0ad6abe',
    historicalLabel: 'Extensión de cuádriceps',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: '8fd1b9d5-ad0c-8fa5-da97-dcb248588ef5',
    mappedCurrentName: 'Extensión de piernas en máquina',
    note: 'Equivalencia directa 1:1 de extensión bilateral de rodillas en máquina.',
  },
  {
    legacyUuid: '9f12c9ae-3f1d-4d06-a5f6-2de2efdf9a18',
    historicalLabel: 'Elevación de talones en prensa',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: '187d7214-9b1e-4f2d-b028-f2aebd561d8b',
    mappedCurrentName: 'Elevación de gemelos en prensa',
    note: 'Equivalencia directa 1:1 de gemelos en prensa.',
  },
  {
    legacyUuid: '25fd6743-c4af-4bf9-8ed2-ffec80b5eb98',
    historicalLabel: 'Abductores en máquina',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: 'c0d708f6-00ab-118f-9f7d-e13f27e5458b',
    mappedCurrentName: 'Abducción de cadera en máquina',
    note: 'Equivalencia directa 1:1 de abducción de cadera sentado en máquina.',
  },
  {
    legacyUuid: '5d0aa5fe-f112-40d7-a52f-2cfee554c6f9',
    historicalLabel: 'Pallof press',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: 'd0e78959-c1de-400c-a7fb-44c1015d5013',
    mappedCurrentName: 'Press Pallof de rodillas con cable',
    note: 'Equivalencia histórica usada por ELITE_EXTRA_ALIASES para press Pallof en polea.',
  },
  {
    legacyUuid: '5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
    historicalLabel: 'Press de pecho en máquina',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: 'd04e4922-8aec-4584-9657-ceda935dc57e',
    mappedCurrentName: 'Press de pecho en máquina sentado',
    note: 'Equivalencia directa 1:1 de chest press en máquina sentado.',
  },
  {
    legacyUuid: '258fc219-dc97-4f8b-9085-23daec1e609c',
    historicalLabel: 'Remo sentado en polea',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: '1a335136-840a-4499-9778-4ddef29a6771',
    mappedCurrentName: 'Remo en polea baja sentado',
    note: 'Equivalencia directa 1:1 de remo Gironda / polea baja sentado.',
  },
  {
    legacyUuid: '5325ccab-b29b-4ca9-8e9b-a5ef2c0ca104',
    historicalLabel: 'Jalón al pecho',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: '5b5ad96b-a5d1-a271-9b57-aa0dfda9d77b',
    mappedCurrentName: 'Jalón en polea al pecho',
    note: 'Equivalencia directa 1:1 de jalón vertical en polea alta.',
  },
  {
    legacyUuid: '348e2fd1-6004-465c-96f9-a0808ff1bc1b',
    historicalLabel: 'Jalón al pecho con agarre cerrado',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: '91df77ee-5ffe-4d59-b1e5-885862ec28c3',
    mappedCurrentName: 'Jalón al pecho con agarre estrecho',
    note: 'Equivalencia directa 1:1 de jalón al pecho agarre cerrado/estrecho.',
  },
  {
    legacyUuid: '9f11a91b-a970-4821-a8d7-dfea46e1cfbe',
    historicalLabel: 'Press de hombros con mancuernas sentado',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: '5b2bdea5-ceee-a837-596c-fd2f6138ffff',
    mappedCurrentName: 'Press de hombros sentado con mancuernas',
    note: 'Equivalencia directa 1:1 de press militar sentado con mancuernas.',
  },
  {
    legacyUuid: 'f08c1125-f44b-4b11-94ef-59e04114c425',
    historicalLabel: 'Press de hombros en máquina',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: '6b0ffef6-8dd1-4b89-999a-a11d85d9e16f',
    mappedCurrentName: 'Press de hombro en máquina',
    note: 'Equivalencia directa 1:1 de press de hombro sentado en máquina.',
  },
  {
    legacyUuid: '494ee6ee-12e5-4f43-825f-ac0a7ca9bf96',
    historicalLabel: 'Elevaciones laterales con mancuernas',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: 'ac965c65-7896-c2f8-4ab2-5bda19534b41',
    mappedCurrentName: 'Elevación lateral con mancuernas',
    note: 'Equivalencia directa 1:1 de elevación lateral bilateral con mancuernas.',
  },
  {
    legacyUuid: '4bf7a885-d4a0-4f7c-b3eb-9ef2f25a54ee',
    historicalLabel: 'Curl de bíceps con mancuernas',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: '835d99fc-dcdb-38f2-ca92-48e87ba6f5b1',
    mappedCurrentName: 'Curl alterno con mancuernas',
    note: 'Equivalencia histórica directa de curl de bíceps con mancuernas.',
  },
  {
    legacyUuid: '05b1b2ab-0a38-4f63-bfeb-b18ef3efee39',
    historicalLabel: 'Extensión de tríceps en polea con cuerda',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: 'fe01e50a-b97c-4bb7-87f2-bed05cfa2445',
    mappedCurrentName: 'Extensión de tríceps en polea con cuerda',
    note: 'Equivalencia directa 1:1 con idéntico ejercicio y agarre cuerda.',
  },
  {
    legacyUuid: '6b3db243-4f6d-479f-87c1-f07bf2a92da2',
    historicalLabel: 'Sentadilla Hack en Máquina',
    classification: 'unequivocal_compatible',
    mappedCurrentUuid: '8ae59cb6-8a70-4eb6-b2b3-35abe8060f0f',
    mappedCurrentName: 'Sentadilla Jaca en Máquina',
    note: 'Equivalencia directa 1:1 de Hack Squat en máquina.',
  },
  // 6 Referencias ambiguas (múltiples variantes en catálogo; no reasignar automáticamente)
  {
    legacyUuid: '47c2fdba-3dc1-4f88-a76f-f1de62cd2bc3',
    historicalLabel: 'Curl femoral',
    classification: 'ambiguous_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Ambiguo entre curl femoral sentado (3ae8ee86...) y acostado (bdfbf8c4...); se preserva UUID histórico.',
  },
  {
    legacyUuid: 'a6da31f4-8d19-4dc6-a9b8-b4fc0fb5da17',
    historicalLabel: 'Elevación de talones',
    classification: 'ambiguous_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Ambiguo entre 8 variantes de gemelos (de pie, sentado, prensa, máquina, mancuerna); se preserva UUID histórico.',
  },
  {
    legacyUuid: '05b1c23e-9a4e-4d58-a577-31eb2a4e8f77',
    historicalLabel: 'Sentadilla Goblet con mancuerna',
    classification: 'ambiguous_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Ambiguo entre sentadilla copa con mancuerna estándar y variantes con caja/kettlebell; se preserva UUID histórico.',
  },
  {
    legacyUuid: '5fd12343-348c-4449-9072-7024a782f684',
    historicalLabel: 'Remo en máquina',
    classification: 'ambiguous_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Ambiguo entre 5 variantes de remo en máquina (T-bar, pecho apoyado, agarre estrecho/ancho); se preserva UUID histórico.',
  },
  {
    legacyUuid: 'f129818f-379e-46ee-a2d8-8f1a81506186',
    historicalLabel: 'Curl de bíceps en polea baja',
    classification: 'ambiguous_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Ambiguo entre 7 variantes de curl en polea baja (barra recta, cuerda, una mano, martillo); se preserva UUID histórico.',
  },
  {
    legacyUuid: '6b8ff589-80a2-4a2b-a214-2ee411955598',
    historicalLabel: 'Extensión de tríceps en polea con barra',
    classification: 'ambiguous_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Ambiguo entre barra recta, barra V y barra Z en polea; se preserva UUID histórico.',
  },
  // 7 Referencias ausentes en el catálogo actual (se preservan como custom/histórico intacto)
  {
    legacyUuid: '8275c556-7f7d-4eb6-b022-b4eeb71bf5e7',
    historicalLabel: 'Sentadilla a banco con mancuerna',
    classification: 'absent_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Sin equivalente exacto 1:1 en catálogo actual; se conserva registro histórico original intacto.',
  },
  {
    legacyUuid: 'b3de44fb-27c0-4a83-94aa-89ff39561084',
    historicalLabel: 'Plancha frontal',
    classification: 'absent_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Solo existen planchas con toque/rotación o peso; no se fuerza reasignación.',
  },
  {
    legacyUuid: '51bd86e2-66ea-410c-9f28-8e442f01bc40',
    historicalLabel: 'Plancha lateral',
    classification: 'absent_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Variantes disponibles son dinámicas (crunch lateral en plancha); se preserva UUID histórico.',
  },
  {
    legacyUuid: '42eb06cb-7be7-44e4-9195-5a7763bc19f6',
    historicalLabel: 'Abducción con banda',
    classification: 'absent_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Sin equivalente directo de abducción de cadera con banda en catálogo; se preserva UUID histórico.',
  },
  {
    legacyUuid: '60d822bf-a435-4810-9142-c62520e3f273',
    historicalLabel: 'Elevaciones laterales en polea',
    classification: 'absent_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'No existe elevación lateral unilateral/bilateral en polea exacta en los 669 base; se preserva UUID histórico.',
  },
  {
    legacyUuid: 'c93a5a8f-0e02-403e-b8c4-5d06ab8b7dc8',
    historicalLabel: 'Dead bug',
    classification: 'absent_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Ausente del catálogo actual; se preserva como registro histórico válido sin reasignación.',
  },
  {
    legacyUuid: '821e6ca2-00fd-4287-8b5b-dc9502ca9dc0',
    historicalLabel: 'Bird dog',
    classification: 'absent_preserve_original',
    mappedCurrentUuid: null,
    mappedCurrentName: null,
    note: 'Ausente del catálogo actual; se preserva como registro histórico válido sin reasignación.',
  },
];

