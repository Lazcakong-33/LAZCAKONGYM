import React from 'react';

export type TabType =
  | 'hoy'
  | 'rutinas'
  | 'ejercicios'
  | 'mapa-muscular'
  | 'activo'
  | 'records'
  | 'biometrics'
  | 'cloud'
  | 'admin';

interface NavigationProps {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
  hasActiveWorkout: boolean;
  isAdmin?: boolean;
}

const HomeIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={active ? 2.3 : 1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-6 h-6"
  >
    <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1v-9.5z" />
  </svg>
);

const DumbbellIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={active ? 2.2 : 1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-6 h-6"
  >
    <path d="M6.5 6.5v11" />
    <path d="M3.5 8.5v7" />
    <path d="M17.5 6.5v11" />
    <path d="M20.5 8.5v7" />
    <path d="M6.5 12h11" />
  </svg>
);

const TorsoMapIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={active ? 2.1 : 1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-6 h-6"
  >
    {/* Silueta anatómica de torso musculoso */}
    <path d="M9.5 4.5h5l1.5 2c2.2.6 4 2.2 4.5 4.5l-.8 5.5-2.2.5-.5-4.5-1.5 1.5v6.5h-7V14L7 12.5l-.5 4.5-2.2-.5L3.5 11c.5-2.3 2.3-3.9 4.5-4.5l1.5-2z" />
    <path d="M8.5 9.5c1 .8 2.5.8 3.5 0 1 .8 2.5.8 3.5 0" />
    <path d="M12 9.5v7" />
  </svg>
);

const PlayCircleIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={active ? 2.2 : 1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-6 h-6"
  >
    <circle cx="12" cy="12" r="9" />
    <polygon points="10 8.5 16 12 10 15.5 10 8.5" fill="currentColor" stroke="none" />
  </svg>
);

const ProgressBarsIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className="w-6 h-6"
  >
    <rect x="4" y="14" width="3.8" height="6" rx="1" opacity={active ? 1 : 0.85} />
    <rect x="10.1" y="10" width="3.8" height="10" rx="1" opacity={active ? 1 : 0.9} />
    <rect x="16.2" y="5" width="3.8" height="15" rx="1" />
  </svg>
);

const AdminShieldIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={active ? 2.2 : 1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-6 h-6"
  >
    <path d="M12 3l7 3v5c0 4.9-3 8.9-7 10-4-1.1-7-5.1-7-10V6l7-3z" />
    <path d="M9.5 12l1.8 1.8 3.4-3.6" />
  </svg>
);

export const Navigation: React.FC<NavigationProps> = ({
  currentTab,
  onTabChange,
  hasActiveWorkout,
  isAdmin = false,
}) => {
  const primaryTabs = [
    { id: 'hoy' as TabType, label: 'Inicio', Icon: HomeIcon },
    { id: 'rutinas' as TabType, label: 'Rutinas', Icon: DumbbellIcon },
    { id: 'mapa-muscular' as TabType, label: 'Mapa', Icon: TorsoMapIcon },
    { id: 'activo' as TabType, label: hasActiveWorkout ? 'En Curso' : 'Entrenar', Icon: PlayCircleIcon },
    { id: 'records' as TabType, label: 'Progreso', Icon: ProgressBarsIcon },
    ...(isAdmin ? [{ id: 'admin' as TabType, label: 'Admin', Icon: AdminShieldIcon }] : []),
  ];

  return (
    <nav
      aria-label="Navegación principal"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 10px)' }}
      className="fixed bottom-0 left-0 right-0 z-40 bg-[#0d0e0c]/95 backdrop-blur-xl border-t border-[#303030] rounded-t-[24px] pt-2 px-2 sm:px-3 shadow-[0_-10px_30px_rgba(0,0,0,0.95)]"
    >
      <div
        className={`max-w-md mx-auto grid items-center ${
          isAdmin ? 'grid-cols-6 gap-1' : 'grid-cols-5 gap-1.5'
        }`}
      >
        {primaryTabs.map((tab) => {
          const { Icon } = tab;
          const isActive =
            currentTab === tab.id || (tab.id === 'rutinas' && currentTab === 'ejercicios');
          const isWorkoutLive = tab.id === 'activo' && hasActiveWorkout;

          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`nav-tab-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              className={`relative h-[56px] sm:h-[60px] flex flex-col items-center justify-center rounded-2xl transition-all duration-200 px-0.5 sm:px-1 cursor-pointer active:scale-95 ${
                isActive
                  ? 'text-accent-text bg-gradient-to-b from-accent/25 via-accent/10 to-[#171717]/90 border border-accent/50 shadow-[0_0_20px_var(--accent-glow)]'
                  : isWorkoutLive
                  ? 'text-accent-text bg-[#171717] border border-accent/35'
                  : 'text-[#F5F5F5]/85 hover:text-[#F5F5F5] border border-transparent'
              }`}
            >
              {isActive && (
                <span className="absolute -top-[1px] left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-accent shadow-[0_0_10px_var(--accent-glow)]" />
              )}

              <Icon active={isActive} />

              <span
                className={`${
                  isAdmin ? 'text-[10px] sm:text-[11px]' : 'text-[11px]'
                } tracking-tight mt-1 leading-none whitespace-nowrap ${
                  isActive ? 'font-bold text-accent-text' : 'font-medium text-[#F5F5F5]'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
export default Navigation;
