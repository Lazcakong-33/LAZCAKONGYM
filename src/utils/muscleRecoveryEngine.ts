import { CompletedWorkout, Routine } from '../types';
import { normalizar } from './csvImporter';
import {
  calculatePureRoutineVolume,
  normalizeText,
  StandardMuscleCategory,
} from './workoutAnalyticsEngine';

/**
 * =========================================================================================
 * MOTOR BIOMECÁNICO DE FATIGA Y RECUPERACIÓN MUSCULAR EN TIEMPO REAL (LAZCAKONG GYM)
 * =========================================================================================
 *
 * MODELO MATEMÁTICO DETERMINISTA Y FISIOLÓGICO:
 *
 * 1. SEPARACIÓN ESTRICTA:
 *    - La fatiga REAL del atleta proviene EXCLUSIVAMENTE de entrenamientos efectivamente
 *      completados (`CompletedWorkout[]`). Las rutinas programadas (`Routine[]`) solo se
 *      usan para previsualizaciones hipotéticas y NUNCA contaminan la fatiga real.
 *    - Si un atleta no tiene entrenamientos registrados para un músculo, su estado es 100%
 *      recuperado, 0 h restantes, 0% fatiga y color neutro (#71717A).
 *
 * 2. CÁLCULO DE CARGA Y ESTIMULO POR EJERCICIO:
 *    Para cada ejercicio completado con S series efectivas, R repeticiones promedio, peso W (kg)
 *    y volumen total de tonelaje V = (S * R * W):
 *
 *    a) Factor RPE (Rating of Perceived Exertion):
 *       - Si el atleta registró RPE real (6 <= RPE <= 10):
 *         F_rpe = 1 + (RPE - 8) * 0.12
 *         (RPE 6 -> 0.76, RPE 8 -> 1.00, RPE 9 -> 1.12, RPE 10 -> 1.24)
 *       - Si NO se registró RPE (o está vacío/indefinido):
 *         F_rpe = 1.00 (NEUTRO, sin inventar datos fisiológicos que no existan).
 *
 *    b) Ratio de Volumen Normalizado:
 *       Cada grupo muscular posee una capacidad fisiológica de tonelaje de referencia (C_ref).
 *       VolRatio = min(1.5, V / C_ref)
 *
 *    c) Fatiga Base Generada:
 *       Fatigue_raw = (S * 4.6 + VolRatio * 24) * F_rpe
 *
 * 3. DISTRIBUCIÓN PONDERADA CONFIGURABLE (PRIMARIOS vs SINERGISTAS/ESTABILIZADORES):
 *    - Músculos Primarios (Motores principales): 100% de la carga base (w = 1.0).
 *    - Músculos Sinergistas directos: 40% a 60% de la carga base (w = 0.40 - 0.60).
 *    - Músculos Estabilizadores/Secundarios: 20% a 35% de la carga base (w = 0.20 - 0.35).
 *    Fatigue_muscle = Fatigue_raw * w
 *
 * 4. TIEMPO DE RECUPERACIÓN CONTINUO DEPENDIENTE DE CARGA (SIN ASIGNACIÓN FIJA DE 24/48/72h):
 *    El tiempo total de recuperación requerido (T_rec) se calcula mediante una función continua
 *    y suave basada en la fatiga acumulada y la capacidad de recuperación del músculo (T_base):
 *
 *       T_rec = T_base * (Fatigue_muscle / 65)^0.75
 *       T_rec_acotado = max(8.0, min(84.0, T_rec))
 *
 *    Esto garantiza que el tiempo de recuperación es estrictamente continuo y dependiente de
 *    las series, repeticiones, peso y RPE real del atleta. Jamás se asigna un valor estático
 *    de 24h, 48h o 72h.
 *
 * 5. DECAIMIENTO METABÓLICO EN EL TIEMPO:
 *    Para un entrenamiento finalizado hace t_elapsed horas (calculado desde endTime o startTime):
 *       Si t_elapsed >= T_rec:
 *          Músculo completamente recuperado (Fatiga = 0%, Tiempo restante = 0h 0m).
 *       Si t_elapsed < T_rec:
 *          T_rem = T_rec - t_elapsed
 *          Fatiga_residual = Fatigue_muscle * (T_rem / T_rec)^1.25
 *          Horas restantes = floor(T_rem)
 *          Minutos restantes = round((T_rem - floor(T_rem)) * 60)
 *
 * 6. ACUMULACIÓN MULTI-SESIÓN:
 *    Si el atleta realiza múltiples sesiones en la ventana metabólica activa (hasta 120 horas),
 *    la fatiga residual de cada sesión se suma acumulativamente (hasta un tope de 100%) y el
 *    tiempo de recuperación restante refleja el máximo tiempo necesario para disipar todo el
 *    estímulo acumulado.
 * =========================================================================================
 */

export type BiometricMuscleId =
  | 'chest_left'
  | 'chest_right'
  | 'abs'
  | 'deltoid_front_left'
  | 'deltoid_front_right'
  | 'biceps_left'
  | 'biceps_right'
  | 'triceps_lateral_left'
  | 'triceps_lateral_right'
  | 'quad_left'
  | 'quad_right'
  | 'calves_front_left'
  | 'calves_front_right'
  | 'traps_lats'
  | 'triceps_back_left'
  | 'triceps_back_right'
  | 'glutes'
  | 'hamstrings_left'
  | 'hamstrings_right'
  | 'calves_back_left'
  | 'calves_back_right';

export type CanonicalMuscleId =
  | 'pectoral_major'
  | 'latissimus_dorsi'
  | 'quadriceps'
  | 'hamstrings'
  | 'glutes'
  | 'deltoids'
  | 'biceps'
  | 'triceps'
  | 'calves'
  | 'abs';

export interface ExerciseFatigueContribution {
  workoutId: string;
  workoutTitle: string;
  workoutDate: string;
  exerciseName: string;
  role: 'primary' | 'synergist' | 'stabilizer';
  contributionPct: number; // 0 a 100
  sets: number;
  reps: number;
  weightKg: number;
  volumeKg: number;
  rpe?: number;
  addedFatiguePct: number;
}

export interface MuscleRecoveryState {
  id: BiometricMuscleId;
  canonicalId: CanonicalMuscleId;
  name: string;
  group: 'front' | 'back';
  description: string;
  fatigue: number; // 0 to 100
  recoveryPercentage: number; // 0 to 100
  remainingHours: number;
  remainingMinutes: number;
  totalRecoveryHours: number;
  status:
    | 'Sin datos suficientes'
    | 'Recuperación suficiente'
    | 'Recuperación en progreso'
    | 'Fatiga moderada'
    | 'Fatiga alta'
    | 'Recuperado'
    | 'Recuperando'
    | 'Fatiga Moderada'
    | 'Fatiga Alta'
    | 'Fatiga Crítica';
  trainingReadiness: 'LISTO PARA ENTRENAR' | 'RECUPERACIÓN EN PROCESO' | 'DESCANSO RECOMENDADO';
  statusColor: string; // Gris (#71717A), Verde lima (#CCFF00), Amarillo (#FACC15), Naranja (#F97316), Rojo (#EF4444)
  badgeClass: string;
  volume: number; // Carga acumulada en kg (ventana activa o última sesión registrada)
  sets: number; // Series efectivas acumuladas (ventana activa o última sesión registrada)
  hasHistoricalData?: boolean;
  lastTrainedDate?: string;
  elapsedHours?: number;
  exercisesTriggered: ExerciseFatigueContribution[];
  secondaryMusclesInvolved: string[];
}

export interface RepetitiveStrainAlert {
  canonicalId: CanonicalMuscleId;
  muscleName: string;
  sessionCount: number;
  timeBetweenHours: number;
  lastSessionDate: string;
  currentFatigue: number;
  message: string;
  severity: 'warning' | 'critical';
}

export interface SuggestedTrainingSplit {
  splitName: string;
  targetMuscles: string[];
  canonicalIds: CanonicalMuscleId[];
  isRecommended: boolean;
  readinessScore: number; // 0-100% de los músculos listos
  reason: string;
}

export interface PeriodHistorySummary {
  period: 'hoy' | '7dias' | '30dias' | '90dias';
  periodLabel: string;
  totalWorkouts: number;
  totalVolumeKg: number;
  totalSetsCompleted: number;
  totalDurationMinutes: number;
  workouts: CompletedWorkout[];
  muscleLoadBreakdown: {
    canonicalId: CanonicalMuscleId;
    name: string;
    volumeKg: number;
    sets: number;
    exerciseCount: number;
    lastTrainedDate?: string;
  }[];
}

