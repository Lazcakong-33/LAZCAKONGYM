import {
  ActiveWorkoutSession,
  CoachPlatformStorageAdapter,
  CoachPlatformVoiceAdapter,
  CoachVoiceMode,
  Routine,
} from '../types/index.ts';
import {
  CoachAlternativeOption,
  CoachReplacementScope,
  CoachRoutineExerciseItem,
  buildCoachExerciseAlternatives,
} from './coachContextEngine.ts';
import { normalizeText } from './workoutAnalyticsEngine.ts';

export const COACH_AUTO_TTS_STORAGE_KEY = 'lazcakon_coach_auto_tts_v1';
export const COACH_VOICE_MODE_STORAGE_KEY = 'lazcakon_coach_voice_mode_v1';

export interface CoachVoiceCapabilities {
  sttSupported: boolean;
  ttsSupported: boolean;
  hasChileanSpanishVoice: boolean;
  preferredTtsLang: string;
}

export interface CoachLoadChangePreview {
  originalExerciseId: string;
  originalExerciseName: string;
  currentWeightKg?: number;
  proposedWeightKg: number;
  weightUnit: 'kg' | 'lb';
  scope: CoachReplacementScope;
  canApplyToSession: boolean;
  canSaveToRoutine: boolean;
  pendingSetsCount: number;
  completedSetsCount: number;
  targetRoutineId?: string;
  targetRoutineTitle?: string;
}

export type CoachVoiceActionDetection =
  | {
      type: 'change_load';
      preview: CoachLoadChangePreview;
      matchedExerciseId: string;
    }
  | {
      type: 'replace_exercise';
      matchedExerciseId?: string;
      suggestedReplacement?: CoachAlternativeOption;
      equipmentHint?: string;
    }
  | {
      type: 'none';
    };

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

/**
 * Reads the persisted "Leer respuestas en voz alta" preference.
 * Strictly defaults to FALSE (apagado inicialmente).
 */
export function loadAutoReadCoachPreference(storage?: Pick<Storage, 'getItem'> | null): boolean {
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined' && window.localStorage
        ? window.localStorage
        : null;
    if (!target) return false;
    return target.getItem(COACH_AUTO_TTS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveAutoReadCoachPreference(
  enabled: boolean,
  storage?: Pick<Storage, 'setItem'> | null
): void {
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined' && window.localStorage
        ? window.localStorage
        : null;
    if (!target) return;
    target.setItem(COACH_AUTO_TTS_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage quota or private-mode failures cleanly
  }
}

export function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  return typeof ctor === 'function' ? (ctor as new () => SpeechRecognitionLike) : null;
}

export function isSpeechSynthesisAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  );
}

/**
 * Selects the best available Spanish voice, prioritizing Chilean Spanish (es-CL).
 */
export function pickSpanishChileVoice(
  voices: ReadonlyArray<SpeechSynthesisVoice>
): SpeechSynthesisVoice | null {
  if (!Array.isArray(voices) || voices.length === 0) return null;

  const byLangLower = voices.map((v) => ({
    voice: v,
    lang: (v.lang || '').toLowerCase().replace('_', '-'),
    name: (v.name || '').toLowerCase(),
  }));

  const exactEsCl = byLangLower.find(
    (entry) => entry.lang === 'es-cl' || entry.name.includes('chile')
  );
  if (exactEsCl) return exactEsCl.voice;

  const latamPriority = ['es-419', 'es-ar', 'es-pe', 'es-uy', 'es-co', 'es-mx'];
  for (const code of latamPriority) {
    const match = byLangLower.find((entry) => entry.lang === code);
    if (match) return match.voice;
  }

  const esEs = byLangLower.find((entry) => entry.lang === 'es-es');
  if (esEs) return esEs.voice;

  const anyEs = byLangLower.find((entry) => entry.lang.startsWith('es'));
  return anyEs ? anyEs.voice : null;
}

