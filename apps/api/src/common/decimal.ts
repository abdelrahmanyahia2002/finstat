import { Prisma } from '@prisma/client';
import { round2 } from '@finstat/shared';

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

/**
 * Prisma hands back Decimal objects. Everything above the repository layer
 * works in plain numbers rounded to the cent, so the conversion happens once,
 * here, instead of being repeated in every service.
 */
export function toNumber(value: DecimalLike): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return round2(value);
  if (typeof value === 'string') return round2(Number(value));
  return round2(value.toNumber());
}

/** Numbers going back into a Decimal column. */
export function toDecimal(value: number | null | undefined): Prisma.Decimal {
  return new Prisma.Decimal(round2(value ?? 0).toFixed(2));
}

export function toOptionalDecimal(value: number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  return toDecimal(value);
}
