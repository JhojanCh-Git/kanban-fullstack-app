import type { Request } from "express";
import { AppError } from "./errors.js";
import type { UserClient } from "./supabase.js";

export interface AuthContext {
  userId: string;
  email?: string;
  /** Cliente de Supabase que actúa como este usuario (RLS aplica). */
  db: UserClient;
}

/** Devuelve el contexto de autenticación o lanza 401 si el middleware no lo estableció. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw new AppError(401, "UNAUTHENTICATED", "Autenticación requerida");
  }
  return req.auth;
}
