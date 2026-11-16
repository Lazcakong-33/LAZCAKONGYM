import React, { useState, useEffect, useRef } from 'react';
import { Dumbbell, Loader2 } from 'lucide-react';
import { resolveLibraryExercise, isObsoleteLibraryMedia } from '../data/exerciseLibrary';

/**
 * Caché global en memoria (persiste durante toda la sesión entre cambios de pestaña, días o vistas)
 * para evitar que las imágenes ya descargadas vuelvan a mostrar el spinner o se descarguen de cero.
 */
export const LOADED_IMAGE_CACHE = new Set<string>();
export const FAILED_IMAGE_CACHE = new Set<string>();
export const BLOB_URL_CACHE = new Map<string, string>();

/**
 * Precarga una imagen en memoria de forma asíncrona y la registra en el caché global.
 */
export function preloadExerciseImage(url?: string | null): void {
  if (!url || LOADED_IMAGE_CACHE.has(url) || FAILED_IMAGE_CACHE.has(url)) return;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    LOADED_IMAGE_CACHE.add(url);
  };
  img.onerror = () => {
    FAILED_IMAGE_CACHE.add(url);
  };
  img.src = url;
}

export interface ExerciseThumbnailProps {
  src?: string | null;
  alt: string;
  muscleGroup?: string;
  className?: string;
  imgClassName?: string;
  onClick?: () => void;
  showSpinner?: boolean;
}

export const ExerciseThumbnail: React.FC<ExerciseThumbnailProps> = ({
  src,
  alt,
  muscleGroup,
  className = 'w-16 h-16 sm:w-20 sm:h-20 rounded-xl',
  imgClassName = 'w-full h-full object-cover',
  onClick,
  showSpinner = false,
}) => {
  const localSource = src && !isObsoleteLibraryMedia(src) ? src : resolveLibraryExercise(alt)?.thumbnailUrl;
  const resolvedSrc = localSource ? BLOB_URL_CACHE.get(localSource) || localSource : null;

  // Si la URL ya está en LOADED_IMAGE_CACHE, iniciamos con isLoading = false de forma instantánea (0ms)
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

    // Si la imagen ya está completa en el caché nativo del navegador, desactivar carga de inmediato
    if (imgRef.current && imgRef.current.complete) {
      if (imgRef.current.naturalWidth > 0) {
        LOADED_IMAGE_CACHE.add(resolvedSrc);
        setIsLoading(false);
        setHasError(false);
      } else {
        FAILED_IMAGE_CACHE.add(resolvedSrc);
        setIsLoading(false);
        setHasError(true);
      }
      return;
    }

    setIsLoading(true);
    setHasError(false);

    // Salvaguarda de tiempo máximo (2.5s): evita que cualquier imagen lenta bloquee el spinner
    const safetyTimer = window.setTimeout(() => {
      setIsLoading(false);
    }, 2500);

    return () => {
      window.clearTimeout(safetyTimer);
    };
  }, [resolvedSrc]);

  const handleLoad = () => {
    if (resolvedSrc) {
      LOADED_IMAGE_CACHE.add(resolvedSrc);
    }
    setIsLoading(false);
    setHasError(false);
  };

  const handleError = () => {
    if (resolvedSrc) {
      FAILED_IMAGE_CACHE.add(resolvedSrc);
    }
    // Liberar el estado de carga inmediatamente ante cualquier fallo de red o 404
    setIsLoading(false);
    setHasError(true);
  };

  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden bg-[#0d1322] border border-slate-800/90 flex items-center justify-center select-none shrink-0 ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
    >
      {/* 1. Placeholder ligero de fondo sólido e icono mientras descarga o si no hay imagen */}
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

      {/* 2. Indicador de carga no bloqueante (se oculta al instante en onLoad, onError o caché) */}
      {isLoading && showSpinner && !hasError && (
        <div className="absolute inset-0 bg-slate-950/40 flex items-center justify-center z-10 pointer-events-none">
          <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
        </div>
      )}

      {/* 3. Imagen optimizada con Lazy Loading, decodificación asíncrona y manejo de onLoad / onError */}
      {resolvedSrc && !hasError && (
        <img
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
    </div>
  );
};

export default ExerciseThumbnail;
