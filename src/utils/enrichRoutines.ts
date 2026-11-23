import type { Routine, Exercise } from '../types';
import {
  resolveLibraryExercise,
  isObsoleteLibraryMedia,
  resolveMediaUrl,
} from '../data/exerciseLibrary';
import { buildTechniqueProProfile } from './exerciseAlternatives';

/**
 * Resolves external library media, libraryExerciseId, and Technique Pro 7.0 instructions
 * without ever modifying original training IDs, loads, sets, reps, notes, or workout history.
 */
export function enrichExerciseWithLibrary(ex: Exercise): Exercise {
  const match = resolveLibraryExercise(ex);
  const explicitThumbnail = !isObsoleteLibraryMedia(ex.thumbnailUrl)
    ? resolveMediaUrl(ex.thumbnailUrl)
    : null;
  const explicitSecondary = !isObsoleteLibraryMedia(ex.secondaryThumbnailUrl)
    ? resolveMediaUrl(ex.secondaryThumbnailUrl)
    : null;
  const explicitVideo = !isObsoleteLibraryMedia(ex.defaultVideoUrl)
    ? resolveMediaUrl(ex.defaultVideoUrl)
    : null;

  const resolvedVideoUrl = match?.videoUrl || match?.animationUrl || explicitVideo || '';
  const resolvedThumbnailUrl = match?.thumbnailUrl || explicitThumbnail || undefined;
  const resolvedLibraryId = match?.id || ex.libraryExerciseId || undefined;
  const resolvedEquipment = ex.equipment || match?.equipment || undefined;

  const techniquePro = buildTechniqueProProfile({
    id: ex.id,
    libraryExerciseId: resolvedLibraryId,
    name: ex.name,
    targetMuscles: ex.targetMuscles || match?.muscleGroup,
    equipment: resolvedEquipment,
    defaultVideoUrl: resolvedVideoUrl,
    thumbnailUrl: resolvedThumbnailUrl,
    customTempo: ex.customTempo,
  });

  const existingCues = Array.isArray(ex.techniqueCues) && ex.techniqueCues.length >= 3
    ? ex.techniqueCues
    : techniquePro.specificTips;

  return {
    ...ex,
    libraryExerciseId: resolvedLibraryId,
    equipment: resolvedEquipment,
    thumbnailUrl: resolvedThumbnailUrl,
    secondaryThumbnailUrl: match?.secondaryThumbnailUrl || explicitSecondary || undefined,
    defaultVideoUrl: resolvedVideoUrl,
    techniqueCues: existingCues,
    techniquePro,
    customTempo: ex.customTempo || techniquePro.defaultTempo.notation,
  };
}

export function getEnrichedDefaultRoutines(rawRoutines: Routine[]): Routine[] {
  return rawRoutines.map((routine) => ({
    ...routine,
    exercises: (routine.exercises || []).map(enrichExerciseWithLibrary),
  }));
}