export function detectCoachVoiceCapabilities(): CoachVoiceCapabilities {
  const sttSupported = Boolean(getSpeechRecognitionConstructor());
  const ttsSupported = isSpeechSynthesisAvailable();
  let voices: SpeechSynthesisVoice[] = [];
  if (ttsSupported) {
    try {
      voices = window.speechSynthesis.getVoices() || [];
    } catch {
      voices = [];
    }
  }
  const picked = pickSpanishChileVoice(voices);
  const pickedLang = (picked?.lang || '').toLowerCase().replace('_', '-');
  return {
    sttSupported,
    ttsSupported,
    hasChileanSpanishVoice: pickedLang === 'es-cl',
    preferredTtsLang: picked?.lang || 'es-CL',
  };
}

let activeTechniqueUtterance: SpeechSynthesisUtterance | null = null;

export function stopActiveSpeechSynthesis(): void {
  if (typeof window === 'undefined' || !isSpeechSynthesisAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Ignore WebView / Capacitor synthesis cancel errors
  } finally {
    activeTechniqueUtterance = null;
  }
}

/**
 * Speaks technical instructions using the existing Spanish (Chile/Latam) voice engine.
 * Designed for Web, PWA, and Capacitor (Android/iOS) WebView compatibility.
 */
export function speakTechniqueInstructionText(
  rawText: string,
  callbacks?: {
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (reason: string) => void;
  }
): boolean {
  if (typeof window === 'undefined' || !isSpeechSynthesisAvailable()) {
    callbacks?.onError?.('El motor de síntesis de voz no está disponible en este dispositivo.');
    return false;
  }

  try {
    stopActiveSpeechSynthesis();
    const speechText = formatCoachTextForSpeech(rawText);
    if (!speechText) {
      callbacks?.onError?.('No hay instrucciones técnicas para reproducir.');
      return false;
    }

    const synth = window.speechSynthesis;
    const utterance = new window.SpeechSynthesisUtterance(speechText);
    let voices: SpeechSynthesisVoice[] = [];
    try {
      voices = synth.getVoices() || [];
    } catch {
      voices = [];
    }

    const pickedVoice = pickSpanishChileVoice(voices);
    if (pickedVoice) {
      utterance.voice = pickedVoice;
      utterance.lang = pickedVoice.lang || 'es-CL';
    } else {
      utterance.lang = 'es-CL';
    }
    utterance.rate = 1.0;

    utterance.onstart = () => {
      callbacks?.onStart?.();
    };
    utterance.onend = () => {
      if (activeTechniqueUtterance === utterance) {
        activeTechniqueUtterance = null;
      }
      callbacks?.onEnd?.();
    };
    utterance.onerror = () => {
      if (activeTechniqueUtterance === utterance) {
        activeTechniqueUtterance = null;
      }
      callbacks?.onError?.('No se pudo completar la lectura por voz en este navegador.');
    };

    activeTechniqueUtterance = utterance;
    synth.speak(utterance);
    return true;
  } catch {
    activeTechniqueUtterance = null;
    callbacks?.onError?.('Error al iniciar el motor de voz.');
    return false;
  }
}

export function mapSpeechRecognitionErrorToSpanish(errorCode: string): string {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Permiso de micrófono denegado. Habilítalo en tu navegador para dictar al coach o escribe tu consulta.';
    case 'audio-capture':
      return 'No detectamos un micrófono disponible en este dispositivo. Puedes seguir escribiendo tu mensaje.';
    case 'no-speech':
      return 'No se escuchó voz con claridad. Toca el micrófono e inténtalo de nuevo más cerca.';
    case 'network':
      return 'El reconocimiento de voz requiere conexión de red disponible en este navegador.';
    case 'language-not-supported':
      return 'Español de Chile (es-CL) no está instalado en el dictado; puedes escribir manualmente.';
    case 'aborted':
      return '';
    default:
      return 'No se pudo completar el dictado por voz. Puedes revisar el texto o escribir manualmente.';
  }
}

const ES_UNITS = [
  'cero',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
];

const ES_TWENTIES = [
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];

const ES_TENS = [
  '',
  '',
  'veinte',
  'treinta',
  'cuarenta',
  'cincuenta',
  'sesenta',
  'setenta',
  'ochenta',
  'noventa',
];

const ES_HUNDREDS = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
];

