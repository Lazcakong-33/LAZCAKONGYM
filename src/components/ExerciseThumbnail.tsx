import React, { useState, useEffect, useRef } from 'react';
import { NeckMovementDemo } from './NeckMovementDemo';
import { getNeckMovementSpec } from '../utils/neckMovementSpec';
import { Dumbbell, Loader2, RefreshCw } from 'lucide-react';
import {
  resolveLibraryExercise,
  isObsoleteLibraryMedia,
  resolveMediaUrl,
} from '../data/exerciseLibrary';

const MAX_LOADED_IMAGE_CACHE = 400;
const MAX_FAILED_IMAGE_CACHE = 200;
const MAX_BLOB_URL_CACHE = 150;

export const LOADED_IMAGE_CACHE = new Set<string>();
export const FAILED_IMAGE_CACHE = new Set<string>();
export const BLOB_URL_CACHE = new Map<string, string>();

function rememberLoadedImage(url: string): void {
  if (LOADED_IMAGE_CACHE.has(url)) {
    LOADED_IMAGE_CACHE.delete(url);
  }
  LOADED_IMAGE_CACHE.add(url);
  while (LOADED_IMAGE_CACHE.size > MAX_LOADED_IMAGE_CACHE) {
    const oldest = LOADED_IMAGE_CACHE.values().next().value;
    if (!oldest) break;
    LOADED_IMAGE_CACHE.delete(oldest);
  }
}

function rememberFailedImage(url: string): void {
  if (FAILED_IMAGE_CACHE.has(url)) {
    FAILED_IMAGE_CACHE.delete(url);
  }
  FAILED_IMAGE_CACHE.add(url);
  while (FAILED_IMAGE_CACHE.size > MAX_FAILED_IMAGE_CACHE) {
    const oldest = FAILED_IMAGE_CACHE.values().next().value;
    if (!oldest) break;
    FAILED_IMAGE_CACHE.delete(oldest);
  }
}

export function setBoundedBlobUrl(sourceUrl: string, objectUrl: string): void {
  if (BLOB_URL_CACHE.has(sourceUrl)) {
    const prev = BLOB_URL_CACHE.get(sourceUrl);
    BLOB_URL_CACHE.delete(sourceUrl);
    if (prev && prev !== objectUrl && prev.startsWith('blob:') && typeof URL?.revokeObjectURL === 'function') {
      URL.revokeObjectURL(prev);
    }
  }
  BLOB_URL_CACHE.set(sourceUrl, objectUrl);
  while (BLOB_URL_CACHE.size > MAX_BLOB_URL_CACHE) {
    const oldestEntry = BLOB_URL_CACHE.entries().next().value as [string, string] | undefined;
    if (!oldestEntry) break;
    const [oldestKey, oldestBlob] = oldestEntry;
    BLOB_URL_CACHE.delete(oldestKey);
    if (oldestBlob.startsWith('blob:') && typeof URL?.revokeObjectURL === 'function') {
      URL.revokeObjectURL(oldestBlob);
    }
  }
}

/**
 * Precarga una imagen en memoria de forma asíncrona y la registra en el caché global acotado.
 */
export function preloadExerciseImage(url?: string | null): void {
  const normalized = url && !isObsoleteLibraryMedia(url) ? resolveMediaUrl(url) : null;
  if (!normalized || LOADED_IMAGE_CACHE.has(normalized) || FAILED_IMAGE_CACHE.has(normalized)) {
    return;
  }
  const img = new Image();
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    rememberLoadedImage(normalized);
  };
  img.onerror = () => {
    rememberFailedImage(normalized);
  };
  img.src = normalized;
}

export interface ExerciseThumbnailProps {
  src?: string | null;
  alt: string;
  muscleGroup?: string;
  className?: string;
  imgClassName?: string;
  onClick?: () => void;
  showSpinner?: boolean;
  allowRetry?: boolean;
  exercise?: {
    id?: string;
    sourceId?: string;
    libraryExerciseId?: string;
    name?: string;
    equipment?: string;
    thumbnailUrl?: string | null;
  };
}

