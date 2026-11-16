import React, { useState, useEffect } from 'react';
import {
  Lock,
  Mail,
  User,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  KeyRound,
  Ticket,
  CheckCircle2,
  ExternalLink,
  MessageCircle,
} from 'lucide-react';
import { Profile } from '../types';
import { AVATAR_OPTIONS, GOAL_OPTIONS } from '../data/defaultProfiles';
import {
  verifyInviteToken,
  extractInviteTokenFromInput,
  InviteLink,
} from '../utils/firebaseSync';

export const COACH_CONTACT_URL = 'https://wa.me';

interface AuthActionResult {
  success: boolean;
  message: string;
  requiresLegacyVerification?: boolean;
  requiresAuthSetupForLegacy?: boolean;
  legacyEmail?: string;
}

interface LoginProfileSelectorViewProps {
  profiles: Profile[];
  onSelectProfile: (profileId: string) => void;
  onCreateProfile?: (name: string, email: string, pin: string, avatar: string, goal: string) => void;
  onLoginWithEmailPin: (
    email: string,
    pin: string
  ) => Promise<AuthActionResult> | AuthActionResult;
  onLoginWithGoogle?: () => Promise<AuthActionResult>;
  onRegisterWithInvite?: (params: {
    token: string;
    name: string;
    email: string;
    password?: string;
    avatar: string;
    goal: string;
    useGoogle?: boolean;
  }) => Promise<{ success: boolean; message: string }>;
  onDeleteProfile: (profileId: string) => void;
  onOpenInstallApk?: () => void;
}

