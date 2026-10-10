import { Router } from "express";
import { updateLabelSchema } from "@kanban/shared";
import { getAuth } from "../../lib/auth-context.js";
import { idParamsSchema } from "../../lib/params.js";
import { parseWith } from "../../lib/validate.js";
import { deleteLabel, updateLabel } from "./labels.service.js";

export function labelsRouter(): Router {
  const router = Router();

  router.patch("/:id", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateLabelSchema, req.body);
    res.json(await updateLabel(db, id, input));
  });

  router.delete("/:id", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(idParamsSchema, req.params);
    await deleteLabel(db, id);
    res.status(204).end();
  });

  return router;
}
