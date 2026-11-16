import type { Routine, Exercise } from '../types';
import { resolveLibraryExercise, isObsoleteLibraryMedia } from '../data/exerciseLibrary';

/** Resolve media only; training IDs, prescriptions and stored data stay intact. */
export function enrichExerciseWithLibrary(ex: Exercise): Exercise {
  const match = resolveLibraryExercise(ex);
  return {
    ...ex,
    libraryExerciseId: match?.id || ex.libraryExerciseId,
    defaultVideoUrl: match?.videoUrl || (isObsoleteLibraryMedia(ex.defaultVideoUrl) ? '' : ex.defaultVideoUrl),
    thumbnailUrl: match?.thumbnailUrl || (isObsoleteLibraryMedia(ex.thumbnailUrl) ? undefined : ex.thumbnailUrl),
    secondaryThumbnailUrl: match?.secondaryThumbnailUrl || (isObsoleteLibraryMedia(ex.secondaryThumbnailUrl) ? undefined : ex.secondaryThumbnailUrl),
  };
}
export function getEnrichedDefaultRoutines(rawRoutines: Routine[]): Routine[] {
  return rawRoutines.map(routine => ({ ...routine, exercises: routine.exercises.map(enrichExerciseWithLibrary) }));
}
