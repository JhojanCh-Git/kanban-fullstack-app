import type {
  Column,
  CreateColumnInput,
  DeleteColumnQuery,
  MoveColumnInput,
  UpdateColumnInput,
} from "@kanban/shared";
import { forbiddenOrNotFound } from "../../lib/access.js";
import { AppError, unwrap } from "../../lib/errors.js";
import { toColumn, type ColumnRow } from "../../lib/mappers.js";
import { assertValidNeighbors, safePositionBetween, staleNeighborsError } from "../../lib/ordering.js";
import type { UserClient } from "../../lib/supabase.js";
import { getLastColumnId, getLastTaskPosition } from "../../lib/queries.js";

const COLUMN_MESSAGES = {
  forbidden: "No tienes permiso para modificar esta columna",
  notFound: "Columna no encontrada",
};

const visibleColumn = (db: UserClient, id: string) =>
  db.from("columns").select("id").eq("id", id).maybeSingle();

/** Posición de la última columna del tablero (opcionalmente excluyendo una). */
async function getLastColumnPosition(
  db: UserClient,
  boardId: string,
  excludeId?: string,
): Promise<string | null> {
  let query = db.from("columns").select("position").eq("board_id", boardId);
  if (excludeId) query = query.neq("id", excludeId);
  const row = unwrap(await query.order("position", { ascending: false }).limit(1).maybeSingle());
  return row?.position ?? null;
}

async function loadColumns(db: UserClient, ids: string[]): Promise<ColumnRow[]> {
  if (ids.length === 0) return [];
  return unwrap(await db.from("columns").select("*").in("id", ids));
}

export async function createColumn(
  db: UserClient,
  boardId: string,
  input: CreateColumnInput,
): Promise<Column> {
  const [boardRes, lastPosition] = await Promise.all([
    db.from("boards").select("id").eq("id", boardId).maybeSingle(),
    getLastColumnPosition(db, boardId),
  ]);
  if (!unwrap(boardRes)) {
    throw new AppError(404, "NOT_FOUND", "Tablero no encontrado");
  }

  const row = unwrap(
    await db
      .from("columns")
      .insert({
        board_id: boardId,
        title: input.title,
        position: safePositionBetween(lastPosition, null),
      })
      .select("*")
      .single(),
  );
  return toColumn(row);
}

export async function updateColumn(
  db: UserClient,
  columnId: string,
  input: UpdateColumnInput,
): Promise<Column> {
  const row = unwrap(
    await db.from("columns").update({ title: input.title }).eq("id", columnId).select("*").maybeSingle(),
  );
  if (!row) {
    throw await forbiddenOrNotFound(visibleColumn(db, columnId), COLUMN_MESSAGES);
  }
  return toColumn(row);
}

/**
 * Reordena una columna entre dos vecinos. La posición la calcula el servidor.
 * Sin prevId ni nextId (tablero que el cliente creía vacío) se agrega al final.
 */
