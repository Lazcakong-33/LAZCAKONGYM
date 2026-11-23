export type ThemeAccent =
  | 'smartfit'
  | 'violet_elite'
  | 'cyan_ice'
  | 'fuchsia_pro'
  | 'turquoise_fit'
  | 'gold_premium'
  | 'titan_red'
  | 'royal_blue'
  | 'power_orange'
  | 'rose_quartz'
  | 'gorilla'
  | 'electric'
  | 'amber';

export type OfficialThemeAccent =
  | 'smartfit'
  | 'violet_elite'
  | 'cyan_ice'
  | 'fuchsia_pro'
  | 'turquoise_fit'
  | 'gold_premium'
  | 'titan_red'
  | 'royal_blue'
  | 'power_orange'
  | 'rose_quartz';

export interface ThemeConfig {
  id: OfficialThemeAccent;
  name: string;
  primary: string;
  hover: string;
  glow: string;
  softBg: string;
  borderSoft: string;
  contrastText: '#090909' | '#FFFFFF';
  readableText: string;
  text: string;
  bg: string;
  border: string;
  ring: string;
  gradient: string;
  badgeBg: string;
}

export const DEFAULT_THEME_ACCENT: OfficialThemeAccent = 'smartfit';
export const INSTITUTIONAL_GORILLA_LIME_HEX = '#CCFF00';

