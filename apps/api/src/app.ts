import cors from "cors";
import express, { Router, type Express } from "express";
import helmet from "helmet";
import type { UserClientFactory } from "./lib/supabase.js";
import { authenticate } from "./middleware/authenticate.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { boardsRouter } from "./modules/boards/boards.routes.js";
import { columnsRouter } from "./modules/columns/columns.routes.js";
import { labelsRouter } from "./modules/labels/labels.routes.js";
import { meRouter } from "./modules/me/me.routes.js";
import { subtasksRouter } from "./modules/subtasks/subtasks.routes.js";
import { tasksRouter } from "./modules/tasks/tasks.routes.js";

export interface AppDeps {
  createUserClient: UserClientFactory;
  corsOrigins: string[];
}

export function createApp({ createUserClient, corsOrigins }: AppDeps): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: "100kb" }));

  // Público: sirve para health checks del hosting.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Todo lo que cuelga de /api/v1 exige JWT.
  const api = Router();
  api.use(authenticate(createUserClient));
  api.use("/me", meRouter());
  api.use("/boards", boardsRouter());
  api.use("/columns", columnsRouter());
  api.use("/tasks", tasksRouter());
  api.use("/subtasks", subtasksRouter());
  api.use("/labels", labelsRouter());
  app.use("/api/v1", api);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
