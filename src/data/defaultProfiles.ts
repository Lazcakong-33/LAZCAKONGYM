import { Profile } from '../types/index.ts';

// Safe non-privileged fallback defaults (NO plaintext PINs, NO hardcoded admin privileges)
export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'perfil_default',
    name: 'Atleta LAZCAKONGYM',
    email: '',
    avatar: '🦍',
    goal: 'Hipertrofia & Masa',
    weeklyTargetDays: 5,
    soundEnabled: true,
    vibrationEnabled: true,
    weightUnit: 'kg',
    weightKg: 80,
    isAdmin: false,
    createdAt: new Date().toISOString(),
  },
];

export const AVATAR_OPTIONS = [
  '🦍', '👑', '🦁', '🐺', '🐆', '🦅', '⚡', '🔥', '💥', '🌟',
  '💪', '🏋️‍♂️', '🏋️‍♀️', '🦾', '🦿', '🥊', '🥋', '🏆', '🥇', '🎯',
  '🛡️', '🚀', '⏱️', '🥤', '🥑', '🥩', '🧠', '💯', '🔱', '⚔️'
];

export const GOAL_OPTIONS = [
  'Hipertrofia (Volumen · 6-12 reps)',
  'Fuerza Máxima (1-5 reps · Cargas Pesadas)',
  'Potencia / Explosividad (3-6 reps rápidas)',
  'Definición (Pérdida de Grasa · 8-15 reps)',
  'Recomposición Corporal (6-12 reps · Normocalórico)',
  'Resistencia Muscular (15-25+ reps · 30-60 seg)',
  'Hipertrofia & Masa',
  'Rendimiento Atlético & Salud',
];
