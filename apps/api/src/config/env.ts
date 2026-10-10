import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  SUPABASE_URL: z.string().url("SUPABASE_URL debe ser una URL válida"),
  SUPABASE_ANON_KEY: z.string().min(1, "SUPABASE_ANON_KEY es obligatoria"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
});

export interface Env {
  nodeEnv: "development" | "test" | "production";
  port: number;
  supabaseUrl: string;
  supabaseAnonKey: string;
  corsOrigins: string[];
}

/**
 * Valida las variables de entorno al arrancar.
 * Lanza un Error con un mensaje legible si falta o es inválida alguna.
 * Nota: a propósito NO se lee SUPABASE_SERVICE_ROLE_KEY; el API no la necesita.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Variables de entorno inválidas:\n${problems}`);
  }

  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
