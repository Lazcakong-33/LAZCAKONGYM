import { getGeminiModel, getServerGeminiApiKey } from './geminiModel.ts';
import { GoogleGenAI, Type } from '@google/genai';

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

const ALLOWED_VISION_DOCUMENT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
]);

export interface RoutineImageInput {
  data: string; // base64 string (with or without data:...;base64, prefix)
  mimeType: string;
  fileName?: string;
}

export interface VisionExtractionParams {
  file?: string;
  data?: string;
  mimeType?: string;
  prompt?: string;
  images?: RoutineImageInput[];
}

export interface OcrExtractedExerciseRaw {
  rawName: string;
  normalizedName?: string;
  targetMuscles?: string | null;
  sets?: number | null;
  reps?: string | null;
  weightKg?: number | null;
  restSeconds?: number | null;
  restText?: string | null;
  rpe?: string | null;
  notes?: string | null;
  order?: number | null;
  sourceImageIndex: number;
  needsReview: boolean;
  unrecognizedFields: string[];
  reviewReason?: string;
}

export interface OcrExtractedDayRaw {
  dayName: string;
  routineTitle: string;
  sourceImageIndices: number[];
  needsReview: boolean;
  reviewReason?: string;
  exercises: OcrExtractedExerciseRaw[];
}

export interface AnalyzeRoutineImagesResult {
  detectedDays: OcrExtractedDayRaw[];
  detectedFormat: string;
  warnings: string[];
  imageCount: number;
}

function normalizeVisionMimeType(mimeType: string | undefined, rawData: string): string {
  const prefixMatch = rawData.match(/^data:([^;]+);base64,/i);
  const detected = (prefixMatch?.[1] || mimeType || '').trim().toLowerCase();
  if (detected === 'image/jpg') return 'image/jpeg';
  if (ALLOWED_VISION_DOCUMENT_MIME_TYPES.has(detected)) return detected;
  throw new Error(
    `Formato no compatible para visión (${detected || 'desconocido'}). Usa PDF, PNG, JPG/JPEG o WEBP.`
  );
}

