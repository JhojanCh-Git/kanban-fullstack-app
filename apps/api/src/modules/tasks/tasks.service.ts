import type {
  CreateTaskInput,
  Database,
  MoveTaskInput,
  Task,
  UpdateTaskInput,
} from "@kanban/shared";
import { forbiddenOrNotFound } from "../../lib/access.js";
import { AppError, unwrap } from "../../lib/errors.js";
import { toTask, type TaskRowWithRelations } from "../../lib/mappers.js";
import { assertValidNeighbors, safePositionBetween, staleNeighborsError } from "../../lib/ordering.js";
import { getLastColumnId, getLastTaskPosition } from "../../lib/queries.js";
import type { UserClient } from "../../lib/supabase.js";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

const TASK_SELECT = "*, subtasks(*), task_labels(label_id)";

const TASK_MESSAGES = {
  forbidden: "No tienes permiso para modificar esta tarea",
  notFound: "Tarea no encontrada",
};

const visibleTask = (db: UserClient, id: string) =>
  db.from("tasks").select("id").eq("id", id).maybeSingle();

/** Lee una tarea con sus subtareas y etiquetas. */
export async function getTask(db: UserClient, taskId: string): Promise<Task> {
  const row = unwrap(
    await db
      .from("tasks")
      .select(TASK_SELECT)
      .eq("id", taskId)
      .order("position", { referencedTable: "subtasks", ascending: true })
      .maybeSingle(),
  );
  if (!row) {
    throw new AppError(404, "NOT_FOUND", TASK_MESSAGES.notFound);
  }
  return toTask(row as unknown as TaskRowWithRelations);
}

/**
 * Sincroniza las etiquetas de una tarea con `labelIds` aplicando solo la diferencia.
 * Primero inserta las nuevas y después borra las que sobran, así un fallo a medias
 * nunca deja la tarea sin las etiquetas que ya tenía.
 */
async function syncTaskLabels(db: UserClient, taskId: string, labelIds: string[]): Promise<void> {
  const current = unwrap(await db.from("task_labels").select("label_id").eq("task_id", taskId));
  const currentIds = new Set(current.map((link) => link.label_id));
  const desiredIds = new Set(labelIds);

  const toAdd = [...desiredIds].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));

  if (toAdd.length > 0) {
    unwrap(
      await db.from("task_labels").insert(toAdd.map((label_id) => ({ task_id: taskId, label_id }))),
    );
  }
  if (toRemove.length > 0) {
    unwrap(await db.from("task_labels").delete().eq("task_id", taskId).in("label_id", toRemove));
  }
}

export async function createTask(
  db: UserClient,
  columnId: string,
  input: CreateTaskInput,
): Promise<Task> {
  const column = unwrap(
    await db.from("columns").select("id, board_id").eq("id", columnId).maybeSingle(),
  );
  if (!column) {
    throw new AppError(404, "NOT_FOUND", "Columna no encontrada");
  }

  const lastPosition = await getLastTaskPosition(db, columnId);

  // board_id lo vuelve a derivar un trigger en la BD; se envía porque el tipo Insert lo exige.
  const created = unwrap(
    await db
      .from("tasks")
      .insert({
        column_id: columnId,
        board_id: column.board_id,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        due_date: input.dueDate ?? null,
        position: safePositionBetween(lastPosition, null),
      })
      .select("id")
      .single(),
  );

  if (input.labelIds && input.labelIds.length > 0) {
    try {
      await syncTaskLabels(db, created.id, input.labelIds);
    } catch (error) {
      // Compensación: no dejar una tarea a medias si las etiquetas fallaron.
      await db.from("tasks").delete().eq("id", created.id);
      throw error;
    }
  }

  return getTask(db, created.id);
}

/** assignedTo solo puede ser alguien que sea miembro del tablero de la tarea. */
async function assertAssigneeIsMember(
  db: UserClient,
  taskId: string,
  assigneeId: string,
): Promise<void> {
  const task = unwrap(await db.from("tasks").select("board_id").eq("id", taskId).maybeSingle());
  if (!task) {
    throw new AppError(404, "NOT_FOUND", TASK_MESSAGES.notFound);
  }

  const membership = unwrap(
    await db
      .from("board_members")
      .select("user_id")
      .eq("board_id", task.board_id)
      .eq("user_id", assigneeId)
      .maybeSingle(),
  );
  if (!membership) {
    throw new AppError(422, "INVALID_ASSIGNEE", "La persona asignada debe ser miembro del tablero");
  }
}