export interface CanonicalMuscleReadinessItem {
  canonicalId: CanonicalMuscleId;
  name: string;
  groupName: string;
  fatigue: number;
  remainingHours: number;
  remainingMinutes: number;
  readiness: 'LISTO PARA ENTRENAR' | 'RECUPERACIÓN EN PROCESO' | 'DESCANSO RECOMENDADO';
  statusColor: string;
  suggestedExercises: string[];
}

export interface OverallAthleteMuscularSummary {
  systemicFatigue: number; // 0 a 100
  overallRecoveryPct: number;
  totalMonitoredMuscles: number;
  recoveredCount: number;
  inRecoveryCount: number;
  highFatigueCount: number;
  overallStatusText: string;
  overallStatusTone: 'emerald' | 'amber' | 'rose' | 'cyan';
  // Tres listas clasificadas exactamente según los tres estados requeridos:
  readyMuscles: CanonicalMuscleReadinessItem[];
  inRecoveryMuscles: CanonicalMuscleReadinessItem[];
  highFatigueMuscles: CanonicalMuscleReadinessItem[];
  // Compatibilidad con vistas previas
  nextAvailableMuscles: CanonicalMuscleReadinessItem[];
  musclesToAvoid: CanonicalMuscleReadinessItem[];
  // Alertas de sobrecarga / entrenamiento consecutivo sin suficiente descanso
  repetitiveStrainAlerts: RepetitiveStrainAlert[];
  // Recomendaciones inteligentes de sesiones / splits de entrenamiento
  suggestedSessionSplits: SuggestedTrainingSplit[];
  earliestNextFullRecoveryHours?: number;
}

/**
 * Parámetros fisiológicos base por músculo:
 * - baseRecoveryHours: Tiempo de referencia para una sesión completa e intensa (~65-70% fatiga)
 * - referenceTonnageKg: Capacidad de tonelaje de referencia que genera fatiga moderada
 */
export const MUSCLE_CONFIG: Record<
  BiometricMuscleId,
  {
    name: string;
    group: 'front' | 'back';
    description: string;
    baseRecoveryHours: number;
    referenceTonnageKg: number;
    isMajor: boolean;
    canonicalId: CanonicalMuscleId;
    standardCategory: StandardMuscleCategory;
  }
> = {
  chest_left: {
    name: 'Pectoral Mayor Izquierdo',
    group: 'front',
    description: 'Pectoral mayor y menor. Involucrado en empujes horizontales, flexión y aducción horizontal.',
    baseRecoveryHours: 48,
    referenceTonnageKg: 3200,
    isMajor: true,
    canonicalId: 'pectoral_major',
    standardCategory: 'Pectoral',
  },
  chest_right: {
    name: 'Pectoral Mayor Derecho',
    group: 'front',
    description: 'Pectoral mayor y menor. Involucrado en empujes horizontales, flexión y aducción horizontal.',
    baseRecoveryHours: 48,
    referenceTonnageKg: 3200,
    isMajor: true,
    canonicalId: 'pectoral_major',
    standardCategory: 'Pectoral',
  },
  traps_lats: {
    name: 'Dorsal Ancho & Trapecios',
    group: 'back',
    description: 'Dorsal ancho, romboides, trapecio medio e inferior. Tracciones verticales y horizontales.',
    baseRecoveryHours: 48,
    referenceTonnageKg: 4200,
    isMajor: true,
    canonicalId: 'latissimus_dorsi',
    standardCategory: 'Dorsal',
  },
  quad_left: {
    name: 'Cuádriceps Izquierdo',
    group: 'front',
    description: 'Vasto lateral, medial, recto femoral e intermedio. Extensión de rodilla y estabilización.',
    baseRecoveryHours: 52,
    referenceTonnageKg: 5500,
    isMajor: true,
    canonicalId: 'quadriceps',
    standardCategory: 'Cuádriceps',
  },
  quad_right: {
    name: 'Cuádriceps Derecho',
    group: 'front',
    description: 'Vasto lateral, medial, recto femoral e intermedio. Extensión de rodilla y estabilización.',
    baseRecoveryHours: 52,
    referenceTonnageKg: 5500,
    isMajor: true,
    canonicalId: 'quadriceps',
    standardCategory: 'Cuádriceps',
  },
  hamstrings_left: {
    name: 'Isquiosurales / Femorales Izq.',
    group: 'back',
    description: 'Bíceps femoral, semitendinoso y semimembranoso. Flexión de rodilla y extensión de cadera.',
    baseRecoveryHours: 48,
    referenceTonnageKg: 4000,
    isMajor: true,
    canonicalId: 'hamstrings',
    standardCategory: 'Isquiosurales',
  },
  hamstrings_right: {
    name: 'Isquiosurales / Femorales Der.',
    group: 'back',
    description: 'Bíceps femoral, semitendinoso y semimembranoso. Flexión de rodilla y extensión de cadera.',
    baseRecoveryHours: 48,
    referenceTonnageKg: 4000,
    isMajor: true,
    canonicalId: 'hamstrings',
    standardCategory: 'Isquiosurales',
  },
  glutes: {
    name: 'Glúteos (Mayor & Medio)',
    group: 'back',
    description: 'Glúteo mayor, medio y menor. Extensión, abducción y rotación externa de cadera.',
    baseRecoveryHours: 48,
    referenceTonnageKg: 4800,
    isMajor: true,
    canonicalId: 'glutes',
    standardCategory: 'Glúteos',
  },
  deltoid_front_left: {
    name: 'Deltoides Anterior / Lateral Izq.',
    group: 'front',
    description: 'Haces anterior y lateral del hombro. Empujes verticales y abducción del brazo.',
    baseRecoveryHours: 36,
    referenceTonnageKg: 2200,
    isMajor: false,
    canonicalId: 'deltoids',
    standardCategory: 'Hombros',
  },
  deltoid_front_right: {
    name: 'Deltoides Anterior / Lateral Der.',
    group: 'front',
    description: 'Haces anterior y lateral del hombro. Empujes verticales y abducción del brazo.',
    baseRecoveryHours: 36,
    referenceTonnageKg: 2200,
    isMajor: false,
    canonicalId: 'deltoids',
    standardCategory: 'Hombros',
  },
  biceps_left: {
    name: 'Bíceps Braquial Izquierdo',
    group: 'front',
    description: 'Cabeza corta y larga del bíceps, braquial anterior. Flexión y supinación de codo.',
    baseRecoveryHours: 36,
    referenceTonnageKg: 1400,
    isMajor: false,
    canonicalId: 'biceps',
    standardCategory: 'Bíceps',
  },
  biceps_right: {
    name: 'Bíceps Braquial Derecho',
    group: 'front',
    description: 'Cabeza corta y larga del bíceps, braquial anterior. Flexión y supinación de codo.',
    baseRecoveryHours: 36,
    referenceTonnageKg: 1400,
    isMajor: false,
    canonicalId: 'biceps',
    standardCategory: 'Bíceps',
  },
  triceps_lateral_left: {
    name: 'Tríceps Lateral Izquierdo',
    group: 'front',
    description: 'Cabeza lateral del tríceps braquial. Extensión terminal de codo en empujes.',
    baseRecoveryHours: 36,
    referenceTonnageKg: 1800,
    isMajor: false,
    canonicalId: 'triceps',
    standardCategory: 'Tríceps',
  },
  triceps_lateral_right: {
    name: 'Tríceps Lateral Derecho',
    group: 'front',
    description: 'Cabeza lateral del tríceps braquial. Extensión terminal de codo en empujes.',
    baseRecoveryHours: 36,
    referenceTonnageKg: 1800,
    isMajor: false,
    canonicalId: 'triceps',
    standardCategory: 'Tríceps',
  },
  triceps_back_left: {
    name: 'Tríceps Cabeza Larga / Medial Izq.',
    group: 'back',
    description: 'Cabezas medial y larga del tríceps. Extensión y estabilidad del hombro posterior.',
    baseRecoveryHours: 36,
    referenceTonnageKg: 1800,
    isMajor: false,
    canonicalId: 'triceps',
    standardCategory: 'Tríceps',
  },
  triceps_back_right: {
    name: 'Tríceps Cabeza Larga / Medial Der.',
    group: 'back',
    description: 'Cabezas medial y larga del tríceps. Extensión y estabilidad del hombro posterior.',
    baseRecoveryHours: 36,
    referenceTonnageKg: 1800,
    isMajor: false,
    canonicalId: 'triceps',
    standardCategory: 'Tríceps',
  },
  calves_front_left: {
    name: 'Tibial Anterior / Gemelo Izq.',
    group: 'front',
    description: 'Músculos anterolaterales de la pierna y gastrocnemio.',
    baseRecoveryHours: 32,
    referenceTonnageKg: 2400,
    isMajor: false,
    canonicalId: 'calves',
    standardCategory: 'Gemelos',
  },
  calves_front_right: {
    name: 'Tibial Anterior / Gemelo Der.',
    group: 'front',
    description: 'Músculos anterolaterales de la pierna y gastrocnemio.',
    baseRecoveryHours: 32,
    referenceTonnageKg: 2400,
    isMajor: false,
    canonicalId: 'calves',
    standardCategory: 'Gemelos',
  },
  calves_back_left: {
    name: 'Gemelo Posterior / Sóleo Izq.',
    group: 'back',
    description: 'Gastrocnemio medial, lateral y sóleo. Flexión plantar de tobillo.',
    baseRecoveryHours: 32,
    referenceTonnageKg: 2800,
    isMajor: false,
    canonicalId: 'calves',
    standardCategory: 'Gemelos',
  },
  calves_back_right: {
    name: 'Gemelo Posterior / Sóleo Der.',
    group: 'back',
    description: 'Gastrocnemio medial, lateral y sóleo. Flexión plantar de tobillo.',
    baseRecoveryHours: 32,
    referenceTonnageKg: 2800,
    isMajor: false,
    canonicalId: 'calves',
    standardCategory: 'Gemelos',
  },
  abs: {
    name: 'Abdomen & Core',
    group: 'front',
    description: 'Recto abdominal, oblicuos y transverso. Estabilización espinal y flexión de tronco.',
    baseRecoveryHours: 32,
    referenceTonnageKg: 1600,
    isMajor: false,
    canonicalId: 'abs',
    standardCategory: 'Core',
  },
};

