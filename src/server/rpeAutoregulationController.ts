import type { Request, Response } from 'express';

export interface RpeAutoregulationRequest {
  Series_Completadas: boolean;
  Peso_Actual: number;
  Reps: number;
  RPE_Value?: number;
  preferDropOnFailure?: boolean;
}

export interface RpeAutoregulationResponse {
  success: boolean;
  decision: 'INCREASE_LOAD' | 'HOLD_LOAD' | 'FAILURE_DROP_OR_REPS' | 'INCOMPLETE_SET';
  suggestedWeightKg: number;
  suggestedReps: number;
  drop5PctWeightKg: number;
  reducedTargetReps: number;
  deltaWeightKg: number;
  explanation: string;
}

/**
 * Controlador Backend de Autorregulación por RPE (LAZCAKONGYM)
 * Cruza en milisegundos las variables: Series_Completadas, Peso_Actual, Reps y RPE_Value.
 */
export function evaluateRpeAutoregulationOnServer(
  input: RpeAutoregulationRequest
): RpeAutoregulationResponse {
  const Series_Completadas = Boolean(input.Series_Completadas);
  const Peso_Actual = typeof input.Peso_Actual === 'number' && input.Peso_Actual > 0 ? input.Peso_Actual : 0;
  const Reps = typeof input.Reps === 'number' && input.Reps > 0 ? Math.round(input.Reps) : 10;
  const RPE_Value = typeof input.RPE_Value === 'number' ? input.RPE_Value : undefined;
  const preferDropOnFailure = input.preferDropOnFailure !== false;

  // Cálculo del Drop del 5% y de la reducción de repeticiones (-2 reps) para casos de fallo
  const drop5PctWeightKg =
    Peso_Actual > 0 ? Math.max(2.5, Math.round(Peso_Actual * 0.95 * 2) / 2) : 0;
  const reducedTargetReps = Math.max(1, Reps - 2);

  // 1. Si la serie aún no ha sido marcada como completada (OK) y no es fallo RPE 10
  if (!Series_Completadas && (RPE_Value === undefined || RPE_Value < 10)) {
    return {
      success: true,
      decision: 'INCOMPLETE_SET',
      suggestedWeightKg: Peso_Actual,
      suggestedReps: Reps,
      drop5PctWeightKg,
      reducedTargetReps,
      deltaWeightKg: 0,
      explanation: 'Serie aún no marcada como completada.',
    };
  }

  // 2. CONDICIONAL A: RPE === 10 (Fallo muscular total / RIR 0)
  if (RPE_Value !== undefined && RPE_Value >= 10) {
    const suggestedWeightKg = preferDropOnFailure ? drop5PctWeightKg : Peso_Actual;
    const suggestedReps = preferDropOnFailure ? Reps : reducedTargetReps;

    return {
      success: true,
      decision: 'FAILURE_DROP_OR_REPS',
      suggestedWeightKg,
      suggestedReps,
      drop5PctWeightKg,
      reducedTargetReps,
      deltaWeightKg: Number((suggestedWeightKg - Peso_Actual).toFixed(2)),
      explanation: `RPE 10 (Fallo Total): Prohibido subir peso. Se sugiere Drop del 5% (${drop5PctWeightKg} kg × ${Reps} reps) o mantener ${Peso_Actual} kg reduciendo el objetivo a ${reducedTargetReps} reps.`,
    };
  }

  // 3. CONDICIONAL B: Serie Completada (OK) Y RPE >= 8.5 (Cerca del fallo mecánico)
  if (Series_Completadas && (RPE_Value === undefined || RPE_Value >= 8.5)) {
    return {
      success: true,
      decision: 'HOLD_LOAD',
      suggestedWeightKg: Peso_Actual,
      suggestedReps: Reps,
      drop5PctWeightKg,
      reducedTargetReps,
      deltaWeightKg: 0,
      explanation:
        RPE_Value !== undefined
          ? `RPE ${RPE_Value} (≥ 8.5): Prohibido solicitar aumento de peso. Se mantiene el mismo peso (${Peso_Actual} kg) y objetivo (${Reps} reps) para proteger al atleta.`
          : `Serie completada sin RPE: Se mantiene el mismo peso (${Peso_Actual} kg × ${Reps} reps) por seguridad biomecánica.`,
    };
  }

  // 4. CONDICIONAL C: Serie Completada (OK) Y RPE <= 8.0 (Reserva de fuerza confirmada)
  const incrementKg = 2.5;
  const nextWeightKg = Peso_Actual > 0 ? Peso_Actual + incrementKg : 0;

  return {
    success: true,
    decision: 'INCREASE_LOAD',
    suggestedWeightKg: nextWeightKg,
    suggestedReps: Reps,
    drop5PctWeightKg,
    reducedTargetReps,
    deltaWeightKg: incrementKg,
    explanation: `RPE ${RPE_Value} (≤ 8.0): Reserva amplia confirmada. Se sugiere incrementar la carga a ${nextWeightKg} kg (+${incrementKg} kg) manteniendo ${Reps} reps.`,
  };
}

export async function handleAutoregulateSet(req: Request, res: Response): Promise<void> {
  try {
    const result = evaluateRpeAutoregulationOnServer(req.body || {});
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message || 'Error en el motor de autorregulación por RPE',
    });
  }
}
