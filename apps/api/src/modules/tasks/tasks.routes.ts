import { Router } from "express";
import { moveTaskSchema, setTaskLabelsSchema, updateTaskSchema } from "@kanban/shared";
import { getAuth } from "../../lib/auth-context.js";
import { idParamsSchema } from "../../lib/params.js";
import { parseWith } from "../../lib/validate.js";
import { deleteTask, moveTask, setTaskLabels, updateTask } from "./tasks.service.js";

export function tasksRouter(): Router {
  const router = Router();

  router.patch("/:id", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateTaskSchema, req.body);
    res.json(await updateTask(db, id, input));
  });

  router.patch("/:id/move", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(moveTaskSchema, req.body);
    res.json(await moveTask(db, id, input));
  });

  router.put("/:id/labels", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    const { labelIds } = parseWith(setTaskLabelsSchema, req.body);
    res.json(await setTaskLabels(db, id, labelIds));
  });

  router.delete("/:id", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    await deleteTask(db, id);
    res.status(204).end();
  });

  return router;
}
