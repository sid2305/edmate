// Field formats (lead answers Q4), shared by the schema modules. Not part of the public API.
import { z } from 'zod';

/** Ids are pseudonymous: any non-empty string, no format. */
export const id = () => z.string().min(1);
/** Counts, token numbers, versions, money in minor units: non-negative safe integers. */
export const count = () => z.int().min(0);
/** Timestamps: ISO 8601 with a `Z` or a numeric offset. */
export const timestamp = () => z.iso.datetime({ offset: true });
/** Market: an ISO 3166-1 alpha-2 code of the locale pack, or the literal `global`. */
export const market = () =>
  z.string().regex(/^(?:[A-Z]{2}|global)$/, 'ISO 3166-1 alpha-2 code or "global"');
/** Currency: an ISO 4217 code. */
export const currencyCode = () => z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code');
export const tier = () => z.enum(['small', 'main']);
