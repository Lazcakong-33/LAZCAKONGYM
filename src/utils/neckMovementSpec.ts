import type { LibraryExercise } from '../types';

export type NeckMovementKind = 'tuck' | 'wall-tuck' | 'supine-tuck' |
  'rotation' | 'lateral' | 'flexion' | 'extension' |
  'iso-front' | 'iso-back' | 'iso-lateral' | 'iso-rotation' | 'iso-neutral';

export interface NeckMovementSpec {
  kind: NeckMovementKind;
  resistance: 'manual' | 'band' | 'none' | 'towel';
  isometric: boolean;
  label: string;
}

/**
 * Assign one anatomically distinct animation to each cervical card.
 * Isometrics are static at the joint: only the resistance/tension marker pulses.
 * Never reuse a dynamic rotation for an isometric rotation.
 */
export function getNeckMovementSpec(
  exercise: Pick<LibraryExercise, 'name' | 'muscleGroup' | 'equipment'> & {
    canonicalGroup16?: LibraryExercise['canonicalGroup16'];
  } | null | undefined
): NeckMovementSpec | null {
  if (!exercise) return null;
  const group = String(exercise.canonicalGroup16 || exercise.muscleGroup || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!/^(cuello|neck)$/.test(group)) return null;
  const name = String(exercise.name || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const eq = String(exercise.equipment || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const resistance: NeckMovementSpec['resistance'] =
    /banda|elastica/.test(name + ' ' + eq) ? 'band' :
    /manual|mano|manos/.test(name) ? 'manual' :
    /toalla/.test(name + ' ' + eq) ? 'towel' : 'none';

  if (/estabilizacion cervical neutra/.test(name)) {
    return { kind: 'iso-neutral', resistance, isometric: true, label: 'Estabilizar sin mover el cuello' };
  }
  if (/isometrica|isometrico/.test(name)) {
    const kind: NeckMovementKind = /rotacion/.test(name) ? 'iso-rotation' :
      /inclinacion|lateral/.test(name) ? 'iso-lateral' :
      /extension/.test(name) ? 'iso-back' : 'iso-front';
    return { kind, resistance, isometric: true, label: 'Resistir suavemente sin mover la cabeza' };
  }
  if (/retraccion/.test(name) && /supino|decubito/.test(name)) {
    return { kind: 'supine-tuck', resistance, isometric: false, label: 'Mentón atrás con cabeza apoyada' };
  }
  if (/retraccion/.test(name) && /pared|toalla/.test(name)) {
    return { kind: 'wall-tuck', resistance, isometric: false, label: 'Deslizar el mentón atrás en horizontal' };
  }
  if (/retraccion/.test(name)) {
    return { kind: 'tuck', resistance, isometric: false, label: 'Deslizar el mentón atrás en horizontal' };
  }
  if (/rotacion/.test(name)) {
    return { kind: 'rotation', resistance, isometric: false, label: 'Girar suavemente a ambos lados' };
  }
  if (/inclinacion lateral/.test(name)) {
    return { kind: 'lateral', resistance, isometric: false, label: 'Inclinar lateralmente sin elevar el hombro' };
  }
  if (/flexion/.test(name)) {
    return { kind: 'flexion', resistance, isometric: false, label: 'Bajar suavemente el mentón' };
  }
  if (/extension/.test(name)) {
    return { kind: 'extension', resistance, isometric: false, label: 'Mirar levemente arriba sin comprimir la nuca' };
  }
  return null;
}
