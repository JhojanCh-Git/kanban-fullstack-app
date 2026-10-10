import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";
import type { UserClientFactory } from "../lib/supabase.js";

/**
 * Exige `Authorization: Bearer <JWT de Supabase>`.
 * 1. Verifica el token con getClaims(): verificación local con JWKS si el
 *    proyecto usa claves asimétricas (rápida), o consulta a Auth si no.
 * 2. Crea un cliente de Supabase que actúa como el usuario, para que RLS se
 *    evalúe siempre en la base de datos.
 */
export function authenticate(createUserClient: UserClientFactory) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";

    if (!token) {
      throw new AppError(401, "UNAUTHENTICATED", "Falta el token Bearer en el header Authorization");
    }

    const db = createUserClient(token);

    // getClaims() puede LANZAR (no solo devolver error) si el token no es un JWT bien
    // formado. Cualquier fallo de verificación se trata como 401 (falla cerrado).
    let claims: { sub?: string; email?: unknown } | undefined;
    try {
      const { data, error } = await db.auth.getClaims(token);
      claims = error ? undefined : data?.claims;
    } catch {
      claims = undefined;
    }

    if (!claims?.sub) {
      throw new AppError(401, "INVALID_TOKEN", "Token inválido o expirado");
    }

    req.auth = {
      userId: claims.sub,
      email: typeof claims.email === "string" ? claims.email : undefined,
      db,
    };
    next();
  };
}
