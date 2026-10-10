import type { CreateSubtaskInput, Database, Subtask, UpdateSubtaskInput } from "@kanban/shared";
import { forbiddenOrNotFound } from "../../lib/access.js";
import { AppError, unwrap } from "../../lib/errors.js";
import { toSubtask } from "../../lib/mappers.js";
import { safePositionBetween } from "../../lib/ordering.js";
import type { UserClient } from "../../lib/supabase.js";

type SubtaskUpdate = Database["public"]["Tables"]["subtasks"]["Update"];

const SUBTASK_MESSAGES = {
  forbidden: "No tienes permiso para modificar esta subtarea",
  notFound: "Subtarea no encontrada",
};

const visibleSubtask = (db: UserClient, id: string) =>
  db.from("subtasks").select("id").eq("id", id).maybeSingle();

/** Agrega una subtarea al final del checklist de la tarea. */
export async function createSubtask(
  db: UserClient,
  taskId: string,
  input: CreateSubtaskInput,
): Promise<Subtask> {
  const [taskRes, lastRes] = await Promise.all([
    db.from("tasks").select("id").eq("id", taskId).maybeSingle(),
    db
      .from("subtasks")
      .select("position")
      .eq("task_id", taskId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!unwrap(taskRes)) {
    throw new AppError(404, "NOT_FOUND", "Tarea no encontrada");
  }
  const lastPosition = unwrap(lastRes)?.position ?? null;

  const row = unwrap(
    await db
      .from("subtasks")
      .insert({
        task_id: taskId,
        title: input.title,
        position: safePositionBetween(lastPosition, null),
      })
      .select("*")
      .single(),
  );
  return toSubtask(row);
}

export async function updateSubtask(
  db: UserClient,
  subtaskId: string,
  input: UpdateSubtaskInput,
): Promise<Subtask> {
  const patch: SubtaskUpdate = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.isCompleted !== undefined) patch.is_completed = input.isCompleted;

  const row = unwrap(
    await db.from("subtasks").update(patch).eq("id", subtaskId).select("*").maybeSingle(),
  );
  if (!row) {
    throw await forbiddenOrNotFound(visibleSubtask(db, subtaskId), SUBTASK_MESSAGES);
  }
  return toSubtask(row);
}

export async function deleteSubtask(db: UserClient, subtaskId: string): Promise<void> {
  const deleted = unwrap(await db.from("subtasks").delete().eq("id", subtaskId).select("id"));
  if (deleted.length === 0) {
    throw await forbiddenOrNotFound(visibleSubtask(db, subtaskId), SUBTASK_MESSAGES);
  }
}
