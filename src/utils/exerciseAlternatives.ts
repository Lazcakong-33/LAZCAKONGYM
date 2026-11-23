import { Exercise, LibraryExercise } from '../types';
import {
  EXERCISE_LIBRARY,
  resolveLibraryExercise,
  normalizeExerciseName,
  exerciseMatchesCompatibleMuscles,
  filterExerciseCatalog,
  matchesCatalogEquipment,
} from '../data/exerciseLibrary';

/**
 * Normaliza texto eliminando acentos y espacios extras
 */
function normalizeSimple(text?: string | null): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Resuelve el patrón de movimiento biomecánico principal del ejercicio
 */
export function resolveMovementPattern(exerciseName: string, muscleGroup: string = ''): string {
  const n = normalizeSimple(exerciseName);
  const m = normalizeSimple(muscleGroup);

  if (
    (/cervical|cuello|retraccion cervical|chin tuck/.test(n) || /cuello|cervical/.test(m)) &&
    !/press de banca con barra hasta el cuello/.test(n)
  ) {
    return 'Control Cervical';
  }
  if (
    /pull[- ]?apart|face pull con banda|rotacion externa|deslizamiento de brazos|elevacion en y|remo escapular/.test(
      n
    )
  ) {
    return 'Estabilización Escapular y Rotación Externa';
  }
  if (/press.*pecho|press de banca|press plano|press inclinado|press declinado|chest press|fondos|push up|flexion.*pecho/.test(n)) {
    return 'Empuje Horizontal';
  }
  if (/aperturas|fly|cruces en polea|cruce.*polea|pec deck|contractor/.test(n)) {
    return 'Aducción Pectoral';
  }
  if (/press militar|press hombro|overhead|arnold|push press/.test(n)) {
    return 'Empuje Vertical';
  }
  if (/elevacion lateral|elevaciones laterales|pajaros|face pull|remo al menton|deltoide/.test(n)) {
    return 'Aislamiento Deltoides';
  }
  if (/dominada|jalon|pulldown|pull up|chin up/.test(n)) {
    return 'Tracción Vertical';
  }
  if (/remo|row|seal row|t-bar|pendlay/.test(n)) {
    return 'Tracción Horizontal';
  }
  if (/sentadilla|squat|prensa|hack|jaca|zancada|bulgara|lunge|box squat|goblet/.test(n)) {
    return 'Dominante de Rodilla';
  }
  if (/extension de cuadriceps|leg extension|extension.*rodilla/.test(n)) {
    return 'Extensión de Rodilla';
  }
  if (/peso muerto|deadlift|rdl|rumano|buenos dias|hip thrust|puente de gluteo|patada.*gluteo|glute kickback/.test(n)) {
    return 'Dominante de Cadera';
  }
  if (/curl femoral|leg curl|curl.*isquio|femoral tumbado|femoral sentado/.test(n)) {
    return 'Flexión de Rodilla';
  }
  if (/curl|bicep|martillo|predicador|spider/.test(n) || /bicep/.test(m)) {
    return 'Flexión de Codo';
  }
  if (/tricep|frances|copa|pushdown|extension.*tricep|fondos.*paralelas/.test(n) || /tricep/.test(m)) {
    return 'Extensión de Codo';
  }
  if (/gemelo|pantorrilla|soleo|calf/.test(n) || /pantorrilla|gemelo/.test(m)) {
    return 'Flexión Plantar';
  }
  if (/abductor|abductores|abduccion/.test(n)) {
    return 'Abducción de Cadera';
  }
  if (/aductor|aductores|aduccion/.test(n)) {
    return 'Aducción de Cadera';
  }
  if (/crunch|plancha|plank|pallof|rueda abdominal|elevacion de piernas|core|abdomen/.test(n)) {
    return 'Core / Anti-Rotación';
  }
  return 'Patrón Compatible';
}

/**
 * Genera un motivo conciso y biomecánicamente riguroso de la recomendación
 */
export function generateAlternativeRationale(
  originalEx: { name: string; targetMuscles?: string; equipment?: string; objective?: string },
  candidate: LibraryExercise,
  itemPattern: string,
  targetPattern: string,
  isProgrammedMatch: boolean = false
): string {
  const muscle = candidate.muscleGroup || originalEx.targetMuscles || 'el músculo objetivo';
  const candEq = normalizeSimple(candidate.equipment);

  if (isProgrammedMatch) {
    if (candEq.includes('maquina') || candEq.includes('hack')) {
      return `Variante programada en máquina para máxima estabilidad y aislamiento de ${muscle} sin sobrecarga lumbar.`;
    }
    if (candEq.includes('mancuerna')) {
      return `Variante programada con mancuernas para mayor rango de movimiento y trabajo simétrico en ${muscle}.`;
    }
    if (candEq.includes('polea') || candEq.includes('cable')) {
      return `Variante programada en polea con tensión mecánica constante en todo el recorrido de ${muscle}.`;
    }
    return `Variante programada con patrón equivalente (${itemPattern}) y vector de fuerza óptimo para ${muscle}.`;
  }

  if (itemPattern === targetPattern) {
    if (candEq.includes('maquina')) {
      return `Mismo patrón (${itemPattern}) en máquina para máxima estabilidad y aislamiento de ${muscle} sin fatiga axial.`;
    }
    if (candEq.includes('mancuerna')) {
      return `Mismo patrón (${itemPattern}) con mancuernas para mayor rango articular y estímulo unilateral en ${muscle}.`;
    }
    if (candEq.includes('polea') || candEq.includes('cable')) {
      return `Mismo patrón (${itemPattern}) en polea para mantener tensión continua en toda la curva de fuerza de ${muscle}.`;
    }
    if (candEq.includes('barra')) {
      return `Mismo patrón (${itemPattern}) con barra para permitir máxima sobrecarga progresiva en ${muscle}.`;
    }
    return `Mismo patrón biomecánico (${itemPattern}) con vector equivalente para ${muscle}.`;
  }

  return `Alternativa biomecánica compatible para estimular ${muscle} con seguridad y estabilidad articular.`;
}

/**
 * Detecta si un string de alternative contiene un equipo preferido
 */
function extractPreferredEquipment(altText?: string | null): string | undefined {
  if (!altText) return undefined;
  const t = normalizeSimple(altText);
  if (/maquina|machine|smart fit/.test(t)) return 'Máquinas';
  if (/mancuerna|mancuernas|dumbbell/.test(t)) return 'Mancuernas';
  if (/polea|cable|cuerda/.test(t)) return 'Poleas';
  if (/barra|barbell/.test(t)) return 'Barras';
  if (/peso corporal|corporal|bodyweight/.test(t)) return 'Peso corporal';
  return undefined;
}

export interface CandidateAlternative {
  exercise: LibraryExercise;
  pattern: string;
  rationale: string;
  isSamePattern: boolean;
  isProgrammedMatch: boolean;
}

export interface RecommendedAlternativeResult {
  recommended: CandidateAlternative | null;
  otherCandidates: CandidateAlternative[];
  hasDirectAlternative: boolean;
  targetPattern: string;
}

/**
 * Encuentra y clasifica las alternativas biomecánicas más compatibles para un ejercicio
 */
