import React from 'react';
import { Bell, CheckCheck, ChevronRight, Activity, X } from 'lucide-react';
import { MuscleRecoveryNotification } from '../utils/muscleRecoveryNotifications';

interface RecoveryNotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: MuscleRecoveryNotification[];
  unreadCount: number;
  activeProfileName?: string;
  onSelectNotification: (notification: MuscleRecoveryNotification) => void;
  onMarkAllAsRead: () => void;
  onOpenMuscleSummary?: () => void;
  onOpenMuscleMap?: () => void;
}

function formatNotificationTimestamp(timestampMs: number): string {
  const diffMs = Math.max(0, Date.now() - timestampMs);
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Hace un momento';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;

  try {
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestampMs));
  } catch {
    return new Date(timestampMs).toLocaleDateString('es-CL');
  }
}

export const RecoveryNotificationsModal: React.FC<RecoveryNotificationsModalProps> = ({
  isOpen,
  onClose,
  notifications,
  unreadCount,
  activeProfileName,
  onSelectNotification,
  onMarkAllAsRead,
  onOpenMuscleSummary,
  onOpenMuscleMap,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 pb-[env(safe-area-inset-bottom,0px)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-notifications-title"
      data-testid="recovery-notifications-modal"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[86vh] bg-[#121212] border-t sm:border border-[#303030] rounded-t-[26px] sm:rounded-[26px] overflow-hidden flex flex-col shadow-[0_24px_60px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-5 py-4 bg-[#090909] border-b border-[#303030] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-10 h-10 rounded-xl bg-[#171717] border border-[#303030] flex items-center justify-center shrink-0 text-accent-text">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span
                  data-testid="notifications-modal-unread-dot"
                  className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-[#CCFF00] shadow-[0_0_8px_#CCFF00]"
                />
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="recovery-notifications-title"
                className="text-sm sm:text-base font-black italic uppercase tracking-tight text-[#F5F5F5] leading-tight truncate"
              >
                AVISOS DE RECUPERACIÓN
              </h2>
              <p className="text-xs text-[#A1A1AA] truncate mt-0.5">
                {activeProfileName ? `${activeProfileName} • ` : ''}
                {unreadCount > 0
                  ? `${unreadCount} sin leer`
                  : notifications.length > 0
                  ? 'Todo leído'
                  : 'Sin avisos nuevos'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar avisos de recuperación"
            className="w-11 h-11 rounded-xl bg-[#171717] border border-[#303030] hover:border-accent/60 text-[#F5F5F5] flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Utility bar */}
        {(unreadCount > 0 || onOpenMuscleSummary) && (
          <div className="px-4 sm:px-5 py-2.5 bg-[#0d0d0d] border-b border-[#303030]/80 flex flex-wrap items-center justify-between gap-2">
            {unreadCount > 0 ? (
              <button
                type="button"
                data-testid="mark-all-recovery-read-btn"
                onClick={onMarkAllAsRead}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#171717] border border-accent/45 hover:border-accent text-accent-text text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
                <span>Marcar todo como leído</span>
              </button>
            ) : (
              <span className="text-[11px] font-medium text-[#A1A1AA]">
                Basado en tu Mapa Muscular Inteligente
              </span>
            )}

            {onOpenMuscleSummary && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenMuscleSummary();
                }}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#171717] border border-[#303030] hover:border-accent/60 text-[#F5F5F5] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-accent-text" />
                <span>Ver 10 grupos</span>
              </button>
            )}
          </div>
        )}

        {/* Notifications List */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 flex-1">
          {notifications.length === 0 ? (
            <div
              data-testid="recovery-notifications-empty"
              className="rounded-2xl bg-[#171717] border border-[#303030] p-5 text-center space-y-3"
            >
              <div className="w-11 h-11 rounded-2xl bg-[#090909] border border-[#303030] flex items-center justify-center mx-auto text-[#A1A1AA]">
                <Bell className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-[#F5F5F5]">
                  Aún no hay avisos de recuperación
                </p>
                <p className="text-xs text-[#A1A1AA] leading-relaxed max-w-xs mx-auto">
                  Cuando un músculo en recuperación pase a estado{' '}
                  <span className="text-[#CCFF00] font-semibold">Listo</span> en el Mapa Muscular
                  Inteligente, aparecerá aquí.
                </p>
              </div>
              {onOpenMuscleMap && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenMuscleMap();
                  }}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-[#090909] border border-accent/50 hover:border-accent text-accent-text text-xs font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>Ir al Mapa Muscular</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            notifications.map((notification) => {
              const isUnread = !notification.read;
              return (
                <button
                  key={notification.id}
                  type="button"
                  data-testid={`recovery-notification-item-${notification.id}`}
                  data-read={notification.read ? 'true' : 'false'}
                  onClick={() => onSelectNotification(notification)}
                  className={`w-full text-left rounded-2xl p-3.5 sm:p-4 border transition-colors cursor-pointer active:scale-[0.99] flex items-start justify-between gap-3 ${
                    isUnread
                      ? 'bg-[#171717] border-accent/55 hover:border-accent shadow-[0_0_18px_var(--accent-glow)]'
                      : 'bg-[#141414] border-[#303030] hover:border-[#52525B]'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      {isUnread ? (
                        <span
                          aria-label="Sin leer"
                          className="w-2.5 h-2.5 rounded-full bg-[#CCFF00] shadow-[0_0_8px_#CCFF00] shrink-0"
                        />
                      ) : (
                        <span
                          aria-label="Leído"
                          className="w-2 h-2 rounded-full bg-[#52525B] shrink-0"
                        />
                      )}
                      <span
                        className={`text-sm font-extrabold leading-snug break-words ${
                          isUnread ? 'text-[#F5F5F5]' : 'text-[#D4D4D8]'
                        }`}
                      >
                        {notification.title}
                      </span>
                    </div>

                    <p className="text-xs text-[#A1A1AA] leading-relaxed pl-4">
                      {notification.message}
                    </p>

                    <div className="pl-4 pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-[#71717A]">
                        {formatNotificationTimestamp(notification.createdAt)}
                        {!isUnread && ' • Leído'}
                      </span>
                      <span className="font-bold text-accent-text inline-flex items-center gap-0.5">
                        <span>Ver en el mapa</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
export default RecoveryNotificationsModal;
