import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  ThemeAccent,
  ThemeConfig,
  THEME_CONFIGS,
  getThemeConfig,
  applyThemeToRoot,
} from '../utils/theme';

interface ThemeContextValue {
  themeAccent: ThemeAccent;
  accentHex: string;
  themeConfig: ThemeConfig;
  setThemeAccent: (accent: ThemeAccent) => void;
  setThemeByHex: (hexColor: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeAccent: 'smartfit',
  accentHex: THEME_CONFIGS.smartfit.primary,
  themeConfig: THEME_CONFIGS.smartfit,
  setThemeAccent: () => {},
  setThemeByHex: () => {},
});

interface ThemeProviderProps {
  initialAccent?: ThemeAccent;
  onSyncProfileAccent?: (accent: ThemeAccent) => void;
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  initialAccent,
  onSyncProfileAccent,
  children,
}) => {
  const [themeAccent, setThemeAccentState] = useState<ThemeAccent>(() => {
    if (initialAccent && initialAccent in THEME_CONFIGS) {
      return initialAccent;
    }
    try {
      const saved = localStorage.getItem('lazcakon_theme_accent') as ThemeAccent | null;
      if (saved && saved in THEME_CONFIGS) {
        return saved;
      }
    } catch {}
    return 'smartfit';
  });

  // Sincronizar si el perfil activo cambia y tiene un tema específico guardado
  useEffect(() => {
    if (initialAccent && initialAccent in THEME_CONFIGS && initialAccent !== themeAccent) {
      setThemeAccentState(initialAccent);
      applyThemeToRoot(initialAccent);
      try {
        localStorage.setItem('lazcakon_theme_accent', initialAccent);
      } catch {}
    }
  }, [initialAccent]);

  // Aplicar variables CSS (--theme-primary, --theme-glow, etc.) al DOM cada vez que cambia el estado
  useEffect(() => {
    applyThemeToRoot(themeAccent);
    try {
      localStorage.setItem('lazcakon_theme_accent', themeAccent);
    } catch {}
  }, [themeAccent]);

  const setThemeAccent = useCallback(
    (accent: ThemeAccent) => {
      setThemeAccentState(accent);
      applyThemeToRoot(accent);
      try {
        localStorage.setItem('lazcakon_theme_accent', accent);
      } catch {}
      if (onSyncProfileAccent) {
        onSyncProfileAccent(accent);
      }
    },
    [onSyncProfileAccent]
  );

  const setThemeByHex = useCallback(
    (hexColor: string) => {
      const matched = getThemeConfig(hexColor);
      setThemeAccent(matched.id);
    },
    [setThemeAccent]
  );

  const themeConfig = getThemeConfig(themeAccent);

  return (
    <ThemeContext.Provider
      value={{
        themeAccent,
        accentHex: themeConfig.primary,
        themeConfig,
        setThemeAccent,
        setThemeByHex,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
