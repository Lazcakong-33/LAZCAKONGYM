import Papa from 'papaparse';
import { EXERCISE_LIBRARY } from '../data/exerciseLibrary';
import type { Exercise, LibraryExercise, Routine, RoutineImportMode } from '../types';
import {
  CANONICAL_WEEKDAYS,
  canonicalizeMuscleGroup,
  consolidateWeeklyRoutines,
  CsvImportResult,
  normalizar,
  normalizeExerciseWithEquipment,
  resolveCanonicalDay,
} from './csvImporter';
import {
  ExtractedRoutineRow,
  parseExcelMatrixIterative,
  parseRestToSeconds,
  procesarExcel,
} from './routineImporterHelpers';
import type {
  OcrExtractedDayRaw,
  OcrExtractedExerciseRaw,
} from '../server/geminiVisionRoutineExtractor';

export const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export const ACCEPTED_ALL_IMPORTER_EXTENSIONS =
  '.xlsx, .xls, .csv, .json, .pdf, image/png, image/jpeg, image/webp, .png, .jpg, .jpeg, .webp';

export const CANONICAL_MUSCLE_OPTIONS = [
  'Pectoral',
  'Dorsal',
  'Deltoides',
  'Biceps',
  'Triceps',
  'Cuadriceps',
  'Isquiotibiales',
  'Gluteos',
  'Gemelos',
  'Abdomen',
  'Aductores',
] as const;

export type SupportedRoutineFormat = 'xlsx' | 'csv' | 'json' | 'pdf' | 'image';

export type OcrReviewField =
  | 'dayName'
  | 'name'
  | 'sets'
  | 'reps'
  | 'weightKg'
  | 'restSeconds'
  | 'targetMuscles'
  | 'libraryMatch'
  | 'conflict';

export interface LibraryMatchCandidate {
  exercise: LibraryExercise;
  score: number;
}

export interface LibraryMatchResult {
  matchedExercise: LibraryExercise | null;
  confidence: 'exact' | 'high' | 'medium' | 'none';
  score: number;
  candidates: LibraryMatchCandidate[];
}

export interface EditableOcrExercise {
  draftId: string;
  order: number;
  rawOcrName: string;
  name: string;
  libraryExerciseId: string | null;
  libraryMatchConfidence: 'exact' | 'high' | 'medium' | 'none';
  libraryCandidates: LibraryMatchCandidate[];
  isCustomExercise: boolean;
  targetMuscles: string;
  equipment: string;
  thumbnailUrl?: string;
  secondaryThumbnailUrl?: string;
  defaultVideoUrl?: string;
  sets: number | null;
  reps: string;
  weightKg: number | null;
  restSeconds: number | null;
  rpe: string;
  notes: string;
  sourceImageIndices: number[];
  needsReview: boolean;
  unrecognizedFields: OcrReviewField[];
  reviewReasons: string[];
  manuallyVerified: boolean;
}

export interface EditableOcrDay {
  draftDayId: string;
  dayName: string;
  routineTitle: string;
  sourceImageIndices: number[];
  dayNeedsReview: boolean;
  reviewReason?: string;
  exercises: EditableOcrExercise[];
}

export interface UnifiedOcrDraftSummary {
  days: EditableOcrDay[];
  detectedFormat: string;
  warnings: string[];
  totalExercises: number;
  matchedLibraryCount: number;
  customExercisesCount: number;
  pendingReviewExercisesCount: number;
  pendingReviewFieldsCount: number;
  deduplicatedCount: number;
}

export interface QueuedRoutineImage {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

const STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'con',
  'en',
  'a',
  'al',
  'para',
  'por',
  'y',
  'o',
  'un',
  'una',
]);

function tokenizeExerciseName(name: string): string[] {
  return normalizar(name)
    .split(' ')
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function isPendingMarker(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  const norm = normalizar(String(val));
  if (!norm) return true;
  return (
    norm === 'pendiente de revision' ||
    norm === 'pendiente' ||
    norm === 'ilegible' ||
    norm === 'no reconocido' ||
    norm === 'desconocido'
  );
}

export function detectFileFormat(file: { name: string; type?: string }): SupportedRoutineFormat | null {
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();

  if (
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    mime === 'image/webp' ||
    /\.(png|jpe?g|webp)$/i.test(name)
  ) {
    return 'image';
  }
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
    return 'pdf';
  }
  if (
    /spreadsheetml|ms-excel/.test(mime) ||
    /\.(xlsx|xls)$/i.test(name)
  ) {
    return 'xlsx';
  }
  if (mime === 'text/csv' || /\.csv$/i.test(name)) {
    return 'csv';
  }
  if (mime === 'application/json' || /\.json$/i.test(name)) {
    return 'json';
  }
  return null;
}

export function isSupportedRoutineImageFile(file: { name: string; type?: string }): boolean {
  return detectFileFormat(file) === 'image';
}

