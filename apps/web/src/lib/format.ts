/** Display formatting only: values arrive as exact decimal strings from the engine. */

export function formatNumber(v: string | number, locale: string, digits = 2): string {
  const n = typeof v === 'number' ? v : Number(v);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Signed with an explicit + / − (never colour alone, brief §11.1). */
export function formatSigned(v: string | number, locale: string, digits = 2): string {
  const n = typeof v === 'number' ? v : Number(v);
  const s = formatNumber(Math.abs(n), locale, digits);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

export function direction(v: string | number): 'up' | 'down' | 'flat' {
  const n = typeof v === 'number' ? v : Number(v);
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
}

/** 24-hour time with its zone (brief §11.1: every time shows its zone), e.g. "22:00 CET" / "22:00 MEZ". */
export function formatTime(ts: number, locale: string, tz = 'Europe/Berlin'): string {
  // en-GB names European zones (CET/CEST); de uses MEZ/MESZ.
  const loc = locale === 'en' ? 'en-GB' : locale;
  return new Intl.DateTimeFormat(loc, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
    timeZoneName: 'short',
  }).format(ts);
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min ${s % 60} s`;
}

/** `0x1234…abcd` for wallet accounts; dev accounts stay as they are. */
export function shortAccount(account: string): string {
  return /^0x[0-9a-f]{40}$/i.test(account)
    ? `${account.slice(0, 6)}…${account.slice(-4)}`
    : account;
}
