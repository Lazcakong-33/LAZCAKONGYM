import { getGeminiModel } from './geminiModel.ts';
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Routine, Exercise } from '../types/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let exerciseLibrary: any[] = [];
try {
  const libPath = path.resolve(__dirname, '../data/exerciseLibrary.json');
  if (fs.existsSync(libPath)) {
    exerciseLibrary = JSON.parse(fs.readFileSync(libPath, 'utf8'));
  }
} catch (e) {
  console.warn('[Gemini Routine Generator] Could not load exerciseLibrary.json, using default fallback pool', e);
}

// Fallback default exercises if library is empty
if (!exerciseLibrary || exerciseLibrary.length === 0) {
  exerciseLibrary = [
    { name: 'Press de Banca Plano con Barra', muscleGroup: 'Pecho', equipment: 'Barra' },
    { name: 'Sentadilla Libre con Barra', muscleGroup: 'Pierna', equipment: 'Barra' },
    { name: 'Dominadas en Barra Fixa', muscleGroup: 'Espalda', equipment: 'Peso corporal' },
    { name: 'Press Militar de Hombros con Barra', muscleGroup: 'Hombro', equipment: 'Barra' },
    { name: 'Curl de Bíceps con Mancuernas', muscleGroup: 'Bíceps', equipment: 'Mancuerna' },
    { name: 'Extensiones de Tríceps en Polea', muscleGroup: 'Tríceps', equipment: 'Polea' },
    { name: 'Elevaciones Laterales de Hombro', muscleGroup: 'Hombro', equipment: 'Mancuerna' },
    { name: 'Peso Muerto Convencional', muscleGroup: 'Pierna', equipment: 'Barra' },
  ];
}

export const FITNESS_GOAL_GUIDELINES: Record<
  string,
  {
    name: string;
    repRange: string;
    restRange: string;
    restSecondsDefault: number;
    caloricFocus: string;
    details: string;
  }
> = {
  fuerza_maxima: {
    name: 'Fuerza Máxima',
    repRange: '1 a 5 reps',
    restRange: '3 a 5 min',
    restSecondsDefault: 240,
    caloricFocus: 'Superávit o Mantenimiento',
    details: '1 a 5 reps (85-100% 1RM), descanso 3 a 5 min (180-300 s), enfoque calórico: Superávit o Mantenimiento.',
  },
  fuerza: {
    name: 'Fuerza Máxima',
    repRange: '1 a 5 reps',
    restRange: '3 a 5 min',
    restSecondsDefault: 240,
    caloricFocus: 'Superávit o Mantenimiento',
    details: '1 a 5 reps (85-100% 1RM), descanso 3 a 5 min (180-300 s), enfoque calórico: Superávit o Mantenimiento.',
  },
  potencia: {
    name: 'Potencia / Explosividad',
    repRange: '3 a 6 reps (rápidas)',
    restRange: '2 a 3 min',
    restSecondsDefault: 150,
    caloricFocus: 'Mantenimiento',
    details: '3 a 6 reps (rápidas / explosivas), descanso 2 a 3 min (120-180 s), enfoque calórico: Mantenimiento.',
  },
  hipertrofia: {
    name: 'Hipertrofia (Volumen)',
    repRange: '6 a 12 reps',
    restRange: '1.5 a 3 min',
    restSecondsDefault: 120,
    caloricFocus: 'Superávit calórico (+ calorías)',
    details: '6 a 12 reps (tensión mecánica RIR 1-2), descanso 1.5 a 3 min (90-180 s), enfoque: Superávit calórico (+ calorías).',
  },
  definicion: {
    name: 'Definición (Pérdida de Grasa)',
    repRange: '8 a 15 reps',
    restRange: '1 a 2 min',
    restSecondsDefault: 75,
    caloricFocus: 'Déficit calórico (- calorías)',
    details: '8 a 15 reps, descanso 1 a 2 min (60-120 s), enfoque calórico: Déficit calórico (- calorías).',
  },
  recomposicion: {
    name: 'Recomposición Corporal',
    repRange: '6 a 12 reps',
    restRange: '1.5 a 2.5 min',
    restSecondsDefault: 90,
    caloricFocus: 'Normocalórico (Mantenimiento)',
    details: '6 a 12 reps pesadas, descanso 1.5 a 2.5 min (90-150 s), enfoque calórico: Normocalórico (Mantenimiento).',
  },
  resistencia: {
    name: 'Resistencia Muscular',
    repRange: '15 a 25+ reps',
    restRange: '30 a 60 seg',
    restSecondsDefault: 45,
    caloricFocus: 'Mantenimiento',
    details: '15 a 25+ reps (fallo metabólico), descanso 30 a 60 seg (30-60 s), enfoque calórico: Mantenimiento.',
  },
};

