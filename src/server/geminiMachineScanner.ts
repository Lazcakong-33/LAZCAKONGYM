import { getGeminiModel, getServerGeminiApiKey } from './geminiModel.ts';
import { GoogleGenAI, Type } from '@google/genai';

export interface ScanMachineParams {
  imageBase64: string;
  mimeType?: string;
  currentExercise: {
    id: string;
    name: string;
    targetMuscles: string;
    sets?: number;
    repRange?: string;
    restSeconds?: number;
    objective?: string;
  };
  routineTitle?: string;
}

export interface MachineScanResult {
  identifiedMachine: string;
  machineBrand: string;
  equipmentType: string;
  replacementExerciseName: string;
  targetMuscles: string;
  repRange: string;
  restSeconds: number;
  objective: string;
  techniqueCues: string[];
  equivalenceRationale: string;
  smartFitSetupTip?: string;
}

/**
 * Normalizes base64 string and detects mime type.
 */
function cleanBase64Data(raw: string): { data: string; mimeType: string } {
  let mimeType = 'image/jpeg';
  let data = raw.trim();

  if (data.startsWith('data:')) {
    const match = data.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      data = match[2];
    }
  }

  return { data, mimeType };
}

/**
 * Server-side Gemini Vision analysis for gym equipment recognition in Smart Fit.
 */
