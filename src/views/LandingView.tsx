import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  ExternalLink,
  Lock,
  Sparkles,
  BarChart3,
  Dumbbell,
  CheckCircle2,
  Ticket,
  Mail,
  User,
  Activity,
  Zap,
  ArrowRight,
  X,
  Flame,
  Check,
  Apple,
  MessageCircle,
} from 'lucide-react';
import { Profile } from '../types';
import { AVATAR_OPTIONS, GOAL_OPTIONS } from '../data/defaultProfiles';
import { auth } from '../firebase';
import {
  verifyInviteToken,
  extractInviteTokenFromInput,
  InviteLink,
  createSingleUseInvite,
  getPublicAppUrl,
} from '../utils/firebaseSync';

// Direct Contact URL for free Beta invite code request (WhatsApp)
export const COACH_CONTACT_URL = 'https://wa.me';

interface AuthActionResult {
  success: boolean;
  message: string;
  requiresLegacyVerification?: boolean;
  requiresAuthSetupForLegacy?: boolean;
  legacyEmail?: string;
}

interface LandingViewProps {
  profiles: Profile[];
  onCreateProfile?: (name: string, email: string, pin: string, avatar: string, goal: string) => void;
  onLoginWithEmailPin: (email: string, pin: string) => Promise<AuthActionResult> | AuthActionResult;
  onLoginWithGoogle?: () => Promise<AuthActionResult>;
  onVerifyAndLinkLegacyProfile?: (params: {
    legacyEmail: string;
    pinOrRecoveryCode: string;
    newPassword?: string;
    authMethod?: 'current_session' | 'google' | 'create_password';
  }) => Promise<{ success: boolean; message: string }>;
  onCancelLegacyVerification?: () => Promise<void> | void;
  onRequestPasswordReset?: (email: string) => Promise<{ success: boolean; message: string }>;
  onRegisterWithInvite?: (params: {
    token: string;
    name: string;
    email: string;
    password?: string;
    avatar: string;
    goal: string;
    useGoogle?: boolean;
  }) => Promise<{ success: boolean; message: string }>;
  onSelectProfile?: (profileId: string) => void;
  isAdmin?: boolean;
  authNotice?: string | null;
  onDismissAuthNotice?: () => void;
}