export function findRecommendedAlternative(
  originalEx: {
    id?: string;
    libraryExerciseId?: string;
    name: string;
    targetMuscles?: string;
    equipment?: string;
    objective?: string;
    alternative?: string;
  },
  options?: {
    filterEquipment?: string;
    searchQuery?: string;
    limit?: number;
  }
): RecommendedAlternativeResult {
  const normOrigName = normalizeExerciseName(originalEx.name);
  const targetPattern = resolveMovementPattern(originalEx.name, originalEx.targetMuscles);
  const preferredEquipFromAlt = extractPreferredEquipment(originalEx.alternative);
  const effectiveEquipFilter = options?.filterEquipment && options.filterEquipment !== 'Todos'
    ? options.filterEquipment
    : undefined;

  let directProgrammedMatch: LibraryExercise | null = null;

  // 1. Verificar si originalEx.alternative apunta a un ejercicio concreto existente en biblioteca
  if (originalEx.alternative && originalEx.alternative.trim()) {
    const rawAlt = originalEx.alternative.trim();
    // Excluir textos genéricos de una sola palabra que solo denotan equipo
    const isGenericKeyword = /^(maquina|mancuerna|mancuernas|polea|poleas|barra|barras|prensa|cualquiera|cualquiera disponible)$/i.test(
      rawAlt.trim()
    );

    if (!isGenericKeyword) {
      const resolved = resolveLibraryExercise({ name: rawAlt });
      if (resolved && normalizeExerciseName(resolved.name) !== normOrigName) {
        directProgrammedMatch = resolved;
      }
    }
  }

  // 2. Filtrar catálogo para encontrar candidatos biomecánicos compatibles
  const rawQuery = options?.searchQuery?.trim() || '';
  const candidatePool = EXERCISE_LIBRARY.filter((item) => {
    // Excluir el propio ejercicio original
    if (normalizeExerciseName(item.name) === normOrigName) return false;
    if (originalEx.libraryExerciseId && item.id === originalEx.libraryExerciseId) return false;

    // Si el usuario especificó una búsqueda de texto manual, respetar la búsqueda
    if (rawQuery) {
      const normQ = normalizeExerciseName(rawQuery);
      const inName = normalizeExerciseName(item.name).includes(normQ);
      const inMuscle = normalizeExerciseName(item.muscleGroup).includes(normQ);
      const inEquip = normalizeExerciseName(item.equipment || '').includes(normQ);
      return inName || inMuscle || inEquip;
    }

    // Filtrar por compatibilidad muscular
    if (originalEx.targetMuscles) {
      if (!exerciseMatchesCompatibleMuscles(originalEx.targetMuscles, item)) {
        return false;
      }
    }

    // Filtrar por equipo si está activo un filtro explícito
    if (effectiveEquipFilter && !matchesCatalogEquipment(item, effectiveEquipFilter)) {
      return false;
    }

    return true;
  });

  // 3. Evaluar y puntuar candidatos
  const scoredCandidates: CandidateAlternative[] = candidatePool.map((item) => {
    const itemPattern = resolveMovementPattern(item.name, item.muscleGroup);
    const isSamePattern = itemPattern === targetPattern;
    const isDirectMatch = directProgrammedMatch ? item.id === directProgrammedMatch.id : false;

    let score = 0;
    if (isDirectMatch) score += 1000;
    if (isSamePattern) score += 100;

    // Bonificación si coincide con el equipo sugerido en el texto de alternativa (ej: "Máquina")
    if (preferredEquipFromAlt && matchesCatalogEquipment(item, preferredEquipFromAlt)) {
      score += 40;
    }

    // Bonificación si coincide con el equipo del filtro activo
    if (effectiveEquipFilter && matchesCatalogEquipment(item, effectiveEquipFilter)) {
      score += 30;
    }

    // Bonificación por palabras clave de movimiento compartidas (press, curl, remo, jalon, sentadilla, etc.)
    const origTokens = normOrigName.split(/\s+/);
    const itemTokens = normalizeExerciseName(item.name).split(/\s+/);
    const commonKeywords = ['press', 'curl', 'remo', 'jalon', 'sentadilla', 'squat', 'peso muerto', 'elevacion', 'extension', 'abduccion', 'aduccion', 'thrust', 'apertura'];
    for (const kw of commonKeywords) {
      if (origTokens.some((t) => t.includes(kw)) && itemTokens.some((t) => t.includes(kw))) {
        score += 50;
      }
    }

    // Bonificación si tiene miniatura válida disponible
    if (item.thumbnailUrl) score += 10;
    if (item.videoUrl) score += 5;

    const rationale = generateAlternativeRationale(
      originalEx,
      item,
      itemPattern,
      targetPattern,
      isDirectMatch
    );

    return {
      exercise: item,
      pattern: itemPattern,
      rationale,
      isSamePattern,
      isProgrammedMatch: isDirectMatch,
      _score: score,
    } as CandidateAlternative & { _score: number };
  });

  // Ordenar por puntuación descendente
  scoredCandidates.sort((a: any, b: any) => b._score - a._score);

  // Si hay coincidencia programada directa pero no pasó el filtro de búsqueda/equipo (por ejemplo, sin búsqueda manual),
  // asegurar que se incluya
  let topRecommendation: CandidateAlternative | null = null;
  if (directProgrammedMatch && !rawQuery) {
    const existingIdx = scoredCandidates.findIndex((c) => c.exercise.id === directProgrammedMatch!.id);
    if (existingIdx >= 0) {
      topRecommendation = scoredCandidates[existingIdx];
    } else {
      const itemPattern = resolveMovementPattern(
        directProgrammedMatch.name,
        directProgrammedMatch.muscleGroup
      );
      topRecommendation = {
        exercise: directProgrammedMatch,
        pattern: itemPattern,
        rationale: generateAlternativeRationale(
          originalEx,
          directProgrammedMatch,
          itemPattern,
          targetPattern,
          true
        ),
        isSamePattern: itemPattern === targetPattern,
        isProgrammedMatch: true,
      };
    }
  } else if (scoredCandidates.length > 0) {
    topRecommendation = scoredCandidates[0];
  }

  // Filtrar la recomendación principal de la lista de otras alternativas para no duplicarla
  const otherCandidates = scoredCandidates
    .filter((c) => !topRecommendation || c.exercise.id !== topRecommendation.exercise.id)
    .slice(0, options?.limit || 20);

  return {
    recommended: topRecommendation,
    otherCandidates,
    hasDirectAlternative: Boolean(topRecommendation),
    targetPattern,
  };
}

const SPANISH_MUSCLE_NAMES: Record<string, string> = {
  pectorals: 'Pectoral Mayor',
  pectoral: 'Pectoral Mayor',
  pecho: 'Pectoral Mayor',
  chest: 'Pectoral Mayor',
  'anterior deltoid': 'Deltoides Anterior',
  'deltoides anterior': 'Deltoides Anterior',
  'lateral deltoid': 'Deltoides Lateral',
  'deltoides lateral': 'Deltoides Lateral',
  'rear deltoid': 'Deltoides Posterior',
  'rear deltoids': 'Deltoides Posterior',
  'deltoides posterior': 'Deltoides Posterior',
  deltoids: 'Deltoides',
  shoulders: 'Deltoides',
  hombro: 'Deltoides',
  hombros: 'Deltoides',
  biceps: 'Bíceps Braquial',
  'biceps braquial': 'Bíceps Braquial',
  brachialis: 'Braquial Anterior',
  braquial: 'Braquial Anterior',
  triceps: 'Tríceps Braquial',
  forearms: 'Flexores y Extensores de Antebrazo',
  antebrazo: 'Braquiorradial y Antebrazo',
  lats: 'Dorsal Ancho',
  'latissimus dorsi': 'Dorsal Ancho',
  dorsal: 'Dorsal Ancho',
  espalda: 'Dorsal Ancho y Romboides',
  back: 'Dorsal Ancho y Trapecio Medio',
  trapezius: 'Trapecio',
  'middle trapezius': 'Trapecio Medio e Inferior',
  rhomboids: 'Romboides',
  'spinal erectors': 'Erectores Espinales',
  quadriceps: 'Cuádriceps Femoral',
  cuadriceps: 'Cuádriceps Femoral',
  hamstrings: 'Isquiotibiales',
  isquiotibiales: 'Isquiotibiales',
  femoral: 'Isquiotibiales (Bíceps Femoral)',
  glutes: 'Glúteo Mayor',
  gluteos: 'Glúteo Mayor y Medio',
  calves: 'Gastrocnemio y Sóleo',
  pantorrillas: 'Gastrocnemio y Sóleo',
  gemelos: 'Gastrocnemio y Sóleo',
  abdominals: 'Recto Abdominal y Transverso',
  abdomen: 'Recto Abdominal y Core',
  obliques: 'Oblicuos Externos e Internos',
  adductors: 'Aductores de Cadera',
  'hip adductors': 'Aductores de Cadera',
  abductors: 'Glúteo Medio y Tensor de la Fascia Lata',
};

