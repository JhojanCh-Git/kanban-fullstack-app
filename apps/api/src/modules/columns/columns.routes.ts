import { Router } from "express";
import {
  createTaskSchema,
  deleteColumnQuerySchema,
  moveColumnSchema,
  updateColumnSchema,
} from "@kanban/shared";
import { getAuth } from "../../lib/auth-context.js";
import { idParamsSchema } from "../../lib/params.js";
import { parseWith } from "../../lib/validate.js";
import { createTask } from "../tasks/tasks.service.js";
import { deleteColumn, moveColumn, updateColumn } from "./columns.service.js";

export function columnsRouter(): Router {
  const router = Router();

  router.patch("/:id", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateColumnSchema, req.body);
    res.json(await updateColumn(db, id, input));
  });

  router.patch("/:id/move", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(moveColumnSchema, req.body);
    res.json(await moveColumn(db, id, input));
  });

  router.delete("/:id", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    const query = parseWith(deleteColumnQuerySchema, req.query);
    await deleteColumn(db, id, query);
    res.status(204).end();
  });

  // POST /columns/:id/tasks -> crea una tarea al final de la columna
  router.post("/:id/tasks", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(createTaskSchema, req.body);
    res.status(201).json(await createTask(db, id, input));
  });

  return router;
}
