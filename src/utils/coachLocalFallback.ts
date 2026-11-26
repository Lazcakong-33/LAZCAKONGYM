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

/** An unavailable provider is not permission to bypass authentication. */
export function canUseCoachLocalFallback(status: number, code?: string): boolean {
  if ([401, 403, 409].includes(status)) return false;
  if (code && /auth|session|token|forbidden|aborted|permission/i.test(code)) return false;
  return status === 404 || status === 429 || status >= 500 ||
    (status === 0 && code === 'coach/network-error') || code === 'coach/empty-response';
}

/** Bounded offline educational answers, not generated or personalized prescriptions. */
export function buildCoachGeneralGuidance(message: string): string | null {
  const t=message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const prefix='Orientación general local (sin IA en línea): ';
  if (/\b(dolor|lesion|mareo|desmayo|cirugia|fractura|medicamento)\b/.test(t)) {
    return prefix+'No puedo evaluar una lesión o autorizar entrenamiento con síntomas. Si hay dolor agudo o creciente, detén el ejercicio y consulta a un profesional. Si hay síntomas graves, busca atención urgente.';
  }
  // Never guess personal metrics, specific loads, meals or a medical prescription.
  if (/\b(mi|mis|mio|mia|cuanto|cuanta|cuantos|cuantas|debo|necesito)\b/.test(t) &&
      /\b(kg|kilos|peso|calorias|proteina|dosis|carga|series|repeticiones)\b/.test(t)) return null;
  if (/\b(hipertrofia|musculo|masa muscular|ganar masa)\b/.test(t)) return prefix+'Para hipertrofia, prioriza técnica estable, series exigentes sin perder el control y progresión gradual. Registra cargas y repeticiones; cuando alcances el extremo superior de tu rango con buena técnica, considera aumentar ligeramente la carga. Alterna estímulo y recuperación; no necesitas llegar al fallo en todas las series.';
  if (/\b(recuperacion|descarga|fatiga|descanso|dormir|sueno)\b/.test(t)) return prefix+'La recuperación depende del esfuerzo, sueño, alimentación y descanso. Si cae el rendimiento durante varias sesiones o aumenta la fatiga, reduce temporalmente el volumen o intensidad. La estimación de recuperación de la app no sustituye cómo te sientes.';
  if (/\b(progresion|progresar|fuerza|sobrecarga)\b/.test(t)) return prefix+'Aumenta de forma gradual una variable: repeticiones, carga o calidad del movimiento. Compara sesiones del mismo ejercicio y equipo; no extrapoles pesos entre máquinas. Mantén margen de esfuerzo si la técnica empeora.';
  if (/\b(calentamiento|calentar|movilidad|tecnica)\b/.test(t)) return prefix+'Empieza con movilidad y actividad suave, luego realiza series progresivas del ejercicio con cargas menores antes de las series de trabajo. Evita fatigar el músculo durante el calentamiento y respeta tu rango de movimiento cómodo.';
  if (/\b(nutricion|alimentacion|proteinas?|creatina|grasa|deficit)\b/.test(t)) return prefix+'Para apoyar el entrenamiento, procura una alimentación suficiente y variada, proteína repartida en tus comidas, hidratación y sueño. Para disminuir grasa sin perder rendimiento, evita restricciones extremas. Las cantidades y suplementos dependen de tus circunstancias; para una pauta personal consulta a un profesional.';
  if (/\b(cardio|resistencia|acondicionamiento)\b/.test(t)) return prefix+'Combina sesiones de fuerza con cardio ajustado a tu recuperación. Aumenta duración o intensidad gradualmente y evita que el cardio exigente comprometa la calidad de tus sesiones prioritarias.';
  return null;
}
