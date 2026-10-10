export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface PostgrestErrorLike {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** Códigos de Postgres/PostgREST -> respuesta HTTP. Los mensajes son genéricos a propósito. */
const POSTGRES_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  "42501": { status: 403, code: "FORBIDDEN", message: "No tienes permiso para esta acción" },
  "23503": { status: 409, code: "CONFLICT", message: "La operación referencia un recurso inexistente o en uso" },
  "23505": { status: 409, code: "CONFLICT", message: "Ya existe un recurso con esos datos" },
  "23514": { status: 422, code: "CONSTRAINT_VIOLATION", message: "Los datos no cumplen las reglas del sistema" },
  "23502": { status: 400, code: "VALIDATION_ERROR", message: "Falta un dato obligatorio" },
  "22P02": { status: 400, code: "VALIDATION_ERROR", message: "Formato de dato inválido" },
  PGRST116: { status: 404, code: "NOT_FOUND", message: "Recurso no encontrado" },
  PGRST301: { status: 401, code: "INVALID_TOKEN", message: "Token inválido o expirado" },
};

export function fromPostgrestError(error: PostgrestErrorLike): AppError {
  const mapped = error.code ? POSTGRES_ERRORS[error.code] : undefined;
  if (mapped) {
    return new AppError(mapped.status, mapped.code, mapped.message);
  }
  // Error no previsto: se loguea el detalle real y al cliente solo llega un mensaje genérico.
  console.error("[postgrest] error no mapeado:", error);
  return new AppError(500, "INTERNAL_ERROR", "Error interno del servidor");
}

type QueryResult<T> =
  | { data: T; error: null }
  | { data: null; error: PostgrestErrorLike };

/** Devuelve `data` o lanza el AppError correspondiente si la consulta falló. */
export function unwrap<T>(result: QueryResult<T>): T {
  if (result.error) {
    throw fromPostgrestError(result.error);
  }
  return result.data;
}
