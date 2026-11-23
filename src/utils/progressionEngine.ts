import { CompletedWorkout, ExerciseSetSnapshot, LoggedSet } from '../types';
import { normalizeExerciseName, resolveLibraryExercise } from '../data/exerciseLibrary';
import { parseRobustDate } from './calorieCalculator';
import { resolveCanonicalExerciseIdentity } from './historyRecoveryEngine';

/**
 * Palabras clave para identificar ejercicios analíticos / de aislamiento.
 */
const ISOLATION_PATTERNS = [
  // Piernas
  /extensi[oó]n de (pierna|cu[aá]driceps)/i,
  /leg extension/i,
  /curl (femoral|isquio|de pierna|lying leg curl|seated leg curl)/i,
  /elevaci[oó]n de talones/i,
  /gemelos/i,
  /pantorrilla/i,
  /calf (raise|machine)/i,
  /abductor/i,
  /aductor/i,
  /abducci[oó]n/i,
  /aducci[oó]n/i,
  /patada de gl[uú]teo/i,
  /glute kickback/i,

  // Torso / Brazos / Hombros
  /curl de b[ií]ceps/i,
  /curl (martillo|hammer|predicador|scott|spider|concentrado|biceps)/i,
  /extensi[oó]n de tr[ií]ceps/i,
  /tr[ií]ceps polea/i,
  /triceps (pushdown|kickback|extension)/i,
  /patada de tr[ií]ceps/i,
  /copa a dos manos/i,
  /press franc[eé]s/i,
  /elevaci[oó]n (lateral|frontal)/i,
  /elevaciones laterales/i,
  /lateral raise/i,
  /front raise/i,
  /p[aá]jaros/i,
  /rear delt/i,
  /face pull/i,
  /aperturas/i,
  /pec deck/i,
  /cruce(s)? de polea/i,
  /cable fly/i,
  /pullover/i,
  /encogimientos/i,
  /shrug/i,

  // Core / Aislados
  /crunch/i,
  /hiperextensi[oó]n/i,
  /elevaci[oó]n de piernas en barra/i,
  /pallof/i,

  // Cuello, estabilización cervical y aislamiento escapular con banda
  /cervical/i,
  /cuello/i,
  /retracci[oó]n cervical/i,
  /pull[- ]?apart/i,
  /rotaci[oó]n externa/i,
  /deslizamiento de brazos/i,
  /remo escapular/i,
  /elevaci[oó]n en y/i,
];

/**
 * Palabras clave para identificar ejercicios multiarticulares / básicos.
 */
const COMPOUND_PATTERNS = [
  /sentadilla/i,
  /squat/i,
  /prensa/i,
  /leg press/i,
  /hack/i,
  /peso muerto/i,
  /deadlift/i,
  /hip thrust/i,
  /press (de )?banca/i,
  /bench press/i,
  /press militar/i,
  /overhead press/i,
  /push press/i,
  /dominada/i,
  /pull[- ]?up/i,
  /chin[- ]?up/i,
  /remo/i,
  /row/i,
  /fondos/i,
  /dips/i,
  /zancada/i,
  /lunge/i,
  /clean/i,
  /snatch/i,
];

/**
 * Determina si un ejercicio es de aislamiento / analítico.
 */
export function isIsolationExercise(exerciseName: string): boolean {
  if (!exerciseName) return false;
  return ISOLATION_PATTERNS.some((pattern) => pattern.test(exerciseName));
}

/**
 * Determina si un ejercicio es básico multiarticular / compuesto.
 */
export function isCompoundExercise(exerciseName: string): boolean {
  if (!exerciseName) return false;
  if (isIsolationExercise(exerciseName)) return false;
  return COMPOUND_PATTERNS.some((pattern) => pattern.test(exerciseName));
}

export type ExerciseCategory = 'compuesto' | 'aislamiento';

export function getExerciseCategory(exerciseName: string): ExerciseCategory {
  return isIsolationExercise(exerciseName) ? 'aislamiento' : 'compuesto';
}

/**
 * Extrae los límites numéricos inferior y superior de una cadena de rango de repeticiones.
 * Ejemplos: "8 - 12", "8 a 12 reps", "10-15", "12 reps", "1-5 reps", "6 a 12 reps"
 */
export function parseRepRange(repRangeStr?: string): { minReps: number; maxReps: number } {
  if (!repRangeStr) {
    return { minReps: 8, maxReps: 12 };
  }

  const clean = repRangeStr.toLowerCase().replace(/reps?|repeticiones?/g, '').trim();

  // Caso: "8 - 12", "8-12", "8 a 12", "8 a 10"
  const rangeMatch = clean.match(/(\d+)\s*(?:-|a|al|to)\s*(\d+)/i);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    return {
      minReps: Math.min(min, max),
      maxReps: Math.max(min, max),
    };
  }

  // Caso: número único ej. "10", "12", "5"
  const singleMatch = clean.match(/(\d+)/);
  if (singleMatch) {
    const num = parseInt(singleMatch[1], 10);
    return {
      minReps: Math.max(1, num - 2),
      maxReps: num,
    };
  }

  return { minReps: 8, maxReps: 12 };
}

/**
 * Sanea y ajusta el rango de repeticiones según la categoría del ejercicio y el mesociclo / objetivo:
 * - Limita el rango 1–5 reps a mesociclos específicos de fuerza máxima o ejercicios básicos multiarticulares.
 * - Reasigna obligatoriamente los ejercicios de aislamiento a rangos mínimos de 8 a 15 repeticiones (nunca 1-5).
 */
export function sanitizeExerciseRepRange(
  exerciseName: string,
  currentRepRange?: string,
  modality?: string
): string {
  const isIso = isIsolationExercise(exerciseName);
  const isFuerzaMaxima = modality === 'fuerza_maxima' || modality === 'fuerza';
  const { minReps, maxReps } = parseRepRange(currentRepRange);

  if (isIso) {
    // Los ejercicios de aislamiento JAMÁS deben tener 1-5 reps
    if (maxReps <= 7 || minReps < 8) {
      // Reasignación a rango biomecánicamente seguro para aislamiento
      return '10 a 15 reps';
    }
    return `${minReps} a ${maxReps} reps`;
  }

  // Si es compuesto multiarticular:
  if (maxReps <= 5) {
    // Si no es mesociclo de fuerza máxima, proteger contra sobrecarga lesiva en hipertrofia
    if (!isFuerzaMaxima && modality !== 'potencia') {
      return '6 a 10 reps';
    }
    return '1 a 5 reps';
  }

  return currentRepRange && currentRepRange.trim() ? currentRepRange : '8 a 12 reps';
}

export type DoubleProgressionStatus =
  | 'INCREASE_LOAD'       // Completó el techo de reps en TODAS las series efectivas con RPE <= 9
  | 'REPS_IN_PROGRESS'    // Está en el proceso de sumar repeticiones dentro del rango objetivo
  | 'RPE10_FATIGUE'       // Al menos una serie llegó a RPE 10 / RIR 0 -> mantener carga o back-off set
  | 'WARMUP_ONLY'         // Solo series de aproximación o sin registrar
  | 'INCOMPLETE';         // Series pendientes por registrar

export interface DoubleProgressionEvaluation {
  status: DoubleProgressionStatus;
  category: ExerciseCategory;
  targetMinReps: number;
  targetMaxReps: number;
  effectiveSetsCount: number;
  completedEffectiveSetsCount: number;
  allSetsHitCeiling: boolean;
  hasRpe10Failure: boolean;
  maxRpeLogged?: number;
  recommendedLoadDeltaKg: number;
  backoffSuggestedKg?: number;
  badgeText: string;
  badgeColorClass: string;
  headline: string;
  actionAdvice: string;
  isOverloadApplicable: boolean;
}