/**
 * Tabla biomecánica configurable de ponderaciones por ejercicio:
 * Distribuye la carga entre músculos primarios (100%) y sinergistas/estabilizadores (20%-60%).
 */
export interface MuscleImpactMapping {
  primary: BiometricMuscleId[];
  synergists: { id: BiometricMuscleId; weight: number }[];
  secondaryNames: string[];
}

export function resolveExerciseMuscleImpact(
  exerciseName: string,
  rawMuscleGroup: string = ''
): MuscleImpactMapping {
  const ex = normalizar(exerciseName || '');
  const m = normalizar(rawMuscleGroup || '');

  // 0. FONDOS ENFOCADOS EN TRÍCEPS
  if (/fondos.*tricep|tricep.*fondos|bench dip|fondos en banco/.test(ex)) {
    return {
      primary: [
        'triceps_lateral_left',
        'triceps_lateral_right',
        'triceps_back_left',
        'triceps_back_right',
      ],
      synergists: [
        { id: 'chest_left', weight: 0.35 },
        { id: 'chest_right', weight: 0.35 },
        { id: 'deltoid_front_left', weight: 0.3 },
        { id: 'deltoid_front_right', weight: 0.3 },
      ],
      secondaryNames: ['Pectoral Mayor (Sinergista)', 'Deltoides Anterior'],
    };
  }

  // 1. EMPUJES HORIZONTALES (Pectoral Mayor + Tríceps + Deltoides Anterior)
  if (
    /press de banca|press banca|bench press|press plano|press inclinado|press declinado|pecho|aperturas|flyes|chest press|fondos/.test(
      ex
    ) ||
    /pecho|pectoral|chest/.test(m)
  ) {
    return {
      primary: ['chest_left', 'chest_right'],
      synergists: [
        { id: 'triceps_lateral_left', weight: 0.5 },
        { id: 'triceps_lateral_right', weight: 0.5 },
        { id: 'triceps_back_left', weight: 0.4 },
        { id: 'triceps_back_right', weight: 0.4 },
        { id: 'deltoid_front_left', weight: 0.45 },
        { id: 'deltoid_front_right', weight: 0.45 },
      ],
      secondaryNames: ['Tríceps (Sinergista)', 'Deltoides Anterior (Sinergista)'],
    };
  }

  // 2. TRACCIONES / ESPALDA (Dorsal Ancho + Trapecio + Bíceps + Core)
  if (
    /dominada|pull up|chin up|jalon|lat pulldown|remo|row|pullover|espalda|dorsal/.test(ex) ||
    /espalda|dorsal|lat/.test(m)
  ) {
    return {
      primary: ['traps_lats'],
      synergists: [
        { id: 'biceps_left', weight: 0.55 },
        { id: 'biceps_right', weight: 0.55 },
        { id: 'abs', weight: 0.25 },
      ],
      secondaryNames: ['Bíceps (Sinergista)', 'Core (Estabilizador)'],
    };
  }

  // 3. PIERNA: CUÁDRICEPS DOMINANTE (Sentadilla, Prensa, Hack, Zancada, Extensiones)
  if (
    /sentadilla|squat|prensa|leg press|hack|extension de cuadriceps|extens|zancada|lunge|sissy|bulgara/.test(
      ex
    ) ||
    /cuadricep|quad/.test(m)
  ) {
    const isExtension = /extension/.test(ex);
    return {
      primary: ['quad_left', 'quad_right'],
      synergists: isExtension
        ? []
        : [
            { id: 'glutes', weight: 0.45 },
            { id: 'hamstrings_left', weight: 0.3 },
            { id: 'hamstrings_right', weight: 0.3 },
            { id: 'calves_back_left', weight: 0.2 },
            { id: 'calves_back_right', weight: 0.2 },
          ],
      secondaryNames: isExtension ? [] : ['Glúteos (Sinergista)', 'Isquiosurales', 'Gemelos'],
    };
  }

  // 4. PIERNA: ISQUIOSURALES & CADERA (Peso Muerto, RDL, Stiff, Curl Femoral)
  if (
    /peso muerto|deadlift|rdl|stiff|curl femoral|leg curl|nordic|buenos dias/.test(ex) ||
    /isquio|femoral/.test(m)
  ) {
    return {
      primary: ['hamstrings_left', 'hamstrings_right'],
      synergists: [
        { id: 'glutes', weight: 0.6 },
        { id: 'traps_lats', weight: 0.35 },
        { id: 'abs', weight: 0.3 },
      ],
      secondaryNames: ['Glúteos (Sinergista)', 'Espalda Baja / Dorsal', 'Core'],
    };
  }

  // 5. GLÚTEOS AISLADOS (Hip Thrust, Patada polea, Abductores)
  if (
    /hip thrust|glute bridge|patada de gluteo|patada en polea|abductor|gluteo/.test(ex) ||
    /gluteo|glute/.test(m)
  ) {
    return {
      primary: ['glutes'],
      synergists: [
        { id: 'hamstrings_left', weight: 0.35 },
        { id: 'hamstrings_right', weight: 0.35 },
        { id: 'quad_left', weight: 0.2 },
        { id: 'quad_right', weight: 0.2 },
      ],
      secondaryNames: ['Isquiosurales (Sinergista)'],
    };
  }

  // 6. HOMBROS (Press Militar, Elevaciones laterales, pájaros, face pull)
  if (
    /press militar|overhead press|militar|elevacion lateral|elevaciones laterales|deltoid|hombro|face pull|pajaros/.test(
      ex
    ) ||
    /hombro|deltoide/.test(m)
  ) {
    const isOverhead = /press|militar|overhead/.test(ex);
    return {
      primary: ['deltoid_front_left', 'deltoid_front_right'],
      synergists: isOverhead
        ? [
            { id: 'triceps_lateral_left', weight: 0.4 },
            { id: 'triceps_lateral_right', weight: 0.4 },
            { id: 'traps_lats', weight: 0.3 },
          ]
        : [{ id: 'traps_lats', weight: 0.25 }],
      secondaryNames: isOverhead ? ['Tríceps (Sinergista)', 'Trapecios'] : ['Trapecios'],
    };
  }

  // 7. BÍCEPS AISLADO
  if (/curl|bicep|martillo|predicador|spider/.test(ex) || /bicep/.test(m)) {
    return {
      primary: ['biceps_left', 'biceps_right'],
      synergists: [],
      secondaryNames: ['Braquial y Antebrazo'],
    };
  }

  // 8. TRÍCEPS AISLADO
  if (
    /press frances|copa|extension de tricep|extensiones de tricep|pushdown|jalon polea tricep|patada tricep/.test(
      ex
    ) ||
    /tricep/.test(m)
  ) {
    return {
      primary: [
        'triceps_lateral_left',
        'triceps_lateral_right',
        'triceps_back_left',
        'triceps_back_right',
      ],
      synergists: [],
      secondaryNames: [],
    };
  }

  // 9. GEMELOS & PANTORRILLAS
  if (/gemelo|pantorrilla|soleo|calf/.test(ex) || /gemelo|pantorrilla|calf/.test(m)) {
    return {
      primary: [
        'calves_back_left',
        'calves_back_right',
        'calves_front_left',
        'calves_front_right',
      ],
      synergists: [],
      secondaryNames: [],
    };
  }

  // 10. ABDOMEN / CORE
  if (
    /crunch|elevacion de piernas|plancha|plank|rueda abdominal|abdomen|core|abs/.test(ex) ||
    /core|abdomen|abs/.test(m)
  ) {
    return {
      primary: ['abs'],
      synergists: [],
      secondaryNames: [],
    };
  }

  // 11. FALLBACK POR GRUPO MUSCULAR GENÉRICO
  if (/pierna|leg/.test(m)) {
    return {
      primary: ['quad_left', 'quad_right'],
      synergists: [
        { id: 'glutes', weight: 0.45 },
        { id: 'hamstrings_left', weight: 0.35 },
        { id: 'hamstrings_right', weight: 0.35 },
      ],
      secondaryNames: ['Glúteos', 'Isquiosurales'],
    };
  }

  if (/brazo|arm|antebrazo/.test(m)) {
    return {
      primary: ['biceps_left', 'biceps_right'],
      synergists: [
        { id: 'triceps_lateral_left', weight: 0.5 },
        { id: 'triceps_lateral_right', weight: 0.5 },
      ],
      secondaryNames: ['Tríceps Braquial'],
    };
  }

  // Fallback seguro
  return {
    primary: ['chest_left', 'chest_right'],
    synergists: [],
    secondaryNames: [],
  };
}