export function integerToSpanishWords(n: number): string {
  if (!Number.isFinite(n)) return '';
  const rounded = Math.trunc(Math.abs(n));
  const prefix = n < 0 ? 'menos ' : '';

  if (rounded < 20) return `${prefix}${ES_UNITS[rounded]}`;
  if (rounded < 30) return `${prefix}${ES_TWENTIES[rounded - 20]}`;
  if (rounded < 100) {
    const tens = Math.floor(rounded / 10);
    const unit = rounded % 10;
    return `${prefix}${ES_TENS[tens]}${unit > 0 ? ` y ${ES_UNITS[unit]}` : ''}`;
  }
  if (rounded === 100) return `${prefix}cien`;
  if (rounded < 1000) {
    const hundreds = Math.floor(rounded / 100);
    const rem = rounded % 100;
    return `${prefix}${ES_HUNDREDS[hundreds]}${rem > 0 ? ` ${integerToSpanishWords(rem)}` : ''}`;
  }
  if (rounded < 1000000) {
    const thousands = Math.floor(rounded / 1000);
    const rem = rounded % 1000;
    const thousandsWord =
      thousands === 1 ? 'mil' : `${integerToSpanishWords(thousands)} mil`;
    return `${prefix}${thousandsWord}${rem > 0 ? ` ${integerToSpanishWords(rem)}` : ''}`;
  }
  return String(n);
}

export function numericTokenToSpanishWords(rawNum: string): string {
  const cleaned = rawNum.trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return rawNum;

  const isNegative = cleaned.startsWith('-');
  const unsigned = isNegative ? cleaned.slice(1) : cleaned;
  const parts = unsigned.split('.');
  const intVal = Number(parts[0]);
  if (!Number.isFinite(intVal)) return rawNum;

  const intWords = `${isNegative ? 'menos ' : ''}${integerToSpanishWords(intVal)}`;
  if (parts.length === 1) {
    return intWords;
  }

  const fracStr = parts[1];
  if (/^0+$/.test(fracStr)) {
    return intWords;
  }

  // Handle leading zeros in decimal fraction naturally ("05" -> "cero cinco")
  if (fracStr.startsWith('0')) {
    const digitWords = fracStr
      .split('')
      .map((d) => ES_UNITS[Number(d)] || d)
      .join(' ');
    return `${intWords} coma ${digitWords}`;
  }

  const fracVal = Number(fracStr);
  const fracWords =
    fracVal <= 999
      ? integerToSpanishWords(fracVal)
      : fracStr
          .split('')
          .map((d) => ES_UNITS[Number(d)] || d)
          .join(' ');

  return `${intWords} coma ${fracWords}`;
}

/**
 * Converts coach markdown & gym shorthand into natural Chilean/Latin American Spanish speech.
 * Example: "42,5 kg × 6" -> "cuarenta y dos coma cinco kilos por seis repeticiones"
 */