/**
 * Evalúa la doble progresión biomecánica de un ejercicio en tiempo real.
 *
 * Reglas Científicas:
 * 1. Doble Progresión: Se fija un rango de repeticiones (ej. 8-12 o 10-15).
 * 2. Condición para subir peso: ÚNICAMENTE cuando el atleta complete el techo superior (ej. 12 reps)
 *    en TODAS las series efectivas manteniendo RPE <= 9.
 * 3. Feedback de RPE: Si se marca RPE 10 (fallo absoluto) o RIR 0, JAMÁS prescribir aumento de peso.
 *    Sugerir mantener la carga o realizar un back-off set (-10% a -15%).
 * 4. Categoría: En aislamiento, los rangos son siempre >= 8 reps (ej. 8-12 o 10-15).
 */
export function evaluateDoubleProgression(
  exerciseName: string,
  repRangeStr: string | undefined,
  sets: LoggedSet[],
  modality?: string
): DoubleProgressionEvaluation {
  const category = getExerciseCategory(exerciseName);
  const isIso = category === 'aislamiento';

  // Obtener rangos seguros
  const safeRangeStr = sanitizeExerciseRepRange(exerciseName, repRangeStr, modality);
  const { minReps, maxReps } = parseRepRange(safeRangeStr);

  const effectiveSets = sets.filter((s) => !s.isWarmup);
  if (effectiveSets.length === 0) {
    return {
      status: 'WARMUP_ONLY',
      category,
      targetMinReps: minReps,
      targetMaxReps: maxReps,
      effectiveSetsCount: 0,
      completedEffectiveSetsCount: 0,
      allSetsHitCeiling: false,
      hasRpe10Failure: false,
      recommendedLoadDeltaKg: 0,
      badgeText: 'CALENTAMIENTO',
      badgeColorClass: 'text-slate-400 bg-slate-900 border-slate-800',
      headline: 'Series de Aproximación',
      actionAdvice: 'Realiza tus series de aproximación antes de las series efectivas.',
      isOverloadApplicable: false,
    };
  }

  const completedSets = effectiveSets.filter((s) => s.completed);
  const allCompleted = completedSets.length === effectiveSets.length && effectiveSets.length > 0;

  // Evaluar RPE
  let hasRpe10Failure = false;
  let maxRpeLogged = 0;
  let allRpeSafe = true; // RPE <= 9

  effectiveSets.forEach((s) => {
    if (s.completed && typeof s.rpe === 'number') {
      if (s.rpe > maxRpeLogged) maxRpeLogged = s.rpe;
      if (s.rpe >= 10) {
        hasRpe10Failure = true;
      }
      if (s.rpe > 9) {
        allRpeSafe = false;
      }
    }
  });

  // Evaluar repeticiones contra el techo superior
  let allSetsHitCeiling = allCompleted;
  let anySetHitCeiling = false;

  completedSets.forEach((s) => {
    const r = typeof s.reps === 'number' ? s.reps : 0;
    if (r >= maxReps) {
      anySetHitCeiling = true;
    } else {
      allSetsHitCeiling = false;
    }
  });

  // Base weight para cálculo de Drop / Back-off set (-5% descarga inmediata por RPE 10)
  const lastEffectiveWeight = completedSets.slice().reverse().find((s) => typeof s.weight === 'number' && s.weight > 0)?.weight as number | undefined;
  const backoffSuggestedKg = lastEffectiveWeight
    ? Math.max(1, Math.round((lastEffectiveWeight * 0.95) * 2) / 2)
    : undefined;

  // 1. Caso RPE 10 / RIR 0: Fatiga Muscular Absoluta (prioridad máxima de seguridad)
  if (hasRpe10Failure) {
    return {
      status: 'RPE10_FATIGUE',
      category,
      targetMinReps: minReps,
      targetMaxReps: maxReps,
      effectiveSetsCount: effectiveSets.length,
      completedEffectiveSetsCount: completedSets.length,
      allSetsHitCeiling: false,
      hasRpe10Failure: true,
      maxRpeLogged,
      recommendedLoadDeltaKg: 0,
      backoffSuggestedKg,
      badgeText: '⚠️ FATIGA RPE 10 · AUTORREGULACIÓN ACTIVA',
      badgeColorClass: 'text-rose-400 bg-rose-950/40 border-rose-500/40',
      headline: 'Fallo Muscular Total (@10 / RIR 0)',
      actionAdvice:
        backoffSuggestedKg
          ? `Fallo total detectado. Prohibido subir carga. Para la siguiente serie se sugiere un Drop del 5% (${backoffSuggestedKg} kg) o mantener el peso reduciendo las repeticiones objetivo (-2 reps).`
          : 'Fallo total detectado. Prohibido aumentar carga; mantén el peso reduciendo repeticiones (-2 reps) o aplica un Drop del 5% para gestionar la fatiga.',
      isOverloadApplicable: false,
    };
  }

  // 2. Caso Techo de Repeticiones Alcanzado en TODAS las series efectivas con RPE <= 8.0
  const allRpeAllowIncrease = effectiveSets.every(
    (s) => !s.completed || (typeof s.rpe === 'number' && s.rpe <= 8.0)
  );
  if (allCompleted && allSetsHitCeiling && allRpeAllowIncrease) {
    const deltaKg = 2.5;

    return {
      status: 'INCREASE_LOAD',
      category,
      targetMinReps: minReps,
      targetMaxReps: maxReps,
      effectiveSetsCount: effectiveSets.length,
      completedEffectiveSetsCount: completedSets.length,
      allSetsHitCeiling: true,
      hasRpe10Failure: false,
      maxRpeLogged,
      recommendedLoadDeltaKg: deltaKg,
      badgeText: `🎯 AUTORREGULACIÓN ÓPTIMA (+${deltaKg} kg)`,
      badgeColorClass: 'text-accent-text bg-accent/10 border-accent/50 shadow-sm',
      headline: `¡Series completadas con reserva amplia (RPE ≤ 8.0)!`,
      actionAdvice: `Has completado ${maxReps} reps con RPE ≤ 8.0. Se autoriza incremento de +${deltaKg} kg (+5%).`,
      isOverloadApplicable: true,
    };
  }

  // 3. Caso Autorregulación en Zona de Esfuerzo Alto (RPE >= 8.5) o Progresión en Curso
  const hasHighEffortRpe = effectiveSets.some(
    (s) => s.completed && typeof s.rpe === 'number' && s.rpe >= 8.5 && s.rpe < 10
  );

  return {
    status: allCompleted ? 'REPS_IN_PROGRESS' : 'INCOMPLETE',
    category,
    targetMinReps: minReps,
    targetMaxReps: maxReps,
    effectiveSetsCount: effectiveSets.length,
    completedEffectiveSetsCount: completedSets.length,
    allSetsHitCeiling,
    hasRpe10Failure: false,
    maxRpeLogged,
    recommendedLoadDeltaKg: 0,
    badgeText: hasHighEffortRpe
      ? `🛡️ RPE ≥ 8.5 · MANTENER CARGA ACTUAL`
      : `📈 DOBLE PROGRESIÓN (${minReps}–${maxReps} REPS)`,
    badgeColorClass: 'text-amber-300 bg-amber-950/20 border-amber-500/30',
    headline: hasHighEffortRpe
      ? `Esfuerzo Alto Detectado (RPE ${maxRpeLogged}) · Prohibido Subir Peso`
      : `Rango Objetivo: ${minReps} a ${maxReps} reps`,
    actionAdvice: hasHighEffortRpe
      ? `Con RPE ≥ 8.5 estás cerca del fallo mecánico (RIR ≤ 1.5). Mantén exactamente ${lastEffectiveWeight ? `${lastEffectiveWeight} kg` : 'el mismo peso'} para proteger tu sistema nervioso y completar el volumen sin colapsar.`
      : anySetHitCeiling
      ? `Llegaste a ${maxReps} reps en alguna serie. Mantén el peso actual y registra RPE ≤ 8.0 antes de incrementar carga.`
      : `Mantén el peso actual (${lastEffectiveWeight ? `${lastEffectiveWeight} kg` : 'referencia'}). Prioriza dominar el rango con RPE controlado.`,
    isOverloadApplicable: false,
  };
}