/**
 * Función visual de 5 estados y colores oficiales coherentes con tiempo restante y fatiga:
 * - Gris (#71717A): Sin datos suficientes (músculo sin registros en el historial)
 * - Verde lima (#CCFF00): Recuperación suficiente (< 6 h restantes y < 25% fatiga residual)
 * - Amarillo (#FACC15): Recuperación en progreso (6 – 24 h restantes o 25% – 49% fatiga)
 * - Naranja (#F97316): Fatiga moderada (24 – 36 h restantes o 50% – 74% fatiga)
 * - Rojo (#EF4444): Fatiga alta (> 36 h restantes o >= 75% fatiga)
 */
export function getFatigueColorAndStatus(
  fatiguePct: number,
  hasHistoricalData: boolean = false,
  remainingHours: number = 0
): {
  status: MuscleRecoveryState['status'];
  trainingReadiness: MuscleRecoveryState['trainingReadiness'];
  statusColor: string;
  badgeClass: string;
} {
  if (fatiguePct <= 0 && remainingHours <= 0 && !hasHistoricalData) {
    return {
      status: 'Sin datos suficientes',
      trainingReadiness: 'LISTO PARA ENTRENAR',
      statusColor: '#71717A',
      badgeClass: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    };
  }
  if (remainingHours > 36 || fatiguePct >= 75) {
    return {
      status: 'Fatiga alta',
      trainingReadiness: 'DESCANSO RECOMENDADO',
      statusColor: '#EF4444',
      badgeClass: 'bg-red-500/20 text-red-400 border-red-500/40',
    };
  }
  if (remainingHours >= 24 || fatiguePct >= 50) {
    return {
      status: 'Fatiga moderada',
      trainingReadiness: 'DESCANSO RECOMENDADO',
      statusColor: '#F97316',
      badgeClass: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
    };
  }
  if (remainingHours >= 6 || fatiguePct >= 25) {
    return {
      status: 'Recuperación en progreso',
      trainingReadiness: 'RECUPERACIÓN EN PROCESO',
      statusColor: '#FACC15',
      badgeClass: 'bg-amber-400/20 text-amber-300 border-amber-400/40',
    };
  }
  return {
    status: 'Recuperación suficiente',
    trainingReadiness: 'LISTO PARA ENTRENAR',
    statusColor: '#CCFF00',
    badgeClass: 'bg-[#CCFF00]/15 text-[#CCFF00] border-[#CCFF00]/40',
  };
}

/**
 * Deduplica entrenamientos garantizando:
 * 1. Jamás descartar sesiones distintas realizadas el mismo día.
 * 2. Evitar sumar dos veces un mismo entrenamiento clonado.
 */
export function sanitizeWorkoutsHistory(workouts: CompletedWorkout[]): CompletedWorkout[] {
  if (!Array.isArray(workouts) || workouts.length === 0) return [];

  const seenKeys = new Set<string>();
  const sanitized: CompletedWorkout[] = [];

  // Ordenar desde el más reciente al más antiguo
  const sorted = [...workouts].sort((a, b) => {
    const timeA = a.endTime || a.startTime || new Date(a.date).getTime() || 0;
    const timeB = b.endTime || b.startTime || new Date(b.date).getTime() || 0;
    return timeB - timeA;
  });

  for (const w of sorted) {
    if (!w || !w.date) continue;

    const baseId = w.id || '';
    const rawTime = w.startTime || w.endTime || new Date(w.date).getTime();
    const vol = Math.round(w.totalVolumeKg || 0);
    const sets = w.completedSetsCount || (w.exercisesSummary || []).length;
    const compositeKey = baseId
      ? `id:${baseId}`
      : `${w.date.slice(0, 10)}_${rawTime}_${vol}_${sets}`;

    if (seenKeys.has(compositeKey)) {
      continue;
    }
    seenKeys.add(compositeKey);
    sanitized.push(w);
  }

  return sanitized;
}

/**
 * MOTOR BIOMECÁNICO CENTRAL:
 * Calcula la fatiga real acumulada y el tiempo exacto de recuperación en tiempo real (horas y minutos).
 */
