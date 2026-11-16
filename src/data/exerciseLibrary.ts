import libraryData from './exerciseLibrary.json';
import aliases from './exerciseAliases.json';
import type { LibraryExercise } from '../types';

export const EXERCISE_LIBRARY: LibraryExercise[] = libraryData;
export const normalizeExerciseName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
const byId = new Map(EXERCISE_LIBRARY.map(ex => [ex.id, ex]));
const legacyIds: Record<string, string> = aliases.ids;
const exactNames: Record<string, string[]> = aliases.names;
const excludedIds = new Set<string>(aliases.excludedIds);

/** Read-only compatibility; never rewrites routine IDs, PR keys or history. */
export function resolveLibraryExercise(input: string | { id?: string; sourceId?: string; libraryExerciseId?: string; name?: string; equipment?: string }): LibraryExercise | undefined {
  const query = typeof input === 'string' ? { name: input } : input;
  for (const id of [query.libraryExerciseId, query.sourceId, query.id, query.id?.replace(/^cat-/, "")]) {
    if (id) {
      const match = byId.get(legacyIds[id] || id);
      if (match) return match;
    }
  }
  if (query.id && excludedIds.has(query.id)) return undefined;
  const candidates = (exactNames[normalizeExerciseName(query.name || '')] || []).map(id => byId.get(id)!).filter(Boolean);
  if (candidates.length === 1) return candidates[0];
  if (query.equipment && candidates.length > 1) {
    const equipment = normalizeExerciseName(query.equipment);
    const filtered = candidates.filter(ex => ex.allEquipment?.some(eq => normalizeExerciseName(eq) === equipment));
    if (filtered.length === 1) return filtered[0];
  }
  return undefined;
}

// Discard obsolete library media, retaining user photos and links.
export function isObsoleteLibraryMedia(url?: string | null): boolean {
  return !!url && /(?:^|[/.])smartworkout\.app(?:[/:]|$)/i.test(url);
}
export const MUSCLE_GROUPS = ['Todos', 'Pecho', 'Espalda', 'Pierna', 'Hombro', 'Bíceps', 'Tríceps', 'Abdomen', 'Glúteos', 'Antebrazo'] as const;
export const EQUIPMENT_LIST = ['Todos', ...Array.from(new Set(EXERCISE_LIBRARY.flatMap(ex => ex.allEquipment || [ex.equipment || 'Peso corporal']))).sort((a, b) => a.localeCompare(b, 'es'))];
