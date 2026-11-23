import React from 'react';

interface SplashScreenProps {
  statusText?: string;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  statusText = 'COMPROBANDO SESIÓN...',
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Comprobando sesión de LazcaKong Gym"
      className="fixed inset-0 z-[9999] bg-[#000000] text-white flex flex-col items-center justify-between p-8 select-none font-['Plus_Jakarta_Sans',sans-serif]"
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
        <div className="relative w-48 h-48 sm:w-60 sm:h-60 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-[#CCFF00]/40 animate-ping opacity-25" />
          <div className="absolute -inset-2 rounded-full border border-[#CCFF00]/20 blur-sm" />

          <img
            src="/assets/gorilla_full_logo.png"
            alt="LAZCAKONG GYM Emblem"
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain drop-shadow-[0_0_25px_rgba(204,255,0,0.4)]"
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

      {/* Bottom Brief Loading Indicator (zero artificial timers) */}
      <div className="w-full max-w-xs space-y-2 text-center pb-6 z-10">
        <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-[#CCFF00]/30 p-0.5 relative">
          <div className="h-full w-2/5 bg-[#CCFF00] rounded-full shadow-[0_0_10px_#CCFF00] animate-[pulse_1s_ease-in-out_infinite] mx-auto" />
        </div>
        <div className="flex items-center justify-center text-[10px] font-mono text-[#CCFF00] font-bold tracking-wider px-1">
          <span>{statusText}</span>
        </div>
      </div>
    </div>
  );
};
export default SplashScreen;
