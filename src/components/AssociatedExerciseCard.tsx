import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Clock, PlayCircle } from 'lucide-react';
import type { LibraryExercise } from '../types';
import { getExerciseFallbackAnimationUrl } from '../data/exerciseLibrary';

export interface AssociatedExerciseCardData {
  key: string;
  name: string;
  libraryExercise?: LibraryExercise;
  isHistorical: boolean;
  sets?: number;
  reps?: number;
  weightKg?: number;
  role: 'primary' | 'synergist' | 'stabilizer' | 'suggested';
  contributionPct?: number;
  primaryMuscleLabel: string;
  synergistMusclesLabel?: string;
  equipmentLabel?: string;
}

interface AssociatedExerciseCardProps {
  item: AssociatedExerciseCardData;
  isSingleCard?: boolean;
  onOpenTechniquePro?: (exerciseName: string, libraryExerciseId?: string) => void;
}

const MUSCLE_TOKEN_ES_MAP: Record<string, string> = {
  pectorals: 'Pectoral mayor',
  pectoral: 'Pectoral mayor',
  pectoral_mayor: 'Pectoral mayor',
  'pectoral mayor': 'Pectoral mayor',
  pecho: 'Pectoral mayor',
  chest: 'Pectoral mayor',
  latissimus: 'Dorsal ancho',
  'latissimus dorsi': 'Dorsal ancho',
  lats: 'Dorsal ancho',
  dorsal_ancho: 'Dorsal ancho',
  'dorsal ancho': 'Dorsal ancho',
  espalda: 'Espalda',
  back: 'Espalda',
  rhomboids: 'Romboides',
  romboides: 'Romboides',
  trapezius: 'Trapecio',
  'middle trapezius': 'Trapecio medio',
  trapecio: 'Trapecio',
  trapecio_medio: 'Trapecio medio',
  trapecio_superior: 'Trapecio superior',
  'spinal erectors': 'Erectores espinales',
  erectores_espinales: 'Erectores espinales',
  quadriceps: 'Cuádriceps',
  quads: 'Cuádriceps',
  cuadriceps: 'Cuádriceps',
  hamstrings: 'Isquiotibiales',
  isquiotibiales: 'Isquiotibiales',
  glutes: 'Glúteos',
  gluteo_mayor: 'Glúteo mayor',
  gluteo_medio: 'Glúteo medio',
  gluteos: 'Glúteos',
  shoulders: 'Deltoides',
  deltoids: 'Deltoides',
  deltoides: 'Deltoides',
  deltoides_anterior: 'Deltoides anterior',
  deltoides_medio: 'Deltoides lateral',
  deltoides_lateral: 'Deltoides lateral',
  deltoides_posterior: 'Deltoides posterior',
  'rear deltoids': 'Deltoides posterior',
  supraespinoso: 'Supraespinoso',
  infraespinoso: 'Infraespinoso',
  redondo_menor: 'Redondo menor',
  redondo_mayor: 'Redondo mayor',
  biceps: 'Bíceps braquial',
  biceps_braquial: 'Bíceps braquial',
  braquial: 'Braquial anterior',
  braquiorradial: 'Braquiorradial',
  triceps: 'Tríceps braquial',
  calves: 'Gemelos',
  gastrocnemio: 'Gastrocnemio',
  soleo: 'Sóleo',
  pantorrillas: 'Gemelos',
  abdominals: 'Recto abdominal',
  abs: 'Recto abdominal',
  recto_abdominal: 'Recto abdominal',
  oblicuos: 'Oblicuos',
  obliques: 'Oblicuos',
  flexores_cadera: 'Flexores de cadera',
  forearms: 'Antebrazos',
  antebrazos: 'Antebrazos',
  'hip adductors': 'Aductores de cadera',
  adductors: 'Aductores de cadera',
  aductores: 'Aductores de cadera',
  piernas: 'Tren inferior',
  pierna: 'Tren inferior',
};

export function formatAnatomicalMuscleLabel(raw?: string | null): string {
  if (!raw) return '';
  const cleaned = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
  const snakeKey = cleaned.replace(/\s+/g, '_');
  if (MUSCLE_TOKEN_ES_MAP[cleaned]) return MUSCLE_TOKEN_ES_MAP[cleaned];
  if (MUSCLE_TOKEN_ES_MAP[snakeKey]) return MUSCLE_TOKEN_ES_MAP[snakeKey];

  const readable = raw.replace(/[_-]+/g, ' ').trim();
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function formatMuscleListForCard(list?: string[], fallback?: string): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of list || []) {
    const formatted = formatAnatomicalMuscleLabel(item);
    const key = formatted.toLowerCase();
    if (formatted && !seen.has(key)) {
      seen.add(key);
      unique.push(formatted);
    }
  }
  if (unique.length > 0) {
    return unique.slice(0, 2).join(', ');
  }
  return fallback ? formatAnatomicalMuscleLabel(fallback) : '';
}

