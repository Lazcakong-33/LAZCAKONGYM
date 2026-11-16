import * as XLSX from 'xlsx';
import { Routine } from '../types';
import {
  CanonicalWeekday,
  CANONICAL_WEEKDAYS,
  canonicalizeMuscleGroup,
  normalizar,
  resolveCanonicalDay,
} from './csvImporter';

export interface ExtractedRoutineRow {
  excelRowNumber: number;
  sheetName?: string;
  rawSetsValue?: string;
  hasSetsWarning?: boolean;
  hasRepsWarning?: boolean;
  hasRestWarning?: boolean;
  rawMuscleValue?: string;
  rawWeightValue?: string;
  setsWarningReason?: string;
  Dia: CanonicalWeekday;
  Rutina: string;
  Enfoque: string;
  Orden: number;
  Ejercicio: string;
  Ejercicio_Principal: string;
  Musculo: string;
  Series: number;
  Repeticiones: string;
  RPE: string;
  DESCANSO: string;
  DescansoSegundos: number;
  Peso: number;
  Notas: string;
  dia: CanonicalWeekday;
  day: CanonicalWeekday;
  nombre: string;
  name: string;
  series: number;
  repeticiones: string;
  reps: string;
  rpe: string;
  descanso: string;
  rest: string;
  notas: string;
  estrategia: string;
  Estrategia: string;
}

export interface RoutineImportErrorLog {
  rowNumber: number;
  sheetName?: string;
  day: string;
  exerciseName: string;
  severity: 'ERROR' | 'WARNING';
  code:
    | 'MISSING_EXERCISE_NAME'
    | 'INVALID_SERIES_VALUE'
    | 'SERIES_OUT_OF_RANGE'
    | 'DUPLICATE_EXERCISE_COLLAPSED'
    | 'DECLARED_TOTAL_MISMATCH'
    | 'DAY_VOLUME_DISCREPANCY'
    | 'UNPARSEABLE_ROW';
  message: string;
  rawRowPreview: string;
}

export interface DayValidationSummary {
  day: CanonicalWeekday;
  expectedExercises: number;
  importedExercises: number;
  expectedSets: number;
  importedSets: number;
  declaredSheetSets?: number;
  matches: boolean;
}

export interface RoutineImportValidationReport {
  isValid: boolean;
  hasDiscrepancies: boolean;
  expectedExercisesCount: number;
  importedExercisesCount: number;
  expectedTotalSets: number;
  importedTotalSets: number;
  dayBreakdown: DayValidationSummary[];
  errorLogs: RoutineImportErrorLog[];
  summaryMessage: string;
}

interface ColumnIndexMap {
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
}

// Almacén efímero del último lote de logs detectados a nivel de matriz Excel para enriquecer la validación post-importación
let lastMatrixParseIssues: RoutineImportErrorLog[] = [];
let lastDeclaredSheetTotalsByDay: Partial<Record<CanonicalWeekday, { rowNumber: number; declaredSets: number }>> = {};

export function getLastMatrixParseDiagnostics() {
  return {
    issues: [...lastMatrixParseIssues],
    declaredTotalsByDay: { ...lastDeclaredSheetTotalsByDay },
  };
}

export const convertirABase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};

/**
 * Extrae los segundos totales de descanso a partir de cualquier valor numérico o de texto
 * proveniente de la columna "Descanso" en Excel/CSV:
 * 1. Número directo (ej: 75, 60, 120, 45) -> se usa tal cual como segundos.
 * 2. Formato de tiempo con dos puntos (ej: "1:30", "01:15", "0:45") -> convierte minutos y segundos a segundos totales.
 * 3. Formato con minutos explícitos (ej: "1 min", "1.5 min", "2 minutos", "1 min 30 seg") -> convierte a segundos totales.
 * 4. Texto con letras o sufijos (ej: "75 seg", "60s", "120 segundos", "45 seg") -> usa Regex para extraer los dígitos numéricos.
 * 5. Celda vacía o formato irreconocible -> aplica fallback seguro (por defecto 90s).
 */