export type RpeAutoregulationDecision =
  | 'INCREASE_LOAD'         // Serie completada (OK) y RPE <= 8.0 -> +2.5 kg (o +5%) y mismas reps
  | 'HOLD_LOAD'             // Serie completada (OK) y RPE >= 8.5 (< 10) -> PROHIBIDO subir peso, mantiene peso y reps
  | 'FAILURE_DROP_OR_REPS'  // Serie en RPE 10 (Fallo total) -> Drop -5% de peso o mantener peso con -2 reps
  | 'INCOMPLETE_SET';       // Serie aún no marcada como completada

export interface NextSetPrescription {
  decision: RpeAutoregulationDecision;
  suggestedWeightKg: number;
  suggestedReps: number;
  // En caso de RPE 10 se calculan ambas alternativas de descarga:
  drop5PctWeightKg: number;
  reducedTargetReps: number;
  deltaWeightKg: number;
  explanation: string;
}

/**
 * Algoritmo de Autorregulación por RPE en Tiempo Real (Serie a Serie)
 * Cruza las variables: Series_Completadas (completed), Peso_Actual (weight), Reps (reps) y RPE_Value (rpe).
 *
 * Directrices estrictas:
 * 1. SI Serie_Completada === true Y RPE_Value <= 8.0:
 *    Permite sugerir un incremento de carga (+2.5 kg) manteniendo las repeticiones.
 * 2. SI Serie_Completada === true Y RPE_Value >= 8.5 (y < 10):
 *    PROHIBIDO solicitar aumento de peso. Sugiere MANTENER exactamente el mismo peso y repeticiones.
 * 3. SI RPE_Value >= 10 (Fallo total):
 *    Sugiere mantener el peso reduciendo las repeticiones objetivo (-2 reps) o aplicar un ligero Drop de peso (-5%).
 */
export function calculateNextSetByRpe(params: {
  Series_Completadas: boolean;
  Peso_Actual: number;
  Reps: number;
  RPE_Value?: number;
  preferDropOnFailure?: boolean;
}): NextSetPrescription {
  const {
    Series_Completadas,
    Peso_Actual,
    Reps,
    RPE_Value,
    preferDropOnFailure = true,
  } = params;

  const safeWeight = typeof Peso_Actual === 'number' && Peso_Actual > 0 ? Peso_Actual : 0;
  const safeReps = typeof Reps === 'number' && Reps > 0 ? Math.round(Reps) : 10;

  // Cálculo del Drop del 5% (redondeado a múltiplos de 0.5 kg para precisión en gimnasio)
  const drop5PctWeightKg =
    safeWeight > 0 ? Math.max(2.5, Math.round(safeWeight * 0.95 * 2) / 2) : 0;
  // Reducción automática de repeticiones (-2 reps, mínimo 1 rep)
  const reducedTargetReps = Math.max(1, safeReps - 2);

  // Validación previa: si la serie no está completada y no es fallo RPE 10
  if (!Series_Completadas && (RPE_Value === undefined || RPE_Value < 10)) {
    return {
      decision: 'INCOMPLETE_SET',
      suggestedWeightKg: safeWeight,
      suggestedReps: safeReps,
      drop5PctWeightKg,
      reducedTargetReps,
      deltaWeightKg: 0,
      explanation: 'Serie pendiente de completar.',
    };
  }

  // ==========================================================================
  // BLOQUE CONDICIONAL 1: RPE === 10 (FALLO MUSCULAR TOTAL / RIR 0)
  // ==========================================================================
  if (typeof RPE_Value === 'number' && RPE_Value >= 10) {
    const suggestedWeightKg = preferDropOnFailure ? drop5PctWeightKg : safeWeight;
    const suggestedReps = preferDropOnFailure ? safeReps : reducedTargetReps;

    return {
      decision: 'FAILURE_DROP_OR_REPS',
      suggestedWeightKg,
      suggestedReps,
      drop5PctWeightKg,
      reducedTargetReps,
      deltaWeightKg: Number((suggestedWeightKg - safeWeight).toFixed(2)),
      explanation: `⚠️ RPE 10 (Fallo Total): Prohibido subir carga. Se sugiere Drop del 5% (${drop5PctWeightKg} kg × ${safeReps} reps) o mantener ${safeWeight} kg bajando a ${reducedTargetReps} reps.`,
    };
  }

  // ==========================================================================
  // BLOQUE CONDICIONAL 2: SERIE COMPLETADA (OK) Y RPE >= 8.5 (CERCA DEL FALLO)
  // ==========================================================================
  if (
    Series_Completadas &&
    (RPE_Value === undefined || (typeof RPE_Value === 'number' && RPE_Value >= 8.5))
  ) {
    return {
      decision: 'HOLD_LOAD',
      suggestedWeightKg: safeWeight,
      suggestedReps: safeReps,
      drop5PctWeightKg,
      reducedTargetReps,
      deltaWeightKg: 0,
      explanation:
        typeof RPE_Value === 'number'
          ? `🛡️ Autorregulación RPE ${RPE_Value} (≥ 8.5): Prohibido subir peso. Se mantiene la carga en ${safeWeight} kg × ${safeReps} reps para evitar el colapso mecánico.`
          : `🛡️ Serie completada sin RPE declarado: Por seguridad se mantiene la carga en ${safeWeight} kg × ${safeReps} reps (registra RPE ≤ 8.0 para autorizar subida).`,
    };
  }

  // ==========================================================================
  // BLOQUE CONDICIONAL 3: SERIE COMPLETADA (OK) Y RPE <= 8.0 (RESERVA AMPLIA)
  // ==========================================================================
  const incrementKg = 2.5;
  const nextWeightKg = safeWeight > 0 ? safeWeight + incrementKg : 0;

  return {
    decision: 'INCREASE_LOAD',
    suggestedWeightKg: nextWeightKg,
    suggestedReps: safeReps,
    drop5PctWeightKg,
    reducedTargetReps,
    deltaWeightKg: incrementKg,
    explanation: `✅ Autorregulación RPE ${RPE_Value} (≤ 8.0): Reserva de fuerza confirmada (RIR ≥ 2). Se sugiere incrementar carga a ${nextWeightKg} kg (+${incrementKg} kg) manteniendo ${safeReps} reps.`,
  };
}

// ============================================================================
// MOTOR CENTRALIZADO: ÚLTIMA SESIÓN REAL + SUGERENCIA DE PROGRESIÓN PARA HOY
// ============================================================================

export type EquipmentClass =
  | 'assisted'
  | 'smith'
  | 'leg_press'
  | 'hack'
  | 'cable'
  | 'dumbbell'
  | 'kettlebell'
  | 'barbell'
  | 'band'
  | 'machine'
  | 'bodyweight';

export interface EquipmentVariantSignature {
  equipment: EquipmentClass | null;
  angle: 'incline' | 'decline' | 'flat' | null;
  posture: 'seated' | 'standing' | 'lying' | null;
  unilateral: boolean;
  grip: 'close' | 'wide' | 'neutral' | 'supine' | 'prone' | null;
}

