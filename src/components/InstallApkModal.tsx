import React, { useState, useEffect } from 'react';
import {
  X,
  Smartphone,
  Download,
  CheckCircle2,
  Share2,
  QrCode,
  Copy,
  Check,
  ShieldCheck,
  ExternalLink,
  AlertTriangle,
  Package,
  Users,
  MessageCircle,
  Sparkles,
  Plus,
  Trash2,
  Ticket,
  Lock,
  Apple,
  Bot,
  RefreshCw,
} from 'lucide-react';
import {
  InviteLink,
  AdminAuthDiagnostics,
  createSingleUseInviteDetailed,
  generateBatchInviteTokens,
  subscribeToInvites,
  revokeInviteTokenDetailed,
  fetchInvitesAdminResult,
  getPublicAppUrl,
  getAdminAuthDiagnostics,
  forceRenewFirebaseAuthToken,
} from '../utils/firebaseSync';
import { OFFICIAL_RELEASE_APK_DOWNLOAD_URL } from '../utils/otaUpdateEngine';

interface InstallApkModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAdmin?: boolean;
  adminName?: string;
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export const InstallApkModal: React.FC<InstallApkModalProps> = ({
  isOpen,
  onClose,
  isAdmin = false,
  adminName = 'Camilo Lazcano (Admin)',
}) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [copiedAction, setCopiedAction] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'invite' | 'qr' | 'install' | 'pwabuilder' | 'honor'>(
    'invite'
  );
  const [platformFilter, setPlatformFilter] = useState<'all' | 'android' | 'ios'>('all');
  const [qrPlatform, setQrPlatform] = useState<'android' | 'ios'>('android');
  const [installDone, setInstallDone] = useState(false);

  // Single-use invite state
  const [invites, setInvites] = useState<InviteLink[]>([]);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);
  const [recipientNote, setRecipientNote] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedInviteForQr, setSelectedInviteForQr] = useState<InviteLink | null>(null);
  const [batchGeneratedCodes, setBatchGeneratedCodes] = useState<string[]>([]);
  const [statusNotice, setStatusNotice] = useState<{ text: string; isError?: boolean } | null>(null);
  const [authDiag, setAuthDiag] = useState<AdminAuthDiagnostics | null>(null);
  const [isRenewingToken, setIsRenewingToken] = useState(false);

  const showNotice = (text: string, isError = false) => {
    setStatusNotice({ text, isError });
    setTimeout(() => setStatusNotice(null), 6000);
  };

  const refreshInvitesList = async () => {
    setIsLoadingInvites(true);
    try {
      const res = await fetchInvitesAdminResult();
      if (res.success) {
        setInvitesError(null);
        setInvites(res.invites);
        const firstActive = res.invites.find((i) => !i.used && !i.revoked) || null;
        if (firstActive) {
          setSelectedInviteForQr((prev) => {
            if (prev) {
              const updated = res.invites.find((i) => i.token === prev.token);
              if (updated && !updated.used && !updated.revoked) return updated;
            }
            return firstActive;
          });
        }
        return res.invites;
      }
      setInvitesError(res.error || 'No se pudieron cargar las invitaciones.');
      return [];
    } finally {
      setIsLoadingInvites(false);
    }
  };

  const handleRenewAdminToken = async () => {
    setIsRenewingToken(true);
    try {
      const renewed = await forceRenewFirebaseAuthToken();
      setAuthDiag(renewed.diagnostics);
      if (!renewed.success) {
        setInvitesError(renewed.error || 'No se pudo renovar el token de Firebase.');
        showNotice(renewed.error || 'Inicia sesión con Google como Administrador.', true);
        return;
      }
      const list = await refreshInvitesList();
      if (list.length > 0 || !invitesError) {
        showNotice('Token de Firebase renovado e invitaciones sincronizadas.');
      }
    } finally {
      setIsRenewingToken(false);
    }
  };

  const handleGenerateBatch50 = async () => {
    setIsGenerating(true);
    try {
      const res = await generateBatchInviteTokens(50, adminName);
      if (res.success) {
        setBatchGeneratedCodes(res.tokens);
        if (res.invites && res.invites.length > 0) {
          setSelectedInviteForQr(res.invites[0]);
        }
        await refreshInvitesList();
        showNotice(res.message || 'Lote de 50 códigos generado en Firestore.');
      } else {
        showNotice(res.message || 'No se pudo generar el lote.', true);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Base public URL for athletes (configurable by Coach)
  const [publicAppUrl, setPublicAppUrl] = useState(() => getPublicAppUrl());
  const officialBaseUrl = publicAppUrl || 'https://lazcakongym.ai.studio';

  const handleSavePublicUrl = () => {
    try {
      localStorage.setItem('lazcakon_public_app_url', publicAppUrl.trim());
      showNotice('¡URL pública de la app guardada con éxito!');
    } catch {}
  };

  const buildInviteUrl = (token: string, platform?: 'android' | 'ios') => {
    const base = `${officialBaseUrl}/?invite=${encodeURIComponent(token)}`;
    return platform ? `${base}&platform=${platform}` : base;
  };

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (!isOpen || !isAdmin) return;
    setIsLoadingInvites(true);
    void getAdminAuthDiagnostics(false).then((diag) => setAuthDiag(diag));
    const unsubscribe = subscribeToInvites(
      (list) => {
        setIsLoadingInvites(false);
        setInvitesError(null);
        setInvites(list);
        const firstActive = list.find((i) => !i.used && !i.revoked) || null;
        setSelectedInviteForQr((prev) => {
          if (prev) {
            const updatedPrev = list.find((i) => i.token === prev.token);
            if (updatedPrev && !updatedPrev.used && !updatedPrev.revoked) return updatedPrev;
          }
          return firstActive;
        });
      },
      (err) => {
        setIsLoadingInvites(false);
        setInvitesError(err);
      }
    );
    return () => unsubscribe();
  }, [isOpen, isAdmin]);

  const handleDirectInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setInstallDone(true);
        setDeferredPrompt(null);
      }
    } else {
      showNotice(
        'En Chrome: toca el menú de 3 puntos (⋮) arriba a la derecha y selecciona "Instalar aplicación" o "Agregar a pantalla principal".'
      );
    }
  };

  if (!isOpen) return null;

  // For non-admin athletes: Show athlete PWA install modal with iOS Safari & Android instructions
  if (!isAdmin) {
    const isIosDevice = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
        <div className="w-full max-w-md bg-[#0d1424] border border-slate-700/80 rounded-3xl p-6 shadow-2xl text-slate-100 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-white">Instalar App en tu Celular</h3>
                <p className="text-[11px] text-slate-400">LAZCAKONGYM Modo App Nativa Fullscreen</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {isIosDevice ? (
            <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 space-y-3">
              <div className="flex items-center gap-2 text-sky-400 font-black text-xs">
                <Apple className="w-4 h-4 shrink-0" />
                <span>Instrucciones para iPhone (iOS / Safari)</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-sky-500/30 text-xs text-slate-200 leading-relaxed font-mono">
                💡 <strong>Toca el botón Compartir de Safari</strong> (el cuadrado con la flecha apuntando hacia arriba ⎋) y selecciona <strong className="text-sky-300 font-black">'Agregar a Inicio'</strong>.
              </div>
              <p className="text-[11px] text-slate-400 leading-normal">
                Quedará instalada como app nativa a pantalla completa sin barras de navegación en tu iPhone.
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 font-black text-xs">
                <Bot className="w-4 h-4 shrink-0" />
                <span>Instalación en Android (Google Chrome)</span>
              </div>
              {installDone ? (
                <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold text-center">
                  ¡Aplicación instalada con éxito! Búscala en tu pantalla de inicio.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleDirectInstall}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 active:scale-95 transition-all uppercase tracking-wider"
                >
                  <Download className="w-4 h-4 stroke-[2.5]" />
                  <span>📲 Instalar App en tu Celular</span>
                </button>
              )}
              <a
                href={OFFICIAL_RELEASE_APK_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 rounded-2xl bg-[#171717] hover:bg-[#222222] border border-[#CCFF00]/45 text-[#CCFF00] font-black text-xs flex items-center justify-center gap-2 uppercase tracking-wider"
              >
                <Download className="w-4 h-4" />
                <span>Descargar APK Android Oficial (.apk)</span>
              </a>
              <p className="text-[11px] text-slate-400 leading-normal">
                Si prefieres instalar la versión PWA sin descarga: toca el menú de 3 puntos (⋮) en Chrome y selecciona <strong>"Instalar aplicación"</strong>.
              </p>
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleGenerateSingleUseInvite = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsGenerating(true);
    try {
      const res = await createSingleUseInviteDetailed(adminName, recipientNote);
      if (res.success && res.invite) {
        setRecipientNote('');
        setSelectedInviteForQr(res.invite);
        await refreshInvitesList();
        showNotice(`Código ${res.invite.token} creado en Firestore.`);
      } else {
        showNotice(res.error || 'No se pudo crear el código. Verifica tu sesión Admin.', true);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyLink = (token: string, platform: 'android' | 'ios' | 'general' = 'general') => {
    const fullUrl = buildInviteUrl(token, platform === 'general' ? undefined : platform);
    navigator.clipboard.writeText(fullUrl);
    const key = `${token}-${platform}`;
    setCopiedAction(key);
    setTimeout(() => setCopiedAction(null), 2500);
  };

  const handleShareWhatsAppAndroid = (invite: InviteLink) => {
    const fullUrl = buildInviteUrl(invite.token, 'android');
    const greeting = invite.note ? `¡Hola ${invite.note}! ` : '¡Hola! ';
    const msg = `${greeting}Te comparto tu enlace personal de invitación para unirte a *LAZCAKONGYM* 🦍🔥 en *ANDROID*:\n\n👉 ${fullUrl}\n\n🔑 *Código único:* ${invite.token}\n\n📲 *Instrucciones para Android:*\n1. Abre el enlace en *Google Chrome*.\n2. Toca el menú (⋮) arriba a la derecha y selecciona *"Instalar aplicación"* o *"Agregar a pantalla principal"*.\n3. ¡Listo! Quedará instalada como app nativa en tu celular.\n\n⚠️ *IMPORTANTE:* Enlace personal de *1 SOLO USO*. Al crear tu cuenta con tu Correo y PIN, el enlace caducará automáticamente.`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  const handleShareWhatsAppIos = (invite: InviteLink) => {
    const fullUrl = buildInviteUrl(invite.token, 'ios');
    const greeting = invite.note ? `¡Hola ${invite.note}! ` : '¡Hola! ';
    const msg = `${greeting}Te comparto tu enlace personal de invitación para unirte a *LAZCAKONGYM* 🦍🔥 en *IPHONE (iOS)*:\n\n👉 ${fullUrl}\n\n🔑 *Código único:* ${invite.token}\n\n📲 *Instrucciones para iPhone:*\n1. En WhatsApp, toca los 3 puntos (...) abajo y selecciona *"Abrir en Safari"*.\n2. Si ves un aviso de seguridad de Google, toca el botón *"Authenticate in new window"* 1 sola vez.\n3. En Safari, toca el botón *Compartir* (cuadrado con flecha hacia arriba) y selecciona *"Agregar a pantalla de inicio"* para instalarla como App oficial con su icono.\n\n⚠️ *IMPORTANTE:* Enlace personal de *1 SOLO USO*. Al registrarte, el enlace caducará automáticamente.`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  const activeInvites = invites.filter((i) => !i.used && !i.revoked);
  const usedInvites = invites.filter((i) => i.used || i.revoked);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#0d1424] border border-slate-700/80 rounded-3xl p-5 shadow-2xl text-slate-100 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-base font-black text-white">
                  Generador de Enlaces (1 Solo Uso)
                </h3>
                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Solo Admin
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Cada enlace caduca automáticamente tras 1 registro para evitar que se transfiera
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {statusNotice && (
          <div
            className={`mt-3 p-2.5 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 ${
              statusNotice.isError
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
            }`}
          >
            <span>{statusNotice.text}</span>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="opacity-80 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="grid grid-cols-5 gap-1 p-1 bg-slate-950 rounded-2xl border border-slate-800 my-4">
          <button
            onClick={() => setActiveTab('invite')}
            className={`py-2 px-1 text-[11px] font-bold rounded-xl transition-all flex items-center justify-center space-x-1 ${
              activeTab === 'invite'
                ? 'bg-amber-500 text-slate-950 font-black shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Ticket className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">1-Uso Link</span>
          </button>
          <button
            onClick={() => setActiveTab('qr')}
            className={`py-2 px-1 text-[11px] font-bold rounded-xl transition-all flex items-center justify-center space-x-1 ${
              activeTab === 'qr'
                ? 'bg-amber-500 text-slate-950 font-black shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <QrCode className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">QR Único</span>
          </button>
          <button
            onClick={() => setActiveTab('install')}
            className={`py-2 px-1 text-[11px] font-bold rounded-xl transition-all flex items-center justify-center space-x-1 ${
              activeTab === 'install'
                ? 'bg-amber-500 text-slate-950 font-black shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Instalar</span>
          </button>
          <button
            onClick={() => setActiveTab('pwabuilder')}
            className={`py-2 px-1 text-[11px] font-bold rounded-xl transition-all flex items-center justify-center space-x-1 ${
              activeTab === 'pwabuilder'
                ? 'bg-amber-500 text-slate-950 font-black shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Package className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Crear APK</span>
          </button>
          <button
            onClick={() => setActiveTab('honor')}
            className={`py-2 px-1 text-[11px] font-bold rounded-xl transition-all flex items-center justify-center space-x-1 ${
              activeTab === 'honor'
                ? 'bg-amber-500 text-slate-950 font-black shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Honor Fix</span>
          </button>
        </div>

        {/* TAB 1: SINGLE-USE INVITE GENERATOR & LIST */}
        {activeTab === 'invite' && (
          <div className="space-y-4 animate-in fade-in">
            {/* Verified Firebase Admin Session Bar */}
            <div className="p-2.5 rounded-2xl bg-slate-950/90 border border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    authDiag?.isGoogleVerified ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-slate-200 truncate">
                    {authDiag?.isGoogleVerified
                      ? `Admin Google verificado: ${authDiag.email}`
                      : authDiag?.signedIn
                      ? `Sesión: ${authDiag.email || 'sin correo'} (${authDiag.signInProvider || 'sin Google'})`
                      : 'Verificando sesión Firebase Admin...'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleRenewAdminToken()}
                disabled={isRenewingToken || isLoadingInvites}
                className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] font-bold flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                title="Forzar renovación de token Firebase y recargar invitaciones"
              >
                <RefreshCw className={`w-3 h-3 ${isRenewingToken ? 'animate-spin' : ''}`} />
                <span>{isRenewingToken ? 'Renovando...' : 'Renovar Token'}</span>
              </button>
            </div>

            {/* Coach Public App URL Config */}
            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-amber-400 block">
                🔗 URL Pública de la App (Para WhatsApp sin enlaces de AI Studio)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={publicAppUrl}
                  onChange={(e) => setPublicAppUrl(e.target.value)}
                  className="flex-1 text-xs bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                  placeholder="https://..."
                />
                <button
                  type="button"
                  onClick={handleSavePublicUrl}
                  className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shrink-0 cursor-pointer"
                >
                  Guardar
                </button>
              </div>
            </div>

            {/* Generator Box */}
            <form
              onSubmit={handleGenerateSingleUseInvite}
              className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/15 via-slate-900 to-emerald-500/10 border border-amber-500/40 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Crear Nuevo Enlace de Invitación (1 Uso)
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                  Intransferible
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Opcional: Nombre del atleta (ej. Para Matías)"
                  value={recipientNote}
                  onChange={(e) => setRecipientNote(e.target.value)}
                  className="flex-1 text-xs bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-medium focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={isGenerating}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 flex items-center justify-center gap-1.5 shrink-0 active:scale-95 transition-all"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>{isGenerating ? 'Generando...' : 'Generar Enlace (1 Uso)'}</span>
                </button>
              </div>
              <div className="pt-1 border-t border-slate-800/80 space-y-2">
                <button
                  type="button"
                  onClick={handleGenerateBatch50}
                  disabled={isGenerating}
                  className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs shadow-md flex items-center justify-center gap-2 active:scale-95 transition-all uppercase tracking-wider cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4 fill-slate-950 text-slate-950" />
                  <span>⚡ Generar Lote de 50 Códigos Beta en Firestore</span>
                </button>

                {batchGeneratedCodes.length > 0 && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-emerald-500/40 space-y-2 text-left animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-emerald-400">
                        ¡Lote de 50 Códigos Guardado en Firestore!
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(batchGeneratedCodes.join('\n'));
                          setCopiedAction('batch-50');
                          setTimeout(() => setCopiedAction(null), 2500);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-[10px] font-bold border border-emerald-500/30 flex items-center gap-1"
                      >
                        {copiedAction === 'batch-50' ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>¡50 Códigos Copiados!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copiar los 50 Códigos</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 font-mono text-[10px] text-amber-300 max-h-28 overflow-y-auto whitespace-pre-wrap select-all border border-slate-800">
                      {batchGeneratedCodes.join('\n')}
                    </div>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-300 leading-relaxed">
                Cada código tiene un token criptográfico único. En cuanto el atleta cree su cuenta, el código pasa a estado <strong>CADUCADO</strong> en Firestore y nadie más podrá usarlo.
              </p>
            </form>

            {/* Active (Unused) Links Section */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-1">
                <h4 className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Enlaces Disponibles · 1 Uso ({activeInvites.length})
                </h4>

                {/* Platform Filter Buttons */}
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => setPlatformFilter('all')}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      platformFilter === 'all'
                        ? 'bg-slate-800 text-white font-black'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlatformFilter('android')}
                    className={`px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all ${
                      platformFilter === 'android'
                        ? 'bg-emerald-500 text-slate-950 font-black'
                        : 'text-emerald-400 hover:text-emerald-300'
                    }`}
                  >
                    <Bot className="w-3 h-3" />
                    <span>Android</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlatformFilter('ios')}
                    className={`px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all ${
                      platformFilter === 'ios'
                        ? 'bg-sky-500 text-slate-950 font-black'
                        : 'text-sky-400 hover:text-sky-300'
                    }`}
                  >
                    <Apple className="w-3 h-3" />
                    <span>iPhone</span>
                  </button>
                </div>
              </div>

              {invitesError ? (
                <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/40 text-center space-y-2.5">
                  <p className="text-xs text-rose-300 font-bold flex items-center justify-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{invitesError}</span>
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleRenewAdminToken()}
                      disabled={isRenewingToken || isLoadingInvites}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/35 text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRenewingToken ? 'animate-spin' : ''}`} />
                      <span>{isRenewingToken ? 'Renovando...' : 'Renovar Token y Reintentar'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void refreshInvitesList()}
                      disabled={isLoadingInvites}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/30 text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <span>{isLoadingInvites ? 'Consultando...' : 'Reintentar'}</span>
                    </button>
                  </div>
                </div>
              ) : isLoadingInvites && activeInvites.length === 0 ? (
                <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 text-center">
                  <p className="text-xs text-slate-400">Cargando invitaciones desde el servidor…</p>
                </div>
              ) : activeInvites.length === 0 ? (
                <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 text-center space-y-2">
                  <p className="text-xs text-slate-400">
                    No hay enlaces activos sin usar en este momento.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleGenerateSingleUseInvite()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-bold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Generar un enlace de 1 uso ahora</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
                  {activeInvites.map((inv) => {
                    const androidUrl = buildInviteUrl(inv.token, 'android');
                    const iosUrl = buildInviteUrl(inv.token, 'ios');
                    const isCopiedAndroid = copiedAction === `${inv.token}-android`;
                    const isCopiedIos = copiedAction === `${inv.token}-ios`;

                    return (
                      <div
                        key={inv.token}
                        className="p-3.5 rounded-2xl bg-slate-900 border border-emerald-500/40 space-y-3 shadow-md"
                      >
                        {/* Top Card Info */}
                        <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              1 Uso Disponible
                            </span>
                            {inv.note && (
                              <span className="text-xs font-black text-white">
                                · {inv.note}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-amber-300 font-black">
                              {inv.token}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedInviteForQr(inv);
                                setActiveTab('qr');
                              }}
                              className="p-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30"
                              title="Mostrar código QR de este enlace"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await revokeInviteTokenDetailed(inv.token);
                                if (res.success) {
                                  await refreshInvitesList();
                                  showNotice(`Invitación ${inv.token} revocada.`);
                                } else {
                                  showNotice(res.error || 'No se pudo revocar la invitación.', true);
                                }
                              }}
                              className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30"
                              title="Caducar / eliminar este enlace"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* SECTION 1: ANDROID LINK OPTION */}
                        {(platformFilter === 'all' || platformFilter === 'android') && (
                          <div className="p-2.5 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-black text-emerald-400 flex items-center gap-1.5">
                                <Bot className="w-3.5 h-3.5" />
                                <span>ENLACE PARA ANDROID (Chrome / APK)</span>
                              </span>
                              <span className="text-[10px] text-slate-400 font-medium">
                                Para Samsung, Xiaomi, Honor, Motorola
                              </span>
                            </div>

                            <div className="p-1.5 rounded-lg bg-[#070b13] border border-slate-800 font-mono text-[10px] text-slate-300 break-all select-all">
                              {androidUrl}
                            </div>

                            <div className="grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleCopyLink(inv.token, 'android')}
                                className="py-2 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all"
                              >
                                {isCopiedAndroid ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span className="text-emerald-300 font-black">¡Copiado Android!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Copiar Enlace Android</span>
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleShareWhatsAppAndroid(inv)}
                                className="py-2 px-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-black flex items-center justify-center gap-1.5 shadow-sm transition-all"
                              >
                                <MessageCircle className="w-3.5 h-3.5 fill-slate-950" />
                                <span>WhatsApp Android</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* SECTION 2: IPHONE (iOS) LINK OPTION */}
                        {(platformFilter === 'all' || platformFilter === 'ios') && (
                          <div className="p-2.5 rounded-xl bg-slate-950 border border-sky-500/30 space-y-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-black text-sky-400 flex items-center gap-1.5">
                                <Apple className="w-3.5 h-3.5" />
                                <span>ENLACE PARA IPHONE (iOS / Safari PWA)</span>
                              </span>
                              <span className="text-[10px] text-slate-400 font-medium">
                                Con instrucciones para Safari
                              </span>
                            </div>

                            <div className="p-1.5 rounded-lg bg-[#070b13] border border-slate-800 font-mono text-[10px] text-slate-300 break-all select-all">
                              {iosUrl}
                            </div>

                            <div className="grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleCopyLink(inv.token, 'ios')}
                                className="py-2 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all"
                              >
                                {isCopiedIos ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-sky-400" />
                                    <span className="text-sky-300 font-black">¡Copiado iPhone!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-sky-400" />
                                    <span>Copiar Enlace iPhone</span>
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleShareWhatsAppIos(inv)}
                                className="py-2 px-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-[11px] font-black flex items-center justify-center gap-1.5 shadow-sm transition-all"
                              >
                                <MessageCircle className="w-3.5 h-3.5 fill-slate-950" />
                                <span>WhatsApp iPhone</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Used / Expired Links History */}
            {usedInvites.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-400 px-1">
                  Enlaces Caducados / Ya Utilizados ({usedInvites.length})
                </h4>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {usedInvites.map((inv) => (
                    <div
                      key={inv.token}
                      className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between gap-2 opacity-75"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            CADUCADO (1 USO CONSUMIDO)
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">{inv.token}</span>
                        </div>
                        <p className="text-[11px] text-slate-300 mt-1">
                          Usado por:{' '}
                          <strong className="text-white">
                            {inv.usedByName || inv.note || 'Atleta'}
                          </strong>{' '}
                          {inv.usedByEmail ? `(${inv.usedByEmail})` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await revokeInviteTokenDetailed(inv.token);
                          if (res.success) {
                            await refreshInvitesList();
                            showNotice(`Registro ${inv.token} eliminado.`);
                          } else {
                            showNotice(res.error || 'No se pudo eliminar la invitación.', true);
                          }
                        }}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg"
                        title="Limpiar del registro"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: QR CODE FOR A SINGLE-USE INVITE (ANDROID / IPHONE SELECTOR) */}
        {activeTab === 'qr' && (
          <div className="py-4 text-center space-y-4 animate-in fade-in">
            {selectedInviteForQr && !selectedInviteForQr.used ? (
              <>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-black">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    QR de 1 Solo Uso: {selectedInviteForQr.token}
                    {selectedInviteForQr.note ? ` (${selectedInviteForQr.note})` : ''}
                  </span>
                </div>

                {/* Platform Selector for QR Code */}
                <div className="flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQrPlatform('android')}
                    className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                      qrPlatform === 'android'
                        ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                        : 'bg-slate-900 border border-slate-700 text-slate-300 hover:text-white'
                    }`}
                  >
                    <Bot className="w-4 h-4" />
                    <span>QR para Android</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setQrPlatform('ios')}
                    className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                      qrPlatform === 'ios'
                        ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                        : 'bg-slate-900 border border-slate-700 text-slate-300 hover:text-white'
                    }`}
                  >
                    <Apple className="w-4 h-4" />
                    <span>QR para iPhone (iOS)</span>
                  </button>
                </div>

                <div className={`bg-white p-5 rounded-3xl inline-block mx-auto shadow-2xl border-4 ${
                  qrPlatform === 'android' ? 'border-emerald-500' : 'border-sky-500'
                }`}>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
                      buildInviteUrl(selectedInviteForQr.token, qrPlatform)
                    )}&margin=8`}
                    alt={`QR Code LAZCAKONGYM ${qrPlatform}`}
                    className="w-48 h-48 mx-auto rounded-xl"
                  />
                </div>

                <div className="max-w-sm mx-auto space-y-2">
                  <div className="p-2 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[10px] text-slate-300 break-all select-all">
                    {buildInviteUrl(selectedInviteForQr.token, qrPlatform)}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyLink(selectedInviteForQr.token, qrPlatform)}
                    className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    {copiedAction === `${selectedInviteForQr.token}-${qrPlatform}` ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-300">¡Enlace QR Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-amber-400" />
                        <span>Copiar Enlace de este QR ({qrPlatform === 'android' ? 'Android' : 'iPhone'})</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="space-y-1.5 max-w-sm mx-auto p-3 rounded-2xl bg-slate-900 border border-slate-800 text-left">
                  <div className="flex items-center gap-2 text-xs font-black text-white">
                    {qrPlatform === 'android' ? (
                      <>
                        <Bot className="w-4 h-4 text-emerald-400" />
                        <span>Instrucción para escanear en Android</span>
                      </>
                    ) : (
                      <>
                        <Apple className="w-4 h-4 text-sky-400" />
                        <span>Instrucción para escanear en iPhone</span>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {qrPlatform === 'android'
                      ? 'El atleta escanea con su cámara, se abre en Google Chrome y toca el botón "Instalar aplicación". El código caducará automáticamente tras su registro.'
                      : 'El atleta escanea con su cámara, se abre en Safari, y toca Compartir > "Agregar a pantalla de inicio". El código caducará automáticamente tras su registro.'}
                  </p>
                </div>
              </>
            ) : (
              <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                <p className="text-xs text-slate-300">
                  Genera primero un enlace de 1 solo uso para mostrar su código QR exclusivo.
                </p>
                <button
                  onClick={() => handleGenerateSingleUseInvite()}
                  className="px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-black text-xs"
                >
                  + Generar QR de 1 Solo Uso Ahora
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DIRECT INSTALL ON ADMIN PHONE */}
        {activeTab === 'install' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/15 to-orange-500/5 border border-amber-500/30 space-y-3">
              <div className="flex items-start space-x-3">
                <div className="w-12 h-12 rounded-2xl bg-[#0b0f19] border border-[#CCFF00]/50 p-1 shrink-0 overflow-hidden shadow-md shadow-[#CCFF00]/20">
                  <img
                    src="/assets/gorilla_head.png"
                    alt="Icono Gorila"
                    className="w-full h-full object-cover rounded-xl scale-110"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Instalación Segura
                  </span>
                  <h4 className="text-sm font-black text-white mt-1">
                    Instalar LAZCAKONGYM en este Celular
                  </h4>
                  <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                    Instala la aplicación directamente sin errores de bloqueo de paquetes de Android.
                  </p>
                </div>
              </div>

              {installDone ? (
                <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center space-x-2 text-emerald-300 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>¡Aplicación instalada! Búscala en la pantalla de inicio de tu celular.</span>
                </div>
              ) : (
                <button
                  onClick={handleDirectInstall}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 flex items-center justify-center space-x-2 active:scale-98 transition-all"
                >
                  <Download className="w-4 h-4 stroke-[2.5]" />
                  <span>INSTALAR APP EN ESTE CELULAR AHORA</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: OFFICIAL RELEASE APK (GITHUB RELEASES) & PWABUILDER */}
        {activeTab === 'pwabuilder' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="p-4 rounded-2xl bg-[#CCFF00]/10 border border-[#CCFF00]/35 space-y-2.5">
              <h4 className="text-xs font-black text-[#CCFF00] flex items-center space-x-1.5">
                <Package className="w-4 h-4" />
                <span>APK Release Oficial Firmada (GitHub Releases)</span>
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                Descarga directa de la APK Android firmada de LAZCAKONG GYM (<code className="text-[#CCFF00]">com.lazcakong.gym</code>) con actualizaciones automáticas OTA habilitadas.
              </p>
              <a
                href={OFFICIAL_RELEASE_APK_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 rounded-2xl bg-[#CCFF00] hover:bg-[#d9ff33] text-[#090909] font-black text-xs shadow-lg flex items-center justify-center space-x-2"
              >
                <Download className="w-4 h-4" />
                <span>Descargar APK Release Oficial (.apk)</span>
              </a>
            </div>
            <a
              href={`https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(officialBaseUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center space-x-2"
            >
              <span>Abrir reporte en PWABuilder (PWA)</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        )}

        {/* TAB 5: HONOR / HUAWEI FIX */}
        {activeTab === 'honor' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-2">
              <div className="flex items-center space-x-2 text-rose-400 font-black text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>¿Tu celular Honor dice "No se puede instalar la app"?</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                En celulares <strong>Honor (MagicOS)</strong>, usa la pestaña{' '}
                <strong>"Instalar"</strong> o desde Chrome selecciona{' '}
                <strong>"Instalar aplicación"</strong>.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-4 mt-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