export function computeRealTimeRecovery(
  completedWorkouts: CompletedWorkout[] = [],
  currentTime: number = Date.now(),
  routines: Routine[] = [],
  dayFilter: string = 'ALL',
  timePeriodFilter: 'hoy' | '7dias' | '30dias' | '90dias' | 'ALL' = 'ALL'
): Record<BiometricMuscleId, MuscleRecoveryState> {
  const result: Record<BiometricMuscleId, MuscleRecoveryState> = {} as any;
  const normDay = normalizeText(dayFilter);
  const isSingleDayMode =
    Boolean(normDay) &&
    normDay !== 'all' &&
    normDay !== 'todos' &&
    normDay !== 'toda la semana' &&
    normDay !== 'weekly' &&
    normDay !== 'semanal';

  // 1. Inicializar todas las regiones anatómicas en estado inicial (Sin datos suficientes)
  (Object.keys(MUSCLE_CONFIG) as BiometricMuscleId[]).forEach((id) => {
    const config = MUSCLE_CONFIG[id];
    result[id] = {
      id,
      canonicalId: config.canonicalId,
      name: config.name,
      group: config.group,
      description: config.description,
      fatigue: 0,
      recoveryPercentage: 100,
      remainingHours: 0,
      remainingMinutes: 0,
      totalRecoveryHours: config.baseRecoveryHours,
      status: 'Sin datos suficientes',
      trainingReadiness: 'LISTO PARA ENTRENAR',
      statusColor: '#71717A',
      badgeClass: 'bg-zinc-800 text-zinc-300 border-zinc-700',
      volume: 0,
      sets: 0,
      hasHistoricalData: false,
      exercisesTriggered: [],
      secondaryMusclesInvolved: [],
    };
  });

  // =========================================================================
  // MODO PREVISUALIZACIÓN DE RUTINA PROGRAMADA (Día Individual)
  // =========================================================================
  if (isSingleDayMode) {
    const pureVolumeReport = calculatePureRoutineVolume(routines, dayFilter, completedWorkouts);

    (Object.keys(MUSCLE_CONFIG) as BiometricMuscleId[]).forEach((id) => {
      const config = MUSCLE_CONFIG[id];
      const pureMetric = pureVolumeReport.byMuscle[config.standardCategory];
      const plannedSets = pureMetric?.sets || 0;
      const plannedVol = pureMetric?.estimatedVolumeKg || 0;
      const plannedFatigue = pureMetric?.fatiguePercentage || 0;

      const estRecoveryHours =
        plannedFatigue > 0
          ? Number((config.baseRecoveryHours * Math.pow(plannedFatigue / 65, 0.75)).toFixed(2))
          : 0;

      const boundedHours = Math.max(0, Math.min(84, estRecoveryHours));
      const style = getFatigueColorAndStatus(plannedFatigue, plannedSets > 0, boundedHours);
      const h = Math.floor(boundedHours);
      const m = Math.round((boundedHours - h) * 60);

      result[id] = {
        ...result[id],
        fatigue: plannedFatigue,
        recoveryPercentage: Math.max(0, 100 - plannedFatigue),
        remainingHours: h,
        remainingMinutes: m,
        totalRecoveryHours: Math.round(boundedHours),
        status: style.status,
        trainingReadiness: style.trainingReadiness,
        statusColor: style.statusColor,
        badgeClass: style.badgeClass,
        volume: plannedVol,
        sets: plannedSets,
        hasHistoricalData: plannedSets > 0,
        secondaryMusclesInvolved: [],
      };
    });

    return result;
  }

  // =========================================================================
  // MODO RECUPERACIÓN REAL EN TIEMPO REAL (Historial Efectivamente Completado)
  // =========================================================================
  const sanitizedHistory = sanitizeWorkoutsHistory(completedWorkouts);
  if (sanitizedHistory.length === 0) {
    return result;
  }

  // Filtrado temporal si se solicita período específico ('hoy', '7dias', '30dias', '90dias')
  const periodFilteredHistory = sanitizedHistory.filter((workout) => {
    if (!timePeriodFilter || timePeriodFilter === 'ALL') return true;
    const workoutTime =
      workout.endTime || workout.startTime || new Date(workout.date).getTime() || currentTime;
    const elapsedMs = Math.max(0, currentTime - workoutTime);
    const elapsedH = elapsedMs / (1000 * 60 * 60);

    if (timePeriodFilter === 'hoy') return elapsedH <= 24;
    if (timePeriodFilter === '7dias') return elapsedH <= 7 * 24;
    if (timePeriodFilter === '30dias') return elapsedH <= 30 * 24;
    if (timePeriodFilter === '90dias') return elapsedH <= 90 * 24;
    return true;
  });

  if (periodFilteredHistory.length === 0) {
    return result;
  }

  // Estructuras de acumulación multi-sesión + seguimiento histórico real
  const muscleLoadMap: Record<
    BiometricMuscleId,
    {
      activeResidualFatigueSum: number;
      effectiveMaxRemainingHours: number;
      calculatedRecoveryHoursForDominantStimulus: number;
      cumulativeSets: number;
      cumulativeVolumeKg: number;
      lastWorkoutTimestamp: number;
      lastWorkoutDateStr: string;
      hasHistoricalData: boolean;
      triggers: ExerciseFatigueContribution[];
      secondariesSet: Set<string>;
    }
  > = {} as any;

  (Object.keys(MUSCLE_CONFIG) as BiometricMuscleId[]).forEach((id) => {
    muscleLoadMap[id] = {
      activeResidualFatigueSum: 0,
      effectiveMaxRemainingHours: 0,
      calculatedRecoveryHoursForDominantStimulus: MUSCLE_CONFIG[id].baseRecoveryHours,
      cumulativeSets: 0,
      cumulativeVolumeKg: 0,
      lastWorkoutTimestamp: 0,
      lastWorkoutDateStr: '',
      hasHistoricalData: false,
      triggers: [],
      secondariesSet: new Set<string>(),
    };
  });

  // Procesar cada entrenamiento completado
  periodFilteredHistory.forEach((workout) => {
    const workoutTime =
      workout.endTime || workout.startTime || new Date(workout.date).getTime() || currentTime;
    const elapsedMs = Math.max(0, currentTime - workoutTime);
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    const summaries = Array.isArray(workout.exercisesSummary) ? workout.exercisesSummary : [];

    summaries.forEach((ex) => {
      if (!ex || !ex.name) return;

      const impact = resolveExerciseMuscleImpact(ex.name, ex.muscleGroup);
      const setsCount = Math.max(1, Number(ex.sets) || 1);
      const repsCount = Math.max(1, Number(ex.maxReps) || 10);
      const weightKg = Number(ex.maxWeight) || 0;
      const recordedVolumeKg =
        typeof ex.volumeKg === 'number' && (ex.volumeKg > 0 || weightKg === 0)
          ? Math.max(0, Number(ex.volumeKg))
          : setsCount * repsCount * Math.max(0, weightKg);
      const fatigueTonnageKg = recordedVolumeKg > 0 ? recordedVolumeKg : setsCount * repsCount * 40;

      // RPE REAL: NO inventar RPE. Si no existe registro de RPE, se usa factor 1.0 (neutro).
      let rpeMultiplier = 1.0;
      let recordedRpe: number | undefined = undefined;

      if (typeof ex.rpe === 'number' && ex.rpe >= 6 && ex.rpe <= 10) {
        recordedRpe = ex.rpe;
        rpeMultiplier = 1 + (ex.rpe - 8) * 0.12;
      } else if (typeof workout.avgRpe === 'number' && workout.avgRpe >= 6 && workout.avgRpe <= 10) {
        recordedRpe = workout.avgRpe;
        rpeMultiplier = 1 + (workout.avgRpe - 8) * 0.12;
      }

      // Estímulo en Músculos Primarios (Ponderación 1.0 = 100%)
      impact.primary.forEach((pId) => {
        applyStimulusToMuscle(
          pId,
          1.0,
          setsCount,
          repsCount,
          weightKg,
          recordedVolumeKg,
          fatigueTonnageKg,
          recordedRpe,
          rpeMultiplier,
          elapsedHours,
          workout,
          ex.name,
          'primary',
          workoutTime,
          impact.secondaryNames
        );
      });

      // Estímulo en Músculos Secundarios/Sinergistas (Ponderación configurable 0.20 a 0.60)
      impact.synergists.forEach((syn) => {
        applyStimulusToMuscle(
          syn.id,
          syn.weight,
          Math.max(1, Math.round(setsCount * syn.weight)),
          repsCount,
          weightKg,
          Math.round(recordedVolumeKg * syn.weight),
          Math.round(fatigueTonnageKg * syn.weight),
          recordedRpe,
          rpeMultiplier,
          elapsedHours,
          workout,
          ex.name,
          'synergist',
          workoutTime,
          [MUSCLE_CONFIG[impact.primary[0]]?.name || 'Músculo Principal']
        );
      });
    });
  });

  function applyStimulusToMuscle(
    muscleId: BiometricMuscleId,
    weightFraction: number,
    sets: number,
    reps: number,
    weightKg: number,
    recordedVolumeKg: number,
    fatigueTonnageKg: number,
    recordedRpe: number | undefined,
    rpeMultiplier: number,
    elapsedHours: number,
    workout: CompletedWorkout,
    exerciseName: string,
    role: 'primary' | 'synergist',
    workoutTime: number,
    secondaryNames: string[]
  ) {
    const target = muscleLoadMap[muscleId];
    if (!target) return;

    target.hasHistoricalData = true;
    const isLatestWorkout =
      target.lastWorkoutTimestamp === 0 ||
      Math.abs(workoutTime - target.lastWorkoutTimestamp) < 1000 * 60 * 60 * 6;

    if (workoutTime > target.lastWorkoutTimestamp) {
      target.lastWorkoutTimestamp = workoutTime;
      target.lastWorkoutDateStr = workout.date;
    }

    const config = MUSCLE_CONFIG[muscleId];
    const volRatio = Math.min(1.5, fatigueTonnageKg / (config.referenceTonnageKg || 3000));
    const rawFatigue = (sets * 4.6 + volRatio * 24) * rpeMultiplier;
    const muscleFatigueUnits = Math.min(65, rawFatigue * weightFraction);

    const calculatedRecoveryHours = Number(
      (
        config.baseRecoveryHours *
        Math.pow(Math.max(0.1, muscleFatigueUnits) / 65, 0.75)
      ).toFixed(2)
    );

    const boundedRecoveryHours = Math.max(8.0, Math.min(84.0, calculatedRecoveryHours));
    const remainingForThisWorkout =
      elapsedHours <= 120 ? Math.max(0, boundedRecoveryHours - elapsedHours) : 0;

    if (remainingForThisWorkout > 0) {
      const decayRatio = remainingForThisWorkout / boundedRecoveryHours;
      const activeResidual = muscleFatigueUnits * Math.pow(decayRatio, 1.25);

      target.activeResidualFatigueSum += activeResidual;
      target.effectiveMaxRemainingHours = Math.max(
        target.effectiveMaxRemainingHours,
        remainingForThisWorkout
      );
      target.calculatedRecoveryHoursForDominantStimulus = Math.max(
        target.calculatedRecoveryHoursForDominantStimulus,
        boundedRecoveryHours
      );

      target.triggers.push({
        workoutId: workout.id,
        workoutTitle: workout.routineTitle || 'Entrenamiento',
        workoutDate: workout.date,
        exerciseName,
        role,
        contributionPct: Math.round(weightFraction * 100),
        sets,
        reps,
        weightKg,
        volumeKg: recordedVolumeKg,
        rpe: recordedRpe,
        addedFatiguePct: Math.round(activeResidual),
      });
    } else if (isLatestWorkout && target.triggers.length < 6) {
      // Conservar registro de los ejercicios de la última sesión aunque ya esté 100% recuperado
      target.triggers.push({
        workoutId: workout.id,
        workoutTitle: workout.routineTitle || 'Entrenamiento',
        workoutDate: workout.date,
        exerciseName,
        role,
        contributionPct: Math.round(weightFraction * 100),
        sets,
        reps,
        weightKg,
        volumeKg: recordedVolumeKg,
        rpe: recordedRpe,
        addedFatiguePct: 0,
      });
    }

    if (elapsedHours <= 168 || isLatestWorkout) {
      target.cumulativeSets += sets;
      target.cumulativeVolumeKg += recordedVolumeKg;
    }
    secondaryNames.forEach((name) => target.secondariesSet.add(name));
  }

  // 5. Ensamblar estado final por cada músculo
  (Object.keys(MUSCLE_CONFIG) as BiometricMuscleId[]).forEach((id) => {
    const config = MUSCLE_CONFIG[id];
    const data = muscleLoadMap[id];

    const finalFatigue = Math.min(100, Math.max(0, Math.round(data.activeResidualFatigueSum)));
    const isFullyRecovered = finalFatigue <= 0 || data.effectiveMaxRemainingHours <= 0.05;

    const remainingContinuous = isFullyRecovered
      ? 0
      : Number(data.effectiveMaxRemainingHours.toFixed(2));
    const hoursPart = Math.floor(remainingContinuous);
    const minutesPart = Math.round((remainingContinuous - hoursPart) * 60);

    const recoveryPct = isFullyRecovered
      ? 100
      : Math.max(0, Math.min(99, 100 - finalFatigue));

    const visual = getFatigueColorAndStatus(
      isFullyRecovered ? 0 : finalFatigue,
      data.hasHistoricalData,
      remainingContinuous
    );
    const elapsedH =
      data.lastWorkoutTimestamp > 0
        ? Number(((currentTime - data.lastWorkoutTimestamp) / (1000 * 60 * 60)).toFixed(1))
        : undefined;

    result[id] = {
      id,
      canonicalId: config.canonicalId,
      name: config.name,
      group: config.group,
      description: config.description,
      fatigue: isFullyRecovered ? 0 : finalFatigue,
      recoveryPercentage: recoveryPct,
      remainingHours: hoursPart,
      remainingMinutes: minutesPart,
      totalRecoveryHours: Math.round(data.calculatedRecoveryHoursForDominantStimulus),
      status: visual.status,
      trainingReadiness: visual.trainingReadiness,
      statusColor: visual.statusColor,
      badgeClass: visual.badgeClass,
      volume: data.cumulativeVolumeKg,
      sets: data.cumulativeSets,
      hasHistoricalData: data.hasHistoricalData,
      lastTrainedDate: data.lastWorkoutDateStr || undefined,
      elapsedHours: elapsedH,
      exercisesTriggered: data.triggers,
      secondaryMusclesInvolved: Array.from(data.secondariesSet),
    };
  });

  // 6. Sincronización bilateral anatómica simétrica
  const bilateralPairs: [BiometricMuscleId, BiometricMuscleId][] = [
    ['chest_left', 'chest_right'],
    ['deltoid_front_left', 'deltoid_front_right'],
    ['biceps_left', 'biceps_right'],
    ['triceps_lateral_left', 'triceps_lateral_right'],
    ['triceps_back_left', 'triceps_back_right'],
    ['quad_left', 'quad_right'],
    ['hamstrings_left', 'hamstrings_right'],
    ['calves_front_left', 'calves_front_right'],
    ['calves_back_left', 'calves_back_right'],
  ];

  bilateralPairs.forEach(([l, r]) => {
    const left = result[l];
    const right = result[r];
    const higher =
      left.fatigue > right.fatigue || (left.hasHistoricalData && !right.hasHistoricalData)
        ? left
        : right;

    if (left.fatigue !== right.fatigue || left.hasHistoricalData !== right.hasHistoricalData) {
      result[l] = { ...higher, id: l, name: MUSCLE_CONFIG[l].name };
      result[r] = { ...higher, id: r, name: MUSCLE_CONFIG[r].name };
    }
  });

  return result;
}