function translateMuscleTag(raw: string): string {
  const clean = normalizeSimple(raw);
  if (!clean) return '';
  if (SPANISH_MUSCLE_NAMES[clean]) return SPANISH_MUSCLE_NAMES[clean];
  for (const [k, v] of Object.entries(SPANISH_MUSCLE_NAMES)) {
    if (clean.includes(k)) return v;
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function createTempoFromValues(
  eccentricSec: number,
  bottomPauseSec: number,
  concentricSec: number,
  topPauseSec: number
): import('../types').ExerciseTempo {
  const e = Math.max(1, Math.min(8, Math.round(eccentricSec)));
  const b = Math.max(0, Math.min(5, Math.round(bottomPauseSec)));
  const c = Math.max(1, Math.min(5, Math.round(concentricSec)));
  const t = Math.max(0, Math.min(5, Math.round(topPauseSec)));
  const notation = `${e}-${b}-${c}-${t}`;
  const summary = `${e}s excéntrica · ${b}s transición · ${c}s concéntrica · ${t}s isometría`;
  return {
    eccentricSec: e,
    bottomPauseSec: b,
    concentricSec: c,
    topPauseSec: t,
    notation,
    summary,
  };
}

export function parseTempoNotation(
  notation?: string | null,
  fallback?: import('../types').ExerciseTempo
): import('../types').ExerciseTempo {
  const defaultFallback = fallback || createTempoFromValues(3, 1, 1, 0);
  if (!notation || typeof notation !== 'string') return defaultFallback;
  const parts = notation
    .trim()
    .split(/[-:\s/]+/)
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (parts.length !== 4) return defaultFallback;
  return createTempoFromValues(parts[0], parts[1], parts[2], parts[3]);
}

/**
 * Resuelve el desglose muscular específico (principales y secundarios) para un ejercicio
 */
export function resolveSpecificExerciseMuscles(
  name: string,
  muscleGroup: string = '',
  libMatch?: LibraryExercise
): import('../types').ExerciseMuscleBreakdown {
  const n = normalizeSimple(name);
  const pattern = resolveMovementPattern(name, muscleGroup);

  const primarySet = new Set<string>();
  const secondarySet = new Set<string>();

  if (libMatch?.primaryMuscles && libMatch.primaryMuscles.length > 0) {
    libMatch.primaryMuscles.forEach((m) => {
      const tr = translateMuscleTag(m);
      if (tr) primarySet.add(tr);
    });
  }
  if (libMatch?.secondaryMuscles && libMatch.secondaryMuscles.length > 0) {
    libMatch.secondaryMuscles.forEach((m) => {
      const tr = translateMuscleTag(m);
      if (tr) secondarySet.add(tr);
    });
  }

  // Enriquecer con precisión biomecánica según el ejercicio exacto
  if (/encogimiento|shrug/i.test(n)) {
    primarySet.clear();
    primarySet.add('Trapecio Superior');
    secondarySet.add('Elevador de la Escápula');
    secondarySet.add('Flexores de Antebrazo (Agarre)');
  } else if (pattern === 'Empuje Horizontal') {
    if (/inclinado/.test(n)) {
      primarySet.add('Pectoral Mayor (Porción Clavicular)');
    } else if (/declinado|fondos/.test(n)) {
      primarySet.add('Pectoral Mayor (Porción Esternocostal Inferior)');
    } else {
      primarySet.add('Pectoral Mayor (Porción Esternal)');
    }
    secondarySet.add('Deltoides Anterior');
    secondarySet.add('Tríceps Braquial');
  } else if (pattern === 'Aducción Pectoral') {
    primarySet.add('Pectoral Mayor (Fibras Esternales y Claviculares)');
    secondarySet.add('Deltoides Anterior');
    secondarySet.add('Bíceps Braquial (Estabilizador Isométrico)');
  } else if (pattern === 'Empuje Vertical') {
    primarySet.add('Deltoides Anterior');
    primarySet.add('Deltoides Lateral');
    secondarySet.add('Tríceps Braquial');
    secondarySet.add('Trapecio Superior y Serrato Anterior');
  } else if (pattern === 'Aislamiento Deltoides') {
    if (/pajaro|posterior|face pull/.test(n)) {
      primarySet.add('Deltoides Posterior');
      secondarySet.add('Trapecio Medio y Romboides');
      secondarySet.add('Infraespinoso');
    } else {
      primarySet.add('Deltoides Lateral (Porción Acromial)');
      secondarySet.add('Deltoides Anterior');
      secondarySet.add('Supraespinoso y Trapecio Superior');
    }
  } else if (pattern === 'Tracción Vertical') {
    primarySet.add('Dorsal Ancho');
    primarySet.add('Redondo Mayor');
    secondarySet.add('Bíceps Braquial y Braquiorradial');
    secondarySet.add('Romboides y Trapecio Inferior');
  } else if (pattern === 'Tracción Horizontal') {
    primarySet.add('Dorsal Ancho');
    primarySet.add('Trapecio Medio y Romboides');
    secondarySet.add('Deltoides Posterior');
    secondarySet.add('Bíceps Braquial y Braquial Anterior');
  } else if (pattern === 'Dominante de Rodilla') {
    primarySet.add('Cuádriceps (Recto Femoral y Vastos)');
    if (/bulgara|zancada|prensa|sentadilla/.test(n)) {
      primarySet.add('Glúteo Mayor');
    }
    secondarySet.add('Aductores y Glúteo Medio');
    secondarySet.add('Erectores Espinales y Core');
  } else if (pattern === 'Extensión de Rodilla') {
    primarySet.add('Cuádriceps (Vasto Medial, Lateral, Intermedio y Recto Femoral)');
    secondarySet.add('Estabilizadores de Cadera (Isométrico)');
  } else if (pattern === 'Dominante de Cadera') {
    if (/hip thrust|puente|patada/.test(n)) {
      primarySet.add('Glúteo Mayor');
      secondarySet.add('Isquiotibiales');
      secondarySet.add('Glúteo Medio y Core');
    } else {
      primarySet.add('Isquiotibiales (Bíceps Femoral, Semitendinoso)');
      primarySet.add('Glúteo Mayor');
      secondarySet.add('Erectores Espinales y Romboides');
      secondarySet.add('Flexores de Antebrazo (Agarre)');
    }
  } else if (pattern === 'Flexión de Rodilla') {
    primarySet.add('Isquiotibiales (Bíceps Femoral, Semimembranoso y Semitendinoso)');
    secondarySet.add('Gastrocnemio (Gemelos)');
  } else if (pattern === 'Flexión de Codo') {
    if (/martillo|neutro|inverso/.test(n)) {
      primarySet.add('Braquial Anterior y Braquiorradial');
      primarySet.add('Bíceps Braquial');
    } else {
      primarySet.add('Bíceps Braquial (Cabeza Larga y Corta)');
    }
    secondarySet.add('Braquial Anterior');
    secondarySet.add('Flexores del Antebrazo');
  } else if (pattern === 'Extensión de Codo') {
    if (/copa|frances|tras nuca|overhead/.test(n)) {
      primarySet.add('Tríceps Braquial (Énfasis en Cabeza Larga)');
    } else {
      primarySet.add('Tríceps Braquial (Cabeza Lateral, Medial y Larga)');
    }
    secondarySet.add('Ancóneo y Estabilizadores de Muñeca');
  } else if (pattern === 'Flexión Plantar') {
    if (/sentado|soleo/.test(n)) {
      primarySet.add('Sóleo');
      secondarySet.add('Gastrocnemio');
    } else {
      primarySet.add('Gastrocnemio (Gemelo Medial y Lateral)');
      secondarySet.add('Sóleo');
    }
  } else if (pattern === 'Abducción de Cadera') {
    primarySet.add('Glúteo Medio y Glúteo Menor');
    secondarySet.add('Tensor de la Fascia Lata');
  } else if (pattern === 'Aducción de Cadera') {
    primarySet.add('Aductor Mayor, Largo y Corto');
    secondarySet.add('Pectíneo y Grácil');
  } else if (pattern === 'Control Cervical') {
    if (primarySet.size === 0) {
      if (/flexion/.test(n) || /retraccion|chin tuck/.test(n)) {
        primarySet.add('Flexores Cervicales Profundos (Largo del Cuello)');
      } else if (/extension/.test(n)) {
        primarySet.add('Extensores Cervicales Profundos y Esplenio');
      } else if (/inclinacion/.test(n)) {
        primarySet.add('Escalenos y Esternocleidomastoideo (Lateral)');
      } else {
        primarySet.add('Estabilizadores Cervicales Profundos');
      }
    }
    if (secondarySet.size === 0) {
      secondarySet.add('Suboccipitales y Trapecio Medio/Inferior');
    }
  } else if (pattern === 'Estabilización Escapular y Rotación Externa') {
    if (primarySet.size === 0) {
      if (/rotacion externa|face pull/.test(n)) {
        primarySet.add('Manguito Rotador (Infraespinoso y Redondo Menor)');
        primarySet.add('Deltoides Posterior');
      } else if (/deslizamiento/.test(n)) {
        primarySet.add('Serrato Anterior y Trapecio Inferior');
      } else if (/elevacion en y/.test(n)) {
        primarySet.add('Trapecio Inferior y Deltoides');
      } else {
        primarySet.add('Deltoides Posterior, Romboides y Trapecio Medio');
      }
    }
    if (secondarySet.size === 0) {
      secondarySet.add('Estabilizadores Escapulares y Core');
    }
  } else if (pattern === 'Core / Anti-Rotación') {
    primarySet.add('Recto Abdominal y Transverso del Abdomen');
    secondarySet.add('Oblicuos Internos y Externos');
  }

  if (primarySet.size === 0) {
    const tr = translateMuscleTag(muscleGroup || 'Músculo Objetivo');
    primarySet.add(tr || 'Músculo Principal');
  }
  if (secondarySet.size === 0) {
    secondarySet.add('Estabilizadores del Core y Cintura Escapular');
  }

  // Asegurar que un músculo secundario no duplique exactamente el principal
  primarySet.forEach((p) => secondarySet.delete(p));
  if (secondarySet.size === 0) {
    secondarySet.add('Sinergistas Articulares y Estabilizadores');
  }

  return {
    primary: Array.from(primarySet),
    secondary: Array.from(secondarySet),
  };
}

/**
 * Genera el perfil completo TECHNIQUE PRO 7.0 para cualquier ejercicio (original o sustituto)
 */
export function buildTechniqueProProfile(input: {
  id?: string;
  libraryExerciseId?: string;
  name: string;
  targetMuscles?: string;
  equipment?: string;
  defaultVideoUrl?: string;
  thumbnailUrl?: string;
  customTempo?: string;
}): import('../types').TechniqueProProfile {
  const libMatch = resolveLibraryExercise({
    id: input.id,
    libraryExerciseId: input.libraryExerciseId,
    name: input.name,
    equipment: input.equipment,
  });

  const exerciseName = input.name || libMatch?.name || 'Ejercicio de Fuerza';
  const n = normalizeSimple(exerciseName);
  const equipment = input.equipment || libMatch?.equipment || 'Equipamiento de Gimnasio';
  const eqNorm = normalizeSimple(equipment);
  const muscleGroup = input.targetMuscles || libMatch?.muscleGroup || 'Fuerza';
  const pattern = resolveMovementPattern(exerciseName, muscleGroup);
  const muscles = resolveSpecificExerciseMuscles(exerciseName, muscleGroup, libMatch);

  const libMotionUrl =
    libMatch?.videoUrl ||
    libMatch?.animationUrl ||
    (libMatch?.visualResourceStatus !== 'pending_resource' &&
    libMatch?.url &&
    !/\-poster\.webp$/i.test(libMatch.url)
      ? libMatch.url
      : '');
  const mediaUrl = libMotionUrl || input.defaultVideoUrl || '';
  const posterUrl = libMatch?.thumbnailUrl || input.thumbnailUrl || undefined;

  const isUnilateral = /unilateral|a una mano|a una pierna|bulgara|alterno|concentrado/.test(n);
  const isIncline = /inclinado|inclinada/.test(n);
  const isDecline = /declinado|declinada/.test(n);
  const isCable = /polea|cable|cuerda/.test(n) || /polea|cable/.test(eqNorm);
  const isMachine = /maquina|prensa|hack|jaca|multipower|smith|pec deck|contractor/.test(n) || /maquina/.test(eqNorm);
  const isDumbbell = /mancuerna|dumbbell|kettlebell|pesa rusa/.test(n) || /mancuerna/.test(eqNorm);
  const isBarbell = /barra|ez|olimpica/.test(n) || /barra/.test(eqNorm);

  let preSetTip = '';
  let specificTips: string[] = [];
  let startingPosition: string[] = [];
  let stepByStepExecution: string[] = [];
  let breathing = {
    eccentricPhase: '',
    concentricPhase: '',
    bracingCue: '',
  };
  let commonMistakes: string[] = [];
  let baseTempo = createTempoFromValues(3, 1, 1, 0);
  let safetyRecommendations: string[] = [];

  if (pattern === 'Control Cervical') {
    const isBand = /banda/.test(n) || /banda/.test(eqNorm);
    const isIso = /isometric/.test(n);

    preSetTip = `En ${exerciseName}, prioriza alineación neutra sin carga máxima ni movimientos balísticos; aplica esfuerzo suave y respiración continua.`;

    startingPosition = [
      libMatch?.startingPosition ||
        `Sitúa la cabeza en alineación neutra sobre la línea de los hombros con ${equipment} preparado sin tensión brusca.`,
      'Deprime suavemente los hombros lejos de las orejas y activa el tronco sin bloquear el diafragma.',
    ];

    stepByStepExecution = [
      libMatch?.startingPosition || 'Verifica que el mentón no se eleve ni comprima la garganta al iniciar.',
      libMatch?.activePhase ||
        (isIso
          ? `Aplica resistencia ligera (20–40%) con ${equipment} manteniendo el cuello completamente estable y centrado.`
          : `Ejecuta la retracción cervical de manera lenta y horizontal en ${exerciseName} sin cabeceos.`),
      libMatch?.returnPhase ||
        'Sostén la fase de control y retorna de manera gradual en 2 a 3 segundos sin soltar la postura.',
      ...(libMatch?.shortInstructions ? libMatch.shortInstructions.slice(0, 1) : []),
    ];

    specificTips = [
      `Controla la intensidad en ${exerciseName}: utiliza únicamente resistencia manual o banda ligera, nunca cargas máximas.`,
      isBand
        ? 'Coloca la banda elástica plana para evitar deslizamientos y mantén un recorrido corto y guiado.'
        : 'Mantén los hombros bajos y el pecho erguido para aislar la musculatura cervical sin tensar trapecios.',
      'Respira de forma fluida durante toda la contracción; evita contener el aire (sin maniobra de Valsalva).',
      'Evita la hiperextensión cervical forzada o giros rápidos al final del recorrido.',
    ];

    breathing = {
      eccentricPhase: 'Inhala suavemente por la nariz antes y durante el retorno progresivo.',
      concentricPhase: 'Exhala de forma continua sin cortar la respiración durante la activación o isometría.',
      bracingCue: 'Conserva el abdomen suavemente activo para fijar la postura torácica y alinear la nuca.',
    };

    commonMistakes = [
      'Aplicar fuerza máxima, velocidad balística o tirones bruscos sobre la columna cervical.',
      'Elevar el mentón forzando hiperextensión suboccipital o contener la respiración.',
      'Encoger los hombros hacia las orejas compensando con el trapecio superior.',
    ];

    baseTempo = isIso
      ? createTempoFromValues(2, 5, 2, 1)
      : createTempoFromValues(2, 3, 2, 1);

    safetyRecommendations = [
      ...(libMatch?.safetyWarnings || [
        'Prohibido realizar movimientos balísticos, cargas máximas o hiperextensión cervical forzada.',
      ]),
      ...(libMatch?.contraindications || [
        'Detener de inmediato ante mareos, vértigo, visión borrosa, hormigueo o dolor irradiado a hombro/brazo.',
      ]),
      'Guía técnica general de acondicionamiento físico; no sustituye valoración médica ni fisioterapéutica individual.',
    ];
  } else if (pattern === 'Estabilización Escapular y Rotación Externa') {
    preSetTip = `En ${exerciseName}, mantén hombros deprimidos lejos de las orejas y guía el trabajo con control escapular y del manguito rotador sin impulso lumbar.`;

    startingPosition = [
      libMatch?.startingPosition ||
        `Adopta postura erguida estable con ${equipment}, costillas bajas y abdomen ligeramente activo.`,
      'Coloca los hombros en posición neutra sin encogimiento ni proyección anterior.',
    ];

    stepByStepExecution = [
      libMatch?.activePhase ||
        `Inicia ${exerciseName} de forma fluida guiando el recorrido con la musculatura posterior del hombro y escápula.`,
      'Haz una pausa breve de 1 segundo en el punto de máxima activación manteniendo la articulación estable.',
      libMatch?.returnPhase ||
        'Retorna lentamente en 3 segundos resistiendo el retorno elástico de la banda sin perder tensión.',
      ...(libMatch?.shortInstructions ? libMatch.shortInstructions.slice(0, 1) : []),
    ];

    specificTips = [
      `Dosifica la tensión de ${equipment} para completar el rango limpio sin arquear la espalda baja.`,
      'Evita que los hombros suban hacia las orejas al acercarte al final del recorrido.',
      'Mantén las muñecas firmes y neutras siguiendo la línea natural del antebrazo.',
      'Controla especialmente la fase excéntrica de retorno para no perder estabilidad escapular.',
    ];

    breathing = {
      eccentricPhase: 'Inhala lento durante los 3 segundos en que la banda regresa a la posición de inicio.',
      concentricPhase: 'Exhala suave al abrir, rotar o retraer las escápulas con control.',
      bracingCue: 'Alinea pelvis y costillas evitando hiperextender la columna lumbar.',
    };

    commonMistakes = [
      'Usar una banda demasiado rígida obligando a compensar con trapecio superior o impulso del torso.',
      'Soltar de golpe el retorno elástico perdiendo el control excéntrico.',
      'Adelantar la cabeza hacia el frente durante la tracción.',
    ];

    baseTempo = createTempoFromValues(3, 0, 1, 1);

    safetyRecommendations = [
      ...(libMatch?.safetyWarnings || [
        `Verifica el anclaje y estado de ${equipment} antes de aplicar tensión frente al cuerpo o rostro.`,
      ]),
      ...(libMatch?.contraindications || [
        'Suspende la serie si aparece pinzamiento subacromial o dolor agudo en el hombro.',
      ]),
    ];
  } else if (pattern === 'Empuje Horizontal') {
    const angleDesc = isIncline
      ? 'el banco inclinado entre 30° y 45° para priorizar la porción clavicular'
      : isDecline
      ? 'el soporte declinado asegurando el anclaje firme de piernas'
      : 'la superficie horizontal manteniendo los cinco puntos de apoyo';

    preSetTip = `Retrae y deprime las escápulas contra el respaldo antes de mover la carga en ${exerciseName}; mantén los codos a 45°–65° del torso.`;

    startingPosition = [
      `Configura ${angleDesc} y ajusta la altura de inicio en ${equipment}.`,
      'Apoya toda la planta de los pies en el suelo para generar transferencia firme desde el tren inferior.',
      `Junta las escápulas hacia atrás y abajo ("guardándolas en los bolsillos traseros") antes de tomar ${isDumbbell ? 'las mancuernas' : isCable ? 'los agarres de la polea' : 'la barra o empuñaduras'}.`,
      'Alinea las muñecas rectas directamente sobre la línea de los codos en todo el recorrido.',
    ];

    stepByStepExecution = [
      `Desbloquea la carga en ${exerciseName} estabilizando los hombros lejos de las orejas.`,
      `Desciende de forma controlada hacia la línea ${isIncline ? 'clavicular superior' : 'media del esternón'} manteniendo los antebrazos perpendiculares al vector de carga.`,
      'Siente el estiramiento activo del pectoral en el punto inferior durante 1 segundo sin perder la tensión escapular.',
      'Empuja con aceleración controlada hasta extender los codos sin despegar los hombros del respaldo.',
    ];

    specificTips = [
      `En ${exerciseName}, evita abrir los codos a 90° respecto al hombro; un ángulo de 45°–65° optimiza la línea de tracción del pectoral.`,
      isDumbbell
        ? 'En la fase concéntrica, aproxima las mancuernas describiendo un arco convergente sin chocarlas arriba.'
        : isMachine
        ? 'Ajusta el asiento de la máquina para que las empuñaduras queden exactamente a la altura media del pecho.'
        : 'Tracciona visualmente el agarre intentando juntar los bíceps hacia la línea media del pecho.',
      'Conserva una curva lumbar natural estable con los glúteos apoyados en todo momento.',
      isUnilateral
        ? 'Activa los oblicuos del lado opuesto para evitar que el tronco rote durante el empuje unilateral.'
        : 'Mantén una presión simétrica en ambos pies para evitar inclinaciones laterales de la barra o mancuernas.',
    ];

    breathing = {
      eccentricPhase: 'Inhala profundamente por la nariz durante los 3 segundos de descenso expandiendo la caja torácica.',
      concentricPhase: 'Exhala con firmeza al superar el punto de mayor dificultad mecánica en el empuje.',
      bracingCue: 'Mantén la presión intraabdominal activa antes de iniciar cada bajada.',
    };

    commonMistakes = [
      'Protraer (adelantar) los hombros al final del empuje, transfiriendo la tensión del pectoral al deltoides anterior.',
      'Rebotar la carga en la parte baja del recorrido para ganar inercia.',
      'Flexionar las muñecas hacia atrás en lugar de mantener el nudillo alineado con el radio y cúbito.',
      'Despegar los glúteos o los pies del suelo al esforzarse en las últimas repeticiones.',
    ];

    baseTempo = createTempoFromValues(3, 1, 1, 0);

    safetyRecommendations = [
      isBarbell
        ? 'Utiliza topes de seguridad ajustados a la altura del pecho o solicita asistencia en series cercanas al límite.'
        : isMachine
        ? 'Verifica que el pasador selector de carga esté completamente insertado antes de soltar el seguro.'
        : 'Al terminar la serie con mancuernas, lleva las rodillas hacia ellas para bajarlas con control, nunca las sueltes con el hombro en abducción.',
      'Detén la serie si notas pérdida de estabilidad escapular en las repeticiones finales.',
    ];
  } else if (pattern === 'Aducción Pectoral') {
    preSetTip = `Mantén una semiflexión constante de codos (15°–20°) en ${exerciseName}; el movimiento ocurre únicamente en la articulación del hombro.`;

    startingPosition = [
      `Ajusta ${equipment} de modo que las manos queden alineadas con el plano del pectoral.`,
      'Retrae las escápulas contra el apoyo o mantén el torso estable con el esternón elevado.',
      'Fija una ligera flexión en los codos para proteger el tendón del bíceps.',
    ];

    stepByStepExecution = [
      `Abre los brazos de forma controlada en un arco amplio siguiendo la dirección de las fibras en ${exerciseName}.`,
      'Detén la apertura cuando los codos lleguen al plano del torso, evitando hiperextender la cápsula anterior del hombro.',
      'Cierra el arco imaginando que juntas los codos y bíceps frente al esternón.',
      'Mantén 1 segundo de contracción isométrica máxima en el punto de cierre.',
    ];

    specificTips = [
      `El ángulo del codo permanece bloqueado de principio a fin en ${exerciseName}; no conviertas la apertura en un press.`,
      isCable
        ? 'Da medio paso al frente para poner las poleas en tensión antes de iniciar la primera repetición.'
        : 'En el punto de máximo estiramiento con mancuernas, reduce el brazo de palanca sin pasar los codos detrás de la espalda.',
      'Enfoca la intención mental en acercar los húmeros hacia la línea media del pecho.',
      'Evita encoger los trapecios superiores cuando alcanzas el cierre.',
    ];

    breathing = {
      eccentricPhase: 'Inhala de forma continua mientras abres los brazos y estiras las fibras pectorales.',
      concentricPhase: 'Exhala gradualmente al cerrar el arco y aprieta el pectoral al final.',
      bracingCue: 'Estabiliza las costillas para que el tronco no se arquee al abrir los brazos.',
    };

    commonMistakes = [
      'Bajar los codos demasiado por detrás de la línea de los hombros en la fase excéntrica.',
      'Chocar los implementos en el centro perdiendo la tensión continua en los últimos centímetros.',
      'Flexionar y extender los codos convirtiendo el aislamiento en un empuje compuesto.',
    ];

    baseTempo = createTempoFromValues(3, 1, 2, 1);

    safetyRecommendations = [
      'Prioriza cargas moderadas que permitan controlar la transición en máximo estiramiento.',
      'Regula los topes traseros de la máquina contractora o polea para no forzar la rotación externa bajo carga.',
    ];
  } else if (pattern === 'Empuje Vertical') {
    preSetTip = `Activa glúteos y abdomen antes de empujar en ${exerciseName}; inicia con los antebrazos verticales en el plano escapular (30° hacia adelante).`;

    startingPosition = [
      `Ajusta ${equipment} y coloca el agarre ligeramente más ancho que la línea de los hombros.`,
      'Posiciona los codos unos 30° por delante del plano frontal (plano escapular) para libre recorrido acromial.',
      'Contrae firme el abdomen y glúteos para fijar la pelvis en posición neutra.',
    ];

    stepByStepExecution = [
      `Inicia el empuje vertical en ${exerciseName} desplazando ligeramente el mentón hacia atrás para que la carga suba en línea recta.`,
      'A medida que el implemento supera la frente, alinea el torso debajo de la carga hasta extender los codos.',
      'Desciende controladamente en 3 segundos hasta la altura de la barbilla o clavícula superior.',
      'Mantén los antebrazos perpendiculares al suelo en la posición baja antes de la siguiente repetición.',
    ];

    specificTips = [
      `En ${exerciseName}, evita arquear la zona lumbar para compensar la falta de fuerza vertical; mantén las costillas bajas.`,
      'Tus muñecas deben permanecer firmes y neutras, apiladas exactamente sobre los codos.',
      isDumbbell
        ? 'No choques las mancuernas arriba; detén el ascenso justo encima de los hombros para no perder tensión.'
        : 'Mantén la trayectoria lo más cercana posible al centro de gravedad sin alejar la barra hacia adelante.',
      'Al bajar, controla que los codos apunten hacia el suelo y ligeramente al frente, nunca hacia atrás.',
    ];

    breathing = {
      eccentricPhase: 'Inhala mientras bajas la carga con control hacia el nivel clavicular.',
      concentricPhase: 'Exhala en el último tercio de la extensión vertical sobre la cabeza.',
      bracingCue: 'Toma aire y bloquea el cinturón abdominal antes de despegar la carga desde los hombros.',
    };

    commonMistakes = [
      'Hiperextender la columna lumbar convirtiendo el press vertical en un press inclinado.',
      'Recortar la mitad inferior del recorrido quedándose a la altura de la frente.',
      'Abrir los codos a 90° exactos hacia los lados provocando pinzamiento mecánico.',
    ];

    baseTempo = createTempoFromValues(3, 0, 1, 1);

    safetyRecommendations = [
      'Si entrenas sentado, apoya toda la espalda alta contra el respaldo a 75°–85°.',
      'Verifica que el espacio sobre tu cabeza y alrededor de la estación esté completamente despejado.',
    ];
  } else if (pattern === 'Aislamiento Deltoides') {
    const isPosterior = /pajaro|posterior|face pull/.test(n);
    preSetTip = isPosterior
      ? `Separa las escápulas y guía el movimiento con la parte posterior de los codos en ${exerciseName}, evitando juntar los omóplatos al inicio.`
      : `Eleva pensando en empujar las paredes laterales con los codos en ${exerciseName}, no en levantar las manos por encima de los hombros.`;

    startingPosition = [
      `Toma ${equipment} con postura estable, rodillas ligeramente desbloqueadas y pecho erguido.`,
      isPosterior
        ? 'Inclina el torso o apoya el pecho según la variante, dejando los brazos colgando en línea perpendicular al torso.'
        : 'Inclina el tronco apenas 5°–10° hacia adelante y sitúa los brazos en el plano escapular (30° al frente).',
      'Desbloquea los codos manteniéndolos con una ligera flexión fija de 15°.',
    ];

    stepByStepExecution = [
      `Inicia la elevación en ${exerciseName} sin impulso de cadera ni balanceo de rodillas.`,
      isPosterior
        ? 'Abre los brazos hacia afuera y atrás hasta que los codos alcancen la línea del torso.'
        : 'Sube en arco lateral hasta que los codos lleguen a la altura de los hombros (paralelos al suelo).',
      'Sostén una pausa isométrica breve en la cima manteniendo los hombros deprimidos lejos de las orejas.',
      'Desciende en 3 segundos resistiendo la gravedad y detente antes de que la carga descanse abajo.',
    ];

    specificTips = [
      `Mantén los trapecios relajados y las escápulas bajas durante todo ${exerciseName} para aislar el deltoides.`,
      isCable
        ? 'Aprovecha la tensión continua de la polea desde los primeros grados de abducción.'
        : 'Detén el descenso a unos centímetros del muslo para no perder la tensión mecánica en el punto inferior.',
      'Lidera siempre con el codo: la muñeca nunca debe superar la altura del codo en el punto alto.',
      'Evita girar excesivamente los pulgares hacia abajo para conservar espacio subacromial.',
    ];

    breathing = {
      eccentricPhase: 'Inhala de forma pausada mientras bajas los brazos resistiendo el peso.',
      concentricPhase: 'Exhala al elevar los codos hasta la horizontal.',
      bracingCue: 'Mantén el abdomen firme para impedir cualquier balanceo del tronco.',
    };

    commonMistakes = [
      'Impulsar el peso con extensión de cadera y rodillas por usar una carga excesiva.',
      'Encoger los hombros hacia las orejas activando el trapecio superior en lugar del deltoides.',
      'Doblar los codos a 90° acortando artificialmente la palanca y subiendo solo las manos.',
    ];

    baseTempo = createTempoFromValues(3, 0, 1, 1);

    safetyRecommendations = [
      'Selecciona un peso que puedas sostener 1 segundo completo en el punto más alto sin temblor articular.',
      'Respeta el plano escapular (30° hacia adelante) para un deslizamiento limpio de la articulación.',
    ];
  } else if (pattern === 'Tracción Vertical') {
    preSetTip = `Inicia ${exerciseName} deprimiendo las escápulas ("hombros lejos de las orejas") y tracciona pensando en clavar los codos hacia tus bolsillos.`;

    startingPosition = [
      `Ajusta el soporte de muslos o sujétate con agarre firme en ${equipment}.`,
      'Estira los brazos por completo arriba permitiendo una ligera elevación escapular controlada.',
      'Activa el abdomen y mantén una leve extensión torácica (esternón elevado unos 10°–15°).',
    ];

    stepByStepExecution = [
      `Comienza la tracción en ${exerciseName} bajando los hombros (depresión escapular) antes de doblar los codos.`,
      'Tira llevando los codos hacia abajo y ligeramente al frente en dirección a las crestas ilíacas.',
      'Aproxima la barra o agarres a la parte superior del esternón juntando las escápulas abajo.',
      'Regresa de forma controlada en 3 segundos hasta estirar por completo el dorsal ancho sin soltar el control.',
    ];

    specificTips = [
      `Utiliza tus manos como ganchos en ${exerciseName}; la fuerza nace desde el codo, no desde el bíceps.`,
      'Evita inclinarte hacia atrás más de 15°–20°, lo cual convertiría el jalón vertical en un remo.',
      'Mantén el pecho alto al llegar abajo; no dejes que los hombros giren hacia adelante al final del tirón.',
      'Controla los últimos centímetros de subida para aprovechar el estiramiento bajo carga del dorsal.',
    ];

    breathing = {
      eccentricPhase: 'Inhala profundamente mientras los brazos suben y el dorsal se estira.',
      concentricPhase: 'Exhala con fuerza al traccionar hacia el esternón y apretar la espalda.',
      bracingCue: 'Fija la pelvis contra el asiento para evitar que el peso te levante.',
    };

    commonMistakes = [
      'Tirar la barra por detrás de la nuca forzando la rotación externa extrema del hombro.',
      'Balancear el tronco hacia atrás usando el peso corporal para bajar la carga.',
      'Encoger los hombros y adelantar los codos en la parte final del recorrido.',
    ];

    baseTempo = createTempoFromValues(3, 1, 1, 1);

    safetyRecommendations = [
      'Realiza siempre la tracción por delante del rostro hacia la clavícula superior.',
      'Al terminar la última repetición, acompaña el cable o soporte hasta el tope sin soltarlo de golpe.',
    ];
  } else if (pattern === 'Tracción Horizontal') {
    preSetTip = `Mantén la columna neutra en ${exerciseName}, inicia retrayendo la escápula y lleva los codos pegados o a 45° según el énfasis dorsal/espinal.`;

    startingPosition = [
      `Posiciónate en ${equipment} asegurando estabilidad en pies y cadera (o pecho apoyado si la estación dispone de soporte).`,
      'Alinea la columna desde el sacro hasta la cervical sin redondear la zona lumbar.',
      'Toma los agarres con brazos extendidos sintiendo la protracción inicial controlada del omóplato.',
    ];

    stepByStepExecution = [
      `Inicia la fase concéntrica de ${exerciseName} llevando los hombros hacia atrás (retracción escapular).`,
      'Tracciona los codos hacia la cadera (énfasis dorsal) o a 45° del torso (énfasis trapecio medio y romboides).',
      'Sostén 1 segundo de contracción isométrica cuando las manos lleguen al torso.',
      'Extiende los brazos en 3 segundos permitiendo que las escápulas se abran al final sin encorvar la espalda baja.',
    ];

    specificTips = [
      `En ${exerciseName}, el torso permanece inmóvil; el movimiento es 100% escapular y humeral.`,
      'No dobles las muñecas hacia adentro al final del jalón; mantén el antebrazo alineado con la línea del cable o carga.',
      isUnilateral
        ? 'Apoya firme la mano libre y evita rotar la columna torácica para ganar rango falso.'
        : 'Asegúrate de que ambos codos lleguen exactamente a la misma profundidad detrás del torso.',
      'Deprime los hombros para evitar que el trapecio superior robe estímulo al dorsal.',
    ];

    breathing = {
      eccentricPhase: 'Inhala mientras extiendes los brazos y abres las escápulas bajo control.',
      concentricPhase: 'Exhala al llevar los codos atrás y exprimir la musculatura media de la espalda.',
      bracingCue: 'Bloquea el cinturón abdominal a 360° especialmente en variantes sin apoyo en el pecho.',
    };

    commonMistakes = [
      'Mecer el tronco hacia adelante y atrás para impulsar la carga con los erectores espinales.',
      'Frenar el recorrido a mitad de camino sin completar la retracción escapular.',
      'Levantar la mirada hiperextendiendo el cuello durante la tracción.',
    ];

    baseTempo = createTempoFromValues(3, 1, 1, 1);

    safetyRecommendations = [
      'En variantes con peso libre inclinadas, flexiona ligeramente las rodillas y mantén el peso en medio pie.',
      'Si sientes fatiga lumbar antes que dorsal, prioriza apoyar el pecho o usar agarre neutro.',
    ];
  } else if (pattern === 'Dominante de Rodilla') {
    preSetTip = `En ${exerciseName}, apoya el trípode plantar completo (talón, base del pulgar y meñique) y alinea las rodillas en dirección a la punta de los pies.`;

    startingPosition = [
      `Coloca los pies en ${equipment} a una anchura cómoda (generalmente ancho de hombros) con rotación externa de 10°–20°.`,
      isMachine
        ? 'Apoya toda la espalda y el sacro firmemente contra el respaldo sin dejar huecos lumbares.'
        : 'Estabiliza la carga sobre trapecios o frente al pecho manteniendo el torso compacto y la mirada al frente.',
      'Toma aire profundo inflando el cinturón abdominal a 360° antes de desbloquear las rodillas.',
    ];

    stepByStepExecution = [
      `Inicia el descenso en ${exerciseName} flexionando simultáneamente rodillas y cadera con cadencia de 3 segundos.`,
      'Permite que las rodillas avancen de forma natural en la misma dirección que apuntan los dedos de los pies.',
      'Desciende hasta la máxima profundidad donde tu pelvis y zona lumbar permanezcan totalmente neutras.',
      'Empuja el suelo o plataforma con toda la planta del pie hasta extender sin bloquear en hiperextensión brusca.',
    ];

    specificTips = [
      `Nunca permitas que los talones se despeguen en la parte baja de ${exerciseName}.`,
      'Evita el valgo dinámico (que las rodillas colapsen hacia adentro al iniciar la subida).',
      isMachine
        ? 'No despegues el glúteo del asiento en el fondo de la prensa o hack; detén la bajada justo antes de que la pelvis bascule.'
        : 'Mantén los codos apuntando hacia abajo y el dorsal compacto para que el tronco no se venza hacia adelante.',
      'Conserva tensión constante en los cuádriceps en el último 5% superior sin encajar las rodillas en seco.',
    ];

    breathing = {
      eccentricPhase: 'Inhala profundamente arriba, presuriza el abdomen y desciende manteniendo la estabilidad.',
      concentricPhase: 'Exhala con fuerza al superar el ángulo de 90° en el ascenso.',
      bracingCue: 'Expande las paredes abdominales y oblicuos hacia afuera como un cinturón rígido.',
    };

    commonMistakes = [
      'Bloquear las rodillas de golpe en la parte superior del recorrido bajo cargas altas.',
      'Dejar que las rodillas se metan hacia adentro en el punto de mayor esfuerzo.',
      'Redondear la espalda baja (retroversión pélvica forzada) por bajar más allá de tu movilidad activa.',
    ];

    baseTempo = createTempoFromValues(3, 1, 1, 0);

    safetyRecommendations = [
      isMachine
        ? 'Asegura manualmente ambos seguros laterales de la plataforma antes de soltar la presión de las piernas.'
        : 'Configura las barras de seguridad del rack justo por debajo de tu punto de máxima profundidad.',
      'Mantén las manos en las empuñaduras laterales en máquinas, nunca empujando sobre tus propias rodillas.',
    ];
  } else if (pattern === 'Extensión de Rodilla') {
    preSetTip = `Alinea el eje de rotación de la máquina exactamente con tu articulación de la rodilla en ${exerciseName} y sujétate firme de las asas laterales.`;

    startingPosition = [
      'Ajusta el respaldo para que la parte posterior de tus rodillas repose justo en el borde del asiento.',
      'Coloca la almohadilla del rodillo en la parte inferior de la tibia (justo encima del tobillo, no sobre el empeine).',
      'Sujeta con fuerza los agarres laterales para mantener la cadera y los glúteos pegados al asiento.',
    ];

    stepByStepExecution = [
      `Extiende las piernas de forma fluida en ${exerciseName} mantendo las puntas de los pies neutras (apuntando al frente).`,
      'Completa la extensión total de la rodilla y sostén 1 segundo de contracción isométrica máxima en el cuádriceps.',
      'Desciende la carga en 3 segundos resistiendo el retorno del rodillo.',
      'Inicia la siguiente repetición justo antes de que las placas de peso choquen entre sí.',
    ];

    specificTips = [
      `La pausa de 1 segundo arriba es clave en ${exerciseName} para reclutar al máximo el vasto medial y recto femoral.`,
      'No levantes los glúteos del asiento al patear; tracciona hacia abajo con las manos en los agarres.',
      'Evita girar las puntas de los pies en exceso hacia adentro o afuera para no someter la rodilla a torsión.',
    ];

    breathing = {
      eccentricPhase: 'Inhala mientras flexionas las rodillas de regreso en 3 segundos.',
      concentricPhase: 'Exhala durante la extensión y aprieta en la cima.',
      bracingCue: 'Fija la pelvis contra el respaldo durante toda la serie.',
    };

    commonMistakes = [
      'Patear de forma explosiva con latigazo usando la inercia para lanzar el rodillo.',
      'Recortar los últimos 15 grados de extensión donde el cuádriceps recibe mayor tensión de acortamiento.',
      'Dejar caer el peso libremente en la fase negativa.',
    ];

    baseTempo = createTempoFromValues(3, 0, 1, 1);

    safetyRecommendations = [
      'Comprueba que el respaldo no quede demasiado atrás para no hiperextender la columna lumbar.',
      'Inicia la primera repetición con empuje progresivo, sin tirones bruscos desde el reposo.',
    ];
  } else if (pattern === 'Dominante de Cadera') {
    const isThrust = /hip thrust|puente|patada/.test(n);
    preSetTip = isThrust
      ? `Mantén la mirada al frente, las costillas bajas y empuja desde los talones en ${exerciseName} hasta alinear rodillas, cadera y hombros.`
      : `Inicia ${exerciseName} llevando la cadera hacia atrás como si cerraras una puerta con los glúteos, manteniendo la carga pegada a tus piernas.`;

    startingPosition = isThrust
      ? [
          `Apoya el borde inferior de las escápulas contra el banco o soporte de ${equipment}.`,
          'Coloca los pies a una distancia tal que, al subir la cadera, las tibias queden completamente verticales (90°).',
          'Posiciona la almohadilla protectora sobre el pliegue inguinal y sujeta la carga con ambas manos.',
        ]
      : [
          `Coloca los pies al ancho de las caderas con el peso distribuido en medio pie y talón frente a ${equipment}.`,
          'Desbloquea las rodillas unos 15°–20° y activa el dorsal ancho ("protege tus axilas").',
          'Alinea cabeza, columna torácica y pelvis en un bloque neutro inamovible.',
        ];

    stepByStepExecution = isThrust
      ? [
          `Empuja con los talones contra el suelo en ${exerciseName} extendiendo la cadera sin arquear la espalda baja.`,
          'Alcanza la línea horizontal completa realizando una ligera retroversión pélvica en la cima.',
          'Aprieta los glúteos durante 1 a 2 segundos completos manteniendo el mentón cerca del esternón.',
          'Desciende en 3 segundos articulando desde la cadera con el torso en bloque.',
        ]
      : [
          `Desplaza la cadera horizontalmente hacia atrás en ${exerciseName} deslizando la carga rozando los muslos y tibias.`,
          'Desciende solo hasta el punto donde tus isquiotibiales alcanzan su máximo estiramiento sin que la cadera siga bajando.',
          'Invierte el movimiento empujando el suelo con los pies y proyectando la cadera hacia adelante.',
          'Termina erguido contrayendo los glúteos sin hiperextender la columna lumbar.',
        ];

    specificTips = [
      isThrust
        ? `Si sientes más los cuádriceps en ${exerciseName}, aleja los pies un par de centímetros; si sientes los isquios, acércalos ligeramente.`
        : `En ${exerciseName}, la carga nunca debe separarse de tus piernas; mantenla pegada activando los dorsales.`,
      'Mantén el cuello alineado con el resto de la columna; no mires al techo al bajar.',
      isThrust
        ? 'Mueve el esternón y la pelvis como una sola pieza rígida para aislar el glúteo mayor.'
        : 'Una vez fijado el ángulo inicial de las rodillas en la bisagra, el movimiento procede exclusivamente de la cadera.',
    ];

    breathing = {
      eccentricPhase: 'Inhala profundamente antes o durante el descenso manteniendo la faja abdominal compacta.',
      concentricPhase: 'Exhala con potencia en la parte final de la extensión de cadera.',
      bracingCue: 'Genera presión abdominal intra-torácica firme para blindar la columna lumbar.',
    };

    commonMistakes = [
      'Redondear la espalda baja al intentar tocar el suelo más allá de la flexibilidad de los isquiotibiales.',
      'Hiperextender la zona lumbar al llegar arriba en lugar de finalizar con contracción de glúteos.',
      isThrust
        ? 'Empujar con las puntas de los pies levantando los talones.'
        : 'Alejar la barra o mancuernas de las espinillas multiplicando el estrés lumbar.',
    ];

    baseTempo = isThrust ? createTempoFromValues(3, 0, 1, 2) : createTempoFromValues(3, 1, 1, 0);

    safetyRecommendations = [
      'Prioriza la neutralidad de la columna vertebral sobre el rango de bajada o los kilos en la barra.',
      'En Hip Thrust pesado, utiliza siempre almohadilla gruesa sobre la pelvis para distribuir la presión.',
    ];
  } else if (pattern === 'Flexión de Rodilla') {
    preSetTip = `Pega la pelvis firmemente contra el tapizado durante todo ${exerciseName}; evita levantar las caderas al flexionar las rodillas.`;

    startingPosition = [
      `Ajusta el rodillo de ${equipment} en la parte distal de la pantorrilla (justo antes del tendón de Aquiles).`,
      'Alinea el eje de giro de la máquina con la línea lateral de tus rodillas.',
      'En variante sentada, bloquea firme el soporte sobre los muslos; en variante tumbada, presiona el pubis contra el banco.',
    ];

    stepByStepExecution = [
      `Inicia la flexión en ${exerciseName} traccionando los talones hacia los glúteos de forma continua.`,
      'Sostén 1 segundo de contracción máxima en el punto de mayor acortamiento sin despegar la cadera.',
      'Extiende las piernas de regreso en 3 segundos completos resistiendo la tracción excéntrica.',
      'Detén la extensión un instante antes del bloqueo total de la rodilla para mantener tensión en los isquios.',
    ];

    specificTips = [
      `En ${exerciseName}, mantener la pelvis pegada al banco evita que la espalda baja compense el movimiento.`,
      'Mantén los tobillos en posición neutra o ligera flexión plantar si deseas reducir la participación de los gemelos.',
      'Controla especialmente la primera mitad de la fase excéntrica, donde los isquiotibiales generan mayor fuerza.',
    ];

    breathing = {
      eccentricPhase: 'Inhala lentamente en los 3 segundos de extensión controlada.',
      concentricPhase: 'Exhala al llevar el rodillo hacia los glúteos.',
      bracingCue: 'Sujeta los agarres con firmeza para anclar el tronco al tapizado.',
    };

    commonMistakes = [
      'Arqueo lumbar y elevación de glúteos para mover cargas excesivas.',
      'Soltar la tensión en la bajada dejando que el rodillo regrese de golpe.',
      'Colocar el rodillo demasiado alto sobre el vientre muscular del gemelo.',
    ];

    baseTempo = createTempoFromValues(3, 0, 1, 1);

    safetyRecommendations = [
      'No hiperextiendas las rodillas al final de la fase negativa bajo carga.',
      'Realiza una serie previa de aproximación para preparar la unión miotendinosa distal.',
    ];
  } else if (pattern === 'Flexión de Codo') {
    preSetTip = `Clava los codos a los costados (o en el pupitre) durante ${exerciseName}; solo se mueve el antebrazo sin balancear hombros ni espalda.`;

    startingPosition = [
      `Toma ${equipment} con postura erguida, pies al ancho de caderas y escápulas retraídas.`,
      'Fija la parte superior del brazo perpendicular al suelo (o apoyada por completo en banco predicador/inclinado).',
      'Mantén las muñecas firmes y alineadas con el antebrazo, sin dejarlas caer en extensión.',
    ];

    stepByStepExecution = [
      `Flexiona los codos en ${exerciseName} contrayendo el bíceps sin que los hombros se adelanten.`,
      /martillo/.test(n)
        ? 'Mantén el agarre neutro (palmas enfrentadas) durante todo el recorrido.'
        : 'Completa la supinación activa (llevando el meñique ligeramente hacia adentro) al subir.',
      'Aprieta el bíceps 1 segundo en la parte alta sin subir los codos para descansar el peso sobre el hueso.',
      'Desciende en 3 segundos hasta estirar el brazo a un 95% conservando tensión activa.',
    ];

    specificTips = [
      `En ${exerciseName}, si tus codos avanzan más de 10° hacia adelante, el deltoides anterior está robando trabajo al bíceps.`,
      'No flexiones las muñecas hacia ti en la cima; mantén el dorso de la mano en línea recta con el radio.',
      'En la fase excéntrica, resiste el peso hasta alcanzar el estiramiento casi completo del codo.',
    ];

    breathing = {
      eccentricPhase: 'Inhala mientras extiendes los codos de forma controlada en 3 segundos.',
      concentricPhase: 'Exhala al flexionar el brazo y apretar en la cúspide.',
      bracingCue: 'Contrae glúteos y abdomen cuando trabajes de pie para eliminar todo balanceo lumbar.',
    };

    commonMistakes = [
      'Impulsar el peso con un golpe de cadera y espalda baja.',
      'Levantar los codos al final para apoyar la carga en la vertical del antebrazo.',
      'Recortar la mitad inferior del descenso perdiendo el rango de mayor estímulo hipertrófico.',
    ];

    baseTempo = createTempoFromValues(3, 0, 1, 1);

    safetyRecommendations = [
      'En banco predicador (Scott), evita soltar el peso de golpe en el último 10% de extensión inferior.',
      'Si sientes molestia en muñecas con barra recta, utiliza barra EZ o mancuernas.',
    ];
  } else if (pattern === 'Extensión de Codo') {
    const isOverhead = /copa|frances|tras nuca|overhead/.test(n);
    preSetTip = `Bloquea la posición del húmero en ${exerciseName}; el codo actúa como una bisagra fija donde únicamente gira el antebrazo.`;

    startingPosition = [
      `Configura ${equipment} y adopta una postura estable con el tronco firme.`,
      isOverhead
        ? 'Eleva los brazos manteniendo los codos apuntando hacia adelante/arriba sin que se abran hacia los lados.'
        : 'Pega los codos a las costillas con los hombros hacia atrás y el pecho erguido.',
      'Sujeta el implemento con muñecas rectas y firmes.',
    ];

    stepByStepExecution = [
      `En ${exerciseName}, flexiona únicamente los codos en la fase excéntrica hasta alcanzar un estiramiento profundo del tríceps.`,
      'Mantén los húmeros totalmente inmóviles durante la transición inferior.',
      'Extiende los codos con fuerza hasta bloquear suavemente la articulación y contraer las tres cabezas del tríceps.',
      /cuerda/.test(n)
        ? 'Separa ligeramente los extremos de la cuerda en el punto final de la extensión.'
        : 'Sostén 1 segundo de contracción máxima antes de iniciar el regreso controlado.',
    ];

    specificTips = [
      `La clave biomecánica de ${exerciseName} es evitar que el codo se desplace hacia adelante o atrás entre repeticiones.`,
      isOverhead
        ? 'El estiramiento del hombro por encima de la cabeza maximiza el reclutamiento de la cabeza larga del tríceps.'
        : 'En polea alta, da medio paso atrás e inclina el torso unos 15° para alinear la resistencia con el tríceps.',
      'No dejes que los hombros se encojan ni se vuelquen hacia adelante cuando el peso sube.',
    ];

    breathing = {
      eccentricPhase: 'Inhala en los 3 segundos en que el antebrazo se flexiona bajo carga.',
      concentricPhase: 'Exhala al extender el codo por completo y apretar el tríceps.',
      bracingCue: 'Mantén el abdomen tenso para evitar arquear la espalda baja en extensiones sobre la cabeza.',
    };

    commonMistakes = [
      'Mover los codos hacia adelante y abajo convirtiendo la extensión en un jalón o press.',
      'Abrir los codos hacia afuera cargando estrés valgo sobre el tendón del tríceps.',
      'No completar la extensión final del codo donde se logra la máxima contracción.',
    ];

    baseTempo = createTempoFromValues(3, 1, 1, 1);

    safetyRecommendations = [
      'Calienta la articulación del codo con una serie ligera de 15 repeticiones antes de usar cargas altas.',
      'En press francés o extensiones sobre la cabeza, baja siempre con control estricto lejos del rostro.',
    ];
  } else if (pattern === 'Flexión Plantar') {
    preSetTip = `En ${exerciseName}, realiza una pausa real de 2 segundos en el estiramiento inferior para eliminar el rebote elástico del tendón de Aquiles.`;

    startingPosition = [
      `Apoya la bola del pie (metatarsos) firmemente sobre el borde de la plataforma en ${equipment}.`,
      'Alinea tobillos, rodillas y caderas asegurando que el pie no resbale.',
    ];

    stepByStepExecution = [
      `Desciende los talones lentamente en ${exerciseName} hasta alcanzar la máxima dorsiflexión del tobillo.`,
      'Sostén 2 segundos en el fondo para disipar la energía elástica del tendón.',
      'Empuja sobre la base del dedo gordo y segundo dedo elevando los talones al máximo.',
      'Mantén 1 a 2 segundos de contracción isométrica en la punta antes de volver a bajar.',
    ];

    specificTips = [
      `Sin la pausa de 2 segundos abajo en ${exerciseName}, el tendón de Aquiles hace el trabajo en lugar del gastrocnemio y sóleo.`,
      'Sube en línea recta sobre los primeros metatarsianos, evitando que los tobillos se tuerzan hacia afuera.',
      'Recorre el 100% del rango articular disponible en cada repetición.',
    ];

    breathing = {
      eccentricPhase: 'Inhala mientras bajas los talones hacia el estiramiento profundo.',
      concentricPhase: 'Exhala al elevar los talones y sostener la punta.',
      bracingCue: 'En variantes de pie, mantén el core firme y las rodillas extendidas sin hiperextensión forzada.',
    };

    commonMistakes = [
      'Rebotar rápidamente con repeticiones cortas a mitad de recorrido.',
      'Flexionar y extender las rodillas para impulsar el peso con los cuádriceps.',
    ];

    baseTempo = createTempoFromValues(3, 2, 1, 2);

    safetyRecommendations = [
      'Utiliza calzado con suela antideslizante para asegurar el apoyo del metatarso en el escalón.',
      'Acciona el seguro de la máquina antes de bajar los pies de la plataforma.',
    ];
  } else {
    // Abducción, Aducción, Core o patrón generalizado con especificidad al ejercicio y equipamiento
    preSetTip = `Estabiliza la pelvis y el tronco en ${exerciseName}; ejecuta con cadencia 3-1-1-1 manteniendo tensión continua en ${muscles.primary[0]}.`;

    startingPosition = [
      libMatch?.startingPosition ||
        `Ajusta ${equipment} a tus proporciones anatómicas alineando la articulación principal con el eje de resistencia.`,
      'Adopta una postura estable apoyando firmemente la pelvis y espalda o activando el cinturón abdominal.',
      `Pre-activa ${muscles.primary.join(' y ')} antes de iniciar el primer centímetro de recorrido.`,
    ];

    stepByStepExecution = [
      libMatch?.activePhase ||
        `Inicia la fase concéntrica de ${exerciseName} de manera fluida y sin tirones bruscos.`,
      `Alcanza el punto de máxima contracción de ${muscles.primary[0]} y sostén una pausa isométrica de 1 a 2 segundos.`,
      libMatch?.returnPhase ||
        'Regresa en 3 segundos controlando el peso o tensión en cada grado del recorrido excéntrico.',
      'Inicia la siguiente repetición manteniendo la tensión muscular sin soltar el control postural.',
    ];

    specificTips = [
      ...(libMatch?.shortInstructions && libMatch.shortInstructions.length >= 2
        ? libMatch.shortInstructions.slice(0, 2)
        : []),
      `En ${exerciseName}, evita cualquier impulso con la espalda baja o balanceo del torso.`,
      `Concéntrate en sentir el trabajo localizado en ${muscles.primary.join(', ')}.`,
      'Conserva la alineación neutra de cuello y columna durante toda la serie.',
    ].slice(0, 5);

    breathing = {
      eccentricPhase: 'Inhala de manera controlada durante la fase de retorno (3 segundos).',
      concentricPhase: 'Exhala de forma constante durante la fase de esfuerzo principal.',
      bracingCue: 'Mantén una tensión abdominal estable para fijar la postura.',
    };

    commonMistakes = [
      'Usar inercia o velocidad excesiva reduciendo el tiempo bajo tensión.',
      'Perder el apoyo postural en las últimas repeticiones por exceso de carga.',
      'Recortar el rango de movimiento completo.',
    ];

    baseTempo = createTempoFromValues(3, 1, 1, 1);

    safetyRecommendations = [
      ...(libMatch?.safetyWarnings || [
        `Comprueba el ajuste de seguros y topes en ${equipment} antes de comenzar la serie.`,
      ]),
      ...(libMatch?.contraindications || []),
      'Detén el ejercicio si pierdes el control técnico o aparece molestia articular.',
    ];
  }

  const finalTempo = input.customTempo
    ? parseTempoNotation(input.customTempo, baseTempo)
    : baseTempo;

  return {
    exerciseId: input.id,
    libraryExerciseId: libMatch?.id || input.libraryExerciseId,
    exerciseName,
    equipment,
    movementPattern: pattern,
    mediaUrl,
    posterUrl,
    preSetTip,
    specificTips,
    startingPosition,
    stepByStepExecution,
    breathing,
    commonMistakes,
    muscles,
    defaultTempo: finalTempo,
    safetyRecommendations,
  };
}

/**
 * Formatea las instrucciones completas de Technique Pro para lectura por voz en español
 */
export function buildTechniqueSpeechScript(
  profile: import('../types').TechniqueProProfile,
  activeTempo?: import('../types').ExerciseTempo
): string {
  const tempo = activeTempo || profile.defaultTempo;
  const primaryText = profile.muscles.primary.join(' y ');
  const secondaryText = profile.muscles.secondary.join(', ');
  const tipsText = profile.specificTips.slice(0, 3).join(' ');
  const execText = profile.stepByStepExecution.join(' ');
  const safetyText = profile.safetyRecommendations[0] || '';

  return [
    `Técnica profesional para ${profile.exerciseName}.`,
    `Equipamiento: ${profile.equipment}. Patrón: ${profile.movementPattern}.`,
    `Músculos principales: ${primaryText}. Músculos secundarios: ${secondaryText}.`,
    `Consejo clave antes de tu serie: ${profile.preSetTip}`,
    `Posición inicial: ${profile.startingPosition.slice(0, 2).join(' ')}`,
    `Ejecución paso a paso: ${execText}`,
    `Claves técnicas: ${tipsText}`,
    `Respiración: ${profile.breathing.eccentricPhase} ${profile.breathing.concentricPhase}`,
    `Tempo recomendado: ${tempo.eccentricSec} segundos de bajada excéntrica, ${tempo.bottomPauseSec} segundos de pausa inferior, ${tempo.concentricSec} segundos de subida concéntrica y ${tempo.topPauseSec} segundos de contracción arriba.`,
    safetyText ? `Seguridad: ${safetyText}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Genera claves de biomecánica y técnica profesionales para un ejercicio
 */
export function generateTechniqueCuesForExercise(
  name: string,
  equipment: string = '',
  muscleGroup: string = ''
): string[] {
  const profile = buildTechniqueProProfile({
    name,
    equipment,
    targetMuscles: muscleGroup,
  });
  return profile.specificTips;
}

/**
 * Convierte un LibraryExercise a un objeto Exercise completo para previsualización o reemplazo
 */
export function libraryItemToExercise(
  item: LibraryExercise,
  base?: Exercise | null
): Exercise {
  const resolvedAnimUrl =
    item.videoUrl ||
    item.animationUrl ||
    (item.visualResourceStatus !== 'pending_resource' &&
    item.url &&
    !/\-poster\.webp$/i.test(item.url)
      ? item.url
      : '') ||
    '';

  const profile = buildTechniqueProProfile({
    id: base?.id || `alt-${item.id}`,
    libraryExerciseId: item.id,
    name: item.name,
    targetMuscles: item.muscleGroup,
    equipment: item.equipment,
    defaultVideoUrl: resolvedAnimUrl,
    thumbnailUrl: item.thumbnailUrl || undefined,
    customTempo: base?.customTempo,
  });

  return {
    id: `alt-${item.id}`,
    libraryExerciseId: item.id,
    name: item.name,
    targetMuscles: item.muscleGroup,
    defaultSets: base?.defaultSets || 4,
    repRange: base?.repRange || '8 - 12 reps',
    restSeconds: base?.restSeconds || 90,
    restText: base?.restText || '90 s',
    objective: base?.objective || 'Hipertrofia / Fuerza',
    defaultVideoUrl: resolvedAnimUrl,
    thumbnailUrl: item.thumbnailUrl || undefined,
    secondaryThumbnailUrl: item.secondaryThumbnailUrl || undefined,
    techniqueCues: profile.specificTips,
    techniquePro: profile,
    customTempo: base?.customTempo || profile.defaultTempo.notation,
    equipment: item.equipment,
  };
}

