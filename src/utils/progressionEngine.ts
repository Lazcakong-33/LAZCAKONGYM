import { LoggedSet } from '../types';

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
      badgeColorClass: 'text-[#CCFF00] bg-[#CCFF00]/10 border-[#CCFF00]/50 shadow-sm shadow-[#CCFF00]/10',
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