export interface RoutineGenerationParams {
  experienceLevel: 'principiante' | 'intermedio' | 'avanzado';
  equipment: 'gimnasio_completo' | 'mancuernas' | 'peso_corporal' | 'barra_discos' | 'poleas' | 'bandas';
  focus: 'full_body' | 'torso' | 'piernas' | 'empuje' | 'tiron' | 'core';
  durationMinutes: number;
  goal: 'fuerza_maxima' | 'potencia' | 'hipertrofia' | 'definicion' | 'recomposicion' | 'resistencia' | string;
  athleteName?: string;
}

function sanitizeRepRangeServer(name: string, repRange: string, goal: string): string {
  const isIso = /extensi[oó]n|curl|elevaci[oó]n|apertura|pec deck|cruce|fly|patada|gemelo|pantorrilla|calf|abductor|aductor|crunch|shrug/i.test(name);
  if (isIso) {
    const numbers = repRange.match(/\d+/g);
    if (numbers && numbers.some((n) => parseInt(n, 10) < 8)) {
      return '10 a 15 reps';
    }
    return repRange;
  }
  if (goal === 'hipertrofia') {
    const numbers = repRange.match(/\d+/g);
    if (numbers && numbers.every((n) => parseInt(n, 10) <= 5)) {
      return '6 a 10 reps';
    }
  }
  return repRange;
}