export const LandingView: React.FC<LandingViewProps> = ({
  onLoginWithEmailPin,
  onLoginWithGoogle,
  onVerifyAndLinkLegacyProfile,
  onCancelLegacyVerification,
  onRequestPasswordReset,
  onRegisterWithInvite,
  isAdmin = false,
  authNotice = null,
  onDismissAuthNotice,
}) => {
  // Modals state
  const [isActivationModalOpen, setIsActivationModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Activation flow state
  const [codeInputValue, setCodeInputValue] = useState('');
  const [codeStatus, setCodeStatus] = useState<
    'idle' | 'checking' | 'valid' | 'used' | 'revoked' | 'not_found'
  >('idle');
  const [verifiedInvite, setVerifiedInvite] = useState<InviteLink | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [isSubmittingActivation, setIsSubmittingActivation] = useState(false);

  // New member profile details
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberPin, setMemberPin] = useState('');
  const [memberAvatar, setMemberAvatar] = useState('🦍');
  const [memberGoal, setMemberGoal] = useState('Hipertrofia & Masa');

  // Returning member login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [resetPasswordMsg, setResetPasswordMsg] = useState<string | null>(null);

  const handleRequestPasswordReset = async () => {
    if (!onRequestPasswordReset) return;
    const targetEmail = loginEmail.trim();
    if (!targetEmail) {
      setLoginError('Ingresa tu correo electrónico para solicitar la recuperación de contraseña.');
      return;
    }
    setLoginError(null);
    setResetPasswordMsg(null);
    const res = await onRequestPasswordReset(targetEmail);
    if (res.success) {
      setResetPasswordMsg(res.message);
    } else {
      setLoginError(res.message);
    }
  };
  const [legacyFlowMode, setLegacyFlowMode] = useState<
    'none' | 'verify_current_session' | 'setup_auth_and_verify'
  >('none');
  const [legacyEmail, setLegacyEmail] = useState('');
  const [legacyProof, setLegacyProof] = useState('');
  const [newLegacyPassword, setNewLegacyPassword] = useState('');
  const [platformGuidance, setPlatformGuidance] = useState<'ios-inapp' | 'ios-browser' | 'android' | null>(null);

  // Quick 1-click Admin Code Generation (strictly requires authenticated Admin)
  const [titleClickCount, setTitleClickCount] = useState(0);
  const [quickToastMsg, setQuickToastMsg] = useState<string | null>(null);
  const [isGeneratingQuickCode, setIsGeneratingQuickCode] = useState(false);

  const handleQuickGenerateCode = async () => {
    if (isGeneratingQuickCode) return;

    if (!auth.currentUser || !isAdmin) {
      setLoginError('Inicia sesión como Coach Administrador para generar códigos Beta.');
      setIsLoginModalOpen(true);
      setTitleClickCount(0);
      return;
    }

    setIsGeneratingQuickCode(true);
    try {
      const newInvite = await createSingleUseInvite('Coach Camilo Lazcano (Admin)', 'Código Rápido WhatsApp');
      if (!newInvite || !newInvite.token) {
        throw new Error('No se pudo generar el documento en Firestore.');
      }
      const codigoGenerado = newInvite.token;
      const appUrl = getPublicAppUrl();
      const textToCopy =
        "¡Hola máquina! Bienvenido a la Beta Privada de LAZCAKONGYM 🦍🔥. Tu código único de acceso es: " +
        codigoGenerado +
        ". Ingrésalo aquí para entrar: " +
        appUrl +
        "/?invite=" +
        codigoGenerado;

      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        }
      } catch (e) {
        console.warn('Clipboard write error:', e);
      }

      const msg = "✅ Código " + codigoGenerado + " creado y copiado. ¡Solo pégalo en WhatsApp!";
      setQuickToastMsg(msg);
      setTimeout(() => {
        setQuickToastMsg(null);
      }, 7000);
    } catch (err: any) {
      setQuickToastMsg('Error al generar código rápido: ' + (err?.message || 'Requiere sesión de Administrador'));
      setTimeout(() => setQuickToastMsg(null), 5000);
    } finally {
      setIsGeneratingQuickCode(false);
      setTitleClickCount(0);
    }
  };

  const handleTitleClick = () => {
    const nextCount = titleClickCount + 1;
    setTitleClickCount(nextCount);
    if (nextCount >= 3) {
      handleQuickGenerateCode();
    }
  };

  // Check URL parameters for ?invite=TOKEN and platform detection
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tokenFromUrl = params.get('invite');
      if (tokenFromUrl) {
        const clean = extractInviteTokenFromInput(tokenFromUrl);
        setCodeInputValue(clean);
        setIsActivationModalOpen(true);
        validateCode(clean);
      }

      // Check device platform and browser context
      const ua = navigator.userAgent || '';
      const isIos = /iPhone|iPad|iPod/i.test(ua);
      const isAndroid = /Android/i.test(ua);
      const isInApp = /WhatsApp|FBAN|FBAV|Instagram|Line|Messenger/i.test(ua);
      const isStandalone =
        (window.navigator as any).standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches;

      if (isIos && isInApp) {
        setPlatformGuidance('ios-inapp');
      } else if (isIos && !isStandalone) {
        setPlatformGuidance('ios-browser');
      } else if (isAndroid && !isStandalone) {
        setPlatformGuidance('android');
      }
    } catch {}
  }, []);

  const validateCode = async (rawCode: string) => {
    const clean = extractInviteTokenFromInput(rawCode);
    setActivationError(null);
    if (!clean) {
      setCodeStatus('idle');
      setVerifiedInvite(null);
      return;
    }

    setCodeStatus('checking');
    try {
      const res = await verifyInviteToken(clean);
      setCodeStatus(res.status);
      setVerifiedInvite(res.invite || null);

      if (!res.valid) {
        if (res.status === 'used') {
          setActivationError(
            'Este código de invitación ya fue utilizado y quemado anteriormente. Cada código es de uso único e intransferible.'
          );
        } else if (res.status === 'revoked') {
          setActivationError('Este código de invitación ha sido revocado por la administración.');
        } else {
          setActivationError('Código de invitación no válido o no encontrado en el sistema.');
        }
      }
    } catch {
      setCodeStatus('not_found');
      setActivationError('Error de red al verificar el código con la base de datos segura.');
    }
  };

  const handleManualCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    validateCode(codeInputValue);
  };

  const handleConfirmActivationWithGoogle = async () => {
    setActivationError(null);
    const clean = extractInviteTokenFromInput(codeInputValue);
    if (!clean || codeStatus !== 'valid') {
      setActivationError(
        'Acceso Denegado: Se requiere un Código de Invitación Beta válido (LZK-XXXX-XXXX).'
      );
      return;
    }
    if (!onRegisterWithInvite) {
      setActivationError('Registro con Firebase Auth no disponible en este entorno.');
      return;
    }

    setIsSubmittingActivation(true);
    try {
      const res = await onRegisterWithInvite({
        token: clean,
        name: memberName.trim(),
        email: memberEmail.trim(),
        avatar: memberAvatar,
        goal: memberGoal,
        useGoogle: true,
      });

      if (!res.success) {
        setActivationError(res.message);
        return;
      }

      if (window.location.search.includes('invite=')) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      setIsActivationModalOpen(false);
    } catch (err: any) {
      setActivationError('Error al activar acceso Beta: ' + (err?.message || 'Error desconocido'));
    } finally {
      setIsSubmittingActivation(false);
    }
  };

  const handleConfirmActivation = async (e: React.FormEvent) => {
    e.preventDefault();
    setActivationError(null);

    const clean = extractInviteTokenFromInput(codeInputValue);
    if (!clean || codeStatus !== 'valid') {
      setActivationError('Acceso Denegado: Se requiere un Código de Invitación Beta válido (LZK-XXXX-XXXX) otorgado directamente por el Coach Camilo Lazcano.');
      return;
    }

    if (!memberName.trim()) {
      setActivationError('Por favor ingresa tu nombre o apodo de atleta.');
      return;
    }
    if (!memberEmail.trim()) {
      setActivationError('Por favor ingresa tu correo electrónico para registrar tu cuenta personal.');
      return;
    }
    if (!memberPin.trim() || memberPin.trim().length < 6) {
      setActivationError('Crea una contraseña de acceso de al menos 6 caracteres para Firebase Auth.');
      return;
    }
    if (!onRegisterWithInvite) {
      setActivationError('Registro con Firebase Auth no disponible en este entorno.');
      return;
    }

    setIsSubmittingActivation(true);

    try {
      const res = await onRegisterWithInvite({
        token: clean,
        name: memberName.trim(),
        email: memberEmail.trim(),
        password: memberPin.trim(),
        avatar: memberAvatar,
        goal: memberGoal,
        useGoogle: false,
      });

      if (!res.success) {
        setActivationError(res.message);
        const reCheck = await verifyInviteToken(clean);
        setCodeStatus(reCheck.status);
        return;
      }

      // Clean URL if it contained ?invite=
      if (window.location.search.includes('invite=')) {
        window.history.replaceState({}, '', window.location.pathname);
      }

      setIsActivationModalOpen(false);
    } catch (err: any) {
      setActivationError('Error al activar acceso Beta: ' + (err?.message || 'Error desconocido'));
    } finally {
      setIsSubmittingActivation(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (!loginEmail.trim() || !loginPin.trim()) {
      setLoginError('Por favor ingresa tu correo y tu contraseña.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const res = await onLoginWithEmailPin(loginEmail, loginPin);
      if (!res.success) {
        if (res.requiresLegacyVerification) {
          setLegacyEmail(res.legacyEmail || loginEmail.trim().toLowerCase());
          setLegacyProof('');
          setLegacyFlowMode('verify_current_session');
          setLoginError(res.message);
        } else {
          // Stay on normal login for password errors, network errors, permission errors, or linking conflicts
          setLegacyFlowMode('none');
          setLoginError(res.message);
        }
      } else {
        setLegacyFlowMode('none');
        if (window.location.search.includes('invite=')) {
          window.history.replaceState({}, '', window.location.pathname);
        }
        setIsLoginModalOpen(false);
      }
    } catch {
      setLegacyFlowMode('none');
      setLoginError('Error de conexión al autenticar tu cuenta.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!onLoginWithGoogle) return;
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const res = await onLoginWithGoogle();
      if (!res.success) {
        if (res.requiresLegacyVerification) {
          setLegacyEmail(res.legacyEmail || loginEmail.trim().toLowerCase());
          setLegacyProof('');
          setLegacyFlowMode('verify_current_session');
          setLoginError(res.message);
        } else {
          setLegacyFlowMode('none');
          setLoginError(res.message);
        }
      } else {
        setLegacyFlowMode('none');
        if (window.location.search.includes('invite=')) {
          window.history.replaceState({}, '', window.location.pathname);
        }
        setIsLoginModalOpen(false);
      }
    } catch {
      setLegacyFlowMode('none');
      setLoginError('Error al iniciar sesión con Google.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleVerifyLegacySubmit = async (
    method: 'current_session' | 'google' | 'create_password'
  ) => {
    if (!onVerifyAndLinkLegacyProfile) return;
    setLoginError(null);
    if (!legacyEmail.trim() || !legacyProof.trim()) {
      setLoginError('Ingresa el correo de tu perfil heredado y tu PIN anterior o código del Coach.');
      return;
    }
    if (method === 'create_password' && newLegacyPassword.trim().length < 6) {
      setLoginError('Tu nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const res = await onVerifyAndLinkLegacyProfile({
        legacyEmail: legacyEmail.trim(),
        pinOrRecoveryCode: legacyProof.trim(),
        newPassword: method === 'create_password' ? newLegacyPassword.trim() : undefined,
        authMethod: method,
      });
      if (!res.success) {
        if ((res as any).alreadyMigrated || (res as any).linkingConflict) {
          setLegacyFlowMode('none');
          setLoginEmail(legacyEmail.trim());
          setLegacyProof('');
          setNewLegacyPassword('');
          setLoginError(res.message);
        } else {
          setLoginError(res.message);
        }
      } else {
        setLegacyFlowMode('none');
        setNewLegacyPassword('');
        setLegacyProof('');
        if (window.location.search.includes('invite=')) {
          window.history.replaceState({}, '', window.location.pathname);
        }
        setIsLoginModalOpen(false);
      }
    } catch {
      setLoginError('Error de conexión al vincular tu perfil.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleResetLegacyMode = async () => {
    if (legacyFlowMode === 'verify_current_session' && onCancelLegacyVerification) {
      await onCancelLegacyVerification();
    }
    setLegacyFlowMode('none');
    setLoginError(null);
    setNewLegacyPassword('');
  };

  const handleOpenContactDirect = () => {
    window.open(COACH_CONTACT_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen bg-[#070A11] text-slate-100 flex flex-col justify-between font-['Inter',sans-serif] relative overflow-hidden select-none">
      {/* Ambient Cyber-Gym Glow Backdrops */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 -right-32 w-96 h-96 bg-orange-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 left-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Toast Notice: Quick Code Created & Copied to Clipboard */}
      {quickToastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] p-4 rounded-2xl bg-emerald-500 text-slate-950 font-black text-xs sm:text-sm text-center shadow-2xl border-2 border-emerald-300 animate-in slide-in-from-top-4 duration-300 flex items-center justify-between gap-2">
          <span>{quickToastMsg}</span>
          <button
            onClick={() => setQuickToastMsg(null)}
            className="p-1 rounded-lg bg-black/10 hover:bg-black/20 text-slate-950 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Banner / Security Badge */}
      <header className="w-full pt-8 pb-4 px-6 max-w-xl mx-auto flex items-center justify-between relative z-10">
        <div
          onClick={handleTitleClick}
          className="flex items-center space-x-2.5 cursor-pointer active:scale-95 transition-transform"
          title="Toca 3 veces para generar y copiar nuevo código Beta"
        >
          <div className="w-10 h-10 rounded-2xl bg-black border border-[#CCFF00]/40 flex items-center justify-center overflow-hidden shrink-0 shadow-lg shadow-[#CCFF00]/10">
            <img
              src="/assets/gorilla_head.png"
              alt="Gorila Cabeza"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover scale-110"
            />
          </div>
          <span className="font-black tracking-tight text-white text-lg flex items-center gap-1">
            LAZCAKON<span style={{ color: '#CCFF00' }}>GYM</span>
            <span className="text-xs text-slate-400 font-mono font-bold">BETA</span>
          </span>
        </div>

        <button
          onClick={handleQuickGenerateCode}
          disabled={isGeneratingQuickCode}
          className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-900/80 hover:bg-[#CCFF00]/20 border border-[#CCFF00]/40 text-slate-200 hover:text-[#CCFF00] text-[11px] font-bold tracking-wide active:scale-95 transition-all cursor-pointer"
          title="Generar y copiar código rápido para WhatsApp"
        >
          <Lock className="w-3 h-3 text-[#CCFF00]" />
          <span>{isGeneratingQuickCode ? 'GENERANDO...' : 'BETA PRIVADA EXCLUSIVA'}</span>
        </button>
      </header>

      {/* Real Session/Auth Error Notice (never hidden silently) */}
      {authNotice && (
        <div className="w-full max-w-xl mx-auto px-6 mb-3 relative z-20">
          <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 flex items-start justify-between gap-3 shadow-lg text-xs">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="leading-snug font-semibold">{authNotice}</span>
            </div>
            {onDismissAuthNotice && (
              <button
                type="button"
                onClick={onDismissAuthNotice}
                aria-label="Cerrar aviso"
                className="p-1 rounded-lg hover:bg-rose-500/20 text-rose-300 shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Platform Guidance Banner for iPhone WhatsApp users or browser install */}
      {platformGuidance === 'ios-inapp' && (
        <div className="w-full max-w-xl mx-auto px-6 mb-2 relative z-20 animate-in fade-in">
          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-sky-500/20 via-blue-500/15 to-slate-900 border border-sky-400/40 text-slate-100 flex items-start gap-3 shadow-lg">
            <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400 shrink-0">
              <Apple className="w-5 h-5" />
            </div>
            <div className="text-xs space-y-1">
              <div className="font-black text-sky-300 flex items-center gap-1.5">
                <span>¿Estás en iPhone desde WhatsApp?</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                Para guardar tu sesión y añadir la App a tu pantalla de inicio, toca los 3 puntos <strong>(...)</strong> abajo a la derecha y selecciona <strong>"Abrir en Safari"</strong>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Hero Section */}
      <main className="flex-1 flex flex-col justify-center items-center px-6 py-6 max-w-xl mx-auto w-full relative z-10 space-y-6">
        {/* Full Emblem Emblematic Gorilla Logo for Welcome Screen */}
        <div className="w-48 h-48 sm:w-56 sm:h-56 relative flex items-center justify-center my-1 group">
          <div className="absolute inset-0 rounded-full bg-[#CCFF00]/15 blur-2xl group-hover:bg-[#CCFF00]/25 transition-all duration-500" />
          <img
            src="/assets/gorilla_full_logo.png"
            alt="LAZCAKONGYM Emblem"
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain relative z-10 drop-shadow-[0_0_20px_rgba(204,255,0,0.35)] transform transition-transform duration-300 hover:scale-105"
          />
        </div>

        {/* Hero Title & Exclusivity Banner */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center space-x-1.5 px-3.5 py-1 rounded-full bg-slate-900/90 border border-[#CCFF00]/40 text-[#CCFF00] text-xs font-black tracking-wider uppercase shadow-inner">
            <Flame className="w-3.5 h-3.5 text-[#CCFF00] animate-pulse" />
            <span>LAZCAKONGYM - BETA PRIVADA EXCLUSIVA</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter text-white leading-tight">
            ACCESO RESTRINGIDO SOLO PARA ATLETAS <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#CCFF00] via-emerald-400 to-lime-300">
              CON INVITACIÓN DIRECTA DEL COACH CAMILO LAZCANO.
            </span>
          </h1>

          <p className="text-slate-400 text-xs sm:text-sm leading-relaxed max-w-md mx-auto">
            Plataforma privada de entrenamiento de alto rendimiento. Registro de cargas en vivo, mapa térmico muscular 360°, periodización científica y visión por IA.
          </p>
        </div>

        {/* Value Prop Highlights */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/90 flex items-start space-x-3 shadow-sm">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black text-white uppercase tracking-wide">Mapa Térmico 360°</h3>
              <p className="text-[11px] text-slate-400 leading-snug">
                Activación y fatiga muscular precisa en vista anterior y posterior.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/90 flex items-start space-x-3 shadow-sm">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black text-white uppercase tracking-wide">Sobrecarga Progresiva</h3>
              <p className="text-[11px] text-slate-400 leading-snug">
                Cálculo de 1RM, volumen semanal por músculo y récords personales (PRs).
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/90 flex items-start space-x-3 shadow-sm">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black text-white uppercase tracking-wide">Escaner de Máquinas IA</h3>
              <p className="text-[11px] text-slate-400 leading-snug">
                Reconocimiento visual de equipamiento Smart Fit vía Gemini API.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/90 flex items-start space-x-3 shadow-sm">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black text-white uppercase tracking-wide">Temporizador Háptico</h3>
              <p className="text-[11px] text-slate-400 leading-snug">
                Alertas sonoras y vibración en smartwatch durante tus descansos.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons: 1. Ingresar Código | 2. Solicitar Código Beta Gratuito */}
        <div className="w-full space-y-3 pt-2">
          {/* Botón Principal: Ingresar Código de Invitación */}
          <button
            onClick={() => {
              setActivationError(null);
              setIsActivationModalOpen(true);
            }}
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-base flex items-center justify-center space-x-2.5 transition-all active:scale-[0.98] shadow-xl shadow-amber-500/25 cursor-pointer uppercase tracking-wide"
          >
            <KeyRound className="w-5 h-5 text-slate-950" />
            <span>INGRESAR CÓDIGO DE INVITACIÓN</span>
            <ArrowRight className="w-5 h-5 text-slate-950" />
          </button>

          {/* Botón Destacado: Solicitar Código Beta Gratuito Aquí */}
          <button
            onClick={handleOpenContactDirect}
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-sm flex items-center justify-center space-x-2.5 transition-all active:scale-[0.98] shadow-xl shadow-emerald-500/25 cursor-pointer uppercase tracking-wide"
          >
            <MessageCircle className="w-5 h-5 text-slate-950" />
            <span>SOLICITAR CÓDIGO BETA GRATUITO AQUÍ</span>
            <ExternalLink className="w-4 h-4 text-slate-950 opacity-80" />
          </button>
        </div>

        {/* Enlace para Miembros Recurrentes (Login con Correo / Contraseña / Google) */}
        <div className="text-center pt-1">
          <button
            onClick={() => {
              setLoginError(null);
              setResetPasswordMsg(null);
              setLegacyFlowMode('none');
              setIsLoginModalOpen(true);
            }}
            className="text-xs text-slate-400 hover:text-amber-400 transition-colors font-medium underline underline-offset-4"
          >
            ¿Ya tienes tu cuenta activada? Iniciar Sesión de Atleta
          </button>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="w-full py-4 px-6 text-center text-[10px] text-slate-600 relative z-10 border-t border-slate-900">
        <span>LAZCAKONGYM - BETA PRIVADA EXCLUSIVA · Acceso restringido solo para atletas con invitación directa del Coach Camilo Lazcano.</span>
      </footer>

      {/* ========================================================================= */}
      {/* MODAL 1: ACTIVACIÓN OBLIGATORIA CON CÓDIGO DE INVITACIÓN (CÓDIGO ÚNICO BURNING) */}
      {/* ========================================================================= */}
      {isActivationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-[#0c121e] border border-amber-500/40 p-6 space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-md">
                  <Ticket className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white tracking-tight">Activar Código de Invitación</h3>
                  <p className="text-xs text-slate-400">Acceso exclusivo a la Beta Privada de LAZCAKONGYM</p>
                </div>
              </div>
              <button
                onClick={() => setIsActivationModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Message */}
            {activationError && (
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-start space-x-2.5 text-rose-300 text-xs font-bold">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span className="leading-relaxed">{activationError}</span>
              </div>
            )}

            {/* Paso 1: Ingreso Obligatorio del Código LZK-XXXX-XXXX */}
            <form onSubmit={handleManualCodeSubmit} className="space-y-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-amber-400">
                Código de Invitación Beta (Obligatorio) *
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="LZK-XXXX-XXXX"
                  value={codeInputValue}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setCodeInputValue(val);
                    if (codeStatus !== 'idle') {
                      setCodeStatus('idle');
                      setActivationError(null);
                    }
                  }}
                  className="w-full p-3.5 pl-10 rounded-2xl bg-slate-950 border border-slate-700/80 focus:border-amber-400 text-white font-mono font-bold tracking-wider text-sm outline-none transition-all placeholder:text-slate-600 uppercase"
                  required
                />
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>

              {codeStatus === 'valid' ? (
                <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center space-x-2 text-emerald-300 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>¡Código Verificado! Invitación válida de uso único.</span>
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={!codeInputValue.trim() || codeStatus === 'checking'}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  {codeStatus === 'checking' ? (
                    <span>Verificando en la Nube...</span>
                  ) : (
                    <>
                      <span>Verificar Código</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              )}
            </form>

            {/* Paso 2: Registro de Perfil y Quemado Definitivo del Código */}
            {codeStatus === 'valid' && (
              <form onSubmit={handleConfirmActivation} className="space-y-3.5 pt-2 border-t border-slate-800/80">
                <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">
                  Datos de tu Perfil de Atleta
                </div>

                {onRegisterWithInvite && (
                  <button
                    type="button"
                    disabled={isSubmittingActivation}
                    onClick={handleConfirmActivationWithGoogle}
                    className="w-full py-3 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-900 font-black text-xs flex items-center justify-center space-x-2 transition-all active:scale-[0.98] shadow-md cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>ACTIVAR RÁPIDO CON GOOGLE</span>
                  </button>
                )}

                <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase font-bold">
                  <span className="flex-1 h-px bg-slate-800" />
                  <span>o crea contraseña personal</span>
                  <span className="flex-1 h-px bg-slate-800" />
                </div>

                <div className="space-y-2.5">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Tu Nombre o Apodo"
                      value={memberName}
                      onChange={(e) => setMemberName(e.target.value)}
                      className="w-full p-3 pl-10 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-white text-xs outline-none transition-all"
                      required
                    />
                    <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>

                  <div className="relative">
                    <input
                      type="email"
                      placeholder="correo@ejemplo.com"
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value)}
                      className="w-full p-3 pl-10 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-white text-xs outline-none transition-all"
                      required
                    />
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>

                  <div className="relative">
                    <input
                      type="password"
                      minLength={6}
                      placeholder="Contraseña de acceso (mín. 6 caracteres)"
                      value={memberPin}
                      onChange={(e) => setMemberPin(e.target.value)}
                      className="w-full p-3 pl-10 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-white font-mono text-xs outline-none transition-all"
                      required
                    />
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>

                  {/* Objetivo Fitness */}
                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1 uppercase tracking-wide">
                      Objetivo Principal
                    </label>
                    <select
                      value={memberGoal}
                      onChange={(e) => setMemberGoal(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs outline-none"
                    >
                      {GOAL_OPTIONS.map((g) => (
                        <option key={g} value={g} className="bg-slate-950 text-white">
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingActivation}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all active:scale-[0.98] shadow-lg shadow-amber-500/25 cursor-pointer"
                >
                  {isSubmittingActivation ? (
                    <span>Activando y quemando código...</span>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>QUEMAR CÓDIGO Y ACCEDER A LA BETA</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Enlace de contacto si el usuario aún no tiene código */}
            <div className="pt-2 text-center border-t border-slate-800/60">
              <button
                type="button"
                onClick={handleOpenContactDirect}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold inline-flex items-center space-x-1.5 cursor-pointer"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>¿No tienes tu código de invitación? Solicita tu pase Beta gratuito aquí</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: INICIO DE SESIÓN PARA ATLETAS CON CUENTA                         */}
      {/* ========================================================================= */}
      {isLoginModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-3xl bg-[#0c121e] border border-slate-800 p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Iniciar Sesión de Atleta</h3>
                  <p className="text-xs text-slate-400">Acceso exclusivo a la Beta Privada</p>
                </div>
              </div>
              <button
                onClick={() => {
                  handleResetLegacyMode();
                  setIsLoginModalOpen(false);
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loginError && (
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-start space-x-2 text-rose-300 text-xs font-bold">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{loginError}</span>
              </div>
            )}

            {legacyFlowMode === 'none' ? (
              <form onSubmit={handleLoginSubmit} className="space-y-3.5">
                <div className="space-y-2.5">
                  <div className="relative">
                    <input
                      type="email"
                      placeholder="correo@ejemplo.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="w-full p-3 pl-10 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-white text-xs outline-none transition-all"
                      required
                    />
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>

                  <div className="relative">
                    <input
                      type="password"
                      placeholder="Contraseña de tu cuenta"
                      value={loginPin}
                      onChange={(e) => setLoginPin(e.target.value)}
                      className="w-full p-3 pl-10 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-white font-mono text-xs outline-none transition-all"
                      required
                    />
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>

                  <div className="flex justify-between items-center text-[11px] pt-1">
                    <span className="text-slate-500">¿Olvidaste tu contraseña?</span>
                    <button
                      type="button"
                      onClick={handleRequestPasswordReset}
                      className="text-amber-400 hover:text-amber-300 font-bold underline cursor-pointer"
                    >
                      Recuperar por correo
                    </button>
                  </div>
                  {resetPasswordMsg && (
                    <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold">
                      {resetPasswordMsg}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all active:scale-[0.98] shadow-md cursor-pointer"
                >
                  {isLoggingIn ? (
                    <span>Verificando Firebase Auth...</span>
                  ) : (
                    <>
                      <span>INGRESAR A MI CUENTA</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {onLoginWithGoogle && (
                  <>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase font-bold pt-1">
                      <span className="flex-1 h-px bg-slate-800" />
                      <span>o inicia con Google</span>
                      <span className="flex-1 h-px bg-slate-800" />
                    </div>

                    <button
                      type="button"
                      disabled={isLoggingIn}
                      onClick={handleGoogleLogin}
                      className="w-full py-3 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-900 font-black text-xs flex items-center justify-center space-x-2 transition-all active:scale-[0.98] shadow-md cursor-pointer"
                    >
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>CONTINUAR CON GOOGLE</span>
                    </button>
                  </>
                )}

                {onVerifyAndLinkLegacyProfile && (
                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setLoginError(null);
                        setLegacyEmail(loginEmail.trim().toLowerCase());
                        setLegacyFlowMode('setup_auth_and_verify');
                      }}
                      className="text-[11px] text-amber-400 hover:text-amber-300 font-bold underline underline-offset-4 cursor-pointer"
                    >
                      ¿Perfil antiguo o código del Coach? Vincular historial aquí
                    </button>
                  </div>
                )}
              </form>
            ) : legacyFlowMode === 'verify_current_session' ? (
              <div className="space-y-3.5">
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 font-semibold leading-snug">
                  Autenticación validada. Confirma tu identidad para vincular tu historial existente de forma segura:
                </div>

                <div className="space-y-2.5">
                  <div className="relative">
                    <input
                      type="email"
                      placeholder="Correo del perfil heredado"
                      value={legacyEmail}
                      onChange={(e) => setLegacyEmail(e.target.value)}
                      className="w-full p-3 pl-10 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-white text-xs outline-none"
                      required
                    />
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>

                  <div className="relative">
                    <input
                      type="password"
                      placeholder="PIN heredado o Código LZK-REC-..."
                      value={legacyProof}
                      onChange={(e) => setLegacyProof(e.target.value)}
                      className="w-full p-3 pl-10 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-white font-mono text-xs outline-none"
                      required
                    />
                    <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isLoggingIn}
                  onClick={() => handleVerifyLegacySubmit('current_session')}
                  className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all cursor-pointer"
                >
                  <span>{isLoggingIn ? 'Vinculando...' : 'VERIFICAR Y VINCULAR HISTORIAL'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleResetLegacyMode}
                  className="w-full py-2 text-[11px] text-slate-400 hover:text-white font-bold cursor-pointer"
                >
                  Cancelar y usar otra cuenta
                </button>
              </div>
            ) : (
              <div className="space-y-3.5">
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 font-semibold leading-snug">
                  Vinculación segura: confirma tu perfil anterior y autentícate con Google o define tu nueva contraseña (mín. 6 caracteres).
                </div>

                <div className="space-y-2.5">
                  <div className="relative">
                    <input
                      type="email"
                      placeholder="Correo de tu perfil anterior"
                      value={legacyEmail}
                      onChange={(e) => setLegacyEmail(e.target.value)}
                      className="w-full p-3 pl-10 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-white text-xs outline-none"
                      required
                    />
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>

                  <div className="relative">
                    <input
                      type="password"
                      placeholder="PIN heredado o Código LZK-REC-..."
                      value={legacyProof}
                      onChange={(e) => setLegacyProof(e.target.value)}
                      className="w-full p-3 pl-10 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-white font-mono text-xs outline-none"
                      required
                    />
                    <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                {onLoginWithGoogle && (
                  <button
                    type="button"
                    disabled={isLoggingIn}
                    onClick={() => handleVerifyLegacySubmit('google')}
                    className="w-full py-3 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-900 font-black text-xs flex items-center justify-center space-x-2 transition-all shadow-md cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>VINCULAR CON GOOGLE + PIN</span>
                  </button>
                )}

                <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase font-bold">
                  <span className="flex-1 h-px bg-slate-800" />
                  <span>o define nueva contraseña</span>
                  <span className="flex-1 h-px bg-slate-800" />
                </div>

                <div className="relative">
                  <input
                    type="password"
                    minLength={6}
                    placeholder="Nueva contraseña (mín. 6 caracteres)"
                    value={newLegacyPassword}
                    onChange={(e) => setNewLegacyPassword(e.target.value)}
                    className="w-full p-3 pl-10 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-white font-mono text-xs outline-none"
                  />
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                </div>

                <button
                  type="button"
                  disabled={isLoggingIn}
                  onClick={() => handleVerifyLegacySubmit('create_password')}
                  className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all cursor-pointer"
                >
                  <span>{isLoggingIn ? 'Verificando...' : 'CREAR CONTRASEÑA Y VINCULAR'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleResetLegacyMode}
                  className="w-full py-2 text-[11px] text-slate-400 hover:text-white font-bold cursor-pointer"
                >
                  Volver al inicio de sesión
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