export async function updateTask(
  db: UserClient,
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const patch: TaskUpdate = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.dueDate !== undefined) patch.due_date = input.dueDate;
  if (input.assignedTo !== undefined) {
    if (input.assignedTo !== null) {
      await assertAssigneeIsMember(db, taskId, input.assignedTo);
    }
    patch.assigned_to = input.assignedTo;
  }

  const row = unwrap(
    await db
      .from("tasks")
      .update(patch)
      .eq("id", taskId)
      .select(TASK_SELECT)
      .order("position", { referencedTable: "subtasks", ascending: true })
      .maybeSingle(),
  );
  if (!row) {
    throw await forbiddenOrNotFound(visibleTask(db, taskId), TASK_MESSAGES);
  }
  return toTask(row as unknown as TaskRowWithRelations);
}

/**
 * Mueve una tarea (misma columna u otra) entre dos vecinos; la posición la calcula el servidor.
 * - Sin prevId ni nextId (columna que el cliente creía vacía) se agrega al final.
 * - Si el destino es la última columna del tablero, fija completed_at (conserva el existente);
 *   si no, lo limpia.
 */
export async function moveTask(
  db: UserClient,
  taskId: string,
  input: MoveTaskInput,
): Promise<Task> {
  const prevId = input.prevId ?? null;
  const nextId = input.nextId ?? null;
  assertValidNeighbors(taskId, prevId, nextId);

  const neighborIds = [prevId, nextId].filter((id): id is string => id !== null);
  const [taskRes, destinationRes, neighborsRes] = await Promise.all([
    db.from("tasks").select("id, board_id, completed_at").eq("id", taskId).maybeSingle(),
    db.from("columns").select("id, board_id").eq("id", input.columnId).maybeSingle(),
    neighborIds.length > 0
      ? db.from("tasks").select("id, column_id, position").in("id", neighborIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const task = unwrap(taskRes);
  if (!task) {
    throw new AppError(404, "NOT_FOUND", TASK_MESSAGES.notFound);
  }
  const destination = unwrap(destinationRes);
  if (!destination) {
    throw new AppError(404, "NOT_FOUND", "La columna destino no existe");
  }
  if (destination.board_id !== task.board_id) {
    throw new AppError(422, "CROSS_BOARD", "No se puede mover una tarea a otro tablero");
  }

  const neighbors = new Map(
    (unwrap(neighborsRes) as { id: string; column_id: string; position: string }[]).map((row) => [
      row.id,
      row,
    ]),
  );
  for (const id of neighborIds) {
    const neighbor = neighbors.get(id);
    if (!neighbor || neighbor.column_id !== destination.id) {
      throw staleNeighborsError();
    }
  }

  const [lastColumnId, lastPositionInDestination] = await Promise.all([
    getLastColumnId(db, task.board_id),
    prevId === null && nextId === null
      ? getLastTaskPosition(db, destination.id, taskId)
      : Promise.resolve(null),
  ]);

  const position =
    prevId === null && nextId === null
      ? safePositionBetween(lastPositionInDestination, null)
      : safePositionBetween(
          prevId ? (neighbors.get(prevId)?.position ?? null) : null,
          nextId ? (neighbors.get(nextId)?.position ?? null) : null,
        );

  const destinationIsLast = destination.id === lastColumnId;
  const completedAt = destinationIsLast ? (task.completed_at ?? new Date().toISOString()) : null;

  const row = unwrap(
    await db
      .from("tasks")
      .update({ column_id: destination.id, position, completed_at: completedAt })
      .eq("id", taskId)
      .select(TASK_SELECT)
      .order("position", { referencedTable: "subtasks", ascending: true })
      .maybeSingle(),
  );
  if (!row) {
    throw await forbiddenOrNotFound(visibleTask(db, taskId), TASK_MESSAGES);
  }
  return toTask(row as unknown as TaskRowWithRelations);
}

export async function deleteTask(db: UserClient, taskId: string): Promise<void> {
  const deleted = unwrap(await db.from("tasks").delete().eq("id", taskId).select("id"));
  if (deleted.length === 0) {
    throw await forbiddenOrNotFound(visibleTask(db, taskId), TASK_MESSAGES);
  }
}

/** Reemplaza el conjunto de etiquetas de la tarea por `labelIds`. */
export async function setTaskLabels(
  db: UserClient,
  taskId: string,
  labelIds: string[],
): Promise<Task> {
  if (!unwrap(await visibleTask(db, taskId))) {
    throw new AppError(404, "NOT_FOUND", TASK_MESSAGES.notFound);
  }
  await syncTaskLabels(db, taskId, labelIds);
  return getTask(db, taskId);
}