export async function generateAIRoutine(params: RoutineGenerationParams): Promise<Routine> {
  const { experienceLevel, equipment, focus, durationMinutes, goal, athleteName } = params;
  const goalInfo = FITNESS_GOAL_GUIDELINES[goal] || FITNESS_GOAL_GUIDELINES.hipertrofia;

  // Attempt 1: Call Gemini API from server if API key is available
  const apiKey = process.env.GEMINI_API_KEY;
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

      const prompt = `Actúa como el Head Coach de Élite de LAZCAKONGYM.
Genera una sesión de entrenamiento basada en ciencias del deporte y fitness de ${durationMinutes} minutos.
Perfil del Atleta:
- Nombre: ${athleteName || 'Atleta'}
- Nivel de experiencia: ${experienceLevel}
- Equipamiento disponible: ${equipment}
- Enfoque muscular: ${focus}
- Tipo de Rutina / Objetivo Fitness: ${goalInfo.name}

REGLAS CIENTÍFICAS ESTRICTAS PARA ESTA MODALIDAD:
- Modalidad: ${goalInfo.name}
- Rango de Repeticiones Base: ${goalInfo.repRange}
- Descanso Entre Series OBLIGATORIO: ${goalInfo.restRange} (${goalInfo.restSecondsDefault} segundos exactos por serie)
- Enfoque Calórico Recomendado: ${goalInfo.caloricFocus}
- Detalle Fisiológico: ${goalInfo.details}
- REGLA DE DOBLE PROGRESIÓN Y CATEGORÍAS: En Hipertrofia o ejercicios de aislamiento/analíticos (extensiones de cuádriceps, curl femoral, curls de bíceps, elevaciones laterales, aperturas, tríceps en polea, etc.), trabajar bajo rangos de 8-12 o 10-15 reps (NUNCA 1-5 reps). Limitar 1-5 reps estrictamente a mesociclos de fuerza máxima o básicos multiarticulares pesados.

Requisitos de la sesión:
- Entre 4 y 7 ejercicios acordes a la duración de ${durationMinutes} min.
- Series: 3 a 5 series por ejercicio según nivel del atleta.
- Repeticiones: Para ejercicios compuestos usar el rango de la modalidad; para ejercicios analíticos o de aislamiento asignar obligatoriamente entre 8 y 15 repeticiones (ej. 8-12 o 10-15 reps).
- Descansos: asignar el valor numérico en restSeconds (${goalInfo.restSecondsDefault} s).
- Pautas técnicas claras y concisas (techniqueCues).
- Nombres de ejercicios reales en español.`;

      const response = await ai.models.generateContent({
        model: getGeminiModel(),
        contents: prompt,
        config: {
          systemInstruction:
            'Eres el Head Coach de LAZCAKONGYM. Devuelves únicamente la rutina en formato JSON válido estructurado.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              tagline: { type: Type.STRING },
              dayName: { type: Type.STRING },
              exercises: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    targetMuscles: { type: Type.STRING },
                    defaultSets: { type: Type.INTEGER },
                    repRange: { type: Type.STRING },
                    restSeconds: { type: Type.INTEGER },
                    objective: { type: Type.STRING },
                    techniqueCues: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: [
                    'name',
                    'targetMuscles',
                    'defaultSets',
                    'repRange',
                    'restSeconds',
                    'objective',
                    'techniqueCues',
                  ],
                },
              },
            },
            required: ['title', 'tagline', 'exercises'],
          },
        },
      });

      if (response.text) {
        const parsed = JSON.parse(response.text);
        if (parsed.exercises && Array.isArray(parsed.exercises) && parsed.exercises.length > 0) {
          const routineId = `rutina-ia-${Date.now()}`;
          return {
            id: routineId,
            dayName: parsed.dayName || 'Personalizada',
            title: parsed.title || `Rutina IA: ${focus.toUpperCase()}`,
            tagline: parsed.tagline || `${goalInfo.name} · ${goalInfo.repRange} · Descanso ${goalInfo.restRange}`,
            banner: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80',
            accentColor: '#f59e0b',
            isCustom: true,
            modality: goal,
            modalityName: goalInfo.name,
            targetRepRange: goalInfo.repRange,
            restRange: goalInfo.restRange,
            caloricFocus: goalInfo.caloricFocus,
            exercises: parsed.exercises.map((ex: any, idx: number) => {
              const baseRange = String(ex.repRange || goalInfo.repRange);
              const safeRange = sanitizeRepRangeServer(ex.name, baseRange, goal);
              return {
                id: `ex-ia-${Date.now()}-${idx}`,
                name: ex.name,
                targetMuscles: ex.targetMuscles || 'Torso',
                defaultSets: Number(ex.defaultSets) || 3,
                repRange: safeRange,
                restSeconds: Number(ex.restSeconds) || goalInfo.restSecondsDefault,
                restText: `${Number(ex.restSeconds) || goalInfo.restSecondsDefault} s`,
                objective: ex.objective || goalInfo.name,
                defaultVideoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(ex.name + ' tecnica')}`,
                techniqueCues:
                  ex.techniqueCues && ex.techniqueCues.length > 0
                    ? ex.techniqueCues
                    : ['Control excéntrico en 2 segundos', 'Máxima contracción concéntrica'],
              };
            }),
          };
        }
      }
    } catch (err: any) {
      console.warn('[Gemini Routine Generator] Gemini API returned error, activating smart exercise engine:', err.message);
    }
  }

  // Fallback: Smart Science-Based Generator using the exercise library
  return buildSmartFallbackRoutine(params);
}

function buildSmartFallbackRoutine(params: RoutineGenerationParams): Routine {
  const { experienceLevel, equipment, focus, durationMinutes, goal, athleteName } = params;

  // Filter exercises from our 1,024 exercise library
  const muscleKeywords: Record<string, string[]> = {
    torso: ['Pecho', 'Espalda', 'Hombro', 'Bíceps', 'Tríceps'],
    piernas: ['Pierna', 'Glúteos'],
    full_body: ['Pecho', 'Espalda', 'Pierna', 'Hombro', 'Abdomen', 'Glúteos'],
    empuje: ['Pecho', 'Hombro', 'Tríceps'],
    tiron: ['Espalda', 'Bíceps', 'Antebrazo'],
    core: ['Abdomen'],
  };

  const targetMuscles = muscleKeywords[focus] || muscleKeywords.full_body;

  const equipmentKeywords: Record<string, string[]> = {
    gimnasio_completo: ['Barra', 'Mancuerna', 'Polea', 'Máquina', 'Multipower', 'Peso corporal'],
    mancuernas: ['Mancuerna', 'Peso corporal', 'Banda elástica'],
    peso_corporal: ['Peso corporal', 'Barra de dominadas'],
    barra_discos: ['Barra', 'Peso corporal'],
    poleas: ['Polea', 'Peso corporal'],
    bandas: ['Banda elástica', 'Peso corporal'],
  };

  const targetEquip = equipmentKeywords[equipment] || ['Mancuerna', 'Peso corporal'];

  const candidates = (exerciseLibrary as any[]).filter((ex) => {
    const matchesMuscle = targetMuscles.includes(ex.muscleGroup);
    const matchesEquip = targetEquip.includes(ex.equipment) || ex.equipment === 'General';
    return matchesMuscle && matchesEquip;
  });

  const pool = candidates.length >= 4 ? candidates : exerciseLibrary;

  // Determine exercise count based on duration
  const exerciseCount = Math.max(4, Math.min(7, Math.floor(durationMinutes / 10)));
  const shuffled = [...pool].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, exerciseCount);

  const goalInfo = FITNESS_GOAL_GUIDELINES[goal] || FITNESS_GOAL_GUIDELINES.hipertrofia;

  // Sets, reps and rest times tailored strictly to scientific fitness modalities
  const sets = experienceLevel === 'principiante' ? 3 : experienceLevel === 'intermedio' ? 4 : 5;
  const repRange = goalInfo.repRange;
  const restSec = goalInfo.restSecondsDefault;

  const routineExercises: Exercise[] = selected.map((item, idx) => {
    const safeReps = sanitizeRepRangeServer(item.name, repRange, goal);
    return {
      id: `ex-ia-smart-${Date.now()}-${idx}`,
      name: item.name,
      libraryExerciseId: item.id,
      targetMuscles: item.muscleGroup,
      defaultSets: sets,
      repRange: safeReps,
      restSeconds: restSec,
      restText: `${restSec} s`,
      objective: `${goalInfo.name} · ${goalInfo.caloricFocus}`,
      defaultVideoUrl: item.videoUrl || item.url || '',
      techniqueCues: [
        `Fase excéntrica controlada (${item.equipment || 'peso libre'})`,
        'Contracción máxima y rango de movimiento completo',
        'Mantener la respiración controlada y el core activo',
      ],
    };
  });

  const titles: Record<string, string> = {
    torso: 'Torso Superior: Fuerza & Densidad',
    piernas: 'Inferior & Piernas: Potencia Pura',
    full_body: 'Full Body Metabólico de Élite',
    empuje: 'Push Day: Pecho, Hombro & Tríceps',
    tiron: 'Pull Day: Espalda, Bíceps & Jalones',
    core: 'Core & Estabilidad Funcional',
  };

  return {
    id: `rutina-ia-${Date.now()}`,
    dayName: 'Rutina IA',
    title: titles[focus] || `Rutina IA: ${focus.toUpperCase()}`,
    tagline: `${goalInfo.name} · ${goalInfo.repRange} · Descanso ${goalInfo.restRange}`,
    banner: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80',
    accentColor: '#f59e0b',
    isCustom: true,
    modality: goal,
    modalityName: goalInfo.name,
    targetRepRange: goalInfo.repRange,
    restRange: goalInfo.restRange,
    caloricFocus: goalInfo.caloricFocus,
    exercises: routineExercises,
  };
}
