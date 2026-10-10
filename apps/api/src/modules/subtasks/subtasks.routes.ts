import { Router } from "express";
import { updateSubtaskSchema } from "@kanban/shared";
import { getAuth } from "../../lib/auth-context.js";
import { idParamsSchema } from "../../lib/params.js";
import { parseWith } from "../../lib/validate.js";
import { deleteSubtask, updateSubtask } from "./subtasks.service.js";

export function subtasksRouter(): Router {
  const router = Router();

  router.patch("/:id", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateSubtaskSchema, req.body);
    res.json(await updateSubtask(db, id, input));
  });

  router.delete("/:id", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    await deleteSubtask(db, id);
    res.status(204).end();
  });

  return router;
}
