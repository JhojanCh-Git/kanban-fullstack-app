import { unwrap } from "./errors.js";
import type { UserClient } from "./supabase.js";

/** Id de la última columna del tablero (la de "completado" por convención), o null si no hay. */
export async function getLastColumnId(db: UserClient, boardId: string): Promise<string | null> {
  const row = unwrap(
    await db
      .from("columns")
      .select("id")
      .eq("board_id", boardId)
      .order("position", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row?.id ?? null;
}

/** Posición de la última tarea de una columna (opcionalmente excluyendo una tarea), o null si está vacía. */
export async function getLastTaskPosition(
  db: UserClient,
  columnId: string,
  excludeTaskId?: string,
): Promise<string | null> {
  let query = db.from("tasks").select("position").eq("column_id", columnId);
  if (excludeTaskId) query = query.neq("id", excludeTaskId);
  const row = unwrap(await query.order("position", { ascending: false }).limit(1).maybeSingle());
  return row?.position ?? null;
}