export const ExerciseThumbnail: React.FC<ExerciseThumbnailProps> = ({
  src,
  alt,
  muscleGroup,
  className = 'w-16 h-16 sm:w-20 sm:h-20 rounded-xl',
  imgClassName = 'w-full h-full object-cover',
  onClick,
  showSpinner = false,
  allowRetry = false,
  exercise,
}) => {
  const [retryTick, setRetryTick] = useState(0);

  const libraryMatch = resolveLibraryExercise(exercise || alt);
  const neckDemoAvailable = libraryMatch && getNeckMovementSpec(libraryMatch) !== null;
  const explicitSrc = src && !isObsoleteLibraryMedia(src) ? resolveMediaUrl(src) : null;
  const localSource = libraryMatch?.thumbnailUrl || explicitSrc || null;
  const resolvedSrc = localSource ? BLOB_URL_CACHE.get(localSource) || localSource : null;

  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (!resolvedSrc) return false;
    if (LOADED_IMAGE_CACHE.has(resolvedSrc) || FAILED_IMAGE_CACHE.has(resolvedSrc)) {
      return false;
    }
    return true;
  });

  const [hasError, setHasError] = useState<boolean>(() => {
    if (!resolvedSrc) return true;
    return FAILED_IMAGE_CACHE.has(resolvedSrc);
  });

  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!resolvedSrc) {
      setIsLoading(false);
      setHasError(true);
      return;
    }

    if (FAILED_IMAGE_CACHE.has(resolvedSrc)) {
      setIsLoading(false);
      setHasError(true);
      return;
    }

    if (LOADED_IMAGE_CACHE.has(resolvedSrc)) {
      setIsLoading(false);
      setHasError(false);
      return;
    }

    if (imgRef.current && imgRef.current.complete) {
      if (imgRef.current.naturalWidth > 0) {
        rememberLoadedImage(resolvedSrc);
        setIsLoading(false);
        setHasError(false);
        return;
      }
    }

    setIsLoading(true);
    setHasError(false);

    const safetyTimer = window.setTimeout(() => {
      const ready = Boolean(imgRef.current?.complete && imgRef.current.naturalWidth > 0);
      if (ready) {
        rememberLoadedImage(resolvedSrc);
        setIsLoading(false);
        setHasError(false);
      } else {
        setIsLoading(false);
        setHasError(true);
      }
    }, 3000);

    return () => {
      window.clearTimeout(safetyTimer);
    };
  }, [resolvedSrc, retryTick]);

  const handleLoad = () => {
    if (resolvedSrc) {
      FAILED_IMAGE_CACHE.delete(resolvedSrc);
      rememberLoadedImage(resolvedSrc);
    }
    setIsLoading(false);
    setHasError(false);
  };

  const handleError = () => {
    if (resolvedSrc) {
      rememberFailedImage(resolvedSrc);
    }
    setIsLoading(false);
    setHasError(true);
  };

  const handleRetryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!resolvedSrc) return;
    FAILED_IMAGE_CACHE.delete(resolvedSrc);
    LOADED_IMAGE_CACHE.delete(resolvedSrc);
    setHasError(false);
    setIsLoading(true);
    setRetryTick((t) => t + 1);
  };

  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden bg-[#0d1322] border border-slate-800/90 flex items-center justify-center select-none shrink-0 ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
    >
      {neckDemoAvailable && libraryMatch ? (
        <NeckMovementDemo exercise={libraryMatch} className="w-full h-full" />
      ) : (
      <>
      {(isLoading || hasError || !resolvedSrc) && (
        <div className="absolute inset-0 bg-[#0d1322] flex flex-col items-center justify-center text-slate-500 p-1.5 z-0">
          <Dumbbell className="w-5 h-5 text-amber-500/50 mb-0.5 shrink-0" />
          {muscleGroup && (
            <span className="text-[9px] font-mono uppercase tracking-tight text-slate-500 truncate max-w-full">
              {muscleGroup}
            </span>
          )}
        </div>
      )}

      {isLoading && showSpinner && !hasError && (
        <div className="absolute inset-0 bg-slate-950/40 flex items-center justify-center z-10 pointer-events-none">
          <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
        </div>
      )}

      {allowRetry && hasError && resolvedSrc && (
        <button
          type="button"
          onClick={handleRetryClick}
          title="Reintentar carga de imagen"
          aria-label="Reintentar carga de imagen"
          className="absolute inset-0 bg-black/60 hover:bg-black/75 flex items-center justify-center text-accent-text z-20 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      )}

      {resolvedSrc && !hasError && (
        <img
          key={`${resolvedSrc}::${retryTick}`}
          ref={imgRef}
          src={resolvedSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={handleLoad}
          onError={handleError}
          className={`${imgClassName} transition-opacity duration-200 z-10 ${
            isLoading ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}
      </>
      )}
    </div>
  );
};

export default ExerciseThumbnail;
