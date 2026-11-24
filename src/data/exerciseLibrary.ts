import libraryData from './exerciseLibrary.json';
import { NECK_EXERCISE_ADDITIONS } from './neckExerciseAdditions';
import { getNeckMovementSpec } from '../utils/neckMovementSpec';
import aliases from './exerciseAliases.json';
import type {
  Canonical16MuscleGroupId,
  Canonical9EquipmentId,
  EliteExerciseRecord,
  ExerciseDifficultyLevel,
  ExerciseMovementType,
  ExerciseVisualResourceStatus,
  LibraryExercise,
} from '../types';
export type {
  Canonical16MuscleGroupId,
  Canonical9EquipmentId,
  EliteExerciseRecord,
  ExerciseDifficultyLevel,
  ExerciseMovementType,
  ExerciseVisualResourceStatus,
  LibraryExercise,
};

export const BASE_EXERCISE_MEDIA_URL =
  'https://raw.githubusercontent.com/Lazcakong-33/LAZCAKONGYM/80b84ddf2588953586d5d21a5bdf455915b9b213/public/exercise-library/';

// Verified local assets bundled in public/exercise-library/ that are served directly from origin
const LOCAL_VERIFIED_EXERCISE_MEDIA = new Set<string>([
  'press_plano_con_barra.gif',
  // Etapa 2A — Posters de referencia técnica reales generados y validados en WebP
  'aa5dabc7-300e-4fc4-99d7-32bc05815966-poster.webp',
  'e83f2499-d624-417b-9bf0-b1f1430de20e-poster.webp',
  '2aa6471b-ddfc-4175-8455-1b6dd1b52fca-poster.webp',
  '53165adb-d65b-4372-988a-911a9d5a2c92-poster.webp',
  'ecfc75bd-87b8-4d33-8a86-288d1260d682-poster.webp',
  '26624b2b-aed8-4ce1-ad06-dd86fe0b5222-poster.webp',
  'e59e9e42-db8f-4294-8b13-ef75567dd614-poster.webp',
  '5b53a888-f1de-407f-a422-cdef8f836a9c-poster.webp',
  '2cd7d9d7-7a7e-4b4e-9d9b-1e1ee7a32441-poster.webp',
]);