export function extractRestSeconds(
  rawRest: unknown,
  fallbackSeconds: number = 90
): number {
  if (rawRest === undefined || rawRest === null) {
    return fallbackSeconds;
  }

  // 1. Si el valor es un número directo en la celda de Excel (ej: 75, 60, 120, 45)
  if (typeof rawRest === 'number') {
    if (!Number.isFinite(rawRest) || rawRest <= 0) {
      return fallbackSeconds;
    }
    // Si Excel serializó un formato de hora (ej. 00:01:30) como fracción decimal de un día (0 < val < 1)
    if (rawRest > 0 && rawRest < 1) {
      const excelTimeSeconds = Math.round(rawRest * 86400);
      return excelTimeSeconds > 0 ? excelTimeSeconds : fallbackSeconds;
    }
    return Math.round(rawRest);
  }

  const str = String(rawRest).trim();
  if (!str) {
    return fallbackSeconds;
  }

  // 1b. Si es un número directo en formato string (ej: "75", "60", "120", "45")
  if (/^\d+(?:[.,]\d+)?$/.test(str)) {
    const directNum = parseFloat(str.replace(',', '.'));
    return Number.isFinite(directNum) && directNum > 0
      ? Math.round(directNum)
      : fallbackSeconds;
  }

  // 2. Formato de tiempo "MM:SS" o "HH:MM:SS" (ej: "1:30" -> 90s, "1:15" -> 75s, "0:45" -> 45s)
  const colonMatch = str.match(
    /^(\d+)\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?\s*(?:min|minutos?|seg|segundos?|s|m)?$/i
  );
  if (colonMatch) {
    if (colonMatch[3] !== undefined) {
      const hours = parseInt(colonMatch[1], 10) || 0;
      const mins = parseInt(colonMatch[2], 10) || 0;
      const secs = parseInt(colonMatch[3], 10) || 0;
      const total = hours * 3600 + mins * 60 + secs;
      return total > 0 ? total : fallbackSeconds;
    }
    const mins = parseInt(colonMatch[1], 10) || 0;
    const secs = parseInt(colonMatch[2], 10) || 0;
    const total = mins * 60 + secs;
    return total > 0 ? total : fallbackSeconds;
  }

  // 3a. Rango en minutos (ej: "1-2 min", "1.5 a 2 min")
  const rangeMinMatch = str.match(
    /(\d+(?:[.,]\d+)?)\s*[-–a]\s*(\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minuto|minutos)\b/i
  );
  if (rangeMinMatch) {
    const m1 = parseFloat(rangeMinMatch[1].replace(',', '.'));
    const m2 = parseFloat(rangeMinMatch[2].replace(',', '.'));
    const total = Math.round(((m1 + m2) / 2) * 60);
    return total > 0 ? total : fallbackSeconds;
  }

  // 3b. Formato con minutos explícitos (ej: "1 min", "1.5 min", "2 minutos", "1 min 30 seg", "1m 15s")
  const minMatch = str.match(/(\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minuto|minutos|')(?!\w)/i);
  if (minMatch) {
    const mins = parseFloat(minMatch[1].replace(',', '.'));
    const afterMin = str.slice((minMatch.index || 0) + minMatch[0].length);
    const extraSecMatch =
      afterMin.match(/(\d+(?:[.,]\d+)?)\s*(?:s|seg|segs|sec|secs|segundo|segundos|"|'')?/i) ||
      str.match(/(\d+(?:[.,]\d+)?)\s*(?:s|seg|segs|sec|secs|segundo|segundos)\b/i);
    const extraSecs =
      extraSecMatch && extraSecMatch[1] !== minMatch[1]
        ? parseFloat(extraSecMatch[1].replace(',', '.'))
        : 0;
    const total = Math.round(mins * 60 + (Number.isFinite(extraSecs) ? extraSecs : 0));
    return total > 0 ? total : fallbackSeconds;
  }

  // 4a. Rango en segundos (ej: "60-75 seg", "60 a 90s")
  const rangeSecMatch = str.match(
    /(\d+(?:[.,]\d+)?)\s*[-–a]\s*(\d+(?:[.,]\d+)?)\s*(?:s|seg|segs|sec|secs|segundo|segundos)?\b/i
  );
  if (rangeSecMatch) {
    const s1 = parseFloat(rangeSecMatch[1].replace(',', '.'));
    const s2 = parseFloat(rangeSecMatch[2].replace(',', '.'));
    const avg = Math.round((s1 + s2) / 2);
    return avg > 0 ? avg : fallbackSeconds;
  }

  // 4b. Texto con letras o sufijos de segundos (ej: "75 seg", "60s", "120 segundos", "45 seg.")
  const digitsMatch = str.match(/(\d+(?:[.,]\d+)?)/);
  if (digitsMatch) {
    const secs = Math.round(parseFloat(digitsMatch[1].replace(',', '.')));
    if (Number.isFinite(secs) && secs > 0) {
      return secs;
    }
  }

  // 5. Fallback seguro si está vacío o es irreconocible
  return fallbackSeconds;
}

/**
 * Convierte cualquier valor de la columna Descanso (número o texto) en `{ restSeconds, restText }`.
 */
export function parseRestToSeconds(
  rawRest: unknown,
  fallbackSeconds: number = 90
): {
  restSeconds: number;
  restText: string;
} {
  const restSeconds = extractRestSeconds(rawRest, fallbackSeconds);
  return {
    restSeconds,
    restText: `${restSeconds} seg`,
  };
}

/**
 * Determina si el contenido COMPLETO de una celda corresponde estrictamente a un tiempo de descanso
 * (ej: "75 seg", "60s", "120 segundos", "45 seg", "1:30", "2 min", o un número puro >= 15).
 * Rechaza textos largos o notas de recomendación/estrategia (incluso si mencionan "bajar en 2 seg").
 */
export function isLikelyRestValue(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 15 && val <= 600;
  }
  const s = String(val).trim();
  if (!s || s.length > 24) return false;

  // Formato reloj MM:SS o HH:MM:SS (ej: "1:30", "01:15", "0:45")
  if (/^\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\s*(?:min|minutos?|seg|segundos?|s|m)?$/i.test(s)) {
    return true;
  }

  // Celda cuyo texto completo es un número o rango con unidad de tiempo (ej: "75 seg", "60s", "120 segundos", "1.5 min", "1 min 30 seg")
  if (
    /^\d+(?:[.,]\d+)?(?:\s*[-–a]\s*\d+(?:[.,]\d+)?)?\s*(?:s|seg|segs|sec|secs|segundo|segundos|m|min|mins|minuto|minutos|'|")(?:\s*\d+\s*(?:s|seg|segs|sec|secs|segundo|segundos|")?)?\.?$/i.test(
      s
    )
  ) {
    return true;
  }

  // Número puro entre 15 y 600 (ej: "45", "60", "75", "90", "120")
  if (/^\d+(?:[.,]\d+)?$/.test(s)) {
    const n = parseFloat(s.replace(',', '.'));
    return Number.isFinite(n) && n >= 15 && n <= 600;
  }

  return false;
}

/**
 * Determina si una celda corresponde estrictamente a un valor de RPE o RIR (ej: "8", "8.5", "7-8", "RPE 8", "RIR 2").
 */
export function isStrictRpeValue(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  const s = String(val).trim();
  if (!s || s.length > 14) return false;

  if (/^(?:rpe|rir)\s*[:=]?\s*\d+(?:[.,]\d+)?(?:\s*[-–/]\s*\d+(?:[.,]\d+)?)?$/i.test(s)) {
    return true;
  }

  if (/^\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?$/.test(s)) {
    const parts = s.split(/[-–]/).map((p) => parseFloat(p.trim().replace(',', '.')));
    return parts.every((n) => Number.isFinite(n) && n >= 5 && n <= 10);
  }

  return false;
}

/**
 * Detecta si una cadena o celda representa un encabezado de bloque de día
 * como "LUNES: EMPUJE A (PECHO / HOMBRO / TRÍCEPS)", "MARTES - TIRÓN A", "MIÉRCOLES: PIERNA", etc.
 */
export function extractDayHeaderFromText(rawText: string): {
  day: CanonicalWeekday;
  fullTitle: string;
  enfoque: string;
} | null {
  if (!rawText) return null;
  const trimmed = String(rawText).trim();
  if (!trimmed) return null;

  const norm = normalizar(trimmed);

  const startsWithDayPattern =
    /^(?:(?:dia|day|rutina|sesion|bloque|entrenamiento)\s*(?:\d+\s*)?[:\-–—/]?\s*)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

  const numberedDayOnlyPattern =
    /^(?:dia|day|sesion|rutina)\s*([1-7])(?:\s*[:\-–—/]\s*(.*))?$/i;

  const matchDayName = norm.match(startsWithDayPattern);
  const matchNumbered = norm.match(numberedDayOnlyPattern);

  if (!matchDayName && !matchNumbered) {
    return null;
  }

  const canonicalDay = resolveCanonicalDay(trimmed);
  if (!canonicalDay) return null;

  const splitParts = trimmed.split(/\s*[:\-–—|]\s*/);
  const enfoque =
    splitParts.length > 1
      ? splitParts.slice(1).join(' - ').trim()
      : 'Hipertrofia & Fuerza';

  const fullTitle =
    splitParts.length > 1
      ? `${canonicalDay}: ${enfoque}`
      : trimmed.length > canonicalDay.length + 2
      ? trimmed
      : `Rutina ${canonicalDay}`;

  return {
    day: canonicalDay,
    fullTitle,
    enfoque,
  };
}

/**
 * Determina si una fila de celdas de Excel es una fila de cabeceras de subtabla
 * (ej. ["Ejercicio", "Series", "Repeticiones", "RPE", "Descanso", "Notas"])
 * y devuelve el mapa de índices de columna actualizado.
 */
function detectSubtableColumns(cells: string[]): {
  isHeaderRow: boolean;
  columnMap: ColumnIndexMap;
  embeddedDayHeader: { day: CanonicalWeekday; fullTitle: string; enfoque: string } | null;
} {
  const map: ColumnIndexMap = {};
  let matchedKeywords = 0;
  let embeddedDayHeader: { day: CanonicalWeekday; fullTitle: string; enfoque: string } | null = null;

  cells.forEach((cell, idx) => {
    const raw = String(cell ?? '').trim();
    if (!raw) return;
    const norm = normalizar(raw);
    const compact = norm.replace(/\s+/g, '');

    const maybeDayHeader = extractDayHeaderFromText(raw);
    if (maybeDayHeader && idx <= 1 && compact !== 'dia' && compact !== 'day') {
      embeddedDayHeader = maybeDayHeader;
      if (map.exercise === undefined) {
        map.exercise = idx;
      }
      return;
    }

    if (/^(#|n|no|nro|num|numero|orden|item|id)$/.test(compact)) {
      map.order = idx;
      matchedKeywords++;
    } else if (/^(dia|day|dias|diadesemana|sesion|session)$/.test(compact)) {
      map.day = idx;
      matchedKeywords++;
    } else if (
      /^(ejercicio|ejercicios|ejercicioprincipal|exercise|exercisename|nombre|nombreejercicio|movimiento|movement|actividad)$/.test(
        compact
      ) ||
      norm.startsWith('ejercicio')
    ) {
      map.exercise = idx;
      matchedKeywords++;
    } else if (
      /^(musculo|musculos|grupomuscular|muscle|musclegroup|target|zona|enfoque|categoria)$/.test(
        compact
      )
    ) {
      map.muscle = idx;
      matchedKeywords++;
    } else if (/^(series|serie|sets|set|nroseries|cantseries)$/.test(compact)) {
      map.sets = idx;
      matchedKeywords++;
    } else if (
      /^(reps|repeticiones|repeticion|rep|rangoreps|rangoderepeticiones|rango|trabajo)$/.test(
        compact
      ) ||
      compact.startsWith('repeticion') ||
      compact.startsWith('reps')
    ) {
      map.reps = idx;
      matchedKeywords++;
    } else if (
      /^(rpe|rir|rperir|rirrpe|intensidad|esfuerzo|targetrpe)$/.test(compact) ||
      norm.includes('rpe') ||
      norm.includes('rir')
    ) {
      map.rpe = idx;
      matchedKeywords++;
    } else if (
      map.rest === undefined &&
      (/^(descanso|descansos|rest|pausa|recuperacion|tiempodedescanso|tiempodescanso|descansoseg|descansos|intervalo)$/.test(
        compact
      ) ||
        norm.startsWith('descanso') ||
        norm.startsWith('tiempo de descanso'))
    ) {
      map.rest = idx;
      matchedKeywords++;
    } else if (/^(peso|pesokg|carga|kg|kgs|weight|load)$/.test(compact)) {
      map.weight = idx;
      matchedKeywords++;
    } else if (
      /^(notas|nota|estrategia|estrategias|recomendacion|recomendaciones|observaciones|observacion|notes|note|strategy|comentarios|comentario|indicaciones|indicacion|tecnica|ejecucion|metodo|tip|tips|unnamed5|empty5)$/.test(
        compact
      ) ||
      norm.includes('estrategia') ||
      norm.includes('recomendacion') ||
      norm.includes('nota') ||
      norm.includes('observacion') ||
      (map.rest !== undefined && idx > map.rest && /^(unnamed|empty)/i.test(compact))
    ) {
      map.notes = idx;
      matchedKeywords++;
    }
  });

  const isHeaderRow =
    matchedKeywords >= 2 ||
    (embeddedDayHeader !== null &&
      (map.sets !== undefined || map.reps !== undefined || map.rest !== undefined));

  return {
    isHeaderRow,
    columnMap: map,
    embeddedDayHeader,
  };
}

/**
 * Verifica si una fila completa es un encabezado de sección de día (ej. "LUNES: EMPUJE A...")
 */
function checkStandaloneDayHeaderRow(
  cells: string[],
  currentColumnMap: ColumnIndexMap
): { day: CanonicalWeekday; fullTitle: string; enfoque: string } | null {
  const nonEmpty = cells
    .map((val, idx) => ({ val: String(val ?? '').trim(), idx }))
    .filter((item) => item.val.length > 0);

  if (nonEmpty.length === 0) return null;

  if (nonEmpty.length === 1) {
    return extractDayHeaderFromText(nonEmpty[0].val);
  }

  if (nonEmpty.length === 2) {
    const firstAsDay = extractDayHeaderFromText(nonEmpty[0].val);
    const secondVal = nonEmpty[1].val;
    const secondIsPureNumber = /^\d+(?:[.,]\d+)?$/.test(secondVal);
    const secondIsRepScheme =
      /^\d+\s*[xX×]\s*\d+/.test(secondVal) || /^\d+\s*[-–]\s*\d+$/.test(secondVal);

    if (firstAsDay && !secondIsPureNumber && !secondIsRepScheme) {
      const secondNorm = normalizar(secondVal);
      const looksLikeBlockSubtitle =
        /^(empuje|tiron|jalon|pierna|torso|full\s*body|upper|lower|brazo|dia|sesion|bloque|rutina|hipertrofia|fuerza)\b/.test(
          secondNorm
        );

      if (currentColumnMap.day === undefined || looksLikeBlockSubtitle) {
        return {
          day: firstAsDay.day,
          fullTitle: `${firstAsDay.day}: ${secondVal}`,
          enfoque: secondVal,
        };
      }
    }
  }

  const firstCell = nonEmpty[0].val;
  if (firstCell.includes(':')) {
    const headerCandidate = extractDayHeaderFromText(firstCell);
    if (headerCandidate) {
      const hasNumericSets = nonEmpty
        .slice(1)
        .some((c) => /^\d+$/.test(c.val) && Number(c.val) <= 10);
      if (!hasNumericSets) {
        return headerCandidate;
      }
    }
  }

  return null;
}

function cleanExerciseTitle(raw: string): string {
  if (!raw) return '';
  return String(raw)
    .replace(/^\s*(?:\d+[\.\)\-:]|\•|\*|\-)\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parsea de forma iterativa una matriz 2D de filas de una hoja de Excel.
 * Además de extraer todos los ejercicios consecutivos de cada bloque diario,
 * registra diagnósticos exactos por número de fila (`excelRowNumber`) cuando una fila presenta errores.
 */
export function parseExcelMatrixIterative(
  matrix: any[][],
  defaultSheetDay?: CanonicalWeekday | null,
  sheetName: string = 'Hoja 1',
  resetDiagnostics: boolean = true
): ExtractedRoutineRow[] {
  if (resetDiagnostics) {
    lastMatrixParseIssues = [];
    lastDeclaredSheetTotalsByDay = {};
  }

  if (!Array.isArray(matrix) || matrix.length === 0) return [];

  const extractedRows: ExtractedRoutineRow[] = [];

  let currentDay: CanonicalWeekday = defaultSheetDay || 'Lunes';
  let currentRoutineTitle: string = defaultSheetDay ? `Rutina ${defaultSheetDay}` : 'Rutina Lunes';
  let currentEnfoque: string = 'Hipertrofia & Fuerza';
  let currentOrder = 1;
  let columnMap: ColumnIndexMap = {};

  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex++) {
    const excelRowNumber = rowIndex + 1;
    const rawRow = matrix[rowIndex];
    if (!Array.isArray(rawRow)) continue;

    const strCells = rawRow.map((cell) =>
      cell === null || cell === undefined ? '' : String(cell).trim()
    );
    const nonEmptyCells = strCells.filter((c) => c.length > 0);
    const rawRowPreview = nonEmptyCells.join(' | ');

    if (nonEmptyCells.length === 0) continue;

    // 1. ¿Es una fila de cabeceras de subtabla ("Ejercicio | Series | Reps | Descanso")?
    const subtableCheck = detectSubtableColumns(strCells);
    if (subtableCheck.isHeaderRow) {
      columnMap = { ...subtableCheck.columnMap };
      if (subtableCheck.embeddedDayHeader) {
        currentDay = subtableCheck.embeddedDayHeader.day;
        currentRoutineTitle = subtableCheck.embeddedDayHeader.fullTitle;
        currentEnfoque = subtableCheck.embeddedDayHeader.enfoque;
        currentOrder = 1;
      }
      continue;
    }

    // 2. ¿Es un encabezado de bloque de día ("LUNES: EMPUJE A...")?
    const standaloneDayHeader = checkStandaloneDayHeaderRow(strCells, columnMap);
    if (standaloneDayHeader) {
      currentDay = standaloneDayHeader.day;
      currentRoutineTitle = standaloneDayHeader.fullTitle;
      currentEnfoque = standaloneDayHeader.enfoque;
      currentOrder = 1;
      continue;
    }

    // 3. Verificar si es una fila de "TOTAL SERIES" declarada en el Excel para contrastarla con la suma real
    const firstNonEmptyNorm = normalizar(nonEmptyCells[0]);
    if (
      /^(total|totales|resumen|subtotal|promedio|fin de|observaciones generales|semana \d+)$/.test(
        firstNonEmptyNorm
      ) ||
      firstNonEmptyNorm.startsWith('total series') ||
      firstNonEmptyNorm.startsWith('total de series')
    ) {
      // Si la fila declara un número total de series para el día actual, guardarlo para validación cruzada
      const numericCell = nonEmptyCells
        .slice(1)
        .map((c) => parseInt(c, 10))
        .find((n) => Number.isFinite(n) && n > 0 && n <= 120);
      if (numericCell) {
        lastDeclaredSheetTotalsByDay[currentDay] = {
          rowNumber: excelRowNumber,
          declaredSets: numericCell,
        };
      }
      continue;
    }

    // 4. Si existe columna explícita de Día en formato tabular, actualizar cuando cambie
    if (columnMap.day !== undefined && strCells[columnMap.day]) {
      const explicitRowDay = resolveCanonicalDay(strCells[columnMap.day]);
      if (explicitRowDay) {
        if (explicitRowDay !== currentDay) {
          currentDay = explicitRowDay;
          currentRoutineTitle = `Rutina ${explicitRowDay}`;
          currentOrder = 1;
        }
      }
    } else if (columnMap.day === undefined && strCells.length >= 3) {
      const firstCellDayOnly = resolveCanonicalDay(strCells[0]);
      const firstCellNorm = normalizar(strCells[0]);
      if (
        firstCellDayOnly &&
        /^(lunes|martes|miercoles|jueves|viernes|sabado|domingo|dia\s*[1-7])$/.test(firstCellNorm) &&
        strCells[1] &&
        !/^\d+$/.test(strCells[1])
      ) {
        if (firstCellDayOnly !== currentDay) {
          currentDay = firstCellDayOnly;
          currentRoutineTitle = `Rutina ${firstCellDayOnly}`;
          currentOrder = 1;
        }
        columnMap.day = 0;
        if (columnMap.exercise === undefined) {
          columnMap.exercise = 1;
        }
      }
    }

    // 5. Extraer las propiedades del ejercicio usando `columnMap` o inferencia posicional
    let rawExercise = '';
    let rawMuscle = '';
    let rawSets = '';
    let rawReps = '';
    let rawRpe = '';
    let rawRest = '';
    let rawWeight = '';
    let rawNotes = '';

    const hasMappedColumns =
      columnMap.exercise !== undefined ||
      columnMap.sets !== undefined ||
      columnMap.reps !== undefined;

    if (hasMappedColumns) {
      if (columnMap.exercise !== undefined) {
        rawExercise = strCells[columnMap.exercise] || '';
      }
      if (!rawExercise || /^\d+[\.\)]?$/.test(rawExercise)) {
        const candidateIdx = strCells.findIndex(
          (val, idx) =>
            idx !== columnMap.day &&
            idx !== columnMap.order &&
            idx !== columnMap.sets &&
            idx !== columnMap.reps &&
            idx !== columnMap.rpe &&
            idx !== columnMap.rest &&
            Boolean(val) &&
            !/^\d+(?:[.,]\d+)?$/.test(val) &&
            !/^\d+\s*[-–xX]\s*\d+$/.test(val)
        );
        if (candidateIdx !== -1) {
          rawExercise = strCells[candidateIdx];
        }
      }

      if (columnMap.muscle !== undefined) rawMuscle = strCells[columnMap.muscle] || '';
      if (columnMap.sets !== undefined) rawSets = strCells[columnMap.sets] || '';
      if (columnMap.reps !== undefined) rawReps = strCells[columnMap.reps] || '';
      if (columnMap.rpe !== undefined) rawRpe = strCells[columnMap.rpe] || '';
      if (columnMap.rest !== undefined) rawRest = strCells[columnMap.rest] || '';
      if (columnMap.weight !== undefined) rawWeight = strCells[columnMap.weight] || '';
      if (columnMap.notes !== undefined) rawNotes = strCells[columnMap.notes] || '';

      // Si rawRest capturó por desfase una nota de estrategia/recomendación (no es un valor estricto de descanso),
      // mover ese texto a rawNotes y limpiar rawRest para buscar la celda real de descanso.
      if (rawRest && !isLikelyRestValue(rawRest)) {
        rawNotes = rawNotes ? `${rawRest} | ${rawNotes}` : rawRest;
        rawRest = '';
      }

      // Si rawRpe capturó el tiempo de descanso (ej. "75 seg" en tabla sin columna RPE), pasarlo a rawRest
      if (rawRpe && isLikelyRestValue(rawRpe)) {
        if (!rawRest) {
          rawRest = rawRpe;
        }
        rawRpe = '8';
      }

      // Si la columna de Notas/Estrategia no tenía título en el encabezado de la subtabla (ej. Unnamed: 5 o última columna),
      // capturar cualquier celda de texto situada después de la columna de Descanso/Reps (como índice 5).
      const usedIndices = new Set<number>(
        [
          columnMap.day,
          columnMap.order,
          columnMap.exercise,
          columnMap.muscle,
          columnMap.sets,
          columnMap.reps,
          columnMap.rpe,
          columnMap.rest,
          columnMap.weight,
          columnMap.notes,
        ].filter((v): v is number => v !== undefined)
      );

      strCells.forEach((cellVal, idx) => {
        if (!cellVal || usedIndices.has(idx)) return;
        if (!rawRest && isLikelyRestValue(cellVal)) {
          rawRest = cellVal;
          usedIndices.add(idx);
        } else if (!rawRpe && isStrictRpeValue(cellVal)) {
          rawRpe = cellVal;
          usedIndices.add(idx);
        } else if (
          idx > (columnMap.reps ?? 1) &&
          !isLikelyRestValue(cellVal) &&
          !isStrictRpeValue(cellVal)
        ) {
          rawNotes = rawNotes ? `${rawNotes} | ${cellVal}` : cellVal;
          usedIndices.add(idx);
        }
      });
    } else {
      const workingCells = [...nonEmptyCells];
      if (workingCells.length > 1 && /^(\d+|[a-z]\d?)[\.\)]?$/i.test(workingCells[0])) {
        workingCells.shift();
      }
      if (
        workingCells.length > 1 &&
        /^(lunes|martes|miercoles|jueves|viernes|sabado|domingo)$/i.test(normalizar(workingCells[0]))
      ) {
        const d = resolveCanonicalDay(workingCells.shift()!);
        if (d) {
          currentDay = d;
          currentRoutineTitle = `Rutina ${d}`;
        }
      }

      rawExercise = workingCells[0] || '';
      rawSets = workingCells[1] || '';
      rawReps = workingCells[2] || '';

      // Clasificar estrictamente las columnas restantes (índice 3, 4, 5 / Unnamed: 5):
      // - Descanso lee exclusivamente celdas con formato de tiempo/segundos ("75 seg", "60 seg", etc.)
      // - RPE lee exclusivamente valores en escala RPE/RIR (5..10)
      // - Notas/Estrategia lee las recomendaciones técnicas o la última columna (Unnamed: 5)
      const extraNotes: string[] = [];
      for (let i = 3; i < workingCells.length; i++) {
        const cell = workingCells[i];
        if (!cell) continue;
        if (!rawRest && isLikelyRestValue(cell)) {
          rawRest = cell;
        } else if (!rawRpe && isStrictRpeValue(cell)) {
          rawRpe = cell;
        } else {
          extraNotes.push(cell);
        }
      }
      if (extraNotes.length > 0) {
        rawNotes = extraNotes.join(' | ');
      }
    }

    const cleanedExerciseName = cleanExerciseTitle(rawExercise);

    // Si la fila tiene datos de series o repeticiones pero el nombre del ejercicio está vacío o ilegible, registrar error exacto de fila
    if (!cleanedExerciseName || cleanedExerciseName.length < 2) {
      if (rawSets || rawReps || nonEmptyCells.length >= 2) {
        lastMatrixParseIssues.push({
          rowNumber: excelRowNumber,
          sheetName,
          day: currentDay,
          exerciseName: rawExercise || '(Sin nombre)',
          severity: 'ERROR',
          code: 'MISSING_EXERCISE_NAME',
          message: `Fila ${excelRowNumber} (${currentDay}): Se detectaron valores de prescripción pero falta el nombre del ejercicio.`,
          rawRowPreview,
        });
      }
      continue;
    }

    const exNorm = normalizar(cleanedExerciseName);
    if (/^(ejercicio|ejercicios|exercise|nombre|movimiento)$/.test(exNorm)) {
      continue;
    }

    // Validar y parsear el número de series
    let parsedSets = 3;
    let parsedReps = rawReps ? String(rawReps).trim() : '';
    let hasSetsWarning = false;
    let setsWarningReason = '';

    const combinedMatch = String(rawSets).match(/^(\d+)\s*[xX×]\s*(.+)$/);
    if (combinedMatch) {
      parsedSets = parseInt(combinedMatch[1], 10) || 3;
      if (!rawReps) {
        parsedReps = combinedMatch[2].trim();
      }
    } else {
      const setsDigits = String(rawSets).match(/(\d+)/);
      if (setsDigits) {
        parsedSets = parseInt(setsDigits[1], 10);
      } else {
        hasSetsWarning = true;
        setsWarningReason = `Fila ${excelRowNumber} (${currentDay} - "${cleanedExerciseName}"): La columna Series contiene un valor inválido o vacío ("${rawSets || 'vacío'}"). Se asignaron 3 series por defecto.`;
        lastMatrixParseIssues.push({
          rowNumber: excelRowNumber,
          sheetName,
          day: currentDay,
          exerciseName: cleanedExerciseName,
          severity: 'WARNING',
          code: 'INVALID_SERIES_VALUE',
          message: setsWarningReason,
          rawRowPreview,
        });
        parsedSets = 3;
      }
    }

    if (parsedSets < 1 || parsedSets > 6) {
      const clampedSets = Math.min(Math.max(parsedSets, 1), 6);
      hasSetsWarning = true;
      setsWarningReason = `Fila ${excelRowNumber} (${currentDay} - "${cleanedExerciseName}"): El número de series (${parsedSets}) excede el rango fisiológico [1..6]. Se ajustó a ${clampedSets} series.`;
      lastMatrixParseIssues.push({
        rowNumber: excelRowNumber,
        sheetName,
        day: currentDay,
        exerciseName: cleanedExerciseName,
        severity: 'WARNING',
        code: 'SERIES_OUT_OF_RANGE',
        message: setsWarningReason,
        rawRowPreview,
      });
      parsedSets = clampedSets;
    }

    const hasRepsWarning = !parsedReps || !String(parsedReps).trim();
    if (hasRepsWarning) {
      parsedReps = '8-12';
    } else {
      parsedReps = String(parsedReps).trim();
    }

    if (!rawRest && rawRpe && /(?:min|seg|sec|\d+\s*s\b)/i.test(rawRpe)) {
      rawRest = rawRpe;
      rawRpe = '';
    }

    const hasRestWarning = !rawRest || !String(rawRest).trim();
    const { restSeconds, restText } = parseRestToSeconds(rawRest);

    const cleanRpe = rawRpe
      ? String(rawRpe)
          .replace(/^(?:rpe|rir)\s*[:=]?\s*/i, '')
          .trim()
      : '8';

    const weightVal = rawWeight
      ? parseFloat(String(rawWeight).replace(',', '.').replace(/[^0-9.]/g, '')) || 0
      : 0;

    const targetMuscle = canonicalizeMuscleGroup(rawMuscle, cleanedExerciseName);

    extractedRows.push({
      excelRowNumber,
      sheetName,
      rawSetsValue: String(rawSets || ''),
      hasSetsWarning,
      hasRepsWarning,
      hasRestWarning,
      rawMuscleValue: String(rawMuscle || ''),
      rawWeightValue: String(rawWeight || ''),
      setsWarningReason: setsWarningReason || undefined,
      Dia: currentDay,
      Rutina: currentRoutineTitle || `Rutina ${currentDay}`,
      Enfoque: currentEnfoque,
      Orden: currentOrder++,
      Ejercicio: cleanedExerciseName,
      Ejercicio_Principal: cleanedExerciseName,
      Musculo: targetMuscle,
      Series: parsedSets,
      Repeticiones: parsedReps,
      RPE: cleanRpe || '8',
      DESCANSO: restText,
      DescansoSegundos: restSeconds,
      Peso: weightVal,
      Notas: rawNotes || '',
      dia: currentDay,
      day: currentDay,
      nombre: cleanedExerciseName,
      name: cleanedExerciseName,
      series: parsedSets,
      repeticiones: parsedReps,
      reps: parsedReps,
      rpe: cleanRpe || '8',
      descanso: restText,
      rest: restText,
      notas: rawNotes || '',
      estrategia: rawNotes || '',
      Estrategia: rawNotes || '',
    });
  }

  return extractedRows;
}

/**
 * Reconstruye una matriz 2D a partir de un arreglo de objetos generado por `XLSX.utils.sheet_to_json(ws)`.
 */
export function reconstructMatrixFromSheetObjects(rows: Record<string, any>[]): any[][] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const allKeys: string[] = [];
  rows.forEach((r) => {
    if (r && typeof r === 'object') {
      Object.keys(r).forEach((k) => {
        if (!allKeys.includes(k)) {
          allKeys.push(k);
        }
      });
    }
  });

  if (allKeys.length === 0) return [];

  const matrix: any[][] = [];
  const firstRowFromKeys = allKeys.map((k) => (/^__EMPTY(_\d+)?$/i.test(k) ? '' : k));
  if (firstRowFromKeys.some((cell) => cell.length > 0)) {
    matrix.push(firstRowFromKeys);
  }

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rowCells = allKeys.map((k) => (row[k] !== undefined && row[k] !== null ? row[k] : ''));
    matrix.push(rowCells);
  }

  return matrix;
}

