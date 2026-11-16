import { Routine, Exercise, CompletedWorkout, PersonalRecord, RoutineImportMode } from '../types';
import { sanitizeExerciseRepRange } from './progressionEngine';
import {
  extractRestSeconds,
  getLastMatrixParseDiagnostics,
  isLikelyRestValue,
  isStrictRpeValue,
  parseRestToSeconds,
  RoutineImportValidationReport,
  validateRoutineImportIntegrity,
} from './routineImporterHelpers';

/**
 * Función estándar de normalización: minúsculas, sin acentos ni diacríticos y recortada.
 */
export const normalizar = (str: string | undefined | null): string =>
  (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export type CanonicalWeekday =
  | 'Lunes'
  | 'Martes'
  | 'Miércoles'
  | 'Jueves'
  | 'Viernes'
  | 'Sábado'
  | 'Domingo';

export const CANONICAL_WEEKDAYS: CanonicalWeekday[] = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

/**
 * Extrae el día canónico de la semana ('Lunes' .. 'Domingo') a partir de cualquier variante
 * con o sin tilde, mayúsculas/minúsculas, abreviaturas o etiquetas compuestas
 * (ej. 'Miércoles', 'Miercoles', 'miércoles', 'Miércoles / Potencia', 'Día 3').
 */
export function resolveCanonicalDay(
  ...candidates: (string | undefined | null)[]
): CanonicalWeekday | null {
  for (const raw of candidates) {
    if (!raw) continue;
    const norm = normalizar(String(raw));
    if (!norm) continue;

    if (norm.includes('lunes') || norm.includes('monday') || /^lun(\b|$)/.test(norm)) return 'Lunes';
    if (norm.includes('martes') || norm.includes('tuesday') || /^mar(\b|$)/.test(norm)) return 'Martes';
    if (norm.includes('miercoles') || norm.includes('wednesday') || /^mie(r)?(\b|$)/.test(norm)) return 'Miércoles';
    if (norm.includes('jueves') || norm.includes('thursday') || /^jue(\b|$)/.test(norm)) return 'Jueves';
    if (norm.includes('viernes') || norm.includes('friday') || /^vie(\b|$)/.test(norm)) return 'Viernes';
    if (norm.includes('sabado') || norm.includes('saturday') || /^sab(\b|$)/.test(norm)) return 'Sábado';
    if (norm.includes('domingo') || norm.includes('sunday') || /^dom(\b|$)/.test(norm)) return 'Domingo';

    if (/\b(dia|day|rutina|sesion)\s*1\b/.test(norm)) return 'Lunes';
    if (/\b(dia|day|rutina|sesion)\s*2\b/.test(norm)) return 'Martes';
    if (/\b(dia|day|rutina|sesion)\s*3\b/.test(norm)) return 'Miércoles';
    if (/\b(dia|day|rutina|sesion)\s*4\b/.test(norm)) return 'Jueves';
    if (/\b(dia|day|rutina|sesion)\s*5\b/.test(norm)) return 'Viernes';
    if (/\b(dia|day|rutina|sesion)\s*6\b/.test(norm)) return 'Sábado';
    if (/\b(dia|day|rutina|sesion)\s*7\b/.test(norm)) return 'Domingo';
  }
  return null;
}

/**
 * Especifica el implemento en nombres de ejercicios ambiguos para evitar que queden flotando.
 */
export function normalizeExerciseWithEquipment(rawName: string): string {
  const trimmed = (rawName || '').trim();
  const norm = normalizar(trimmed);

  if (norm === 'elevaciones laterales' || norm === 'elevacion lateral') {
    return 'Elevaciones laterales con mancuernas';
  }
  if (norm === 'elevaciones frontales' || norm === 'elevacion frontal') {
    return 'Elevaciones frontales con mancuernas';
  }
  if (
    norm === 'zancadas bulgaras' ||
    norm === 'zancada bulgara' ||
    norm === 'sentadillas bulgaras' ||
    norm === 'sentadilla bulgara'
  ) {
    return 'Sentadilla búlgara con mancuernas';
  }
  if (norm === 'zancadas' || norm === 'zancada') {
    return 'Zancadas con mancuernas';
  }
  if (norm === 'pajaros' || norm === 'pajaro') {
    return 'Pájaros con mancuernas';
  }
  if (norm === 'press militar' || norm === 'press de hombro' || norm === 'press de hombros') {
    return 'Press militar con mancuernas';
  }
  if (norm === 'press banca' || norm === 'press de banca' || norm === 'press plano') {
    return 'Press de banca con barra';
  }
  if (norm === 'press inclinado') {
    return 'Press inclinado con mancuernas';
  }
  if (norm === 'aperturas' || norm === 'apertura') {
    return 'Aperturas con mancuernas';
  }
  if (norm === 'remo' || norm === 'remo con barra') {
    return 'Remo con barra';
  }
  if (norm === 'peso muerto rumano' || norm === 'rdl') {
    return 'Peso muerto rumano con barra';
  }
  if (norm === 'curl de biceps' || norm === 'curl biceps') {
    return 'Curl de bíceps con mancuernas';
  }
  if (norm === 'curl martillo' || norm === 'martillo') {
    return 'Curl martillo con mancuernas';
  }
  if (norm === 'extension de triceps' || norm === 'extensiones de triceps') {
    return 'Extensión de tríceps en polea';
  }
  if (norm === 'elevacion de talones' || norm === 'elevaciones de talones' || norm === 'gemelos') {
    return 'Elevación de talones en máquina';
  }

  return trimmed;
}

/**
 * Normaliza y mapea estrictamente a los 11 términos anatómicos canónicos reconocidos por LAZCAKONGYM:
 * Pectoral, Dorsal, Deltoides, Biceps, Triceps, Cuadriceps, Isquiotibiales, Gluteos, Gemelos, Abdomen, Aductores.
 */
export function canonicalizeMuscleGroup(muscleStr: string, exerciseName: string = ''): string {
  const m = normalizar((muscleStr || '').split(',')[0] || muscleStr);
  const ex = normalizar(exerciseName);

  // 1. Reglas inequívocas por nombre de ejercicio para desambiguar piernas, brazos y espalda/isquios
  if (/curl femoral|leg curl|peso muerto rumano|rumano|rdl|stiff|buenos dias|good morning|curl nordico|isquio/.test(ex)) {
    return 'Isquiotibiales';
  }
  if (/sentadilla bulgara|zancada bulgara|bulgara|sentadilla|squat|prensa|leg press|extension de cuadriceps|extensiones de cuadriceps|extension de pierna|zancada|lunge|hack|sissy/.test(ex)) {
    if (/sumo/.test(ex) && /gluteo|aductor/.test(m)) return 'Gluteos';
    return 'Cuadriceps';
  }
  if (/aductor|abductor|aduccion|abduccion/.test(ex)) {
    return 'Aductores';
  }
  if (/hip thrust|puente de gluteo|glute bridge|patada de gluteo|kickback/.test(ex)) {
    return 'Gluteos';
  }
  if (/elevacion de talones|elevaciones de talones|pantorrilla|gemelo|soleo|calf raise/.test(ex)) {
    return 'Gemelos';
  }
  if (/elevacion lateral|elevaciones laterales|elevacion frontal|elevaciones frontales|press militar|overhead press|press arnold|press de hombro|press de hombros|pajaro|face pull|remo al menton/.test(ex)) {
    return 'Deltoides';
  }
  if (/press frances|extension de tricep|extensiones de tricep|pushdown|jalon de tricep|copa|patada de tricep|fondos en banco/.test(ex)) {
    return 'Triceps';
  }
  if (/curl|martillo|predicador|scott|spider|bicep/.test(ex) && !/femoral|pierna|nordico/.test(ex)) {
    return 'Biceps';
  }
  if (/dominada|pull up|chin up|jalon|lat pulldown|remo|row|pullover en polea|rack pull|peso muerto convencional|peso muerto/.test(ex)) {
    return 'Dorsal';
  }
  if (/crunch|plancha|plank|rueda abdominal|elevacion de piernas|elevaciones de tronco|v-up/.test(ex)) {
    return 'Abdomen';
  }
  if (/press banca|bench press|press plano|press inclinado|press declinado|press de banca|press de pecho|press pecho|apertura|pec deck|cruce de poleas|crossover|fondos en paralelas|fondos de pecho|push up|flexiones/.test(ex)) {
    if (/fondos/.test(ex) && /tricep/.test(m)) return 'Triceps';
    return 'Pectoral';
  }

  // 2. Mapeo estricto de la columna de músculo explícita
  if (/pierna|leg/.test(m)) {
    if (/isquio|femoral|rumano|rdl|curl/.test(ex)) return 'Isquiotibiales';
    if (/gluteo|hip thrust|patada|puente/.test(ex)) return 'Gluteos';
    if (/gemelo|pantorrilla|talon|soleo/.test(ex)) return 'Gemelos';
    if (/aductor|abductor/.test(ex)) return 'Aductores';
    return 'Cuadriceps';
  }
  if (/espalda|dorsal|back|lats|trapecio/.test(m)) return 'Dorsal';
  if (/hombro|deltoide|shoulder/.test(m)) return 'Deltoides';
  if (/pecho|pectoral|chest/.test(m)) return 'Pectoral';
  if (/isquio|femoral|hamstring/.test(m)) return 'Isquiotibiales';
  if (/cuadricep|quad/.test(m)) return 'Cuadriceps';
  if (/gluteo|glute/.test(m)) return 'Gluteos';
  if (/aductor|abductor/.test(m)) return 'Aductores';
  if (/gemelo|pantorrilla|calf|soleo/.test(m)) return 'Gemelos';
  if (/bicep|brazo anterior/.test(m)) return 'Biceps';
  if (/tricep|brazo posterior/.test(m)) return 'Triceps';
  if (/abdomen|abdominal|core|abs/.test(m)) return 'Abdomen';

  return inferMusclesFromName(exerciseName || muscleStr);
}

/**
 * Infiere el grupo muscular a partir del nombre del ejercicio si la columna Músculo no viene informada.
 */
export function inferMusclesFromName(name: string): string {
  const lower = normalizar(name);

  if (/isquio|femoral|rumano|rdl|curl femoral|deadlift rumano|stiff|buenos dias|nordico/.test(lower)) {
    return 'Isquiotibiales';
  }
  if (/sentadilla|squat|prensa|leg press|cuadriceps|quad|zancada|lunge|bulgara|extension de cuadriceps|extension de pierna|hack|sissy/.test(lower)) {
    return 'Cuadriceps';
  }
  if (/aductor|abductor|aduccion/.test(lower)) {
    return 'Aductores';
  }
  if (/hip thrust|gluteo|glute|puente de gluteo|patada/.test(lower)) {
    return 'Gluteos';
  }
  if (/gemelo|pantorrilla|calf|soleo|talones|talon/.test(lower)) {
    return 'Gemelos';
  }
  if (/press militar|overhead press|militar|hombro|shoulder|elevacion lateral|elevaciones laterales|elevacion frontal|lateral raise|pajaro|deltoides|face pull/.test(lower)) {
    return 'Deltoides';
  }
  if (/triceps|tricep|frances|french|pushdown|copa|patada de tricep|fondos en banco/.test(lower)) {
    return 'Triceps';
  }
  if (/biceps|bicep|curl|martillo|predicador|scott|spider/.test(lower)) {
    return 'Biceps';
  }
  if (/dominada|pull up|chin up|jalon|lat pulldown|remo|row|espalda|back|dorsal|pullover|peso muerto/.test(lower)) {
    return 'Dorsal';
  }
  if (/plancha|plank|crunch|abdomen|abdominal|core|abs|elevacion de piernas|rueda/.test(lower)) {
    return 'Abdomen';
  }
  if (/press banca|bench press|press plano|press inclinado|press declinado|apertura|pec deck|crossover|pecho|pectoral|chest|push up|flexion|fondos/.test(lower)) {
    return 'Pectoral';
  }

  return 'Dorsal';
}

/**
 * Convierte texto de duración a segundos (e.g. "1h 15m", "45m", "01:15:30", "3600")
 */
function parseDurationToSeconds(val: string): number {
  if (!val) return 3600;
  const clean = val.trim();

  if (/^\d+$/.test(clean)) {
    const num = parseInt(clean, 10);
    return num > 600 ? num : num * 60;
  }

  if (clean.includes(':')) {
    const parts = clean.split(':').map((p) => parseInt(p, 10) || 0);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }

  let totalSec = 0;
  const hoursMatch = clean.match(/(\d+)\s*(?:h|hr|hora|horas)/i);
  const minsMatch = clean.match(/(\d+)\s*(?:m|min|minuto|minutos)/i);
  const secsMatch = clean.match(/(\d+)\s*(?:s|seg|segundo|segundos)/i);

  if (hoursMatch) totalSec += parseInt(hoursMatch[1], 10) * 3600;
  if (minsMatch) totalSec += parseInt(minsMatch[1], 10) * 60;
  if (secsMatch) totalSec += parseInt(secsMatch[1], 10);

  return totalSec > 0 ? totalSec : 3600;
}

export interface CsvImportResult {
  routines: Routine[];
  workouts: CompletedWorkout[];
  prs: Record<string, PersonalRecord>;
  validationReport?: RoutineImportValidationReport;
  importMode?: RoutineImportMode;
  confirmReplaceExisting?: boolean;
  preserveWorkoutsAndHistory?: boolean;
  stats: {
    totalRows: number;
    routinesCreated: number;
    routineNames: string[];
    workoutsCreated: number;
    prsCreated: number;
  };
}

export function getCanonicalDay(str: string): string {
  const resolved = resolveCanonicalDay(str);
  if (resolved) return resolved;
  const trimmed = (str || '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : 'Lunes';
}

/**
 * Consolida y deduplica de forma idempotente una lista de rutinas en los 7 días de la semana.
 * - Elimina rutinas fantasma o duplicadas por múltiples importaciones CSV o caché.
 * - Si una rutina agrupa ejercicios con distintos valores en `ex.dia` / `ex.day` (ej. "Miércoles"),
 *   separa cada ejercicio en su día canónico correspondiente.
 * - Normaliza nombres de ejercicios (agregando implemento si falta), corrige grupos musculares
 *   y deduplica ejercicios por día sin acumular ni inflar series.
 */
export function consolidateWeeklyRoutines(rawRoutines: Routine[]): Routine[] {
  if (!Array.isArray(rawRoutines) || rawRoutines.length === 0) return [];

  const dayRoutineMap = new Map<
    string,
    {
      baseRoutine: Routine;
      exercisesMap: Map<string, Exercise>;
    }
  >();

  rawRoutines.forEach((r, idx) => {
    if (!r || !Array.isArray(r.exercises)) return;

    // Detectar si es una rutina CSV antigua donde idx > 0 quedó con dayName='Lunes' por defecto
    let inferredLegacyDay: CanonicalWeekday | null = null;
    const csvIdxMatch = typeof r.id === 'string' ? r.id.match(/^csv-routine-\d+-(\d+)$/) : null;
    if (csvIdxMatch) {
      const routineIdx = parseInt(csvIdxMatch[1], 10);
      const explicitInTitle = resolveCanonicalDay(r.title);
      if (explicitInTitle) {
        inferredLegacyDay = explicitInTitle;
      } else if (routineIdx > 0 && normalizar(r.dayName) === 'lunes') {
        inferredLegacyDay = CANONICAL_WEEKDAYS[routineIdx % CANONICAL_WEEKDAYS.length];
      }
    }

    const firstExDay =
      r.exercises.length > 0
        ? (r.exercises[0] as any)?.dia || (r.exercises[0] as any)?.day
        : undefined;

    const routineCanonicalDay: CanonicalWeekday =
      inferredLegacyDay ||
      resolveCanonicalDay(r.dayName, r.title, firstExDay) ||
      CANONICAL_WEEKDAYS[idx % CANONICAL_WEEKDAYS.length];

    const isLegacyGhostId =
      !r.id ||
      /^csv-routine-/.test(r.id) ||
      /^rutina-(lunes|martes|miercoles|jueves|viernes|sabado|domingo)$/.test(r.id);

    const planBucketKey = r.importedPlanId
      ? `plan:${r.importedPlanId}`
      : !isLegacyGhostId
      ? `id:${r.id}`
      : 'legacy';

    r.exercises.forEach((ex: any) => {
      if (!ex || !(ex.name || ex.nombre || ex.Ejercicio)) return;
      const rawName = String(ex.name || ex.nombre || ex.Ejercicio).trim();
      const cleanName = normalizeExerciseWithEquipment(rawName);
      const exKey = normalizar(cleanName);
      if (!exKey) return;

      const exMuscle = canonicalizeMuscleGroup(
        ex.targetMuscles || ex.muscleGroup || ex.musculo || ex.Musculo || '',
        cleanName
      );

      const rawSets =
        typeof ex.defaultSets === 'number' && ex.defaultSets > 0
          ? ex.defaultSets
          : typeof ex.series === 'number' && ex.series > 0
          ? ex.series
          : Number(ex.Series) > 0
          ? Number(ex.Series)
          : 3;

      const safeSets = Math.min(Math.max(Math.round(rawSets), 1), 6);

      const exCanonicalDay: CanonicalWeekday =
        inferredLegacyDay ||
        resolveCanonicalDay(ex.dia, ex.day, ex.Dia, ex.Día, r.dayName, r.title) ||
        routineCanonicalDay;

      const mapKey = `${exCanonicalDay}::${planBucketKey}`;

      if (!dayRoutineMap.has(mapKey)) {
        const isSameAsParent = exCanonicalDay === routineCanonicalDay;
        const cleanTitle =
          isSameAsParent && r.title && !/^rutina\s+lunes$/i.test(r.title.trim())
            ? r.title
            : `Rutina ${exCanonicalDay}`;

        dayRoutineMap.set(mapKey, {
          baseRoutine: {
            ...r,
            id:
              isSameAsParent && r.id
                ? r.id
                : r.importedPlanId
                ? `rutina-${normalizar(exCanonicalDay)}-${r.importedPlanId}`
                : `rutina-${normalizar(exCanonicalDay)}`,
            dayName: exCanonicalDay,
            title: cleanTitle,
            exercises: [],
          },
          exercisesMap: new Map<string, Exercise>(),
        });
      }

      const dayBucket = dayRoutineMap.get(mapKey)!;
      const existingEx = dayBucket.exercisesMap.get(exKey);

      const repRangeStr =
        ex.repRange ||
        ex.repeticiones ||
        ex.reps ||
        ex.Repeticiones ||
        existingEx?.repRange ||
        '8 a 12 reps';
      const restCandidates = [
        ex.DESCANSO,
        ex.descanso,
        ex.restText,
        ex.rest,
        ex.restSeconds,
        ex.DescansoSegundos,
        existingEx?.restText,
        existingEx?.restSeconds,
      ];

      // Si algún campo de descanso tenía por error una nota de recomendación o estrategia (no cumple isLikelyRestValue),
      // rescatarla hacia notesVal y usar en descanso únicamente el valor real de tiempo/segundos.
      let misplacedNoteInRest = '';
      for (const cand of [ex.DESCANSO, ex.descanso, ex.restText, ex.rest]) {
        if (
          typeof cand === 'string' &&
          cand.trim().length > 0 &&
          !isLikelyRestValue(cand)
        ) {
          misplacedNoteInRest = cand.trim();
          break;
        }
      }

      const validRestCandidate = restCandidates.find(
        (c) => c !== undefined && c !== null && isLikelyRestValue(c)
      );
      const parsedRestInfo = parseRestToSeconds(validRestCandidate, 90);
      const restSecVal = parsedRestInfo.restSeconds;
      const restTextVal = parsedRestInfo.restText;
      const rpeVal = ex.rpe ?? ex.RPE ?? ex.targetRpe ?? (existingEx as any)?.rpe ?? '8';
      const notesVal =
        ex.notes ||
        ex.notas ||
        ex.Notas ||
        ex.estrategia ||
        ex.Estrategia ||
        ex['Unnamed: 5'] ||
        misplacedNoteInRest ||
        existingEx?.notes;

      dayBucket.exercisesMap.set(exKey, {
        ...(existingEx || {}),
        ...ex,
        id:
          ex.id ||
          existingEx?.id ||
          `ex-${normalizar(exCanonicalDay)}-${exKey.replace(/[^a-z0-9]/g, '-')}`,
        name: cleanName,
        nombre: cleanName,
        targetMuscles: exMuscle,
        defaultSets: safeSets,
        series: safeSets,
        repRange: String(repRangeStr),
        repeticiones: String(repRangeStr),
        reps: String(repRangeStr),
        restSeconds: restSecVal,
        restText: String(restTextVal),
        descanso: String(restTextVal),
        rest: String(restTextVal),
        rpe: rpeVal,
        targetRpe: Number(rpeVal) || 8,
        notes: notesVal,
        notas: notesVal,
        estrategia: notesVal,
        dia: exCanonicalDay,
        day: exCanonicalDay,
      } as Exercise);
    });
  });

  const result: Routine[] = [];
  dayRoutineMap.forEach((bucket) => {
    const exercises = Array.from(bucket.exercisesMap.values());
    if (exercises.length > 0) {
      result.push({
        ...bucket.baseRoutine,
        tagline: `${exercises.length} ejercicios • ${exercises.reduce(
          (acc, e) => acc + (e.defaultSets || 3),
          0
        )} series`,
        exercises,
      });
    }
  });

  // Ordenar de Lunes a Domingo
  const dayOrder = new Map<string, number>(CANONICAL_WEEKDAYS.map((d, i) => [d, i]));
  return result.sort(
    (a, b) => (dayOrder.get(a.dayName) ?? 99) - (dayOrder.get(b.dayName) ?? 99)
  );
}

/**
 * Detecta si un arreglo de objetos proviene de una llamada cruda `XLSX.utils.sheet_to_json(ws)`
 * sobre un Excel con bloques de días (ej. llaves "__EMPTY" o encabezados "LUNES: EMPUJE A...").
 */
function normalizeRawExcelObjectRowsIfNeeded(rows: Record<string, any>[]): Record<string, any>[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  // Si ya es una matriz 2D (array de arrays)
  if (Array.isArray(rows[0])) {
    return convertMatrixRowsToStandardObjects(rows as unknown as any[][]);
  }

  const sampleKeys = Object.keys(rows[0] || {});
  const hasEmptyKeys = sampleKeys.some((k) => /^__EMPTY/i.test(k));
  const hasDayHeaderInKeys = sampleKeys.some((k) => {
    const n = normalizar(k);
    return (
      /^(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(n) &&
      n !== 'dia' &&
      n !== 'day'
    );
  });
  const hasStandardExerciseKey = sampleKeys.some((k) => {
    const ck = normalizar(k).replace(/[^a-z0-9]/g, '');
    return [
      'ejercicio',
      'ejercicioprincipal',
      'exercise',
      'exercisename',
      'nombreejercicio',
      'nombre',
      'name',
      'movement',
    ].includes(ck);
  });

  if (hasEmptyKeys || hasDayHeaderInKeys || !hasStandardExerciseKey) {
    const allKeys: string[] = [];
    rows.forEach((r) => {
      if (r && typeof r === 'object') {
        Object.keys(r).forEach((k) => {
          if (!allKeys.includes(k)) allKeys.push(k);
        });
      }
    });

    const matrix: any[][] = [];
    const headerRow = allKeys.map((k) => (/^__EMPTY(_\d+)?$/i.test(k) ? '' : k));
    if (headerRow.some((c) => c.length > 0)) {
      matrix.push(headerRow);
    }
    rows.forEach((r) => {
      if (r && typeof r === 'object') {
        matrix.push(allKeys.map((k) => (r[k] !== undefined && r[k] !== null ? r[k] : '')));
      }
    });

    const converted = convertMatrixRowsToStandardObjects(matrix);
    if (converted.length > 0) {
      return converted;
    }
  }

  return rows;
}

/**
 * Procesador matricial interno para convertir cualquier matriz 2D con bloques de día
 * ("LUNES: EMPUJE A...", subtabla "Ejercicio | Series | Reps | Descanso", y 5-6 ejercicios consecutivos)
 * en filas tabulares estándar.
 */
function convertMatrixRowsToStandardObjects(matrix: any[][]): Record<string, any>[] {
  const result: Record<string, any>[] = [];
  let currentDay: CanonicalWeekday = 'Lunes';
  let currentTitle = 'Rutina Lunes';
  let colMap: {
    day?: number;
    order?: number;
    exercise?: number;
    muscle?: number;
    sets?: number;
    reps?: number;
    rpe?: number;
    rest?: number;
    weight?: number;
    notes?: number;
  } = {};

  for (const rawRow of matrix) {
    if (!Array.isArray(rawRow)) continue;
    const cells = rawRow.map((c) => (c === null || c === undefined ? '' : String(c).trim()));
    const nonEmpty = cells.filter(Boolean);
    if (nonEmpty.length === 0) continue;

    // 1. Detectar fila de cabeceras de subtabla
    let headerMatches = 0;
    const nextMap: typeof colMap = {};
    let headerDayFound: CanonicalWeekday | null = null;
    let headerTitleFound = '';

    cells.forEach((cell, idx) => {
      if (!cell) return;
      const norm = normalizar(cell);
      const compact = norm.replace(/\s+/g, '');

      const dayCandidate = resolveCanonicalDay(cell);
      if (
        dayCandidate &&
        idx <= 1 &&
        compact !== 'dia' &&
        compact !== 'day' &&
        /^(lunes|martes|miercoles|jueves|viernes|sabado|domingo|dia\s*[1-7])\b/.test(norm)
      ) {
        headerDayFound = dayCandidate;
        headerTitleFound = cell;
        if (nextMap.exercise === undefined) nextMap.exercise = idx;
        return;
      }

      if (/^(#|n|no|nro|num|numero|orden|item)$/.test(compact)) {
        nextMap.order = idx;
        headerMatches++;
      } else if (/^(dia|day|dias|diadesemana|sesion)$/.test(compact)) {
        nextMap.day = idx;
        headerMatches++;
      } else if (
        /^(ejercicio|ejercicios|ejercicioprincipal|exercise|nombre|nombreejercicio|movimiento)$/.test(
          compact
        ) ||
        norm.startsWith('ejercicio')
      ) {
        nextMap.exercise = idx;
        headerMatches++;
      } else if (/^(musculo|musculos|grupomuscular|muscle|zona|enfoque)$/.test(compact)) {
        nextMap.muscle = idx;
        headerMatches++;
      } else if (/^(series|serie|sets|set)$/.test(compact)) {
        nextMap.sets = idx;
        headerMatches++;
      } else if (
        /^(reps|repeticiones|repeticion|rep|rango|rangoreps|trabajo)$/.test(compact) ||
        compact.startsWith('repeticion') ||
        compact.startsWith('reps')
      ) {
        nextMap.reps = idx;
        headerMatches++;
      } else if (
        /^(rpe|rir|rperir|rirrpe|intensidad|esfuerzo)$/.test(compact) ||
        norm.includes('rpe') ||
        norm.includes('rir')
      ) {
        nextMap.rpe = idx;
        headerMatches++;
      } else if (
        nextMap.rest === undefined &&
        (/^(descanso|descansos|rest|pausa|recuperacion|tiempodedescanso|tiempodescanso|descansoseg|intervalo)$/.test(
          compact
        ) ||
          norm.startsWith('descanso') ||
          norm.startsWith('tiempo de descanso'))
      ) {
        nextMap.rest = idx;
        headerMatches++;
      } else if (/^(peso|pesokg|carga|kg|kgs|weight)$/.test(compact)) {
        nextMap.weight = idx;
        headerMatches++;
      } else if (
        /^(notas|nota|estrategia|estrategias|recomendacion|recomendaciones|observaciones|notes|strategy|comentarios|indicaciones|tecnica|ejecucion|metodo|tip|unnamed5|empty5)$/.test(
          compact
        ) ||
        norm.includes('estrategia') ||
        norm.includes('recomendacion') ||
        norm.includes('nota') ||
        (nextMap.rest !== undefined && idx > nextMap.rest && /^(unnamed|empty)/i.test(compact))
      ) {
        nextMap.notes = idx;
        headerMatches++;
      }
    });

    if (
      headerMatches >= 2 ||
      (headerDayFound && (nextMap.sets !== undefined || nextMap.reps !== undefined))
    ) {
      colMap = { ...nextMap };
      if (headerDayFound) {
        currentDay = headerDayFound;
        currentTitle = headerTitleFound || `Rutina ${headerDayFound}`;
      }
      continue;
    }

    // 2. Detectar fila de encabezado de bloque de día ("LUNES: EMPUJE A...")
    const firstText = nonEmpty[0];
    const firstNorm = normalizar(firstText);
    const startsWithDay =
      /^(?:(?:dia|day|rutina|sesion|bloque)\s*(?:\d+\s*)?[:\-–—/]?\s*)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo|dia\s*[1-7])\b/.test(
        firstNorm
      );

    if (startsWithDay) {
      const resolvedDay = resolveCanonicalDay(firstText);
      const hasNumericSets = nonEmpty
        .slice(1)
        .some((c) => /^\d+$/.test(c) && Number(c) >= 1 && Number(c) <= 10);

      if (resolvedDay && (nonEmpty.length === 1 || (firstText.includes(':') && !hasNumericSets))) {
        currentDay = resolvedDay;
        currentTitle = firstText;
        continue;
      }

      if (resolvedDay && nonEmpty.length === 2 && !hasNumericSets) {
        const secondNorm = normalizar(nonEmpty[1]);
        if (
          /^(empuje|tiron|jalon|pierna|torso|full|upper|lower|brazo|dia|sesion|bloque|rutina|hipertrofia|fuerza)\b/.test(
            secondNorm
          ) ||
          colMap.day === undefined
        ) {
          currentDay = resolvedDay;
          currentTitle = `${resolvedDay}: ${nonEmpty[1]}`;
          continue;
        }
      }
    }

    // 3. Extraer fila de ejercicio consecutiva perteneciente a `currentDay`
    if (colMap.day !== undefined && cells[colMap.day]) {
      const d = resolveCanonicalDay(cells[colMap.day]);
      if (d) {
        currentDay = d;
        currentTitle = `Rutina ${d}`;
      }
    }

    let exName = colMap.exercise !== undefined ? cells[colMap.exercise] || '' : '';
    if (!exName || /^\d+[\.\)]?$/.test(exName)) {
      const idx = cells.findIndex(
        (v, i) =>
          i !== colMap.day &&
          i !== colMap.order &&
          i !== colMap.sets &&
          i !== colMap.reps &&
          i !== colMap.rpe &&
          i !== colMap.rest &&
          Boolean(v) &&
          !/^\d+(?:[.,]\d+)?$/.test(v)
      );
      if (idx !== -1) exName = cells[idx];
    }

    exName = exName.replace(/^\s*(?:\d+[\.\)\-:]|\•|\*)\s*/, '').trim();
    if (!exName || exName.length < 2) continue;
    if (/^(ejercicio|ejercicios|nombre|total|totales|resumen)$/.test(normalizar(exName))) continue;

    const rawSets = colMap.sets !== undefined ? cells[colMap.sets] : nonEmpty[1] || '3';
    const rawReps = colMap.reps !== undefined ? cells[colMap.reps] : nonEmpty[2] || '8-12';
    let rawRpe = colMap.rpe !== undefined ? cells[colMap.rpe] : '';
    let rawRest = colMap.rest !== undefined ? cells[colMap.rest] : '';
    const rawMuscle = colMap.muscle !== undefined ? cells[colMap.muscle] : '';
    const rawWeight = colMap.weight !== undefined ? cells[colMap.weight] : '';
    let rawNotes = colMap.notes !== undefined ? cells[colMap.notes] : '';

    // Si rawRest capturó por desfase una nota de estrategia/recomendación, moverla a rawNotes
    if (rawRest && !isLikelyRestValue(rawRest)) {
      rawNotes = rawNotes ? `${rawRest} | ${rawNotes}` : rawRest;
      rawRest = '';
    }

    if (rawRpe && isLikelyRestValue(rawRpe)) {
      if (!rawRest) rawRest = rawRpe;
      rawRpe = '8';
    }

    // Clasificar cualquier columna adicional (como índice 3, 4 o Unnamed: 5 / última columna)
    const usedColIndices = new Set<number>(
      [
        colMap.day,
        colMap.order,
        colMap.exercise,
        colMap.muscle,
        colMap.sets,
        colMap.reps,
        colMap.rpe,
        colMap.rest,
        colMap.weight,
        colMap.notes,
      ].filter((v): v is number => v !== undefined)
    );

    if (usedColIndices.size > 0) {
      cells.forEach((cellVal, idx) => {
        if (!cellVal || usedColIndices.has(idx)) return;
        if (!rawRest && isLikelyRestValue(cellVal)) {
          rawRest = cellVal;
          usedColIndices.add(idx);
        } else if (!rawRpe && isStrictRpeValue(cellVal)) {
          rawRpe = cellVal;
          usedColIndices.add(idx);
        } else if (
          idx > (colMap.reps ?? 1) &&
          !isLikelyRestValue(cellVal) &&
          !isStrictRpeValue(cellVal)
        ) {
          rawNotes = rawNotes ? `${rawNotes} | ${cellVal}` : cellVal;
          usedColIndices.add(idx);
        }
      });
    } else {
      const extraNotes: string[] = [];
      for (let i = 3; i < nonEmpty.length; i++) {
        const c = nonEmpty[i];
        if (!c) continue;
        if (!rawRest && isLikelyRestValue(c)) {
          rawRest = c;
        } else if (!rawRpe && isStrictRpeValue(c)) {
          rawRpe = c;
        } else {
          extraNotes.push(c);
        }
      }
      if (extraNotes.length > 0) {
        rawNotes = extraNotes.join(' | ');
      }
    }

    const parsedRestObj = parseRestToSeconds(rawRest, 90);

    result.push({
      Dia: currentDay,
      Rutina: currentTitle,
      Ejercicio: exName,
      Musculo: rawMuscle,
      Series: rawSets,
      Repeticiones: rawReps,
      RPE: rawRpe || '8',
      DESCANSO: parsedRestObj.restText,
      DescansoSegundos: parsedRestObj.restSeconds,
      Peso: rawWeight,
      Notas: rawNotes,
      Estrategia: rawNotes,
    });
  }

  return result;
}

/**
 * Parser principal de archivos CSV y Excel de entrenamiento:
 * 1. Detecta bloques por día (Lunes a Viernes/Domingo) y captura todos los ejercicios consecutivos de cada sesión.
 * 2. Preserva Series (1..6), Repeticiones (rango exacto), RPE, Descanso y Notas.
 * 3. Asigna la clasificación muscular directa o inferida para cada ejercicio.
 */
export function parseGymCsvData(inputRows: Record<string, any>[]): CsvImportResult {
  if (!Array.isArray(inputRows) || inputRows.length === 0) {
    return {
      routines: [],
      workouts: [],
      prs: {},
      stats: { totalRows: 0, routinesCreated: 0, routineNames: [], workoutsCreated: 0, prsCreated: 0 },
    };
  }

  const rows = normalizeRawExcelObjectRowsIfNeeded(inputRows);

  const routineGroups = new Map<
    string,
    {
      dayName: string;
      workoutTitle: string;
      exercises: Map<
        string,
        {
          displayName: string;
          setsCount: number;
          repRangeText: string;
          repsSamples: number[];
          weightsSamples: number[];
          targetMuscles?: string;
          rpe?: string;
          restText?: string;
          restSeconds?: number;
          notes?: string;
          dia?: string;
        }
      >;
      lastDate?: string;
    }
  >();

  const workoutSessions = new Map<
    string,
    {
      date: string;
      workoutName: string;
      durationSeconds: number;
      sets: {
        exerciseName: string;
        setNumber: number;
        weight: number;
        reps: number;
        targetMuscles: string;
        notes?: string;
      }[];
    }
  >();

  const prsAccumulator = new Map<
    string,
    {
      exerciseName: string;
      maxWeight: number;
      repsAtMax: number;
      date: string;
    }
  >();

  let validRowsCount = 0;
  let lastSeenDay: CanonicalWeekday | '' = '';
  let lastSeenWorkoutTitle = '';

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;

    const normRow: Record<string, any> = {};
    for (const [key, val] of Object.entries(row)) {
      const cleanKey = normalizar(key).replace(/[^a-z0-9]/g, '');
      normRow[cleanKey] = val;
    }

    const rawDay = (
      normRow['dia'] ??
      normRow['day'] ??
      normRow['diadesemana'] ??
      normRow['dias'] ??
      normRow['sesion'] ??
      normRow['session'] ??
      normRow['split'] ??
      ''
    )
      .toString()
      .trim();

    const rawMuscle = (
      normRow['musculo'] ??
      normRow['muscle'] ??
      normRow['grupomuscular'] ??
      normRow['targetmuscle'] ??
      normRow['zona'] ??
      normRow['categoria'] ??
      normRow['category'] ??
      ''
    )
      .toString()
      .trim();

    const rawExercise = (
      normRow['ejercicio'] ??
      normRow['ejercicioprincipal'] ??
      normRow['exercise'] ??
      normRow['exercisename'] ??
      normRow['nombreejercicio'] ??
      normRow['nombre'] ??
      normRow['name'] ??
      normRow['movement'] ??
      ''
    )
      .toString()
      .trim();

    const rawSet = (
      normRow['series'] ??
      normRow['serie'] ??
      normRow['sets'] ??
      normRow['set'] ??
      normRow['setorder'] ??
      normRow['setnumber'] ??
      ''
    )
      .toString()
      .trim();

    const rawReps = (
      normRow['reps'] ??
      normRow['repeticiones'] ??
      normRow['repeticion'] ??
      normRow['rangoreps'] ??
      normRow['rango'] ??
      normRow['repscompleted'] ??
      normRow['r'] ??
      ''
    )
      .toString()
      .trim();

    let rawRpe = (
      normRow['rpe'] ??
      normRow['rir'] ??
      normRow['rperir'] ??
      normRow['intensidad'] ??
      normRow['targetrpe'] ??
      ''
    )
      .toString()
      .trim();

    let rawRestCandidate: unknown =
      row['DESCANSO'] ??
      row['Descanso'] ??
      row['descanso'] ??
      row['DescansoSegundos'] ??
      row['descansoSegundos'] ??
      row['restSeconds'] ??
      row['restText'] ??
      normRow['descanso'] ??
      normRow['descansos'] ??
      normRow['descansoseg'] ??
      normRow['descansosegundos'] ??
      normRow['rest'] ??
      normRow['restseconds'] ??
      normRow['pausa'] ??
      normRow['tiempodescanso'] ??
      normRow['tiempodedescanso'];

    let misplacedNoteFromRest = '';
    if (
      typeof rawRestCandidate === 'string' &&
      rawRestCandidate.trim().length > 0 &&
      !isLikelyRestValue(rawRestCandidate)
    ) {
      misplacedNoteFromRest = rawRestCandidate.trim();
      rawRestCandidate = undefined;
    }

    if (
      rawRestCandidate === undefined ||
      rawRestCandidate === null ||
      String(rawRestCandidate).trim() === ''
    ) {
      for (const [k, v] of Object.entries(normRow)) {
        if (
          v !== undefined &&
          v !== null &&
          String(v).trim() !== '' &&
          /(descanso|pausa|recuperac|rest|intervalo)/i.test(k) &&
          isLikelyRestValue(v)
        ) {
          rawRestCandidate = v;
          break;
        }
      }
    }

    // Si la columna de descanso tenía otro nombre pero alguna celda del objeto contiene explícitamente el tiempo (ej: "75 seg", "60 seg")
    if (
      rawRestCandidate === undefined ||
      rawRestCandidate === null ||
      String(rawRestCandidate).trim() === ''
    ) {
      for (const [k, v] of Object.entries(normRow)) {
        if (
          !['ejercicio', 'nombre', 'series', 'reps', 'repeticiones', 'peso', 'dia'].includes(k) &&
          isLikelyRestValue(v) &&
          /[a-z:]/i.test(String(v))
        ) {
          rawRestCandidate = v;
          break;
        }
      }
    }

    const rawRest =
      rawRestCandidate !== undefined && rawRestCandidate !== null
        ? String(rawRestCandidate).trim()
        : '';

    const rawRestSeconds = extractRestSeconds(
      normRow['descansosegundos'] ?? rawRestCandidate,
      0
    );

    const rawWeight = (
      normRow['peso'] ??
      normRow['pesokg'] ??
      normRow['weight'] ??
      normRow['weightkg'] ??
      normRow['weightlbs'] ??
      normRow['load'] ??
      normRow['kg'] ??
      normRow['kgs'] ??
      ''
    )
      .toString()
      .trim();

    let rawNotes = (
      row['Notas'] ??
      row['notas'] ??
      row['Estrategia'] ??
      row['estrategia'] ??
      row['Unnamed: 5'] ??
      row['__EMPTY_5'] ??
      row['__EMPTY_4'] ??
      normRow['notas'] ??
      normRow['nota'] ??
      normRow['estrategia'] ??
      normRow['estrategias'] ??
      normRow['recomendacion'] ??
      normRow['recomendaciones'] ??
      normRow['indicaciones'] ??
      normRow['notes'] ??
      normRow['comment'] ??
      normRow['comentario'] ??
      normRow['observaciones'] ??
      normRow['workoutnotes'] ??
      normRow['unnamed5'] ??
      normRow['empty5'] ??
      ''
    )
      .toString()
      .trim();

    if (!rawNotes && misplacedNoteFromRest) {
      rawNotes = misplacedNoteFromRest;
    }

    const rawDate = (
      normRow['fecha'] ??
      normRow['date'] ??
      normRow['workoutdate'] ??
      normRow['timestamp'] ??
      ''
    )
      .toString()
      .trim();

    const rawWorkout = (
      normRow['rutina'] ??
      normRow['routine'] ??
      normRow['workoutname'] ??
      normRow['workout'] ??
      normRow['nombredeentrenamiento'] ??
      normRow['plan'] ??
      ''
    )
      .toString()
      .trim();

    const rawDuration = (
      normRow['duracion'] ??
      normRow['duration'] ??
      normRow['time'] ??
      normRow['workoutduration'] ??
      ''
    )
      .toString()
      .trim();

    const explicitDayFromRow = resolveCanonicalDay(rawDay, rawWorkout);
    if (explicitDayFromRow) {
      if (explicitDayFromRow !== lastSeenDay) {
        lastSeenDay = explicitDayFromRow;
        lastSeenWorkoutTitle = rawWorkout || `Rutina ${explicitDayFromRow}`;
      } else if (rawWorkout) {
        lastSeenWorkoutTitle = rawWorkout;
      }
    }

    // Si la fila es un encabezado de día (ej. 'LUNES: EMPUJE A' en la columna ejercicio sin series ni músculo)
    const exerciseAsDayOnly =
      !rawMuscle &&
      !rawSet &&
      !rawReps &&
      /^(?:(?:dia|rutina|sesion)\s*\d*\s*[:\-]?\s*)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(
        normalizar(rawExercise)
      ) &&
      resolveCanonicalDay(rawExercise);

    if (exerciseAsDayOnly) {
      lastSeenDay = exerciseAsDayOnly;
      lastSeenWorkoutTitle = rawExercise;
      return;
    }

    if (!rawExercise) {
      return;
    }

    const cleanedRawExercise = rawExercise.replace(/^\s*(?:\d+[\.\)\-:]|\•|\*)\s*/, '').trim();
    if (!cleanedRawExercise || /^(ejercicio|ejercicios|nombre)$/.test(normalizar(cleanedRawExercise))) {
      return;
    }

    validRowsCount++;

    const exerciseName = normalizeExerciseWithEquipment(cleanedRawExercise);
    const assignedDay: CanonicalWeekday =
      explicitDayFromRow || (lastSeenDay as CanonicalWeekday) || 'Lunes';
    const workoutName =
      rawWorkout || lastSeenWorkoutTitle || (assignedDay ? `Rutina ${assignedDay}` : 'Rutina CSV');
    const targetMuscles = canonicalizeMuscleGroup(rawMuscle, exerciseName);

    const weightNum = parseFloat(rawWeight.replace(',', '.')) || 0;
    const repsMatch = rawReps.match(/(\d+)/);
    const repsNum = repsMatch ? parseInt(repsMatch[1], 10) : 10;
    const setMatch = rawSet.match(/(\d+)/);
    const setNum = setMatch ? parseInt(setMatch[1], 10) : 3;

    // Calcular descanso en segundos usando el extractor universal (números, "75 seg", "60s", "1 min", "1:30")
    let effectiveRawRest: unknown = rawRest || (rawRestSeconds > 0 ? rawRestSeconds : '');
    if (!effectiveRawRest && rawRpe) {
      const rpeAsNum = parseFloat(rawRpe.replace(',', '.'));
      if (isLikelyRestValue(rawRpe) || (Number.isFinite(rpeAsNum) && rpeAsNum > 10)) {
        effectiveRawRest = rawRpe;
        rawRpe = '8';
      }
    }

    const parsedRestResult = parseRestToSeconds(effectiveRawRest, 90);
    const restSecs = parsedRestResult.restSeconds;
    const restTxt = parsedRestResult.restText;

    let parsedDate = new Date().toISOString();
    if (rawDate) {
      const parsedTimestamp = Date.parse(rawDate);
      if (!isNaN(parsedTimestamp)) {
        parsedDate = new Date(parsedTimestamp).toISOString();
      }
    }

    // Agrupar estrictamente por día canónico para que todas las filas de Lunes..Viernes queden en su día
    const groupKey = assignedDay;

    if (!routineGroups.has(groupKey)) {
      routineGroups.set(groupKey, {
        dayName: assignedDay,
        workoutTitle: workoutName,
        exercises: new Map(),
        lastDate: parsedDate,
      });
    } else if (
      rawWorkout &&
      routineGroups.get(groupKey)!.workoutTitle === `Rutina ${assignedDay}`
    ) {
      routineGroups.get(groupKey)!.workoutTitle = rawWorkout;
    }

    const routineData = routineGroups.get(groupKey)!;
    const normExKey = normalizar(exerciseName);
    const safeSetCount = Math.min(Math.max(setNum, 1), 6);

    if (!routineData.exercises.has(normExKey)) {
      routineData.exercises.set(normExKey, {
        displayName: exerciseName,
        setsCount: safeSetCount,
        repRangeText: rawReps || `${repsNum}`,
        repsSamples: [],
        weightsSamples: [],
        targetMuscles,
        rpe: rawRpe || '8',
        restText: restTxt,
        restSeconds: restSecs,
        notes: rawNotes,
        dia: assignedDay,
      });
    } else {
      const existingEx = routineData.exercises.get(normExKey)!;
      existingEx.setsCount = Math.min(Math.max(existingEx.setsCount, safeSetCount), 6);
      if (rawReps && !existingEx.repRangeText) existingEx.repRangeText = rawReps;
      if (rawNotes && !existingEx.notes) existingEx.notes = rawNotes;
      if (rawRpe) existingEx.rpe = rawRpe;
      if (rawRest) {
        existingEx.restText = restTxt;
        existingEx.restSeconds = restSecs;
      }
    }

    const exData = routineData.exercises.get(normExKey)!;
    if (repsNum > 0) exData.repsSamples.push(repsNum);
    if (weightNum > 0) exData.weightsSamples.push(weightNum);

    if (rawDate && !isNaN(Date.parse(rawDate)) && weightNum > 0) {
      const dObj = new Date(parsedDate);
      const yyyy = dObj.getFullYear();
      const mm = String(dObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dObj.getDate()).padStart(2, '0');
      const sessionKey = `${yyyy}-${mm}-${dd}`;

      if (!workoutSessions.has(sessionKey)) {
        workoutSessions.set(sessionKey, {
          date: parsedDate,
          workoutName,
          durationSeconds: parseDurationToSeconds(rawDuration),
          sets: [],
        });
      }
      workoutSessions.get(sessionKey)!.sets.push({
        exerciseName,
        setNumber: setNum,
        weight: weightNum,
        reps: repsNum,
        targetMuscles,
        notes: rawNotes,
      });
    }

    const prKey = exerciseName.toLowerCase().trim();
    const currentPR = prsAccumulator.get(prKey);
    if (
      !currentPR ||
      weightNum > currentPR.maxWeight ||
      (weightNum === currentPR.maxWeight && repsNum > currentPR.repsAtMax)
    ) {
      if (weightNum > 0) {
        prsAccumulator.set(prKey, {
          exerciseName,
          maxWeight: weightNum,
          repsAtMax: repsNum,
          date: parsedDate,
        });
      }
    }
  });

  // Generar Rutinas Finales consolidadas por día de la semana (Lunes a Domingo)
  const rawRoutines: Routine[] = [];
  const routinePalette = ['amber', 'emerald', 'sky', 'violet', 'rose', 'indigo'];
  let routineIndex = 0;

  routineGroups.forEach((groupData) => {
    const assignedDay: CanonicalWeekday =
      resolveCanonicalDay(groupData.dayName, groupData.workoutTitle) ||
      CANONICAL_WEEKDAYS[routineIndex % CANONICAL_WEEKDAYS.length];

    const exercisesList: Exercise[] = [];

    groupData.exercises.forEach((exInfo, normExKey) => {
      const avgReps =
        exInfo.repsSamples.length > 0
          ? Math.round(exInfo.repsSamples.reduce((a, b) => a + b, 0) / exInfo.repsSamples.length)
          : 10;

      // Respetar el texto exacto de repeticiones del Excel si viene informado (ej. "6-8", "8-10", "12-15")
      let repRange = exInfo.repRangeText ? exInfo.repRangeText.trim() : '';
      if (!repRange) {
        if (avgReps <= 5) repRange = '1 a 5 reps';
        else if (avgReps <= 7) repRange = '6 a 8 reps';
        else if (avgReps <= 12) repRange = '8 a 12 reps';
        else if (avgReps <= 15) repRange = '10 a 15 reps';
        else repRange = '15 a 20+ reps';
      }

      const displayName = exInfo.displayName || normExKey;
      const sets = Math.min(Math.max(exInfo.setsCount || 3, 1), 6);
      const exSlug = `ex-csv-${normalizar(assignedDay)}-${normExKey.replace(/[^a-z0-9]/g, '-')}`;

      const finalMuscles = exInfo.targetMuscles || canonicalizeMuscleGroup('', displayName);
      const exerciseDia = resolveCanonicalDay(exInfo.dia, assignedDay) || assignedDay;
      const validWeights = exInfo.weightsSamples.filter((w) => typeof w === 'number' && w > 0);
      const maxSampleWeight = validWeights.length > 0 ? Math.max(...validWeights) : undefined;
      const prevSampleWeight =
        validWeights.length > 1
          ? validWeights[0]
          : maxSampleWeight
          ? Math.round(maxSampleWeight * 0.9)
          : undefined;

      const restSecs = exInfo.restSeconds || 90;
      const restTxt = exInfo.restText || `${restSecs} seg`;
      const rpeVal = exInfo.rpe || '8';

      exercisesList.push({
        id: exSlug,
        name: displayName,
        nombre: displayName,
        targetMuscles: finalMuscles,
        defaultSets: sets,
        series: sets,
        repRange,
        repeticiones: repRange,
        reps: repRange,
        restSeconds: restSecs,
        restText: restTxt,
        descanso: restTxt,
        rest: restTxt,
        rpe: rpeVal,
        targetRpe: Number(rpeVal) || 8,
        objective: 'Hipertrofia & Doble Progresión',
        defaultVideoUrl: '',
        techniqueCues: [
          'Mantener ejecución estricta y rango de movimiento completo',
          'Controlar la fase excéntrica (bajada lenta y controlada)',
          'Respirar de forma rítmica sin bloquear',
        ],
        notes: exInfo.notes || undefined,
        notas: exInfo.notes || undefined,
        dia: exerciseDia,
        day: exerciseDia,
        defaultWeight: maxSampleWeight,
        prevWeight: prevSampleWeight,
        defaultReps: avgReps,
        source: 'csv',
      } as any);
    });

    const accent = routinePalette[routineIndex % routinePalette.length];
    const cleanTitle =
      groupData.workoutTitle && groupData.workoutTitle !== 'Rutina CSV'
        ? groupData.workoutTitle
        : `Rutina ${assignedDay}`;

    rawRoutines.push({
      id: `csv-routine-${normalizar(assignedDay)}`,
      dayName: assignedDay,
      title: cleanTitle,
      tagline: `${exercisesList.length} ejercicios • ${exercisesList.reduce(
        (acc, e) => acc + (e.defaultSets || 3),
        0
      )} series`,
      isCustom: true,
      accentColor: accent,
      banner: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=1000&auto=format&fit=crop',
      exercises: exercisesList,
      modality: 'hipertrofia',
      modalityName: 'Hipertrofia & Masa',
      targetRepRange: '6 a 12 reps',
      restRange: '1.5 a 3 min',
      caloricFocus: 'Superávit calórico (+ calorías)',
    });

    routineIndex++;
  });

  const routines = consolidateWeeklyRoutines(rawRoutines);

  // Generar Sesiones de Historial (Workouts)
  const workouts: CompletedWorkout[] = [];

  workoutSessions.forEach((sessionData, sessionKey) => {
    const exercisesMap = new Map<
      string,
      {
        sets: number;
        maxWeight: number;
        maxReps: number;
        volumeKg: number;
        muscleGroup: string;
      }
    >();

    let sessionTotalVolume = 0;
    let completedSets = 0;

    sessionData.sets.forEach((s) => {
      const vol = s.weight * s.reps;
      sessionTotalVolume += vol;
      completedSets++;

      if (!exercisesMap.has(s.exerciseName)) {
        exercisesMap.set(s.exerciseName, {
          sets: 0,
          maxWeight: 0,
          maxReps: 0,
          volumeKg: 0,
          muscleGroup: s.targetMuscles || inferMusclesFromName(s.exerciseName),
        });
      }

      const exAgg = exercisesMap.get(s.exerciseName)!;
      exAgg.sets += 1;
      exAgg.maxWeight = Math.max(exAgg.maxWeight, s.weight);
      exAgg.maxReps = Math.max(exAgg.maxReps, s.reps);
      exAgg.volumeKg += vol;
    });

    const exercisesSummary = Array.from(exercisesMap.entries()).map(([name, agg]) => ({
      name,
      sets: agg.sets,
      maxWeight: agg.maxWeight,
      maxReps: agg.maxReps,
      volumeKg: agg.volumeKg,
      muscleGroup: agg.muscleGroup,
      estimated1RM: agg.maxWeight > 0 ? Math.round(agg.maxWeight * (1 + (agg.maxReps || 10) / 30)) : 0,
    }));

    const workoutId = `workout-${sessionKey}`;
    // Recalcular duración realista en base a series completadas (rango 45 a 120 min máximo)
    const realisticDurationSec = Math.min(
      120 * 60,
      Math.max(45 * 60, Math.round(completedSets * 3.5 * 60))
    );
    const safeDurationSec =
      sessionData.durationSeconds >= 45 * 60 && sessionData.durationSeconds <= 120 * 60
        ? sessionData.durationSeconds
        : realisticDurationSec;

    workouts.push({
      id: workoutId,
      routineId: `csv-routine-${sessionKey}`,
      routineTitle: sessionData.workoutName,
      date: sessionData.date,
      startTime: new Date(sessionData.date).getTime() - safeDurationSec * 1000,
      endTime: new Date(sessionData.date).getTime(),
      durationSeconds: safeDurationSec,
      totalVolumeKg: sessionTotalVolume,
      completedSetsCount: completedSets,
      isFinished: true,
      exercisesSummary,
    });
  });

  // Convertir récords
  const prs: Record<string, PersonalRecord> = {};
  prsAccumulator.forEach((pr, exKey) => {
    prs[exKey] = {
      exerciseId: `pr-${exKey.replace(/[^a-z0-9]/g, '-')}`,
      exerciseName: pr.exerciseName,
      maxWeight: pr.maxWeight,
      repsAtMaxWeight: pr.repsAtMax,
      estimated1RM: Math.round(pr.maxWeight * (1 + pr.repsAtMax / 30)),
      date: pr.date,
    };
  });

  const validationReport = validateRoutineImportIntegrity(
    rows,
    routines,
    getLastMatrixParseDiagnostics().issues
  );

  return {
    routines,
    workouts,
    prs,
    validationReport,
    stats: {
      totalRows: validRowsCount,
      routinesCreated: routines.length,
      routineNames: routines.map((r) => r.title),
      workoutsCreated: workouts.length,
      prsCreated: Object.keys(prs).length,
    },
  };
}
