/**
 * Chart looks, taken from the user's Trading Hub chart (trade-copier-hub, static/osf_settings.js):
 * "Mein TradingView" mirrors his own TradingView setup (black, no grid, grey up / gold down),
 * the other two are TradingView's stock dark and light themes.
 */
export interface ChartTheme {
  readonly bg: string;
  readonly grid: string;
  readonly text: string;
  readonly scale: string;
  readonly cross: string;
  readonly up: string;
  readonly down: string;
  readonly volUp: string;
  readonly volDown: string;
}

export const CHART_THEMES = {
  'Mein TradingView': {
    bg: '#000000',
    grid: '#000000',
    text: '#B2B5BE',
    scale: '#2A2A2A',
    cross: '#787B86',
    up: '#B8B8B8',
    down: '#B39863',
    volUp: 'rgba(184, 184, 184, 0.35)',
    volDown: 'rgba(179, 152, 99, 0.35)',
  },
  'TradingView dunkel': {
    bg: '#131722',
    grid: '#1E222D',
    text: '#D1D4DC',
    scale: '#2A2E39',
    cross: '#758696',
    up: '#089981',
    down: '#F23645',
    volUp: 'rgba(8, 153, 129, 0.45)',
    volDown: 'rgba(242, 54, 69, 0.45)',
  },
  'TradingView hell': {
    bg: '#FFFFFF',
    grid: '#F0F3FA',
    text: '#131722',
    scale: '#E0E3EB',
    cross: '#9598A1',
    up: '#089981',
    down: '#F23645',
    volUp: 'rgba(8, 153, 129, 0.45)',
    volDown: 'rgba(242, 54, 69, 0.45)',
  },
} as const satisfies Record<string, ChartTheme>;

export type ChartThemeName = keyof typeof CHART_THEMES;
export const DEFAULT_CHART_THEME: ChartThemeName = 'Mein TradingView';
const KEY = 'ee:chart-theme';

/** Per-viewer convenience; falls back to the default if storage is unavailable. */
export function loadChartTheme(): ChartThemeName {
  try {
    const v = localStorage.getItem(KEY);
    return v !== null && v in CHART_THEMES ? (v as ChartThemeName) : DEFAULT_CHART_THEME;
  } catch {
    return DEFAULT_CHART_THEME;
  }
}

const listeners = new Set<() => void>();
let current: ChartThemeName | undefined;

export function saveChartTheme(name: ChartThemeName): void {
  current = name;
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // private window or blocked storage: the choice just is not remembered
  }
  for (const l of listeners) l();
}

/** For useSyncExternalStore: the server renders the default, the browser its saved choice. */
export const chartThemeStore = {
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: (): ChartThemeName => (current ??= loadChartTheme()),
  server: (): ChartThemeName => DEFAULT_CHART_THEME,
};

/** Exchange time on the axis, like the hub shows New York for futures: EU stocks → Berlin. */
export const CHART_TIME_ZONE = 'Europe/Berlin';
