import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  onFinish?: () => void;
  minDurationMs?: number;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onFinish,
  minDurationMs = 2200,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Smooth progress bar fill
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        return prev + 5;
      });
    }, minDurationMs / 20);

    // Fade out transition after minDurationMs
    const timer = setTimeout(() => {
      setIsFadingOut(true);
      const finishTimer = setTimeout(() => {
        setIsVisible(false);
        if (onFinish) onFinish();
      }, 500); // 500ms fade duration
      return () => clearTimeout(finishTimer);
    }, minDurationMs);

    return () => {
      clearInterval(progressInterval);
      clearTimeout(timer);
    };
  }, [minDurationMs, onFinish]);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-[#000000] text-white flex flex-col items-center justify-between p-8 select-none transition-opacity duration-500 ease-out font-['Plus_Jakarta_Sans',sans-serif] ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Background Ambient Neon Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] h-[380px] rounded-full bg-[#CCFF00]/15 blur-3xl pointer-events-none animate-pulse" />

      {/* Top Brand Subtitle */}
      <div className="pt-6 text-center z-10">
        <span className="text-[11px] font-mono font-bold tracking-[0.3em] uppercase text-[#CCFF00] bg-[#CCFF00]/10 px-3.5 py-1 rounded-full border border-[#CCFF00]/30 shadow-[0_0_12px_rgba(204,255,0,0.2)]">
          ELITE PERFORMANCE
        </span>
      </div>

      {/* Hero Gorilla Emblem Protagonist */}
      <div className="relative z-10 flex flex-col items-center my-auto space-y-6">
        <div className="relative w-48 h-48 sm:w-60 sm:h-60 flex items-center justify-center group">
          {/* Outer Pulsing Ring */}
          <div className="absolute inset-0 rounded-full border-2 border-[#CCFF00]/40 animate-ping opacity-25" />
          <div className="absolute -inset-2 rounded-full border border-[#CCFF00]/20 blur-sm" />

          <img
            src="/assets/gorilla_full_logo.png"
            alt="LAZCAKONG GYM Emblem"
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain drop-shadow-[0_0_25px_rgba(204,255,0,0.4)] transform transition-transform duration-700 hover:scale-105"
          />
        </div>

        {/* Brand Lockup Title */}
        <div className="text-center space-y-1">
          <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white flex items-center justify-center gap-1.5 leading-none">
            LAZCAKONG
            <span className="text-[#CCFF00] drop-shadow-[0_0_12px_rgba(204,255,0,0.8)]">
              GYM
            </span>
          </h1>
          <p className="text-xs font-mono font-semibold text-slate-400 tracking-widest uppercase pt-1">
            ELITE PERFORMANCE · SISTEMA DE ENTRENAMIENTO
          </p>
        </div>
      </div>

      {/* Bottom Loading Progress Bar */}
      <div className="w-full max-w-xs space-y-2 text-center pb-6 z-10">
        <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-[#CCFF00]/30 p-0.5">
          <div
            className="h-full bg-[#CCFF00] rounded-full transition-all duration-150 ease-out shadow-[0_0_10px_#CCFF00]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 font-bold px-1">
          <span className="text-[#CCFF00]">INICIALIZANDO SISTEMA ELITE...</span>
          <span>{progress}%</span>
        </div>
      </div>
    </div>
  );
};
export default SplashScreen;