/**
 * FUNCIÓN DE VALIDACIÓN POST-IMPORTACIÓN:
 * Verifica si el volumen total de series y ejercicios importados coincide exactamente
 * con la estructura de filas leídas del archivo Excel/CSV.
 * Si existen discrepancias en la suma de series o ejercicios, genera un log de errores detallado
 * indicando exactamente qué fila (`Fila #`) falló o causó la diferencia.
 */
export function validateRoutineImportIntegrity(
  rawExtractedRows: Record<string, any>[],
  finalRoutines: Routine[],
  initialErrorLogs: RoutineImportErrorLog[] = []
): RoutineImportValidationReport {
  const errorLogs: RoutineImportErrorLog[] = [...initialErrorLogs];
  const { declaredTotalsByDay } = getLastMatrixParseDiagnostics();

  // 1. Calcular el volumen esperado fila por fila desde los registros leídos del archivo
  const expectedByDay = new Map<
    CanonicalWeekday,
    {
      exercisesCount: number;
      setsCount: number;
      seenExercises: Map<string, { rowNumber: number; sets: number; rawName: string }>;
    }
  >();

  let expectedExercisesCount = 0;
  let expectedTotalSets = 0;

  rawExtractedRows.forEach((row, idx) => {
    if (!row || typeof row !== 'object') return;
    const rowNum = Number(row.excelRowNumber) || idx + 2;
    const rawName = String(
      row.Ejercicio || row.Ejercicio_Principal || row.nombre || row.name || ''
    ).trim();
    const rawDay = String(row.Dia || row.dia || row.day || 'Lunes').trim();
    const canonicalDay = resolveCanonicalDay(rawDay, row.Rutina) || 'Lunes';

    if (!rawName) {
      errorLogs.push({
        rowNumber: rowNum,
        sheetName: row.sheetName,
        day: canonicalDay,
        exerciseName: '(Vacío)',
        severity: 'ERROR',
        code: 'MISSING_EXERCISE_NAME',
        message: `Fila ${rowNum} (${canonicalDay}): La fila no contiene un nombre de ejercicio válido y fue omitida.`,
        rawRowPreview: JSON.stringify(row),
      });
      return;
    }

    const rawSetsVal = row.Series ?? row.series ?? row.defaultSets ?? 3;
    const parsedSets = Number(rawSetsVal);
    const validSets =
      Number.isFinite(parsedSets) && parsedSets > 0
        ? Math.min(Math.max(Math.round(parsedSets), 1), 6)
        : 3;

    if (!Number.isFinite(parsedSets) || parsedSets <= 0) {
      const alreadyLogged = errorLogs.some(
        (l) => l.rowNumber === rowNum && l.code === 'INVALID_SERIES_VALUE'
      );
      if (!alreadyLogged) {
        errorLogs.push({
          rowNumber: rowNum,
          sheetName: row.sheetName,
          day: canonicalDay,
          exerciseName: rawName,
          severity: 'ERROR',
          code: 'INVALID_SERIES_VALUE',
          message: `Fila ${rowNum} (${canonicalDay} - "${rawName}"): Valor de series inválido ("${rawSetsVal}").`,
          rawRowPreview: `${canonicalDay} | ${rawName} | Series: ${rawSetsVal}`,
        });
      }
    }

    if (!expectedByDay.has(canonicalDay)) {
      expectedByDay.set(canonicalDay, {
        exercisesCount: 0,
        setsCount: 0,
        seenExercises: new Map(),
      });
    }

    const dayBucket = expectedByDay.get(canonicalDay)!;
    const normExName = normalizar(rawName);

    // Detectar si una fila en el mismo día tiene un nombre de ejercicio duplicado que se fusionó
    if (dayBucket.seenExercises.has(normExName)) {
      const firstSeen = dayBucket.seenExercises.get(normExName)!;
      errorLogs.push({
        rowNumber: rowNum,
        sheetName: row.sheetName,
        day: canonicalDay,
        exerciseName: rawName,
        severity: 'ERROR',
        code: 'DUPLICATE_EXERCISE_COLLAPSED',
        message: `Fila ${rowNum} (${canonicalDay}): El ejercicio "${rawName}" (${validSets} series) está duplicado respecto a la Fila ${firstSeen.rowNumber} ("${firstSeen.rawName}", ${firstSeen.sets} series), provocando una discrepancia de ${validSets} series en la suma del día.`,
        rawRowPreview: `${canonicalDay} | ${rawName} | ${validSets} series`,
      });
    } else {
      dayBucket.seenExercises.set(normExName, {
        rowNumber: rowNum,
        sets: validSets,
        rawName,
      });
    }

    dayBucket.exercisesCount += 1;
    dayBucket.setsCount += validSets;
    expectedExercisesCount += 1;
    expectedTotalSets += validSets;
  });

  // 2. Calcular el volumen real consolidado en la estructura final de `finalRoutines`
  const importedByDay = new Map<CanonicalWeekday, { exercisesCount: number; setsCount: number }>();
  let importedExercisesCount = 0;
  let importedTotalSets = 0;

  (finalRoutines || []).forEach((routine) => {
    const day = resolveCanonicalDay(routine.dayName, routine.title) || 'Lunes';
    const exList = Array.isArray(routine.exercises) ? routine.exercises : [];
    const exCount = exList.length;
    const setsCount = exList.reduce(
      (acc, ex) => acc + (Number(ex.defaultSets ?? (ex as any).series) || 3),
      0
    );

    const prev = importedByDay.get(day) || { exercisesCount: 0, setsCount: 0 };
    importedByDay.set(day, {
      exercisesCount: prev.exercisesCount + exCount,
      setsCount: prev.setsCount + setsCount,
    });

    importedExercisesCount += exCount;
    importedTotalSets += setsCount;
  });

  // 3. Comparar día por día (Lunes a Domingo)
  const dayBreakdown: DayValidationSummary[] = [];
  const allRelevantDays = CANONICAL_WEEKDAYS.filter(
    (d) => expectedByDay.has(d) || importedByDay.has(d) || declaredTotalsByDay[d] !== undefined
  );

  for (const day of allRelevantDays) {
    const exp = expectedByDay.get(day) || { exercisesCount: 0, setsCount: 0 };
    const imp = importedByDay.get(day) || { exercisesCount: 0, setsCount: 0 };
    const declaredInfo = declaredTotalsByDay[day];

    const matchesExpected =
      exp.exercisesCount === imp.exercisesCount && exp.setsCount === imp.setsCount;
    const matchesDeclared =
      declaredInfo === undefined || declaredInfo.declaredSets === imp.setsCount;

    if (!matchesExpected) {
      errorLogs.push({
        rowNumber: 0,
        day,
        exerciseName: `Resumen ${day}`,
        severity: 'ERROR',
        code: 'DAY_VOLUME_DISCREPANCY',
        message: `Discrepancia en ${day}: El archivo contiene ${exp.exercisesCount} ejercicios (${exp.setsCount} series), pero se consolidaron ${imp.exercisesCount} ejercicios (${imp.setsCount} series). Revisa las filas duplicadas o con formato inválido de ${day}.`,
        rawRowPreview: `${day}: Esperado ${exp.exercisesCount} ej. / ${exp.setsCount} series vs Importado ${imp.exercisesCount} ej. / ${imp.setsCount} series`,
      });
    }

    if (declaredInfo && declaredInfo.declaredSets !== imp.setsCount) {
      errorLogs.push({
        rowNumber: declaredInfo.rowNumber,
        day,
        exerciseName: `Fila Total ${day}`,
        severity: 'WARNING',
        code: 'DECLARED_TOTAL_MISMATCH',
        message: `Fila ${declaredInfo.rowNumber} (${day}): La fila de TOTAL en el Excel declara ${declaredInfo.declaredSets} series, pero la suma real de los ejercicios de ${day} es de ${imp.setsCount} series.`,
        rawRowPreview: `Total declarado: ${declaredInfo.declaredSets} series | Suma real: ${imp.setsCount} series`,
      });
    }

    dayBreakdown.push({
      day,
      expectedExercises: exp.exercisesCount,
      importedExercises: imp.exercisesCount,
      expectedSets: exp.setsCount,
      importedSets: imp.setsCount,
      declaredSheetSets: declaredInfo?.declaredSets,
      matches: matchesExpected && matchesDeclared,
    });
  }

  const hasDiscrepancies =
    expectedExercisesCount !== importedExercisesCount ||
    expectedTotalSets !== importedTotalSets ||
    errorLogs.length > 0;

  const isValid =
    expectedExercisesCount === importedExercisesCount &&
    expectedTotalSets === importedTotalSets &&
    !errorLogs.some((l) => l.severity === 'ERROR');

  const summaryMessage = isValid
    ? `Validación post-importación exitosa: ${importedExercisesCount}/${expectedExercisesCount} ejercicios y ${importedTotalSets}/${expectedTotalSets} series verificadas sin discrepancias.`
    : `Atención en validación post-importación: Se detectaron ${errorLogs.length} incidencia(s). Ejercicios importados: ${importedExercisesCount}/${expectedExercisesCount} • Series importadas: ${importedTotalSets}/${expectedTotalSets}.`;

  // Imprimir reporte detallado en consola para auditoría técnica inmediata
  if (hasDiscrepancies) {
    console.warn('[LAZCAKONGYM - Validación Post-Importación]', {
      summaryMessage,
      expectedExercisesCount,
      importedExercisesCount,
      expectedTotalSets,
      importedTotalSets,
      dayBreakdown,
      errorLogs,
    });
  }

  return {
    isValid,
    hasDiscrepancies,
    expectedExercisesCount,
    importedExercisesCount,
    expectedTotalSets,
    importedTotalSets,
    dayBreakdown,
    errorLogs,
    summaryMessage,
  };
}

