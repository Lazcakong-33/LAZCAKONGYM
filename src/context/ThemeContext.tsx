import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  DEFAULT_THEME_ACCENT,
  OfficialThemeAccent,
  ThemeAccent,
  ThemeConfig,
  getThemeConfig,
  normalizeThemeAccent,
  applyThemeToRoot,
} from '../utils/theme';

interface ThemeContextValue {
  themeAccent: OfficialThemeAccent;
  savedThemeAccent: OfficialThemeAccent;
  isPreviewActive: boolean;
  accentHex: string;
  themeConfig: ThemeConfig;
  /** Preview a theme immediately without persisting it to the athlete profile */
  previewThemeAccent: (accent: ThemeAccent | string) => void;
  /** Preview a theme by HEX without persisting */
  previewThemeByHex: (hexColor: string) => void;
  /** Revert visual theme back to the persisted athlete theme */
  revertThemePreview: () => void;
  /** Persist & apply a theme via profile sync callback */
  setThemeAccent: (accent: ThemeAccent | string) => void;
  setThemeByHex: (hexColor: string) => void;
}

const getPerAthleteThemeStorageKey = (profileId?: string | null): string | null => {
  if (!profileId || profileId === 'perfil_default') return null;
  return `lazcakon_${profileId}_theme_accent`;
};

const readStoredAthleteTheme = (profileId?: string | null): OfficialThemeAccent => {
  try {
    const scopedKey = getPerAthleteThemeStorageKey(profileId);
    if (scopedKey) {
      const scopedVal = localStorage.getItem(scopedKey);
      if (scopedVal) return normalizeThemeAccent(scopedVal);
    }
  } catch {}
  return DEFAULT_THEME_ACCENT;
};

const persistScopedAthleteTheme = (profileId: string | undefined | null, accent: OfficialThemeAccent) => {
  try {
    const scopedKey = getPerAthleteThemeStorageKey(profileId);
    if (scopedKey) {
      localStorage.setItem(scopedKey, accent);
    }
  } catch {}
};

const ThemeContext = createContext<ThemeContextValue>({
  themeAccent: DEFAULT_THEME_ACCENT,
  savedThemeAccent: DEFAULT_THEME_ACCENT,
  isPreviewActive: false,
  accentHex: getThemeConfig(DEFAULT_THEME_ACCENT).primary,
  themeConfig: getThemeConfig(DEFAULT_THEME_ACCENT),
  previewThemeAccent: () => {},
  previewThemeByHex: () => {},
  revertThemePreview: () => {},
  setThemeAccent: () => {},
  setThemeByHex: () => {},
});

interface ThemeProviderProps {
  profileId?: string | null;
  initialAccent?: ThemeAccent;
  onSyncProfileAccent?: (accent: OfficialThemeAccent) => void;
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  profileId,
  initialAccent,
  onSyncProfileAccent,
  children,
}) => {
  const resolveSavedForAthlete = useCallback(
    (pid?: string | null, profileAccent?: ThemeAccent): OfficialThemeAccent => {
      if (profileAccent) {
        return normalizeThemeAccent(profileAccent);
      }
      return readStoredAthleteTheme(pid);
    },
    []
  );

  const [savedThemeAccent, setSavedThemeAccent] = useState<OfficialThemeAccent>(() =>
    resolveSavedForAthlete(profileId, initialAccent)
  );
  const [themeAccent, setThemeAccentState] = useState<OfficialThemeAccent>(() =>
    resolveSavedForAthlete(profileId, initialAccent)
  );

  // Sync strictly per active athlete (isolation between athletes + default #CCFF00 for new athletes)
  useEffect(() => {
    const nextSaved = resolveSavedForAthlete(profileId, initialAccent);
    setSavedThemeAccent(nextSaved);
    setThemeAccentState(nextSaved);
    applyThemeToRoot(nextSaved);
    if (initialAccent) {
      persistScopedAthleteTheme(profileId, nextSaved);
    }
  }, [profileId, initialAccent, resolveSavedForAthlete]);

  // Apply CSS custom properties whenever active visual accent changes (live preview or saved)
  useEffect(() => {
    applyThemeToRoot(themeAccent);
  }, [themeAccent]);

  const previewThemeAccent = useCallback((accent: ThemeAccent | string) => {
    const normalized = normalizeThemeAccent(accent);
    setThemeAccentState(normalized);
    applyThemeToRoot(normalized);
  }, []);

  const previewThemeByHex = useCallback((hexColor: string) => {
    const normalized = normalizeThemeAccent(hexColor);
    setThemeAccentState(normalized);
    applyThemeToRoot(normalized);
  }, []);

  const revertThemePreview = useCallback(() => {
    setThemeAccentState(savedThemeAccent);
    applyThemeToRoot(savedThemeAccent);
  }, [savedThemeAccent]);

  const setThemeAccent = useCallback(
    (accent: ThemeAccent | string) => {
      const normalized = normalizeThemeAccent(accent);
      setSavedThemeAccent(normalized);
      setThemeAccentState(normalized);
      applyThemeToRoot(normalized);
      persistScopedAthleteTheme(profileId, normalized);
      if (onSyncProfileAccent) {
        onSyncProfileAccent(normalized);
      }
    },
    [profileId, onSyncProfileAccent]
  );

  const setThemeByHex = useCallback(
    (hexColor: string) => {
      setThemeAccent(normalizeThemeAccent(hexColor));
    },
    [setThemeAccent]
  );

  const themeConfig = getThemeConfig(themeAccent);
  const isPreviewActive = themeAccent !== savedThemeAccent;

  return (
    <ThemeContext.Provider
      value={{
        themeAccent,
        savedThemeAccent,
        isPreviewActive,
        accentHex: themeConfig.primary,
        themeConfig,
        previewThemeAccent,
        previewThemeByHex,
        revertThemePreview,
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