export const THEME_PALETTE_LIST: readonly ThemeConfig[] = [
  {
    id: 'smartfit',
    name: 'Verde Lima Elite',
    primary: '#CCFF00',
    hover: '#B8E600',
    glow: 'rgba(204, 255, 0, 0.28)',
    softBg: 'rgba(204, 255, 0, 0.14)',
    borderSoft: 'rgba(204, 255, 0, 0.42)',
    contrastText: '#090909',
    readableText: '#CCFF00',
    text: 'text-[var(--accent-readable-text)]',
    bg: 'bg-[var(--accent-primary)]',
    border: 'border-[var(--accent-primary)]',
    ring: 'ring-[var(--accent-primary)]',
    gradient: 'from-[var(--accent-primary)] to-[var(--accent-hover)]',
    badgeBg: 'bg-accent/15 text-accent-text border-accent/40',
  },
  {
    id: 'violet_elite',
    name: 'Violeta Elite',
    primary: '#9D4EDD',
    hover: '#8B38CC',
    glow: 'rgba(157, 78, 221, 0.34)',
    softBg: 'rgba(157, 78, 221, 0.16)',
    borderSoft: 'rgba(157, 78, 221, 0.48)',
    contrastText: '#FFFFFF',
    // #C084FC achieves 6.78:1 contrast on #171717 and 7.54:1 on #090909 (WCAG AA >= 4.5:1)
    readableText: '#C084FC',
    text: 'text-[var(--accent-readable-text)]',
    bg: 'bg-[var(--accent-primary)]',
    border: 'border-[var(--accent-primary)]',
    ring: 'ring-[var(--accent-primary)]',
    gradient: 'from-[var(--accent-primary)] to-[var(--accent-hover)]',
    badgeBg: 'bg-accent/15 text-accent-text border-accent/40',
  },
  {
    id: 'cyan_ice',
    name: 'Cian Ice',
    primary: '#35C9FF',
    hover: '#1EB5ED',
    glow: 'rgba(53, 201, 255, 0.30)',
    softBg: 'rgba(53, 201, 255, 0.14)',
    borderSoft: 'rgba(53, 201, 255, 0.44)',
    contrastText: '#090909',
    readableText: '#35C9FF',
    text: 'text-[var(--accent-readable-text)]',
    bg: 'bg-[var(--accent-primary)]',
    border: 'border-[var(--accent-primary)]',
    ring: 'ring-[var(--accent-primary)]',
    gradient: 'from-[var(--accent-primary)] to-[var(--accent-hover)]',
    badgeBg: 'bg-accent/15 text-accent-text border-accent/40',
  },
  {
    id: 'fuchsia_pro',
    name: 'Fucsia Pro',
    primary: '#FF4FA3',
    hover: '#EA388E',
    glow: 'rgba(255, 79, 163, 0.30)',
    softBg: 'rgba(255, 79, 163, 0.14)',
    borderSoft: 'rgba(255, 79, 163, 0.44)',
    contrastText: '#090909',
    readableText: '#FF4FA3',
    text: 'text-[var(--accent-readable-text)]',
    bg: 'bg-[var(--accent-primary)]',
    border: 'border-[var(--accent-primary)]',
    ring: 'ring-[var(--accent-primary)]',
    gradient: 'from-[var(--accent-primary)] to-[var(--accent-hover)]',
    badgeBg: 'bg-accent/15 text-accent-text border-accent/40',
  },
  {
    id: 'turquoise_fit',
    name: 'Turquesa Fit',
    primary: '#00D1C7',
    hover: '#00B8AF',
    glow: 'rgba(0, 209, 199, 0.30)',
    softBg: 'rgba(0, 209, 199, 0.14)',
    borderSoft: 'rgba(0, 209, 199, 0.44)',
    contrastText: '#090909',
    readableText: '#00D1C7',
    text: 'text-[var(--accent-readable-text)]',
    bg: 'bg-[var(--accent-primary)]',
    border: 'border-[var(--accent-primary)]',
    ring: 'ring-[var(--accent-primary)]',
    gradient: 'from-[var(--accent-primary)] to-[var(--accent-hover)]',
    badgeBg: 'bg-accent/15 text-accent-text border-accent/40',
  },
  {
    id: 'gold_premium',
    name: 'Dorado Premium',
    primary: '#FFB703',
    hover: '#E6A400',
    glow: 'rgba(255, 183, 3, 0.30)',
    softBg: 'rgba(255, 183, 3, 0.14)',
    borderSoft: 'rgba(255, 183, 3, 0.44)',
    contrastText: '#090909',
    readableText: '#FFB703',
    text: 'text-[var(--accent-readable-text)]',
    bg: 'bg-[var(--accent-primary)]',
    border: 'border-[var(--accent-primary)]',
    ring: 'ring-[var(--accent-primary)]',
    gradient: 'from-[var(--accent-primary)] to-[var(--accent-hover)]',
    badgeBg: 'bg-accent/15 text-accent-text border-accent/40',
  },
  {
    id: 'titan_red',
    name: 'Rojo Titan',
    primary: '#FF4545',
    hover: '#E83232',
    glow: 'rgba(255, 69, 69, 0.30)',
    softBg: 'rgba(255, 69, 69, 0.14)',
    borderSoft: 'rgba(255, 69, 69, 0.45)',
    contrastText: '#090909',
    readableText: '#FF5C5C',
    text: 'text-[var(--accent-readable-text)]',
    bg: 'bg-[var(--accent-primary)]',
    border: 'border-[var(--accent-primary)]',
    ring: 'ring-[var(--accent-primary)]',
    gradient: 'from-[var(--accent-primary)] to-[var(--accent-hover)]',
    badgeBg: 'bg-accent/15 text-accent-text border-accent/40',
  },
  {
    id: 'royal_blue',
    name: 'Azul Royal',
    primary: '#4F7CFF',
    hover: '#3A66EB',
    glow: 'rgba(79, 124, 255, 0.32)',
    softBg: 'rgba(79, 124, 255, 0.15)',
    borderSoft: 'rgba(79, 124, 255, 0.46)',
    contrastText: '#090909',
    readableText: '#6B93FF',
    text: 'text-[var(--accent-readable-text)]',
    bg: 'bg-[var(--accent-primary)]',
    border: 'border-[var(--accent-primary)]',
    ring: 'ring-[var(--accent-primary)]',
    gradient: 'from-[var(--accent-primary)] to-[var(--accent-hover)]',
    badgeBg: 'bg-accent/15 text-accent-text border-accent/40',
  },
  {
    id: 'power_orange',
    name: 'Naranja Power',
    primary: '#FF8533',
    hover: '#EA7220',
    glow: 'rgba(255, 133, 51, 0.30)',
    softBg: 'rgba(255, 133, 51, 0.14)',
    borderSoft: 'rgba(255, 133, 51, 0.44)',
    contrastText: '#090909',
    readableText: '#FF8533',
    text: 'text-[var(--accent-readable-text)]',
    bg: 'bg-[var(--accent-primary)]',
    border: 'border-[var(--accent-primary)]',
    ring: 'ring-[var(--accent-primary)]',
    gradient: 'from-[var(--accent-primary)] to-[var(--accent-hover)]',
    badgeBg: 'bg-accent/15 text-accent-text border-accent/40',
  },
  {
    id: 'rose_quartz',
    name: 'Rosa Quartz',
    primary: '#FF80BF',
    hover: '#EB6AA9',
    glow: 'rgba(255, 128, 191, 0.30)',
    softBg: 'rgba(255, 128, 191, 0.14)',
    borderSoft: 'rgba(255, 128, 191, 0.44)',
    contrastText: '#090909',
    readableText: '#FF80BF',
    text: 'text-[var(--accent-readable-text)]',
    bg: 'bg-[var(--accent-primary)]',
    border: 'border-[var(--accent-primary)]',
    ring: 'ring-[var(--accent-primary)]',
    gradient: 'from-[var(--accent-primary)] to-[var(--accent-hover)]',
    badgeBg: 'bg-accent/15 text-accent-text border-accent/40',
  },
] as const;

