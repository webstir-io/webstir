import { z } from 'zod';

/** Upper bound for each framework-owned manifest, render-program and flash collection. */
export const MAX_CONTRACT_COLLECTION_ITEMS = 10_000;

export function contractArray<T extends z.ZodType>(element: T) {
  return z.array(element).max(MAX_CONTRACT_COLLECTION_ITEMS);
}