function normalizeProgressionText(value?: string | null): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractEquipmentAndVariantSignature(
  exerciseName?: string | null,
  equipmentHint?: string | null
): EquipmentVariantSignature {
  const nameNorm = normalizeProgressionText(exerciseName);
  const eqNorm = normalizeProgressionText(equipmentHint);
  const combined = `${nameNorm} ${eqNorm}`.trim();

  let equipment: EquipmentClass | null = null;
  if (/\b(asistid[oa]?s?|assisted|graviton)\b/.test(combined)) {
    equipment = 'assisted';
  } else if (/\b(hack|jaca)\b/.test(combined)) {
    // If explicitly in smith/multipower machine and NOT "hack squat / smith" routine alternative
    if (/\b(smith|multipower)\b/.test(combined) && !/\bhack\s*(squat)?\s*\/\s*smith\b/.test(combined)) {
      equipment = 'smith';
    } else {
      equipment = 'hack';
    }
  } else if (/\b(smith|multipower)\b/.test(combined)) {
    equipment = 'smith';
  } else if (/\b(prensa|leg press)\b/.test(combined)) {
    equipment = 'leg_press';
  } else if (/\b(polea|cable|cuerda)\b/.test(combined)) {
    equipment = 'cable';
  } else if (/\b(mancuerna|mancuernas|dumbbell|dumbbells)\b/.test(combined)) {
    equipment = 'dumbbell';
  } else if (/\b(kettlebell|pesa rusa|pesas rusas)\b/.test(combined)) {
    equipment = 'kettlebell';
  } else if (/\b(banda|bandas|elastico|elasticos|band)\b/.test(combined)) {
    equipment = 'band';
  } else if (
    /\b(barra|barbell|barra z|barra ez|ez|olimpica|hexagonal|trap bar)\b/.test(combined) &&
    !/\b(dominada|dominadas|pull ?up|chin ?up|elevacion de piernas en barra|hanging)\b/.test(
      combined
    )
  ) {
    equipment = 'barbell';
  } else if (
    /\b(maquina|maquinas|machine|contractor|pec deck|hammer|palanca|rotatoria|extension de cuadriceps|curl femoral|leg extension|leg curl)\b/.test(
      combined
    )
  ) {
    equipment = 'machine';
  } else if (
    /\b(peso corporal|bodyweight|propio peso|dominada|dominadas|flexion|flexiones|push ?up|pull ?up|chin ?up|plancha|plank|crunch|abdominal|abdominales|burpee)\b/.test(
      combined
    )
  ) {
    equipment = 'bodyweight';
  }

  let angle: EquipmentVariantSignature['angle'] = null;
  if (/\b(inclinad[oa]?|incline)\b/.test(nameNorm)) angle = 'incline';
  else if (/\b(declinad[oa]?|decline)\b/.test(nameNorm)) angle = 'decline';
  else if (/\b(plan[oa]|banco plano|flat)\b/.test(nameNorm)) angle = 'flat';

  let posture: EquipmentVariantSignature['posture'] = null;
  if (/\b(sentad[oa]?|seated)\b/.test(nameNorm)) posture = 'seated';
  else if (/\b(de pie|standing)\b/.test(nameNorm)) posture = 'standing';
  else if (/\b(acostad[oa]?|tumbad[oa]?|decubito|lying)\b/.test(nameNorm)) posture = 'lying';

  const unilateral = /\b(unilateral|a una mano|una mano|a un brazo|un brazo|a una pierna|una pierna|single arm|single leg|one arm|one leg|alterno|alternado)\b/.test(
    nameNorm
  );

  let grip: EquipmentVariantSignature['grip'] = null;
  if (/\b(agarre cerrado|cerrado|estrecho|close grip)\b/.test(nameNorm)) grip = 'close';
  else if (/\b(agarre ancho|agarre amplio|ancho|amplio|abierto|wide grip)\b/.test(nameNorm)) grip = 'wide';
  else if (/\b(agarre neutro|neutro|martillo|hammer|neutral)\b/.test(nameNorm)) grip = 'neutral';
  else if (/\b(agarre supino|supino|supinacion|chin ?up|reverse grip)\b/.test(nameNorm))
    grip = 'supine';
  else if (/\b(agarre prono|prono|pronacion)\b/.test(nameNorm)) grip = 'prone';

  return { equipment, angle, posture, unilateral, grip };
}

export function areExerciseVariantsCompatible(
  sigA: EquipmentVariantSignature,
  sigB: EquipmentVariantSignature
): boolean {
  if (sigA.equipment && sigB.equipment && sigA.equipment !== sigB.equipment) {
    // La máquina Hack es biomecánicamente una máquina; permitir compatibilidad hack <-> machine
    const isHackMachineCombo =
      (sigA.equipment === 'hack' && sigB.equipment === 'machine') ||
      (sigA.equipment === 'machine' && sigB.equipment === 'hack');
    if (!isHackMachineCombo) {
      return false;
    }
  }
  if (sigA.angle && sigB.angle && sigA.angle !== sigB.angle) {
    return false;
  }
  if (sigA.posture && sigB.posture && sigA.posture !== sigB.posture) {
    return false;
  }
  if (sigA.unilateral !== sigB.unilateral) {
    return false;
  }
  if (sigA.grip && sigB.grip && sigA.grip !== sigB.grip) {
    return false;
  }
  return true;
}

export interface PreviousExerciseQuery {
  exerciseId?: string;
  originalExerciseId?: string;
  libraryExerciseId?: string;
  activeExerciseName: string;
  originalExerciseName?: string;
  equipment?: string;
  useAlternative?: boolean;
}

export interface MatchedPreviousExerciseSession {
  workoutId: string;
  date: string;
  timestamp: number;
  routineTitle: string;
  exerciseName: string;
  libraryExerciseId?: string;
  equipment?: string;
  setsCount: number;
  setsDetail: ExerciseSetSnapshot[];
  hasPerSetDetail: boolean;
  hasEffortData: boolean;
  maxWeight: number;
  maxReps: number;
  volumeKg: number;
  estimated1RM: number;
  avgRpe?: number;
}

function getWorkoutEffectiveTimestamp(workout: CompletedWorkout): number {
  const parsed = parseRobustDate(workout.date)?.getTime();
  if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0) return parsed;
  if (typeof workout.endTime === 'number' && workout.endTime > 0) return workout.endTime;
  if (typeof workout.startTime === 'number' && workout.startTime > 0) return workout.startTime;
  return 0;
}

function sanitizeSetSnapshot(
  raw: Partial<ExerciseSetSnapshot> | null | undefined,
  fallbackNumber: number
): ExerciseSetSnapshot | null {
  if (!raw) return null;
  const anyRaw = raw as any;
  if (anyRaw.completed === false && Number(anyRaw.weight ?? anyRaw.weightKg ?? 0) <= 0 && Number(anyRaw.reps ?? 0) <= 0) {
    return null;
  }
  const weightRaw = Number(raw.weight ?? anyRaw.weightKg ?? anyRaw.targetWeightKg ?? 0);
  const repsRaw = Number(raw.reps ?? anyRaw.targetReps ?? 0);
  const weight = Number.isFinite(weightRaw) && weightRaw >= 0 ? weightRaw : 0;
  const reps = Number.isFinite(repsRaw) && repsRaw >= 0 ? Math.round(repsRaw) : 0;
  if (reps <= 0 && weight <= 0) return null;

  const rpe =
    typeof raw.rpe === 'number' && Number.isFinite(raw.rpe) && raw.rpe > 0
      ? Number(raw.rpe)
      : typeof raw.rir === 'number' && Number.isFinite(raw.rir) && raw.rir >= 0
      ? Math.min(10, Math.max(5, Number((10 - raw.rir).toFixed(1))))
      : undefined;

  const rir =
    typeof raw.rir === 'number' && Number.isFinite(raw.rir) && raw.rir >= 0
      ? Number(raw.rir)
      : typeof rpe === 'number'
      ? Math.max(0, Number((10 - rpe).toFixed(1)))
      : undefined;

  const snap: ExerciseSetSnapshot = {
    setNumber:
      typeof raw.setNumber === 'number' && raw.setNumber > 0 ? raw.setNumber : fallbackNumber,
    weight,
    reps: reps > 0 ? reps : 1,
  };
  if (typeof rpe === 'number') snap.rpe = rpe;
  if (typeof rir === 'number') snap.rir = rir;
  return snap;
}

/**
 * Busca las sesiones finalizadas anteriores a la actual para el mismo atleta y ejercicio,
 * respetando IDs, aliases oficiales, equipo y variante, sin mezclar máquinas distintas
 * ni cargas del ejercicio original cuando fue sustituido.
 */
