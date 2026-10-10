import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@kanban/shared";

export type UserClient = SupabaseClient<Database>;
export type UserClientFactory = (accessToken: string) => UserClient;

/**
 * Crea un cliente de Supabase que actúa COMO el usuario: usa la clave anon
 * más el JWT del usuario en el header Authorization, así Postgres evalúa RLS
 * con su identidad. Un cliente nuevo por petición; nada de sesión compartida.
 */
export function createUserClientFactory(url: string, anonKey: string): UserClientFactory {
  return (accessToken) =>
    createClient<Database>(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
}
