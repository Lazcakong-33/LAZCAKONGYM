import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FileSpreadsheet,
  FileText,
  ImagePlus,
  Layers,
  Link2,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import { EXERCISE_LIBRARY } from '../data/exerciseLibrary';
import type { LibraryExercise, Routine, RoutineImportMode } from '../types';
import { CANONICAL_WEEKDAYS, CsvImportResult, normalizar } from '../utils/csvImporter';
import {
  ACCEPTED_ALL_IMPORTER_EXTENSIONS,
  analyzeRoutineFilesToDraft,
  buildImportResultFromConfirmedDraft,
  CANONICAL_MUSCLE_OPTIONS,
  computeDraftStats,
  createCustomExerciseFromDraft,
  detectFileFormat,
  EditableOcrDay,
  EditableOcrExercise,
  isPendingMarker,
  isSupportedRoutineFile,
  prepareImageForUpload,
  QueuedRoutineImage,
  revalidateEditedExercise,
  SupportedRoutineFormat,
} from '../utils/imageRoutineImporter';

type ImporterStep = 'upload' | 'analyze' | 'review' | 'confirm' | 'saved';

interface QueuedDocumentFile {
  id: string;
  file: File;
  format: SupportedRoutineFormat;
  fileName: string;
  sizeBytes: number;
}

interface ImageRoutineImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRoutines: Routine[];
  activeProfileName?: string;
  initialFiles?: File[] | null;
  onConsumeInitialFiles?: () => void;
  onConfirmSave: (result: CsvImportResult) => void;
}

const STEP_LABELS: { id: ImporterStep; num: number; label: string }[] = [
  { id: 'upload', num: 1, label: 'Seleccionar archivo' },
  { id: 'analyze', num: 2, label: 'Analizar' },
  { id: 'review', num: 3, label: 'Revisar' },
  { id: 'confirm', num: 4, label: 'Confirmar' },
  { id: 'saved', num: 5, label: 'Guardar' },
];

