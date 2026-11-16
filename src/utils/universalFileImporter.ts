import {
  parseGymCsvData,
  CsvImportResult,
  canonicalizeMuscleGroup,
  resolveCanonicalDay,
  CanonicalWeekday,
  normalizar,
} from './csvImporter';
import {
  procesarExcel,
  parseExcelMatrixIterative,
  extractDayHeaderFromText,
  parseRestToSeconds,
} from './routineImporterHelpers';

/**
 * Parser universal para cualquier tipo de archivo (.csv, .xlsx, .xls, .txt, .pdf, .md, .json)
 */
export async function parseRoutineFile(file: File): Promise<CsvImportResult> {
  const filename = file.name.toLowerCase();

  // 1. Archivos Excel (.xlsx, .xls) -> Lectura iterativa matricial por bloques de días
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
    try {
      const extractedRows = await procesarExcel(file);
      if (extractedRows && extractedRows.length > 0) {
        return parseGymCsvData(extractedRows);
      }
    } catch (e: any) {
      // Fallback a texto plano si Excel falla
    }
  }

  // 2. Archivos PDF (.pdf) - Extracción de texto y análisis inteligente
  if (filename.endsWith('.pdf')) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const text = decoder.decode(arrayBuffer);
      return parseUnstructuredTextToRoutine(text);
    } catch (e: any) {
      throw new Error(
        'No se pudo leer el contenido del PDF. Intenta guardarlo como Excel (.xlsx), bloc de notas (.txt) o CSV.'
      );
    }
  }

  // 3. Archivos de Texto (.txt, .md, .csv, etc.)
  const text = await file.text();
  if (!text || !text.trim()) {
    throw new Error('El archivo está vacío.');
  }

  // Intentar parsear como JSON por si es una copia de seguridad o exportación JSON
  if (filename.endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json)) {
        return parseGymCsvData(json);
      }
      if (json.routines && Array.isArray(json.routines)) {
        return {
          routines: json.routines,
          workouts: json.workouts || [],
          prs: json.prs || {},
          stats: {
            totalRows: json.routines.length,
            routinesCreated: json.routines.length,
            routineNames: json.routines.map((r: any) => r.title),
            workoutsCreated: 0,
            prsCreated: 0,
          },
        };
      }
    } catch {}
  }

  // Intentar parsear como matriz 2D con Papa.parse (soporta tanto CSV tabular como CSV exportado desde Excel con bloques por día)
  try {
    const Papa = (await import('papaparse')).default;
    const matrixParsed = Papa.parse(text, {
      header: false,
      skipEmptyLines: true,
    });

    if (matrixParsed.data && matrixParsed.data.length > 0) {
      const iterativeRows = parseExcelMatrixIterative(matrixParsed.data as string[][]);
      if (iterativeRows.length > 0) {
        return parseGymCsvData(iterativeRows);
      }
    }

    const headerParsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
    });
    if (headerParsed.data && headerParsed.data.length > 0) {
      const firstRow = headerParsed.data[0] as Record<string, any>;
      const keys = Object.keys(firstRow).map((k) => k.toLowerCase());
      const hasGymKeys = keys.some(
        (k) =>
          k.includes('dia') ||
          k.includes('day') ||
          k.includes('ejercicio') ||
          k.includes('exercise') ||
          k.includes('musculo')
      );
      if (hasGymKeys) {
        return parseGymCsvData(headerParsed.data as any[]);
      }
    }
  } catch {}

  // 4. Fallback inteligente de texto libre / Blocs de notas / Markdown
  return parseUnstructuredTextToRoutine(text);
}

/**
 * Parsea texto libre de notas, blocs de notas o markdown estructurando bloques de días
 * y capturando todas las filas consecutivas de ejercicios hasta el siguiente encabezado de día.
 */
