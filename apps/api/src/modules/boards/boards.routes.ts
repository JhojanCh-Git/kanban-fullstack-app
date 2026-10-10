import { Router } from "express";
import {
  createBoardSchema,
  createColumnSchema,
  createLabelSchema,
  updateBoardSchema,
  uuidSchema,
} from "@kanban/shared";
import { z } from "zod";
import { getAuth } from "../../lib/auth-context.js";
import { parseWith } from "../../lib/validate.js";
import { createColumn } from "../columns/columns.service.js";
import { createLabel, listLabels } from "../labels/labels.service.js";
import {
  createBoard,
  deleteBoard,
  getBoardDetail,
  listBoards,
  updateBoard,
} from "./boards.service.js";

const boardParamsSchema = z.object({ id: uuidSchema });

export function boardsRouter(): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const { db } = getAuth(req);
    res.json(await listBoards(db));
  });

  router.post("/", async (req, res) => {
    const { db } = getAuth(req);
    const input = parseWith(createBoardSchema, req.body);
    res.status(201).json(await createBoard(db, input));
  });

  router.get("/:id", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(boardParamsSchema, req.params);
    res.json(await getBoardDetail(db, id));
  });

  router.patch("/:id", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(boardParamsSchema, req.params);
    const input = parseWith(updateBoardSchema, req.body);
    res.json(await updateBoard(db, id, input));
  });

  // POST /boards/:id/columns -> agrega una columna al final del tablero
  router.post("/:id/columns", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(boardParamsSchema, req.params);
    const input = parseWith(createColumnSchema, req.body);
    res.status(201).json(await createColumn(db, id, input));
  });

  // GET/POST /boards/:id/labels -> etiquetas del tablero
  router.get("/:id/labels", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(boardParamsSchema, req.params);
    res.json(await listLabels(db, id));
  });

  router.post("/:id/labels", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(boardParamsSchema, req.params);
    const input = parseWith(createLabelSchema, req.body);
    res.status(201).json(await createLabel(db, id, input));
  });

  router.delete("/:id", async (req, res) => {
    const { db } = getAuth(req);
    const { id } = parseWith(boardParamsSchema, req.params);
    await deleteBoard(db, id);
    res.status(204).end();
  });

  return router;
}
