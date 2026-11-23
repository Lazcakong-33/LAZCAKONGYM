import React, { useMemo, useRef, useState } from 'react';
import {
  Award,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  Share2,
  Shield,
  Trophy,
  Volume2,
  Zap,
} from 'lucide-react';
import {
  CoachRecognitionMessage,
  CompletedWorkout,
  EliteBadgeCategoryId,
  EliteChallengesProfileSnapshot,
  EliteRankId,
  PeriodizationMesocyclePlan,
  PersonalRecord,
  Profile,
  Routine,
  SocialCardFormat,
  SocialCardType,
} from '../types';
import {
  computeEliteChallengesSnapshot,
  createDefaultEliteChallengesPlatformAdapter,
  ELITE_RANKS,
  speakEliteChallengeRecognition,
  withSocialCardFormat,
} from '../utils/eliteChallengesEngine';
import { useTheme } from '../context/ThemeContext';

interface EliteChallengesPanelProps {
  profile: Profile;
  history: CompletedWorkout[];
  routines: Routine[];
  prs?: Record<string, PersonalRecord>;
  periodizationPlan?: PeriodizationMesocyclePlan | null;
  variant?: 'compact' | 'full';
  isRestTimerActive?: boolean;
  onNavigateToProgreso?: () => void;
}

const CARD_TYPE_LABELS: { id: SocialCardType; label: string }[] = [
  { id: 'new_pr', label: 'Nuevo Récord Personal' },
  { id: 'workout_completed', label: 'Entrenamiento Completado' },
  { id: 'new_rank', label: 'Nuevo Rango Alcanzado' },
  { id: 'challenge_completed', label: 'Desafío Superado' },
  { id: 'weekly_summary', label: 'Resumen Semanal' },
  { id: 'cycle_completed', label: 'Ciclo Completado' },
];