export const parsearRutinaExcel = (archivo: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });
        
        let rutinasExtraidas: any[] = [];
        let diaActivo: string | null = null;
        let mapColumnas: Record<string, number> = {};

        const normalize = (str: any) => str ? str.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : '';

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          const primeraCelda = normalize(row[0]);

          if (primeraCelda.includes('lunes') || primeraCelda.includes('martes') || 
              primeraCelda.includes('miercoles') || primeraCelda.includes('jueves') || 
              primeraCelda.includes('viernes') || primeraCelda.includes('sabado') || 
              primeraCelda.includes('domingo')) {
            diaActivo = row[0].split(':')[0].trim();
            continue;
          }

          if (primeraCelda === 'ejercicio') {
            mapColumnas = {
              ejercicio: row.findIndex((c: any) => normalize(c) === 'ejercicio'),
              series: row.findIndex((c: any) => normalize(c) === 'series'),
              reps: row.findIndex((c: any) => normalize(c) === 'reps' || normalize(c) === 'repeticiones'),
              rpe: row.findIndex((c: any) => normalize(c) === 'rpe' || normalize(c) === 'rir'),
              descanso: row.findIndex((c: any) => normalize(c) === 'descanso'),
              notas: row.findIndex((c: any) => normalize(c) === 'notas' || normalize(c) === 'estrategia')
            };
            continue;
          }

          if (diaActivo && mapColumnas.ejercicio !== -1 && row[mapColumnas.ejercicio]) {
            const descansoCrudo = row[mapColumnas.descanso]?.toString() || "90";
            const descansoMatch = descansoCrudo.match(/\d+/);
            const descansoSegundos = descansoMatch ? parseInt(descansoMatch[0]) : 90;
            const nombreEjercicio = row[mapColumnas.ejercicio].toString().replace(/^\d+\.\s*/, '').trim();

            rutinasExtraidas.push({
              id: crypto.randomUUID(),
              dia: diaActivo,
              Dia: diaActivo,
              Rutina: diaActivo,
              nombre: nombreEjercicio,
              Ejercicio: nombreEjercicio,
              Ejercicio_Principal: nombreEjercicio,
              name: nombreEjercicio,
              series: parseInt(row[mapColumnas.series]) || 3,
              Series: parseInt(row[mapColumnas.series]) || 3,
              repeticiones: row[mapColumnas.reps]?.toString() || "8-10",
              Repeticiones: row[mapColumnas.reps]?.toString() || "8-10",
              rpe: row[mapColumnas.rpe]?.toString() || "8",
              RPE: row[mapColumnas.rpe]?.toString() || "8",
              descanso: `${descansoSegundos}s`,
              DESCANSO: `${descansoSegundos}s`,
              DescansoSegundos: descansoSegundos,
              notas: mapColumnas.notas !== -1 ? row[mapColumnas.notas]?.toString() : "",
              Notas: mapColumnas.notas !== -1 ? row[mapColumnas.notas]?.toString() : "",
              Musculo: 'General',
              Peso: 0,
              Orden: i,
            });
          }
        }
        resolve(rutinasExtraidas);
      } catch (error: any) {
        reject("Error al procesar el documento: " + error.message);
      }
    };
    reader.readAsArrayBuffer(archivo);
  });
};

