import type {
  CoachQuickIntent, CoachRoutineResolution, CoachExerciseLoadReport,
  CoachAlternativeOption,
} from './coachContextEngine.ts';

/** Resolve the topic of a typed message independently of the selected quick action. */
export function resolveCoachLocalIntent(message: string): CoachQuickIntent {
  const text = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\b(alternativas?|reemplaz\w*|sustitu\w*|sustituc\w*|ocupad[ao])\b/.test(text)) {
    return 'replace_exercise';
  }
  if (/\b(ultimo|ultima|anterior|pasad[ao]|levante|cargue|use|registre)\b/.test(text) &&
      /\b(peso|kilos?|kg|cargas?|series?|rep(?:eticiones)?|levante|cargue)\b/.test(text)) {
    return 'last_weight';
  }
  if (/\b(hoy|ahora)\b/.test(text) &&
      /\b(rutina|entren\w*|ejercicios?|toca|hago)\b/.test(text)) {
    return 'today_workout';
  }
  return 'freeform';
}

/**
 * A strictly deterministic LOCAL summary for when online Gemini is unavailable.
 * This is not an LLM reply and does not change athlete data or routine state.
 * Every number and exercise name comes only from the already-authorized UI data.
 */
export function buildCoachLocalFallback(params: {
  intent: CoachQuickIntent;
  resolution: CoachRoutineResolution;
  loadReport: CoachExerciseLoadReport | null;
  alternatives: CoachAlternativeOption[];
}): string | null {
  const { intent, resolution, loadReport, alternatives } = params;
  const prefix = '📋 RESUMEN LOCAL (sin Gemini): ';
  if (intent === 'today_workout') {
    if (!resolution.hasRoutines) {
      return prefix + 'No tienes una rutina programada cargada en este momento. Abre Rutinas para elegir o crear una.';
    }
    if (resolution.isRestDayFallback && !resolution.hasActiveSession) {
      return prefix + `Hoy (${resolution.todayDayName}) no hay entrenamiento asignado en tu calendario. Puedes consultar la rutina seleccionada como referencia, pero no la consideraré programada para hoy.`;
    }
    if (!resolution.selectedRoutine) {
      return prefix + 'No se pudo determinar una rutina para hoy.';
    }
    const title = resolution.activeSessionTitle || resolution.selectedRoutine.title;
    const exercises = resolution.exercises.slice(0, 8).map((ex, i) => {
      const rep = ex.repRange || 'rango sin especificar';
      return `${i + 1}. ${ex.name}: ${ex.defaultSets} series × ${rep}`;
    });
    return [
      prefix + `Según la planificación de ${resolution.todayDayName}, tu sesión de referencia es «${title}».`,
      ...exercises,
      'Estos son los ejercicios programados, no una sesión que ya hayas completado. Consulta tu recuperación y adapta cargas solo a tus registros reales.',
    ].join('\n');
  }

  if (intent === 'last_weight') {
    if (!loadReport) return prefix + 'Selecciona un ejercicio para revisar su último registro.';
    if (!loadReport.hasRegisteredSets) {
      return prefix + `Todavía no tienes series registradas para «${loadReport.exerciseName}».`;
    }
    const date = loadReport.lastSessionDate ? ` (${loadReport.lastSessionDate})` : '';
    const sets = loadReport.liftedSets.slice(0, 6);
    const summary = sets.length
      ? sets.map(s => `${s.weight} kg × ${s.reps} rep`).join(', ')
      : loadReport.liftedFallbackSummary || 'No existe desglose de series.';
    return prefix + `Último registro de «${loadReport.exerciseName}»${date}: ${summary}. Solo son cargas realmente registradas.`;
  }

  if (intent === 'replace_exercise') {
    const first = alternatives[0];
    if (!first) return prefix + 'No encuentro una alternativa validada en tu catálogo para el ejercicio seleccionado.';
    return prefix + `Alternativa del catálogo: ${first.name} (${first.muscleGroup}, ${first.equipment}). Sugerencia sin aplicar; confirma manualmente si deseas cambiar el ejercicio y no copies pesos de otra máquina.`;
  }

  // Free-form questions require a real model; never pretend an LLM answered.
  return null;
}