export const LoginProfileSelectorView: React.FC<LoginProfileSelectorViewProps> = ({
  onLoginWithEmailPin,
  onLoginWithGoogle,
  onRegisterWithInvite,
}) => {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  // Single-use invitation state
  const [inviteInput, setInviteInput] = useState('');
  const [inviteStatus, setInviteStatus] = useState<
    'idle' | 'checking' | 'valid' | 'used' | 'revoked' | 'not_found'
  >('idle');
  const [verifiedInvite, setVerifiedInvite] = useState<InviteLink | null>(null);
  const [urlHadExpiredInvite, setUrlHadExpiredInvite] = useState(false);

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Register form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regAvatar, setRegAvatar] = useState('🦍');
  const [regGoal, setRegGoal] = useState('Hipertrofia & Masa');
  const [regError, setRegError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  // Check if URL has ?invite=TOKEN on mount
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tokenFromUrl = params.get('invite');
      if (tokenFromUrl) {
        const cleanToken = extractInviteTokenFromInput(tokenFromUrl);
        setInviteInput(cleanToken);
        setInviteStatus('checking');
        verifyInviteToken(cleanToken).then((res) => {
          if (res.valid && res.invite) {
            setInviteStatus('valid');
            setVerifiedInvite(res.invite);
            setAuthMode('register');
          } else {
            setInviteStatus(res.status);
            setVerifiedInvite(res.invite || null);
            setUrlHadExpiredInvite(true);
            setAuthMode('login');
          }
        });
      }
    } catch {}
  }, []);

  const handleCheckManualInvite = async (rawValue: string) => {
    const clean = extractInviteTokenFromInput(rawValue);
    setInviteInput(rawValue);
    if (!clean) {
      setInviteStatus('idle');
      setVerifiedInvite(null);
      return;
    }
    setInviteStatus('checking');
    const res = await verifyInviteToken(clean);
    setInviteStatus(res.status);
    setVerifiedInvite(res.invite || null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!loginEmail.trim() || !loginPin.trim()) {
      setLoginError('Por favor ingresa tu correo y PIN de acceso.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const res = await onLoginWithEmailPin(loginEmail, loginPin);
      if (!res.success) {
        setLoginError(res.message);
      } else {
        // Clear any ?invite param from URL on login
        if (window.location.search.includes('invite=')) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    } catch {
      setLoginError('Error de conexión al verificar cuenta.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);

    const cleanToken = extractInviteTokenFromInput(inviteInput);
    if (!cleanToken || inviteStatus !== 'valid') {
      setRegError(
        'Acceso Denegado: Se requiere un Código de Invitación Beta válido (LZK-XXXX-XXXX) otorgado por el Coach Camilo Lazcano.'
      );
      return;
    }

    if (!regName.trim() || !regEmail.trim() || !regPin.trim()) {
      setRegError('Completa tu nombre, correo y contraseña de acceso.');
      return;
    }
    if (regPin.trim().length < 6) {
      setRegError('La contraseña de acceso debe tener al menos 6 caracteres.');
      return;
    }
    if (!onRegisterWithInvite) {
      setRegError('Registro con Firebase Auth no disponible en este entorno.');
      return;
    }

    setIsRegistering(true);
    try {
      const res = await onRegisterWithInvite({
        token: cleanToken,
        name: regName.trim(),
        email: regEmail.trim().toLowerCase(),
        password: regPin.trim(),
        avatar: regAvatar,
        goal: regGoal,
        useGoogle: false,
      });

      if (!res.success) {
        setRegError(res.message);
        const check = await verifyInviteToken(cleanToken);
        setInviteStatus(check.status);
        setVerifiedInvite(check.invite || null);
        return;
      }

      if (window.location.search.includes('invite=')) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch {
      setRegError('Error al validar la invitación en la nube. Intenta nuevamente.');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleOpenContactDirect = () => {
    window.open(COACH_CONTACT_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col justify-between p-4 max-w-md mx-auto">
      {/* Brand Hero */}
      <div className="pt-8 pb-4 text-center space-y-3">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-tr from-[#CCFF00] via-emerald-400 to-lime-300 p-[2.5px] shadow-2xl shadow-[#CCFF00]/30 overflow-hidden">
          <div className="w-full h-full bg-[#0b0f19] rounded-[22px] flex items-center justify-center overflow-hidden">
            <img
              src="/assets/gorilla_head.png"
              alt="LAZCAKONGYM"
              className="w-full h-full object-cover scale-110"
            />
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-white font-['Plus_Jakarta_Sans',sans-serif]">
            LAZCAKON<span style={{ color: '#CCFF00' }}>GYM</span>
          </h1>
          <p className="text-xs font-bold text-amber-400 mt-1">
            LAZCAKONGYM - BETA PRIVADA EXCLUSIVA
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
            Acceso restringido solo para atletas con invitación directa del Coach Camilo Lazcano.
          </p>
        </div>
      </div>

      {/* Expired / Already-Used Invite Alert Banner (if opened from an expired ?invite= link) */}
      {urlHadExpiredInvite && (inviteStatus === 'used' || inviteStatus === 'revoked' || inviteStatus === 'not_found') && (
        <div className="mb-3 p-4 rounded-3xl bg-rose-500/15 border-2 border-rose-500/50 text-left space-y-2 shadow-xl animate-in fade-in">
          <div className="flex items-center gap-2 text-rose-400 font-black text-xs uppercase tracking-wider">
            <ShieldAlert className="w-5 h-5 shrink-0 text-rose-400" />
            <span>Código de Invitación Caducado (1 Solo Uso)</span>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed">
            Este código de invitación <strong>ya fue utilizado</strong> y ha caducado automáticamente. Por seguridad, los códigos del Coach son personales, válidos para <strong>1 único uso</strong> y no pueden transferirse.
          </p>
          <p className="text-[11px] text-amber-300 font-bold">
            • Si tú ya creaste tu cuenta con este código, inicia sesión abajo con tu Correo y PIN.
          </p>
        </div>
      )}

      {/* Auth Toggle Tabs */}
      <div className="my-auto py-4 space-y-4">
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-2xl border border-slate-800">
          <button
            type="button"
            onClick={() => setAuthMode('login')}
            className={`py-2.5 text-xs font-black rounded-xl transition-all ${
              authMode === 'login'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Iniciar Sesión
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('register')}
            className={`py-2.5 text-xs font-black rounded-xl transition-all ${
              authMode === 'register'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Activar Invitación
          </button>
        </div>

        {authMode === 'login' ? (
          /* LOGIN FORM */
          <form
            onSubmit={handleLoginSubmit}
            className="glass-card rounded-3xl p-5 border border-slate-700/80 space-y-4 animate-in fade-in"
          >
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <KeyRound className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-black text-white">Acceso de Atletas Registrados</h3>
            </div>

            {loginError && (
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold flex items-center gap-2">
                <span>⚠️</span>
                <span>{loginError}</span>
              </div>
            )}

            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                Correo Electrónico
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  placeholder="ej. tu.correo@gmail.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full text-sm data-input-field rounded-2xl pl-10 pr-4 py-3 text-white font-bold shadow-inner"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                Contraseña o PIN Heredado
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value)}
                  className="w-full text-base data-input-field rounded-2xl pl-10 pr-4 py-3 text-amber-300 font-mono font-black shadow-inner"
                  required
                />
              </div>
            </div>

            <div className="pt-2 space-y-2.5">
              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 disabled:opacity-60 text-slate-950 font-black text-sm active:scale-98 shadow-xl shadow-amber-500/20 transition-all flex items-center justify-center space-x-2"
              >
                <span>{isLoggingIn ? 'VERIFICANDO...' : 'ENTRAR A MI CUENTA'}</span>
                <ArrowRight className="w-4 h-4 stroke-[3]" />
              </button>

              {onLoginWithGoogle && (
                <button
                  type="button"
                  disabled={isLoggingIn}
                  onClick={async () => {
                    setLoginError(null);
                    setIsLoggingIn(true);
                    const res = await onLoginWithGoogle();
                    setIsLoggingIn(false);
                    if (!res.success) setLoginError(res.message);
                  }}
                  className="w-full py-3 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-black text-xs flex items-center justify-center gap-2 shadow-md transition-all"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>CONTINUAR CON GOOGLE</span>
                </button>
              )}
            </div>
          </form>
        ) : (
          /* REGISTER FORM (REQUIRES MANDATORY VALID 1-USE INVITE TOKEN) */
          <form
            onSubmit={handleRegisterSubmit}
            className="glass-card rounded-3xl p-5 border border-slate-700/80 space-y-4 animate-in fade-in"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <UserPlus className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-black text-white">Registro con Código de Invitación</h3>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">
                1 Solo Uso
              </span>
            </div>

            {/* Single-Use Invite Verification Box */}
            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-2">
              <label className="text-[11px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Ticket className="w-3.5 h-3.5 text-amber-400" />
                <span>Código de Invitación Beta (Obligatorio) *</span>
              </label>
              <input
                type="text"
                placeholder="LZK-XXXX-XXXX"
                value={inviteInput}
                onChange={(e) => handleCheckManualInvite(e.target.value.toUpperCase())}
                className="w-full text-xs bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-amber-300 font-mono font-bold focus:outline-none focus:border-amber-400 uppercase"
                required
              />

              {inviteStatus === 'checking' && (
                <p className="text-[11px] text-amber-300 font-bold animate-pulse">
                  Verificando validez del código en la nube...
                </p>
              )}

              {inviteStatus === 'valid' && (
                <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="block text-emerald-200 font-black">
                      Código Válido (Uso Único Registrado)
                    </span>
                    <span>
                      {verifiedInvite?.note ? `Destinatario: ${verifiedInvite.note} · ` : ''}
                      Al registrarte, este código se quemará de forma irreversible.
                    </span>
                  </div>
                </div>
              )}

              {inviteStatus === 'used' && (
                <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-[11px] font-bold flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="block text-rose-200 font-black">
                      Código Caducado · Ya fue quemado
                    </span>
                    <span>
                      Este código ya fue consumido y no puede reutilizarse. Solicita uno nuevo al Coach Camilo Lazcano.
                    </span>
                  </div>
                </div>
              )}

              {(inviteStatus === 'not_found' || inviteStatus === 'revoked') && inviteInput.trim().length > 3 && (
                <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-[11px] font-bold">
                  ⚠️ Código de invitación inválido o revocado por la administración.
                </div>
              )}
            </div>

            {/* Direct Contact Button for Free Beta Request */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleOpenContactDirect}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs flex items-center justify-center space-x-2 transition-all active:scale-[0.98] shadow-lg shadow-emerald-500/20 cursor-pointer uppercase tracking-wider"
              >
                <MessageCircle className="w-4 h-4 text-slate-950" />
                <span>SOLICITAR CÓDIGO BETA GRATUITO AQUÍ</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-950 opacity-80" />
              </button>
            </div>

            {regError && (
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold flex items-center gap-2">
                <span>⚠️</span>
                <span>{regError}</span>
              </div>
            )}

            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                Nombre del Atleta *
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="ej. Carlos Mendoza"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  className="w-full text-sm data-input-field rounded-2xl pl-10 pr-4 py-3 text-white font-bold shadow-inner"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                Correo Electrónico *
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  placeholder="ej. carlos@gmail.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  className="w-full text-sm data-input-field rounded-2xl pl-10 pr-4 py-3 text-white font-bold shadow-inner"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                Contraseña de Acceso (Mín. 6 caracteres) *
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  minLength={6}
                  placeholder="••••••••"
                  value={regPin}
                  onChange={(e) => setRegPin(e.target.value)}
                  className="w-full text-base data-input-field rounded-2xl pl-10 pr-4 py-3 text-amber-300 font-mono font-black shadow-inner"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                Elige tu Avatar
              </label>
              <div className="grid grid-cols-6 gap-2">
                {AVATAR_OPTIONS.map((emoji, index) => (
                  <button
                    key={`${emoji}-${index}`}
                    type="button"
                    onClick={() => setRegAvatar(emoji)}
                    className={`text-xl p-2 rounded-2xl border transition-all ${
                      regAvatar === emoji
                        ? 'bg-amber-500/30 border-amber-400 scale-110 shadow-lg shadow-amber-500/20'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Objetivo Principal
              </label>
              <select
                value={regGoal}
                onChange={(e) => setRegGoal(e.target.value)}
                className="w-full text-xs bg-slate-950 border border-slate-800 rounded-2xl px-3 py-2.5 text-white font-medium focus:outline-none focus:border-amber-500"
              >
                {GOAL_OPTIONS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isRegistering || inviteStatus !== 'valid'}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 text-slate-950 font-black text-sm active:scale-98 shadow-xl shadow-amber-500/20 transition-all flex items-center justify-center space-x-2"
              >
                <span>
                  {isRegistering
                    ? 'QUEMANDO CÓDIGO...'
                    : 'QUEMAR CÓDIGO Y ACCEDER A LA BETA'}
                </span>
                <ArrowRight className="w-4 h-4 stroke-[3]" />
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Security Footer */}
      <div className="pt-4 text-center">
        <div className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-2xl bg-slate-950/80 border border-slate-800/80 text-slate-400 text-[11px] font-medium">
          <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
          <span>LAZCAKONGYM - BETA PRIVADA EXCLUSIVA · Invitación directa del Coach Camilo Lazcano</span>
        </div>
      </div>
    </div>
  );
};