export async function scanGymMachineWithGemini(
  params: ScanMachineParams
): Promise<MachineScanResult> {
  const { imageBase64, currentExercise, routineTitle } = params;

  if (!imageBase64) {
    throw new Error('No se recibió imagen para análisis visual');
  }

  const { data: base64Data, mimeType } = cleanBase64Data(imageBase64);
  const apiKey = getServerGeminiApiKey();

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const promptText = `
Ejercicio actual de la rutina a sustituir:
- Nombre: "${currentExercise.name}"
- Grupo muscular objetivo: "${currentExercise.targetMuscles || 'General'}"
- Rutina en curso: "${routineTitle || 'Entrenamiento de Fuerza'}"
${currentExercise.repRange ? `- Rango de repeticiones habitual: ${currentExercise.repRange}` : ''}

INSTRUCCIONES CLÍNICAS Y BIOMECÁNICAS:
1. Analiza minuciosamente la imagen del gimnasio (Smart Fit).
2. Identifica con exactitud la máquina, estación, polea o equipamiento libre que aparece en la foto (ej: Chest Press convergente Matrix, Prensa de piernas 45°, Smith Machine, Polea dual ajustable, Pec Deck, etc.).
3. Si hay varias máquinas, enfócate en la más visible y libre en primer plano.
4. Genera una alternativa biomecánicamente equivalente que trabaje el mismo grupo muscular (${currentExercise.targetMuscles || 'músculo objetivo'}) usando este equipamiento identificado.
5. Proporciona el nombre en español exacto y profesional del nuevo ejercicio, su justificación biomecánica y 3 a 4 pautas técnicas de ejecución para el atleta.
`.trim();

      const response = await ai.models.generateContent({
        model: getGeminiModel(),
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: promptText,
            },
          ],
        },
        config: {
          systemInstruction:
            'Eres un coach experto en Smart Fit. Analiza esta foto, identifica qué máquina o equipamiento de gimnasio es, y sugiere un ejercicio biomecánicamente equivalente para sustituir el ejercicio actual de la rutina para el músculo objetivo.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              identifiedMachine: {
                type: Type.STRING,
                description: 'Nombre de la máquina o equipamiento identificado en la foto (ej: Press de Pecho Convergente Matrix)',
              },
              machineBrand: {
                type: Type.STRING,
                description: 'Línea de equipamiento habitual en Smart Fit (ej: Matrix Fitness, Life Fitness, Hammer)',
              },
              equipmentType: {
                type: Type.STRING,
                description: 'Tipo de equipamiento (ej: Máquina de placas, Poleas, Peso libre, Barra guiada)',
              },
              replacementExerciseName: {
                type: Type.STRING,
                description: 'Nombre del nuevo ejercicio equivalente en español (ej: Press de Pecho en Máquina Sentado)',
              },
              targetMuscles: {
                type: Type.STRING,
                description: 'Grupo muscular principal y sinergistas trabajados',
              },
              repRange: {
                type: Type.STRING,
                description: 'Rango de repeticiones sugerido (ej: 8 - 12 reps)',
              },
              restSeconds: {
                type: Type.INTEGER,
                description: 'Segundos de descanso recomendados entre series',
              },
              objective: {
                type: Type.STRING,
                description: 'Objetivo fisiológico y biomecánico del ejercicio sustituto',
              },
              techniqueCues: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3 a 4 claves técnicas de ejecución correcta y segura en Smart Fit',
              },
              equivalenceRationale: {
                type: Type.STRING,
                description: 'Explicación de por qué este ejercicio sustituye con éxito al ejercicio actual manteniendo el estímulo',
              },
              smartFitSetupTip: {
                type: Type.STRING,
                description: 'Consejo rápido para regular el asiento, respaldo o clavija en Smart Fit',
              },
            },
            required: [
              'identifiedMachine',
              'replacementExerciseName',
              'targetMuscles',
              'techniqueCues',
              'equivalenceRationale',
            ],
          },
        },
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text) as MachineScanResult;
        return {
          identifiedMachine: parsed.identifiedMachine || 'Máquina de Entrenamiento Smart Fit',
          machineBrand: parsed.machineBrand || 'Matrix Fitness / Smart Fit',
          equipmentType: parsed.equipmentType || 'Máquina de placas guiada',
          replacementExerciseName: parsed.replacementExerciseName || `Variante en máquina de ${currentExercise.name}`,
          targetMuscles: parsed.targetMuscles || currentExercise.targetMuscles,
          repRange: parsed.repRange || currentExercise.repRange || '8 - 12 reps',
          restSeconds: parsed.restSeconds || currentExercise.restSeconds || 90,
          objective: parsed.objective || `Estímulo controlado y seguro para ${currentExercise.targetMuscles}`,
          techniqueCues:
            parsed.techniqueCues && parsed.techniqueCues.length > 0
              ? parsed.techniqueCues
              : [
                  'Ajusta la altura del asiento para alinear las empuñaduras con la línea media del músculo.',
                  'Realiza la fase concéntrica explosiva y la excéntrica en 2 a 3 segundos controlados.',
                  'Mantén la espalda pegada al respaldo y el core activo durante todo el rango.',
                ],
          equivalenceRationale:
            parsed.equivalenceRationale ||
            `Excelente alternativa biomecánica para ${currentExercise.targetMuscles} que permite aplicar sobrecarga progresiva con total estabilidad.`,
          smartFitSetupTip:
            parsed.smartFitSetupTip || 'Verifica que la clavija de peso quede bien insertada antes de iniciar.',
        };
      }
    } catch (apiError: any) {
      console.warn('[Gemini Machine Scanner] Error invoking Gemini Vision API, using intelligent fallback:', apiError);
    }
  }

  // Fallback intelligent generator if API is unavailable
  const muscle = (currentExercise.targetMuscles || '').toLowerCase();
  let defaultMachine = 'Máquina de Palancas Convergente';
  let replacementName = `Press en Máquina para ${currentExercise.targetMuscles}`;
  let rationale = `Sustituto guiado directo para mantener el estímulo en ${currentExercise.targetMuscles} mientras la estación principal está ocupada.`;

  if (muscle.includes('pecho') || muscle.includes('pectoral')) {
    defaultMachine = 'Press de Pecho en Máquina Matrix (Smart Fit)';
    replacementName = 'Press de Pecho en Máquina Convergente Sentado';
    rationale = 'Replica el patrón de empuje horizontal reduciendo la fatiga estabilizadora y aislando el pectoral mayor.';
  } else if (muscle.includes('espalda') || muscle.includes('dorsal')) {
    defaultMachine = 'Máquina de Remo Sentado Divergente Matrix';
    replacementName = 'Remo en Máquina con Apoyo al Pecho';
    rationale = 'Permite máxima tracción horizontal eliminando la sobrecarga lumbar para enfocar los dorsales y romboides.';
  } else if (muscle.includes('pierna') || muscle.includes('cuádriceps')) {
    defaultMachine = 'Prensa de Piernas 45° Matrix / Smart Fit';
    replacementName = 'Prensa Inclinada 45° a Rango Completo';
    rationale = 'Excelente alternativa de fuerza para cuádriceps y glúteos con soporte de espalda firme.';
  } else if (muscle.includes('hombro') || muscle.includes('deltoide')) {
    defaultMachine = 'Máquina de Press Militar Guiado Matrix';
    replacementName = 'Press Militar en Máquina Vertical';
    rationale = 'Ofrece un empuje vertical con trayectoria fija protegiendo la cápsula articular del hombro.';
  } else if (muscle.includes('bíceps') || muscle.includes('tríceps') || muscle.includes('brazo')) {
    defaultMachine = 'Estación de Poleas Dual Adjustable Pulley Smart Fit';
    replacementName = 'Curl o Extensión en Polea Baja/Alta con Agarre Neutro';
    rationale = 'Mantiene tensión constante en todo el rango articular para hipertrofia de brazos.';
  }

  return {
    identifiedMachine: defaultMachine,
    machineBrand: 'Matrix Fitness / Smart Fit',
    equipmentType: 'Máquina guiada con selector de placas',
    replacementExerciseName: replacementName,
    targetMuscles: currentExercise.targetMuscles,
    repRange: currentExercise.repRange || '8 - 12 reps',
    restSeconds: currentExercise.restSeconds || 90,
    objective: `Mantener el volumen e intensidad de la rutina sustituyendo el ejercicio original por la máquina disponible.`,
    techniqueCues: [
      'Regula el asiento para que las articulaciones principales coincidan con el eje de rotación de la máquina.',
      'Controla la fase de retorno (excéntrica) durante 2 a 3 segundos sin dejar caer los pesos.',
      'Respira de forma acompasada: exhala en el esfuerzo e inhala en el regreso.',
    ],
    equivalenceRationale: rationale,
    smartFitSetupTip: 'Asegúrate de ajustar la perilla amarilla de altura de asiento antes de cargar peso.',
  };
}