function stripBase64Prefix(rawData: string): string {
  if (!rawData) return '';
  const idx = rawData.indexOf('base64,');
  return idx !== -1 ? rawData.slice(idx + 7).trim() : rawData.trim();
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = getServerGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada en el servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Analiza una o múltiples capturas de pantalla, fotografías (PNG, JPG/JPEG, WEBP) o documentos PDF
 * mediante visión OCR multimodal sin inventar datos faltantes ni auto-guardar.
 */
export async function analyzeRoutineImagesWithVision(
  inputs: RoutineImageInput[]
): Promise<AnalyzeRoutineImagesResult> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('Debes adjuntar al menos un archivo (PDF, PNG, JPG/JPEG o WEBP).');
  }

  if (inputs.length > 10) {
    throw new Error('Máximo 10 archivos por análisis para asegurar precisión.');
  }

  const ai = getGeminiClient();

  const mediaParts = inputs.map((item, idx) => {
    const cleanMime = normalizeVisionMimeType(item.mimeType, item.data);
    const cleanBase64 = stripBase64Prefix(item.data);
    if (!cleanBase64 || cleanBase64.length < 32) {
      throw new Error(`El archivo #${idx + 1} (${item.fileName || 'documento'}) está vacío o dañado.`);
    }
    return {
      inlineData: {
        data: cleanBase64,
        mimeType: cleanMime,
      },
    };
  });

  const isPdfBatch = inputs.some((item) =>
    normalizeVisionMimeType(item.mimeType, item.data) === 'application/pdf'
  );

  const manifestList = inputs
    .map((item, i) => `- Archivo índice ${i}: ${item.fileName || `archivo_${i + 1}`}`)
    .join('\n');

  const promptText = `
Analiza minuciosamente ${inputs.length} ${isPdfBatch ? 'documento(s) PDF / captura(s)' : 'captura(s)'} de entrenamiento correspondientes a un mismo plan o rutina:
${manifestList}

REGLAS ESTRICTAS DE EXTRACCIÓN OCR Y TABLAS (NIVEL ELITE PERFORMANCE):
1. Detecta tablas de PDF, hojas Excel exportadas a PDF, capturas de apps (Hevy, Strong, FitNotes, Notion), notas de móvil, mensajes de WhatsApp, documentos impresos o rutinas manuscritas.
2. Extrae exactamente lo que aparece visible para cada día o sesión respetando el orden de ejecución:
   - dayName: Día de la semana ("Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo", o "Día 1", etc. si aparece numerado). Si NO aparece día visible, escribe exactamente "pendiente de revisión" y añade "dayName" a unrecognizedFields.
   - routineTitle: Título del bloque o sesión visible (ej. "EMPUJE A", "PIERNA - CUÁDRICEPS"). Si no aparece, escribe "" o "pendiente de revisión".
   - Por cada ejercicio visible en la tabla o lista:
     * rawName: Texto literal del nombre del ejercicio en el archivo/imagen. Si el texto está cortado, borroso o ilegible, pon "" o la parte legible + " [pendiente de revisión]" y marca needsReview=true y "name" en unrecognizedFields.
     * normalizedName: Nombre limpio en español (sin inventar implementos ni cambiar el movimiento real).
     * order: Número de orden de ejecución (1, 2, 3...) tal como aparece en la lista/tabla.
     * targetMuscles: Grupo muscular explícito si aparece en el documento (Pectoral, Dorsal, Deltoides, Biceps, Triceps, Cuadriceps, Isquiotibiales, Gluteos, Gemelos, Abdomen, Aductores). Si no aparece ni puede determinarse con certeza, déjalo null.
     * sets: Entero con el número de series si es visible y legible (ej. 4 en "4x10" o columna Series=4). Si es ilegible o no aparece, pon null y añade "sets" a unrecognizedFields (NO inventes 3 por defecto).
     * reps: Texto o rango de repeticiones visibles (ej. "8-12", "10", "12/10/8", "AMRAP"). Si es ilegible o no aparece, pon "pendiente de revisión" y añade "reps" a unrecognizedFields (NO inventes "8-12").
     * weightKg: Peso numérico en kg ÚNICAMENTE si aparece explícito para ese ejercicio (ej. "80 kg" -> 80). Si el plan no incluye pesos, déjalo null sin marcar error. Si HAY un peso escrito pero está borroso/cortado, pon null y añade "weightKg" a unrecognizedFields.
     * restSeconds: Entero en segundos si el descanso está visible (ej. "90s" -> 90, "2 min" -> 120, "1:30" -> 90). Si no aparece descanso visible o es ilegible, pon null y añade "restSeconds" a unrecognizedFields (NO inventes 90s).
     * restText: Texto original del descanso tal como aparece (o null si no aparece).
     * rpe: Valor de RPE o RIR si aparece (o null).
     * notes: Estrategia, tempo, indicaciones o notas visibles (o null).
     * sourceImageIndex: Índice 0-based del archivo de origen.
     * needsReview: true si falta algún dato clave o hay texto dudoso/borroso/cortado.
     * unrecognizedFields: Lista exacta de campos dudosos o ilegibles (ej. ["name", "sets", "reps", "restSeconds", "weightKg", "dayName"]).
     * reviewReason: Breve motivo en español si needsReview es true (ej. "Descanso no visible", "Texto borroso en columna de repeticiones").

3. PROHIBIDO INVENTAR DATOS: Nunca completes valores ausentes ni adivines palabras borrosas. Todo lo no reconocible debe marcarse para revisión del atleta.
4. MULTI-CAPTURA / MULTI-PÁGINA: Respeta el orden de arriba a abajo y por páginas. Si un ejercicio se repite por solapamiento entre capturas, conserva su sourceImageIndex para que el sistema los unifique sin duplicarlos.
`.trim();

  const contents = [
    ...mediaParts,
    { text: promptText },
  ];

  const response = await ai.models.generateContent({
    model: getGeminiModel(),
    contents,
    config: {
      systemInstruction:
        'Eres el sistema de extracción documental y visión OCR de LAZCAKONGYM. Extraes tablas de PDF, listas y planificaciones desde imágenes con fidelidad absoluta al contenido visible. NUNCA inventas datos ausentes o ilegibles; cuando algo no se puede leer o no aparece, lo marcas explícitamente para revisión humana.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          detectedFormat: {
            type: Type.STRING,
            description: 'Formato detectado (ej. Tabla PDF, Tabla Excel, App Hevy/Strong, Notas de texto, WhatsApp, Foto impresa, Manuscrita)',
          },
          warnings: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          detectedDays: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                dayName: { type: Type.STRING },
                routineTitle: { type: Type.STRING },
                sourceImageIndices: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                },
                needsReview: { type: Type.BOOLEAN },
                reviewReason: { type: Type.STRING },
                exercises: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      rawName: { type: Type.STRING },
                      normalizedName: { type: Type.STRING },
                      order: { type: Type.INTEGER, nullable: true },
                      targetMuscles: { type: Type.STRING, nullable: true },
                      sets: { type: Type.INTEGER, nullable: true },
                      reps: { type: Type.STRING, nullable: true },
                      weightKg: { type: Type.NUMBER, nullable: true },
                      restSeconds: { type: Type.INTEGER, nullable: true },
                      restText: { type: Type.STRING, nullable: true },
                      rpe: { type: Type.STRING, nullable: true },
                      notes: { type: Type.STRING, nullable: true },
                      sourceImageIndex: { type: Type.INTEGER },
                      needsReview: { type: Type.BOOLEAN },
                      unrecognizedFields: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      reviewReason: { type: Type.STRING },
                    },
                    required: [
                      'rawName',
                      'sourceImageIndex',
                      'needsReview',
                      'unrecognizedFields',
                    ],
                  },
                },
              },
              required: ['dayName', 'routineTitle', 'exercises', 'needsReview'],
            },
          },
        },
        required: ['detectedFormat', 'detectedDays'],
      },
    },
  });

  if (!response.text) {
    throw new Error('No se obtuvo respuesta legible del análisis del documento. Intenta con un archivo o captura más nítida.');
  }

  const parsed = JSON.parse(response.text) as {
    detectedFormat?: string;
    warnings?: string[];
    detectedDays?: OcrExtractedDayRaw[];
  };

  return {
    detectedFormat: parsed.detectedFormat || (isPdfBatch ? 'Documento PDF' : 'Captura de rutina'),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    detectedDays: Array.isArray(parsed.detectedDays) ? parsed.detectedDays : [],
    imageCount: inputs.length,
  };
}