/**
 * Información biomecánica de los 10 grupos canónicos:
 * Nombres, ejercicios recomendados y relaciones sinérgicas para splits de entrenamiento.
 */
export const CANONICAL_MUSCLE_INFO: Record<
  CanonicalMuscleId,
  {
    name: string;
    spanishGroup: string;
    description: string;
    suggestedExercises: string[];
    synergisticWith: CanonicalMuscleId[];
  }
> = {
  pectoral_major: {
    name: 'Pectoral Mayor',
    spanishGroup: 'Pecho',
    description: 'Empujes horizontales, flexión y aducción horizontal.',
    suggestedExercises: ['Press de banca plano', 'Press inclinado mancuernas', 'Fondos en paralelas'],
    synergisticWith: ['deltoids', 'triceps'],
  },
  latissimus_dorsi: {
    name: 'Dorsal Ancho & Trapecios',
    spanishGroup: 'Espalda',
    description: 'Tracciones verticales y horizontales, retracción escapular.',
    suggestedExercises: ['Dominadas pronas', 'Jalón al pecho en polea', 'Remo con barra'],
    synergisticWith: ['biceps'],
  },
  quadriceps: {
    name: 'Cuádriceps',
    spanishGroup: 'Piernas',
    description: 'Extensión de rodilla y estabilización femoropatelar.',
    suggestedExercises: ['Sentadilla con barra', 'Prensa inclinada', 'Sentadilla Hack'],
    synergisticWith: ['glutes', 'hamstrings', 'calves'],
  },
  hamstrings: {
    name: 'Isquiosurales / Femorales',
    spanishGroup: 'Piernas',
    description: 'Flexión de rodilla y extensión de cadera en cadena posterior.',
    suggestedExercises: ['Peso muerto rumano', 'Curl femoral tumbado', 'Nordic curls'],
    synergisticWith: ['glutes', 'latissimus_dorsi'],
  },
  glutes: {
    name: 'Glúteos (Mayor & Medio)',
    spanishGroup: 'Glúteos',
    description: 'Extensión de cadera, abducción y estabilización pélvica.',
    suggestedExercises: ['Hip Thrust con barra', 'Sentadilla profunda', 'Patada en polea'],
    synergisticWith: ['hamstrings', 'quadriceps'],
  },
  deltoids: {
    name: 'Deltoides / Hombros',
    spanishGroup: 'Hombros',
    description: 'Empujes verticales, abducción y elevación del brazo.',
    suggestedExercises: ['Press militar', 'Elevaciones laterales', 'Pájaros con mancuernas'],
    synergisticWith: ['triceps', 'pectoral_major'],
  },
  biceps: {
    name: 'Bíceps Braquial',
    spanishGroup: 'Brazos',
    description: 'Flexión de codo y supinación de antebrazo.',
    suggestedExercises: ['Curl con barra Z', 'Curl martillo', 'Curl en banco inclinado'],
    synergisticWith: ['latissimus_dorsi'],
  },
  triceps: {
    name: 'Tríceps Braquial',
    spanishGroup: 'Brazos',
    description: 'Extensión de codo en empujes y bloqueo final.',
    suggestedExercises: ['Press francés', 'Extensiones en polea', 'Press cerrado con barra'],
    synergisticWith: ['pectoral_major', 'deltoids'],
  },
  calves: {
    name: 'Gemelos & Pantorrillas',
    spanishGroup: 'Piernas',
    description: 'Flexión plantar y propulsión elástica.',
    suggestedExercises: ['Elevación de talones de pie', 'Elevación sóleo en máquina'],
    synergisticWith: ['quadriceps', 'hamstrings'],
  },
  abs: {
    name: 'Abdomen & Core',
    spanishGroup: 'Core',
    description: 'Estabilidad lumbopélvica y transmisión de fuerzas.',
    suggestedExercises: ['Rueda abdominal', 'Elevaciones de piernas colgado', 'Plancha isométrica'],
    synergisticWith: ['latissimus_dorsi', 'glutes'],
  },
};

