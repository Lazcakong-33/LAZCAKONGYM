import React, { useState, useMemo, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Dumbbell,
  Eye,
  Flame,
  Info,
  Layers,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { CompletedWorkout, Routine } from '../types';
import { useTheme } from '../context/ThemeContext';
import {
  BiometricMuscleId,
  CanonicalMuscleId,
  computeOverallAthleteSummary,
  computeRealTimeRecovery,
  MUSCLE_CONFIG,
  MuscleRecoveryState,
} from '../utils/muscleRecoveryEngine';

export interface BiometricMuscleScannerProps {
  history?: CompletedWorkout[];
  routines?: Routine[];
  activeDay?: string;
  selectedMuscle?: string | null;
  onSelectMuscle?: (id: any) => void;
  [key: string]: any;
}

export const BiometricMuscleScanner: React.FC<BiometricMuscleScannerProps> = ({
  history = [],
  routines = [],
  activeDay = 'Toda la Semana',
  selectedMuscle: externalSelectedMuscle,
  onSelectMuscle,
}) => {
  const { themeConfig } = useTheme();
  // Selector de Modo: 'real' (Historial real acumulado en tiempo real) vs 'preview' (Rutina programada)
  const [analysisMode, setAnalysisMode] = useState<'real' | 'preview'>('real');
  const [previewDay, setPreviewDay] = useState<string>(activeDay || 'Lunes');
  const [selectedMuscleId, setSelectedMuscleId] = useState<BiometricMuscleId>('chest_left');
  const [hoveredMuscleId, setHoveredMuscleId] = useState<BiometricMuscleId | null>(null);
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);
  const [clockTick, setClockTick] = useState<number>(Date.now());

  // Actualizar reloj cada minuto para mantener el cálculo de cuenta regresiva en vivo
  useEffect(() => {
    const timer = setInterval(() => {
      setClockTick(Date.now());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Sincronizar selección externa si se provee
  useEffect(() => {
    if (externalSelectedMuscle && externalSelectedMuscle in MUSCLE_CONFIG) {
      setSelectedMuscleId(externalSelectedMuscle as BiometricMuscleId);
    }
  }, [externalSelectedMuscle]);

  // Si no se pasaron props de historial o están vacías, intentar recuperar de localStorage
  const effectiveHistory = useMemo<CompletedWorkout[]>(() => {
    if (Array.isArray(history) && history.length > 0) {
      return history;
    }
    try {
      const activeProfileId = localStorage.getItem('lazcakon_active_profile_id') || 'perfil_1';
      const stored = localStorage.getItem(`lazcakon_${activeProfileId}_history`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Ignorar fallback
    }
    return [];
  }, [history]);

  // Si no se pasaron rutinas, recuperar de localStorage
  const effectiveRoutines = useMemo<Routine[]>(() => {
    if (Array.isArray(routines) && routines.length > 0) {
      return routines;
    }
    try {
      const activeProfileId = localStorage.getItem('lazcakon_active_profile_id') || 'perfil_1';
      const stored = localStorage.getItem(`lazcakon_${activeProfileId}_routines`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Ignorar fallback
    }
    return [];
  }, [routines]);

  // Cálculo del motor de recuperación en tiempo real
  const recoveryReport = useMemo(() => {
    const filterArg = analysisMode === 'preview' ? previewDay : 'ALL';
    return computeRealTimeRecovery(effectiveHistory, clockTick, effectiveRoutines, filterArg);
  }, [effectiveHistory, effectiveRoutines, analysisMode, previewDay, clockTick]);

  // Resumen integral del atleta
  const athleteSummary = useMemo(() => {
    return computeOverallAthleteSummary(recoveryReport);
  }, [recoveryReport]);

  const activeMuscleData: MuscleRecoveryState =
    recoveryReport[selectedMuscleId] || recoveryReport['chest_left'];

  // Manejar click en músculo
  const handleMuscleClick = (mId: BiometricMuscleId) => {
    setSelectedMuscleId(mId);
    setShowDetailModal(true);
    if (onSelectMuscle) {
      onSelectMuscle(mId);
    }
  };

  // Estilos de trazado SVG con los 5 colores exactos:
  // - Gris (#71717A): Sin fatiga registrada / 100% Recuperado
  // - Verde (#10B981): Fatiga baja (1% a 30%)
  // - Amarillo (#FACC15): Fatiga moderada (31% a 60%)
  // - Naranja (#F97316): Fatiga alta (61% a 80%)
  // - Rojo (#EF4444): Fatiga muy alta (> 80%)
  const getPathSvgProps = (id: BiometricMuscleId) => {
    const isSelected = selectedMuscleId === id;
    const isHovered = hoveredMuscleId === id;
    const data = recoveryReport[id];
    const fatigue = data ? data.fatigue : 0;
    const baseColor = data ? data.statusColor : '#71717A';

    let fill = baseColor;
    let fillOpacity = 0.45;
    let stroke = baseColor;
    let strokeWidth = '1.5';
    let filter = 'none';

    if (fatigue === 0) {
      fill = '#71717A';
      fillOpacity = 0.18;
      stroke = 'rgba(113, 113, 122, 0.4)';
      strokeWidth = '1';
    } else if (fatigue <= 30) {
      fill = '#10B981';
      fillOpacity = 0.5;
      stroke = '#34D399';
      strokeWidth = '1.8';
      filter = 'drop-shadow(0 0 6px rgba(16, 185, 129, 0.45))';
    } else if (fatigue <= 60) {
      fill = '#FACC15';
      fillOpacity = 0.55;
      stroke = '#FDE047';
      strokeWidth = '2';
      filter = 'drop-shadow(0 0 8px rgba(250, 204, 21, 0.55))';
    } else if (fatigue <= 80) {
      fill = '#F97316';
      fillOpacity = 0.6;
      stroke = '#FB923C';
      strokeWidth = '2';
      filter = 'drop-shadow(0 0 9px rgba(249, 115, 22, 0.65))';
    } else {
      fill = '#EF4444';
      fillOpacity = 0.65;
      stroke = '#F87171';
      strokeWidth = '2.2';
      filter = 'drop-shadow(0 0 10px rgba(239, 68, 68, 0.75))';
    }

    if (isHovered) {
      stroke = '#00F0FF';
      strokeWidth = '2.5';
      fillOpacity = Math.min(0.85, fillOpacity + 0.2);
      filter = 'drop-shadow(0 0 12px rgba(0, 240, 255, 0.85))';
    }

    if (isSelected) {
      stroke = themeConfig.primary;
      strokeWidth = '3';
      fillOpacity = Math.min(0.9, fillOpacity + 0.25);
      filter = `drop-shadow(0 0 14px ${themeConfig.glow})`;
    }

    const hasFatiguePulse = fatigue > 20 || isSelected;

    return {
      fill,
      fillOpacity,
      stroke,
      strokeWidth,
      filter,
      className: `cursor-pointer transition-all duration-300 ${
        hasFatiguePulse ? 'animate-pulse' : ''
      }`,
    };
  };

  const daysList = [
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
    'Domingo',
    'Toda la Semana',
  ];

  return (
    <div className="w-full bg-[#070A0F] border border-zinc-800 rounded-3xl p-4 sm:p-7 my-5 shadow-2xl space-y-6">
      {/* =========================================================================
          ENCABEZADO PRINCIPAL & SELECTOR DE MODO
         ========================================================================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-[10px] uppercase tracking-widest text-cyan-400 font-mono font-bold">
              BIOMETRIC SCAN • REAL-TIME RECOVERY & FATIGUE
            </span>
          </div>
          <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            MAPA ANATÓMICO 3D & RECUPERACIÓN EN TIEMPO REAL
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            {analysisMode === 'real'
              ? 'Basado en los entrenamientos completados del atleta y degradación temporal biológica.'
              : `Previsualización de impacto para: ${previewDay}`}
          </p>
        </div>

        {/* Toggle Modo Real vs Modo Previsualización */}
        <div className="flex items-center bg-zinc-900/90 p-1 rounded-2xl border border-zinc-800 self-start md:self-auto shadow-inner">
          <button
            type="button"
            onClick={() => setAnalysisMode('real')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              analysisMode === 'real'
                ? 'bg-cyan-500 text-zinc-950 shadow-md shadow-cyan-500/20'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Estado Real (Historial)</span>
          </button>
          <button
            type="button"
            onClick={() => setAnalysisMode('preview')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              analysisMode === 'preview'
                ? 'bg-amber-400 text-zinc-950 shadow-md shadow-amber-400/20'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Previsualizar Rutina</span>
          </button>
        </div>
      </div>

      {/* Selector de días cuando está en modo Previsualización */}
      {analysisMode === 'preview' && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-amber-300 font-bold flex items-center gap-1.5">
              <Info className="w-4 h-4" />
              Simulación de Fatiga Planificada:
            </span>
            <span className="text-[11px] text-amber-200/80 font-mono">
              No altera el historial real del atleta
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {daysList.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => setPreviewDay(day)}
                className={`px-3 py-1 rounded-xl text-xs font-medium transition-all ${
                  previewDay === day
                    ? 'bg-amber-400 text-zinc-950 font-bold'
                    : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border border-zinc-800'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* =========================================================================
          TARJETA DE RESUMEN GENERAL DEL ATLETA
         ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 1. Estado Sistémico General */}
        <div className="bg-[#05080c] p-4 rounded-2xl border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase text-zinc-400 font-semibold tracking-wider">
              Disponibilidad General
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono border ${
                athleteSummary.overallStatusTone === 'emerald'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : athleteSummary.overallStatusTone === 'amber'
                  ? 'bg-amber-400/15 text-amber-300 border-amber-400/30'
                  : athleteSummary.overallStatusTone === 'rose'
                  ? 'bg-red-500/15 text-red-400 border-red-500/30'
                  : 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
              }`}
            >
              {athleteSummary.systemicFatigue <= 35
                ? 'LISTO PARA ENTRENAR'
                : athleteSummary.systemicFatigue <= 60
                ? 'RECUPERACIÓN ACTIVA'
                : 'DESCANSO RECOMENDADO'}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-white">
              {athleteSummary.overallRecoveryPct}%
            </span>
            <span className="text-xs text-zinc-400 font-mono">Recuperación Sistémica</span>
          </div>
          <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full transition-all duration-700 ${
                athleteSummary.overallRecoveryPct >= 70
                  ? 'bg-emerald-400'
                  : athleteSummary.overallRecoveryPct >= 40
                  ? 'bg-amber-400'
                  : 'bg-red-400'
              }`}
              style={{ width: `${athleteSummary.overallRecoveryPct}%` }}
            />
          </div>
        </div>

        {/* 2. Conteo de Estados Musculares */}
        <div className="bg-[#05080c] p-4 rounded-2xl border border-zinc-800/80 flex items-center justify-around">
          <div className="text-center">
            <span className="text-[10px] font-mono uppercase text-zinc-400 block mb-0.5">
              100% Listos
            </span>
            <span className="text-xl font-black text-emerald-400">
              {athleteSummary.recoveredCount}
            </span>
            <span className="text-[9px] text-zinc-400 block">músculos</span>
          </div>
          <div className="w-px h-8 bg-zinc-800" />
          <div className="text-center">
            <span className="text-[10px] font-mono uppercase text-zinc-400 block mb-0.5">
              Recuperando
            </span>
            <span className="text-xl font-black text-amber-400">
              {athleteSummary.inRecoveryCount}
            </span>
            <span className="text-[9px] text-zinc-400 block">en proceso</span>
          </div>
          <div className="w-px h-8 bg-zinc-800" />
          <div className="text-center">
            <span className="text-[10px] font-mono uppercase text-zinc-400 block mb-0.5">
              Fatiga Alta
            </span>
            <span className="text-xl font-black text-red-400">
              {athleteSummary.highFatigueCount}
            </span>
            <span className="text-[9px] text-zinc-400 block">requieren reposo</span>
          </div>
        </div>

        {/* 3. Próximos Músculos Disponibles para Entrenar */}
        <div className="bg-[#05080c] p-4 rounded-2xl border border-zinc-800/80 space-y-1.5">
          <span className="text-[10px] font-mono uppercase text-emerald-400 font-semibold tracking-wider flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Músculos Listos para Entrenar:
          </span>
          <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto pr-1">
            {athleteSummary.nextAvailableMuscles.slice(0, 4).map((m) => (
              <span
                key={m.canonicalId}
                className="px-2 py-0.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-200 font-mono"
              >
                {m.name}
              </span>
            ))}
            {athleteSummary.nextAvailableMuscles.length === 0 && (
              <span className="text-[11px] text-zinc-400 italic">
                Carga acumulada en todo el cuerpo
              </span>
            )}
          </div>
        </div>

        {/* 4. Cuenta regresiva al próximo músculo */}
        <div className="bg-[#05080c] p-4 rounded-2xl border border-zinc-800/80 space-y-1.5">
          <span className="text-[10px] font-mono uppercase text-cyan-400 font-semibold tracking-wider flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            Próxima Recuperación Plena:
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black text-white font-mono">
              {athleteSummary.earliestNextFullRecoveryHours &&
              athleteSummary.earliestNextFullRecoveryHours > 0
                ? `~${athleteSummary.earliestNextFullRecoveryHours}h`
                : '100% Recuperado'}
            </span>
            <span className="text-[11px] text-zinc-400">
              {athleteSummary.earliestNextFullRecoveryHours &&
              athleteSummary.earliestNextFullRecoveryHours > 0
                ? 'hasta reposo total'
                : 'sin deuda motora'}
            </span>
          </div>
          <p className="text-[10px] text-zinc-400 leading-tight">
            Tasa metabólica y síntesis miofibrilar activa.
          </p>
        </div>
      </div>

      {/* =========================================================================
          CANVAS ANATÓMICO PRINCIPAL (IMAGEN UNIFICADA + SVG SOBREPUESTO)
         ========================================================================= */}
      <div className="relative w-full rounded-3xl bg-[#03060a] border border-zinc-800/90 p-4 sm:p-6 overflow-hidden flex flex-col items-center justify-center">
        {/* Fondo sutil de cuadrícula tecnológica */}
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-15 pointer-events-none" />

        {/* Título de Vistas */}
        <div className="w-full max-w-4xl flex items-center justify-between text-xs font-mono font-bold text-zinc-400 mb-3 px-2">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            VISTA ANTERIOR (FRONTAL)
          </span>
          <span className="text-[10px] text-zinc-400 uppercase tracking-widest hidden sm:inline">
            Toca o haz click en cualquier músculo para ver telemetría
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
            VISTA POSTERIOR (DORSAL)
          </span>
        </div>

        {/* Contenedor Único con Proporción de Aspecto 4:3 */}
        <div className="relative w-full max-w-4xl aspect-[4/3] rounded-2xl overflow-hidden bg-[#070A0F] border border-zinc-800/80 shadow-2xl flex items-center justify-center">
          {/* Imagen Unificada que contiene Frontal y Posterior juntos */}
          <img
            src="/assets/aistudio/mapa_interactivo_eed8c94a.jpg"
            alt="Mapa Anatómico Biométrico"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = '/images/anatomia-frontal.png';
            }}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none opacity-90"
          />

          {/* Overlay SVG 1000x750 con coordenadas anatómicas de precisión milimétrica */}
          <svg
            className="absolute inset-0 w-full h-full z-10"
            viewBox="0 0 1000 750"
            preserveAspectRatio="none"
          >
            {/* =====================================================
                1. CUERPO FRONTAL (Izquierda: X 0 a 500)
               ===================================================== */}

            {/* Pectoral Izquierdo */}
            <path
              d="M 252 225 Q 215 220 185 242 Q 178 288 245 288 Q 252 260 252 225 Z"
              {...getPathSvgProps('chest_left')}
              onMouseEnter={() => setHoveredMuscleId('chest_left')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('chest_left')}
            >
              <title>{recoveryReport.chest_left.name}: {recoveryReport.chest_left.fatigue}% Fatiga</title>
            </path>

            {/* Pectoral Derecho */}
            <path
              d="M 258 225 Q 295 220 325 242 Q 332 288 265 288 Q 258 260 258 225 Z"
              {...getPathSvgProps('chest_right')}
              onMouseEnter={() => setHoveredMuscleId('chest_right')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('chest_right')}
            >
              <title>{recoveryReport.chest_right.name}: {recoveryReport.chest_right.fatigue}% Fatiga</title>
            </path>

            {/* Abdomen / Core */}
            <path
              d="M 226 292 L 284 292 L 278 405 Q 255 425 232 405 Z"
              {...getPathSvgProps('abs')}
              onMouseEnter={() => setHoveredMuscleId('abs')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('abs')}
            >
              <title>{recoveryReport.abs.name}: {recoveryReport.abs.fatigue}% Fatiga</title>
            </path>

            {/* Deltoides Frontal Izquierdo */}
            <path
              d="M 180 230 Q 148 242 144 285 Q 166 295 182 265 Z"
              {...getPathSvgProps('deltoid_front_left')}
              onMouseEnter={() => setHoveredMuscleId('deltoid_front_left')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('deltoid_front_left')}
            >
              <title>{recoveryReport.deltoid_front_left.name}</title>
            </path>

            {/* Deltoides Frontal Derecho */}
            <path
              d="M 330 230 Q 362 242 366 285 Q 344 295 328 265 Z"
              {...getPathSvgProps('deltoid_front_right')}
              onMouseEnter={() => setHoveredMuscleId('deltoid_front_right')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('deltoid_front_right')}
            >
              <title>{recoveryReport.deltoid_front_right.name}</title>
            </path>

            {/* Bíceps Izquierdo */}
            <path
              d="M 145 285 Q 135 340 162 365 Q 175 325 168 285 Z"
              {...getPathSvgProps('biceps_left')}
              onMouseEnter={() => setHoveredMuscleId('biceps_left')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('biceps_left')}
            >
              <title>{recoveryReport.biceps_left.name}</title>
            </path>

            {/* Bíceps Derecho */}
            <path
              d="M 365 285 Q 375 340 348 365 Q 335 325 342 285 Z"
              {...getPathSvgProps('biceps_right')}
              onMouseEnter={() => setHoveredMuscleId('biceps_right')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('biceps_right')}
            >
              <title>{recoveryReport.biceps_right.name}</title>
            </path>

            {/* Tríceps Lateral Izquierdo */}
            <path
              d="M 130 290 Q 120 335 142 365 Q 150 330 138 290 Z"
              {...getPathSvgProps('triceps_lateral_left')}
              onMouseEnter={() => setHoveredMuscleId('triceps_lateral_left')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('triceps_lateral_left')}
            >
              <title>{recoveryReport.triceps_lateral_left.name}</title>
            </path>

            {/* Tríceps Lateral Derecho */}
            <path
              d="M 380 290 Q 390 335 368 365 Q 360 330 372 290 Z"
              {...getPathSvgProps('triceps_lateral_right')}
              onMouseEnter={() => setHoveredMuscleId('triceps_lateral_right')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('triceps_lateral_right')}
            >
              <title>{recoveryReport.triceps_lateral_right.name}</title>
            </path>

            {/* Cuádriceps Izquierdo */}
            <path
              d="M 200 415 Q 170 470 188 565 Q 235 565 238 460 Q 235 418 200 415 Z"
              {...getPathSvgProps('quad_left')}
              onMouseEnter={() => setHoveredMuscleId('quad_left')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('quad_left')}
            >
              <title>{recoveryReport.quad_left.name}</title>
            </path>

            {/* Cuádriceps Derecho */}
            <path
              d="M 310 415 Q 340 470 322 565 Q 275 565 272 460 Q 275 418 310 415 Z"
              {...getPathSvgProps('quad_right')}
              onMouseEnter={() => setHoveredMuscleId('quad_right')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('quad_right')}
            >
              <title>{recoveryReport.quad_right.name}</title>
            </path>

            {/* Gemelo Frontal Izquierdo */}
            <path
              d="M 175 585 Q 165 640 182 680 Q 202 640 198 585 Z"
              {...getPathSvgProps('calves_front_left')}
              onMouseEnter={() => setHoveredMuscleId('calves_front_left')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('calves_front_left')}
            >
              <title>{recoveryReport.calves_front_left.name}</title>
            </path>

            {/* Gemelo Frontal Derecho */}
            <path
              d="M 335 585 Q 345 640 328 680 Q 308 640 312 585 Z"
              {...getPathSvgProps('calves_front_right')}
              onMouseEnter={() => setHoveredMuscleId('calves_front_right')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('calves_front_right')}
            >
              <title>{recoveryReport.calves_front_right.name}</title>
            </path>

            {/* =====================================================
                2. CUERPO POSTERIOR (Derecha: X 500 a 1000)
               ===================================================== */}

            {/* Trapecios y Dorsales */}
            <path
              d="M 745 155 Q 710 185 675 225 Q 675 285 690 380 Q 745 425 745 425 Q 745 425 800 380 Q 815 285 815 225 Q 780 185 745 155 Z"
              {...getPathSvgProps('traps_lats')}
              onMouseEnter={() => setHoveredMuscleId('traps_lats')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('traps_lats')}
            >
              <title>{recoveryReport.traps_lats.name}</title>
            </path>

            {/* Tríceps Posterior Izquierdo */}
            <path
              d="M 640 250 Q 625 310 655 355 Q 670 310 655 250 Z"
              {...getPathSvgProps('triceps_back_left')}
              onMouseEnter={() => setHoveredMuscleId('triceps_back_left')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('triceps_back_left')}
            >
              <title>{recoveryReport.triceps_back_left.name}</title>
            </path>

            {/* Tríceps Posterior Derecho */}
            <path
              d="M 850 250 Q 865 310 835 355 Q 820 310 835 250 Z"
              {...getPathSvgProps('triceps_back_right')}
              onMouseEnter={() => setHoveredMuscleId('triceps_back_right')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('triceps_back_right')}
            >
              <title>{recoveryReport.triceps_back_right.name}</title>
            </path>

            {/* Glúteos */}
            <path
              d="M 688 395 Q 675 470 745 475 Q 815 470 802 395 Q 745 420 688 395 Z"
              {...getPathSvgProps('glutes')}
              onMouseEnter={() => setHoveredMuscleId('glutes')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('glutes')}
            >
              <title>{recoveryReport.glutes.name}</title>
            </path>

            {/* Isquios / Femorales Izquierdo */}
            <path
              d="M 685 475 Q 670 540 690 565 Q 725 565 735 480 Z"
              {...getPathSvgProps('hamstrings_left')}
              onMouseEnter={() => setHoveredMuscleId('hamstrings_left')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('hamstrings_left')}
            >
              <title>{recoveryReport.hamstrings_left.name}</title>
            </path>

            {/* Isquios / Femorales Derecho */}
            <path
              d="M 805 475 Q 820 540 800 565 Q 765 565 755 480 Z"
              {...getPathSvgProps('hamstrings_right')}
              onMouseEnter={() => setHoveredMuscleId('hamstrings_right')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('hamstrings_right')}
            >
              <title>{recoveryReport.hamstrings_right.name}</title>
            </path>

            {/* Gemelos Posteriores Izquierdo */}
            <path
              d="M 670 575 Q 652 645 682 685 Q 705 645 700 575 Z"
              {...getPathSvgProps('calves_back_left')}
              onMouseEnter={() => setHoveredMuscleId('calves_back_left')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('calves_back_left')}
            >
              <title>{recoveryReport.calves_back_left.name}</title>
            </path>

            {/* Gemelos Posteriores Derecho */}
            <path
              d="M 820 575 Q 838 645 808 685 Q 785 645 790 575 Z"
              {...getPathSvgProps('calves_back_right')}
              onMouseEnter={() => setHoveredMuscleId('calves_back_right')}
              onMouseLeave={() => setHoveredMuscleId(null)}
              onClick={() => handleMuscleClick('calves_back_right')}
            >
              <title>{recoveryReport.calves_back_right.name}</title>
            </path>
          </svg>
        </div>

        {/* =========================================================================
            LEYENDA DE LOS 5 COLORES NORMATIVOS
           ========================================================================= */}
        <div className="w-full max-w-4xl mt-4 pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-zinc-400">
          <div className="flex flex-wrap items-center gap-3 sm:gap-5">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#71717A] border border-zinc-500/50" />
              <span>Gris: 100% Recuperado</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#10B981] shadow-[0_0_6px_#10B981]" />
              <span>Verde: Baja (1-30%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#FACC15] shadow-[0_0_6px_#FACC15]" />
              <span>Amarillo: Moderada (31-60%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#F97316] shadow-[0_0_6px_#F97316]" />
              <span>Naranja: Alta (61-80%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#EF4444] shadow-[0_0_8px_#EF4444]" />
              <span>Rojo: Muy Alta (&gt;80%)</span>
            </div>
          </div>

          <div className="text-[11px] text-zinc-400">
            Músculo activo:{' '}
            <span className="text-white font-bold">{activeMuscleData.name}</span>
          </div>
        </div>
      </div>

      {/* =========================================================================
          PANEL / DRAWER DE TELEMETRÍA Y DETALLE DEL MÚSCULO SELECCIONADO
         ========================================================================= */}
      <div className="bg-[#05080c] p-5 sm:p-6 rounded-3xl border border-zinc-800 space-y-5">
        {/* Cabecera del Músculo */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
                {activeMuscleData.group === 'front' ? 'VISTA ANTERIOR' : 'VISTA POSTERIOR'} •{' '}
                {activeMuscleData.id}
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono border ${activeMuscleData.badgeClass}`}
              >
                {activeMuscleData.trainingReadiness}
              </span>
            </div>
            <h4 className="text-2xl font-black text-white tracking-tight">
              {activeMuscleData.name}
            </h4>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right font-mono">
              <span className="text-[10px] text-zinc-400 uppercase block">Estado</span>
              <span
                className="text-sm font-bold block"
                style={{ color: activeMuscleData.statusColor }}
              >
                {activeMuscleData.status}
              </span>
            </div>
          </div>
        </div>

        {/* Descripción biomecánica */}
        <p className="text-xs text-zinc-300 bg-[#070A0F] p-3.5 rounded-2xl border border-zinc-800/80 leading-relaxed">
          {activeMuscleData.description}
        </p>

        {/* Calibre de Fatiga y Recuperación */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Fatiga Actual */}
          <div className="bg-[#070A0F] p-4 rounded-2xl border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-400 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-amber-400" />
                <span>Nivel de Fatiga Residual</span>
              </span>
              <span className="font-black text-base" style={{ color: activeMuscleData.statusColor }}>
                {activeMuscleData.fatigue}%
              </span>
            </div>
            <div className="w-full bg-zinc-900 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${activeMuscleData.fatigue}%`,
                  backgroundColor: activeMuscleData.statusColor,
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-zinc-400">
              <span>0% Reposo</span>
              <span>50% Óptimo</span>
              <span>100% Agotamiento</span>
            </div>
          </div>

          {/* Recuperación en Vivo & Cuenta Regresiva */}
          <div className="bg-[#070A0F] p-4 rounded-2xl border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-400 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span>Tiempo Restante para Recuperación</span>
              </span>
              <span className="font-black text-cyan-400 text-base">
                {activeMuscleData.fatigue === 0 ||
                (activeMuscleData.remainingHours === 0 && activeMuscleData.remainingMinutes === 0)
                  ? '0h 0m'
                  : `${activeMuscleData.remainingHours}h ${activeMuscleData.remainingMinutes}m`}
              </span>
            </div>
            <div className="w-full bg-zinc-900 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-full bg-cyan-400 rounded-full transition-all duration-500"
                style={{ width: `${activeMuscleData.recoveryPercentage}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-zinc-400">
              <span>
                {activeMuscleData.fatigue === 0
                  ? 'Completamente regenerado'
                  : `Recuperado al ${activeMuscleData.recoveryPercentage}%`}
              </span>
              <span>Ventana base: {activeMuscleData.totalRecoveryHours}h</span>
            </div>
          </div>
        </div>

        {/* Métricas Acumuladas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-[#070A0F] p-3 rounded-2xl border border-zinc-800 text-center font-mono">
            <span className="text-[10px] text-zinc-400 uppercase block">Series Totales</span>
            <span className="text-lg font-black text-white mt-0.5 block">
              {activeMuscleData.sets} <span className="text-xs text-zinc-400">series</span>
            </span>
          </div>

          <div className="bg-[#070A0F] p-3 rounded-2xl border border-zinc-800 text-center font-mono">
            <span className="text-[10px] text-zinc-400 uppercase block">Volumen Acumulado</span>
            <span className="text-lg font-black text-cyan-400 mt-0.5 block">
              {activeMuscleData.volume.toLocaleString()}{' '}
              <span className="text-xs text-zinc-400">kg</span>
            </span>
          </div>

          <div className="bg-[#070A0F] p-3 rounded-2xl border border-zinc-800 text-center font-mono">
            <span className="text-[10px] text-zinc-400 uppercase block">Último Estímulo</span>
            <span className="text-sm font-bold text-white mt-1 block truncate">
              {activeMuscleData.lastTrainedDate || 'Sin registro'}
            </span>
          </div>

          <div className="bg-[#070A0F] p-3 rounded-2xl border border-zinc-800 text-center font-mono">
            <span className="text-[10px] text-zinc-400 uppercase block">Horas Transcurridas</span>
            <span className="text-lg font-black text-amber-400 mt-0.5 block">
              {activeMuscleData.elapsedHours !== undefined
                ? `${activeMuscleData.elapsedHours}h`
                : 'N/A'}
            </span>
          </div>
        </div>

        {/* Desglose de Ejercicios Causantes de Fatiga (Primarios vs Sinergistas) */}
        <div className="space-y-3 bg-[#070A0F] p-4 rounded-2xl border border-zinc-800">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-black uppercase text-white tracking-wider flex items-center gap-1.5 font-mono">
              <Dumbbell className="w-4 h-4 text-cyan-400" />
              <span>Ejercicios Causantes de Fatiga en este Músculo</span>
            </h5>
            <span className="text-[10px] text-zinc-400 font-mono">
              {activeMuscleData.exercisesTriggered.length} registros
            </span>
          </div>

          {activeMuscleData.exercisesTriggered.length === 0 ? (
            <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 text-center text-xs text-zinc-400 font-mono">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto mb-1 opacity-80" />
              No registra estímulos recientes activos. El músculo se encuentra 100% listo para entrenar.
            </div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {activeMuscleData.exercisesTriggered.map((item, idx) => (
                <div
                  key={`${item.workoutId}-${idx}`}
                  className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm">{item.exerciseName}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                          item.role === 'primary'
                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                            : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                        }`}
                      >
                        {item.role === 'primary'
                          ? 'Músculo Principal (100%)'
                          : 'Sinergista / Secundario'}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      <span>{item.workoutTitle}</span> • <span>{item.workoutDate}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-right">
                    <div>
                      <span className="text-[10px] text-zinc-400 block">Carga</span>
                      <span className="text-white font-bold">
                        {item.sets}s × {item.reps}r • {item.weightKg}kg
                      </span>
                    </div>
                    {item.rpe && (
                      <div className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-center">
                        <span className="text-[9px] text-zinc-400 block">RPE</span>
                        <span className="text-xs font-black text-amber-400">{item.rpe}</span>
                      </div>
                    )}
                    <div className="text-right">
                      <span className="text-[10px] text-zinc-400 block">Fatiga</span>
                      <span className="text-xs font-black text-red-400">
                        +{item.addedFatiguePct}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Músculos Secundarios Involucrados & Recomendación de Entrenamiento */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Músculos Secundarios */}
          <div className="bg-[#070A0F] p-4 rounded-2xl border border-zinc-800 space-y-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider block font-mono">
              Sinergias Musculares Involucradas:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {activeMuscleData.secondaryMusclesInvolved.length > 0 ? (
                activeMuscleData.secondaryMusclesInvolved.map((sec, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 font-mono"
                  >
                    {sec}
                  </span>
                ))
              ) : (
                <span className="text-xs text-zinc-400 italic">
                  Sin sinergias secundarias acumuladas
                </span>
              )}
            </div>
          </div>

          {/* Recomendación Prescriptiva */}
          <div className="bg-[#070A0F] p-4 rounded-2xl border border-zinc-800 space-y-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider block font-mono flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              Recomendación para la Sesión de Hoy:
            </span>
            <p className="text-xs text-zinc-300 leading-relaxed font-sans">
              {activeMuscleData.trainingReadiness === 'LISTO PARA ENTRENAR'
                ? 'Este grupo muscular se encuentra biológicamente recuperado. Puedes entrenarlo con carga máxima o hipertrofia de alto volumen.'
                : activeMuscleData.trainingReadiness === 'RECUPERACIÓN EN PROCESO'
                ? 'Fase de síntesis proteica activa. Se sugiere evitar series al fallo directo en este músculo hasta que la cuenta regresiva llegue a 0.'
                : 'Fatiga aguda significativa detectada. Se recomienda descanso estricto o entrenar grupos musculares no comprometidos.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
