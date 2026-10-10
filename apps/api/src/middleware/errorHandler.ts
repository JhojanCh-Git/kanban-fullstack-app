import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, "NOT_FOUND", `Ruta no encontrada: ${req.method} ${req.path}`));
}

interface HttpLikeError {
  status?: number;
  statusCode?: number;
  type?: string;
}

/**
 * Convierte cualquier error en { error: { code, message, details? } }.
 * Los errores desconocidos se loguean y NUNCA exponen su mensaje al cliente.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Errores de express.json(): JSON malformado, body demasiado grande, etc.
  const http = err as HttpLikeError;
  const status = http?.status ?? http?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500 && typeof http.type === "string") {
    const tooLarge = http.type === "entity.too.large";
    res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
        message: tooLarge ? "El cuerpo de la petición es demasiado grande" : "JSON inválido en el cuerpo de la petición",
      },
    });
    return;
  }

  console.error("[error] no controlado:", err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" },
  });
}