const MetallicBadgeEmblem: React.FC<{
  categoryId: EliteBadgeCategoryId;
  unlocked: boolean;
  tierMetal: 'graphite' | 'steel' | 'titanium' | 'kong_lime';
  accentPrimary: string;
  accentSoftBg: string;
  accentBorderSoft: string;
  accentGlow: string;
}> = ({
  categoryId,
  unlocked,
  tierMetal,
  accentPrimary,
  accentSoftBg,
  accentBorderSoft,
  accentGlow,
}) => {
  const strokeColor = !unlocked
    ? '#52525B'
    : tierMetal === 'kong_lime'
    ? accentPrimary
    : tierMetal === 'titanium'
    ? '#E4E4E7'
    : '#A1A1AA';

  return (
    <div
      className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-transform ${
        unlocked
          ? tierMetal === 'kong_lime'
            ? 'bg-[#171717]'
            : 'bg-gradient-to-br from-[#27272A] via-[#171717] to-[#090909] border-[#A1A1AA]/60'
          : 'bg-[#090909] border-[#303030] opacity-60'
      }`}
      style={
        unlocked && tierMetal === 'kong_lime'
          ? {
              backgroundImage: `linear-gradient(135deg, ${accentSoftBg}, #171717 55%, #090909)`,
              borderColor: accentBorderSoft,
              boxShadow: `0 0 16px ${accentGlow}`,
            }
          : undefined
      }
    >
      <svg
        viewBox="0 0 48 48"
        fill="none"
        className="w-7 h-7"
        aria-hidden="true"
      >
        {/* Escudo hexagonal metálico de precisión */}
        <polygon
          points="24,4 41,13 41,35 24,44 7,35 7,13"
          stroke={strokeColor}
          strokeWidth="2.4"
          fill={unlocked ? accentSoftBg : 'none'}
        />
        {categoryId === 'disciplina_acero' && (
          <path
            d="M16 24l5 5 11-11"
            stroke={accentPrimary}
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {categoryId === 'fuerza_elite' && (
          <path
            d="M14 24h20M17 19v10M31 19v10M13 21v6M35 21v6"
            stroke={accentPrimary}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        )}
        {categoryId === 'instinto_kong' && (
          <path
            d="M24 13l7 11h-5l3 11-12-13h5l-3-9z"
            stroke={accentPrimary}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        )}
        {categoryId === 'constancia' && (
          <path
            d="M15 28l6-6 4 4 8-8M27 18h6v6"
            stroke={strokeColor}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {categoryId === 'dominio_tecnico' && (
          <>
            <circle cx="24" cy="24" r="7" stroke={strokeColor} strokeWidth="2.2" />
            <circle cx="24" cy="24" r="2.5" fill={accentPrimary} />
          </>
        )}
        {categoryId === 'recuperacion_inteligente' && (
          <path
            d="M24 15v18M15 24h18"
            stroke={accentPrimary}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        )}
        {categoryId === 'progresion_continua' && (
          <path
            d="M16 31V23M24 31V19M32 31V15"
            stroke={accentPrimary}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
        )}
        {categoryId === 'mentalidad_alpha' && (
          <polygon
            points="24,13 33,31 15,31"
            stroke={accentPrimary}
            strokeWidth="2.4"
            fill="none"
          />
        )}
      </svg>
    </div>
  );
};

const RankCrestSvg: React.FC<{
  rankId: EliteRankId;
  sizeClass?: string;
  accentPrimary: string;
  accentSoftBg: string;
  accentBorderSoft: string;
  accentGlow: string;
}> = ({
  rankId,
  sizeClass = 'w-11 h-11',
  accentPrimary,
  accentSoftBg,
  accentBorderSoft,
  accentGlow,
}) => {
  const isTop = rankId === 'KONG' || rankId === 'ALPHA' || rankId === 'ELITE';
  const stroke = isTop ? accentPrimary : '#D4D4D8';
  const chevrons =
    rankId === 'RECRUIT'
      ? 1
      : rankId === 'WARRIOR'
      ? 2
      : rankId === 'TITAN'
      ? 3
      : rankId === 'ELITE'
      ? 4
      : rankId === 'ALPHA'
      ? 5
      : 6;

  return (
    <div
      className={`${sizeClass} rounded-2xl bg-[#090909] border flex items-center justify-center shrink-0`}
      style={{
        borderColor: accentBorderSoft,
        boxShadow: `0 0 16px ${accentGlow}`,
      }}
    >
      <svg viewBox="0 0 48 48" fill="none" className="w-7 h-7" aria-hidden="true">
        <path
          d="M24 4L40 11V24C40 34 32.5 41 24 44C15.5 41 8 34 8 24V11L24 4Z"
          stroke={stroke}
          strokeWidth="2.5"
          fill={accentSoftBg}
        />
        {Array.from({ length: Math.min(3, chevrons) }).map((_, i) => {
          const y = 28 - i * 6;
          return (
            <path
              key={i}
              d={`M17 ${y}L24 ${y - 5}L31 ${y}`}
              stroke={accentPrimary}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
    </div>
  );
};

export const EliteChallengesPanel: React.FC<EliteChallengesPanelProps> = ({
  profile,
  history,
  routines,
  prs,
  periodizationPlan,
  variant = 'full',
  isRestTimerActive = false,
  onNavigateToProgreso,
}) => {
  const { themeConfig } = useTheme();
  const [challengeFilter, setChallengeFilter] = useState<'all' | 'weekly' | 'monthly'>('all');
  const [selectedCardType, setSelectedCardType] = useState<SocialCardType>('weekly_summary');
  const [selectedCardFormat, setSelectedCardFormat] = useState<SocialCardFormat>('story_9_16');
  const [includeAthleteAlias, setIncludeAthleteAlias] = useState<boolean>(false);
  const [previewPngUrl, setPreviewPngUrl] = useState<string | null>(null);
  const [isExportingCard, setIsExportingCard] = useState<boolean>(false);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const [showXpLedger, setShowXpLedger] = useState<boolean>(false);

  const spokenEventKeysRef = useRef<Set<string>>(new Set());
  const platformAdapter = useMemo(() => createDefaultEliteChallengesPlatformAdapter(), []);

  const snapshot: EliteChallengesProfileSnapshot = useMemo(
    () =>
      computeEliteChallengesSnapshot({
        profile: {
          id: profile?.id || 'default',
          name: profile?.name || 'Atleta',
          weeklyTargetDays: profile?.weeklyTargetDays || 4,
        },
        history,
        routines,
        prs,
        periodizationPlan,
        includeAthleteAliasInCards: includeAthleteAlias,
      }),
    [profile?.id, profile?.name, profile?.weeklyTargetDays, history, routines, prs, periodizationPlan, includeAthleteAlias]
  );

  const filteredChallenges = useMemo(() => {
    if (challengeFilter === 'all') return snapshot.challenges;
    return snapshot.challenges.filter((c) => c.cadence === challengeFilter);
  }, [snapshot.challenges, challengeFilter]);

  const activeCardPayload = useMemo(() => {
    const base = snapshot.socialCardPresets[selectedCardType] || snapshot.socialCardPresets.weekly_summary;
    return withSocialCardFormat(base, selectedCardFormat, includeAthleteAlias, profile?.name);
  }, [snapshot.socialCardPresets, selectedCardType, selectedCardFormat, includeAthleteAlias, profile?.name]);

  const handleSpeakRecognition = (rec: CoachRecognitionMessage) => {
    const res = speakEliteChallengeRecognition({
      recognition: rec,
      isRestTimerActive,
      spokenEventKeys: spokenEventKeysRef.current,
    });
    if (!res.spoken && res.reason === 'rest_timer_active_protected') {
      setStatusFeedback('Temporizador de descanso activo: audio pospuesto para no interrumpir tu alarma.');
    } else if (!res.spoken && res.reason === 'silent_mode') {
      setStatusFeedback('Modo de voz Silencioso activo. Cambia a Importantes o Completo para escuchar al Coach.');
    } else {
      setStatusFeedback(`Coach LazcaKong IA: «${rec.headline}»`);
    }
  };

  const handlePreviewCardPng = async () => {
    setIsExportingCard(true);
    try {
      const rendered = await platformAdapter.exportCardToPngDataUrl(activeCardPayload);
      setPreviewPngUrl(rendered.dataUrl);
      setStatusFeedback(
        `Previsualización generada (${rendered.width} × ${rendered.height} px · PNG oficial).`
      );
    } finally {
      setIsExportingCard(false);
    }
  };

  const handleDownloadCardPng = async () => {
    setIsExportingCard(true);
    try {
      const rendered = await platformAdapter.exportCardToPngDataUrl(activeCardPayload);
      setPreviewPngUrl(rendered.dataUrl);
      await platformAdapter.triggerDownloadPng(rendered.dataUrl, rendered.fileName);
      setStatusFeedback(`Tarjeta PNG descargada: ${rendered.fileName}`);
    } finally {
      setIsExportingCard(false);
    }
  };

  const handleShareCardPng = async () => {
    setIsExportingCard(true);
    try {
      const rendered = await platformAdapter.exportCardToPngDataUrl(activeCardPayload);
      setPreviewPngUrl(rendered.dataUrl);
      const outcome = await platformAdapter.shareCardPng(
        activeCardPayload,
        rendered.dataUrl,
        rendered.fileName
      );
      if (outcome.shared) {
        setStatusFeedback(
          outcome.method === 'download_fallback'
            ? `Tarjeta descargada lista para publicar (${rendered.width}×${rendered.height} px).`
            : 'Tarjeta compartida correctamente.'
        );
      }
    } finally {
      setIsExportingCard(false);
    }
  };

  // =========================================================================
  // MODO COMPACTO (PARA INICIO / TODAYVIEW)
  // =========================================================================
  if (variant === 'compact') {
    const topChallenge =
      snapshot.challenges.find((c) => !c.isCompleted) || snapshot.challenges[0];

    return (
      <section
        data-testid="today-elite-challenges-card"
        className="p-4 sm:p-5 rounded-[22px] bg-[#171717] border border-[#303030] shadow-lg space-y-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <RankCrestSvg
              rankId={snapshot.currentRank.id}
              sizeClass="w-11 h-11"
              accentPrimary={themeConfig.primary}
              accentSoftBg={themeConfig.softBg}
              accentBorderSoft={themeConfig.borderSoft}
              accentGlow={themeConfig.glow}
            />
            <div className="min-w-0">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-accent-text">
                ELITE CHALLENGES PRO · RANGO ACTUAL
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black italic uppercase tracking-tight text-[#F5F5F5] leading-none">
                  {snapshot.currentRank.title}
                </h3>
                <span className="text-xs font-mono font-bold text-accent-text tabular-nums">
                  {snapshot.totalXp.toLocaleString('es-CL')} XP
                </span>
              </div>
            </div>
          </div>

          {onNavigateToProgreso && (
            <button
              type="button"
              onClick={onNavigateToProgreso}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#090909] hover:border-accent border border-[#303030] text-xs font-bold text-accent-text inline-flex items-center gap-1 shrink-0 cursor-pointer active:scale-95"
            >
              <span>Ver logros</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Barra de progreso hacia el siguiente rango */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-zinc-400 tabular-nums">
            <span>
              {snapshot.nextRank
                ? `Progreso a ${snapshot.nextRank.title}`
                : 'Rango Máximo KONG Alcanzado'}
            </span>
            <span className="font-mono font-bold text-[#F5F5F5]">
              {snapshot.rankProgressPct}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-[#090909] border border-[#303030] overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${snapshot.rankProgressPct}%` }}
            />
          </div>
        </div>

        {/* Resumen en línea sin píldoras decorativas */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-zinc-300 tabular-nums">
          <div>
            <span>Desafíos: </span>
            <strong className="text-[#F5F5F5]">
              {snapshot.completedChallengesCount}/{snapshot.challenges.length}
            </strong>
            <span className="mx-2 text-zinc-600">·</span>
            <span>Insignias: </span>
            <strong className="text-[#F5F5F5]">
              {snapshot.unlockedBadgesCount}/{snapshot.badges.length}
            </strong>
          </div>

          {topChallenge && (
            <span className="text-[11px] text-accent-text font-semibold truncate max-w-[220px]">
              {topChallenge.title}: {topChallenge.currentValue}/{topChallenge.targetValue}
            </span>
          )}
        </div>
      </section>
    );
  }

  // =========================================================================
  // MODO COMPLETO (PARA PROGRESOVIEW)
  // =========================================================================
  return (
    <section
      data-testid="progreso-elite-challenges-pro"
      className="bg-[#171717] border border-[#303030] rounded-2xl p-4 sm:p-6 space-y-6 text-[#F5F5F5]"
    >
      {/* CABECERA PRINCIPAL Y RANGO ACTIVO */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#303030] pb-5">
        <div className="flex items-start sm:items-center gap-3.5">
          <RankCrestSvg
            rankId={snapshot.currentRank.id}
            sizeClass="w-14 h-14"
            accentPrimary={themeConfig.primary}
            accentSoftBg={themeConfig.softBg}
            accentBorderSoft={themeConfig.borderSoft}
            accentGlow={themeConfig.glow}
          />
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wider text-accent-text">
              01. Elite Challenges Pro · Sistema de Experiencia y Rangos
            </div>
            <h2 className="text-xl sm:text-2xl font-black italic uppercase tracking-tight text-[#F5F5F5] mt-0.5">
              RANGO {snapshot.currentRank.title} · {snapshot.totalXp.toLocaleString('es-CL')} XP
            </h2>
            <p className="text-xs text-zinc-400 mt-1">{snapshot.currentRank.motto}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowXpLedger((prev) => !prev)}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#090909] hover:border-accent border border-[#303030] text-xs font-bold text-[#F5F5F5] cursor-pointer transition-colors whitespace-nowrap"
          >
            {showXpLedger ? 'Ocultar Auditoría XP' : 'Ver Auditoría XP Verificado'}
          </button>
          {snapshot.coachRecognitions[0] && (
            <button
              type="button"
              onClick={() => handleSpeakRecognition(snapshot.coachRecognitions[0])}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs inline-flex items-center gap-1.5 cursor-pointer active:scale-95 whitespace-nowrap"
            >
              <Volume2 className="w-4 h-4 shrink-0" />
              <span>Escuchar Reconocimiento Coach</span>
            </button>
          )}
        </div>
      </div>

      {statusFeedback && (
        <div className="p-3 rounded-xl bg-[#090909] border border-accent/60 text-xs text-accent-text flex items-center justify-between gap-2">
          <span>{statusFeedback}</span>
          <button
            type="button"
            onClick={() => setStatusFeedback(null)}
            className="text-zinc-400 hover:text-white font-bold text-xs cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* ESCALA DE LOS 6 RANGOS DEPORTIVOS */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-300 tabular-nums">
          <span>
            {snapshot.nextRank
              ? `Faltan ${(
                  snapshot.nextRank.minXp - snapshot.totalXp
                ).toLocaleString('es-CL')} XP para alcanzar el rango ${snapshot.nextRank.title}`
              : 'Has alcanzado la cima deportiva: Rango KONG'}
          </span>
          <span className="font-mono font-bold text-accent-text">
            Progreso de Rango: {snapshot.rankProgressPct}%
          </span>
        </div>

        <div className="w-full h-2.5 rounded-full bg-[#090909] border border-[#303030] overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${snapshot.rankProgressPct}%` }}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
          {ELITE_RANKS.map((r) => {
            const isCurrent = r.id === snapshot.currentRank.id;
            const isUnlocked = snapshot.totalXp >= r.minXp;
            return (
              <div
                key={r.id}
                className={`p-3 rounded-xl border transition-colors ${
                  isCurrent
                    ? 'bg-[#090909] border-accent'
                    : isUnlocked
                    ? 'bg-[#090909]/80 border-[#303030]'
                    : 'bg-[#090909]/40 border-[#303030]/60 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`text-xs font-black uppercase tracking-wider ${
                      isCurrent ? 'text-accent-text' : 'text-[#F5F5F5]'
                    }`}
                  >
                    {r.title}
                  </span>
                  {isUnlocked && <CheckCircle2 className="w-3.5 h-3.5 text-accent-text shrink-0" />}
                </div>
                <div className="text-[11px] font-mono text-zinc-400 mt-1 tabular-nums">
                  {r.minXp.toLocaleString('es-CL')} XP
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-zinc-400">
          Protección anti-sobreentrenamiento e idempotencia activa: el sistema solo premia sesiones verificadas, esfuerzo controlado y semanas de descarga, bloqueando XP duplicado por sincronizaciones, ediciones o respaldos.
        </p>

        {showXpLedger && (
          <div className="p-3.5 rounded-xl bg-[#090909] border border-[#303030] space-y-2 max-h-60 overflow-y-auto">
            <div className="flex items-center justify-between text-xs font-bold text-zinc-300 pb-1 border-b border-[#303030]">
              <span>Eventos Deportivos Verificados ({snapshot.xpLedger.length})</span>
              <span className="font-mono text-accent-text tabular-nums">
                Total: {snapshot.totalXp.toLocaleString('es-CL')} XP
              </span>
            </div>
            {snapshot.xpLedger.length === 0 ? (
              <p className="text-xs text-zinc-400 py-2">
                Completa tu primer entrenamiento para registrar experiencia verificada.
              </p>
            ) : (
              snapshot.xpLedger
                .slice()
                .reverse()
                .slice(0, 15)
                .map((ev) => (
                  <div
                    key={ev.canonicalEventKey}
                    className="flex items-center justify-between gap-2 text-xs py-1 border-b border-[#303030]/50 last:border-none"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-[#F5F5F5] block truncate">
                        {ev.label}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        {ev.dateKey} · {ev.detail}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-accent-text shrink-0 tabular-nums">
                      +{ev.xpAwarded} XP
                    </span>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      {/* 2. DESAFÍOS DEPORTIVOS SEMANALES Y MENSUALES */}
      <div className="space-y-3 pt-2 border-t border-[#303030]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base sm:text-lg font-black italic uppercase tracking-tight text-[#F5F5F5]">
              02. Desafíos Deportivos ({snapshot.completedChallengesCount}/{snapshot.challenges.length})
            </h3>
            <p className="text-xs text-zinc-400">
              Adaptados a tu planificación ({profile?.weeklyTargetDays || 4} días/semana) sin penalizar períodos de descanso ni descargas.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#090909] border border-[#303030] self-start">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'weekly', label: 'Semanales' },
                { id: 'monthly', label: 'Mensuales' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setChallengeFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  challengeFilter === tab.id
                    ? 'bg-accent text-accent-contrast font-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredChallenges.map((ch) => (
            <div
              key={ch.id}
              className={`p-4 rounded-xl bg-[#090909] border flex flex-col justify-between gap-3 ${
                ch.isCompleted ? 'border-accent/75' : 'border-[#303030]'
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-400 tabular-nums">
                  <span>
                    {ch.cadence === 'weekly' ? 'Desafío Semanal' : 'Desafío Mensual'} · +{ch.xpReward} XP
                  </span>
                  <span className={ch.isCompleted ? 'text-accent-text font-bold' : 'text-zinc-400'}>
                    {ch.isCompleted ? 'Completado' : `${ch.progressPct}%`}
                  </span>
                </div>
                <h4 className="text-sm font-black text-[#F5F5F5]">{ch.title}</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">{ch.description}</p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs tabular-nums">
                  <span className="text-zinc-400">{ch.safetyNote}</span>
                  <span className="font-mono font-bold text-[#F5F5F5] shrink-0 ml-2">
                    {ch.currentValue}/{ch.targetValue} {ch.unitLabel}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-[#171717] border border-[#303030] overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300"
                    style={{ width: `${ch.progressPct}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. INSIGNIAS PREMIUM (8 CATEGORÍAS METÁLICAS) */}
      <div className="space-y-3 pt-2 border-t border-[#303030]">
        <div>
          <h3 className="text-base sm:text-lg font-black italic uppercase tracking-tight text-[#F5F5F5]">
            03. Insignias Premium ({snapshot.unlockedBadgesCount}/{snapshot.badges.length})
          </h3>
          <p className="text-xs text-zinc-400">
            Colección metálica grafito y lumínica basada en registros verificados de entrenamiento, control de esfuerzo y planificación.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {snapshot.badges.map((badge) => (
            <div
              key={badge.id}
              className={`p-3.5 rounded-xl bg-[#090909] border flex flex-col justify-between gap-2.5 ${
                badge.unlocked ? 'border-accent/70' : 'border-[#303030]'
              }`}
            >
              <div className="flex items-start gap-3">
                <MetallicBadgeEmblem
                  categoryId={badge.id}
                  unlocked={badge.unlocked}
                  tierMetal={badge.tierMetal}
                  accentPrimary={themeConfig.primary}
                  accentSoftBg={themeConfig.softBg}
                  accentBorderSoft={themeConfig.borderSoft}
                  accentGlow={themeConfig.glow}
                />
                <div className="min-w-0">
                  <div className="text-[11px] text-zinc-400">
                    {badge.categoryLabel} · {badge.unlocked ? 'Desbloqueada' : `${badge.progressPct}%`}
                  </div>
                  <h4 className="text-sm font-black text-[#F5F5F5] truncate mt-0.5">
                    {badge.title}
                  </h4>
                  <div className="text-xs font-mono text-accent-text mt-0.5 tabular-nums">
                    {badge.currentMetricLabel}
                  </div>
                </div>
              </div>

              <div className="space-y-1 pt-1 border-t border-[#303030]/60">
                <p className="text-xs text-zinc-300 leading-snug">{badge.description}</p>
                <p className="text-[11px] text-zinc-500 leading-snug">
                  {badge.verificationBasisNote}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. TARJETAS PARA REDES SOCIALES (EXPORTACIÓN PNG 1080×1920 Y 1080×1350) */}
      <div className="space-y-4 pt-2 border-t border-[#303030]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base sm:text-lg font-black italic uppercase tracking-tight text-[#F5F5F5]">
              04. Tarjetas Oficiales para Redes Sociales (PNG)
            </h3>
            <p className="text-xs text-zinc-400">
              Exporta tus logros en alta resolución con el logotipo y dirección oficial de LAZCAKONG GYM. Privacidad protegida por defecto.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#090909] border border-[#303030] self-start">
            <button
              type="button"
              onClick={() => setSelectedCardFormat('story_9_16')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap ${
                selectedCardFormat === 'story_9_16'
                  ? 'bg-accent text-accent-contrast font-black'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Stories / Reels (1080×1920)
            </button>
            <button
              type="button"
              onClick={() => setSelectedCardFormat('post_4_5')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap ${
                selectedCardFormat === 'post_4_5'
                  ? 'bg-accent text-accent-contrast font-black'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Publicación (1080×1350)
            </button>
          </div>
        </div>

        {/* Selector de los 6 tipos de tarjeta */}
        <div className="flex flex-wrap gap-2">
          {CARD_TYPE_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSelectedCardType(item.id);
                setPreviewPngUrl(null);
              }}
              className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer whitespace-nowrap ${
                selectedCardType === item.id
                  ? 'bg-accent text-accent-contrast border-accent font-black'
                  : 'bg-[#090909] text-zinc-300 border-[#303030] hover:border-accent/60'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Vista previa interactiva y controles de privacidad + exportación */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Tarjeta de Previsualización en Vivo */}
          <div className="lg:col-span-7 p-4 sm:p-5 rounded-2xl bg-[#090909] border border-[#303030] space-y-4">
            <div className="flex items-center justify-between gap-3 border-b border-[#303030] pb-3">
              <div className="flex items-center gap-2.5">
                <img
                  src={activeCardPayload.officialLogoPath}
                  alt="LAZCAKONG GYM"
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 object-contain shrink-0"
                />
                <div>
                  <div className="text-sm font-black italic uppercase tracking-tight text-[#F5F5F5]">
                    LAZCAKONG <span className="text-accent-text">GYM</span>
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    ELITE PERFORMANCE · {activeCardPayload.widthPx}×{activeCardPayload.heightPx} PX
                  </div>
                </div>
              </div>
              <span className="text-xs font-black text-accent-text uppercase">
                RANGO {activeCardPayload.rankTitle}
              </span>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-extrabold uppercase tracking-wider text-accent-text">
                {activeCardPayload.headline}
              </div>
              <div className="text-lg sm:text-xl font-black italic uppercase text-[#F5F5F5]">
                {activeCardPayload.subheadline}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#171717] border border-[#303030]">
              <div className="text-2xl sm:text-3xl font-black font-mono text-accent-text tabular-nums">
                {activeCardPayload.primaryMetricValue}
              </div>
              <div className="text-xs font-bold text-zinc-300 mt-1">
                {activeCardPayload.primaryMetricLabel}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {activeCardPayload.secondaryMetrics.map((m, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-[#171717] border border-[#303030]"
                >
                  <div className="text-[10px] font-bold uppercase text-zinc-400">{m.label}</div>
                  <div className="text-sm font-black font-mono text-[#F5F5F5] mt-0.5 tabular-nums">
                    {m.value}
                  </div>
                </div>
              ))}
            </div>

            {activeCardPayload.includeAthleteAlias && activeCardPayload.athleteAlias && (
              <div className="text-xs font-bold text-zinc-300">
                ATLETA: {activeCardPayload.athleteAlias.toUpperCase()}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#303030] text-[11px] font-mono text-zinc-400">
              <span className="truncate">{activeCardPayload.officialAppUrl}</span>
              <span className="text-accent-text shrink-0">{activeCardPayload.dateLabel}</span>
            </div>
          </div>

          {/* Controles de Privacidad y Exportación Explícita */}
          <div className="lg:col-span-5 p-4 rounded-2xl bg-[#090909] border border-[#303030] space-y-4">
            <div className="space-y-1">
              <h4 className="text-sm font-black uppercase text-[#F5F5F5]">
                Opciones de Exportación y Privacidad
              </h4>
              <p className="text-xs text-zinc-400">
                Por defecto no se incluyen datos personales ni tu nombre de perfil en la imagen exportada.
              </p>
            </div>

            <label className="flex items-center gap-2.5 text-xs text-zinc-200 cursor-pointer select-none min-h-[40px]">
              <input
                type="checkbox"
                checked={includeAthleteAlias}
                onChange={(e) => {
                  setIncludeAthleteAlias(e.target.checked);
                  setPreviewPngUrl(null);
                }}
                style={{ accentColor: 'var(--accent-primary)' }}
                className="w-4 h-4 rounded cursor-pointer"
              />
              <span>Incluir mi alias deportivo ({profile?.name || 'Atleta'}) en la tarjeta</span>
            </label>

            <div className="space-y-2">
              <button
                type="button"
                disabled={isExportingCard}
                onClick={handlePreviewCardPng}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#171717] hover:border-accent border border-[#303030] text-xs font-bold text-[#F5F5F5] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Eye className="w-4 h-4 text-accent-text" />
                <span>Previsualizar PNG ({activeCardPayload.widthPx}×{activeCardPayload.heightPx})</span>
              </button>

              <button
                type="button"
                disabled={isExportingCard}
                onClick={handleDownloadCardPng}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Descargar Tarjeta PNG</span>
              </button>

              <button
                type="button"
                disabled={isExportingCard}
                onClick={handleShareCardPng}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#171717] hover:border-accent border border-[#303030] text-xs font-bold text-accent-text inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Share2 className="w-4 h-4" />
                <span>Compartir Logro</span>
              </button>
            </div>

            {previewPngUrl && (
              <div className="pt-3 border-t border-[#303030] space-y-2">
                <div className="text-[11px] font-bold text-zinc-400">
                  Renderizado PNG generado ({activeCardPayload.widthPx}×{activeCardPayload.heightPx} px):
                </div>
                <img
                  src={previewPngUrl}
                  alt="Previsualización de tarjeta social PNG"
                  referrerPolicy="no-referrer"
                  className="w-full max-h-64 object-contain rounded-xl border border-[#303030] bg-[#171717]"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default EliteChallengesPanel;