export function formatCoachTextForSpeech(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';

  let text = rawText
    // Strip markdown links [label](url) -> label
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    // Strip markdown formatting glyphs
    .replace(/[*_`~#>]/g, '')
    // Replace line-leading list dashes/bullets cleanly
    .replace(/(^|\n)\s*[-•]\s+/g, '$1')
    // Normalize arrow & mid-dot separators
    .replace(/\s*→\s*/g, ' por ')
    .replace(/\s*·\s*/g, ', ');

  // 1. Weight x Reps patterns: "42,5 kg × 6", "40 kg x 8 reps", "95 lb × 5"
  text = text.replace(
    /(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilo|kilos|lb|lbs|libra|libras)\s*[×xX*]\s*(\d+(?:[.,]\d+)?)(?:\s*(?:reps?|repeticiones?))?\b/gi,
    (_match, weightStr: string, unitStr: string, repsStr: string) => {
      const weightWords = numericTokenToSpanishWords(weightStr);
      const repsWords = numericTokenToSpanishWords(repsStr);
      const numericWeight = Number(weightStr.replace(',', '.'));
      const numericReps = Number(repsStr.replace(',', '.'));

      const lowerUnit = unitStr.toLowerCase();
      const unitWord = lowerUnit.startsWith('l')
        ? numericWeight === 1
          ? 'libra'
          : 'libras'
        : numericWeight === 1
        ? 'kilo'
        : 'kilos';

      const repWord = numericReps === 1 ? 'repetición' : 'repeticiones';
      return `${weightWords} ${unitWord} por ${repsWords} ${repWord}`;
    }
  );

  // 2. Rep ranges: "3 × 8 - 12 reps" or "8-12 reps"
  text = text.replace(
    /(\d+)\s*[×xX*]\s*(\d+)\s*[-–]\s*(\d+)\s*(?:reps?|repeticiones?)\b/gi,
    (_m, setsStr: string, minStr: string, maxStr: string) =>
      `${numericTokenToSpanishWords(setsStr)} series de ${numericTokenToSpanishWords(
        minStr
      )} a ${numericTokenToSpanishWords(maxStr)} repeticiones`
  );

  text = text.replace(
    /(\d+)\s*[-–]\s*(\d+)\s*(?:reps?|repeticiones?)\b/gi,
    (_m, minStr: string, maxStr: string) =>
      `${numericTokenToSpanishWords(minStr)} a ${numericTokenToSpanishWords(
        maxStr
      )} repeticiones`
  );

  // 3. Sets × Reps without weight: "3 × 10 reps" or "4 × 12"
  text = text.replace(
    /(\d+)\s*[×xX*]\s*(\d+)\s*(?:reps?|repeticiones?)\b/gi,
    (_m, setsStr: string, repsStr: string) => {
      const numericReps = Number(repsStr);
      const repWord = numericReps === 1 ? 'repetición' : 'repeticiones';
      return `${numericTokenToSpanishWords(setsStr)} por ${numericTokenToSpanishWords(
        repsStr
      )} ${repWord}`;
    }
  );

  // 4. Standalone weights: "42,5 kg" or "135 lb"
  text = text.replace(
    /(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilo|kilos|lb|lbs)\b/gi,
    (_m, weightStr: string, unitStr: string) => {
      const numericWeight = Number(weightStr.replace(',', '.'));
      const lowerUnit = unitStr.toLowerCase();
      const unitWord = lowerUnit.startsWith('l')
        ? numericWeight === 1
          ? 'libra'
          : 'libras'
        : numericWeight === 1
        ? 'kilo'
        : 'kilos';
      return `${numericTokenToSpanishWords(weightStr)} ${unitWord}`;
    }
  );

  // 5. Standalone reps shorthand: "6 reps" -> "seis repeticiones"
  text = text.replace(
    /(\d+)\s*(?:reps?)\b/gi,
    (_m, repsStr: string) => {
      const numericReps = Number(repsStr);
      return `${numericTokenToSpanishWords(repsStr)} ${
        numericReps === 1 ? 'repetición' : 'repeticiones'
      }`;
    }
  );

  // 6. Intensity shorthand: "@8,5", "RPE 8.5", "RIR 2", "1RM", "%"
  text = text.replace(
    /@\s*(\d+(?:[.,]\d+)?)/g,
    (_m, numStr: string) => `a RPE ${numericTokenToSpanishWords(numStr)}`
  );
  text = text.replace(
    /\bRPE\s*(\d+(?:[.,]\d+)?)/gi,
    (_m, numStr: string) => `RPE ${numericTokenToSpanishWords(numStr)}`
  );
  text = text.replace(
    /\bRIR\s*(\d+(?:[.,]\d+)?)/gi,
    (_m, numStr: string) => {
      const n = Number(numStr.replace(',', '.'));
      return `con ${numericTokenToSpanishWords(numStr)} ${
        n === 1 ? 'repetición' : 'repeticiones'
      } en reserva`;
    }
  );
  text = text.replace(/\b1RM\b/gi, 'una repetición máxima');
  text = text.replace(
    /(\d+(?:[.,]\d+)?)\s*%/g,
    (_m, numStr: string) => `${numericTokenToSpanishWords(numStr)} por ciento`
  );

  // 7. Convert remaining standalone decimals/small numbers cleanly (skip times 14:30 and dates 17/11)
  text = text.replace(/\d+(?:[.,]\d+)?/g, (match, offset: number, full: string) => {
    const prevChar = offset > 0 ? full[offset - 1] : '';
    const nextChar = full[offset + match.length] || '';
    if (prevChar === ':' || prevChar === '/' || nextChar === ':' || nextChar === '/') {
      return match;
    }
    const n = Number(match.replace(',', '.'));
    if (!Number.isFinite(n) || n > 9999) return match;
    return numericTokenToSpanishWords(match);
  });

  // Collapse newlines into natural pauses and normalize spaces
  return text
    .replace(/\n+/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
}

/**
 * Pure deduplication helper for auto-reading new Coach replies once only.
 */
export function selectNextAutoSpeechMessage<T extends { id: string; role: string; text: string }>(
  messages: ReadonlyArray<T>,
  spokenIds: ReadonlySet<string>,
  autoReadEnabled: boolean
): T | null {
  if (!autoReadEnabled || !Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== 'assistant' || !latest.text.trim()) {
    return null;
  }
  if (spokenIds.has(latest.id)) {
    return null;
  }
  return latest;
}

function findBestMatchedExerciseInList(
  queryNorm: string,
  exercises: ReadonlyArray<CoachRoutineExerciseItem>,
  fallback: CoachRoutineExerciseItem | null
): CoachRoutineExerciseItem | null {
  if (exercises.length === 0) return fallback;
  let bestMatch: CoachRoutineExerciseItem | null = null;
  let bestScore = 0;

  for (const ex of exercises) {
    const exNorm = normalizeText(ex.name);
    const origNorm = normalizeText(ex.originalName || '');
    if (!exNorm) continue;

    if (queryNorm.includes(exNorm) || (origNorm && queryNorm.includes(origNorm))) {
      return ex;
    }

    const tokens = exNorm.split(/\s+/).filter((t) => t.length >= 4);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((tok) => queryNorm.includes(tok)).length;
    const score = hits / tokens.length;
    if (hits >= 1 && score > bestScore && score >= 0.4) {
      bestScore = score;
      bestMatch = ex;
    }
  }

  return bestMatch || fallback;
}

export function buildUpdatedRoutineWithLoadChange(params: {
  routine: Routine;
  originalExerciseId: string;
  originalExerciseName: string;
  proposedWeightKg: number;
}): Routine {
  const { routine, originalExerciseId, originalExerciseName, proposedWeightKg } = params;
  return {
    ...routine,
    exercises: routine.exercises.map((ex) => {
      if (ex.id !== originalExerciseId && ex.name !== originalExerciseName) {
        return ex;
      }
      return {
        ...ex,
        defaultWeight: proposedWeightKg,
      };
    }),
  };
}

/**
 * Parses a dictated or typed coach message to detect explicit user intent to change
 * an exercise or adjust a training load. Strictly non-mutating: returns a preview
 * requiring athlete confirmation before any workout/routine write occurs.
 */
export function parseCoachVoiceActionRequest(params: {
  text: string;
  exercises: ReadonlyArray<CoachRoutineExerciseItem>;
  selectedExercise: CoachRoutineExerciseItem | null;
  activeSession: ActiveWorkoutSession | null;
  selectedRoutine: Routine | null;
  defaultUnit?: 'kg' | 'lb';
}): CoachVoiceActionDetection {
  const {
    text,
    exercises,
    selectedExercise,
    activeSession,
    selectedRoutine,
    defaultUnit = 'kg',
  } = params;

  const trimmed = (text || '').trim();
  if (!trimmed) return { type: 'none' };

  const norm = normalizeText(trimmed);

  // 1. Detect Load / Weight change requests ("cambia la carga a 45 kg", "sube el peso a 42,5 kilos")
  const hasLoadActionVerb =
    /\b(cambi|ajust|sub|baj|pon|coloc|fij|dej|actualiz|modifica)/.test(norm);
  const hasLoadNounOrUnit =
    /\b(carga|peso|kilo|kilos|kg|lb|libras?)\b/.test(norm);
  const weightMatch = trimmed.match(
    /(?:a|en|por|=)?\s*(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilo|kilos|lb|lbs|libra|libras)\b/i
  ) || (hasLoadActionVerb && /\b(carga|peso)\b/.test(norm)
    ? trimmed.match(/\ba\s+(\d+(?:[.,]\d+)?)\b/i)
    : null);

  const isQuestionAboutLastWeight =
    /\b(ultima vez|cuanto use|que peso use|que carga use|cual fue|que me sugieres)\b/.test(norm);

  if (hasLoadActionVerb && hasLoadNounOrUnit && weightMatch && !isQuestionAboutLastWeight) {
    const rawNum = Number(weightMatch[1].replace(',', '.'));
    if (Number.isFinite(rawNum) && rawNum > 0 && rawNum <= 600) {
      const targetEx = findBestMatchedExerciseInList(norm, exercises, selectedExercise);
      if (targetEx) {
        const unitRaw = (weightMatch[2] || '').toLowerCase();
        const unit: 'kg' | 'lb' = unitRaw.startsWith('l')
          ? 'lb'
          : unitRaw.startsWith('k')
          ? 'kg'
          : defaultUnit;

        const activeEx = activeSession?.exercises.find(
          (ex) => ex.exerciseId === targetEx.id || ex.originalExerciseId === targetEx.id
        );
        const canApplyToSession = Boolean(activeEx);
        const canSaveToRoutine = Boolean(selectedRoutine);

        const asksForRoutine = /\b(rutina|siempre|permanente|guardar)\b/.test(norm);
        const resolvedScope: CoachReplacementScope =
          asksForRoutine && canSaveToRoutine
            ? 'routine'
            : canApplyToSession
            ? 'session'
            : 'routine';

        const pendingSetsCount = activeEx
          ? activeEx.sets.filter((s) => !s.completed).length
          : 0;
        const completedSetsCount = activeEx
          ? activeEx.sets.filter((s) => s.completed).length
          : targetEx.completedSetsCount;

        const firstActiveWeight = activeEx?.sets.find(
          (s) => typeof s.weight === 'number' && s.weight > 0
        )?.weight;
        const currentWeightKg =
          typeof firstActiveWeight === 'number'
            ? firstActiveWeight
            : targetEx.rawRoutineExercise?.defaultWeight;

        return {
          type: 'change_load',
          matchedExerciseId: targetEx.id,
          preview: {
            originalExerciseId: targetEx.id,
            originalExerciseName: targetEx.name,
            currentWeightKg,
            proposedWeightKg: Math.round(rawNum * 100) / 100,
            weightUnit: unit,
            scope: resolvedScope,
            canApplyToSession,
            canSaveToRoutine,
            pendingSetsCount,
            completedSetsCount,
            targetRoutineId: selectedRoutine?.id,
            targetRoutineTitle: selectedRoutine?.title,
          },
        };
      }
    }
  }

  // 2. Detect Exercise Replacement requests ("cambiar este ejercicio", "reemplaza X por Y")
  const asksToReplaceExercise =
    (/\b(cambi|reemplaz|sustitu)/.test(norm) ||
      /\b(alternativa|otro ejercicio|en lugar de)\b/.test(norm)) &&
    !/\b(carga|peso|kilo|kilos|kg|lb|libras)\b/.test(norm);

  if (asksToReplaceExercise) {
    const targetEx = findBestMatchedExerciseInList(norm, exercises, selectedExercise);

    let equipmentHint: string | undefined;
    if (/\b(mancuerna|mancuernas)\b/.test(norm)) equipmentHint = 'Mancuernas';
    else if (/\b(polea|poleas|cable)\b/.test(norm)) equipmentHint = 'Poleas';
    else if (/\b(maquina|maquinas)\b/.test(norm)) equipmentHint = 'Máquinas';
    else if (/\b(barra|barras)\b/.test(norm)) equipmentHint = 'Barras';
    else if (/\b(peso corporal|corporal|calistenia)\b/.test(norm)) equipmentHint = 'Peso corporal';

    let suggestedReplacement: CoachAlternativeOption | undefined;
    if (targetEx) {
      const porMatch = norm.match(/\b(?:por|en lugar de|a)\s+([a-z0-9\s]{3,})$/);
      const rawTargetPhrase = porMatch ? porMatch[1].trim() : '';
      const cleanedSearch = rawTargetPhrase
        .replace(
          /\b(uno|una|otro|otra|algo|ejercicio|ejercicios|de|con|en|la|el|los|las|mancuernas?|poleas?|maquinas?|barras?|peso corporal)\b/g,
          ' '
        )
        .replace(/\s+/g, ' ')
        .trim();

      let altLookup = buildCoachExerciseAlternatives({
        exercise: targetEx,
        filterEquipment: equipmentHint,
        searchQuery: cleanedSearch.length >= 3 ? cleanedSearch : undefined,
        limit: 4,
      });

      if (altLookup.alternatives.length === 0 && cleanedSearch) {
        altLookup = buildCoachExerciseAlternatives({
          exercise: targetEx,
          filterEquipment: equipmentHint,
          limit: 4,
        });
      }

      if ((porMatch || equipmentHint) && altLookup.alternatives.length > 0) {
        suggestedReplacement = altLookup.alternatives[0];
      }
    }

    return {
      type: 'replace_exercise',
      matchedExerciseId: targetEx?.id,
      suggestedReplacement,
      equipmentHint,
    };
  }

  return { type: 'none' };
}

// ============================================================================
// LAZCAKONG GYM 7.0 — ETAPA 2: COACH VOICE MODES & CAPACITOR ADAPTERS
// ============================================================================

export function createBrowserStorageAdapter(
  customStorage?: CoachPlatformStorageAdapter | null
): CoachPlatformStorageAdapter {
  if (customStorage) return customStorage;
  return {
    getItem: (key: string) => {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage.getItem(key);
        }
      } catch {
        // Ignore storage errors
      }
      return null;
    },
    setItem: (key: string, value: string) => {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, value);
        }
      } catch {
        // Ignore storage quota / private mode errors
      }
    },
  };
}

export function createBrowserVoiceAdapter(
  customAdapter?: CoachPlatformVoiceAdapter | null
): CoachPlatformVoiceAdapter {
  if (customAdapter) return customAdapter;
  return {
    isAvailable: () => isSpeechSynthesisAvailable(),
    speak: (text, options) =>
      speakTechniqueInstructionText(text, {
        onStart: options?.onStart,
        onEnd: options?.onEnd,
        onError: options?.onError,
      }),
    stop: () => stopActiveSpeechSynthesis(),
  };
}

export function loadCoachVoiceMode(
  storage?: CoachPlatformStorageAdapter | null
): CoachVoiceMode {
  const adapter = createBrowserStorageAdapter(storage);
  const raw = adapter.getItem(COACH_VOICE_MODE_STORAGE_KEY);
  if (raw === 'silent' || raw === 'important_only' || raw === 'full_coach') {
    return raw;
  }
  const legacyAuto = adapter.getItem(COACH_AUTO_TTS_STORAGE_KEY);
  if (legacyAuto === 'true') {
    return 'full_coach';
  }
  return 'important_only';
}

export function saveCoachVoiceMode(
  mode: CoachVoiceMode,
  storage?: CoachPlatformStorageAdapter | null
): void {
  const adapter = createBrowserStorageAdapter(storage);
  adapter.setItem(COACH_VOICE_MODE_STORAGE_KEY, mode);
  adapter.setItem(COACH_AUTO_TTS_STORAGE_KEY, mode === 'silent' ? 'false' : 'true');
}

export function getCoachVoiceModeLabel(mode: CoachVoiceMode): string {
  switch (mode) {
    case 'silent':
      return 'Silencioso';
    case 'important_only':
      return 'Solo importantes';
    case 'full_coach':
      return 'Coach completo';
  }
}

export interface CoachSpeechGuardDecision {
  allowed: boolean;
  reason:
    | 'ok'
    | 'silent_mode'
    | 'not_important'
    | 'duplicate_event'
    | 'empty_message'
    | 'rest_timer_imminent_alarm'
    | 'rest_alarm_active';
}

/**
 * Evaluates whether a proactive Coach voice message should be spoken right now.
 * Prevents:
 * - speaking in 'silent' mode
 * - speaking non-critical cues in 'important_only' mode
 * - repeating an already-spoken eventKey
 * - colliding with the 5-second warning or final alarm of the rest timer
 */
export function shouldSpeakCoachEvent(params: {
  mode: CoachVoiceMode;
  isImportant: boolean;
  eventKey: string;
  messageText: string;
  spokenEventKeys: ReadonlySet<string>;
  restTimerActive?: boolean;
  restTimerPaused?: boolean;
  restTimerRemainingSeconds?: number;
  restAlertRecentlyTriggeredAt?: number;
  nowMs?: number;
}): CoachSpeechGuardDecision {
  const {
    mode,
    isImportant,
    eventKey,
    messageText,
    spokenEventKeys,
    restTimerActive = false,
    restTimerPaused = false,
    restTimerRemainingSeconds,
    restAlertRecentlyTriggeredAt,
    nowMs = Date.now(),
  } = params;

  if (!messageText || !messageText.trim()) {
    return { allowed: false, reason: 'empty_message' };
  }
  if (mode === 'silent') {
    return { allowed: false, reason: 'silent_mode' };
  }
  if (mode === 'important_only' && !isImportant) {
    return { allowed: false, reason: 'not_important' };
  }
  if (eventKey && spokenEventKeys.has(eventKey)) {
    return { allowed: false, reason: 'duplicate_event' };
  }
  if (
    restTimerActive &&
    !restTimerPaused &&
    typeof restTimerRemainingSeconds === 'number' &&
    restTimerRemainingSeconds <= 6
  ) {
    return { allowed: false, reason: 'rest_timer_imminent_alarm' };
  }
  if (
    typeof restAlertRecentlyTriggeredAt === 'number' &&
    restAlertRecentlyTriggeredAt > 0 &&
    nowMs - restAlertRecentlyTriggeredAt < 4500
  ) {
    return { allowed: false, reason: 'rest_alarm_active' };
  }

  return { allowed: true, reason: 'ok' };
}

/**
 * Speaks a proactive Coach recommendation respecting voice mode, deduplication,
 * and rest-timer alarm non-interference. Compatible with Web Speech & Capacitor adapters.
 */
export function speakProactiveCoachMessage(params: {
  mode: CoachVoiceMode;
  isImportant: boolean;
  eventKey: string;
  rawText: string;
  spokenEventKeys: Set<string>;
  restTimerActive?: boolean;
  restTimerPaused?: boolean;
  restTimerRemainingSeconds?: number;
  restAlertRecentlyTriggeredAt?: number;
  nowMs?: number;
  voiceAdapter?: CoachPlatformVoiceAdapter | null;
}): { spoken: boolean; reason: CoachSpeechGuardDecision['reason']; formattedText: string } {
  const guard = shouldSpeakCoachEvent({
    mode: params.mode,
    isImportant: params.isImportant,
    eventKey: params.eventKey,
    messageText: params.rawText,
    spokenEventKeys: params.spokenEventKeys,
    restTimerActive: params.restTimerActive,
    restTimerPaused: params.restTimerPaused,
    restTimerRemainingSeconds: params.restTimerRemainingSeconds,
    restAlertRecentlyTriggeredAt: params.restAlertRecentlyTriggeredAt,
    nowMs: params.nowMs,
  });

  const formattedText = formatCoachTextForSpeech(params.rawText);
  if (!guard.allowed || !formattedText) {
    return {
      spoken: false,
      reason: guard.allowed ? 'empty_message' : guard.reason,
      formattedText,
    };
  }

  const adapter = createBrowserVoiceAdapter(params.voiceAdapter);
  if (!adapter.isAvailable()) {
    return {
      spoken: false,
      reason: 'ok',
      formattedText,
    };
  }

  if (params.eventKey) {
    params.spokenEventKeys.add(params.eventKey);
  }
  const ok = adapter.speak(formattedText, { lang: 'es-CL', rate: 1.0 });
  return {
    spoken: ok,
    reason: 'ok',
    formattedText,
  };
}