/**
 * Detecta si un atleta ha entrenado repetidamente los mismos grupos musculares
 * sin el tiempo de recuperación suficiente (por ejemplo en días consecutivos).
 */
export function detectRepetitiveStrainAlerts(
  workouts: CompletedWorkout[],
  recoveryReport: Record<BiometricMuscleId, MuscleRecoveryState>,
  currentTime: number = Date.now()
): RepetitiveStrainAlert[] {
  const alerts: RepetitiveStrainAlert[] = [];
  const sanitized = sanitizeWorkoutsHistory(workouts);
  if (sanitized.length < 2) return [];

  // Mapear cada sesión con los músculos que impactó
  const muscleSessions: Record<
    CanonicalMuscleId,
    { workoutId: string; title: string; timestamp: number; dateStr: string; volumeKg: number }[]
  > = {
    pectoral_major: [],
    latissimus_dorsi: [],
    quadriceps: [],
    hamstrings: [],
    glutes: [],
    deltoids: [],
    biceps: [],
    triceps: [],
    calves: [],
    abs: [],
  };

  // Recorrer los entrenamientos de los últimos 7 días
  sanitized.forEach((w) => {
    const wTime = w.endTime || w.startTime || new Date(w.date).getTime() || currentTime;
    if (currentTime - wTime > 7 * 24 * 3600 * 1000) return;

    const impactedCanonical = new Set<CanonicalMuscleId>();
    (w.exercisesSummary || []).forEach((ex) => {
      const imp = resolveExerciseMuscleImpact(ex.name, ex.muscleGroup);
      imp.primary.forEach((pId) => {
        const cId = MUSCLE_CONFIG[pId]?.canonicalId;
        if (cId) impactedCanonical.add(cId);
      });
    });

    impactedCanonical.forEach((cId) => {
      muscleSessions[cId].push({
        workoutId: w.id,
        title: w.routineTitle || 'Entrenamiento',
        timestamp: wTime,
        dateStr: w.date,
        volumeKg: w.totalVolumeKg || 0,
      });
    });
  });

  // Para cada grupo muscular, buscar sesiones consecutivas con < 48h de separación
  (Object.keys(muscleSessions) as CanonicalMuscleId[]).forEach((cId) => {
    const list = muscleSessions[cId].sort((a, b) => b.timestamp - a.timestamp); // Más reciente primero
    if (list.length >= 2) {
      for (let i = 0; i < list.length - 1; i++) {
        const s1 = list[i];
        const s2 = list[i + 1];
        const diffHours = (s1.timestamp - s2.timestamp) / (1000 * 3600);

        // Si se entrenó con menos de 48 horas de diferencia
        if (diffHours > 0 && diffHours < 48) {
          const muscleInfo = CANONICAL_MUSCLE_INFO[cId];
          const isCritical = diffHours < 24;

          // Obtener la fatiga actual de este grupo en el mapa
          let maxCurrentFatigue = 0;
          Object.values(recoveryReport).forEach((m) => {
            if (m.canonicalId === cId && m.fatigue > maxCurrentFatigue) {
              maxCurrentFatigue = m.fatigue;
            }
          });

          alerts.push({
            canonicalId: cId,
            muscleName: muscleInfo?.name || cId,
            sessionCount: list.length,
            timeBetweenHours: Math.round(diffHours),
            lastSessionDate: s1.dateStr,
            currentFatigue: maxCurrentFatigue,
            severity: isCritical || maxCurrentFatigue >= 60 ? 'critical' : 'warning',
            message: isCritical
              ? `Entrenado 2 veces en menos de 24h (${Math.round(diffHours)}h de intervalo). Riesgo elevado de sobrecarga acumulada.`
              : `Entrenado 2 veces en ${Math.round(diffHours)}h sin completar la recuperación. Se recomienda descanso antes del próximo estímulo.`,
          });
          break; // Una alerta por grupo muscular
        }
      }
    }
  });

  return alerts;
}

/**
 * Resume el historial y volumen acumulado para un período específico
 * (Hoy, 7 días, 30 días, 90 días) SIN alterar el cálculo de la fatiga biológica viva.
 */
export function computePeriodHistorySummary(
  workouts: CompletedWorkout[] = [],
  period: 'hoy' | '7dias' | '30dias' | '90dias' = '7dias',
  currentTime: number = Date.now()
): PeriodHistorySummary {
  const sanitized = sanitizeWorkoutsHistory(workouts);
  const periodLabelMap: Record<'hoy' | '7dias' | '30dias' | '90dias', string> = {
    hoy: 'Hoy',
    '7dias': 'Últimos 7 días',
    '30dias': 'Últimos 30 días',
    '90dias': 'Últimos 90 días',
  };

  const filtered = sanitized.filter((w) => {
    const wTime = w.endTime || w.startTime || new Date(w.date).getTime() || currentTime;
    const elapsedMs = Math.max(0, currentTime - wTime);
    const elapsedH = elapsedMs / (1000 * 60 * 60);

    if (period === 'hoy') return elapsedH <= 24;
    if (period === '7dias') return elapsedH <= 7 * 24;
    if (period === '30dias') return elapsedH <= 30 * 24;
    if (period === '90dias') return elapsedH <= 90 * 24;
    return true;
  });

  let totalVolumeKg = 0;
  let totalSetsCompleted = 0;
  let totalDurationSeconds = 0;

  const breakdownMap: Record<
    CanonicalMuscleId,
    { name: string; volumeKg: number; sets: number; exerciseCount: number; lastDate?: string }
  > = {
    pectoral_major: { name: 'Pectoral', volumeKg: 0, sets: 0, exerciseCount: 0 },
    latissimus_dorsi: { name: 'Espalda / Dorsal', volumeKg: 0, sets: 0, exerciseCount: 0 },
    quadriceps: { name: 'Cuádriceps', volumeKg: 0, sets: 0, exerciseCount: 0 },
    hamstrings: { name: 'Isquiosurales', volumeKg: 0, sets: 0, exerciseCount: 0 },
    glutes: { name: 'Glúteos', volumeKg: 0, sets: 0, exerciseCount: 0 },
    deltoids: { name: 'Hombros', volumeKg: 0, sets: 0, exerciseCount: 0 },
    biceps: { name: 'Bíceps', volumeKg: 0, sets: 0, exerciseCount: 0 },
    triceps: { name: 'Tríceps', volumeKg: 0, sets: 0, exerciseCount: 0 },
    calves: { name: 'Gemelos', volumeKg: 0, sets: 0, exerciseCount: 0 },
    abs: { name: 'Core / Abdomen', volumeKg: 0, sets: 0, exerciseCount: 0 },
  };

  filtered.forEach((w) => {
    totalVolumeKg += Math.round(w.totalVolumeKg || 0);
    totalSetsCompleted += w.completedSetsCount || (w.exercisesSummary || []).reduce((acc, e) => acc + (e.sets || 0), 0);
    totalDurationSeconds += w.durationSeconds || 0;

    (w.exercisesSummary || []).forEach((ex) => {
      const imp = resolveExerciseMuscleImpact(ex.name, ex.muscleGroup);
      const exVol = Number(ex.volumeKg) || 0;
      const exSets = Number(ex.sets) || 0;

      const seenCanonical = new Set<CanonicalMuscleId>();
      imp.primary.forEach((pId) => {
        const cId = MUSCLE_CONFIG[pId]?.canonicalId;
        if (cId && breakdownMap[cId] && !seenCanonical.has(cId)) {
          seenCanonical.add(cId);
          breakdownMap[cId].volumeKg += exVol;
          breakdownMap[cId].sets += exSets;
          breakdownMap[cId].exerciseCount += 1;
          breakdownMap[cId].lastDate = w.date;
        }
      });
    });
  });

  const muscleLoadBreakdown = (Object.keys(breakdownMap) as CanonicalMuscleId[])
    .map((cId) => ({
      canonicalId: cId,
      ...breakdownMap[cId],
      lastTrainedDate: breakdownMap[cId].lastDate,
    }))
    .filter((b) => b.sets > 0 || b.volumeKg > 0)
    .sort((a, b) => b.volumeKg - a.volumeKg);

  return {
    period,
    periodLabel: periodLabelMap[period],
    totalWorkouts: filtered.length,
    totalVolumeKg,
    totalSetsCompleted,
    totalDurationMinutes: Math.round(totalDurationSeconds / 60),
    workouts: filtered,
    muscleLoadBreakdown,
  };
}

