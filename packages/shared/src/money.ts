/**
 * Money helpers.
 *
 * Every amount that crosses a boundary (API payload, Excel cell, PDF row) is a
 * plain `number` of currency units. All arithmetic here converts to integer
 * minor units first, so 0.1 + 0.2 never becomes 0.30000000000000004 in a
 * balance sheet that has to foot to the cent.
 */

export const SCALE = 100; // 2 decimal places

/**
 * Scale to minor units, half away from zero.
 *
 * `1.005 * 100` is 100.49999999999999 in binary floating point, so rounding it
 * directly loses the cent. Passing through `toPrecision(15)` collapses that
 * representation error before the rounding decision, which is what makes
 * `round2(1.005)` give 1.01 the way a ledger expects.
 */
function scaleToCents(value: number): number {
  const magnitude = Number((Math.abs(value) * SCALE).toPrecision(15));
  const rounded = Math.round(magnitude);
  return value < 0 ? -rounded : rounded;
}

/** Round half away from zero, the convention accountants expect. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return scaleToCents(value) / SCALE;
}

/** Currency units -> integer minor units (cents). */
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'string' ? parseAmount(value) : value;
  if (!Number.isFinite(n)) return 0;
  return scaleToCents(n);
}

/** Integer minor units -> currency units. */
export function fromCents(cents: number): number {
  return cents / SCALE;
}

/** Exact sum of a list of amounts. */
export function sum(values: Array<number | null | undefined>): number {
  let cents = 0;
  for (const v of values) cents += toCents(v ?? 0);
  return fromCents(cents);
}

export function add(...values: number[]): number {
  return sum(values);
}

export function subtract(a: number, b: number): number {
  return fromCents(toCents(a) - toCents(b));
}

export function multiply(a: number, factor: number): number {
  return round2(a * factor);
}

/** True when two amounts agree to the cent. */
export function equals(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}

/** Difference between two amounts, exact to the cent. */
export function difference(a: number, b: number): number {
  return fromCents(toCents(a) - toCents(b));
}

export function isZero(value: number): boolean {
  return toCents(value) === 0;
}

export function negate(value: number): number {
  return fromCents(-toCents(value));
}

/**
 * Parse a human typed or pasted amount.
 *
 * Handles thousands separators, currency symbols, a trailing or leading minus,
 * accounting parentheses for negatives, and the European "1.234,56" form.
 * Returns null when the text is not a number at all, so callers can tell
 * "empty cell" apart from "zero".
 */
export function parseAmount(input: string | number | null | undefined): number {
  const parsed = tryParseAmount(input);
  return parsed === null ? 0 : parsed;
}

export function tryParseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? round2(input) : null;

  let text = String(input).trim();
  if (text === '' || text === '-' || text === '.') return null;

  let negative = false;

  // Accounting parentheses: (1 234,56) is negative.
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  // Strip currency symbols, spaces (including non-breaking and thin), and letters.
  text = text.replace(/[^\d.,\-+]/g, '');

  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  if (text.endsWith('-')) {
    negative = !negative;
    text = text.slice(0, -1);
  }

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal separator.
    if (lastComma > lastDot) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const decimals = text.length - lastComma - 1;
    // "1,234" is a thousands group; "1,23" and "1,2345" are decimals.
    text = decimals === 3 ? text.replace(/,/g, '') : text.replace(',', '.');
  } else {
    // Only dots. "1.234.567" is grouped, a single dot is decimal.
    const dots = text.split('.').length - 1;
    if (dots > 1) text = text.replace(/\./g, '');
  }

  if (text === '' || text === '.') return null;

  const value = Number(text);
  if (!Number.isFinite(value)) return null;

  return round2(negative ? -value : value);
}

/** Format for display. Negatives render in parentheses when `accounting` is on. */
export function formatAmount(
  value: number | null | undefined,
  options: {
    locale?: string;
    currency?: string;
    accounting?: boolean;
    decimals?: number;
    blankOnZero?: boolean;
  } = {},
): string {
  const {
    locale = 'en-US',
    currency,
    accounting = true,
    decimals = 2,
    blankOnZero = false,
  } = options;

  const n = round2(value ?? 0);
  if (blankOnZero && isZero(n)) return '';

  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    ...(currency ? { style: 'currency', currency } : {}),
  }).format(abs);

  if (n < 0) return accounting ? `(${formatted})` : `-${formatted}`;
  return formatted;
}
