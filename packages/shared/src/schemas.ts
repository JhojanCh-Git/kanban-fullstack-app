import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Primitivas                                                          */
/* ------------------------------------------------------------------ */
export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().datetime({ offset: true });
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hex inválido (#RRGGBB)");

export const prioritySchema = z.enum(["low", "medium", "high"]);
export type Priority = z.infer<typeof prioritySchema>;

export const boardRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type BoardRole = z.infer<typeof boardRoleSchema>;

const titleOf = (max: number) => z.string().trim().min(1, "Requerido").max(max);

const atLeastOneField = (value: object) => Object.keys(value).length > 0;
const atLeastOneFieldMessage = { message: "Envía al menos un campo para actualizar" };

/* ------------------------------------------------------------------ */
/* Entidades (respuestas del API, camelCase)                           */
/* ------------------------------------------------------------------ */
export const boardSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  ownerId: uuidSchema,
  createdAt: isoDateSchema,
});
export type Board = z.infer<typeof boardSchema>;

export const columnSchema = z.object({
  id: uuidSchema,
  boardId: uuidSchema,
  title: z.string(),
  position: z.string(),
  createdAt: isoDateSchema,
});
export type Column = z.infer<typeof columnSchema>;

export const labelSchema = z.object({
  id: uuidSchema,
  boardId: uuidSchema,
  name: z.string(),
  color: z.string(),
});
export type Label = z.infer<typeof labelSchema>;

export const subtaskSchema = z.object({
  id: uuidSchema,
  taskId: uuidSchema,
  title: z.string(),
  isCompleted: z.boolean(),
  position: z.string(),
  createdAt: isoDateSchema,
});
export type Subtask = z.infer<typeof subtaskSchema>;

export const taskSchema = z.object({
  id: uuidSchema,
  columnId: uuidSchema,
  boardId: uuidSchema,
  createdBy: uuidSchema.nullable(),
  assignedTo: uuidSchema.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  priority: prioritySchema,
  dueDate: isoDateSchema.nullable(),
  position: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  completedAt: isoDateSchema.nullable(),
  labelIds: z.array(uuidSchema),
  subtasks: z.array(subtaskSchema),
});
export type Task = z.infer<typeof taskSchema>;

/** Respuesta de GET /boards/:id (el BFF arma todo en una sola llamada). */
export const boardDetailSchema = boardSchema.extend({
  columns: z.array(columnSchema),
  labels: z.array(labelSchema),
  tasks: z.array(taskSchema),
});
export type BoardDetail = z.infer<typeof boardDetailSchema>;

/** Formato único de error del API. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/* ------------------------------------------------------------------ */
/* Entradas (bodies y query params)                                    */
/* ------------------------------------------------------------------ */

/* Boards */
export const createBoardSchema = z.object({
  title: titleOf(120),
  description: z.string().trim().max(2000).nullish(),
});
export type CreateBoardInput = z.infer<typeof createBoardSchema>;

export const updateBoardSchema = createBoardSchema
  .partial()
  .refine(atLeastOneField, atLeastOneFieldMessage);
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;

/* Columns */
export const createColumnSchema = z.object({ title: titleOf(60) });
export type CreateColumnInput = z.infer<typeof createColumnSchema>;

export const updateColumnSchema = z.object({ title: titleOf(60) });
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;

export const moveColumnSchema = z.object({
  prevId: uuidSchema.nullish(),
  nextId: uuidSchema.nullish(),
});
export type MoveColumnInput = z.infer<typeof moveColumnSchema>;

/** DELETE /columns/:id?moveTo=<uuid> | ?cascade=true */
export const deleteColumnQuerySchema = z
  .object({
    moveTo: uuidSchema.optional(),
    cascade: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .refine((query) => !(query.moveTo && query.cascade), {
    message: "Usa moveTo o cascade, no ambos",
  });
export type DeleteColumnQuery = z.infer<typeof deleteColumnQuerySchema>;

/* Tasks */
export const createTaskSchema = z.object({
  title: titleOf(200),
  description: z.string().trim().max(10000).nullish(),
  priority: prioritySchema.default("medium"),
  dueDate: isoDateSchema.nullish(),
  labelIds: z.array(uuidSchema).max(20).optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: titleOf(200),
    description: z.string().trim().max(10000).nullable(),
    priority: prioritySchema,
    dueDate: isoDateSchema.nullable(),
    assignedTo: uuidSchema.nullable(),
  })
  .partial()
  .refine(atLeastOneField, atLeastOneFieldMessage);
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const moveTaskSchema = z.object({
  columnId: uuidSchema,
  prevId: uuidSchema.nullish(),
  nextId: uuidSchema.nullish(),
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

export const setTaskLabelsSchema = z.object({
  labelIds: z.array(uuidSchema).max(20),
});
export type SetTaskLabelsInput = z.infer<typeof setTaskLabelsSchema>;

/* Subtasks */
export const createSubtaskSchema = z.object({ title: titleOf(200) });
export type CreateSubtaskInput = z.infer<typeof createSubtaskSchema>;

export const updateSubtaskSchema = z
  .object({
    title: titleOf(200),
    isCompleted: z.boolean(),
  })
  .partial()
  .refine(atLeastOneField, atLeastOneFieldMessage);
export type UpdateSubtaskInput = z.infer<typeof updateSubtaskSchema>;

/* Labels */
export const createLabelSchema = z.object({
  name: titleOf(40),
  color: hexColorSchema.default("#64748b"),
});
export type CreateLabelInput = z.infer<typeof createLabelSchema>;

export const updateLabelSchema = z
  .object({ name: titleOf(40), color: hexColorSchema })
  .partial()
  .refine(atLeastOneField, atLeastOneFieldMessage);
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;