export function isSupportedRoutineFile(file: { name: string; type?: string }): boolean {
  return detectFileFormat(file) !== null;
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`No se pudo leer "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

/**
 * Lee y optimiza una imagen del celular o PC para análisis OCR rápido sin perder nitidez de texto.
 */
export async function prepareImageForUpload(file: File): Promise<QueuedRoutineImage> {
  if (!isSupportedRoutineImageFile(file)) {
    throw new Error(
      `El archivo "${file.name}" no es una imagen válida. Formatos permitidos: PNG, JPG/JPEG, WEBP.`
    );
  }

  const rawDataUrl = await readFileAsDataUrl(file);

  const normalizedMime =
    file.type === 'image/jpg'
      ? 'image/jpeg'
      : file.type || (file.name.toLowerCase().endsWith('.png')
          ? 'image/png'
          : file.name.toLowerCase().endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg');

  if (file.size <= 2.2 * 1024 * 1024 || typeof document === 'undefined' || typeof Image === 'undefined') {
    return {
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fileName: file.name,
      mimeType: normalizedMime,
      sizeBytes: file.size,
      dataUrl: rawDataUrl,
    };
  }

  try {
    const optimizedUrl = await new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1920;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const outputMime = normalizedMime === 'image/webp' ? 'image/webp' : 'image/jpeg';
        resolve(canvas.toDataURL(outputMime, 0.9));
      };
      img.onerror = () => resolve(rawDataUrl);
      img.src = rawDataUrl;
    });

    const outMimeMatch = optimizedUrl.match(/^data:([^;]+);base64,/i);
    return {
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fileName: file.name,
      mimeType: outMimeMatch?.[1] || normalizedMime,
      sizeBytes: file.size,
      dataUrl: optimizedUrl,
    };
  } catch {
    return {
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fileName: file.name,
      mimeType: normalizedMime,
      sizeBytes: file.size,
      dataUrl: rawDataUrl,
    };
  }
}

/**
 * Compara un ejercicio importado contra `EXERCISE_LIBRARY`.
 * Regla estricta: solo considera `exact` cuando coincide de forma inequívoca con el nombre oficial;
 * para variantes parciales o similares devuelve sugerencias en `candidates` sin asociar automáticamente
 * movimientos diferentes.
 */
export function matchExerciseInLibrary(
  importedName: string,
  targetMuscleHint?: string | null,
  library: LibraryExercise[] = EXERCISE_LIBRARY
): LibraryMatchResult {
  const cleanRaw = (importedName || '').replace(/\[pendiente de revisi[oó]n\]/gi, '').trim();
  if (!cleanRaw || isPendingMarker(cleanRaw)) {
    return {
      matchedExercise: null,
      confidence: 'none',
      score: 0,
      candidates: [],
    };
  }

  const normQuery = normalizar(cleanRaw);
  const equipmentExpanded = normalizar(normalizeExerciseWithEquipment(cleanRaw));
  const queryTokens = tokenizeExerciseName(cleanRaw);
  const expandedTokens = tokenizeExerciseName(normalizeExerciseWithEquipment(cleanRaw));
  const hintNorm =
    targetMuscleHint && !isPendingMarker(targetMuscleHint)
      ? normalizar(targetMuscleHint)
      : '';

  // 1. Coincidencia exacta directa
  const exact = library.find((item) => normalizar(item.name) === normQuery);
  if (exact) {
    return {
      matchedExercise: exact,
      confidence: 'exact',
      score: 1,
      candidates: [{ exercise: exact, score: 1 }],
    };
  }

  // 2. Coincidencia de alta similitud tras expandir sinónimo común -> sugerir sin sobreescribir
  const expandedExact =
    equipmentExpanded && equipmentExpanded !== normQuery
      ? library.find((item) => normalizar(item.name) === equipmentExpanded)
      : undefined;

  // 3. Puntuación por tokens y contención semántica
  const activeTokens = expandedTokens.length >= queryTokens.length ? expandedTokens : queryTokens;
  const activeSet = new Set(activeTokens);

  const scored: LibraryMatchCandidate[] = [];
  if (expandedExact) {
    scored.push({ exercise: expandedExact, score: 0.92 });
  }

  for (const item of library) {
    if (expandedExact && item.id === expandedExact.id) continue;
    const itemNorm = normalizar(item.name);
    const itemTokens = tokenizeExerciseName(item.name);
    if (itemTokens.length === 0 || activeTokens.length === 0) continue;

    const itemSet = new Set(itemTokens);
    let overlap = 0;
    activeSet.forEach((tok) => {
      if (itemSet.has(tok)) {
        overlap += 1;
      } else {
        for (const itTok of itemSet) {
          if (
            (tok.length >= 5 && itTok.startsWith(tok.slice(0, 5))) ||
            (itTok.length >= 5 && tok.startsWith(itTok.slice(0, 5)))
          ) {
            overlap += 0.75;
            break;
          }
        }
      }
    });

    if (overlap === 0) continue;

    const unionSize = new Set([...activeTokens, ...itemTokens]).size;
    let score = (2 * overlap) / (activeTokens.length + itemTokens.length);
    const jaccard = overlap / Math.max(unionSize, 1);
    score = score * 0.7 + jaccard * 0.3;

    if (itemNorm.includes(normQuery) || normQuery.includes(itemNorm)) {
      score = Math.min(0.94, score + 0.18);
    }

    if (hintNorm && item.muscleGroup) {
      const libMuscle = normalizar(item.muscleGroup);
      if (
        libMuscle.includes(hintNorm) ||
        hintNorm.includes(libMuscle) ||
        (hintNorm.includes('cuadricep') && libMuscle.includes('pierna')) ||
        (hintNorm.includes('isquio') && libMuscle.includes('pierna')) ||
        (hintNorm.includes('dorsal') && libMuscle.includes('espalda')) ||
        (hintNorm.includes('pectoral') && libMuscle.includes('pecho')) ||
        (hintNorm.includes('deltoid') && libMuscle.includes('hombro'))
      ) {
        score = Math.min(0.96, score + 0.06);
      }
    }

    if (score >= 0.34) {
      scored.push({ exercise: item, score: Number(score.toFixed(3)) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topCandidates = scored.slice(0, 5);
  const best = topCandidates[0];

  if (!best) {
    return {
      matchedExercise: null,
      confidence: 'none',
      score: 0,
      candidates: [],
    };
  }

  if (best.score >= 0.78) {
    return {
      matchedExercise: best.exercise,
      confidence: 'high',
      score: best.score,
      candidates: topCandidates,
    };
  }

  if (best.score >= 0.5) {
    return {
      matchedExercise: best.exercise,
      confidence: 'medium',
      score: best.score,
      candidates: topCandidates,
    };
  }

  return {
    matchedExercise: null,
    confidence: 'none',
    score: best.score,
    candidates: topCandidates,
  };
}

function toReviewFieldList(rawFields: string[] | undefined): OcrReviewField[] {
  const valid = new Set<OcrReviewField>([
    'dayName',
    'name',
    'sets',
    'reps',
    'weightKg',
    'restSeconds',
    'targetMuscles',
    'libraryMatch',
    'conflict',
  ]);
  const out = new Set<OcrReviewField>();
  (rawFields || []).forEach((f) => {
    if (valid.has(f as OcrReviewField)) {
      out.add(f as OcrReviewField);
    }
  });
  return Array.from(out);
}

function detectStrictMuscleFromText(
  explicitMuscle: string | null | undefined,
  exerciseName: string
): string {
  if (explicitMuscle && !isPendingMarker(explicitMuscle)) {
    return canonicalizeMuscleGroup(explicitMuscle, exerciseName);
  }
  const normExName = normalizar(exerciseName);
  const hasExplicitMuscleHint =
    /isquio|femoral|rumano|rdl|sentadilla|squat|prensa|cuadricep|zancada|bulgara|aductor|abductor|hip thrust|glute|gemelo|pantorrilla|talon|militar|hombro|elevacion lateral|elevacion frontal|pajaro|deltoid|tricep|frances|pushdown|bicep|curl|martillo|dominada|jalon|remo|dorsal|espalda|peso muerto|plancha|crunch|abdom|press banca|inclinado|apertura|pec deck|pecho|pectoral|fondos/.test(
      normExName
    );
  if (hasExplicitMuscleHint) {
    return canonicalizeMuscleGroup('', exerciseName);
  }
  return 'pendiente de revisión';
}

function buildDraftExerciseFromOcr(
  rawEx: OcrExtractedExerciseRaw,
  exIdx: number,
  dayIndex: number,
  library: LibraryExercise[] = EXERCISE_LIBRARY
): EditableOcrExercise {
  const rawNameClean = (rawEx.rawName || '').trim();
  const preferredName = (rawEx.normalizedName || rawNameClean).trim();
  const isNameMissing = isPendingMarker(preferredName);

  const matchResult = isNameMissing
    ? { matchedExercise: null, confidence: 'none' as const, score: 0, candidates: [] }
    : matchExerciseInLibrary(preferredName, rawEx.targetMuscles, library);

  const reviewFields = new Set<OcrReviewField>(toReviewFieldList(rawEx.unrecognizedFields));
  const reviewReasons: string[] = [];
  if (rawEx.reviewReason && rawEx.reviewReason.trim()) {
    reviewReasons.push(rawEx.reviewReason.trim());
  }

  const isExactLibraryMatch = matchResult.confidence === 'exact' && matchResult.matchedExercise !== null;

  if (isNameMissing) {
    reviewFields.add('name');
    if (reviewReasons.length === 0) {
      reviewReasons.push('Nombre del ejercicio no reconocible');
    }
  } else if (!isExactLibraryMatch) {
    reviewFields.add('libraryMatch');
    if (matchResult.candidates.length > 0) {
      reviewReasons.push(
        `No hay coincidencia exacta en biblioteca (sugerencia: "${matchResult.candidates[0].exercise.name}" o crear personalizado)`
      );
    } else {
      reviewReasons.push('Ejercicio no encontrado en biblioteca (vincúlalo o créalo como personalizado)');
    }
  }

  const parsedSets =
    typeof rawEx.sets === 'number' && Number.isFinite(rawEx.sets) && rawEx.sets > 0
      ? Math.min(Math.max(Math.round(rawEx.sets), 1), 12)
      : null;
  if (parsedSets === null) {
    reviewFields.add('sets');
    if (!reviewReasons.some((r) => r.toLowerCase().includes('serie'))) {
      reviewReasons.push('Series no visibles o ilegibles (pendiente de revisión)');
    }
  }

  const repsRaw = (rawEx.reps || '').trim();
  const repsMissing = isPendingMarker(repsRaw);
  const safeReps = repsMissing ? 'pendiente de revisión' : repsRaw;
  if (repsMissing) {
    reviewFields.add('reps');
    if (!reviewReasons.some((r) => r.toLowerCase().includes('rep'))) {
      reviewReasons.push('Repeticiones no visibles o ilegibles (pendiente de revisión)');
    }
  }

  const parsedWeight =
    typeof rawEx.weightKg === 'number' && Number.isFinite(rawEx.weightKg) && rawEx.weightKg >= 0
      ? rawEx.weightKg
      : null;

  const parsedRest =
    typeof rawEx.restSeconds === 'number' && Number.isFinite(rawEx.restSeconds) && rawEx.restSeconds > 0
      ? Math.round(rawEx.restSeconds)
      : null;
  if (parsedRest === null) {
    reviewFields.add('restSeconds');
    if (!reviewReasons.some((r) => r.toLowerCase().includes('descanso'))) {
      reviewReasons.push('Descanso no visible en el archivo (pendiente de revisión)');
    }
  }

  let resolvedMuscle = 'pendiente de revisión';
  if (rawEx.targetMuscles && !isPendingMarker(rawEx.targetMuscles)) {
    resolvedMuscle = canonicalizeMuscleGroup(rawEx.targetMuscles, preferredName);
  } else if (isExactLibraryMatch && matchResult.matchedExercise?.muscleGroup) {
    resolvedMuscle = canonicalizeMuscleGroup(
      matchResult.matchedExercise.muscleGroup,
      matchResult.matchedExercise.name
    );
  } else if (!isNameMissing) {
    resolvedMuscle = detectStrictMuscleFromText(null, preferredName);
    if (isPendingMarker(resolvedMuscle)) {
      reviewFields.add('targetMuscles');
    }
  } else {
    reviewFields.add('targetMuscles');
  }

  // Solo asignar el nombre oficial de biblioteca cuando hay coincidencia exacta; nunca renombrar movimientos diferentes
  const displayName = isNameMissing
    ? 'pendiente de revisión'
    : isExactLibraryMatch
    ? matchResult.matchedExercise!.name
    : preferredName;

  const needsReview = Boolean(rawEx.needsReview) || reviewFields.size > 0;

  return {
    draftId: `draft-ex-${dayIndex}-${exIdx}-${Math.random().toString(36).slice(2, 7)}`,
    order:
      typeof rawEx.order === 'number' && rawEx.order > 0 ? rawEx.order : exIdx + 1,
    rawOcrName: rawNameClean || 'pendiente de revisión',
    name: displayName,
    libraryExerciseId: isExactLibraryMatch ? matchResult.matchedExercise!.id : null,
    libraryMatchConfidence: matchResult.confidence,
    libraryCandidates: matchResult.candidates,
    isCustomExercise: false,
    targetMuscles: resolvedMuscle,
    equipment: isExactLibraryMatch ? matchResult.matchedExercise?.equipment || '' : '',
    thumbnailUrl: isExactLibraryMatch
      ? matchResult.matchedExercise?.thumbnailUrl || undefined
      : undefined,
    secondaryThumbnailUrl: isExactLibraryMatch
      ? matchResult.matchedExercise?.secondaryThumbnailUrl || undefined
      : undefined,
    defaultVideoUrl: isExactLibraryMatch
      ? matchResult.matchedExercise?.videoUrl || matchResult.matchedExercise?.url || undefined
      : undefined,
    sets: parsedSets,
    reps: safeReps,
    weightKg: parsedWeight,
    restSeconds: parsedRest,
    rpe: rawEx.rpe ? String(rawEx.rpe).trim() : '',
    notes: rawEx.notes ? String(rawEx.notes).trim() : '',
    sourceImageIndices: [
      typeof rawEx.sourceImageIndex === 'number' ? rawEx.sourceImageIndex : 0,
    ],
    needsReview,
    unrecognizedFields: Array.from(reviewFields),
    reviewReasons: Array.from(new Set(reviewReasons)),
    manuallyVerified: !needsReview,
  };
}

function buildDeduplicationKey(ex: EditableOcrExercise): string {
  if (ex.libraryExerciseId && ex.libraryMatchConfidence === 'exact') {
    return `lib:${ex.libraryExerciseId}`;
  }
  if (!isPendingMarker(ex.name)) {
    return `name:${normalizar(ex.name)}`;
  }
  return `pending:${ex.draftId}`;
}

function mergeDuplicateExercise(
  existing: EditableOcrExercise,
  incoming: EditableOcrExercise
): EditableOcrExercise {
  const mergedReasons = new Set(existing.reviewReasons);
  const mergedFields = new Set(existing.unrecognizedFields);
  const mergedSources = Array.from(
    new Set([...existing.sourceImageIndices, ...incoming.sourceImageIndices])
  ).sort((a, b) => a - b);

  let sets = existing.sets;
  if (sets === null && incoming.sets !== null) {
    sets = incoming.sets;
    mergedFields.delete('sets');
  } else if (sets !== null && incoming.sets !== null && sets !== incoming.sets) {
    mergedFields.add('conflict');
    mergedFields.add('sets');
    mergedReasons.add(`Discrepancia entre fuentes en series (${sets} vs ${incoming.sets})`);
  }

  let reps = existing.reps;
  if (isPendingMarker(reps) && !isPendingMarker(incoming.reps)) {
    reps = incoming.reps;
    mergedFields.delete('reps');
  } else if (
    !isPendingMarker(reps) &&
    !isPendingMarker(incoming.reps) &&
    normalizar(reps) !== normalizar(incoming.reps)
  ) {
    mergedFields.add('conflict');
    mergedFields.add('reps');
    mergedReasons.add(`Discrepancia entre fuentes en repeticiones ("${reps}" vs "${incoming.reps}")`);
  }

  let weightKg = existing.weightKg;
  if (weightKg === null && incoming.weightKg !== null) {
    weightKg = incoming.weightKg;
    mergedFields.delete('weightKg');
  } else if (
    weightKg !== null &&
    incoming.weightKg !== null &&
    weightKg !== incoming.weightKg
  ) {
    mergedFields.add('conflict');
    mergedFields.add('weightKg');
    mergedReasons.add(`Discrepancia entre fuentes en peso (${weightKg} kg vs ${incoming.weightKg} kg)`);
  }

  let restSeconds = existing.restSeconds;
  if (restSeconds === null && incoming.restSeconds !== null) {
    restSeconds = incoming.restSeconds;
    mergedFields.delete('restSeconds');
  } else if (
    restSeconds !== null &&
    incoming.restSeconds !== null &&
    restSeconds !== incoming.restSeconds
  ) {
    mergedFields.add('conflict');
    mergedFields.add('restSeconds');
    mergedReasons.add(`Discrepancia entre fuentes en descanso (${restSeconds}s vs ${incoming.restSeconds}s)`);
  }

  const notes =
    existing.notes && incoming.notes && existing.notes !== incoming.notes
      ? `${existing.notes} · ${incoming.notes}`
      : existing.notes || incoming.notes;

  const targetMuscles = !isPendingMarker(existing.targetMuscles)
    ? existing.targetMuscles
    : incoming.targetMuscles;

  const libraryExerciseId = existing.libraryExerciseId || incoming.libraryExerciseId;
  const needsReview = mergedFields.size > 0;

  return {
    ...existing,
    libraryExerciseId,
    sets,
    reps,
    weightKg,
    restSeconds,
    rpe: existing.rpe || incoming.rpe,
    notes,
    targetMuscles,
    sourceImageIndices: mergedSources,
    unrecognizedFields: Array.from(mergedFields),
    reviewReasons: Array.from(mergedReasons),
    needsReview,
    manuallyVerified: !needsReview,
  };
}

/**
 * Unifica los resultados extraídos (imágenes múltiples, PDF, Excel, CSV o JSON)
 * en días coherentes, empareja contra `EXERCISE_LIBRARY` sin confundir movimientos diferentes
 * y elimina duplicados conservando el orden de ejecución.
 */
export function unifyOcrDaysToDraft(
  detectedDays: OcrExtractedDayRaw[],
  options?: {
    detectedFormat?: string;
    warnings?: string[];
    library?: LibraryExercise[];
  }
): UnifiedOcrDraftSummary {
  const library = options?.library || EXERCISE_LIBRARY;
  const dayBuckets = new Map<
    string,
    {
      day: EditableOcrDay;
      exerciseMap: Map<string, EditableOcrExercise>;
    }
  >();

  let deduplicatedCount = 0;

  (detectedDays || []).forEach((rawDay, dayIdx) => {
    const rawDayText = (rawDay.dayName || '').trim();
    const rawTitleText = (rawDay.routineTitle || '').trim();
    const canonicalWeekday = resolveCanonicalDay(rawDayText, rawTitleText);
    const dayPending =
      !canonicalWeekday &&
      (isPendingMarker(rawDayText) || Boolean(rawDay.needsReview));

    const bucketKey = canonicalWeekday
      ? `weekday:${canonicalWeekday}`
      : !isPendingMarker(rawDayText)
      ? `custom:${normalizar(rawDayText)}`
      : `pending:${dayIdx}`;

    const resolvedDayName = canonicalWeekday
      ? canonicalWeekday
      : !isPendingMarker(rawDayText)
      ? rawDayText
      : 'pendiente de revisión';

    const resolvedTitle = !isPendingMarker(rawTitleText)
      ? rawTitleText
      : canonicalWeekday
      ? `Rutina ${canonicalWeekday}`
      : 'pendiente de revisión';

    if (!dayBuckets.has(bucketKey)) {
      dayBuckets.set(bucketKey, {
        day: {
          draftDayId: `draft-day-${dayIdx}-${Math.random().toString(36).slice(2, 7)}`,
          dayName: resolvedDayName,
          routineTitle: resolvedTitle,
          sourceImageIndices: Array.from(
            new Set(
              Array.isArray(rawDay.sourceImageIndices) && rawDay.sourceImageIndices.length > 0
                ? rawDay.sourceImageIndices
                : [0]
            )
          ).sort((a, b) => a - b),
          dayNeedsReview: dayPending || isPendingMarker(resolvedTitle),
          reviewReason:
            rawDay.reviewReason ||
            (dayPending ? 'Día no reconocido claramente en el archivo' : undefined),
          exercises: [],
        },
        exerciseMap: new Map(),
      });
    } else {
      const existingBucket = dayBuckets.get(bucketKey)!;
      existingBucket.day.sourceImageIndices = Array.from(
        new Set([
          ...existingBucket.day.sourceImageIndices,
          ...(rawDay.sourceImageIndices || []),
        ])
      ).sort((a, b) => a - b);
      if (isPendingMarker(existingBucket.day.routineTitle) && !isPendingMarker(resolvedTitle)) {
        existingBucket.day.routineTitle = resolvedTitle;
        existingBucket.day.dayNeedsReview = false;
      }
    }

    const bucket = dayBuckets.get(bucketKey)!;

    (rawDay.exercises || []).forEach((rawEx, exIdx) => {
      const draftEx = buildDraftExerciseFromOcr(rawEx, exIdx, dayIdx, library);
      const dedupKey = buildDeduplicationKey(draftEx);

      if (bucket.exerciseMap.has(dedupKey)) {
        deduplicatedCount += 1;
        const merged = mergeDuplicateExercise(bucket.exerciseMap.get(dedupKey)!, draftEx);
        bucket.exerciseMap.set(dedupKey, merged);
      } else {
        bucket.exerciseMap.set(dedupKey, draftEx);
      }
    });
  });

  const dayOrder = new Map<string, number>(CANONICAL_WEEKDAYS.map((d, i) => [d, i]));

  const days = Array.from(dayBuckets.values())
    .map((b) => {
      const ordered = Array.from(b.exerciseMap.values())
        .sort((a, bEx) => a.order - bEx.order)
        .map((ex, i) => ({ ...ex, order: i + 1 }));
      return {
        ...b.day,
        exercises: ordered,
      };
    })
    .filter((d) => d.exercises.length > 0)
    .sort((a, b) => (dayOrder.get(a.dayName) ?? 99) - (dayOrder.get(b.dayName) ?? 99));

  return computeDraftStats(days, {
    detectedFormat: options?.detectedFormat || 'Captura de rutina',
    warnings: options?.warnings || [],
    deduplicatedCount,
  });
}

export function computeDraftStats(
  days: EditableOcrDay[],
  meta?: {
    detectedFormat?: string;
    warnings?: string[];
    deduplicatedCount?: number;
  }
): UnifiedOcrDraftSummary {
  let totalExercises = 0;
  let matchedLibraryCount = 0;
  let customExercisesCount = 0;
  let pendingReviewExercisesCount = 0;
  let pendingReviewFieldsCount = 0;

  days.forEach((d) => {
    if (d.dayNeedsReview) {
      pendingReviewFieldsCount += 1;
    }
    d.exercises.forEach((ex) => {
      totalExercises += 1;
      if (ex.libraryExerciseId) {
        matchedLibraryCount += 1;
      } else if (ex.isCustomExercise) {
        customExercisesCount += 1;
      }
      if (ex.needsReview && !ex.manuallyVerified) {
        pendingReviewExercisesCount += 1;
        pendingReviewFieldsCount += Math.max(1, ex.unrecognizedFields.length);
      }
    });
  });

  return {
    days,
    detectedFormat: meta?.detectedFormat || 'Planificación',
    warnings: meta?.warnings || [],
    totalExercises,
    matchedLibraryCount,
    customExercisesCount,
    pendingReviewExercisesCount,
    pendingReviewFieldsCount,
    deduplicatedCount: meta?.deduplicatedCount || 0,
  };
}

/**
 * Re-evalúa una fila editada manualmente o marcada como ejercicio personalizado.
 */
export function revalidateEditedExercise(ex: EditableOcrExercise): EditableOcrExercise {
  const fields = new Set<OcrReviewField>();
  const reasons: string[] = [];

  if (isPendingMarker(ex.name)) {
    fields.add('name');
    reasons.push('Nombre pendiente de revisión');
  }
  if (ex.sets === null || ex.sets < 1 || ex.sets > 12) {
    fields.add('sets');
    reasons.push('Series pendientes de revisión');
  }
  if (isPendingMarker(ex.reps)) {
    fields.add('reps');
    reasons.push('Repeticiones pendientes de revisión');
  }
  if (ex.restSeconds === null || ex.restSeconds <= 0) {
    fields.add('restSeconds');
    reasons.push('Descanso pendiente de revisión');
  }
  if (isPendingMarker(ex.targetMuscles)) {
    fields.add('targetMuscles');
    reasons.push('Grupo muscular pendiente de revisión');
  }
  if (!ex.libraryExerciseId && !ex.isCustomExercise && !ex.manuallyVerified) {
    fields.add('libraryMatch');
    reasons.push('Vincular con biblioteca o crear ejercicio personalizado');
  }

  const needsReview = fields.size > 0;
  return {
    ...ex,
    unrecognizedFields: Array.from(fields),
    reviewReasons: reasons,
    needsReview,
    manuallyVerified: !needsReview,
  };
}

export function createCustomExerciseFromDraft(
  ex: EditableOcrExercise,
  overrides?: { equipment?: string; targetMuscles?: string }
): EditableOcrExercise {
  const next = {
    ...ex,
    isCustomExercise: true,
    libraryExerciseId: null,
    equipment: overrides?.equipment ?? ex.equipment ?? 'Personalizado',
    targetMuscles: overrides?.targetMuscles ?? ex.targetMuscles,
  };
  return revalidateEditedExercise(next);
}

/**
 * Convierte filas extraídas de Excel/CSV (sin ocultar campos faltantes) en `OcrExtractedDayRaw[]`.
 */
export function extractedRowsToRawDays(rows: ExtractedRoutineRow[]): OcrExtractedDayRaw[] {
  const dayMap = new Map<string, OcrExtractedDayRaw>();

  rows.forEach((row, idx) => {
    const dayKey = row.Dia || 'Lunes';
    if (!dayMap.has(dayKey)) {
      dayMap.set(dayKey, {
        dayName: dayKey,
        routineTitle: row.Rutina || `Rutina ${dayKey}`,
        sourceImageIndices: [0],
        needsReview: false,
        exercises: [],
      });
    }

    const bucket = dayMap.get(dayKey)!;
    const missingSets = Boolean(row.hasSetsWarning);
    const missingReps = Boolean(row.hasRepsWarning);
    const missingRest = Boolean(row.hasRestWarning);
    const hasExplicitMuscle = Boolean(row.rawMuscleValue && row.rawMuscleValue.trim());

    const unrecognized: string[] = [];
    const reasons: string[] = [];
    if (missingSets) {
      unrecognized.push('sets');
      reasons.push(row.setsWarningReason || 'Series no válidas o ausentes');
    }
    if (missingReps) {
      unrecognized.push('reps');
      reasons.push('Repeticiones ausentes en la planilla');
    }
    if (missingRest) {
      unrecognized.push('restSeconds');
      reasons.push('Descanso no especificado en la planilla');
    }

    const strictMuscle = hasExplicitMuscle
      ? row.Musculo
      : detectStrictMuscleFromText(null, row.Ejercicio);

    bucket.exercises.push({
      rawName: row.Ejercicio,
      normalizedName: row.Ejercicio,
      order: row.Orden || idx + 1,
      targetMuscles: isPendingMarker(strictMuscle) ? null : strictMuscle,
      sets: missingSets ? null : row.Series,
      reps: missingReps ? null : row.Repeticiones,
      weightKg: row.Peso > 0 ? row.Peso : null,
      restSeconds: missingRest ? null : row.DescansoSegundos,
      restText: missingRest ? null : row.DESCANSO,
      rpe: row.RPE || null,
      notes: row.Notas || null,
      sourceImageIndex: 0,
      needsReview: unrecognized.length > 0,
      unrecognizedFields: unrecognized,
      reviewReason: reasons.join(' · ') || undefined,
    });
  });

  return Array.from(dayMap.values());
}

/**
 * Parsea un JSON flexible (array de filas, `{ routines: [...] }`, `{ days: [...] }`, `{ detectedDays: [...] }`,
 * o una rutina única) ignorando workouts históricos para no alterar recuperación ni estadísticas.
 */
export function parseJsonTextToRawDays(jsonText: string): OcrExtractedDayRaw[] {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('El archivo JSON no tiene una sintaxis válida.');
  }

  // Formato directo `{ detectedDays: [...] }`
  if (parsed && Array.isArray(parsed.detectedDays)) {
    return parsed.detectedDays;
  }

  // Formato `{ routines: [...] }` o `{ days: [...] }` o rutina única `{ title, exercises }`
  const routineList: any[] | null = Array.isArray(parsed?.routines)
    ? parsed.routines
    : Array.isArray(parsed?.days)
    ? parsed.days
    : parsed && Array.isArray(parsed.exercises)
    ? [parsed]
    : null;

  if (routineList) {
    if (routineList.length === 0) {
      throw new Error('El JSON no contiene rutinas ni ejercicios.');
    }

    return routineList.map((r: any, dIdx: number) => {
      const rawDayName = String(r.dayName || r.dia || r.day || '').trim();
      const rawTitle = String(r.title || r.rutina || r.name || '').trim();
      const dayResolved = resolveCanonicalDay(rawDayName, rawTitle);
      const dayMissing = !dayResolved && !rawDayName;

      const exercises: OcrExtractedExerciseRaw[] = (Array.isArray(r.exercises) ? r.exercises : []).map(
        (ex: any, exIdx: number) => {
          const exName = String(ex.name || ex.nombre || ex.Ejercicio || ex.rawName || '').trim();
          const rawSets = ex.defaultSets ?? ex.series ?? ex.sets ?? ex.Series;
          const setsNum =
            rawSets !== undefined && rawSets !== null && rawSets !== '' && Number.isFinite(Number(rawSets)) && Number(rawSets) > 0
              ? Number(rawSets)
              : null;
          const repsVal = String(ex.repRange || ex.repeticiones || ex.reps || ex.Repeticiones || '').trim();
          const rawWeight = ex.defaultWeight ?? ex.weightKg ?? ex.weight ?? ex.Peso;
          const weightNum =
            rawWeight !== undefined && rawWeight !== null && rawWeight !== '' && Number.isFinite(Number(rawWeight))
              ? Number(rawWeight)
              : null;
          const rawRest = ex.restSeconds ?? ex.DescansoSegundos ?? ex.restText ?? ex.descanso ?? ex.DESCANSO;
          const restSecs =
            rawRest !== undefined && rawRest !== null && String(rawRest).trim() !== ''
              ? parseRestToSeconds(rawRest, 0).restSeconds || null
              : null;
          const rawMuscle = ex.targetMuscles || ex.muscleGroup || ex.musculo || ex.Musculo || null;

          const unrecognized: string[] = [];
          if (!exName) unrecognized.push('name');
          if (setsNum === null) unrecognized.push('sets');
          if (!repsVal) unrecognized.push('reps');
          if (restSecs === null) unrecognized.push('restSeconds');

          return {
            rawName: exName,
            normalizedName: exName,
            order: typeof ex.order === 'number' ? ex.order : exIdx + 1,
            targetMuscles: rawMuscle,
            sets: setsNum,
            reps: repsVal || null,
            weightKg: weightNum,
            restSeconds: restSecs,
            rpe: ex.rpe ? String(ex.rpe) : null,
            notes: ex.notes || ex.notas || null,
            sourceImageIndex: 0,
            needsReview: unrecognized.length > 0,
            unrecognizedFields: unrecognized,
          };
        }
      );

      return {
        dayName: dayResolved || rawDayName || 'pendiente de revisión',
        routineTitle: rawTitle || (dayResolved ? `Rutina ${dayResolved}` : 'pendiente de revisión'),
        sourceImageIndices: [0],
        needsReview: dayMissing,
        reviewReason: dayMissing ? 'Día no especificado en JSON' : undefined,
        exercises,
      };
    });
  }

  // Formato tabular en array de objetos `[{ Dia, Ejercicio, Series, Reps, Peso, Descanso }]`
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new Error('El arreglo JSON está vacío.');
    }
    const matrix: any[][] = [];
    const keys = Array.from(
      new Set(
        parsed.flatMap((row: any) => (row && typeof row === 'object' ? Object.keys(row) : []))
      )
    );
    if (keys.length === 0) {
      throw new Error('Formato JSON no reconocido para importar rutinas.');
    }
    matrix.push(keys);
    parsed.forEach((row: any) => {
      if (row && typeof row === 'object') {
        matrix.push(keys.map((k) => row[k] ?? ''));
      }
    });
    const extracted = parseExcelMatrixIterative(matrix, null, 'JSON');
    if (extracted.length === 0) {
      throw new Error('No se encontraron filas de ejercicios válidas en el JSON.');
    }
    return extractedRowsToRawDays(extracted);
  }

  throw new Error('Estructura JSON no compatible con rutinas de entrenamiento.');
}

/**
 * Parsea un CSV sin inventar datos faltantes y preservando advertencias de revisión.
 */
export function parseCsvTextToRawDays(csvText: string): OcrExtractedDayRaw[] {
  if (!csvText || !csvText.trim()) {
    throw new Error('El archivo CSV está vacío.');
  }

  const parsed = Papa.parse(csvText, {
    header: false,
    skipEmptyLines: true,
  });

  const rowsMatrix = (parsed.data || []) as string[][];
  if (rowsMatrix.length === 0) {
    throw new Error('No se pudieron leer filas del archivo CSV.');
  }

  const extractedRows = parseExcelMatrixIterative(rowsMatrix, null, 'CSV');
  if (extractedRows.length === 0) {
    throw new Error('No se detectaron ejercicios válidos en el archivo CSV.');
  }

  return extractedRowsToRawDays(extractedRows);
}

/**
 * Analiza un lote heterogéneo de archivos (XLSX, CSV, JSON, PDF o 1..N imágenes)
 * devolviendo un borrador unificado editable para revisión y confirmación obligatoria.
 */
export async function analyzeRoutineFilesToDraft(
  files: File[]
): Promise<UnifiedOcrDraftSummary> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Selecciona al menos un archivo para analizar.');
  }

  const formats = files.map((f) => ({ file: f, format: detectFileFormat(f) }));
  const unsupported = formats.find((f) => f.format === null);
  if (unsupported) {
    throw new Error(
      `Formato no soportado para "${unsupported.file.name}". Usa XLSX, CSV, JSON, PDF, PNG, JPG/JPEG o WEBP.`
    );
  }

  const primaryFormat = formats[0].format!;
  const allSameImageBatch = formats.every((f) => f.format === 'image');

  if (allSameImageBatch) {
    const prepared = await Promise.all(files.map((f) => prepareImageForUpload(f)));
    const response = await fetch('/api/routines/analyze-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: prepared.map((img) => ({
          data: img.dataUrl,
          mimeType: img.mimeType,
          fileName: img.fileName,
        })),
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(payload?.error || 'Error al analizar las imágenes con OCR.');
    }
    return unifyOcrDaysToDraft(payload.detectedDays || [], {
      detectedFormat: payload.detectedFormat || 'Imágenes OCR',
      warnings: payload.warnings || [],
    });
  }

  if (files.length > 1) {
    throw new Error(
      'Solo se permite subir múltiples archivos simultáneos cuando son capturas/imágenes de una misma rutina.'
    );
  }

  const targetFile = files[0];

  if (primaryFormat === 'xlsx') {
    const extractedRows = await procesarExcel(targetFile);
    if (!extractedRows || extractedRows.length === 0) {
      throw new Error('No se detectaron ejercicios en el archivo Excel.');
    }
    return unifyOcrDaysToDraft(extractedRowsToRawDays(extractedRows), {
      detectedFormat: 'Excel (.xlsx)',
    });
  }

  if (primaryFormat === 'csv') {
    const csvText = await targetFile.text();
    const rawDays = parseCsvTextToRawDays(csvText);
    return unifyOcrDaysToDraft(rawDays, {
      detectedFormat: 'Archivo CSV',
    });
  }

  if (primaryFormat === 'json') {
    const jsonText = await targetFile.text();
    const rawDays = parseJsonTextToRawDays(jsonText);
    return unifyOcrDaysToDraft(rawDays, {
      detectedFormat: 'Archivo JSON',
    });
  }

  if (primaryFormat === 'pdf') {
    const dataUrl = await readFileAsDataUrl(targetFile);
    const response = await fetch('/api/routines/analyze-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          {
            data: dataUrl,
            mimeType: 'application/pdf',
            fileName: targetFile.name,
          },
        ],
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(
        payload?.error ||
          'No se pudo extraer la rutina del PDF. Verifica la configuración del servicio de visión o la nitidez del documento.'
      );
    }
    return unifyOcrDaysToDraft(payload.detectedDays || [], {
      detectedFormat: payload.detectedFormat || 'Documento PDF',
      warnings: payload.warnings || [],
    });
  }

  throw new Error('Formato de archivo no reconocido.');
}

/**
 * Convierte el borrador editado y EXPLÍCITAMENTE confirmado por el atleta
 * en rutinas estándar de LAZCAKONGYM listas para guardar en `useGymState`.
 * NUNCA genera entrenamientos completados ni modifica el historial o estado de recuperación.
 */
export function buildImportResultFromConfirmedDraft(
  confirmedDays: EditableOcrDay[],
  options?: {
    existingRoutines?: Routine[];
    mergeMode?: RoutineImportMode;
    confirmReplaceExisting?: boolean;
    sourceFormat?: string;
  }
): CsvImportResult {
  const timestamp = Date.now();
  const importedPlanId = `plan-imp-${timestamp}`;
  const importedAtIso = new Date(timestamp).toISOString();

  const importedDayRoutines: Routine[] = confirmedDays
    .filter((d) => d.exercises.length > 0)
    .map((day, dIdx) => {
      const resolvedDay =
        resolveCanonicalDay(day.dayName, day.routineTitle) ||
        CANONICAL_WEEKDAYS[dIdx % CANONICAL_WEEKDAYS.length];

      const cleanTitle = !isPendingMarker(day.routineTitle)
        ? day.routineTitle.trim()
        : `Rutina ${resolvedDay}`;

      const sortedExercises = [...day.exercises].sort((a, b) => a.order - b.order);

      const exercises: Exercise[] = sortedExercises.map((ex, eIdx) => {
        const cleanName = !isPendingMarker(ex.name)
          ? ex.name.trim()
          : ex.rawOcrName && !isPendingMarker(ex.rawOcrName)
          ? ex.rawOcrName.trim()
          : `Ejercicio ${eIdx + 1}`;

        const safeSets =
          typeof ex.sets === 'number' && ex.sets > 0
            ? Math.min(Math.max(Math.round(ex.sets), 1), 6)
            : 3;

        const safeReps = !isPendingMarker(ex.reps) ? ex.reps.trim() : '8-12';
        const safeRest =
          typeof ex.restSeconds === 'number' && ex.restSeconds > 0
            ? Math.round(ex.restSeconds)
            : 90;

        const targetMuscles = !isPendingMarker(ex.targetMuscles)
          ? canonicalizeMuscleGroup(ex.targetMuscles, cleanName)
          : canonicalizeMuscleGroup('', cleanName);

        return {
          id: `ex-imp-${normalizar(resolvedDay)}-${timestamp}-${dIdx}-${eIdx}`,
          name: cleanName,
          targetMuscles,
          defaultSets: safeSets,
          repRange: safeReps,
          restSeconds: safeRest,
          restText: `${safeRest} seg`,
          objective: ex.isCustomExercise
            ? 'Ejercicio personalizado · Progresión'
            : 'Hipertrofia & Progresión',
          defaultVideoUrl:
            ex.defaultVideoUrl || '',
          thumbnailUrl: ex.thumbnailUrl,
          secondaryThumbnailUrl: ex.secondaryThumbnailUrl,
          equipment: ex.equipment || (ex.isCustomExercise ? 'Personalizado' : undefined),
          defaultWeight:
            typeof ex.weightKg === 'number' && ex.weightKg > 0 ? ex.weightKg : undefined,
          notes: ex.notes || undefined,
          notas: ex.notes || undefined,
          techniqueCues: ex.notes
            ? [ex.notes]
            : ['Técnica controlada y rango completo de movimiento'],
          dia: resolvedDay,
          day: resolvedDay,
        };
      });

      return {
        id: `rutina-imp-${normalizar(resolvedDay)}-${timestamp}-${dIdx}`,
        dayName: resolvedDay,
        title: cleanTitle,
        tagline: `${exercises.length} ejercicios • ${exercises.reduce(
          (acc, e) => acc + (e.defaultSets || 3),
          0
        )} series`,
        exercises,
        isCustom: true,
        importedPlanId,
        importedAt: importedAtIso,
        sourceFormat: options?.sourceFormat,
        accentColor: '#CCFF00',
      };
    });

  const existing = options?.existingRoutines || [];
  const requestedMode: RoutineImportMode = options?.mergeMode || 'append_new';
  const safeMode: RoutineImportMode =
    requestedMode === 'replace_all' && options?.confirmReplaceExisting !== true
      ? 'append_new'
      : requestedMode;

  let routinesToConsolidate: Routine[];
  if (safeMode === 'replace_all' && options?.confirmReplaceExisting === true) {
    routinesToConsolidate = importedDayRoutines;
  } else if (safeMode === 'merge_days' && existing.length > 0) {
    const importedDaysSet = new Set(
      importedDayRoutines.map((r) => resolveCanonicalDay(r.dayName, r.title) || r.dayName)
    );
    const preservedExisting = existing.filter((r) => {
      const rDay = resolveCanonicalDay(r.dayName, r.title) || r.dayName;
      return !importedDaysSet.has(rDay);
    });
    routinesToConsolidate = [...preservedExisting, ...importedDayRoutines];
  } else {
    // 'append_new' (por defecto): conservar 100% de rutinas existentes sin eliminar ni sobrescribir ninguna
    routinesToConsolidate = [...existing, ...importedDayRoutines];
  }

  const consolidated = consolidateWeeklyRoutines(routinesToConsolidate);
  const totalExercises = importedDayRoutines.reduce(
    (acc, r) => acc + r.exercises.length,
    0
  );

  // Garantía: workouts SIEMPRE vacío, prs SIEMPRE vacío y preserveWorkoutsAndHistory true
  return {
    routines: consolidated,
    workouts: [],
    prs: {},
    importMode: safeMode,
    confirmReplaceExisting: Boolean(options?.confirmReplaceExisting),
    preserveWorkoutsAndHistory: true,
    stats: {
      totalRows: totalExercises,
      routinesCreated: importedDayRoutines.length,
      routineNames: importedDayRoutines.map((r) => r.title),
      workoutsCreated: 0,
      prsCreated: 0,
    },
  };
}