/**
 * Procesa un archivo Excel (.xlsx, .xls, .csv) leyendo iterativamente todas sus hojas y bloques diarios
 * para capturar el 100% de los ejercicios de cada sesión (Lunes a Viernes/Domingo).
 */
export const procesarExcel = async (file: File): Promise<ExtractedRoutineRow[]> => {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array', raw: true });

  lastMatrixParseIssues = [];
  lastDeclaredSheetTotalsByDay = {};

  const allExtractedRows: ExtractedRoutineRow[] = [];

  workbook.SheetNames.forEach((sheetName, idx) => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return;

    const matrix = XLSX.utils.sheet_to_json<any[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
      raw: true,
    });

    if (!matrix || matrix.length === 0) return;

    const sheetDefaultDay = resolveCanonicalDay(sheetName);
    const sheetRows = parseExcelMatrixIterative(
      matrix,
      sheetDefaultDay,
      sheetName,
      idx === 0
    );
    if (sheetRows.length > 0) {
      allExtractedRows.push(...sheetRows);
    }
  });

  return allExtractedRows;
};

export const procesarArchivoVisual = async (file: File) => {
  const base64 = await convertirABase64(file);
  const response = await fetch('/api/extraer-rutina-ia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file: base64,
      mimeType: file.type,
      prompt:
        'Extrae esta rutina completa de todos los días (Lunes a Viernes). Captura absolutamente todos los ejercicios de cada día (5 a 6 ejercicios por sesión) con sus Series, Repeticiones, RPE y DESCANSO. Devuelve solo un array en JSON.',
    }),
  });
  const jsonResponse = await response.json();
  return jsonResponse;
};
