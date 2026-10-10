import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * Clave de orden como texto (ej. "a0", "a1", "a0V").
 * En Postgres la columna es `text COLLATE "C"`, que ordena byte a byte.
 * La comparación `<` de JS sobre estas claves (solo ASCII) da el mismo orden.
 */
export type Position = string;

export class InvalidPositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPositionError";
  }
}

/**
 * Genera una clave que queda estrictamente entre `prev` y `next`.
 * - `prev = null`  -> insertar al inicio
 * - `next = null`  -> insertar al final
 * - ambos null     -> primer elemento
 * Lanza InvalidPositionError si los vecinos no están en orden (p. ej. por una
 * edición concurrente); el API debe responder 409 para que el cliente recargue.
 */
export function positionBetween(
  prev: Position | null | undefined,
  next: Position | null | undefined,
): Position {
  const a = prev ?? null;
  const b = next ?? null;

  if (a !== null && b !== null && a >= b) {
    throw new InvalidPositionError(
      `Los vecinos no están en orden (prev "${a}" >= next "${b}")`,
    );
  }

  try {
    return generateKeyBetween(a, b);
  } catch (error) {
    throw new InvalidPositionError(
      error instanceof Error ? error.message : "Posición inválida",
    );
  }
}

/** Claves iniciales para `count` elementos (ej. 3 -> ["a0", "a1", "a2"]). */
export function initialPositions(count: number): Position[] {
  return generateNKeysBetween(null, null, count);
}

/** Comparador para Array.sort, consistente con COLLATE "C". */
export function comparePositions(a: Position, b: Position): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