export async function moveColumn(
  db: UserClient,
  columnId: string,
  input: MoveColumnInput,
): Promise<Column> {
  const prevId = input.prevId ?? null;
  const nextId = input.nextId ?? null;
  assertValidNeighbors(columnId, prevId, nextId);

  const neighborIds = [prevId, nextId].filter((id): id is string => id !== null);
  const [columnRes, neighborRows] = await Promise.all([
    db.from("columns").select("*").eq("id", columnId).maybeSingle(),
    loadColumns(db, neighborIds),
  ]);

  const column = unwrap(columnRes);
  if (!column) {
    throw new AppError(404, "NOT_FOUND", COLUMN_MESSAGES.notFound);
  }

  const neighbors = new Map(neighborRows.map((row) => [row.id, row]));
  for (const id of neighborIds) {
    const neighbor = neighbors.get(id);
    if (!neighbor || neighbor.board_id !== column.board_id) {
      throw staleNeighborsError();
    }
  }

  let position: string;
  if (prevId === null && nextId === null) {
    position = safePositionBetween(await getLastColumnPosition(db, column.board_id, columnId), null);
  } else {
    position = safePositionBetween(
      prevId ? (neighbors.get(prevId)?.position ?? null) : null,
      nextId ? (neighbors.get(nextId)?.position ?? null) : null,
    );
  }

  const row = unwrap(
    await db.from("columns").update({ position }).eq("id", columnId).select("*").maybeSingle(),
  );
  if (!row) {
    throw await forbiddenOrNotFound(visibleColumn(db, columnId), COLUMN_MESSAGES);
  }
  return toColumn(row);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Mueve todas las tareas de `source` al final de `destinationId`, conservando su
 * orden relativo. Si el destino es la última columna, las marca como completadas.
 * No es atómico: si falla a medias, repetir la petición mueve las que faltan.
 */
async function moveAllTasks(
  db: UserClient,
  source: ColumnRow,
  destinationId: string,
  tasks: { id: string; completed_at: string | null }[],
): Promise<void> {
  const destination = unwrap(
    await db.from("columns").select("*").eq("id", destinationId).maybeSingle(),
  );
  if (!destination) {
    throw new AppError(404, "NOT_FOUND", "La columna destino no existe");
  }
  if (destination.board_id !== source.board_id) {
    throw new AppError(422, "CROSS_BOARD", "La columna destino pertenece a otro tablero");
  }
  if (tasks.length === 0) return;

  const [lastColumnId, lastTaskPosition] = await Promise.all([
    getLastColumnId(db, source.board_id),
    getLastTaskPosition(db, destination.id),
  ]);

  const destinationIsLast = destination.id === lastColumnId;
  const now = new Date().toISOString();

  let cursor = lastTaskPosition;
  const updates = tasks.map((task) => {
    cursor = safePositionBetween(cursor, null);
    return {
      id: task.id,
      patch: {
        column_id: destination.id,
        position: cursor,
        completed_at: destinationIsLast ? (task.completed_at ?? now) : null,
      },
    };
  });

  for (const batch of chunk(updates, 25)) {
    const results = await Promise.all(
      batch.map((update) =>
        db.from("tasks").update(update.patch).eq("id", update.id).select("id"),
      ),
    );
    for (const result of results) {
      if (unwrap(result).length === 0) {
        throw new AppError(403, "FORBIDDEN", "No tienes permiso para mover estas tareas");
      }
    }
  }
}

/**
 * Elimina una columna.
 * - Vacía: se elimina.
 * - Con tareas y sin `moveTo` ni `cascade`: 409 COLUMN_NOT_EMPTY (el cliente debe confirmar).
 * - `moveTo=<columnId>`: mueve las tareas al final de esa columna y luego elimina.
 * - `cascade=true`: elimina la columna y sus tareas (ON DELETE CASCADE).
 */
export async function deleteColumn(
  db: UserClient,
  columnId: string,
  query: DeleteColumnQuery,
): Promise<void> {
  const { moveTo, cascade } = query;
  if (moveTo === columnId) {
    throw new AppError(400, "VALIDATION_ERROR", "moveTo no puede ser la misma columna que se elimina");
  }

  const column = unwrap(await db.from("columns").select("*").eq("id", columnId).maybeSingle());
  if (!column) {
    throw new AppError(404, "NOT_FOUND", COLUMN_MESSAGES.notFound);
  }

  const tasks = unwrap(
    await db
      .from("tasks")
      .select("id, completed_at")
      .eq("column_id", columnId)
      .order("position", { ascending: true })
      .order("id", { ascending: true }),
  );

  if (tasks.length > 0 && !moveTo && !cascade) {
    throw new AppError(
      409,
      "COLUMN_NOT_EMPTY",
      "La columna tiene tareas: usa ?moveTo=<idColumna> para moverlas o ?cascade=true para eliminarlas",
      [{ taskCount: tasks.length }],
    );
  }

  if (moveTo) {
    await moveAllTasks(db, column, moveTo, tasks);
  }

  const deleted = unwrap(await db.from("columns").delete().eq("id", columnId).select("id"));
  if (deleted.length === 0) {
    throw await forbiddenOrNotFound(visibleColumn(db, columnId), COLUMN_MESSAGES);
  }
}