export function findPreviousExerciseSessions(params: {
  history: CompletedWorkout[];
  exercise: PreviousExerciseQuery;
  currentSessionId?: string;
  currentSessionStartTime?: number;
  activeProfileId?: string;
  limit?: number;
}): MatchedPreviousExerciseSession[] {
  const {
    history,
    exercise,
    currentSessionId,
    limit = 10,
  } = params;

  if (!Array.isArray(history) || history.length === 0 || !exercise.activeExerciseName?.trim()) {
    return [];
  }

  const activeNameNorm = normalizeExerciseName(exercise.activeExerciseName);
  const origNameNorm = normalizeExerciseName(exercise.originalExerciseName || '');
  const isCurrentSubstituted =
    Boolean(exercise.useAlternative) ||
    (Boolean(origNameNorm) && origNameNorm !== activeNameNorm);

  const currentLib = resolveLibraryExercise({
    libraryExerciseId: !isCurrentSubstituted ? exercise.libraryExerciseId : undefined,
    id: !isCurrentSubstituted ? exercise.exerciseId : undefined,
    name: exercise.activeExerciseName,
    equipment: exercise.equipment,
  });

  const currentCanonical = resolveCanonicalExerciseIdentity({
    exerciseId: !isCurrentSubstituted ? exercise.exerciseId : undefined,
    libraryExerciseId: !isCurrentSubstituted ? (exercise.libraryExerciseId || currentLib?.id) : currentLib?.id,
    name: exercise.activeExerciseName,
    equipment: exercise.equipment,
  });

  const currentSig = extractEquipmentAndVariantSignature(
    exercise.activeExerciseName,
    exercise.equipment || currentLib?.equipment
  );

  const sortedWorkouts = [...history].sort(
    (a, b) => getWorkoutEffectiveTimestamp(b) - getWorkoutEffectiveTimestamp(a)
  );

  const seenWorkoutIds = new Set<string>();
  const results: MatchedPreviousExerciseSession[] = [];

  for (const workout of sortedWorkouts) {
    if (!workout) continue;
    const anyWorkout = workout as any;
    if (anyWorkout.deleted === true || anyWorkout.isDeleted === true) continue;

    const rawExercisesList: any[] =
      Array.isArray(workout.exercisesSummary) && workout.exercisesSummary.length > 0
        ? workout.exercisesSummary
        : Array.isArray(anyWorkout.exercises)
          ? anyWorkout.exercises
          : [];

    const hasAnyCompletedSets =
      (typeof workout.completedSetsCount === 'number' && workout.completedSetsCount > 0) ||
      rawExercisesList.some((ex: any) => {
        if (!ex) return false;
        if (typeof ex.sets === 'number' && ex.sets > 0) return true;
        if (Array.isArray(ex.sets) && ex.sets.length > 0) return true;
        if (Array.isArray(ex.setsDetail) && ex.setsDetail.length > 0) return true;
        return false;
      });

    // Si explícitamente se marcó isFinished === false y no tiene ninguna serie completada, omitir borrador
    if (workout.isFinished === false && !hasAnyCompletedSets) continue;
    if (currentSessionId && workout.id === currentSessionId) continue;

    if (workout.id) {
      if (seenWorkoutIds.has(workout.id)) continue;
      seenWorkoutIds.add(workout.id);
    }

    const workoutTs = getWorkoutEffectiveTimestamp(workout);
    if (rawExercisesList.length === 0) {
      continue;
    }

    const match = rawExercisesList.find((histEx: any) => {
      if (!histEx) return false;
      const histExName = String(histEx.activeExerciseName || histEx.name || histEx.exerciseName || '').trim();
      const histSetsCount =
        typeof histEx.sets === 'number'
          ? histEx.sets
          : Array.isArray(histEx.setsDetail)
            ? histEx.setsDetail.length
            : Array.isArray(histEx.sets)
              ? histEx.sets.length
              : 0;

      if (!histExName || histSetsCount <= 0) return false;

      const histNameNorm = normalizeExerciseName(histExName);
      const histOrigNorm = normalizeExerciseName(histEx.originalExerciseName || '');
      const histWasSubstituted = Boolean(histOrigNorm) && histOrigNorm !== histNameNorm;

      const histLib = resolveLibraryExercise({
        libraryExerciseId: histEx.libraryExerciseId,
        id: !histWasSubstituted ? (histEx.exerciseId || histEx.id) : undefined,
        name: histExName,
        equipment: histEx.equipment,
      });

      const histCanonical = resolveCanonicalExerciseIdentity({
        exerciseId: !histWasSubstituted ? (histEx.exerciseId || histEx.id) : undefined,
        libraryExerciseId: histEx.libraryExerciseId || histLib?.id,
        name: histExName,
        equipment: histEx.equipment,
      });

      const histSig = extractEquipmentAndVariantSignature(
        histExName,
        histEx.equipment || histLib?.equipment
      );

      // 1. Nunca mezclar equipos o variantes biomecánicas distintas
      if (!areExerciseVariantsCompatible(currentSig, histSig)) {
        return false;
      }

      // 2. Coincidencia exacta por nombre normalizado
      if (histNameNorm === activeNameNorm) {
        return true;
      }

      // 3. Coincidencia oficial por ID / alias de biblioteca
      if (currentLib && histLib && currentLib.id === histLib.id) {
        return true;
      }

      // 4. Coincidencia por identidad canónica reconciliada (IDs antiguos, rutinas, aliases y Sentadilla Hack / Prensa 45° / etc.)
      if (
        currentCanonical.canonicalKey &&
        histCanonical.canonicalKey &&
        currentCanonical.canonicalKey === histCanonical.canonicalKey &&
        !currentCanonical.canonicalKey.startsWith('unknown_')
      ) {
        return true;
      }

      // 5. Coincidencia biomecánica inequívoca de Sentadilla Hack en máquina
      const isHackActive = activeNameNorm.includes('hack') || activeNameNorm.includes('jaca');
      const isHackHist = histNameNorm.includes('hack') || histNameNorm.includes('jaca');
      if (isHackActive && isHackHist) {
        const histIsBarbell = histSig.equipment === 'barbell' || histNameNorm.includes('barra');
        const activeIsBarbell = currentSig.equipment === 'barbell' || activeNameNorm.includes('barra');
        if (histIsBarbell === activeIsBarbell) {
          return true;
        }
      }

      // 6. Coincidencia por ID de ejercicio de rutina únicamente si ninguno fue sustituido
      //    o si ambos sustituyeron el mismo ejercicio de rutina
      const histExId = histEx.exerciseId || histEx.id;
      if (
        exercise.exerciseId &&
        histExId &&
        histExId === exercise.exerciseId
      ) {
        if (!isCurrentSubstituted && !histWasSubstituted) {
          if (currentLib && histLib && currentLib.id !== histLib.id) {
            return false;
          }
          return true;
        }
        if (isCurrentSubstituted && histWasSubstituted) {
          if (currentLib && histLib && currentLib.id === histLib.id) {
            return true;
          }
        }
      }

      return false;
    });

    if (!match) continue;

    const rawDetail = Array.isArray(match.setsDetail) && match.setsDetail.length > 0
      ? match.setsDetail
      : Array.isArray(match.sets)
        ? match.sets
        : [];
    const setsDetail = rawDetail
      .map((s: any, idx: number) => sanitizeSetSnapshot(s, idx + 1))
      .filter((s: ExerciseSetSnapshot | null): s is ExerciseSetSnapshot => s !== null);

    const hasPerSetDetail = setsDetail.length > 0;
    const hasEffortInDetail =
      hasPerSetDetail && setsDetail.every((s: ExerciseSetSnapshot) => typeof s.rpe === 'number' || typeof s.rir === 'number');
    const hasSummaryEffort = typeof match.rpe === 'number' && match.rpe > 0;
    const hasEffortData = hasPerSetDetail ? hasEffortInDetail : hasSummaryEffort;

    const maxWeight =
      hasPerSetDetail
        ? setsDetail.reduce((max: number, s: ExerciseSetSnapshot) => Math.max(max, s.weight), 0)
        : Math.max(0, Number(match.maxWeight ?? match.bestWeightKg ?? match.weightKg ?? match.weight) || 0);
    const maxReps =
      hasPerSetDetail
        ? setsDetail.reduce((max: number, s: ExerciseSetSnapshot) => Math.max(max, s.reps), 0)
        : Math.max(0, Number(match.maxReps ?? match.bestReps ?? match.reps) || 0);
    const setsCount = Math.max(
      1,
      setsDetail.length || (typeof match.sets === 'number' ? match.sets : 0) || 1
    );
    const volumeKg =
      typeof match.volumeKg === 'number' && match.volumeKg > 0
        ? Math.round(match.volumeKg)
        : hasPerSetDetail
        ? Math.round(setsDetail.reduce((sum: number, s: ExerciseSetSnapshot) => sum + s.weight * s.reps, 0))
        : Math.round(maxWeight * maxReps * setsCount);
    const estimated1RM =
      typeof match.estimated1RM === 'number' && match.estimated1RM > 0
        ? Math.round(match.estimated1RM * 10) / 10
        : maxWeight > 0 && maxReps > 0
        ? Math.round(maxWeight * (1 + maxReps / 30) * 10) / 10
        : 0;

    let avgRpe = hasSummaryEffort ? Number(match.rpe) : undefined;
    if (avgRpe === undefined && hasPerSetDetail) {
      const rpes = setsDetail
        .map((s: ExerciseSetSnapshot) => s.rpe)
        .filter((v: number | undefined): v is number => typeof v === 'number');
      if (rpes.length > 0) {
        avgRpe = Number((rpes.reduce((a: number, b: number) => a + b, 0) / rpes.length).toFixed(1));
      }
    }

    const matchedName = String(match.activeExerciseName || match.name || match.exerciseName || exercise.activeExerciseName);
    results.push({
      workoutId: workout.id,
      date: workout.date,
      timestamp: workoutTs,
      routineTitle: workout.routineTitle || 'Entrenamiento',
      exerciseName: matchedName,
      libraryExerciseId: match.libraryExerciseId || currentCanonical.libraryExerciseId,
      equipment: match.equipment || currentSig.equipment || undefined,
      setsCount,
      setsDetail,
      hasPerSetDetail,
      hasEffortData,
      maxWeight,
      maxReps,
      volumeKg,
      estimated1RM,
      avgRpe,
    });

    if (results.length >= limit) break;
  }

  return results;
}

