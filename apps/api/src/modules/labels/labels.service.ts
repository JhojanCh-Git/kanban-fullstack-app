import type { CreateLabelInput, Database, Label, UpdateLabelInput } from "@kanban/shared";
import { forbiddenOrNotFound } from "../../lib/access.js";
import { AppError, unwrap } from "../../lib/errors.js";
import { toLabel } from "../../lib/mappers.js";
import type { UserClient } from "../../lib/supabase.js";

type LabelUpdate = Database["public"]["Tables"]["labels"]["Update"];

const LABEL_MESSAGES = {
  forbidden: "No tienes permiso para modificar esta etiqueta",
  notFound: "Etiqueta no encontrada",
};

const visibleLabel = (db: UserClient, id: string) =>
  db.from("labels").select("id").eq("id", id).maybeSingle();

/** UNIQUE (board_id, name): traduce el duplicado genérico a un error específico de etiquetas. */
function rethrowAsLabelNameTaken(error: unknown): never {
  if (error instanceof AppError && error.code === "DUPLICATE") {
    throw new AppError(409, "LABEL_NAME_TAKEN", "Ya existe una etiqueta con ese nombre en este tablero");
  }
  throw error;
}

async function assertBoardVisible(db: UserClient, boardId: string): Promise<void> {
  if (!unwrap(await db.from("boards").select("id").eq("id", boardId).maybeSingle())) {
    throw new AppError(404, "NOT_FOUND", "Tablero no encontrado");
  }
}

export async function listLabels(db: UserClient, boardId: string): Promise<Label[]> {
  const [boardRes, labelsRes] = await Promise.all([
    db.from("boards").select("id").eq("id", boardId).maybeSingle(),
    db.from("labels").select("*").eq("board_id", boardId).order("name", { ascending: true }),
  ]);
  if (!unwrap(boardRes)) {
    throw new AppError(404, "NOT_FOUND", "Tablero no encontrado");
  }
  return unwrap(labelsRes).map(toLabel);
}

export async function createLabel(
  db: UserClient,
  boardId: string,
  input: CreateLabelInput,
): Promise<Label> {
  await assertBoardVisible(db, boardId);

  const result = await db
    .from("labels")
    .insert({ board_id: boardId, name: input.name, color: input.color })
    .select("*")
    .single();

  try {
    return toLabel(unwrap(result));
  } catch (error) {
    return rethrowAsLabelNameTaken(error);
  }
}

export async function updateLabel(
  db: UserClient,
  labelId: string,
  input: UpdateLabelInput,
): Promise<Label> {
  const patch: LabelUpdate = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.color !== undefined) patch.color = input.color;

  const result = await db.from("labels").update(patch).eq("id", labelId).select("*").maybeSingle();

  let row;
  try {
    row = unwrap(result);
  } catch (error) {
    return rethrowAsLabelNameTaken(error);
  }
  if (!row) {
    throw await forbiddenOrNotFound(visibleLabel(db, labelId), LABEL_MESSAGES);
  }
  return toLabel(row);
}

/** Elimina la etiqueta; las asignaciones en task_labels se borran en cascada. */
export async function deleteLabel(db: UserClient, labelId: string): Promise<void> {
  const deleted = unwrap(await db.from("labels").delete().eq("id", labelId).select("id"));
  if (deleted.length === 0) {
    throw await forbiddenOrNotFound(visibleLabel(db, labelId), LABEL_MESSAGES);
  }
}