const FORMAT_BADGES: { label: string; desc: string }[] = [
  { label: 'XLSX', desc: 'Multi-hoja / Multi-día' },
  { label: 'CSV', desc: 'Planilla tabular' },
  { label: 'JSON', desc: 'Rutina estructurada' },
  { label: 'PDF', desc: 'Tablas con Visión IA' },
  { label: 'PNG / JPG / WEBP', desc: 'Múltiples capturas o cámara' },
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ImageRoutineImporterModal: React.FC<ImageRoutineImporterModalProps> = ({
  isOpen,
  onClose,
  existingRoutines,
  activeProfileName,
  initialFiles,
  onConsumeInitialFiles,
  onConfirmSave,
}) => {
  const [step, setStep] = useState<ImporterStep>('upload');
  const [queuedImages, setQueuedImages] = useState<QueuedRoutineImage[]>([]);
  const [queuedRawImageFiles, setQueuedRawImageFiles] = useState<File[]>([]);
  const [queuedDocument, setQueuedDocument] = useState<QueuedDocumentFile | null>(null);
  const [analyzingLabel, setAnalyzingLabel] = useState<string>('Analizando planificación...');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [draftDays, setDraftDays] = useState<EditableOcrDay[]>([]);
  const [draftMeta, setDraftMeta] = useState<{
    detectedFormat: string;
    warnings: string[];
    deduplicatedCount: number;
  }>({
    detectedFormat: 'Planificación',
    warnings: [],
    deduplicatedCount: 0,
  });

  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const [showReferenceImages, setShowReferenceImages] = useState(false);
  const [mergeMode, setMergeMode] = useState<RoutineImportMode>('append_new');
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [savedSummary, setSavedSummary] = useState<{
    routinesCount: number;
    exercisesCount: number;
    setsCount: number;
  } | null>(null);

  // Selector de biblioteca para vincular o corregir un ejercicio
  const [libraryPickerTarget, setLibraryPickerTarget] = useState<{
    dayId: string;
    exerciseId: string;
  } | null>(null);
  const [librarySearchTerm, setLibrarySearchTerm] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const isCameraLikelyAvailable = useMemo(() => {
    if (typeof navigator === 'undefined') return true;
    const ua = navigator.userAgent || '';
    const isTouchDevice =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    const hasMediaDevices = Boolean(navigator.mediaDevices?.getUserMedia);
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || isTouchDevice || hasMediaDevices;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setMergeMode('append_new');
    setReplaceConfirmed(false);
  }, [isOpen]);

  const draftStats = useMemo(
    () => computeDraftStats(draftDays, draftMeta),
    [draftDays, draftMeta]
  );

  const resetAll = () => {
    setStep('upload');
    setQueuedImages([]);
    setQueuedRawImageFiles([]);
    setQueuedDocument(null);
    setDraftDays([]);
    setDraftMeta({ detectedFormat: 'Planificación', warnings: [], deduplicatedCount: 0 });
    setErrorMsg(null);
    setShowOnlyPending(false);
    setShowReferenceImages(false);
    setMergeMode('append_new');
    setReplaceConfirmed(false);
    setLibraryPickerTarget(null);
    setSavedSummary(null);
  };

  const handleCloseModal = () => {
    if (step === 'saved') {
      resetAll();
    }
    onClose();
  };

  const runAnalysisForFiles = async (filesToAnalyze: File[], formatLabel: string) => {
    setErrorMsg(null);
    setAnalyzingLabel(formatLabel);
    setStep('analyze');

    try {
      const unified = await analyzeRoutineFilesToDraft(filesToAnalyze);

      if (unified.days.length === 0 || unified.totalExercises === 0) {
        throw new Error(
          'No se reconocieron ejercicios legibles en el archivo. Verifica el contenido o edita los datos manualmente.'
        );
      }

      setDraftDays(unified.days);
      setDraftMeta({
        detectedFormat: unified.detectedFormat,
        warnings: unified.warnings,
        deduplicatedCount: unified.deduplicatedCount,
      });
      setStep('review');
    } catch (err: any) {
      setErrorMsg(
        err?.message ||
          'No se pudo analizar el archivo seleccionado. Verifica el formato o la nitidez e inténtalo de nuevo.'
      );
      setStep('upload');
    }
  };

  const ingestSelectedFiles = async (incomingFiles: File[], autoAnalyze = false) => {
    if (!incomingFiles || incomingFiles.length === 0) return;
    setErrorMsg(null);

    const unsupported = incomingFiles.filter((f) => !isSupportedRoutineFile(f));
    if (unsupported.length > 0) {
      setErrorMsg(
        `Formato no compatible: "${unsupported[0].name}". Formatos aceptados: XLSX, CSV, JSON, PDF, PNG, JPG/JPEG y WEBP.`
      );
      return;
    }

    const imageFiles = incomingFiles.filter((f) => detectFileFormat(f) === 'image');
    const docFiles = incomingFiles.filter((f) => {
      const fmt = detectFileFormat(f);
      return fmt !== null && fmt !== 'image';
    });

    if (docFiles.length > 0 && imageFiles.length > 0) {
      setErrorMsg(
        'No mezcles documentos (XLSX/CSV/JSON/PDF) e imágenes en el mismo lote. Sube primero un archivo o un grupo de capturas.'
      );
      return;
    }

    if (docFiles.length > 0) {
      const docFile = docFiles[0];
      const fmt = detectFileFormat(docFile)!;
      setQueuedImages([]);
      setQueuedRawImageFiles([]);
      setQueuedDocument({
        id: `doc-${Date.now()}`,
        file: docFile,
        format: fmt,
        fileName: docFile.name,
        sizeBytes: docFile.size,
      });

      if (autoAnalyze) {
        await runAnalysisForFiles(
          [docFile],
          `Analizando ${fmt.toUpperCase()}: ${docFile.name}...`
        );
      }
      return;
    }

    // Caso: 1..N imágenes (PNG, JPG/JPEG, WEBP)
    const remainingSlots = Math.max(0, 10 - queuedImages.length);
    if (remainingSlots === 0 && !autoAnalyze) {
      setErrorMsg('Máximo 10 capturas por importación para mantener precisión OCR.');
      return;
    }

    const limitedImages = autoAnalyze
      ? imageFiles.slice(0, 10)
      : imageFiles.slice(0, remainingSlots);
    const prepared: QueuedRoutineImage[] = [];
    const errors: string[] = [];

    for (const file of limitedImages) {
      try {
        const img = await prepareImageForUpload(file);
        prepared.push(img);
      } catch (err: any) {
        errors.push(err?.message || `Error con "${file.name}"`);
      }
    }

    setQueuedDocument(null);
    if (autoAnalyze) {
      setQueuedImages(prepared);
      setQueuedRawImageFiles(limitedImages);
      if (prepared.length > 0) {
        await runAnalysisForFiles(
          limitedImages,
          `Analizando ${limitedImages.length} imagen(es) con visión OCR...`
        );
      }
    } else {
      if (prepared.length > 0) {
        setQueuedImages((prev) => [...prev, ...prepared]);
        setQueuedRawImageFiles((prev) => [...prev, ...limitedImages]);
      }
    }

    if (errors.length > 0) {
      setErrorMsg(errors.join(' '));
    }
  };

  // Si se abrió desde el botón "Importar" de RoutinesView con archivo preseleccionado, analizar al instante hacia la vista previa
  useEffect(() => {
    if (!isOpen || !initialFiles || initialFiles.length === 0) return;
    const filesCopy = [...initialFiles];
    onConsumeInitialFiles?.();
    void ingestSelectedFiles(filesCopy, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialFiles]);

  const handleRemoveQueuedImage = (indexToRemove: number) => {
    setQueuedImages((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    setQueuedRawImageFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleTriggerAnalyze = async () => {
    if (queuedDocument) {
      await runAnalysisForFiles(
        [queuedDocument.file],
        `Analizando ${queuedDocument.format.toUpperCase()}: ${queuedDocument.fileName}...`
      );
      return;
    }

    if (queuedRawImageFiles.length > 0) {
      await runAnalysisForFiles(
        queuedRawImageFiles,
        `Analizando ${queuedRawImageFiles.length} captura(s) con visión OCR...`
      );
      return;
    }

    setErrorMsg(
      'Selecciona un archivo (XLSX, CSV, JSON, PDF) o una o más imágenes antes de analizar.'
    );
  };

  // Funciones de edición inline del borrador (Paso 3: Revisar)
  const updateDayField = (
    draftDayId: string,
    patch: Partial<Pick<EditableOcrDay, 'dayName' | 'routineTitle' | 'dayNeedsReview'>>
  ) => {
    setDraftDays((prev) =>
      prev.map((d) => {
        if (d.draftDayId !== draftDayId) return d;
        const nextDayName = patch.dayName ?? d.dayName;
        const nextTitle = patch.routineTitle ?? d.routineTitle;
        return {
          ...d,
          ...patch,
          dayNeedsReview:
            isPendingMarker(nextDayName) || isPendingMarker(nextTitle),
          reviewReason:
            isPendingMarker(nextDayName) || isPendingMarker(nextTitle)
              ? 'Día o título pendiente de revisión'
              : undefined,
        };
      })
    );
  };

  const removeDraftDay = (draftDayId: string) => {
    setDraftDays((prev) => prev.filter((d) => d.draftDayId !== draftDayId));
  };

  const addManualDay = () => {
    const usedDays = new Set(draftDays.map((d) => d.dayName));
    const nextDay =
      CANONICAL_WEEKDAYS.find((d) => !usedDays.has(d)) || 'Lunes';
    setDraftDays((prev) => [
      ...prev,
      {
        draftDayId: `draft-day-manual-${Date.now()}`,
        dayName: nextDay,
        routineTitle: `Rutina ${nextDay}`,
        sourceImageIndices: [],
        dayNeedsReview: false,
        exercises: [
          {
            draftId: `draft-ex-manual-${Date.now()}`,
            order: 1,
            rawOcrName: '',
            name: '',
            libraryExerciseId: null,
            libraryMatchConfidence: 'none',
            libraryCandidates: [],
            isCustomExercise: false,
            targetMuscles: 'pendiente de revisión',
            equipment: '',
            sets: null,
            reps: 'pendiente de revisión',
            weightKg: null,
            restSeconds: null,
            rpe: '',
            notes: '',
            sourceImageIndices: [],
            needsReview: true,
            unrecognizedFields: ['name', 'sets', 'reps', 'restSeconds', 'targetMuscles'],
            reviewReasons: ['Ejercicio añadido manualmente: completa los campos'],
            manuallyVerified: false,
          },
        ],
      },
    ]);
  };

  const updateExerciseField = (
    draftDayId: string,
    draftId: string,
    patch: Partial<EditableOcrExercise>
  ) => {
    setDraftDays((prev) =>
      prev.map((day) => {
        if (day.draftDayId !== draftDayId) return day;
        return {
          ...day,
          exercises: day.exercises.map((ex) => {
            if (ex.draftId !== draftId) return ex;
            const merged = { ...ex, ...patch };
            return revalidateEditedExercise(merged);
          }),
        };
      })
    );
  };

  const moveExerciseOrder = (
    draftDayId: string,
    exerciseIndex: number,
    direction: 'up' | 'down'
  ) => {
    setDraftDays((prev) =>
      prev.map((day) => {
        if (day.draftDayId !== draftDayId) return day;
        const targetIndex = direction === 'up' ? exerciseIndex - 1 : exerciseIndex + 1;
        if (targetIndex < 0 || targetIndex >= day.exercises.length) return day;
        const reordered = [...day.exercises];
        const [moved] = reordered.splice(exerciseIndex, 1);
        reordered.splice(targetIndex, 0, moved);
        return {
          ...day,
          exercises: reordered.map((ex, i) => ({ ...ex, order: i + 1 })),
        };
      })
    );
  };

  const handleCreateCustomExercise = (draftDayId: string, draftId: string) => {
    setDraftDays((prev) =>
      prev.map((day) => {
        if (day.draftDayId !== draftDayId) return day;
        return {
          ...day,
          exercises: day.exercises.map((ex) =>
            ex.draftId === draftId ? createCustomExerciseFromDraft(ex) : ex
          ),
        };
      })
    );
  };

  const markExerciseVerified = (draftDayId: string, draftId: string) => {
    setDraftDays((prev) =>
      prev.map((day) => {
        if (day.draftDayId !== draftDayId) return day;
        return {
          ...day,
          exercises: day.exercises.map((ex) =>
            ex.draftId === draftId
              ? { ...ex, needsReview: false, manuallyVerified: true, unrecognizedFields: [] }
              : ex
          ),
        };
      })
    );
  };

  const removeDraftExercise = (draftDayId: string, draftId: string) => {
    setDraftDays((prev) =>
      prev
        .map((day) => {
          if (day.draftDayId !== draftDayId) return day;
          const remaining = day.exercises
            .filter((ex) => ex.draftId !== draftId)
            .map((ex, idx) => ({ ...ex, order: idx + 1 }));
          return {
            ...day,
            exercises: remaining,
          };
        })
        .filter((day) => day.exercises.length > 0)
    );
  };

  const addExerciseToDraftDay = (draftDayId: string) => {
    setDraftDays((prev) =>
      prev.map((day) => {
        if (day.draftDayId !== draftDayId) return day;
        const nextOrder = day.exercises.length + 1;
        return {
          ...day,
          exercises: [
            ...day.exercises,
            {
              draftId: `draft-ex-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              order: nextOrder,
              rawOcrName: '',
              name: '',
              libraryExerciseId: null,
              libraryMatchConfidence: 'none',
              libraryCandidates: [],
              isCustomExercise: false,
              targetMuscles: 'pendiente de revisión',
              equipment: '',
              sets: 3,
              reps: '8-12',
              weightKg: null,
              restSeconds: 90,
              rpe: '',
              notes: '',
              sourceImageIndices: [],
              needsReview: true,
              unrecognizedFields: ['name', 'targetMuscles'],
              reviewReasons: ['Completa el nombre o vincúlalo desde la biblioteca'],
              manuallyVerified: false,
            },
          ],
        };
      })
    );
  };

  const handleLinkLibraryExercise = (libEx: LibraryExercise) => {
    if (!libraryPickerTarget) return;
    const { dayId, exerciseId } = libraryPickerTarget;

    setDraftDays((prev) =>
      prev.map((day) => {
        if (day.draftDayId !== dayId) return day;
        return {
          ...day,
          exercises: day.exercises.map((ex) => {
            if (ex.draftId !== exerciseId) return ex;
            return revalidateEditedExercise({
              ...ex,
              name: libEx.name,
              libraryExerciseId: libEx.id,
              libraryMatchConfidence: 'exact',
              isCustomExercise: false,
              targetMuscles: libEx.muscleGroup || ex.targetMuscles,
              equipment: libEx.equipment || ex.equipment,
              thumbnailUrl: libEx.thumbnailUrl || undefined,
              secondaryThumbnailUrl: libEx.secondaryThumbnailUrl || undefined,
              defaultVideoUrl: libEx.videoUrl || libEx.url || ex.defaultVideoUrl,
            });
          }),
        };
      })
    );

    setLibraryPickerTarget(null);
    setLibrarySearchTerm('');
  };

  // Paso 5: ÚNICO punto donde se guarda la rutina en `useGymState` (requiere confirmación explícita)
  const handleFinalConfirmSave = () => {
    if (mergeMode === 'replace_all' && !replaceConfirmed) {
      return;
    }

    const result = buildImportResultFromConfirmedDraft(draftDays, {
      existingRoutines,
      mergeMode,
      confirmReplaceExisting: mergeMode === 'replace_all' && replaceConfirmed,
      sourceFormat: draftMeta.detectedFormat,
    });

    const activeDraftDays = draftDays.filter((d) => d.exercises.length > 0);
    const importedExercisesCount = activeDraftDays.reduce(
      (acc, d) => acc + d.exercises.length,
      0
    );
    const importedSetsCount = activeDraftDays.reduce(
      (acc, d) =>
        acc + d.exercises.reduce((sAcc, ex) => sAcc + (ex.sets || 3), 0),
      0
    );

    onConfirmSave(result);
    setSavedSummary({
      routinesCount: result.stats.routinesCreated || activeDraftDays.length,
      exercisesCount: importedExercisesCount,
      setsCount: importedSetsCount,
    });
    setStep('saved');
  };

  const activePickerExercise = useMemo(() => {
    if (!libraryPickerTarget) return null;
    const day = draftDays.find((d) => d.draftDayId === libraryPickerTarget.dayId);
    return day?.exercises.find((e) => e.draftId === libraryPickerTarget.exerciseId) || null;
  }, [libraryPickerTarget, draftDays]);

  const filteredLibraryItems = useMemo(() => {
    const q = normalizar(librarySearchTerm);
    if (!q) {
      return EXERCISE_LIBRARY.slice(0, 40);
    }
    return EXERCISE_LIBRARY.filter(
      (item) =>
        normalizar(item.name).includes(q) ||
        normalizar(item.muscleGroup || '').includes(q) ||
        normalizar(item.equipment || '').includes(q)
    ).slice(0, 50);
  }, [librarySearchTerm]);

  if (!isOpen) return null;

  const activeStepIdx = STEP_LABELS.findIndex((s) => s.id === step);
  const hasQueuedPayload = Boolean(queuedDocument) || queuedImages.length > 0;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unified-importer-title"
    >
      <div className="w-full sm:max-w-4xl max-h-[95dvh] sm:max-h-[90vh] bg-[#090909] border border-[#303030] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden text-[#F5F5F5]">
        {/* Cabecera fija ELITE PERFORMANCE */}
        <header className="px-4 sm:px-6 py-4 border-b border-[#303030] bg-[#111111] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-accent/15 border border-accent/40 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-accent-text" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-accent-text">
                IMPORTADOR INTELIGENTE ELITE 2.0
              </p>
              <h2
                id="unified-importer-title"
                className="text-base sm:text-lg font-black text-[#F5F5F5] truncate"
              >
                Importar Planificación Completa
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCloseModal}
            aria-label="Cerrar importador de rutinas"
            className="min-h-[44px] min-w-[44px] rounded-xl bg-[#171717] border border-[#303030] text-[#F5F5F5]/70 hover:text-[#F5F5F5] hover:border-accent/50 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Barra de progreso de 5 pasos */}
        <nav
          aria-label="Pasos de importación"
          className="px-4 sm:px-6 py-2.5 border-b border-[#303030] bg-[#0E0E0E] flex items-center gap-1.5 overflow-x-auto shrink-0"
        >
          {STEP_LABELS.map((item, idx) => {
            const isCurrent = item.id === step;
            const isDone = idx < activeStepIdx;
            return (
              <div
                key={item.id}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold whitespace-nowrap shrink-0 transition-colors ${
                  isCurrent
                    ? 'bg-accent text-accent-contrast border-accent'
                    : isDone
                    ? 'bg-[#171717] text-accent-text border-accent/40'
                    : 'bg-[#171717] text-[#F5F5F5]/45 border-[#303030]'
                }`}
              >
                <span className="font-mono">{item.num}.</span>
                <span>{item.label}</span>
              </div>
            );
          })}
        </nav>

        {/* Cuerpo principal desplazable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/40 text-red-200 text-xs sm:text-sm flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">{errorMsg}</div>
            </div>
          )}

          {/* PASO 1: SELECCIONAR ARCHIVO(S) */}
          {step === 'upload' && (
            <div className="space-y-5">
              <div className="p-4 sm:p-5 rounded-2xl bg-[#171717] border border-[#303030] space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm sm:text-base font-black text-[#F5F5F5]">
                    Selecciona tu archivo, PDF o capturas de entrenamiento
                  </h3>
                  <p className="text-xs text-[#F5F5F5]/70 leading-relaxed">
                    Compatible con hojas multi-día, tablas PDF y múltiples capturas o fotos de una misma rutina. Todo se valida antes de guardar y nunca se inventan datos faltantes.
                  </p>
                </div>

                {/* Formatos soportados */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {FORMAT_BADGES.map((fmt) => (
                    <div
                      key={fmt.label}
                      className="px-2.5 py-2 rounded-xl bg-[#090909] border border-[#303030]"
                    >
                      <div className="text-[11px] font-black text-accent-text">{fmt.label}</div>
                      <div className="text-[10px] text-[#F5F5F5]/55 truncate">{fmt.desc}</div>
                    </div>
                  ))}
                </div>

                {/* Botones táctiles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[54px] px-4 py-3 rounded-2xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs sm:text-sm flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] cursor-pointer"
                  >
                    <Upload className="w-4 h-4 stroke-[2.6]" />
                    <span>Seleccionar archivo o capturas</span>
                  </button>

                  {isCameraLikelyAvailable && (
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="min-h-[54px] px-4 py-3 rounded-2xl bg-[#090909] hover:bg-[#222222] border border-accent/60 text-accent-text font-black text-xs sm:text-sm flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] cursor-pointer"
                    >
                      <Camera className="w-4 h-4 stroke-[2.4]" />
                      <span>Usar cámara del teléfono</span>
                    </button>
                  )}
                </div>

                {/* Inputs ocultos */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_ALL_IMPORTER_EXTENSIONS}
                  multiple
                  onChange={(e) => {
                    void ingestSelectedFiles(Array.from(e.target.files || []), false);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    void ingestSelectedFiles(Array.from(e.target.files || []), false);
                    e.target.value = '';
                  }}
                  className="hidden"
                />

                {/* Tarjeta si se adjuntó XLSX / CSV / JSON / PDF */}
                {queuedDocument && (
                  <div className="p-3.5 rounded-2xl bg-[#090909] border border-accent/50 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-accent/15 border border-accent/40 flex items-center justify-center shrink-0 text-accent-text">
                        {queuedDocument.format === 'pdf' ? (
                          <FileText className="w-5 h-5" />
                        ) : (
                          <FileSpreadsheet className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-accent text-accent-contrast text-[10px] font-black uppercase">
                            {queuedDocument.format}
                          </span>
                          <span className="text-xs font-bold text-[#F5F5F5] truncate">
                            {queuedDocument.fileName}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-[#F5F5F5]/55 mt-0.5">
                          {formatBytes(queuedDocument.sizeBytes)} · Listo para analizar
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setQueuedDocument(null)}
                      aria-label="Quitar archivo seleccionado"
                      className="min-h-[40px] min-w-[40px] rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Cola de imágenes múltiples */}
                {queuedImages.length > 0 && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-accent-text">
                        {queuedImages.length} captura(s) lista(s) para unificar
                      </span>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#090909] border border-[#303030] hover:border-accent/60 text-xs font-bold text-[#F5F5F5] inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <ImagePlus className="w-3.5 h-3.5 text-accent-text" />
                        <span>Agregar otra captura</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {queuedImages.map((img, idx) => (
                        <div
                          key={img.id}
                          className="relative rounded-2xl bg-[#090909] border border-[#303030] overflow-hidden"
                        >
                          <img
                            src={img.dataUrl}
                            alt={`Captura ${idx + 1}: ${img.fileName}`}
                            className="w-full h-36 object-cover"
                          />
                          <div className="p-2 border-t border-[#303030] flex items-center justify-between gap-2 bg-[#141414]">
                            <div className="min-w-0">
                              <p className="text-[11px] font-bold text-[#F5F5F5] truncate">
                                Captura #{idx + 1}
                              </p>
                              <p className="text-[10px] font-mono text-[#F5F5F5]/55 truncate">
                                {formatBytes(img.sizeBytes)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveQueuedImage(idx)}
                              aria-label={`Quitar captura ${idx + 1}`}
                              className="min-h-[36px] min-w-[36px] rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 flex items-center justify-center shrink-0 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!hasQueuedPayload && (
                  <div className="rounded-2xl border border-dashed border-[#303030] bg-[#090909]/80 p-6 text-center space-y-1.5">
                    <Layers className="w-7 h-7 text-accent-text/70 mx-auto" />
                    <p className="text-xs font-bold text-[#F5F5F5]/85">
                      Sin archivos adjuntos todavía
                    </p>
                    <p className="text-[11px] text-[#F5F5F5]/50">
                      Podrás revisar ejercicios, orden, cargas, crear ejercicios personalizados y confirmar antes de guardar.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PASO 2: ANALIZAR */}
          {step === 'analyze' && (
            <div className="py-12 px-4 text-center space-y-5">
              <div className="w-16 h-16 rounded-3xl bg-accent/15 border border-accent/40 flex items-center justify-center mx-auto">
                <Loader2 className="w-8 h-8 text-accent-text animate-spin" />
              </div>
              <div className="space-y-1.5 max-w-md mx-auto">
                <h3 className="text-base sm:text-lg font-black text-[#F5F5F5]">
                  {analyzingLabel}
                </h3>
                <p className="text-xs text-[#F5F5F5]/65 leading-relaxed">
                  Detectando días, orden, ejercicios, series, repeticiones, pesos, descansos y notas. Todo campo ilegible o ausente se marcará como pendiente de revisión.
                </p>
              </div>
            </div>
          )}

          {/* PASO 3: REVISAR (VISTA PREVIA EDITABLE) */}
          {step === 'review' && (
            <div className="space-y-4">
              {/* Barra resumen + filtro */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-[#171717] border border-[#303030] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-accent-text">
                      Vista previa editable · Formato: {draftMeta.detectedFormat}
                    </p>
                    <h3 className="text-sm font-black text-[#F5F5F5]">
                      {draftStats.days.length} día(s) · {draftStats.totalExercises} ejercicio(s) · {draftStats.matchedLibraryCount} en biblioteca
                      {draftStats.customExercisesCount > 0 &&
                        ` · ${draftStats.customExercisesCount} personalizado(s)`}
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {draftStats.deduplicatedCount > 0 && (
                      <span className="px-2.5 py-1 rounded-lg bg-accent/15 border border-accent/40 text-accent-text text-[11px] font-bold">
                        {draftStats.deduplicatedCount} duplicado(s) unificado(s)
                      </span>
                    )}
                    {draftStats.pendingReviewExercisesCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowOnlyPending((p) => !p)}
                        className={`min-h-[36px] px-3 py-1 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 cursor-pointer ${
                          showOnlyPending
                            ? 'bg-amber-500 text-[#090909] border-amber-400'
                            : 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                        }`}
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>
                          {draftStats.pendingReviewExercisesCount} pendiente(s) de revisión
                        </span>
                      </button>
                    ) : (
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Todo validado</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Controles rápidos sobre origen y días */}
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#303030]">
                  <button
                    type="button"
                    onClick={() => setStep('upload')}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#090909] border border-[#303030] hover:border-accent/60 text-xs font-bold text-[#F5F5F5] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-accent-text" />
                    <span>Cambiar o añadir archivos</span>
                  </button>

                  {queuedImages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowReferenceImages((s) => !s)}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#090909] border border-[#303030] hover:border-accent/60 text-xs font-bold text-[#F5F5F5] inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-accent-text" />
                      <span>Ver capturas ({queuedImages.length})</span>
                      {showReferenceImages ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={addManualDay}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#090909] border border-[#303030] hover:border-accent/60 text-xs font-bold text-[#F5F5F5] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-accent-text" />
                    <span>Agregar día</span>
                  </button>
                </div>

                {showReferenceImages && queuedImages.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[#303030]">
                    {queuedImages.map((img, i) => (
                      <div
                        key={img.id}
                        className="rounded-xl overflow-hidden border border-[#303030] bg-[#090909]"
                      >
                        <img
                          src={img.dataUrl}
                          alt={`Referencia ${i + 1}`}
                          className="w-full h-28 object-contain bg-black"
                        />
                        <div className="px-2 py-1 text-[10px] font-mono text-[#F5F5F5]/65 truncate">
                          Captura #{i + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {draftMeta.warnings.length > 0 && (
                <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs space-y-1">
                  {draftMeta.warnings.map((w, idx) => (
                    <p key={idx}>• {w}</p>
                  ))}
                </div>
              )}

              {/* Lista editable por día */}
              <div className="space-y-4">
                {draftDays.map((day) => {
                  const visibleExercises = showOnlyPending
                    ? day.exercises.filter((ex) => ex.needsReview && !ex.manuallyVerified)
                    : day.exercises;

                  if (showOnlyPending && visibleExercises.length === 0) {
                    return null;
                  }

                  return (
                    <section
                      key={day.draftDayId}
                      className="rounded-2xl bg-[#171717] border border-[#303030] p-3.5 sm:p-4 space-y-3"
                    >
                      {/* Encabezado editable del día */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center pb-3 border-b border-[#303030]">
                        <div className="sm:col-span-3">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#F5F5F5]/60 mb-1">
                            Día
                          </label>
                          <select
                            value={day.dayName}
                            onChange={(e) =>
                              updateDayField(day.draftDayId, { dayName: e.target.value })
                            }
                            className={`w-full min-h-[42px] px-3 rounded-xl bg-[#090909] border text-xs font-bold text-[#F5F5F5] focus:outline-none focus:border-accent ${
                              isPendingMarker(day.dayName)
                                ? 'border-amber-500/70 text-amber-300'
                                : 'border-[#303030]'
                            }`}
                          >
                            {isPendingMarker(day.dayName) && (
                              <option value="pendiente de revisión">
                                pendiente de revisión
                              </option>
                            )}
                            {CANONICAL_WEEKDAYS.map((wd) => (
                              <option key={wd} value={wd}>
                                {wd}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-7">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#F5F5F5]/60 mb-1">
                            Nombre de la sesión / bloque
                          </label>
                          <input
                            type="text"
                            value={day.routineTitle}
                            onChange={(e) =>
                              updateDayField(day.draftDayId, {
                                routineTitle: e.target.value,
                              })
                            }
                            placeholder="Ej. Empuje A (Pecho / Hombro)"
                            className={`w-full min-h-[42px] px-3 rounded-xl bg-[#090909] border text-xs font-bold text-[#F5F5F5] focus:outline-none focus:border-accent ${
                              isPendingMarker(day.routineTitle)
                                ? 'border-amber-500/70 text-amber-300'
                                : 'border-[#303030]'
                            }`}
                          />
                        </div>

                        <div className="sm:col-span-2 flex items-end justify-end gap-1.5 pt-1 sm:pt-4">
                          <button
                            type="button"
                            onClick={() => addExerciseToDraftDay(day.draftDayId)}
                            title="Agregar ejercicio a este día"
                            className="min-h-[42px] px-2.5 rounded-xl bg-[#090909] border border-[#303030] hover:border-accent/60 text-accent-text text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-4 h-4" />
                            <span className="sm:hidden">Ejercicio</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeDraftDay(day.draftDayId)}
                            title="Eliminar este día"
                            className="min-h-[42px] min-w-[42px] rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Ejercicios editables del día */}
                      <div className="space-y-3">
                        {visibleExercises.map((ex) => {
                          const realIdx = day.exercises.findIndex(
                            (item) => item.draftId === ex.draftId
                          );
                          const isPending = ex.needsReview && !ex.manuallyVerified;
                          return (
                            <div
                              key={ex.draftId}
                              className={`rounded-2xl p-3.5 bg-[#090909] border space-y-3 ${
                                isPending ? 'border-amber-500/60' : 'border-[#303030]'
                              }`}
                            >
                              {/* Encabezado de orden, estado y acciones */}
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[11px] font-mono font-bold text-accent-text">
                                    #{String(ex.order || realIdx + 1).padStart(2, '0')}
                                  </span>

                                  {/* Controles de orden de ejecución */}
                                  <div className="flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      disabled={realIdx <= 0}
                                      onClick={() =>
                                        moveExerciseOrder(day.draftDayId, realIdx, 'up')
                                      }
                                      title="Subir orden"
                                      aria-label="Subir ejercicio"
                                      className="min-h-[28px] min-w-[28px] rounded bg-[#171717] border border-[#303030] text-[#F5F5F5]/80 hover:border-accent/60 disabled:opacity-30 flex items-center justify-center cursor-pointer"
                                    >
                                      <ArrowUp className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={realIdx >= day.exercises.length - 1}
                                      onClick={() =>
                                        moveExerciseOrder(day.draftDayId, realIdx, 'down')
                                      }
                                      title="Bajar orden"
                                      aria-label="Bajar ejercicio"
                                      className="min-h-[28px] min-w-[28px] rounded bg-[#171717] border border-[#303030] text-[#F5F5F5]/80 hover:border-accent/60 disabled:opacity-30 flex items-center justify-center cursor-pointer"
                                    >
                                      <ArrowDown className="w-3 h-3" />
                                    </button>
                                  </div>

                                  {ex.libraryExerciseId ? (
                                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold">
                                      Coincidencia exacta (Biblioteca)
                                    </span>
                                  ) : ex.isCustomExercise ? (
                                    <span className="px-2 py-0.5 rounded-md bg-accent/15 border border-accent/50 text-accent-text text-[10px] font-bold">
                                      Ejercicio personalizado
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-md bg-[#171717] border border-[#303030] text-[#F5F5F5]/70 text-[10px] font-bold">
                                      Sin vincular
                                    </span>
                                  )}

                                  {isPending && (
                                    <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/50 text-amber-300 text-[10px] font-extrabold uppercase">
                                      Pendiente de revisión
                                    </span>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5">
                                  {!ex.libraryExerciseId && !ex.isCustomExercise && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleCreateCustomExercise(day.draftDayId, ex.draftId)
                                      }
                                      className="min-h-[34px] px-2.5 rounded-lg bg-accent/15 border border-accent/50 hover:bg-accent/25 text-accent-text text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      <Wrench className="w-3 h-3" />
                                      <span>Crear personalizado</span>
                                    </button>
                                  )}
                                  {isPending && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        markExerciseVerified(day.draftDayId, ex.draftId)
                                      }
                                      className="min-h-[34px] px-2.5 rounded-lg bg-[#171717] border border-accent/40 text-accent-text text-[10px] font-bold cursor-pointer"
                                    >
                                      Marcar verificado
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setLibraryPickerTarget({
                                        dayId: day.draftDayId,
                                        exerciseId: ex.draftId,
                                      });
                                      setLibrarySearchTerm(
                                        isPendingMarker(ex.name) ? '' : ex.name
                                      );
                                    }}
                                    className="min-h-[34px] px-2.5 rounded-lg bg-[#171717] border border-[#303030] hover:border-accent/60 text-[#F5F5F5] text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Link2 className="w-3 h-3 text-accent-text" />
                                    <span>Biblioteca</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      removeDraftExercise(day.draftDayId, ex.draftId)
                                    }
                                    aria-label="Eliminar ejercicio"
                                    className="min-h-[34px] min-w-[34px] rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 flex items-center justify-center cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {isPending && ex.reviewReasons.length > 0 && (
                                <p className="text-[11px] text-amber-300/90 leading-snug">
                                  Revisión sugerida: {ex.reviewReasons.join(' · ')}
                                </p>
                              )}

                              {/* Nombre editable + referencia original */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#F5F5F5]/60">
                                    Ejercicio
                                  </label>
                                  {ex.rawOcrName &&
                                    ex.rawOcrName !== ex.name &&
                                    !isPendingMarker(ex.rawOcrName) && (
                                      <span className="text-[10px] font-mono text-[#F5F5F5]/45 truncate">
                                        Detectado original: &ldquo;{ex.rawOcrName}&rdquo;
                                      </span>
                                    )}
                                </div>
                                <input
                                  type="text"
                                  value={ex.name}
                                  onChange={(e) =>
                                    updateExerciseField(day.draftDayId, ex.draftId, {
                                      name: e.target.value,
                                      libraryExerciseId: null,
                                      libraryMatchConfidence: 'none',
                                    })
                                  }
                                  placeholder="pendiente de revisión"
                                  className={`w-full min-h-[42px] px-3 rounded-xl bg-[#171717] border text-xs sm:text-sm font-bold text-[#F5F5F5] focus:outline-none focus:border-accent ${
                                    isPendingMarker(ex.name)
                                      ? 'border-amber-500/70 text-amber-300'
                                      : 'border-[#303030]'
                                  }`}
                                />

                                {/* Sugerencias rápidas similares de la biblioteca (nunca sobrescriben automáticamente) */}
                                {!ex.libraryExerciseId && ex.libraryCandidates.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                    <span className="text-[10px] text-[#F5F5F5]/50">
                                      Coincidencias similares:
                                    </span>
                                    {ex.libraryCandidates.slice(0, 3).map((cand) => (
                                      <button
                                        key={cand.exercise.id}
                                        type="button"
                                        onClick={() => {
                                          updateExerciseField(day.draftDayId, ex.draftId, {
                                            name: cand.exercise.name,
                                            libraryExerciseId: cand.exercise.id,
                                            libraryMatchConfidence: 'exact',
                                            isCustomExercise: false,
                                            targetMuscles:
                                              cand.exercise.muscleGroup || ex.targetMuscles,
                                            equipment: cand.exercise.equipment || '',
                                            thumbnailUrl:
                                              cand.exercise.thumbnailUrl || undefined,
                                            secondaryThumbnailUrl:
                                              cand.exercise.secondaryThumbnailUrl || undefined,
                                            defaultVideoUrl:
                                              cand.exercise.videoUrl || cand.exercise.url,
                                          });
                                        }}
                                        className="px-2 py-1 rounded-lg bg-[#171717] border border-[#303030] hover:border-accent text-[10px] font-semibold text-[#F5F5F5]/85 hover:text-accent-text cursor-pointer"
                                      >
                                        Usar: {cand.exercise.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Campos numéricos y grupo muscular */}
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                <div className="col-span-2 sm:col-span-1">
                                  <label className="block text-[10px] font-bold uppercase text-[#F5F5F5]/55 mb-1">
                                    Músculo
                                  </label>
                                  <select
                                    value={ex.targetMuscles}
                                    onChange={(e) =>
                                      updateExerciseField(day.draftDayId, ex.draftId, {
                                        targetMuscles: e.target.value,
                                      })
                                    }
                                    className={`w-full min-h-[40px] px-2.5 rounded-xl bg-[#171717] border text-xs font-bold text-[#F5F5F5] focus:outline-none focus:border-accent ${
                                      isPendingMarker(ex.targetMuscles)
                                        ? 'border-amber-500/70 text-amber-300'
                                        : 'border-[#303030]'
                                    }`}
                                  >
                                    {isPendingMarker(ex.targetMuscles) && (
                                      <option value="pendiente de revisión">
                                        pendiente de revisión
                                      </option>
                                    )}
                                    {CANONICAL_MUSCLE_OPTIONS.map((m) => (
                                      <option key={m} value={m}>
                                        {m}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-[#F5F5F5]/55 mb-1">
                                    Series
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={12}
                                    value={ex.sets ?? ''}
                                    placeholder="Pendiente"
                                    onChange={(e) => {
                                      const val = e.target.value.trim();
                                      updateExerciseField(day.draftDayId, ex.draftId, {
                                        sets: val === '' ? null : parseInt(val, 10) || null,
                                      });
                                    }}
                                    className={`w-full min-h-[40px] px-2.5 rounded-xl bg-[#171717] border text-xs font-mono font-bold text-[#F5F5F5] focus:outline-none focus:border-accent ${
                                      ex.sets === null
                                        ? 'border-amber-500/70 placeholder:text-amber-300/80'
                                        : 'border-[#303030]'
                                    }`}
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-[#F5F5F5]/55 mb-1">
                                    Reps
                                  </label>
                                  <input
                                    type="text"
                                    value={ex.reps}
                                    placeholder="Pendiente"
                                    onChange={(e) =>
                                      updateExerciseField(day.draftDayId, ex.draftId, {
                                        reps: e.target.value,
                                      })
                                    }
                                    className={`w-full min-h-[40px] px-2.5 rounded-xl bg-[#171717] border text-xs font-mono font-bold text-[#F5F5F5] focus:outline-none focus:border-accent ${
                                      isPendingMarker(ex.reps)
                                        ? 'border-amber-500/70 text-amber-300'
                                        : 'border-[#303030]'
                                    }`}
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-[#F5F5F5]/55 mb-1">
                                    Peso (kg)
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    value={ex.weightKg ?? ''}
                                    placeholder="Opcional"
                                    onChange={(e) => {
                                      const val = e.target.value.trim();
                                      updateExerciseField(day.draftDayId, ex.draftId, {
                                        weightKg:
                                          val === '' ? null : parseFloat(val) || 0,
                                      });
                                    }}
                                    className="w-full min-h-[40px] px-2.5 rounded-xl bg-[#171717] border border-[#303030] text-xs font-mono font-bold text-[#F5F5F5] focus:outline-none focus:border-accent"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-[#F5F5F5]/55 mb-1">
                                    Descanso (s)
                                  </label>
                                  <input
                                    type="number"
                                    min={15}
                                    max={600}
                                    step={5}
                                    value={ex.restSeconds ?? ''}
                                    placeholder="Pendiente"
                                    onChange={(e) => {
                                      const val = e.target.value.trim();
                                      updateExerciseField(day.draftDayId, ex.draftId, {
                                        restSeconds:
                                          val === '' ? null : parseInt(val, 10) || null,
                                      });
                                    }}
                                    className={`w-full min-h-[40px] px-2.5 rounded-xl bg-[#171717] border text-xs font-mono font-bold text-[#F5F5F5] focus:outline-none focus:border-accent ${
                                      ex.restSeconds === null
                                        ? 'border-amber-500/70 placeholder:text-amber-300/80'
                                        : 'border-[#303030]'
                                    }`}
                                  />
                                </div>
                              </div>

                              {/* Equipamiento (para personalizados) + Notas */}
                              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                                {ex.isCustomExercise && (
                                  <div className="sm:col-span-4">
                                    <input
                                      type="text"
                                      value={ex.equipment}
                                      onChange={(e) =>
                                        updateExerciseField(day.draftDayId, ex.draftId, {
                                          equipment: e.target.value,
                                        })
                                      }
                                      placeholder="Equipo (ej. Barra, Polea)"
                                      className="w-full min-h-[38px] px-3 rounded-xl bg-[#171717] border border-accent/40 text-xs text-[#F5F5F5] placeholder:text-[#F5F5F5]/35 focus:outline-none focus:border-accent"
                                    />
                                  </div>
                                )}
                                <div className={ex.isCustomExercise ? 'sm:col-span-8' : 'sm:col-span-12'}>
                                  <input
                                    type="text"
                                    value={ex.notes}
                                    onChange={(e) =>
                                      updateExerciseField(day.draftDayId, ex.draftId, {
                                        notes: e.target.value,
                                      })
                                    }
                                    placeholder="Notas técnicas, tempo o RIR/RPE detectado (opcional)"
                                    className="w-full min-h-[38px] px-3 rounded-xl bg-[#171717] border border-[#303030] text-xs text-[#F5F5F5]/85 placeholder:text-[#F5F5F5]/35 focus:outline-none focus:border-accent"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}

          {/* PASO 4: CONFIRMAR ANTES DE GUARDAR */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="p-4 sm:p-5 rounded-2xl bg-[#171717] border border-[#303030] space-y-3">
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-5 h-5 text-accent-text" />
                  <div>
                    <h3 className="text-base font-black text-[#F5F5F5]">
                      Confirmar Guardado de Planificación
                    </h3>
                    <p className="text-xs text-[#F5F5F5]/65">
                      Perfil destino:{' '}
                      <strong className="text-accent-text">
                        {activeProfileName || 'Atleta activo'}
                      </strong>{' '}
                      · Origen: {draftMeta.detectedFormat}
                    </p>
                  </div>
                </div>

                {draftStats.pendingReviewExercisesCount > 0 && (
                  <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/50 text-amber-200 text-xs space-y-1.5">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        Aún quedan {draftStats.pendingReviewExercisesCount} ejercicio(s) con campos marcados como &ldquo;pendiente de revisión&rdquo;.
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-200/85">
                      Puedes volver atrás para completarlos manualmente o confirmar para guardar con valores seguros estándar (3 series · 8-12 reps · 90s) únicamente en esos campos pendientes.
                    </p>
                  </div>
                )}

                {/* Garantía de no alteración de historial/recuperación + respaldo automático */}
                <div className="p-3 rounded-xl bg-[#090909] border border-[#303030] text-[11px] text-[#F5F5F5]/80 flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#F5F5F5]">Protección total de avances:</strong> se guardará un <strong className="text-accent-text">respaldo automático previo</strong> de tu perfil y nunca se alterarán tus entrenamientos completados, cargas, récords PR, estadísticas, Mapa Muscular ni otros perfiles.
                  </span>
                </div>

                {/* Resumen por día */}
                <div className="space-y-2">
                  {draftDays.map((day) => {
                    const setsSum = day.exercises.reduce(
                      (acc, e) => acc + (e.sets || 3),
                      0
                    );
                    return (
                      <div
                        key={day.draftDayId}
                        className="p-3 rounded-xl bg-[#090909] border border-[#303030] flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-accent-text">
                            {day.dayName}
                          </span>
                          <p className="text-xs sm:text-sm font-bold text-[#F5F5F5] truncate">
                            {day.routineTitle}
                          </p>
                        </div>
                        <div className="text-right font-mono text-xs shrink-0">
                          <div className="font-bold text-[#F5F5F5]">
                            {day.exercises.length} ejercicios
                          </div>
                          <div className="text-[11px] text-accent-text">{setsSum} series</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Estrategia de guardado respecto al plan actual */}
                <div className="space-y-2.5 pt-2 border-t border-[#303030]">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#F5F5F5]/65">
                    ¿Cómo deseas guardar esta planificación en tu perfil?
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMergeMode('append_new');
                        setReplaceConfirmed(false);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        mergeMode === 'append_new'
                          ? 'bg-accent/10 border-accent text-[#F5F5F5]'
                          : 'bg-[#090909] border-[#303030] text-[#F5F5F5]/75'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black">
                          Guardar como nueva planificación (Recomendado)
                        </span>
                        <span className="px-2 py-0.5 rounded bg-accent text-accent-contrast text-[10px] font-black uppercase">
                          Seguro
                        </span>
                      </div>
                      <p className="text-[11px] text-[#F5F5F5]/65 mt-0.5">
                        Conserva intactas todas tus rutinas anteriores ({existingRoutines.length} actual(es)), incluso si comparten el mismo día de la semana.
                      </p>
                    </button>

                    {existingRoutines.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setMergeMode('merge_days');
                            setReplaceConfirmed(false);
                          }}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            mergeMode === 'merge_days'
                              ? 'bg-accent/10 border-accent text-[#F5F5F5]'
                              : 'bg-[#090909] border-[#303030] text-[#F5F5F5]/75'
                          }`}
                        >
                          <div className="text-xs font-black">
                            Actualizar solo días coincidentes
                          </div>
                          <p className="text-[11px] text-[#F5F5F5]/65 mt-0.5">
                            Mantiene tus demás días previos y sustituye únicamente los días que coincidan con este archivo.
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => setMergeMode('replace_all')}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            mergeMode === 'replace_all'
                              ? 'bg-red-500/10 border-red-400 text-[#F5F5F5]'
                              : 'bg-[#090909] border-[#303030] text-[#F5F5F5]/75'
                          }`}
                        >
                          <div className="text-xs font-black text-red-300">
                            Reemplazar rutinas semanales anteriores
                          </div>
                          <p className="text-[11px] text-[#F5F5F5]/65 mt-0.5">
                            Elimina tus rutinas previas tras confirmación explícita (no borra entrenamientos completados, PRs ni Mapa Muscular).
                          </p>
                        </button>
                      </>
                    )}
                  </div>

                  {mergeMode === 'replace_all' && (
                    <label className="p-3 rounded-xl bg-red-500/15 border border-red-500/50 text-red-200 text-xs flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={replaceConfirmed}
                        onChange={(e) => setReplaceConfirmed(e.target.checked)}
                        className="mt-0.5 w-4 h-4 shrink-0"
                        style={{ accentColor: 'var(--accent-primary)' }}
                      />
                      <span>
                        Confirmo explícitamente eliminar mis{' '}
                        <strong>{existingRoutines.length} rutina(s)</strong> anteriores de este perfil (se creará un respaldo automático previo para recuperarlas si lo necesito).
                      </span>
                    </label>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* PASO 5: GUARDADO CON ÉXITO */}
          {step === 'saved' && savedSummary && (
            <div className="py-10 px-4 text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-accent/15 border border-accent/50 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-accent-text" />
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-accent-text">
                  GUARDADO COMPLETADO
                </p>
                <h3 className="text-lg font-black text-[#F5F5F5]">
                  ¡Rutina importada y guardada en {activeProfileName || 'tu perfil'}!
                </h3>
                <p className="text-xs text-[#F5F5F5]/70 font-mono">
                  {savedSummary.routinesCount} día(s) · {savedSummary.exercisesCount} ejercicio(s) · {savedSummary.setsCount} series listas para editar e iniciar en Entrenamiento ELITE 2.0.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Barra inferior fija de acciones por paso */}
        <footer className="px-4 sm:px-6 py-3.5 border-t border-[#303030] bg-[#111111] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
          {step === 'upload' && (
            <>
              <button
                type="button"
                onClick={handleCloseModal}
                className="min-h-[46px] px-4 rounded-xl bg-[#171717] border border-[#303030] text-xs font-bold text-[#F5F5F5]/80 hover:text-[#F5F5F5] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!hasQueuedPayload}
                onClick={handleTriggerAnalyze}
                className="min-h-[48px] px-6 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-accent-contrast font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {queuedDocument
                    ? `Analizar ${queuedDocument.format.toUpperCase()}`
                    : queuedImages.length > 0
                    ? `Analizar ${queuedImages.length} captura(s)`
                    : 'Selecciona un archivo para analizar'}
                </span>
              </button>
            </>
          )}

          {step === 'analyze' && (
            <button
              type="button"
              onClick={() => setStep('upload')}
              className="w-full min-h-[46px] px-4 rounded-xl bg-[#171717] border border-[#303030] text-xs font-bold text-[#F5F5F5] cursor-pointer"
            >
              Cancelar y volver a seleccionar archivo
            </button>
          )}

          {step === 'review' && (
            <>
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="min-h-[46px] px-4 rounded-xl bg-[#171717] border border-[#303030] text-xs font-bold text-[#F5F5F5] cursor-pointer"
              >
                ← Volver a archivo
              </button>
              <button
                type="button"
                disabled={draftDays.length === 0}
                onClick={() => setStep('confirm')}
                className="min-h-[48px] px-6 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 text-accent-contrast font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Confirmar Rutina →</span>
              </button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <button
                type="button"
                onClick={() => setStep('review')}
                className="min-h-[46px] px-4 rounded-xl bg-[#171717] border border-[#303030] text-xs font-bold text-[#F5F5F5] cursor-pointer"
              >
                ← Volver a revisar
              </button>
              <button
                type="button"
                disabled={mergeMode === 'replace_all' && !replaceConfirmed}
                onClick={handleFinalConfirmSave}
                className="min-h-[48px] px-6 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-accent-contrast font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirmar y Guardar Rutina</span>
              </button>
            </>
          )}

          {step === 'saved' && (
            <button
              type="button"
              onClick={handleCloseModal}
              className="w-full min-h-[48px] px-6 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs sm:text-sm cursor-pointer"
            >
              Ir a Mis Rutinas
            </button>
          )}
        </footer>
      </div>

      {/* Sub-modal buscador de la Biblioteca Oficial */}
      {libraryPickerTarget && activePickerExercise && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[85vh] bg-[#090909] border border-[#303030] rounded-3xl p-5 flex flex-col gap-3.5 shadow-2xl">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#303030]">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-accent-text">
                  Biblioteca Oficial ({EXERCISE_LIBRARY.length} ejercicios)
                </p>
                <h4 className="text-sm font-black text-[#F5F5F5] truncate">
                  Vincular: {activePickerExercise.name || 'Ejercicio pendiente'}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setLibraryPickerTarget(null)}
                className="min-h-[40px] min-w-[40px] rounded-xl bg-[#171717] border border-[#303030] text-[#F5F5F5]/70 hover:text-[#F5F5F5] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-[#F5F5F5]/45 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={librarySearchTerm}
                onChange={(e) => setLibrarySearchTerm(e.target.value)}
                placeholder="Buscar por nombre, músculo o máquina..."
                className="w-full min-h-[44px] pl-10 pr-4 rounded-xl bg-[#171717] border border-[#303030] text-xs font-semibold text-[#F5F5F5] placeholder:text-[#F5F5F5]/40 focus:outline-none focus:border-accent"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {activePickerExercise.libraryCandidates.length > 0 && !librarySearchTerm && (
                <div className="pb-2 mb-2 border-b border-[#303030] space-y-1.5">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-accent-text">
                    Sugerencias similares
                  </p>
                  {activePickerExercise.libraryCandidates.map((cand) => (
                    <button
                      key={`top-${cand.exercise.id}`}
                      type="button"
                      onClick={() => handleLinkLibraryExercise(cand.exercise)}
                      className="w-full min-h-[48px] px-3 py-2 rounded-xl bg-[#171717] border border-accent/40 hover:border-accent text-left flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#F5F5F5] truncate">
                          {cand.exercise.name}
                        </div>
                        <div className="text-[10px] font-mono text-[#F5F5F5]/55">
                          {cand.exercise.muscleGroup} · {cand.exercise.equipment}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-accent-text shrink-0">
                        {Math.round(cand.score * 100)}%
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {filteredLibraryItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleLinkLibraryExercise(item)}
                  className="w-full min-h-[46px] px-3 py-2 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-left flex items-center justify-between gap-2 cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#F5F5F5] truncate">
                      {item.name}
                    </div>
                    <div className="text-[10px] font-mono text-[#F5F5F5]/55">
                      {item.muscleGroup} · {item.equipment}
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-accent-text shrink-0">
                    Elegir →
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