/**
 * Resume el estado muscular general del atleta y genera recomendaciones inteligentes de entrenamiento.
 * Clasifica rigurosamente en tres estados:
 * - LISTO PARA ENTRENAR (Fatiga <= 24%)
 * - RECUPERACIÓN EN PROCESO (Fatiga 25% a 49%)
 * - DESCANSO RECOMENDADO (Fatiga >= 50%)
 */
export function computeOverallAthleteSummary(
  recoveryReport: Record<BiometricMuscleId, MuscleRecoveryState>,
  completedWorkouts: CompletedWorkout[] = [],
  currentTime: number = Date.now()
): OverallAthleteMuscularSummary {
  const canonicalMap = new Map<
    CanonicalMuscleId,
    {
      name: string;
      fatigue: number;
      remainingHours: number;
      remainingMinutes: number;
      statusColor: string;
      readiness: MuscleRecoveryState['trainingReadiness'];
    }
  >();

  // Consolidar por grupo muscular canónico único (10 grupos principales)
  Object.values(recoveryReport).forEach((m) => {
    const existing = canonicalMap.get(m.canonicalId);
    const floatRem = m.remainingHours + m.remainingMinutes / 60;
    const existingRem = existing ? existing.remainingHours + existing.remainingMinutes / 60 : -1;
    if (!existing || floatRem > existingRem || m.fatigue > existing.fatigue) {
      const visual = getFatigueColorAndStatus(m.fatigue, Boolean(m.hasHistoricalData), floatRem);
      canonicalMap.set(m.canonicalId, {
        name: CANONICAL_MUSCLE_INFO[m.canonicalId]?.name || m.name.replace(/ Izquierdo| Derecho| Izq\.| Der\./g, ''),
        fatigue: m.fatigue,
        remainingHours: m.remainingHours,
        remainingMinutes: m.remainingMinutes,
        statusColor: visual.statusColor,
        readiness: visual.trainingReadiness,
      });
    }
  });

  const muscleList: CanonicalMuscleReadinessItem[] = Array.from(canonicalMap.entries()).map(([cId, data]) => {
    const info = CANONICAL_MUSCLE_INFO[cId];
    return {
      canonicalId: cId,
      name: data.name,
      groupName: info?.spanishGroup || 'General',
      fatigue: data.fatigue,
      remainingHours: data.remainingHours,
      remainingMinutes: data.remainingMinutes,
      readiness: data.readiness,
      statusColor: data.statusColor,
      suggestedExercises: info?.suggestedExercises || [],
    };
  });

  const totalMonitored = muscleList.length;
  let totalFatigueSum = 0;
  let maxRemainingH = 0;

  // Clasificación coherente según readiness (sincronizada con tiempo restante y fatiga)
  const readyMuscles: CanonicalMuscleReadinessItem[] = [];
  const inRecoveryMuscles: CanonicalMuscleReadinessItem[] = [];
  const highFatigueMuscles: CanonicalMuscleReadinessItem[] = [];

  muscleList.forEach((m) => {
    totalFatigueSum += m.fatigue;

    if (m.readiness === 'LISTO PARA ENTRENAR') {
      readyMuscles.push(m);
    } else if (m.readiness === 'RECUPERACIÓN EN PROCESO') {
      inRecoveryMuscles.push(m);
    } else {
      highFatigueMuscles.push(m);
    }

    const totalHoursFloat = m.remainingHours + m.remainingMinutes / 60;
    if (totalHoursFloat > maxRemainingH) {
      maxRemainingH = totalHoursFloat;
    }
  });

  readyMuscles.sort((a, b) => a.fatigue - b.fatigue);
  inRecoveryMuscles.sort((a, b) => a.fatigue - b.fatigue);
  highFatigueMuscles.sort((a, b) => b.fatigue - a.fatigue);

  const avgFatigue = totalMonitored > 0 ? Math.round(totalFatigueSum / totalMonitored) : 0;
  const overallRecoveryPct = Math.max(0, 100 - avgFatigue);

  // Alertas de fatiga repetitiva o sobrecarga consecutiva
  const repetitiveStrainAlerts = detectRepetitiveStrainAlerts(
    completedWorkouts,
    recoveryReport,
    currentTime
  );

  // Splits recomendados de entrenamiento basados en músculos listos
  const readySet = new Set(readyMuscles.map((m) => m.canonicalId));

  const standardSplits: {
    splitName: string;
    targetMuscles: string[];
    canonicalIds: CanonicalMuscleId[];
  }[] = [
    {
      splitName: 'Sesión de Tirón (Pull)',
      targetMuscles: ['Espalda / Dorsal', 'Bíceps'],
      canonicalIds: ['latissimus_dorsi', 'biceps'],
    },
    {
      splitName: 'Sesión de Empuje (Push)',
      targetMuscles: ['Pectoral', 'Hombros', 'Tríceps'],
      canonicalIds: ['pectoral_major', 'deltoids', 'triceps'],
    },
    {
      splitName: 'Sesión de Piernas Completa (Legs)',
      targetMuscles: ['Cuádriceps', 'Isquiosurales', 'Glúteos'],
      canonicalIds: ['quadriceps', 'hamstrings', 'glutes'],
    },
    {
      splitName: 'Sesión de Brazos & Core',
      targetMuscles: ['Bíceps', 'Tríceps', 'Core / Abdomen'],
      canonicalIds: ['biceps', 'triceps', 'abs'],
    },
  ];

  const suggestedSessionSplits: SuggestedTrainingSplit[] = standardSplits.map((split) => {
    const readyCount = split.canonicalIds.filter((cId) => readySet.has(cId)).length;
    const score = Math.round((readyCount / split.canonicalIds.length) * 100);
    const isRecommended = score >= 66;

    let reason = '';
    if (score === 100) {
      reason = 'Todos los grupos musculares involucrados están 100% listos para entrenar con máxima intensidad.';
    } else if (score >= 66) {
      reason = 'La mayoría de los músculos de este split están recuperados. Apto para entrenar con control de volumen.';
    } else {
      reason = 'Uno o más grupos principales presentan fatiga activa residual. Se recomienda esperar su recuperación.';
    }

    return {
      splitName: split.splitName,
      targetMuscles: split.targetMuscles,
      canonicalIds: split.canonicalIds,
      isRecommended,
      readinessScore: score,
      reason,
    };
  });

  // Tono general
  let tone: 'emerald' | 'amber' | 'rose' | 'cyan' = 'emerald';
  let statusText = 'Capacidad Plena de Entrenamiento';

  if (highFatigueMuscles.length >= 4 || avgFatigue > 60 || repetitiveStrainAlerts.some((a) => a.severity === 'critical')) {
    tone = 'rose';
    statusText = 'Fatiga Sistémica Alta • Descanso Recomendado';
  } else if (inRecoveryMuscles.length >= 3 || avgFatigue > 30) {
    tone = 'amber';
    statusText = 'Recuperación Activa en Progreso';
  } else if (avgFatigue > 0) {
    tone = 'cyan';
    statusText = 'Estado Muscular Óptimo';
  }

  return {
    systemicFatigue: avgFatigue,
    overallRecoveryPct,
    totalMonitoredMuscles: totalMonitored,
    recoveredCount: readyMuscles.length,
    inRecoveryCount: inRecoveryMuscles.length,
    highFatigueCount: highFatigueMuscles.length,
    overallStatusText: statusText,
    overallStatusTone: tone,
    readyMuscles,
    inRecoveryMuscles,
    highFatigueMuscles,
    nextAvailableMuscles: readyMuscles,
    musclesToAvoid: highFatigueMuscles,
    repetitiveStrainAlerts,
    suggestedSessionSplits,
    earliestNextFullRecoveryHours: Math.round(maxRemainingH),
  };
}
