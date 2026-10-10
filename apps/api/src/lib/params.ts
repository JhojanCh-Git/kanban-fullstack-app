import { uuidSchema } from "@kanban/shared";
import { z } from "zod";

/** Parámetros de ruta con un único :id UUID. */
export const idParamsSchema = z.object({ id: uuidSchema });