export interface EquipmentIncrementSpec {
  stepKg: number;
  equipmentClass: EquipmentClass | 'time_based';
  equipmentLabel: string;
}

export function resolveEquipmentProgressionStep(
  exerciseName: string,
  equipmentHint?: string,
  referenceWeightKg?: number,
  repRangeStr?: string
): EquipmentIncrementSpec {
  const combined = normalizeProgressionText(`${exerciseName} ${equipmentHint || ''}`);
  const rangeNorm = normalizeProgressionText(repRangeStr);

  if (
    /\b(plancha|plank|isometrico|isometrica|wall sit|dead hang|farmer walk|paseo del granjero|aguante)\b/.test(
      combined
    ) ||
    /\b\d+\s*(seg|s|min)\b/.test(rangeNorm)
  ) {
    return {
      stepKg: 0,
      equipmentClass: 'time_based',
      equipmentLabel: 'Ejercicio por tiempo / isométrico',
    };
  }

  const sig = extractEquipmentAndVariantSignature(exerciseName, equipmentHint);
  const w = referenceWeightKg || 0;

  switch (sig.equipment) {
    case 'assisted':
      return {
        stepKg: 0,
        equipmentClass: 'assisted',
        equipmentLabel: 'Máquina asistida (contrapeso)',
      };
    case 'bodyweight':
      if (w > 0) {
        return {
          stepKg: 2.5,
          equipmentClass: 'barbell',
          equipmentLabel: 'Lastre adicional (+2.5 kg)',
        };
      }
      return {
        stepKg: 0,
        equipmentClass: 'bodyweight',
        equipmentLabel: 'Peso corporal',
      };
    case 'leg_press':
    case 'hack':
      return {
        stepKg: 5,
        equipmentClass: sig.equipment,
        equipmentLabel:
          sig.equipment === 'leg_press'
            ? 'Prensa (+5 kg · 2×2.5 kg)'
            : 'Hack / Carro (+5 kg · 2×2.5 kg)',
      };
    case 'dumbbell': {
      const step = w > 0 && w < 10 ? 1 : 2;
      return {
        stepKg: step,
        equipmentClass: 'dumbbell',
        equipmentLabel: `Mancuernas (+${step} kg)`,
      };
    }
    case 'kettlebell':
      return {
        stepKg: 2,
        equipmentClass: 'kettlebell',
        equipmentLabel: 'Kettlebell (+2 kg)',
      };
    case 'cable':
      return {
        stepKg: 2.5,
        equipmentClass: 'cable',
        equipmentLabel: 'Polea / Cable (+2.5 kg)',
      };
    case 'smith':
      return {
        stepKg: 2.5,
        equipmentClass: 'smith',
        equipmentLabel: 'Multipower / Smith (+2.5 kg)',
      };
    case 'machine':
      return {
        stepKg: 2.5,
        equipmentClass: 'machine',
        equipmentLabel: 'Máquina de placas (+2.5 kg)',
      };
    case 'band':
      return {
        stepKg: 0,
        equipmentClass: 'band',
        equipmentLabel: 'Banda elástica',
      };
    case 'barbell':
    default:
      return {
        stepKg: 2.5,
        equipmentClass: 'barbell',
        equipmentLabel: 'Barra (+2.5 kg · 2×1.25 kg)',
      };
  }
}

export type ProgressionObjectiveMode =
  | 'strength'
  | 'hypertrophy'
  | 'incompatible_power'
  | 'incompatible_endurance'
  | 'incompatible_time'
  | 'incompatible_bodyweight'
  | 'incompatible_assisted'
  | 'incompatible_band';

export interface ProgressionObjectiveContext {
  mode: ProgressionObjectiveMode;
  compatibleWithWeightOverload: boolean;
  objectiveLabel: string;
  incompatibilityReason?: string;
  maxRpeForIncrease: number;
}

export function resolveProgressionObjectiveContext(params: {
  routineModality?: string;
  exerciseObjective?: string;
  equipmentSpec: EquipmentIncrementSpec;
}): ProgressionObjectiveContext {
  const { routineModality, exerciseObjective, equipmentSpec } = params;

  if (equipmentSpec.equipmentClass === 'time_based') {
    return {
      mode: 'incompatible_time',
      compatibleWithWeightOverload: false,
      objectiveLabel: 'Tiempo / Isometría',
      incompatibilityReason:
        'Ejercicio por tiempo: la regla automática de incremento en kg no aplica; prioriza duración y control postural.',
      maxRpeForIncrease: 8.0,
    };
  }
  if (equipmentSpec.equipmentClass === 'assisted') {
    return {
      mode: 'incompatible_assisted',
      compatibleWithWeightOverload: false,
      objectiveLabel: 'Máquina asistida',
      incompatibilityReason:
        'Máquina asistida (contrapeso): subir kilos facilita el ejercicio. Ajusta la asistencia manualmente.',
      maxRpeForIncrease: 8.0,
    };
  }
  if (equipmentSpec.equipmentClass === 'bodyweight') {
    return {
      mode: 'incompatible_bodyweight',
      compatibleWithWeightOverload: false,
      objectiveLabel: 'Peso corporal',
      incompatibilityReason:
        'Peso corporal sin lastre registrado: suma repeticiones limpias o tempo controlado antes de añadir carga.',
      maxRpeForIncrease: 8.0,
    };
  }
  if (equipmentSpec.equipmentClass === 'band') {
    return {
      mode: 'incompatible_band',
      compatibleWithWeightOverload: false,
      objectiveLabel: 'Banda elástica',
      incompatibilityReason:
        'Resistencia con banda elástica: progresa por tensión de banda o repeticiones sin incremento automático en kg.',
      maxRpeForIncrease: 8.0,
    };
  }

  const combinedObj = normalizeProgressionText(`${routineModality || ''} ${exerciseObjective || ''}`);

  if (/\b(potencia|explosiv|velocidad|rfd|pliometr)\b/.test(combinedObj)) {
    return {
      mode: 'incompatible_power',
      compatibleWithWeightOverload: false,
      objectiveLabel: 'Potencia / Explosividad',
      incompatibilityReason:
        'Objetivo de potencia: se prioriza velocidad concéntrica (50–70% 1RM); no se sugiere subir carga por techo de repeticiones.',
      maxRpeForIncrease: 7.5,
    };
  }

  if (/\b(resistencia|cardio|metabol|acondicionamiento|lactic)\b/.test(combinedObj)) {
    return {
      mode: 'incompatible_endurance',
      compatibleWithWeightOverload: false,
      objectiveLabel: 'Resistencia muscular',
      incompatibilityReason:
        'Objetivo de resistencia metabólica: prioriza densidad, repeticiones altas o descansos cortos antes que subir kilos.',
      maxRpeForIncrease: 8.0,
    };
  }

  if (/\b(fuerza maxima|fuerza pura|fuerza|strength|1rm|powerlift)\b/.test(combinedObj) && !/hipertrofia|masa/.test(combinedObj)) {
    return {
      mode: 'strength',
      compatibleWithWeightOverload: true,
      objectiveLabel: 'Fuerza máxima',
      maxRpeForIncrease: 8.5,
    };
  }

  if (/\b(definicion|deficit)\b/.test(combinedObj)) {
    return {
      mode: 'hypertrophy',
      compatibleWithWeightOverload: true,
      objectiveLabel: 'Definición (conservadora)',
      maxRpeForIncrease: 8.0,
    };
  }

  return {
    mode: 'hypertrophy',
    compatibleWithWeightOverload: true,
    objectiveLabel: exerciseObjective?.trim() || 'Hipertrofia',
    maxRpeForIncrease: 8.0,
  };
}

