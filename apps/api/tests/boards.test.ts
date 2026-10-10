import { boardDetailSchema } from "@kanban/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AUTH_HEADER, USER_ID, makeApp, type QueryContext } from "./helpers/fakeDb.js";

const BOARD_ID = "11111111-1111-4111-8111-111111111111";
const COL_ID = "22222222-2222-4222-8222-222222222222";
const LABEL_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const SUBTASK_ID = "55555555-5555-4555-8555-555555555555";
const TS = "2026-10-09T12:00:00.123456+00:00";

const boardRow = {
  id: BOARD_ID,
  title: "Proyecto",
  description: null,
  owner_id: USER_ID,
  created_at: TS,
};

const ok = (data: unknown) => ({ data, error: null });
const get = (app: Parameters<typeof request>[0], url: string) =>
  request(app)
    .get(url)
    .set(...AUTH_HEADER);

describe("GET /api/v1/boards", () => {
  it("lista los tableros en camelCase", async () => {
    const { app } = makeApp({ tables: { boards: () => ok([boardRow]) } });
    const res = await get(app, "/api/v1/boards");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: BOARD_ID, title: "Proyecto", description: null, ownerId: USER_ID, createdAt: TS },
    ]);
  });
});

describe("POST /api/v1/boards", () => {
  it("responde 400 con detalle por campo si el título está vacío", async () => {
    const { app, db } = makeApp();
    const res = await request(app)
      .post("/api/v1/boards")
      .set(...AUTH_HEADER)
      .send({ title: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].path).toBe("title");
    expect(db.rpcCalls).toHaveLength(0); // no llegó a la base de datos
  });

  it("llama al RPC create_board y responde 201", async () => {
    const { app, db } = makeApp({ rpc: { create_board: () => ok(boardRow) } });
    const res = await request(app)
      .post("/api/v1/boards")
      .set(...AUTH_HEADER)
      .send({ title: "  Proyecto  " });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(BOARD_ID);
    expect(res.body.ownerId).toBe(USER_ID);
    expect(db.rpcCalls).toEqual([
      { fn: "create_board", args: { p_title: "Proyecto", p_description: undefined } },
    ]);
  });

  it("también acepta que el RPC devuelva un arreglo", async () => {
    const { app } = makeApp({ rpc: { create_board: () => ok([boardRow]) } });
    const res = await request(app)
      .post("/api/v1/boards")
      .set(...AUTH_HEADER)
      .send({ title: "Proyecto" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(BOARD_ID);
  });

  it("traduce un error de RLS (42501) a 403 sin filtrar el mensaje original", async () => {
    const { app } = makeApp({
      rpc: { create_board: () => ({ data: null, error: { code: "42501", message: "detalle interno" } }) },
    });
    const res = await request(app)
      .post("/api/v1/boards")
      .set(...AUTH_HEADER)
      .send({ title: "Proyecto" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(JSON.stringify(res.body)).not.toContain("detalle interno");
  });
});

describe("GET /api/v1/boards/:id", () => {
  it("responde 400 si el id no es un UUID", async () => {
    const { app } = makeApp();
    const res = await get(app, "/api/v1/boards/no-es-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("responde 404 si el tablero no existe o no es visible (RLS)", async () => {
    const empty = () => ok(null);
    const { app } = makeApp({
      tables: { boards: empty, columns: () => ok([]), labels: () => ok([]), tasks: () => ok([]) },
    });
    const res = await get(app, `/api/v1/boards/${BOARD_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("arma el detalle completo y cumple el contrato de @kanban/shared", async () => {
    const { app, db } = makeApp({
      tables: {
        boards: () => ok(boardRow),
        columns: () =>
          ok([{ id: COL_ID, board_id: BOARD_ID, title: "Por hacer", position: "a0", created_at: TS }]),
        labels: () => ok([{ id: LABEL_ID, board_id: BOARD_ID, name: "bug", color: "#ef4444", created_at: TS }]),
        tasks: () =>
          ok([
            {
              id: TASK_ID,
              column_id: COL_ID,
              board_id: BOARD_ID,
              created_by: USER_ID,
              assigned_to: null,
              title: "Primera tarea",
              description: null,
              priority: "high",
              due_date: null,
              position: "a0",
              created_at: TS,
              updated_at: TS,
              completed_at: null,
              subtasks: [
                { id: SUBTASK_ID, task_id: TASK_ID, title: "Paso 1", is_completed: false, position: "a0", created_at: TS },
              ],
              task_labels: [{ label_id: LABEL_ID }],
            },
          ]),
      },
    });

    const res = await get(app, `/api/v1/boards/${BOARD_ID}`);
    expect(res.status).toBe(200);

    // El payload cumple exactamente el schema compartido con el frontend.
    const detail = boardDetailSchema.parse(res.body);
    expect(detail.columns[0]?.title).toBe("Por hacer");
    expect(detail.tasks[0]?.labelIds).toEqual([LABEL_ID]);
    expect(detail.tasks[0]?.subtasks[0]?.isCompleted).toBe(false);

    // Las consultas filtran por tablero y ordenan por position.
    const byTable = (table: string): QueryContext | undefined => db.calls.find((c) => c.table === table);
    expect(byTable("columns")?.filters).toEqual({ board_id: BOARD_ID });
    expect(byTable("columns")?.orders[0]).toBe("position");
    expect(byTable("tasks")?.filters).toEqual({ board_id: BOARD_ID });
    expect(byTable("tasks")?.orders[0]).toBe("position");
  });
});

describe("PATCH /api/v1/boards/:id", () => {
  it("responde 400 si el cuerpo está vacío", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .patch(`/api/v1/boards/${BOARD_ID}`)
      .set(...AUTH_HEADER)
      .send({});
    expect(res.status).toBe(400);
  });

  it("actualiza y devuelve el tablero", async () => {
    const { app, db } = makeApp({
      tables: { boards: () => ok({ ...boardRow, title: "Nuevo" }) },
    });
    const res = await request(app)
      .patch(`/api/v1/boards/${BOARD_ID}`)
      .set(...AUTH_HEADER)
      .send({ title: "Nuevo" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Nuevo");
    expect(db.calls[0]?.op).toBe("update");
    expect(db.calls[0]?.payload).toEqual({ title: "Nuevo" });
  });

  it("responde 403 si el tablero es visible pero el usuario no puede modificarlo", async () => {
    // El UPDATE no afecta filas (RLS) pero el SELECT posterior sí ve el tablero.
    const { app } = makeApp({
      tables: { boards: (ctx) => (ctx.op === "update" ? ok(null) : ok({ id: BOARD_ID })) },
    });
    const res = await request(app)
      .patch(`/api/v1/boards/${BOARD_ID}`)
      .set(...AUTH_HEADER)
      .send({ title: "Nuevo" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("responde 404 si el tablero no es visible para el usuario", async () => {
    const { app } = makeApp({ tables: { boards: () => ok(null) } });
    const res = await request(app)
      .patch(`/api/v1/boards/${BOARD_ID}`)
      .set(...AUTH_HEADER)
      .send({ title: "Nuevo" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/boards/:id", () => {
  it("responde 204 si se eliminó", async () => {
    const { app } = makeApp({ tables: { boards: () => ok([{ id: BOARD_ID }]) } });
    const res = await request(app)
      .delete(`/api/v1/boards/${BOARD_ID}`)
      .set(...AUTH_HEADER);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("responde 403 si es visible pero no se pudo eliminar", async () => {
    const { app } = makeApp({
      tables: { boards: (ctx) => (ctx.op === "delete" ? ok([]) : ok({ id: BOARD_ID })) },
    });
    const res = await request(app)
      .delete(`/api/v1/boards/${BOARD_ID}`)
      .set(...AUTH_HEADER);
    expect(res.status).toBe(403);
  });

  it("responde 404 si no es visible", async () => {
    const { app } = makeApp({
      tables: { boards: (ctx) => (ctx.op === "delete" ? ok([]) : ok(null)) },
    });
    const res = await request(app)
      .delete(`/api/v1/boards/${BOARD_ID}`)
      .set(...AUTH_HEADER);
    expect(res.status).toBe(404);
  });
});
