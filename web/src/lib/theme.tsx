import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** Sidebar presets: `bg` is applied inline so any color the user picks works, the rest drives derived styles. */
export const THEMES = {
  aubergine: { label: 'Aubergine', bg: '#4a154b', text: '#f4eef4' },
  forest: { label: 'Forest', bg: '#1f3d2e', text: '#eaf5ee' },
  twilight: { label: 'Twilight', bg: '#1d2b53', text: '#e8edf8' },
  graphite: { label: 'Graphite', bg: '#2b2b2f', text: '#f1f1f3' },
  ocean: { label: 'Ocean', bg: '#0f4c5c', text: '#e6f4f6' },
  plum: { label: 'Plum', bg: '#3b1d4a', text: '#f4ecf8' },
  clay: { label: 'Clay', bg: '#5b2c1e', text: '#f8ece6' },
  midnight: { label: 'Midnight', bg: '#0b1020', text: '#e6e9f2' },
} as const;

export type ThemeName = keyof typeof THEMES;

interface ThemeValue {
  theme: ThemeName | 'custom';
  custom: string | null;
  color: string;
  textColor: string;
  setTheme: (name: ThemeName) => void;
  setCustom: (hex: string | null) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const THEME_KEY = 'tc.sidebarTheme';
const CUSTOM_KEY = 'tc.sidebarCustom';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function luminance(hex: string) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Dark backgrounds get light text; light backgrounds (user picks one) get dark text. */
export function textOn(bg: string) {
  return luminance(bg) > 0.6 ? '#1d1c1d' : '#f7f7f8';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName | 'custom'>(() => {
    const saved = read<string>(THEME_KEY, 'aubergine');
    return saved in THEMES ? (saved as ThemeName) : 'aubergine';
  });
  const [custom, setCustomState] = useState<string | null>(() => {
    const saved = read<string | null>(CUSTOM_KEY, null);
    return saved && /^#[0-9a-f]{6}$/i.test(saved) ? saved : null;
  });

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify(theme));
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
    } catch {
      /* storage unavailable */
    }
  }, [custom]);

  const color = theme === 'custom' && custom ? custom : THEMES[theme as ThemeName].bg;
  const textColor = theme === 'custom' ? textOn(color) : THEMES[theme as ThemeName].text;

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-bg', color);
  }, [color]);

  const setTheme = useCallback((name: ThemeName) => setThemeState(name), []);
  const setCustom = useCallback((hex: string | null) => {
    if (hex) {
      setCustomState(hex);
      setThemeState('custom');
    } else {
      setCustomState(null);
      setThemeState((t) => (t === 'custom' ? 'aubergine' : t));
    }
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ theme, custom, color, textColor, setTheme, setCustom }),
    [theme, custom, color, textColor, setTheme, setCustom],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
