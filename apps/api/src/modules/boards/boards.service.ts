import type {
  Board,
  BoardDetail,
  CreateBoardInput,
  Database,
  UpdateBoardInput,
} from "@kanban/shared";
import { forbiddenOrNotFound } from "../../lib/access.js";
import { AppError, unwrap } from "../../lib/errors.js";
import {
  toBoard,
  toColumn,
  toLabel,
  toTask,
  type BoardRow,
  type TaskRowWithRelations,
} from "../../lib/mappers.js";
import type { UserClient } from "../../lib/supabase.js";

type BoardUpdate = Database["public"]["Tables"]["boards"]["Update"];

const BOARD_MESSAGES = {
  forbidden: "No tienes permiso para modificar este tablero",
  notFound: "Tablero no encontrado",
};

const visibleBoard = (db: UserClient, id: string) =>
  db.from("boards").select("id").eq("id", id).maybeSingle();

export async function listBoards(db: UserClient): Promise<Board[]> {
  const rows = unwrap(
    await db.from("boards").select("*").order("created_at", { ascending: false }),
  );
  return rows.map(toBoard);
}

/** Llama al RPC atómico: crea tablero + owner + 3 columnas por defecto. */
export async function createBoard(db: UserClient, input: CreateBoardInput): Promise<Board> {
  const data = unwrap(
    await db.rpc("create_board", {
      p_title: input.title,
      p_description: input.description ?? undefined,
    }),
  );

  // Según la versión de `supabase gen types`, un RPC que devuelve una fila puede tiparse como objeto o como arreglo.
  const row = (Array.isArray(data) ? data[0] : data) as BoardRow | undefined;
  if (!row) {
    throw new AppError(500, "INTERNAL_ERROR", "No se pudo crear el tablero");
  }
  return toBoard(row);
}

/** Payload completo del tablero en una sola respuesta (el BFF arma todo). */
export async function getBoardDetail(db: UserClient, boardId: string): Promise<BoardDetail> {
  const [boardRes, columnsRes, labelsRes, tasksRes] = await Promise.all([
    db.from("boards").select("*").eq("id", boardId).maybeSingle(),
    db
      .from("columns")
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true })
      .order("id", { ascending: true }),
    db.from("labels").select("*").eq("board_id", boardId).order("name", { ascending: true }),
    db
      .from("tasks")
      .select("*, subtasks(*), task_labels(label_id)")
      .eq("board_id", boardId)
      .order("position", { ascending: true })
      .order("id", { ascending: true })
      .order("position", { referencedTable: "subtasks", ascending: true }),
  ]);

  const board = unwrap(boardRes);
  if (!board) {
    throw new AppError(404, "NOT_FOUND", "Tablero no encontrado");
  }

  const columns = unwrap(columnsRes);
  const labels = unwrap(labelsRes);
  const tasks = unwrap(tasksRes) as TaskRowWithRelations[];

  return {
    ...toBoard(board),
    columns: columns.map(toColumn),
    labels: labels.map(toLabel),
    tasks: tasks.map(toTask),
  };
}

export async function updateBoard(
  db: UserClient,
  boardId: string,
  input: UpdateBoardInput,
): Promise<Board> {
  const patch: BoardUpdate = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;

  const row = unwrap(
    await db.from("boards").update(patch).eq("id", boardId).select("*").maybeSingle(),
  );
  if (!row) {
    throw await forbiddenOrNotFound(visibleBoard(db, boardId), BOARD_MESSAGES);
  }
  return toBoard(row);
}

export async function deleteBoard(db: UserClient, boardId: string): Promise<void> {
  const deleted = unwrap(await db.from("boards").delete().eq("id", boardId).select("id"));
  if (deleted.length === 0) {
    throw await forbiddenOrNotFound(visibleBoard(db, boardId), BOARD_MESSAGES);
  }
}