export const AssociatedExerciseCard: React.FC<AssociatedExerciseCardProps> = ({
  item,
  isSingleCard = false,
  onOpenTechniquePro,
}) => {
  const cardRef = useRef<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [sourceStage, setSourceStage] = useState<number>(0);
  const [isImageLoaded, setIsImageLoaded] = useState(false);

  // Build strict ID-bound media chain: primary animation -> fallback library animation -> static poster
  const mediaChain = useMemo(() => {
    const ex = item.libraryExercise;
    if (!ex) return [] as { url: string; isAnimated: boolean }[];

    const chain: { url: string; isAnimated: boolean }[] = [];
    const seen = new Set<string>();
    const pushUrl = (url: string | null | undefined, isAnimated: boolean) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      chain.push({ url, isAnimated });
    };

    pushUrl(ex.animationUrl || ex.videoUrl, true);
    pushUrl(getExerciseFallbackAnimationUrl(ex.id), true);
    pushUrl(ex.thumbnailUrl, false);

    return chain;
  }, [item.libraryExercise]);

  const staticPosterUrl = item.libraryExercise?.thumbnailUrl || null;

  // Reset media fallback state whenever exercise identity changes
  useEffect(() => {
    setSourceStage(0);
    setIsImageLoaded(false);
  }, [item.libraryExercise?.id, item.name]);

  // Respect prefers-reduced-motion accessibility preference
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener?.('change', listener);
    return () => mq.removeEventListener?.('change', listener);
  }, []);

  // Auto-play animations only while card is visible in the viewport
  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setIsVisible(entry.isIntersecting);
        }
      },
      { threshold: 0.15, rootMargin: '60px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const activeCandidate = mediaChain[sourceStage] || null;
  const shouldPlayAnimation = isVisible && !prefersReducedMotion;

  // When offscreen or reduced motion is enabled, render static poster if available; when visible, render continuous ~4s animated loop
  const displayedSrc = useMemo(() => {
    if (!activeCandidate) return null;
    if (!shouldPlayAnimation && staticPosterUrl) {
      return staticPosterUrl;
    }
    return activeCandidate.url;
  }, [activeCandidate, shouldPlayAnimation, staticPosterUrl]);

  const isPendingResource = !item.libraryExercise || !displayedSrc;

  const handleImageError = () => {
    if (sourceStage + 1 < mediaChain.length) {
      setSourceStage((prev) => prev + 1);
      setIsImageLoaded(false);
    } else {
      setSourceStage(mediaChain.length);
      setIsImageLoaded(false);
    }
  };

  const roleSummaryText = useMemo(() => {
    if (item.role === 'primary') {
      return item.contributionPct ? `Primario · ${item.contributionPct}%` : 'Primario · 100%';
    }
    if (item.role === 'synergist' || item.role === 'stabilizer') {
      return item.contributionPct ? `Sinergista · ${item.contributionPct}%` : 'Sinergista';
    }
    return 'Sugerido';
  }, [item.role, item.contributionPct]);

  const formattedWeight = useMemo(() => {
    if (typeof item.weightKg !== 'number' || item.weightKg <= 0) return 'Corporal';
    return Number.isInteger(item.weightKg)
      ? `${item.weightKg} kg`
      : `${item.weightKg.toFixed(1)} kg`;
  }, [item.weightKg]);

  return (
    <article
      ref={cardRef}
      data-testid="associated-exercise-card"
      data-library-id={item.libraryExercise?.id || 'pending'}
      className={`${
        isSingleCard
          ? 'w-full max-w-[340px]'
          : 'w-[264px] xs:w-[284px] sm:w-[292px] shrink-0 snap-start'
      } rounded-2xl bg-[#171717] border border-[#303030] hover:border-accent/45 transition-colors duration-200 overflow-hidden flex flex-col justify-between shadow-[0_8px_24px_rgba(0,0,0,0.45)]`}
    >
      {/* Escenario visual principal: 1:1 proporcionado, fondo #090909, sin recortes ni figuras esquemáticas */}
      <div
        onClick={() =>
          onOpenTechniquePro?.(item.name, item.libraryExercise?.id)
        }
        className={`relative aspect-square w-full bg-[#090909] border-b border-[#303030] flex items-center justify-center overflow-hidden select-none ${
          onOpenTechniquePro ? 'cursor-pointer group' : ''
        }`}
      >
        {isPendingResource ? (
          <div
            data-testid="associated-exercise-pending"
            className="w-full h-full flex flex-col items-center justify-center px-5 text-center gap-2.5 bg-[radial-gradient(circle_at_center,var(--accent-soft-bg)_0%,rgba(9,9,9,1)_72%)]"
          >
            <div className="w-11 h-11 rounded-xl bg-[#171717] border border-[#303030] flex items-center justify-center text-accent-text/80">
              <Clock className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <div className="space-y-0.5">
              <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#F5F5F5]/80">
                Recurso pendiente
              </span>
              <span className="block text-[11px] text-[#F5F5F5]/45 leading-snug">
                Animación oficial en preparación
              </span>
            </div>
          </div>
        ) : (
          <>
            {/* Fondo sutil de espera mientras decodifica el recurso */}
            {!isImageLoaded && (
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[#090909] flex items-center justify-center"
              >
                <div className="w-8 h-8 rounded-full border-2 border-[#303030] border-t-accent animate-spin" />
              </div>
            )}

            <img
              key={`${item.libraryExercise?.id}::${displayedSrc}`}
              src={displayedSrc}
              alt={`Ejecución técnica: ${item.name}`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setIsImageLoaded(true)}
              onError={handleImageError}
              className={`w-full h-full object-contain p-2 transition-opacity duration-300 ${
                isImageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {/* Acento periférico sutil de identidad LazcaKong en la base sin tapar al atleta */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#090909]/80 via-[#090909]/20 to-transparent"
            />
          </>
        )}
      </div>

      {/* Cuerpo estructurado de la tarjeta: etiquetas musculares debajo de la imagen, nombre legible, métricas ordenadas y CTA */}
      <div className="p-3.5 sm:p-4 flex-1 flex flex-col justify-between gap-3">
        <div className="space-y-2.5">
          {/* Etiquetas de músculo primario y sinergista debajo de la imagen */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[11px] leading-tight">
              <span className="inline-flex items-center gap-1.5 min-w-0 font-bold text-accent-text">
                <span
                  aria-hidden="true"
                  className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 shadow-[0_0_6px_var(--accent-glow)]"
                />
                <span className="truncate">{item.primaryMuscleLabel}</span>
              </span>
              <span
                className={`font-mono text-[10px] font-bold uppercase tracking-wider shrink-0 tabular-nums ${
                  item.role === 'primary'
                    ? 'text-accent-text'
                    : item.role === 'synergist' || item.role === 'stabilizer'
                    ? 'text-[#F5F5F5]/80'
                    : 'text-[#F5F5F5]/55'
                }`}
              >
                {roleSummaryText}
              </span>
            </div>

            {item.synergistMusclesLabel && (
              <p className="text-[11px] text-[#F5F5F5]/65 leading-snug break-words">
                <span className="text-[#F5F5F5]/45 font-semibold">Sinergistas: </span>
                <span>{item.synergistMusclesLabel}</span>
              </p>
            )}
          </div>

          {/* Nombre completo del ejercicio, totalmente legible sin cortes */}
          <h5 className="text-[15px] font-extrabold text-[#F5F5F5] leading-snug tracking-tight break-words">
            {item.name}
          </h5>
        </div>

        <div className="space-y-3 pt-0.5">
          {/* Bloque ordenado de Series · Reps · Carga (o Especificación cuando es sugerido) */}
          {item.isHistorical ? (
            <div className="grid grid-cols-3 divide-x divide-[#303030] rounded-xl bg-[#090909] border border-[#303030] py-2 text-center">
              <div className="px-1.5">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#F5F5F5]/50">
                  Series
                </span>
                <span className="block text-sm font-black font-mono tabular-nums text-[#F5F5F5] mt-0.5">
                  {item.sets ?? 0}
                </span>
              </div>
              <div className="px-1.5">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#F5F5F5]/50">
                  Reps
                </span>
                <span className="block text-sm font-black font-mono tabular-nums text-[#F5F5F5] mt-0.5">
                  {item.reps ?? 0}
                </span>
              </div>
              <div className="px-1.5">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#F5F5F5]/50">
                  Carga
                </span>
                <span className="block text-sm font-black font-mono tabular-nums text-accent-text mt-0.5 truncate">
                  {formattedWeight}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-[#090909] border border-[#303030] px-3 py-2 text-[11px]">
              <span className="text-[#F5F5F5]/55 font-medium truncate">
                {item.equipmentLabel || 'Equipamiento de gimnasio'}
              </span>
              <span className="font-mono font-bold text-[#F5F5F5]/75 shrink-0">
                Sin registro aún
              </span>
            </div>
          )}

          {/* Botón VER TÉCNICA PRO con iconografía profesional y objetivo táctil >= 44px */}
          {onOpenTechniquePro && (
            <button
              type="button"
              onClick={() =>
                onOpenTechniquePro(item.name, item.libraryExercise?.id)
              }
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#090909] hover:bg-accent text-accent-text hover:text-accent-contrast border border-accent/50 hover:border-accent transition-colors duration-150 flex items-center justify-between gap-2 cursor-pointer active:scale-[0.98]"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <PlayCircle className="w-4 h-4 shrink-0" strokeWidth={2.25} />
                <span className="text-[11px] font-black uppercase tracking-[0.09em] truncate">
                  VER TÉCNICA PRO
                </span>
              </span>
              <ChevronRight className="w-4 h-4 shrink-0" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

export default AssociatedExerciseCard;
