import React from 'react';
import { Smartphone, Download, Sparkles, Users, MessageCircle, Share2, Monitor, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { getPublicAppUrl } from '../utils/firebaseSync';

interface PWAInstallButtonProps {
  onOpenModal: () => void;
  variant?: 'header' | 'banner' | 'card';
  isAdmin?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  onOpenModal,
  variant = 'header',
  isAdmin = false,
}) => {
  const { isInstalled, isInstallable, install, isAndroid, isIOS } = usePWAInstall();

  // Header button variant
  if (variant === 'header') {
    return (
      <button
        onClick={onOpenModal}
        className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-2xl bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-emerald-500/20 border border-amber-500/40 text-amber-300 hover:text-white hover:bg-amber-500/30 text-xs font-bold transition-all active:scale-95 shadow-sm"
        title="Invitar Atletas / Instalar App (APK)"
      >
        <Smartphone className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[11px] font-black tracking-tight hidden sm:inline">
          {isAdmin ? 'INVITAR / APK' : 'INSTALAR APP'}
        </span>
        <span className="text-[11px] font-black tracking-tight sm:hidden">
          {isAdmin ? 'INVITAR' : 'APP'}
        </span>
      </button>
    );
  }

  // Large Card variant (shown on Home / Hoy for ALL users)
  if (variant === 'card') {
    const origin = getPublicAppUrl();
    const waText = `🏋️‍♂️ *¡Hola! Te invito a entrenar en LAZCAKONGYM* 🔥\n\nAbre este enlace desde tu celular e instala la app en tu pantalla de inicio:\n${origin}`;
    const waLink = `https://api.whatsapp.com/send?text=${encodeURIComponent(waText)}`;

    return (
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500/15 via-slate-900 to-slate-900 border border-amber-500/40 p-4 sm:p-5 shadow-2xl">
        {/* Glow backdrop */}
        <div className="absolute top-0 right-0 w-36 h-36 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-emerald-500 p-[1.5px] shadow-lg shadow-amber-500/20 shrink-0">
              <div className="w-full h-full bg-[#090d16] rounded-[14px] flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-amber-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center flex-wrap gap-1.5">
                <h4 className="text-sm font-black text-white">
                  {isAdmin
                    ? 'Invitación para Atletas & App APK'
                    : 'Instalar App LAZCAKONGYM & APK'}
                </h4>
                <span className="text-[9px] uppercase font-black tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  MULTIPLATAFORMA
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {isAdmin
                  ? 'Comparte el enlace con tus atletas para que entrenen e instalen la app en su celular (Android, iOS o PC).'
                  : 'Instala la app en tu pantalla de inicio para entrenar a pantalla completa, con acceso rápido y sin conexión.'}
              </p>

              {/* Supported Platforms Pills */}
              <div className="flex items-center flex-wrap gap-1.5 mt-2.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                  🤖 Android (APK / WebAPK)
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-bold">
                  🍏 iPhone (iOS Safari)
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px] font-bold">
                  💻 PC / Web
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* Direct Install prompt if browser supports it */}
          {isInstallable ? (
            <button
              onClick={install}
              className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 transition-all active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>Instalar en este Dispositivo</span>
            </button>
          ) : (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 rounded-xl bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-black text-xs shadow-md shadow-emerald-950/30 transition-all active:scale-95 flex items-center justify-center gap-1.5"
            >
              <MessageCircle className="w-4 h-4 fill-slate-950 text-[#25D366]" />
              <span>Enviar por WhatsApp</span>
            </a>
          )}

          <button
            onClick={onOpenModal}
            className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-extrabold text-xs border border-slate-700 transition-all active:scale-95 flex items-center justify-center gap-1.5"
          >
            <Share2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Ver Enlaces, QR y APK</span>
          </button>
        </div>
      </div>
    );
  }

  // Floating banner variant
  return (
    <div className="mb-4 p-3 rounded-2xl bg-gradient-to-r from-amber-950/60 via-slate-900 to-emerald-950/60 border border-amber-500/30 shadow-lg flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 truncate">
        <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
          <Smartphone className="w-4 h-4 text-amber-400" />
        </div>
        <div className="truncate">
          <p className="text-xs font-bold text-white truncate">
            {isAdmin ? '¿Invitar atletas o instalar APK?' : '¿Instalar LAZCAKONGYM en tu celular?'}
          </p>
          <p className="text-[10px] text-slate-400 truncate">Android APK, iPhone iOS, WhatsApp y QR</p>
        </div>
      </div>
      <button
        onClick={onOpenModal}
        className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shrink-0 transition-colors shadow-sm"
      >
        Ver Enlaces
      </button>
    </div>
  );
};
