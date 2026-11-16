export type ThemeAccent = 'smartfit' | 'gorilla' | 'electric' | 'amber';

export interface ThemeConfig {
  id: ThemeAccent;
  name: string;
  primary: string;
  hover: string;
  glow: string;
  softBg: string;
  borderSoft: string;
  text: string;
  bg: string;
  border: string;
  ring: string;
  gradient: string;
  badgeBg: string;
}

export const THEME_CONFIGS: Record<ThemeAccent, ThemeConfig> = {
  smartfit: {
    id: 'smartfit',
    name: 'Verde Lima Elite (#CCFF00)',
    primary: '#CCFF00',
    hover: '#b8e600',
    glow: 'rgba(204, 255, 0, 0.25)',
    softBg: 'rgba(204, 255, 0, 0.12)',
    borderSoft: 'rgba(204, 255, 0, 0.35)',
    text: 'text-[#CCFF00]',
    bg: 'bg-[#CCFF00]',
    border: 'border-[#CCFF00]',
    ring: 'ring-[#CCFF00]',
    gradient: 'from-[#CCFF00] to-lime-500',
    badgeBg: 'bg-[#CCFF00]/15 text-[#CCFF00] border-[#CCFF00]/35',
  },
  gorilla: {
    id: 'gorilla',
    name: 'Verde Lima LazcaKong (#CCFF00)',
    primary: '#CCFF00',
    hover: '#b8e600',
    glow: 'rgba(204, 255, 0, 0.25)',
    softBg: 'rgba(204, 255, 0, 0.12)',
    borderSoft: 'rgba(204, 255, 0, 0.35)',
    text: 'text-[#CCFF00]',
    bg: 'bg-[#CCFF00]',
    border: 'border-[#CCFF00]',
    ring: 'ring-[#CCFF00]',
    gradient: 'from-[#CCFF00] to-lime-500',
    badgeBg: 'bg-[#CCFF00]/15 text-[#CCFF00] border-[#CCFF00]/35',
  },
  electric: {
    id: 'electric',
    name: 'Verde Lima Elite (#CCFF00)',
    primary: '#CCFF00',
    hover: '#b8e600',
    glow: 'rgba(204, 255, 0, 0.25)',
    softBg: 'rgba(204, 255, 0, 0.12)',
    borderSoft: 'rgba(204, 255, 0, 0.35)',
    text: 'text-[#CCFF00]',
    bg: 'bg-[#CCFF00]',
    border: 'border-[#CCFF00]',
    ring: 'ring-[#CCFF00]',
    gradient: 'from-[#CCFF00] to-lime-500',
    badgeBg: 'bg-[#CCFF00]/15 text-[#CCFF00] border-[#CCFF00]/35',
  },
  amber: {
    id: 'amber',
    name: 'Verde Lima Elite (#CCFF00)',
    primary: '#CCFF00',
    hover: '#b8e600',
    glow: 'rgba(204, 255, 0, 0.25)',
    softBg: 'rgba(204, 255, 0, 0.12)',
    borderSoft: 'rgba(204, 255, 0, 0.35)',
    text: 'text-[#CCFF00]',
    bg: 'bg-[#CCFF00]',
    border: 'border-[#CCFF00]',
    ring: 'ring-[#CCFF00]',
    gradient: 'from-[#CCFF00] to-lime-500',
    badgeBg: 'bg-[#CCFF00]/15 text-[#CCFF00] border-[#CCFF00]/35',
  },
};

export function getThemeConfig(accent?: string): ThemeConfig {
  if (accent && accent in THEME_CONFIGS) {
    return THEME_CONFIGS[accent as ThemeAccent];
  }
  return THEME_CONFIGS.smartfit;
}

export function applyThemeToRoot(_accent?: string) {
  if (typeof document === 'undefined') return;
  const config = THEME_CONFIGS.smartfit;
  const root = document.documentElement;
  root.style.setProperty('--theme-primary', config.primary);
  root.style.setProperty('--theme-primary-hover', config.hover);
  root.style.setProperty('--theme-glow', config.glow);
  root.style.setProperty('--theme-soft-bg', config.softBg);
  root.style.setProperty('--theme-border-soft', config.borderSoft);
  root.setAttribute('data-theme-accent', 'smartfit');
}
