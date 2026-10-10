import { AppError } from "./errors.js";

/**
 * Con RLS, "no existe" y "no tienes acceso" se ven igual (0 filas).
 * Tras un UPDATE/DELETE vacío distinguimos con una consulta de visibilidad:
 * si el recurso es visible para el usuario pero no se pudo modificar -> 403;
 * si no es visible -> 404 (sin revelar si existe).
 */
export async function forbiddenOrNotFound(
  visibility: PromiseLike<{ data: unknown }>,
  messages: { forbidden: string; notFound: string },
): Promise<AppError> {
  const { data } = await visibility;
  return data
    ? new AppError(403, "FORBIDDEN", messages.forbidden)
    : new AppError(404, "NOT_FOUND", messages.notFound);
}
