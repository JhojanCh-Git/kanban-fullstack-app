import type { z } from "zod";
import { AppError } from "./errors.js";

/** Valida `data` contra un schema de Zod; si falla, lanza AppError 400 con el detalle por campo. */
export function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Datos inválidos",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
