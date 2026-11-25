import React, { useState } from 'react';
import { X, UserPlus, Trash2, Check, Crown, LogOut, Smartphone, Settings, ShieldCheck } from 'lucide-react';
import { Profile } from '../types';
import { AVATAR_OPTIONS, GOAL_OPTIONS } from '../data/defaultProfiles';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: Profile[];
  activeProfileId: string;
  isAdmin?: boolean;
  adminRequiresGoogleSignIn?: boolean;
  onSwitchProfile: (id: string) => void;
  onCreateProfile: (name: string, avatar: string, goal: string) => void;
  onDeleteProfile: (id: string) => void;
  onLogout?: () => void;
  onOpenInstallApk?: () => void;
  onNavigateTab?: (tab: string) => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  profiles,
  activeProfileId,
  isAdmin = false,
  adminRequiresGoogleSignIn = false,
  onSwitchProfile,
  onCreateProfile,
  onDeleteProfile,
  onLogout,
  onOpenInstallApk,
  onNavigateTab,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('🦍');
  const [goal, setGoal] = useState('Hipertrofia & Masa');
  const [pendingDeleteProfile, setPendingDeleteProfile] = useState<Profile | null>(null);

  const currentIsAdmin = Boolean(isAdmin);

  if (!isOpen) return null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentIsAdmin) return;
    if (name.trim()) {
      onCreateProfile(name.trim(), avatar, goal);
      setName('');
      setIsCreating(false);
    }
  };

  const handleSelectProfile = (profile: Profile) => {
    if (profile.id === activeProfileId) {
      onClose();
      return;
    }

    if (!currentIsAdmin) {
      return;
    }

    onSwitchProfile(profile.id);
    onClose();
  };

  const visibleProfiles = currentIsAdmin
    ? profiles
    : profiles.filter((p) => p.id === activeProfileId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#0d1424] border border-slate-700/80 rounded-3xl p-5 shadow-2xl text-slate-100 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-black text-white">Cuentas de Atletas</h3>
            <p className="text-[11px] text-slate-400">
              {currentIsAdmin
                ? 'Selecciona o administra atletas del sistema'
                : 'Tu perfil autenticado con Firebase Auth'}
            </p>
          </div>
          <button
            onClick={() => onClose()}
            className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isCreating && currentIsAdmin ? (
          <form onSubmit={handleCreate} className="space-y-4 my-4 animate-in fade-in">
            <div>
              <label className="text-xs font-bold text-slate-400 block mb-1">Nombre del Atleta</label>
              <input
                type="text"
                placeholder="ej. Cristóbal"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-xs bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-white font-bold focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 block mb-1">Elige un Avatar</label>
              <div className="grid grid-cols-6 gap-1.5 p-2 bg-slate-900 rounded-2xl border border-slate-800 max-h-32 overflow-y-auto">
                {AVATAR_OPTIONS.map((av, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAvatar(av)}
                    className={`text-xl p-2 rounded-xl transition-all ${
                      avatar === av ? 'bg-amber-500/20 border border-amber-500 scale-105' : 'hover:bg-slate-800'
                    }`}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 block mb-1">Objetivo Principal</label>
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full text-xs bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-white font-bold focus:outline-none focus:border-amber-500"
              >
                {GOAL_OPTIONS.map((g, idx) => (
                  <option key={idx} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20"
              >
                Guardar Atleta
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 my-4">
            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
              {visibleProfiles.map((profile) => {
                const isActive = profile.id === activeProfileId;
                return (
                  <div
                    key={profile.id}
                    onClick={() => handleSelectProfile(profile)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group active:scale-98 ${
                      isActive
                        ? 'bg-amber-500/15 border-amber-500/60 shadow-lg shadow-amber-500/10'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-2xl p-2 rounded-xl bg-slate-950 border border-slate-800">
                        {profile.avatar}
                      </span>
                      <div>
                        <div className="flex items-center space-x-1.5">
                          <h4 className="text-sm font-black text-white group-hover:text-amber-300 transition-colors">
                            {profile.name}
                          </h4>
                          {profile.isAdmin && (
                            <span className="inline-flex items-center text-[10px] text-amber-400 font-bold bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30">
                              <Crown className="w-3 h-3 fill-amber-400 mr-0.5" /> Admin
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400">{profile.goal}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      {isActive ? (
                        <span className="p-1.5 rounded-xl bg-amber-500 text-slate-950 font-black">
                          <Check className="w-4 h-4 stroke-[3]" />
                        </span>
                      ) : (
                        currentIsAdmin && !profile.isAdmin && profiles.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDeleteProfile(profile);
                            }}
                            className="p-2 text-slate-500 hover:text-rose-400 rounded-xl hover:bg-slate-800 transition-colors opacity-40 hover:opacity-100"
                            title="Eliminar cuenta de atleta en todos los dispositivos"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {pendingDeleteProfile && currentIsAdmin && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/40 space-y-2.5 animate-in fade-in">
                <p className="text-xs text-rose-200 font-bold leading-relaxed">
                  ¿Eliminar la cuenta de <strong>{pendingDeleteProfile.name}</strong>? Desaparecerá de TODOS los dispositivos de inmediato.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingDeleteProfile(null)}
                    className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteProfile(pendingDeleteProfile.id);
                      setPendingDeleteProfile(null);
                    }}
                    className="flex-1 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-black cursor-pointer"
                  >
                    Confirmar eliminación
                  </button>
                </div>
              </div>
            )}

            {!currentIsAdmin && adminRequiresGoogleSignIn && (
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 leading-snug">
                Sesión iniciada con correo/contraseña. Para habilitar el <strong>Panel de Administración</strong>, cierra sesión e ingresa con <strong>Continuar con Google</strong> usando tu cuenta autorizada.
              </div>
            )}

            <div className="space-y-2 pt-2">
              {onNavigateTab && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateTab('cloud');
                  }}
                  className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-bold flex items-center justify-center space-x-2 active:scale-98 transition-all cursor-pointer"
                >
                  <Settings className="w-4 h-4 text-accent-text" />
                  <span>Ajustes del Sistema & Configuración</span>
                </button>
              )}

              {currentIsAdmin && onNavigateTab && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateTab('admin');
                  }}
                  className="w-full py-3 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center justify-center space-x-2 active:scale-98 transition-all cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                  <span>Panel de Administración</span>
                </button>
              )}

              {currentIsAdmin && onOpenInstallApk && (
                <button
                  onClick={() => {
                    onClose();
                    onOpenInstallApk();
                  }}
                  className="w-full py-3 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center justify-center space-x-2 active:scale-98 transition-all"
                >
                  <Smartphone className="w-4 h-4 text-amber-400" />
                  <span>Generar Enlace de Invitación (1 Solo Uso)</span>
                </button>
              )}

              {currentIsAdmin && (
                <button
                  onClick={() => setIsCreating(true)}
                  className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-bold flex items-center justify-center space-x-2 active:scale-98 transition-all"
                >
                  <UserPlus className="w-4 h-4 text-amber-400" />
                  <span>Registrar Atleta Manualmente (Admin)</span>
                </button>
              )}

              {onLogout && (
                <button
                  onClick={() => {
                    onClose();
                    onLogout();
                  }}
                  className="w-full py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-xs font-bold flex items-center justify-center space-x-2 active:scale-98 transition-all"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Cerrar Sesión / Ir a Pantalla de Acceso</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
