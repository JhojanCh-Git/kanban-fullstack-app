import type { Board, Column, Database, Label, Subtask, Task } from "@kanban/shared";

type Tables = Database["public"]["Tables"];

export type BoardRow = Tables["boards"]["Row"];
export type ColumnRow = Tables["columns"]["Row"];
export type LabelRow = Tables["labels"]["Row"];
export type SubtaskRow = Tables["subtasks"]["Row"];
export type TaskRow = Tables["tasks"]["Row"];

/** Fila de tasks con sus relaciones embebidas (select "*, subtasks(*), task_labels(label_id)"). */
export type TaskRowWithRelations = TaskRow & {
  subtasks: SubtaskRow[];
  task_labels: { label_id: string }[];
};

export const toBoard = (row: BoardRow): Board => ({
  id: row.id,
  title: row.title,
  description: row.description,
  ownerId: row.owner_id,
  createdAt: row.created_at,
});

export const toColumn = (row: ColumnRow): Column => ({
  id: row.id,
  boardId: row.board_id,
  title: row.title,
  position: row.position,
  createdAt: row.created_at,
});

export const toLabel = (row: LabelRow): Label => ({
  id: row.id,
  boardId: row.board_id,
  name: row.name,
  color: row.color,
});

export const toSubtask = (row: SubtaskRow): Subtask => ({
  id: row.id,
  taskId: row.task_id,
  title: row.title,
  isCompleted: row.is_completed,
  position: row.position,
  createdAt: row.created_at,
});

export const toTask = (row: TaskRowWithRelations): Task => ({
  id: row.id,
  columnId: row.column_id,
  boardId: row.board_id,
  createdBy: row.created_by,
  assignedTo: row.assigned_to,
  title: row.title,
  description: row.description,
  priority: row.priority,
  dueDate: row.due_date,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
  labelIds: row.task_labels.map((link) => link.label_id),
  subtasks: row.subtasks.map(toSubtask),
});