export type SessionProgressionStatus =
  | 'first_session'
  | 'increase_load'
  | 'hold_improve_reps'
  | 'review_load'
  | 'incomplete_data'
  | 'incompatible_objective';

export interface SessionProgressionRecommendation {
  status: SessionProgressionStatus;
  badgeText: string;
  summaryLine: string;
  detailReason: string;
  suggestedWeightKg: number | null;
  suggestedReps: number | null;
  suggestedRepsPattern?: string;
  incrementKg: number;
  equipmentLabel: string;
  objectiveLabel: string;
  targetMinReps: number;
  targetMaxReps: number;
  canApplySuggestion: boolean;
}

function roundToStep(value: number, step: number): number {
  if (value <= 0) return 0;
  if (step <= 0) return Math.round(value * 2) / 2;
  return Number((Math.round(value / step) * step).toFixed(2));
}

export function formatPreviousSessionSummary(session: MatchedPreviousExerciseSession): string {
  if (session.hasPerSetDetail && session.setsDetail.length > 0) {
    const weights = session.setsDetail.map((s) => s.weight);
    const uniformWeight = weights.every((w) => w === weights[0]);
    const repsPattern = session.setsDetail.map((s) => s.reps).join('/');
    const rpeValues = session.setsDetail
      .map((s) => s.rpe)
      .filter((v): v is number => typeof v === 'number');

    const baseText = uniformWeight
      ? `${weights[0]} kg · ${repsPattern}`
      : session.setsDetail.map((s) => `${s.weight}×${s.reps}`).join(' · ');

    if (rpeValues.length > 0) {
      const allSameRpe = rpeValues.every((r) => r === rpeValues[0]);
      if (allSameRpe) {
        const rirVal = Math.max(0, Number((10 - rpeValues[0]).toFixed(1)));
        return `${baseText} (@${rpeValues[0]} · ${rirVal} RIR)`;
      }
      return `${baseText} (${rpeValues.map((r) => `@${r}`).join('/')})`;
    }
    return baseText;
  }

  const base =
    session.maxWeight > 0
      ? `${session.maxWeight} kg × ${session.maxReps} reps (${session.setsCount}s)`
      : `${session.maxReps} reps (${session.setsCount}s)`;
  if (typeof session.avgRpe === 'number' && session.avgRpe > 0) {
    const rirVal = Math.max(0, Number((10 - session.avgRpe).toFixed(1)));
    return `${base} (@${session.avgRpe} · ${rirVal} RIR)`;
  }
  return base;
}

/**
 * Evalúa la última sesión finalizada del ejercicio y genera una sugerencia opcional,
 * prudente y explicada para la sesión de hoy, respetando rango, RPE/RIR, equipo y objetivo.
 */