/**
 * Compatibilidad con el endpoint legacy `/api/extraer-rutina-ia`.
 * Soporta tanto texto plano como imágenes (`params.file` o `params.data`) usando `gemini-4-hydrogen`.
 */
export async function extractRoutineWithVision(params: VisionExtractionParams) {
  if (Array.isArray(params.images) && params.images.length > 0) {
    return analyzeRoutineImagesWithVision(params.images);
  }

  const rawPayload = params.file || params.data || '';
  if (!rawPayload) {
    throw new Error('No se recibió archivo o texto para extraer la rutina.');
  }

  const mime = (params.mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) {
    const analysis = await analyzeRoutineImagesWithVision([
      { data: rawPayload, mimeType: mime },
    ]);
    return {
      analysis,
      routines: analysis.detectedDays.map((day, idx) => ({
        id: `rutina-ocr-${idx + 1}`,
        title: day.routineTitle || day.dayName,
        dayName: day.dayName,
        tagline: `${day.exercises.length} ejercicios detectados`,
        exercises: day.exercises.map((ex, exIdx) => ({
          id: `ex-ocr-${idx + 1}-${exIdx + 1}`,
          name: ex.normalizedName || ex.rawName || 'pendiente de revisión',
          targetMuscles: ex.targetMuscles || 'pendiente de revisión',
          defaultSets: ex.sets ?? 0,
          repRange: ex.reps || 'pendiente de revisión',
          restSeconds: ex.restSeconds ?? 0,
          defaultWeight: ex.weightKg ?? undefined,
          notes: ex.notes || undefined,
          needsReview: ex.needsReview,
          unrecognizedFields: ex.unrecognizedFields,
          reviewReason: ex.reviewReason,
        })),
      })),
    };
  }

  const ai = getGeminiClient();
  const base64Data = stripBase64Prefix(rawPayload);
  const promptText =
    params.prompt ||
    'Extrae esta rutina de entrenamiento respetando exactamente todos los días, ejercicios, series, repeticiones, pesos y descansos visibles sin inventar valores.';

  const parts: any[] =
    mime === 'text/plain'
      ? [{ text: `${promptText}\n\nCONTENIDO:\n${rawPayload}` }]
      : [
          {
            inlineData: {
              data: base64Data,
              mimeType: params.mimeType || 'application/pdf',
            },
          },
          { text: promptText },
        ];

  const response = await ai.models.generateContent({
    model: getGeminiModel(),
    contents: parts,
    config: {
      systemInstruction:
        'Eres el analista de rutinas de LAZCAKONGYM. Extrae con precisión los días, ejercicios, series, repeticiones, pesos y descansos reales sin inventar datos.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          routines: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                tagline: { type: Type.STRING },
                dayName: { type: Type.STRING },
                exercises: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      name: { type: Type.STRING },
                      targetMuscles: { type: Type.STRING },
                      defaultSets: { type: Type.INTEGER },
                      repRange: { type: Type.STRING },
                      restSeconds: { type: Type.INTEGER },
                      objective: { type: Type.STRING },
                      equipment: { type: Type.STRING },
                      techniqueCues: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                    },
                    required: ['name', 'defaultSets', 'repRange', 'restSeconds'],
                  },
                },
              },
              required: ['title', 'exercises'],
            },
          },
        },
        required: ['routines'],
      },
    },
  });

  if (!response.text) {
    throw new Error('No se pudo extraer información estructurada del documento.');
  }

  return JSON.parse(response.text);
}
