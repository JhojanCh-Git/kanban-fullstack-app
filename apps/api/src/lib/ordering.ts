import { InvalidPositionError, positionBetween } from "@kanban/shared";
import { AppError } from "./errors.js";

/**
 * positionBetween() que traduce InvalidPositionError a 409: ocurre cuando los
 * vecinos ya no están en el orden que el cliente creía (edición concurrente).
 */
export function safePositionBetween(prev: string | null, next: string | null): string {
  try {
    return positionBetween(prev, next);
  } catch (error) {
    if (error instanceof InvalidPositionError) {
      throw new AppError(
        409,
        "POSITION_CONFLICT",
        "El orden cambió mientras movías el elemento; recarga el tablero e inténtalo de nuevo",
      );
    }
    throw error;
  }
}

/** Validaciones baratas de prevId/nextId antes de tocar la base de datos. */
export function assertValidNeighbors(
  selfId: string,
  prevId: string | null,
  nextId: string | null,
): void {
  if (prevId === selfId || nextId === selfId) {
    throw new AppError(400, "VALIDATION_ERROR", "Un elemento no puede ser vecino de sí mismo");
  }
  if (prevId !== null && prevId === nextId) {
    throw new AppError(400, "VALIDATION_ERROR", "prevId y nextId no pueden ser iguales");
  }
}

/** Error estándar cuando un vecino ya no existe o ya no está donde el cliente creía. */
export function staleNeighborsError(): AppError {
  return new AppError(
    409,
    "POSITION_CONFLICT",
    "Los elementos vecinos cambiaron; recarga el tablero e inténtalo de nuevo",
  );
}