export function evaluateNextSessionProgression(params: {
  previousSession: MatchedPreviousExerciseSession | null;
  exerciseName: string;
  equipmentHint?: string;
  repRangeStr?: string;
  targetSetsCount: number;
  routineModality?: string;
  exerciseObjective?: string;
}): SessionProgressionRecommendation {
  const {
    previousSession,
    exerciseName,
    equipmentHint,
    repRangeStr,
    targetSetsCount,
    routineModality,
    exerciseObjective,
  } = params;

  const isStrengthModality =
    routineModality === 'fuerza_maxima' ||
    routineModality === 'fuerza' ||
    /\bfuerza\b/i.test(exerciseObjective || '');

  const rawRange = parseRepRange(repRangeStr);
  const safeRangeStr =
    isStrengthModality && !isIsolationExercise(exerciseName) && rawRange.maxReps <= 6
      ? `${rawRange.minReps} a ${rawRange.maxReps} reps`
      : sanitizeExerciseRepRange(exerciseName, repRangeStr, routineModality);
  const { minReps, maxReps } = parseRepRange(safeRangeStr);

  const equipmentSpec = resolveEquipmentProgressionStep(
    exerciseName,
    equipmentHint || previousSession?.equipment,
    previousSession?.maxWeight,
    repRangeStr
  );

  const objectiveCtx = resolveProgressionObjectiveContext({
    routineModality,
    exerciseObjective,
    equipmentSpec,
  });

  // 1. Primera sesión (sin historial previo)
  if (!previousSession) {
    return {
      status: 'first_session',
      badgeText: 'Primera sesión',
      summaryLine: 'Primera sesión: registra tu carga inicial.',
      detailReason:
        'Aún no hay una sesión finalizada anterior para esta variante y equipo. Registra peso, repeticiones y RPE/RIR para crear tu referencia.',
      suggestedWeightKg: null,
      suggestedReps: null,
      incrementKg: 0,
      equipmentLabel: equipmentSpec.equipmentLabel,
      objectiveLabel: objectiveCtx.objectiveLabel,
      targetMinReps: minReps,
      targetMaxReps: maxReps,
      canApplySuggestion: false,
    };
  }

  const prevSummaryText = formatPreviousSessionSummary(previousSession);

  // 2. Objetivo o tipo de ejercicio incompatible con la regla de incremento de kg
  if (!objectiveCtx.compatibleWithWeightOverload) {
    return {
      status: 'incompatible_objective',
      badgeText: objectiveCtx.objectiveLabel,
      summaryLine: `Anterior: ${prevSummaryText}. Objetivo ${objectiveCtx.objectiveLabel}: consulta tu marca sin incremento automático.`,
      detailReason: objectiveCtx.incompatibilityReason || 'Objetivo no compatible con incremento automático en kg.',
      suggestedWeightKg: null,
      suggestedReps: null,
      incrementKg: 0,
      equipmentLabel: equipmentSpec.equipmentLabel,
      objectiveLabel: objectiveCtx.objectiveLabel,
      targetMinReps: minReps,
      targetMaxReps: maxReps,
      canApplySuggestion: false,
    };
  }

  // 3. Historial incompleto (sin detalle por serie, sin peso positivo, o menos series registradas que las planificadas)
  const expectedMinSets = Math.max(1, Math.min(targetSetsCount || 1, 6));
  if (
    !previousSession.hasPerSetDetail ||
    previousSession.setsDetail.length === 0 ||
    previousSession.setsDetail.some((s) => s.weight <= 0 || s.reps <= 0) ||
    previousSession.setsDetail.length < expectedMinSets
  ) {
    const missingDetailCause = !previousSession.hasPerSetDetail
      ? 'La sesión anterior solo guarda resumen agregado sin repeticiones por serie.'
      : previousSession.setsDetail.length < expectedMinSets
      ? `Solo hay ${previousSession.setsDetail.length} de ${expectedMinSets} series registradas en la sesión anterior.`
      : 'Falta peso o repeticiones válidas en alguna serie anterior.';

    return {
      status: 'incomplete_data',
      badgeText: 'Registrar referencia',
      summaryLine: `Anterior: ${prevSummaryText}. Hoy: registra todas las series y tu esfuerzo como referencia.`,
      detailReason: `${missingDetailCause} No se asume incremento ni esfuerzo sin datos completos.`,
      suggestedWeightKg: null,
      suggestedReps: null,
      incrementKg: 0,
      equipmentLabel: equipmentSpec.equipmentLabel,
      objectiveLabel: objectiveCtx.objectiveLabel,
      targetMinReps: minReps,
      targetMaxReps: maxReps,
      canApplySuggestion: false,
    };
  }

  const sets = previousSession.setsDetail;
  const workingWeight = Math.max(...sets.map((s) => s.weight));
  const minRepsDone = Math.min(...sets.map((s) => s.reps));
  const allSetsSameWeight = sets.every((s) => s.weight === workingWeight);
  const allSetsHitCeiling = sets.every((s) => s.reps >= maxReps);
  const anyBelowMin = sets.some((s) => s.reps < minReps);

  const recordedRpes = sets
    .map((s) => s.rpe)
    .filter((v): v is number => typeof v === 'number');
  const maxRpe = recordedRpes.length > 0 ? Math.max(...recordedRpes) : undefined;
  const allSetsHaveEffort = recordedRpes.length === sets.length;

  // 4. Por debajo del mínimo del rango O esfuerzo excesivo (RPE >= 9.5 / RIR <= 0.5)
  if (anyBelowMin || (typeof maxRpe === 'number' && maxRpe >= 9.5)) {
    const step = equipmentSpec.stepKg > 0 ? equipmentSpec.stepKg : 2.5;
    const adjustedWeight =
      workingWeight > step
        ? Math.max(step, roundToStep(workingWeight - step, step))
        : workingWeight;
    const causeText =
      anyBelowMin && typeof maxRpe === 'number' && maxRpe >= 9.5
        ? `quedaste debajo del mínimo (${minReps} reps) con esfuerzo máximo (@${maxRpe})`
        : anyBelowMin
        ? `alguna serie quedó debajo del mínimo objetivo (${minReps}–${maxReps} reps)`
        : typeof maxRpe === 'number'
        ? `esfuerzo excesivo registrado (@${maxRpe} · ${Math.max(0, Number((10 - maxRpe).toFixed(1)))} RIR)`
        : 'esfuerzo excesivo registrado';

    return {
      status: 'review_load',
      badgeText: 'Revisar carga',
      summaryLine: `Anterior: ${prevSummaryText}. Hoy: revisar carga (mantener ${workingWeight} kg o ajustar a ${adjustedWeight} kg).`,
      detailReason: `En la última sesión ${causeText}. Se sugiere revisar la carga para recuperar técnica y entrar en el rango ${minReps}–${maxReps}.`,
      suggestedWeightKg: adjustedWeight,
      suggestedReps: minReps,
      incrementKg: Number((adjustedWeight - workingWeight).toFixed(2)),
      equipmentLabel: equipmentSpec.equipmentLabel,
      objectiveLabel: objectiveCtx.objectiveLabel,
      targetMinReps: minReps,
      targetMaxReps: maxReps,
      canApplySuggestion: true,
    };
  }

  // 5. Todas las series en el máximo del rango Y margen de esfuerzo suficiente registrado
  if (allSetsHitCeiling && allSetsSameWeight) {
    if (!allSetsHaveEffort || typeof maxRpe !== 'number') {
      return {
        status: 'incomplete_data',
        badgeText: 'Falta RPE / RIR',
        summaryLine: `Anterior: ${prevSummaryText}. Hoy: mantener ${workingWeight} kg y registrar RPE/RIR para validar subida.`,
        detailReason: `Completaste ${maxReps} reps en todas las series, pero falta registrar RPE/RIR en cada serie. No se recomienda subir peso sin conocer el margen de esfuerzo.`,
        suggestedWeightKg: workingWeight,
        suggestedReps: maxReps,
        suggestedRepsPattern: sets.map(() => maxReps).join('/'),
        incrementKg: 0,
        equipmentLabel: equipmentSpec.equipmentLabel,
        objectiveLabel: objectiveCtx.objectiveLabel,
        targetMinReps: minReps,
        targetMaxReps: maxReps,
        canApplySuggestion: true,
      };
    }

    if (maxRpe <= objectiveCtx.maxRpeForIncrease && equipmentSpec.stepKg > 0) {
      const nextWeight = roundToStep(workingWeight + equipmentSpec.stepKg, equipmentSpec.stepKg);
      const rirReserve = Math.max(0, Number((10 - maxRpe).toFixed(1)));
      return {
        status: 'increase_load',
        badgeText: `+${equipmentSpec.stepKg} kg disponible`,
        summaryLine: `Anterior: ${prevSummaryText}. Hoy: subir a ${nextWeight} kg (+${equipmentSpec.stepKg} kg) e intentar ${minReps}–${maxReps} reps.`,
        detailReason: `Todas las series completaron ${maxReps} reps con margen suficiente (@${maxRpe} · ${rirReserve} RIR). Menor incremento para ${equipmentSpec.equipmentLabel.toLowerCase()}.`,
        suggestedWeightKg: nextWeight,
        suggestedReps: minReps,
        suggestedRepsPattern: sets.map(() => minReps).join('/'),
        incrementKg: equipmentSpec.stepKg,
        equipmentLabel: equipmentSpec.equipmentLabel,
        objectiveLabel: objectiveCtx.objectiveLabel,
        targetMinReps: minReps,
        targetMaxReps: maxReps,
        canApplySuggestion: true,
      };
    }

    // Techo completado pero margen justo (RPE 8.5–9.0) -> mantener carga para consolidar reserva
    return {
      status: 'hold_improve_reps',
      badgeText: 'Consolidar carga',
      summaryLine: `Anterior: ${prevSummaryText}. Hoy: mantener ${workingWeight} kg y consolidar con menor esfuerzo.`,
      detailReason: `Completaste ${maxReps} reps con RPE @${maxRpe} (reserva ajustada). Mantén ${workingWeight} kg hasta cerrar las series con ≥ 2 RIR.`,
      suggestedWeightKg: workingWeight,
      suggestedReps: maxReps,
      suggestedRepsPattern: sets.map(() => maxReps).join('/'),
      incrementKg: 0,
      equipmentLabel: equipmentSpec.equipmentLabel,
      objectiveLabel: objectiveCtx.objectiveLabel,
      targetMinReps: minReps,
      targetMaxReps: maxReps,
      canApplySuggestion: true,
    };
  }

  // 6. Dentro del rango sin completarlo en todas las series (o pesos distintos) -> mantener carga y mejorar repeticiones
  const nextPatternArr = sets.map((s) =>
    s.reps < maxReps ? Math.min(maxReps, s.reps + 1) : maxReps
  );
  const nextPatternText = nextPatternArr.join('/');
  const nextTargetRep = Math.min(maxReps, Math.max(minReps, minRepsDone + 1));

  return {
    status: 'hold_improve_reps',
    badgeText: 'Mantener carga · +reps',
    summaryLine: `Anterior: ${prevSummaryText}. Hoy: mantener ${workingWeight} kg e intentar ${nextPatternText}.`,
    detailReason: `Estuviste dentro del rango ${minReps}–${maxReps} reps sin completarlo en todas las series. Mantén ${workingWeight} kg e intenta sumar repeticiones.`,
    suggestedWeightKg: workingWeight,
    suggestedReps: nextTargetRep,
    suggestedRepsPattern: nextPatternText,
    incrementKg: 0,
    equipmentLabel: equipmentSpec.equipmentLabel,
    objectiveLabel: objectiveCtx.objectiveLabel,
    targetMinReps: minReps,
    targetMaxReps: maxReps,
    canApplySuggestion: true,
  };
}


