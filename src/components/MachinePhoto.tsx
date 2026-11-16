import React, { useState, useEffect, useRef } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import {
  LOADED_IMAGE_CACHE,
  FAILED_IMAGE_CACHE,
  BLOB_URL_CACHE,
} from './ExerciseThumbnail';

interface MachinePhotoProps {
  exerciseId: string;
  initialPhotoUrl?: string;
  thumbnailUrl?: string;
  exerciseName?: string;
  onPhotoCapture: (file: File, downloadUrl?: string) => void;
}

export default function MachinePhoto({
  exerciseId,
  initialPhotoUrl,
  thumbnailUrl,
  exerciseName = 'Ejercicio',
  onPhotoCapture,
}: MachinePhotoProps) {
  const rawSourceUrl = initialPhotoUrl || thumbnailUrl || null;
  const initialResolvedUrl = rawSourceUrl
    ? BLOB_URL_CACHE.get(exerciseId) || BLOB_URL_CACHE.get(rawSourceUrl) || rawSourceUrl
    : BLOB_URL_CACHE.get(exerciseId) || null;

  const [photoPreview, setPhotoPreview] = useState<string | null>(initialResolvedUrl);

  // Estado de carga inicializado en false si la URL ya existe en el caché en memoria
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (!initialResolvedUrl) return false;
    if (
      LOADED_IMAGE_CACHE.has(initialResolvedUrl) ||
      FAILED_IMAGE_CACHE.has(initialResolvedUrl)
    ) {
      return false;
    }
    return true;
  });

  const [hasError, setHasError] = useState<boolean>(() => {
    if (!initialResolvedUrl) return false;
    return FAILED_IMAGE_CACHE.has(initialResolvedUrl);
  });

  const [isUploading, setIsUploading] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Sincronizar cuando cambie el ejercicio o la URL de entrada
  useEffect(() => {
    const nextRaw = initialPhotoUrl || thumbnailUrl || null;
    const cachedBlob = BLOB_URL_CACHE.get(exerciseId);
    const resolved = cachedBlob || (nextRaw ? BLOB_URL_CACHE.get(nextRaw) || nextRaw : null);

    setPhotoPreview(resolved);

    if (!resolved) {
      setIsLoading(false);
      setHasError(false);
      return;
    }

    if (FAILED_IMAGE_CACHE.has(resolved)) {
      setIsLoading(false);
      setHasError(true);
      return;
    }

    if (LOADED_IMAGE_CACHE.has(resolved)) {
      setIsLoading(false);
      setHasError(false);
      return;
    }

    // Si la imagen ya está en el caché del navegador (complete), desactivar spinner de inmediato
    if (imgRef.current && imgRef.current.complete) {
      if (imgRef.current.naturalWidth > 0) {
        LOADED_IMAGE_CACHE.add(resolved);
        setIsLoading(false);
        setHasError(false);
      } else {
        FAILED_IMAGE_CACHE.add(resolved);
        setIsLoading(false);
        setHasError(true);
      }
      return;
    }

    setIsLoading(true);
    setHasError(false);

    // Salvaguarda: nunca permitir que el spinner supere 2.2 segundos si la red es inestable
    const timeoutId = window.setTimeout(() => {
      setIsLoading(false);
    }, 2200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [exerciseId, initialPhotoUrl, thumbnailUrl]);

  const handleImageLoad = () => {
    if (photoPreview) {
      LOADED_IMAGE_CACHE.add(photoPreview);
    }
    setIsLoading(false);
    setHasError(false);
  };

  const handleImageError = () => {
    if (photoPreview) {
      FAILED_IMAGE_CACHE.add(photoPreview);
    }
    // Asegurar que isLoading pase a false inmediatamente en caso de error
    setIsLoading(false);
    setHasError(true);
  };

  const handleCapture = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 1. Generar Blob local instantáneo y guardarlo en caché en memoria
    const previewUrl = URL.createObjectURL(file);
    BLOB_URL_CACHE.set(exerciseId, previewUrl);
    LOADED_IMAGE_CACHE.add(previewUrl);

    setPhotoPreview(previewUrl);
    setHasError(false);
    setIsLoading(false);
    setIsUploading(true);

    try {
      const imageRef = ref(storage, `machines/${exerciseId}_${Date.now()}.jpg`);

      // Evitar bloqueo indefinido si Firebase Storage no responde rápido (máx 2.5s)
      const uploadTask = (async () => {
        const snapshot = await uploadBytes(imageRef, file);
        return await getDownloadURL(snapshot.ref);
      })();

      const timeoutTask = new Promise<string | undefined>((resolve) =>
        window.setTimeout(() => resolve(undefined), 2500)
      );

      const downloadURL = await Promise.race([uploadTask, timeoutTask]);

      if (downloadURL) {
        BLOB_URL_CACHE.set(downloadURL, previewUrl);
        LOADED_IMAGE_CACHE.add(downloadURL);
      }

      onPhotoCapture(file, downloadURL || previewUrl);
    } catch (error) {
      console.error('Error al subir la foto de la máquina:', error);
      onPhotoCapture(file, previewUrl);
    } finally {
      setIsUploading(false);
      setIsLoading(false);
    }
  };

  const showImage = Boolean(photoPreview && !hasError);

  return (
    <div className="flex flex-col items-center justify-center">
      <input
        type="file"
        accept="image/*"
        capture="environment"
        id={`camera-${exerciseId}`}
        onChange={handleCapture}
        className="hidden"
      />
      <label
        htmlFor={`camera-${exerciseId}`}
        className="relative flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 bg-[#0d1322] border-2 border-dashed border-slate-700/90 rounded-xl cursor-pointer hover:border-amber-400 transition-colors overflow-hidden group shadow-sm select-none"
        title="Tomar o cambiar foto de la máquina / ejercicio"
      >
        {/* Placeholder ligero de color sólido mientras descarga o cuando no hay miniatura */}
        {(!showImage || isLoading) && (
          <div className="absolute inset-0 bg-[#0d1322] flex flex-col items-center justify-center text-slate-400 group-hover:text-amber-400 transition-colors z-0">
            <Camera className="w-5 h-5 mb-1 text-amber-400/90" />
            <span className="text-[10px] font-bold uppercase tracking-tight">Foto</span>
          </div>
        )}

        {/* Indicador de carga controlado estrictamente por onLoad / onError */}
        {(isLoading || isUploading) && (
          <div className="absolute inset-0 bg-[#0d1322]/80 flex items-center justify-center z-20 pointer-events-none">
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
          </div>
        )}

        {/* Imagen con Lazy Loading, decodificación asíncrona y transición inmediata */}
        {showImage && (
          <img
            ref={imgRef}
            src={photoPreview!}
            alt={exerciseName}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={handleImageLoad}
            onError={handleImageError}
            className={`w-full h-full object-cover transition-opacity duration-200 z-10 ${
              isLoading ? 'opacity-0' : 'opacity-95 group-hover:opacity-100'
            }`}
          />
        )}
      </label>
    </div>
  );
}