function parseUnstructuredTextToRoutine(text: string): CsvImportResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: Record<string, any>[] = [];

  let currentDay: CanonicalWeekday = 'Lunes';
  let currentRoutineTitle = 'Rutina Lunes';
  let currentEnfoque = 'Hipertrofia';
  let orderIndex = 1;

  for (const line of lines) {
    // 1. Verificar si la línea es un encabezado de día (ej. "LUNES: EMPUJE A...")
    const dayHeader = extractDayHeaderFromText(line);
    if (dayHeader) {
      currentDay = dayHeader.day;
      currentRoutineTitle = dayHeader.fullTitle;
      currentEnfoque = dayHeader.enfoque;
      orderIndex = 1;
      continue;
    }

    // 2. Ignorar cabeceras de tabla en texto libre (ej. "Ejercicio | Series | Reps | Descanso")
    const normLine = normalizar(line);
    if (
      normLine.includes('ejercicio') &&
      (normLine.includes('series') || normLine.includes('repeticiones') || normLine.includes('reps'))
    ) {
      continue;
    }

    const cleanLine = line.replace(/^[\-\*\•\d\.\)]+\s*/, '').trim();
    if (!cleanLine || cleanLine.length < 3) continue;

    // Si la línea está separada por tabuladores o pipes ("Press Banca | 4 | 6-8 | 8 | 2 min")
    if (cleanLine.includes('|') || cleanLine.includes('\t')) {
      const parts = cleanLine
        .split(/[|\t]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        const exName = parts[0].replace(/^[\d\.\)\-]+\s*/, '').trim();
        const setsVal = parseInt(parts[1], 10) || 3;
        const repsVal = parts[2] || '8-12';
        const rpeVal = parts[3] || '8';
        const restInfo = parseRestToSeconds(parts[4] || '90 seg');
        const notesVal = parts.slice(5).join(' - ');

        if (exName.length >= 2) {
          rows.push({
            Dia: currentDay,
            Rutina: currentRoutineTitle,
            Enfoque: currentEnfoque,
            Orden: orderIndex++,
            Ejercicio: exName,
            Ejercicio_Principal: exName,
            Series: Math.min(Math.max(setsVal, 1), 6),
            Repeticiones: repsVal,
            RPE: rpeVal,
            DESCANSO: restInfo.restText,
            DescansoSegundos: restInfo.restSeconds,
            Notas: notesVal,
            Musculo: canonicalizeMuscleGroup('', exName),
          });
          continue;
        }
      }
    }

    let sets = 3;
    let reps = '8-12';

    const setsMatch =
      cleanLine.match(/(\d+)\s*(?:sets|series|s)\b/i) || cleanLine.match(/(\d+)\s*[xX×]/i);
    if (setsMatch) {
      sets = parseInt(setsMatch[1], 10) || 3;
    }

    const repsMatch =
      cleanLine.match(/(\d+\s*[\-\–]\s*\d+)\s*(?:reps|repeticiones|r)?/i) ||
      cleanLine.match(/[xX×]\s*(\d+(?:\s*[\-\–]\s*\d+)?)/i) ||
      cleanLine.match(/(\d+)\s*(?:reps|repeticiones|r)\b/i);
    if (repsMatch) {
      reps = repsMatch[1].replace(/\s+/g, '');
    }

    let exerciseName = cleanLine
      .replace(/[\(\[\{].*?[\)\]\}]/g, '')
      .replace(/\d+\s*(?:sets|series|s)\b/gi, '')
      .replace(/\d+(?:\s*[\-\–]\s*\d+)?\s*(?:reps|repeticiones|r)\b/gi, '')
      .replace(/\d+\s*[xX×]\s*\d+(?:\s*[\-\–]\s*\d+)?/gi, '')
      .trim();

    if (exerciseName.length < 2) exerciseName = cleanLine;

    rows.push({
      Dia: currentDay,
      Rutina: currentRoutineTitle,
      Enfoque: currentEnfoque,
      Orden: orderIndex++,
      Ejercicio: exerciseName,
      Ejercicio_Principal: exerciseName,
      Series: Math.min(Math.max(sets, 1), 6),
      Repeticiones: reps,
      RPE: '8',
      DESCANSO: '90 seg',
      DescansoSegundos: 90,
      Musculo: canonicalizeMuscleGroup('', exerciseName),
    });
  }

  if (rows.length === 0) {
    throw new Error(
      'No se pudieron extraer ejercicios legibles del documento. Asegúrate de que contenga los nombres de los ejercicios.'
    );
  }

  return parseGymCsvData(rows);
}