export const THEME_CONFIGS: Record<OfficialThemeAccent, ThemeConfig> = THEME_PALETTE_LIST.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<OfficialThemeAccent, ThemeConfig>
);

const LEGACY_THEME_MAP: Record<string, OfficialThemeAccent> = {
  smartfit: 'smartfit',
  gorilla: 'smartfit',
  electric: 'smartfit',
  amber: 'smartfit',
};

export function normalizeThemeAccent(accent?: string | null): OfficialThemeAccent {
  if (!accent || typeof accent !== 'string') return DEFAULT_THEME_ACCENT;
  const trimmed = accent.trim();
  if (!trimmed) return DEFAULT_THEME_ACCENT;

  if (trimmed in THEME_CONFIGS) {
    return trimmed as OfficialThemeAccent;
  }
  if (trimmed in LEGACY_THEME_MAP) {
    return LEGACY_THEME_MAP[trimmed];
  }

  const lower = trimmed.toLowerCase();
  const byHex = THEME_PALETTE_LIST.find((item) => item.primary.toLowerCase() === lower);
  if (byHex) {
    return byHex.id;
  }

  return DEFAULT_THEME_ACCENT;
}

export function getThemeConfig(accent?: string | null): ThemeConfig {
  const normalizedId = normalizeThemeAccent(accent);
  return THEME_CONFIGS[normalizedId] || THEME_CONFIGS.smartfit;
}

export function getContrastRatio(hexA: string, hexB: string): number {
  const parseHex = (h: string): [number, number, number] => {
    const clean = h.replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  };
  const relativeLuminance = (hex: string): number => {
    const [r, g, b] = parseHex(hex).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function applyThemeToRoot(accent?: string | null) {
  if (typeof document === 'undefined') return;
  const config = getThemeConfig(accent);
  const root = document.documentElement;

  // Canonical accent CSS variables
  root.style.setProperty('--accent-primary', config.primary);
  root.style.setProperty('--accent-hover', config.hover);
  root.style.setProperty('--accent-glow', config.glow);
  root.style.setProperty('--accent-soft-bg', config.softBg);
  root.style.setProperty('--accent-border-soft', config.borderSoft);
  root.style.setProperty('--accent-contrast-text', config.contrastText);
  root.style.setProperty('--accent-readable-text', config.readableText);

  // Backwards-compatible aliases
  root.style.setProperty('--theme-primary', config.primary);
  root.style.setProperty('--theme-primary-hover', config.hover);
  root.style.setProperty('--theme-glow', config.glow);
  root.style.setProperty('--theme-soft-bg', config.softBg);
  root.style.setProperty('--theme-border-soft', config.borderSoft);
  root.style.setProperty('--theme-on-primary', config.contrastText);
  root.style.setProperty('--theme-text', config.readableText);

  root.setAttribute('data-theme-accent', config.id);
}