function extractLibraryFilename(url?: string | null): string {
  if (!url) return '';
  return url
    .replace(/^\/exercise-library\//, '')
    .replace(/^exercise-library\//, '')
    .replace(/^\//, '');
}

// Discard obsolete library media (old local relative paths or dead CDN domains), retaining external URLs, user photos, and verified local assets.
export function isObsoleteLibraryMedia(url?: string | null): boolean {
  if (!url) return false;
  if (/(?:^|[/.])smartworkout\.app(?:[/:]|$)/i.test(url)) return true;
  if (url.startsWith('/exercise-library/') || url.startsWith('exercise-library/')) {
    const clean = extractLibraryFilename(url);
    return !LOCAL_VERIFIED_EXERCISE_MEDIA.has(clean);
  }
  return false;
}

export function resolveMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  const cleanPath = extractLibraryFilename(url);
  if (LOCAL_VERIFIED_EXERCISE_MEDIA.has(cleanPath)) {
    return `/exercise-library/${cleanPath}`;
  }
  return `${BASE_EXERCISE_MEDIA_URL}${cleanPath}`;
}

export function getExerciseFallbackAnimationUrl(id?: string): string | null {
  if (!id || !byId.has(id)) return null;
  const ex = byId.get(id)!;
  if (ex.visualResourceStatus === 'pending_resource' && !ex.videoUrl && !ex.animationUrl) {
    return null;
  }
  return `${BASE_EXERCISE_MEDIA_URL}${id}.webp`;
}

// Existing records stay stable: append unique neck IDs without migrating or altering athlete history.
const rawLibrary: LibraryExercise[] = [
  ...(libraryData as LibraryExercise[]),
  ...NECK_EXERCISE_ADDITIONS,
];

export const EXERCISE_LIBRARY: LibraryExercise[] = rawLibrary.map((ex) => {
  const resolvedVideo = resolveMediaUrl(ex.videoUrl);
  const resolvedAnim = resolveMediaUrl(ex.animationUrl) || undefined;
  const resolvedThumb = resolveMediaUrl(ex.thumbnailUrl);
  const resolvedSecondary = resolveMediaUrl(ex.secondaryThumbnailUrl);
  const hasNeckMotionDemo = getNeckMovementSpec(ex) !== null;
  const isPendingWithoutMotion =
    ex.visualResourceStatus === 'pending_resource' && !resolvedVideo && !resolvedAnim;
  return {
    ...ex,
    videoUrl: resolvedVideo,
    animationUrl: resolvedAnim,
    thumbnailUrl: resolvedThumb,
    secondaryThumbnailUrl: resolvedSecondary,
    // Render the actual animated SVG player; do NOT claim this is a verified GIF/MP4.
    visualResourceStatus: hasNeckMotionDemo ? 'frame_sequence' : ex.visualResourceStatus,
    frames: hasNeckMotionDemo ? 8 : ex.frames,
    durationMs: hasNeckMotionDemo ? 4000 : ex.durationMs,
    url:
      resolveMediaUrl(ex.url) ||
      resolvedThumb ||
      (isPendingWithoutMotion || hasNeckMotionDemo ? '' : `${BASE_EXERCISE_MEDIA_URL}${ex.id}.webp`),
  };
});

export const normalizeExerciseName = (name: string): string =>
  (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

export const normalizeText = normalizeExerciseName;

const byId = new Map(EXERCISE_LIBRARY.map((ex) => [ex.id, ex]));

export function getLibraryExerciseById(id?: string): LibraryExercise | undefined {
  return id ? byId.get(id) : undefined;
}

const legacyIds: Record<string, string> = aliases.ids;
const rawExactNames: Record<string, string[]> = aliases.names;
const excludedIds = new Set<string>(aliases.excludedIds);

// Index both normalized alias keys and normalized official catalog names without losing multi-candidate ambiguity.
const normalizedExactNames = new Map<string, string[]>();

const addNormalizedIndexEntry = (rawKey: string, id: string) => {
  const normKey = normalizeExerciseName(rawKey);
  if (!normKey || !byId.has(id)) return;
  const list = normalizedExactNames.get(normKey) || [];
  if (!list.includes(id)) {
    list.push(id);
    normalizedExactNames.set(normKey, list);
  }
};

for (const [aliasKey, ids] of Object.entries(rawExactNames)) {
  for (const id of ids) {
    addNormalizedIndexEntry(aliasKey, id);
  }
}

for (const ex of EXERCISE_LIBRARY) {
  addNormalizedIndexEntry(ex.name, ex.id);
}

const ELITE_EXTRA_ALIASES: Record<string, string> = {
  "press de banca plano con barra": "dba6c9ac-e99c-4486-5c88-7ff4403c4608",
  "press plano con barra": "dba6c9ac-e99c-4486-5c88-7ff4403c4608",
  "press banca": "dba6c9ac-e99c-4486-5c88-7ff4403c4608",
  "bench press": "dba6c9ac-e99c-4486-5c88-7ff4403c4608",
  "flat barbell bench press": "dba6c9ac-e99c-4486-5c88-7ff4403c4608",
  "press plano con mancuernas": "986f0a86-2d1e-47c5-02c2-57659ac4e005",
  "press plano en maquina smith": "5d581dce-e35e-45cc-94eb-f9bb8103a455",
  "press plano en maquina convergente": "da6b09eb-e55d-42cd-988d-1454658c1a4f",
  "press inclinado con barra": "10544e2e-3765-1ba9-b753-c9ccd60b06d4",
  "press inclinado con mancuernas": "61505ee2-7f37-fb06-2519-db3b9f20087d",
  "press declinado con barra": "69e26a9b-29bd-c232-8614-7985c1a70c15",
  "press declinado": "69e26a9b-29bd-c232-8614-7985c1a70c15",
  "press declinado con mancuernas": "c30468f2-024b-79d4-df35-0c937e391555",
  "press de banca con agarre cerrado": "17d168cd-9745-60f3-f30f-7ec574eaf8a3",
  "press cerrado": "17d168cd-9745-60f3-f30f-7ec574eaf8a3",
  "press de banca con pausa": "d892e142-f3e2-5df0-8fd4-c5b4d9b8b219",
  "aperturas en maquina": "d62736b5-9f97-39cd-7596-1189d05863e9",
  "cruces en polea alta": "048f0d34-855e-4bff-ff32-a2d851a8757d",
  "elevaciones laterales": "ac965c65-7896-c2f8-4ab2-5bda19534b41",
  "press con mancuernas": "5b2bdea5-ceee-a837-596c-fd2f6138ffff",
  "pajaros con mancuernas": "876b0346-eb4e-4ca7-beda-b5825c8e622d",
  "curl con barra z": "6f35ebb5-d31e-1ab7-310f-25b8cada0293",
  "curl inclinado con mancuernas": "89d00daa-f73b-4391-84d1-803ac433363e",
  "curl martillo": "6b210054-5434-1bf3-923e-62e137c41216",
  "curl martillo con mancuernas": "6b210054-5434-1bf3-923e-62e137c41216",
  "paseo del granjero": "2f471d53-3998-40e5-bfb3-542da8be66af",
  "curl de muneca": "d9aea411-b71e-4105-ac8d-82746432c8f0",
  "curl inverso con barra": "b03f3b8c-b957-4838-b198-eeda7a389132",
  "elevacion de piernas colgado": "806178d3-cc6d-4295-8263-a21ea9be34b7",
  "rueda abdominal": "149f6670-3321-4e86-a231-796f1c26a1a4",
  "crunch en polea alta": "ef7a226a-8ebe-4ed3-b712-33a548503195",
  "press pallof": "d0e78959-c1de-400c-a7fb-44c1015d5013",
  "pallof press": "d0e78959-c1de-400c-a7fb-44c1015d5013",
  "zancadas bulgaras": "cf88eb6f-6101-49f1-a493-ef959eb12cb6",
  "sentadilla hack": "8ae59cb6-8a70-4eb6-b2b3-35abe8060f0f",
  "sentadilla profunda": "145b65df-1575-4204-852c-0e3f24b29139",
  "prensa pies bajos": "084947cf-098f-62f2-36b2-41547577e2b8",
  "maquina de aductores": "142bd4e5-6755-42e2-83ad-cbfcf6388dab",
  "elevacion de talones de pie": "085cfcf8-548d-44df-8e92-eb9936752382",
  "gemelos en prensa": "187d7214-9b1e-4f2d-b028-f2aebd561d8b",
  "elevacion en maquina": "c33a0ac1-5d07-d66c-fc7c-8360786726da",
  "encogimientos con barra": "963e4937-5b35-480d-e91e-f8f53b2cc64e",
  "encogimientos con mancuernas": "61fb6b76-1d67-48f8-abba-bca2c60db1f9",
  "face pull en polea": "5847de4c-699f-4a50-a7a8-3815f8ddaf49",
  "face pull": "5847de4c-699f-4a50-a7a8-3815f8ddaf49",
  "remo con barra": "0c3e27ed-e95b-7611-a3e8-7dab63585d21",
  "remo con barra t": "4867c4b9-6939-4a7f-ba29-282550b7c7e6",
  "remo con mancuerna": "4a808b86-385e-28a7-460b-aad50695af11",
  "jalon al pecho": "5b5ad96b-a5d1-a271-9b57-aa0dfda9d77b",
  "jalon en polea alta": "5b5ad96b-a5d1-a271-9b57-aa0dfda9d77b",
  "dominadas pronas": "04141712-a8e2-49df-9e46-ba6204ae5edf",
  "peso muerto convencional": "20890a96-f92a-cfc8-3447-239d273136df",
  "peso muerto rumano con barra": "bde8a221-1dd3-40ec-bf89-b26d8e991b77",
  "hiperextensiones 45": "936daf5c-18b4-57f6-ba3e-184051b2cc12",
  "buenos dias": "2811badd-ff6d-946b-c36f-aae77cd6fa38",
  "press frances con barra z": "27433624-9149-4eba-b527-9314b99d8a2c",
  "press frances con barra ez": "27433624-9149-4eba-b527-9314b99d8a2c",
  "extensiones en polea": "a97e86f2-1e9a-2d2a-1968-a886c9c3560a",
  "extensiones en polea con cuerda": "fe01e50a-b97c-4bb7-87f2-bed05cfa2445",
  "triceps con cuerda": "fe01e50a-b97c-4bb7-87f2-bed05cfa2445",
  "abduccion en maquina": "c0d708f6-00ab-118f-9f7d-e13f27e5458b",
  "patada lateral en polea": "245e0727-1c35-4965-aa28-0456d8969828",
  "curl femoral tumbado": "bdfbf8c4-7d96-f9bd-f441-523c1a434312",
  "curl femoral acostado": "bdfbf8c4-7d96-f9bd-f441-523c1a434312",
  "curl femoral": "bdfbf8c4-7d96-f9bd-f441-523c1a434312",
  "curl femoral sentado": "3ae8ee86-534c-0824-07b6-e9f105b97c1d",
  "press de pecho en maquina": "d04e4922-8aec-4584-9657-ceda935dc57e",
  "press pecho maquina": "d04e4922-8aec-4584-9657-ceda935dc57e",
  "prensa": "e17ca855-8185-fbc6-bb54-ab9c4334f0f7",
  "prensa de piernas": "e17ca855-8185-fbc6-bb54-ab9c4334f0f7",
  "prensa 45": "e17ca855-8185-fbc6-bb54-ab9c4334f0f7",
  "gemelos": "c33a0ac1-5d07-d66c-fc7c-8360786726da",
  "abductores": "c0d708f6-00ab-118f-9f7d-e13f27e5458b",
  "remo sentado": "c6c9eeca-3ee1-4a8b-b34a-496b35c5dd53",
  "curl de biceps": "fedc49a5-593a-47fb-86db-7efdc8e6a7fe",
  "zancadas laterales": "850e7678-377e-475c-81d9-1f4f8c22d5a0",
  "tirones en y": "f26239fc-4bed-4f4f-a788-0e08235259a7",
};
for (const [alias, id] of Object.entries(ELITE_EXTRA_ALIASES)) {
  addNormalizedIndexEntry(alias, id);
}

const alternativeNamesById = new Map<string, string[]>();
const registerAlternativeName = (id: string, name: string) => {
  const clean = (name || '').trim();
  if (!clean || !byId.has(id)) return;
  const official = byId.get(id)!.name;
  if (normalizeExerciseName(clean) === normalizeExerciseName(official)) return;
  const list = alternativeNamesById.get(id) || [];
  if (!list.some((existing) => normalizeExerciseName(existing) === normalizeExerciseName(clean))) {
    list.push(clean);
    alternativeNamesById.set(id, list);
  }
};
for (const [aliasKey, ids] of Object.entries(rawExactNames)) {
  for (const id of ids) registerAlternativeName(id, aliasKey);
}
for (const [aliasKey, id] of Object.entries(ELITE_EXTRA_ALIASES)) {
  registerAlternativeName(id, aliasKey);
}

export type ExerciseLookupInput =
  | string
  | {
      id?: string;
      sourceId?: string;
      libraryExerciseId?: string;
      name?: string;
      equipment?: string;
    };

/**
 * Resolves a library exercise strictly by explicit ID, exact normalized catalog name,
 * or unequivocal alias (optionally disambiguated by equipment).
 * Never assigns images by fuzzy/substring similarity; never mutates routine IDs or records.
 */
export function resolveLibraryExercise(input: ExerciseLookupInput): LibraryExercise | undefined {
  const query = typeof input === 'string' ? { name: input } : input;

  for (const rawId of [
    query.libraryExerciseId,
    query.sourceId,
    query.id,
    query.id?.replace(/^cat-/, ''),
  ]) {
    if (rawId) {
      const match = byId.get(legacyIds[rawId] || rawId);
      if (match) return match;
    }
  }

  if (query.id && excludedIds.has(query.id)) {
    return undefined;
  }

  const normName = normalizeExerciseName(query.name || '');
  if (!normName) return undefined;

  const exactIds = normalizedExactNames.get(normName) || [];
  const candidates = exactIds.map((id) => byId.get(id)!).filter(Boolean);

  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length > 1 && query.equipment) {
    const eqNorm = normalizeExerciseName(query.equipment);
    const filtered = candidates.filter(
      (ex) =>
        normalizeExerciseName(ex.equipment || '') === eqNorm ||
        ex.allEquipment?.some((eq) => normalizeExerciseName(eq) === eqNorm)
    );
    if (filtered.length === 1) {
      return filtered[0];
    }
  }

  return undefined;
}

const STOP_WORDS = new Set([
  'de',
  'con',
  'en',
  'la',
  'el',
  'los',
  'las',
  'al',
  'a',
  'y',
  'o',
  'para',
  'por',
  'un',
  'una',
]);

function tokenizeForCandidateSuggestions(name: string): string[] {
  return normalizeExerciseName(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

export interface LibraryCandidateLookupResult {
  exactMatch?: LibraryExercise;
  candidates: LibraryExercise[];
  isAmbiguous: boolean;
}

/**
 * Returns exact match if unambiguous, or ranked candidate suggestions strictly for manual user
 * selection in the correspondence picker UI (never applied automatically).
 */
export function findLibraryExerciseCandidates(
  input: ExerciseLookupInput,
  limit: number = 12
): LibraryCandidateLookupResult {
  const exactMatch = resolveLibraryExercise(input);
  if (exactMatch) {
    return {
      exactMatch,
      candidates: [exactMatch],
      isAmbiguous: false,
    };
  }

  const query = typeof input === 'string' ? { name: input } : input;
  const normName = normalizeExerciseName(query.name || '');
  if (!normName) {
    return { candidates: [], isAmbiguous: false };
  }

  const exactIds = normalizedExactNames.get(normName) || [];
  const directCandidates = exactIds.map((id) => byId.get(id)!).filter(Boolean);
  if (directCandidates.length > 1) {
    return {
      candidates: directCandidates.slice(0, limit),
      isAmbiguous: true,
    };
  }

  const rawTokens = tokenizeForCandidateSuggestions(normName);
  if (rawTokens.length === 0) {
    return { candidates: [], isAmbiguous: false };
  }

  //Expand Spanish gym terms strictly for ranking UI candidate suggestions (never auto-assigned)
  const qTokens = new Set<string>(rawTokens);
  if (qTokens.has('femoral')) {
    qTokens.add('pierna');
    qTokens.add('isquiotibiales');
  }
  if (qTokens.has('abductores') || qTokens.has('abductor')) {
    qTokens.add('abduccion');
  }
  if (qTokens.has('gemelos') || qTokens.has('gemelo')) {
    qTokens.add('pantorrilla');
  }

  const scored: { ex: LibraryExercise; score: number }[] = [];
  for (const ex of EXERCISE_LIBRARY) {
    const exNorm = normalizeExerciseName(ex.name);
    const exTokens = tokenizeForCandidateSuggestions(exNorm);
    if (exTokens.length === 0) continue;

    let hits = 0;
    for (const qt of qTokens) {
      if (
        exTokens.some(
          (et) =>
            et === qt ||
            (qt.length >= 4 && et.startsWith(qt)) ||
            (et.length >= 4 && qt.startsWith(et)) ||
            (qt.length >= 5 && et.length >= 5 && qt.slice(0, 5) === et.slice(0, 5))
        )
      ) {
        hits += rawTokens.includes(qt) ? 1 : 0.75;
      }
    }
    if (hits === 0) continue;

    const score = (2 * hits) / (rawTokens.length + exTokens.length);
    if (score >= 0.25 || hits >= 1.5) {
      scored.push({ ex, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.slice(0, limit).map((item) => item.ex);
  return {
    candidates,
    isAmbiguous: candidates.length > 0,
  };
}

export type CanonicalCatalogMuscleId =
  | 'all'
  | 'chest'
  | 'back'
  | 'quadriceps'
  | 'hamstrings'
  | 'glutes'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'calves'
  | 'abdominals'
  | 'forearms'
  | 'traps'
  | 'neck'
  | 'adductors_abductors'
  | 'power'
  | 'mobility'
  | 'legs';

export function normalizeMuscleToken(value?: string | null): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MUSCLE_EQUIVALENCE_MAP: Record<string, CanonicalCatalogMuscleId> = {
  // All
  todos: 'all',
  todas: 'all',
  all: 'all',

  // Chest / Pectorales
  pecho: 'chest',
  pechos: 'chest',
  pectoral: 'chest',
  pectorales: 'chest',
  pectorals: 'chest',
  'pectoral mayor': 'chest',
  'pectoral mayor clavicular': 'chest',
  'pectoral superior': 'chest',
  'pectoral medio': 'chest',
  'pectoral inferior': 'chest',
  chest: 'chest',

  // Back / Espalda
  espalda: 'back',
  espaldas: 'back',
  dorsal: 'back',
  dorsales: 'back',
  'dorsal ancho': 'back',
  latissimus: 'back',
  'latissimus dorsi': 'back',
  lat: 'back',
  lats: 'back',
  romboide: 'back',
  romboides: 'back',
  rhomboid: 'back',
  rhomboids: 'back',
  'spinal erectors': 'back',
  'erector espinal': 'back',
  'erectores espinales': 'back',
  lumbar: 'back',
  lumbares: 'back',
  back: 'back',

  // Traps / Trapecios
  trapecio: 'traps',
  trapecios: 'traps',
  'trapecio superior': 'traps',
  'trapecio medio': 'traps',
  'trapecio inferior': 'traps',
  trapezius: 'traps',
  'middle trapezius': 'traps',
  traps: 'traps',

  // Neck / Cuello
  cuello: 'neck',
  cervical: 'neck',
  neck: 'neck',

  // Quadriceps / Cuádriceps
  cuadricep: 'quadriceps',
  cuadriceps: 'quadriceps',
  quadricep: 'quadriceps',
  quadriceps: 'quadriceps',
  quad: 'quadriceps',
  quads: 'quadriceps',

  // Hamstrings / Isquiotibiales
  isquiotibial: 'hamstrings',
  isquiotibiales: 'hamstrings',
  isquiosural: 'hamstrings',
  isquiosurales: 'hamstrings',
  isquio: 'hamstrings',
  isquios: 'hamstrings',
  femoral: 'hamstrings',
  femorales: 'hamstrings',
  hamstring: 'hamstrings',
  hamstrings: 'hamstrings',

  // Glutes / Glúteos
  gluteo: 'glutes',
  gluteos: 'glutes',
  glute: 'glutes',
  glutes: 'glutes',
  'gluteo mayor': 'glutes',
  'gluteo medio': 'glutes',
  'gluteo menor': 'glutes',

  // Shoulders / Hombros / Deltoides
  hombro: 'shoulders',
  hombros: 'shoulders',
  deltoide: 'shoulders',
  deltoides: 'shoulders',
  deltoid: 'shoulders',
  deltoids: 'shoulders',
  'deltoides anterior': 'shoulders',
  'deltoides medio': 'shoulders',
  'deltoides lateral': 'shoulders',
  'deltoides posterior': 'shoulders',
  'rear deltoid': 'shoulders',
  'rear deltoids': 'shoulders',
  shoulder: 'shoulders',
  shoulders: 'shoulders',
  'rotator cuff': 'shoulders',
  'manguito rotador': 'shoulders',
  supraespinoso: 'shoulders',
  infraespinoso: 'shoulders',
  'redondo menor': 'shoulders',

  // Biceps / Bíceps
  bicep: 'biceps',
  biceps: 'biceps',
  'biceps braquial': 'biceps',
  brachialis: 'biceps',
  braquial: 'biceps',

  // Triceps / Tríceps
  tricep: 'triceps',
  triceps: 'triceps',

  // Calves / Pantorrillas / Gemelos
  pantorrilla: 'calves',
  pantorrillas: 'calves',
  gemelo: 'calves',
  gemelos: 'calves',
  calf: 'calves',
  calves: 'calves',
  gastrocnemio: 'calves',
  gastrocnemios: 'calves',
  soleo: 'calves',
  soleos: 'calves',

  // Abdominals / Abdomen / Abdominales / Core
  abdomen: 'abdominals',
  abdomenes: 'abdominals',
  'abdomen y core': 'abdominals',
  abdominal: 'abdominals',
  abdominales: 'abdominals',
  abdominals: 'abdominals',
  ab: 'abdominals',
  abs: 'abdominals',
  'recto abdominal': 'abdominals',
  oblicuo: 'abdominals',
  oblicuos: 'abdominals',
  oblique: 'abdominals',
  obliques: 'abdominals',
  core: 'abdominals',

  // Forearms / Antebrazos
  antebrazo: 'forearms',
  antebrazos: 'forearms',
  forearm: 'forearms',
  forearms: 'forearms',
  braquiorradial: 'forearms',

  // Adductors & Abductors / Aductores y abductores
  'aductores y abductores': 'adductors_abductors',
  aductor: 'adductors_abductors',
  aductores: 'adductors_abductors',
  adductor: 'adductors_abductors',
  adductors: 'adductors_abductors',
  abductor: 'adductors_abductors',
  abductores: 'adductors_abductors',
  'hip adductor': 'adductors_abductors',
  'hip adductors': 'adductors_abductors',

  // Power & Explosiveness / Potencia y explosividad
  'potencia y explosividad': 'power',
  potencia: 'power',
  explosividad: 'power',
  pliometria: 'power',

  // Mobility & Conditioning / Movilidad y acondicionamiento
  'movilidad y acondicionamiento': 'mobility',
  movilidad: 'mobility',
  acondicionamiento: 'mobility',
  cardio: 'mobility',
  cardiovascular: 'mobility',

  // Broad legs group (kept strictly separate from specific quad/hamstring/calf filters)
  pierna: 'legs',
  piernas: 'legs',
  leg: 'legs',
  legs: 'legs',
  'flexores cadera': 'legs',
};

export function resolveCanonicalMuscleFilter(raw?: string | null): CanonicalCatalogMuscleId | null {
  const norm = normalizeMuscleToken(raw);
  if (!norm) return null;
  if (MUSCLE_EQUIVALENCE_MAP[norm]) {
    return MUSCLE_EQUIVALENCE_MAP[norm];
  }
  return null;
}

export function resolveCanonicalMusclesFromText(raw?: string | null): CanonicalCatalogMuscleId[] {
  const cleaned = normalizeMuscleToken(raw);
  if (!cleaned) return [];

  const direct = resolveCanonicalMuscleFilter(cleaned);
  if (direct && direct !== 'all') return [direct];

  const parts = cleaned
    .split(/[,;/·&|+]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const result = new Set<CanonicalCatalogMuscleId>();
  for (const part of parts) {
    const exact = resolveCanonicalMuscleFilter(part);
    if (exact && exact !== 'all') {
      result.add(exact);
      continue;
    }
    for (const [aliasKey, canonical] of Object.entries(MUSCLE_EQUIVALENCE_MAP)) {
      if (canonical === 'all') continue;
      if (part.includes(aliasKey)) {
        result.add(canonical);
      }
    }
  }
  return Array.from(result);
}

export function getExerciseCanonicalMuscles(
  exercise: Pick<LibraryExercise, 'muscleGroup' | 'primaryMuscles' | 'secondaryMuscles'>,
  options?: { includeSecondary?: boolean }
): CanonicalCatalogMuscleId[] {
  const rawFields: string[] = [
    exercise.muscleGroup || '',
    ...(Array.isArray(exercise.primaryMuscles) ? exercise.primaryMuscles : []),
  ];
  if (options?.includeSecondary && Array.isArray(exercise.secondaryMuscles)) {
    rawFields.push(...exercise.secondaryMuscles);
  }

  const resolved = new Set<CanonicalCatalogMuscleId>();
  for (const field of rawFields) {
    const mapped = resolveCanonicalMuscleFilter(field);
    if (mapped && mapped !== 'all') {
      resolved.add(mapped);
    }
  }
  return Array.from(resolved);
}

/**
 * Checks whether an exercise matches a muscle filter using normalized equivalences
 * over muscleGroup and primaryMuscles (and optionally secondaryMuscles).
 * Note: Broad "Pierna" ("legs") NEVER expands into specific Cuádriceps, Isquiotibiales, or Pantorrillas filters.
 */
export function exerciseMatchesMuscleFilter(
  exercise: Pick<LibraryExercise, 'muscleGroup' | 'primaryMuscles' | 'secondaryMuscles'> & {
    name?: string;
    equipment?: string;
    tags?: string[];
  },
  muscleFilter?: string | null,
  options?: { includeSecondary?: boolean }
): boolean {
  const targetCanonical = resolveCanonicalMuscleFilter(muscleFilter);
  if (!targetCanonical || targetCanonical === 'all') {
    if (!muscleFilter || normalizeMuscleToken(muscleFilter) === 'todos') {
      return true;
    }
    const normFilter = normalizeMuscleToken(muscleFilter);
    const fields = [
      exercise.muscleGroup || '',
      ...(exercise.primaryMuscles || []),
      ...(options?.includeSecondary ? exercise.secondaryMuscles || [] : []),
    ];
    return fields.some((f) => normalizeMuscleToken(f).includes(normFilter));
  }

  // Canonical 16-group accurate classification for specialized Stage 1+ categories
  if (
    targetCanonical === 'neck' ||
    targetCanonical === 'traps' ||
    targetCanonical === 'adductors_abductors' ||
    targetCanonical === 'power' ||
    targetCanonical === 'mobility'
  ) {
    const group16 = resolveCanonical16MuscleGroup(exercise);
    if (targetCanonical === 'neck') return group16 === 'cuello';
    if (targetCanonical === 'traps') return group16 === 'trapecios';
    if (targetCanonical === 'adductors_abductors') return group16 === 'aductores_abductores';
    if (targetCanonical === 'power') return group16 === 'potencia_explosividad';
    if (targetCanonical === 'mobility') return group16 === 'movilidad_acondicionamiento';
  }

  const exerciseMuscles = getExerciseCanonicalMuscles(exercise, options);

  // Broad "Espalda" filter preserves back + traps compatibility
  if (targetCanonical === 'back') {
    return exerciseMuscles.includes('back') || exerciseMuscles.includes('traps');
  }

  // Broad "Pierna" filter (used in Biblioteca) includes broad leg entries plus specific leg subgroups
  if (targetCanonical === 'legs') {
    const group16 = resolveCanonical16MuscleGroup(exercise);
    if (group16 === 'movilidad_acondicionamiento') return false;
    return exerciseMuscles.some(
      (m) =>
        m === 'legs' ||
        m === 'quadriceps' ||
        m === 'hamstrings' ||
        m === 'calves' ||
        m === 'adductors_abductors'
    );
  }

  // Specific muscle filters (Cuádriceps, Isquiotibiales, Pantorrillas, etc.)
  if (targetCanonical === 'quadriceps' && !exerciseMuscles.includes('quadriceps')) {
    return resolveCanonical16MuscleGroup(exercise) === 'cuadriceps';
  }
  if (targetCanonical === 'hamstrings' && !exerciseMuscles.includes('hamstrings')) {
    return resolveCanonical16MuscleGroup(exercise) === 'isquiotibiales';
  }
  if (targetCanonical === 'calves' && !exerciseMuscles.includes('calves')) {
    return resolveCanonical16MuscleGroup(exercise) === 'pantorrillas';
  }

  return exerciseMuscles.includes(targetCanonical);
}

/**
 * Checks whether a catalog exercise matches the target muscles of an exercise being replaced.
 */
export function exerciseMatchesCompatibleMuscles(
  targetMusclesText: string | undefined,
  exercise: Pick<LibraryExercise, 'muscleGroup' | 'primaryMuscles' | 'secondaryMuscles'>
): boolean {
  const targetCanonicals = resolveCanonicalMusclesFromText(targetMusclesText);
  if (targetCanonicals.length === 0) return true;

  const specificTargets = targetCanonicals.filter((m) => m !== 'legs');
  const exerciseMuscles = getExerciseCanonicalMuscles(exercise);

  if (specificTargets.length > 0) {
    return specificTargets.some((target) => {
      if (target === 'back') {
        return exerciseMuscles.includes('back') || exerciseMuscles.includes('traps');
      }
      return exerciseMuscles.includes(target);
    });
  }

  return exerciseMuscles.some(
    (m) =>
      m === 'legs' ||
      m === 'quadriceps' ||
      m === 'hamstrings' ||
      m === 'calves' ||
      m === 'adductors_abductors'
  );
}

export function matchesCatalogEquipment(
  exercise: Pick<LibraryExercise, 'equipment' | 'allEquipment'>,
  equipmentFilter?: string | null
): boolean {
  if (!equipmentFilter || normalizeMuscleToken(equipmentFilter) === 'todos') {
    return true;
  }

  const filterNorm = normalizeExerciseName(equipmentFilter);
  const candidates = [
    exercise.equipment || '',
    ...(Array.isArray(exercise.allEquipment) ? exercise.allEquipment : []),
  ]
    .map((eq) => normalizeExerciseName(eq))
    .filter(Boolean);

  if (filterNorm === 'mancuernas' || filterNorm === 'mancuerna') {
    return candidates.some((n) => /mancuerna|dumbbell/.test(n));
  }
  if (filterNorm === 'kettlebells' || filterNorm === 'kettlebell') {
    return candidates.some((n) => /kettlebell|pesa rusa/.test(n));
  }
  if (filterNorm === 'barras' || filterNorm === 'barra') {
    return candidates.some((n) => /barra(?! de dominadas)|barbell|ez|olimpica|hexagonal/.test(n));
  }
  if (filterNorm === 'poleas' || filterNorm === 'polea') {
    return candidates.some((n) => /polea|cable/.test(n));
  }
  if (filterNorm === 'smith') {
    return candidates.some((n) => /smith|multipower/.test(n));
  }
  if (filterNorm === 'maquinas' || filterNorm === 'maquina') {
    return candidates.some((n) =>
      /maquina|machine|prensa|jaca|hack|palanca/.test(n) && !/smith|multipower/.test(n)
    );
  }
  if (filterNorm === 'bandas elasticas' || filterNorm === 'banda elastica') {
    return candidates.some((n) => /banda|elastica|liga|mini ?band|minibanda/.test(n));
  }
  if (filterNorm === 'peso corporal') {
    return candidates.some((n) =>
      /peso corporal|bodyweight|propio peso|paralelas|dominada|barra fija|barra de dominadas|suelo|parallettes/.test(
        n
      )
    );
  }
  if (filterNorm === 'equipamiento funcional') {
    return resolveCanonical9Equipment(exercise).id === 'equipamiento_funcional';
  }

  return candidates.some((n) => n.includes(filterNorm));
}

export interface CatalogFilterOptions {
  muscle?: string | null;
  searchQuery?: string | null;
  equipment?: string | null;
  includeSecondaryMuscles?: boolean;
}

/**
 * Single centralized catalog filtering function shared across Biblioteca, Sesión Libre,
 * and Selector de Alternativas.
 */
export function filterExerciseCatalog(
  exercises: LibraryExercise[] = EXERCISE_LIBRARY,
  options: CatalogFilterOptions = {}
): LibraryExercise[] {
  const {
    muscle = 'Todos',
    searchQuery = '',
    equipment = 'Todos',
    includeSecondaryMuscles = false,
  } = options;

  const qNorm = normalizeExerciseName(searchQuery || '');
  const qMuscleNorm = normalizeMuscleToken(searchQuery || '');
  const qCanonicalMuscle = resolveCanonicalMuscleFilter(qMuscleNorm);

  return exercises.filter((ex) => {
    if (!exerciseMatchesMuscleFilter(ex, muscle, { includeSecondary: includeSecondaryMuscles })) {
      return false;
    }

    if (!matchesCatalogEquipment(ex, equipment)) {
      return false;
    }

    if (qNorm) {
      const matchesName = normalizeExerciseName(ex.name).includes(qNorm);
      const matchesGroup = normalizeMuscleToken(ex.muscleGroup).includes(qMuscleNorm);
      const matchesPrimary = (ex.primaryMuscles || []).some((m) =>
        normalizeMuscleToken(m).includes(qMuscleNorm)
      );
      const matchesSecondary = (ex.secondaryMuscles || []).some((m) =>
        normalizeMuscleToken(m).includes(qMuscleNorm)
      );
      const matchesEq =
        normalizeExerciseName(ex.equipment || '').includes(qNorm) ||
        (ex.allEquipment || []).some((eq) => normalizeExerciseName(eq).includes(qNorm));
      const matchesTags = (ex.tags || []).some((t) => normalizeExerciseName(t).includes(qNorm));
      const matchesCanonicalSearch =
        qCanonicalMuscle !== null &&
        qCanonicalMuscle !== 'all' &&
        getExerciseCanonicalMuscles(ex, { includeSecondary: true }).includes(qCanonicalMuscle);

      if (
        !matchesName &&
        !matchesGroup &&
        !matchesPrimary &&
        !matchesSecondary &&
        !matchesEq &&
        !matchesTags &&
        !matchesCanonicalSearch
      ) {
        return false;
      }
    }

    return true;
  });
}

export const CANONICAL_16_MUSCLE_GROUPS: Array<{
  id: Canonical16MuscleGroupId;
  label: string;
  filterKey: string;
  targetMinCount: number;
}> = [
  { id: 'pecho', label: 'Pecho', filterKey: 'Pecho', targetMinCount: 110 },
  { id: 'espalda', label: 'Espalda', filterKey: 'Espalda', targetMinCount: 130 },
  { id: 'hombros', label: 'Hombros', filterKey: 'Hombros', targetMinCount: 130 },
  { id: 'biceps', label: 'Bíceps', filterKey: 'Bíceps', targetMinCount: 85 },
  { id: 'triceps', label: 'Tríceps', filterKey: 'Tríceps', targetMinCount: 85 },
  { id: 'antebrazos', label: 'Antebrazos', filterKey: 'Antebrazos', targetMinCount: 60 },
  { id: 'trapecios', label: 'Trapecios', filterKey: 'Trapecios', targetMinCount: 55 },
  { id: 'cuello', label: 'Cuello', filterKey: 'Cuello', targetMinCount: 45 },
  { id: 'abdomen_core', label: 'Abdomen y core', filterKey: 'Abdomen y core', targetMinCount: 120 },
  { id: 'cuadriceps', label: 'Cuádriceps', filterKey: 'Cuádriceps', targetMinCount: 140 },
  { id: 'isquiotibiales', label: 'Isquiotibiales', filterKey: 'Isquiotibiales', targetMinCount: 95 },
  { id: 'gluteos', label: 'Glúteos', filterKey: 'Glúteos', targetMinCount: 105 },
  { id: 'aductores_abductores', label: 'Aductores y abductores', filterKey: 'Aductores y abductores', targetMinCount: 55 },
  { id: 'pantorrillas', label: 'Pantorrillas', filterKey: 'Pantorrillas', targetMinCount: 55 },
  { id: 'potencia_explosividad', label: 'Potencia y explosividad', filterKey: 'Potencia y explosividad', targetMinCount: 120 },
  { id: 'movilidad_acondicionamiento', label: 'Movilidad y acondicionamiento', filterKey: 'Movilidad y acondicionamiento', targetMinCount: 126 },
];

export const CANONICAL_9_EQUIPMENT_CATEGORIES: Array<{
  id: Canonical9EquipmentId;
  label: string;
}> = [
  { id: 'barra', label: 'Barra' },
  { id: 'mancuernas', label: 'Mancuernas' },
  { id: 'poleas', label: 'Poleas' },
  { id: 'maquinas', label: 'Máquinas' },
  { id: 'smith', label: 'Smith' },
  { id: 'bandas_elasticas', label: 'Bandas elásticas' },
  { id: 'peso_corporal', label: 'Peso corporal' },
  { id: 'kettlebells', label: 'Kettlebells' },
  { id: 'equipamiento_funcional', label: 'Equipamiento funcional' },
];

export function resolveCanonical16MuscleGroup(
  exercise: Pick<LibraryExercise, 'muscleGroup' | 'primaryMuscles'> & {
    name?: string;
    equipment?: string;
    tags?: string[];
    canonicalGroup16?: Canonical16MuscleGroupId;
  }
): Canonical16MuscleGroupId {
  if (exercise.canonicalGroup16) return exercise.canonicalGroup16;
  const n = normalizeExerciseName(exercise.name || '');
  const mg = normalizeMuscleToken(exercise.muscleGroup || '');
  const pm = (exercise.primaryMuscles || []).map(normalizeMuscleToken).join(' ');
  const eq = normalizeMuscleToken(exercise.equipment || '');
  const tags = (exercise.tags || []).map(normalizeMuscleToken).join(' ');

  if (
    /salto|jump|pliometr|explosiv|cargada|clean|snatch|arranque|kettlebell swing|swing con kettlebell|thruster|slam|lanzamiento|balon medicinal|push press/.test(
      n
    ) ||
    /plyo|explosiv|power/.test(tags)
  ) {
    return 'potencia_explosividad';
  }
  if (
    /bicicleta|cinta de correr|eliptica|ergometro|carrera|trote|caminata en cinta|movilidad|estiramiento|yoga|calentamiento|burpee|cuerda|comba|skiers|esqui/.test(
      n
    ) ||
    /bicicleta|cinta|eliptica|ergometro/.test(eq)
  ) {
    return 'movilidad_acondicionamiento';
  }
  if (
    /cuello|cervical|flexion cervical|extension cervical|rotacion cervical|inclinacion lateral cervical/.test(
      n
    ) &&
    !/press de banca con barra hasta el cuello/.test(n)
  ) {
    return 'cuello';
  }
  if (/encogimiento|shrug|trapecio/.test(n) || /trapecio|trapezius/.test(pm)) {
    return 'trapecios';
  }
  if (
    /gemelo|pantorrilla|soleo|talon|calves|calf|tibial/.test(n) ||
    /pantorrilla|gemelo|calves|soleo|gastrocnemio/.test(pm)
  ) {
    return 'pantorrillas';
  }
  if ((/aductor|abductor|aduccion|abduccion|almeja|clamshell/.test(n) && !/hombro|escapula/.test(n)) || /aductor|adductor|abductor/.test(pm)) {
    return 'aductores_abductores';
  }
  if (mg === 'pierna' || mg === 'gluteos' || mg === 'isquiotibiales') {
    if (
      /femoral|isquio|peso muerto rumano|piernas rectas|piernas rigidas|buenos dias|nordic|nordico|glute ham/.test(
        n
      ) ||
      /isquio|hamstring|femoral/.test(pm)
    ) {
      return 'isquiotibiales';
    }
  }
  if (mg === 'gluteos' || /hip thrust|puente de gluteo|patada de gluteo|glute/.test(n) || /gluteo|glute/.test(pm)) {
    return 'gluteos';
  }
  if (mg === 'pierna' || mg === 'cuadriceps') return 'cuadriceps';
  if (mg === 'pecho') return 'pecho';
  if (mg === 'espalda') return 'espalda';
  if (mg === 'hombro' || mg === 'hombros') return 'hombros';
  if (mg === 'biceps') return 'biceps';
  if (mg === 'triceps') return 'triceps';
  if (mg === 'antebrazo' || mg === 'antebrazos') return 'antebrazos';
  if (mg === 'abdomen' || mg === 'abdomen y core' || mg === 'core') return 'abdomen_core';
  return 'cuadriceps';
}

export function getCanonical16GroupLabel(id: Canonical16MuscleGroupId): string {
  return CANONICAL_16_MUSCLE_GROUPS.find((g) => g.id === id)?.label || id;
}

export function resolveCanonical9Equipment(
  exercise: Pick<LibraryExercise, 'equipment' | 'allEquipment'>
): { id: Canonical9EquipmentId; label: string } {
  const eq = normalizeExerciseName(exercise.equipment || '');
  const all = (exercise.allEquipment || []).map(normalizeExerciseName).join(' ');

  if (/multipower|smith/.test(eq) || /multipower|smith/.test(all)) {
    return { id: 'smith', label: 'Smith' };
  }
  if (/banda|elastica|liga|mini ?band|minibanda/.test(eq) || /banda|elastica|minibanda/.test(all)) {
    return { id: 'bandas_elasticas', label: 'Bandas elásticas' };
  }
  if (/barra de dominadas/.test(eq) || /peso corporal|parallettes/.test(eq)) {
    return { id: 'peso_corporal', label: 'Peso corporal' };
  }
  if (/barra/.test(eq)) {
    return { id: 'barra', label: 'Barra' };
  }
  if (/mancuerna/.test(eq)) {
    return { id: 'mancuernas', label: 'Mancuernas' };
  }
  if (/polea|cable/.test(eq)) {
    return { id: 'poleas', label: 'Poleas' };
  }
  if (/maquina|prensa de piernas/.test(eq)) {
    return { id: 'maquinas', label: 'Máquinas' };
  }
  if (/kettlebell|pesa rusa/.test(eq)) {
    return { id: 'kettlebells', label: 'Kettlebells' };
  }
  return { id: 'equipamiento_funcional', label: 'Equipamiento funcional' };
}

export function resolveVisualResourceStatus(
  exercise: Pick<LibraryExercise, 'videoUrl' | 'animationUrl' | 'thumbnailUrl' | 'frames' | 'visualResourceStatus'>
): ExerciseVisualResourceStatus {
  if (exercise.visualResourceStatus) return exercise.visualResourceStatus;
  const anim = (exercise.animationUrl || exercise.videoUrl || '').trim();
  const thumb = (exercise.thumbnailUrl || '').trim();
  if (anim && /\.(webp|gif|mp4|webm)(\?|$)/i.test(anim)) {
    return 'verified_animation';
  }
  if (typeof exercise.frames === 'number' && exercise.frames > 1) {
    return 'frame_sequence';
  }
  if (thumb && /\.(webp|png|jpg|jpeg)(\?|$)/i.test(thumb)) {
    return 'static_image';
  }
  return 'pending_resource';
}

export function resolveMovementType(
  exercise: Pick<LibraryExercise, 'name' | 'tags' | 'movementType'>
): ExerciseMovementType {
  if (exercise.movementType) return exercise.movementType;
  const n = normalizeExerciseName(exercise.name || '');
  const tags = (exercise.tags || []).map(normalizeMuscleToken).join(' ');
  if (/explosiv|plyo|salto|jump|clean|cargada|arranque|snatch|slam|thruster/.test(n) || /explosive|plyometric/.test(tags)) {
    return 'explosivo';
  }
  if (/plancha|isometric|sostener|pausa|wall sit|pallof/.test(n) || /isometric/.test(tags)) {
    return 'isometrico';
  }
  if (/bicicleta|cinta|eliptica|ergometro|movilidad|estiramiento|calentamiento|warmup|stretch/.test(n) || /cardio|mobility|stretch|warmup/.test(tags)) {
    return 'movilidad_acondicionamiento';
  }
  if (/press|sentadilla|peso muerto|dominada|remo|zancada|bulgara|fondos|prensa|hip thrust/.test(n)) {
    return 'compuesto';
  }
  return 'aislamiento';
}

export function resolveDifficultyLevel(
  exercise: Pick<LibraryExercise, 'name' | 'equipment' | 'difficultyLevel'>
): ExerciseDifficultyLevel {
  if (exercise.difficultyLevel) return exercise.difficultyLevel;
  const n = normalizeExerciseName(exercise.name || '');
  const eq = normalizeExerciseName(exercise.equipment || '');
  if (/snatch|arranque|clean|cargada|unilateral|pistol|dragon flag|muscle up|nordico|nordic|deficit|pliometr/.test(n)) {
    return 'avanzado';
  }
  if (/maquina|polea|multipower|smith|bicicleta|eliptica|cinta/.test(eq)) {
    return 'principiante';
  }
  return 'intermedio';
}

export function resolveExerciseVariant(
  exercise: Pick<LibraryExercise, 'name' | 'variant'>
): string {
  if (exercise.variant) return exercise.variant;
  const n = normalizeExerciseName(exercise.name || '');
  const tokens: string[] = [];
  if (/unilateral|a un brazo|a una mano|a una pierna|alterno|alternada/.test(n)) tokens.push('unilateral');
  if (/inclinad/.test(n)) tokens.push('inclinado');
  if (/declinad/.test(n)) tokens.push('declinado');
  if (/agarre cerrado|estrech/.test(n)) tokens.push('agarre cerrado');
  if (/agarre ancho|abiert/.test(n)) tokens.push('agarre ancho');
  if (/neutro|martillo/.test(n)) tokens.push('agarre neutro');
  if (/supino|inverso/.test(n)) tokens.push('agarre supino');
  if (/sumo/.test(n)) tokens.push('sumo');
  if (/explosiv|salto|pliometr/.test(n)) tokens.push('explosivo');
  if (/pausa/.test(n)) tokens.push('con pausa');
  if (/sentado/.test(n)) tokens.push('sentado');
  if (/de pie/.test(n)) tokens.push('de pie');
  return tokens.length > 0 ? tokens.join(' · ') : 'estándar';
}

export function resolveBiomechanicalPatternLite(
  exercise: Pick<LibraryExercise, 'name' | 'muscleGroup' | 'movementPattern'>
): string {
  if (exercise.movementPattern) return exercise.movementPattern;
  const n = normalizeExerciseName(exercise.name || '');
  const mg = normalizeMuscleToken(exercise.muscleGroup || '');
  if (/press|empuje|flexiones|fondos|apertura|cruce|pec deck|pullover/.test(n) && (mg === 'pecho' || /pecho|banca|fondos|flexiones/.test(n))) {
    return 'Empuje Horizontal';
  }
  if (/press militar|press de hombro|elevacion lateral|elevacion frontal|pajaro|face pull|arnold/.test(n) || mg === 'hombro') {
    return 'Empuje Vertical / Deltoides';
  }
  if (/jalon|dominada/.test(n)) return 'Tracción Vertical';
  if (/remo|seal row|barra t/.test(n)) return 'Tracción Horizontal';
  if (/sentadilla|prensa|zancada|bulgara|step up|subida al banco|hack|sissy/.test(n)) return 'Dominante de Rodilla';
  if (/extension de cuadriceps|extension de pierna|extension de rodilla/.test(n)) return 'Extensión de Rodilla';
  if (/peso muerto|hip thrust|puente|buenos dias|rdl/.test(n)) return 'Dominante de Cadera';
  if (/curl femoral|curl de pierna|nordic/.test(n)) return 'Flexión de Rodilla';
  if (/curl/.test(n) && (mg === 'biceps' || mg === 'antebrazo' || /biceps|martillo|predicador|concentrado|muneca/.test(n))) {
    return 'Flexión de Codo / Muñeca';
  }
  if (/triceps|press frances|copa|patada de triceps|extension/.test(n) && mg === 'triceps') {
    return 'Extensión de Codo';
  }
  if (/gemelo|pantorrilla|talon|tibial/.test(n)) return 'Flexión Plantar / Tobillo';
  if (/encogimiento|shrug/.test(n)) return 'Elevación / Retracción Escapular';
  if (/cuello|cervical/.test(n)) return 'Control Cervical';
  if (/pull[- ]?apart|rotacion externa|deslizamiento de brazos|elevacion en y|remo escapular/.test(n)) {
    return 'Estabilización Escapular y Rotación Externa';
  }
  if (/aductor|abductor|aduccion|abduccion/.test(n)) return 'Aducción / Abducción de Cadera';
  if (/salto|jump|clean|cargada|snatch|arranque|slam|swing/.test(n)) return 'Potencia y Explosividad';
  if (/bicicleta|cinta|eliptica|ergometro|movilidad|estiramiento|caminata|carrera/.test(n)) return 'Movilidad y Acondicionamiento';
  return 'Control Core / Estabilización';
}

export function toEliteExerciseRecord(ex: LibraryExercise): EliteExerciseRecord {
  const group16 = resolveCanonical16MuscleGroup(ex);
  const group16Label = getCanonical16GroupLabel(group16);
  const eq9 = resolveCanonical9Equipment(ex);
  const pattern = resolveBiomechanicalPatternLite(ex);
  const movementType = resolveMovementType(ex);
  const difficulty = resolveDifficultyLevel(ex);
  const variant = resolveExerciseVariant(ex);
  const visualStatus = resolveVisualResourceStatus(ex);
  const primaryLabel =
    (ex.primaryMuscles && ex.primaryMuscles.length > 0 ? ex.primaryMuscles[0] : ex.muscleGroup) ||
    group16Label;
  const secondaryList = Array.isArray(ex.secondaryMuscles) ? ex.secondaryMuscles : [];
  const altNames =
    ex.alternativeNames && ex.alternativeNames.length > 0
      ? ex.alternativeNames
      : alternativeNamesById.get(ex.id) || [];

  const stepByStepInstructions =
    Array.isArray(ex.shortInstructions) && ex.shortInstructions.length > 0
      ? ex.shortInstructions
      : [
          ex.startingPosition ||
            `Adopta la posición inicial estable con ${ex.equipment || eq9.label} alineando articulaciones y columna neutra.`,
          ex.activePhase ||
            `Ejecuta el patrón de ${pattern.toLowerCase()} activando de forma consciente ${group16Label.toLowerCase()}.`,
          ex.returnPhase ||
            'Completa el rango útil con pausa breve de control y retorna de forma lenta en 2 a 3 segundos.',
        ];

  const safetyRecommendations =
    Array.isArray(ex.safetyWarnings) && ex.safetyWarnings.length > 0
      ? ex.safetyWarnings
      : [
          `Verifica agarre, apoyos y seguros de ${ex.equipment || eq9.label} antes de iniciar la serie.`,
          'Detén la serie si aparece molestia articular aguda o pérdida marcada de técnica.',
        ];

  return {
    id: ex.id,
    spanishName: ex.name,
    alternativeNames: altNames,
    primaryMuscleGroup: primaryLabel,
    secondaryMuscleGroups: secondaryList,
    canonicalGroup16: group16,
    canonicalGroup16Label: group16Label,
    equipment: ex.equipment || eq9.label,
    equipmentCategory: eq9.id,
    equipmentCategoryLabel: eq9.label,
    movementType,
    biomechanicalPattern: pattern,
    difficultyLevel: difficulty,
    exerciseVariant: variant,
    stepByStepInstructions,
    frequentMistakes: [
      'Usar impulso corporal excesivo reduciendo la tensión en la musculatura diana.',
      'Recortar el recorrido o perder la estabilidad postural bajo carga.',
    ],
    safetyRecommendations,
    ...(Array.isArray(ex.contraindications) && ex.contraindications.length > 0
      ? { contraindications: ex.contraindications }
      : {}),
    referenceImageUrl: ex.thumbnailUrl || null,
    executionAnimationUrl: ex.animationUrl || ex.videoUrl || null,
    visualResourceStatus: visualStatus,
    libraryExercise: ex,
  };
}

export function getEliteExerciseCatalog(): EliteExerciseRecord[] {
  return EXERCISE_LIBRARY.map(toEliteExerciseRecord);
}

export interface LibraryCoverageAudit16Report {
  totalCatalogEntries: number;
  netUniqueBiomechanicalCount: number;
  duplicateNameCollisions: number;
  targetMinimum: number;
  remainingTo1500FromCurrent: number;
  remainingTo1500FromNetUnique: number;
  recommendedBatchesOf20: number;
  byGroup16: Array<{
    id: Canonical16MuscleGroupId;
    label: string;
    currentCount: number;
    targetMinCount: number;
    gapToTarget: number;
  }>;
  byEquipment9: Array<{
    id: Canonical9EquipmentId;
    label: string;
    currentCount: number;
  }>;
  byVisualStatus: Record<ExerciseVisualResourceStatus, number>;
}

export function getLibraryCoverageAudit16(targetMinimum: number = 1500): LibraryCoverageAudit16Report {
  const groupCounts = new Map<Canonical16MuscleGroupId, number>();
  const eqCounts = new Map<Canonical9EquipmentId, number>();
  const byVisualStatus: Record<ExerciseVisualResourceStatus, number> = {
    verified_animation: 0,
    frame_sequence: 0,
    static_image: 0,
    pending_resource: 0,
  };

  const stop = new Set(['con', 'en', 'de', 'del', 'la', 'el', 'los', 'las', 'a', 'y', 'para', 'un', 'una', 'al']);
  const seenSignatures = new Set<string>();
  let sameEqSemanticDupes = 0;

  for (const ex of EXERCISE_LIBRARY) {
    const g = resolveCanonical16MuscleGroup(ex);
    groupCounts.set(g, (groupCounts.get(g) || 0) + 1);
    const eq = resolveCanonical9Equipment(ex);
    eqCounts.set(eq.id, (eqCounts.get(eq.id) || 0) + 1);
    const vs = resolveVisualResourceStatus(ex);
    byVisualStatus[vs] += 1;

    const sigTokens = normalizeExerciseName(ex.name)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t && !stop.has(t));
    const sig = `${Array.from(new Set(sigTokens)).sort().join('|')}::${eq.id}`;
    if (seenSignatures.has(sig)) sameEqSemanticDupes++;
    else seenSignatures.add(sig);
  }

  const netUnique = EXERCISE_LIBRARY.length - sameEqSemanticDupes;
  const remainingFromNet = Math.max(0, targetMinimum - netUnique);

  return {
    totalCatalogEntries: EXERCISE_LIBRARY.length,
    netUniqueBiomechanicalCount: netUnique,
    duplicateNameCollisions: sameEqSemanticDupes,
    targetMinimum,
    remainingTo1500FromCurrent: Math.max(0, targetMinimum - EXERCISE_LIBRARY.length),
    remainingTo1500FromNetUnique: remainingFromNet,
    recommendedBatchesOf20: Math.ceil(remainingFromNet / 20),
    byGroup16: CANONICAL_16_MUSCLE_GROUPS.map((g) => {
      const currentCount = groupCounts.get(g.id) || 0;
      return {
        id: g.id,
        label: g.label,
        currentCount,
        targetMinCount: g.targetMinCount,
        gapToTarget: Math.max(0, g.targetMinCount - currentCount),
      };
    }),
    byEquipment9: CANONICAL_9_EQUIPMENT_CATEGORIES.map((e) => ({
      id: e.id,
      label: e.label,
      currentCount: eqCounts.get(e.id) || 0,
    })),
    byVisualStatus,
  };
}

export const MUSCLE_GROUPS = [
  'Todos',
  'Pecho',
  'Espalda',
  'Hombros',
  'Bíceps',
  'Tríceps',
  'Antebrazos',
  'Trapecios',
  'Cuello',
  'Abdomen y core',
  'Cuádriceps',
  'Isquiotibiales',
  'Glúteos',
  'Aductores y abductores',
  'Pantorrillas',
  'Potencia y explosividad',
  'Movilidad y acondicionamiento',
] as const;

export const CATALOG_MUSCLE_FILTERS = [
  'Todos',
  'Pectorales',
  'Espalda',
  'Cuádriceps',
  'Isquiotibiales',
  'Glúteos',
  'Hombros',
  'Bíceps',
  'Tríceps',
  'Trapecios',
  'Antebrazos',
  'Pantorrillas',
  'Aductores y abductores',
  'Abdominales',
  'Cuello',
  'Potencia y explosividad',
  'Movilidad y acondicionamiento',
] as const;

export const CANONICAL_EQUIPMENT_FILTERS = [
  'Todos',
  ...CANONICAL_9_EQUIPMENT_CATEGORIES.map((c) => c.label),
] as const;

export const EQUIPMENT_LIST = [
  'Todos',
  ...Array.from(
    new Set(EXERCISE_LIBRARY.flatMap((ex) => ex.allEquipment || [ex.equipment || 'Peso corporal']))
  ).sort((a, b) => a.localeCompare(b, 'es')),
];
