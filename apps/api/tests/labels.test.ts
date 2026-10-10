import { boardDetailSchema, labelSchema } from "@kanban/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AUTH_HEADER } from "./helpers/fakeDb.js";
import { ID, MISSING, makeMemoryApp } from "./helpers/memoryDb.js";

const auth = (req: request.Test) => req.set(...AUTH_HEADER);

describe("GET /api/v1/boards/:id/labels", () => {
  it("lista solo las etiquetas del tablero, ordenadas por nombre", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).get(`/api/v1/boards/${ID.board}/labels`));
    expect(res.status).toBe(200);
    expect(res.body.map((l: { name: string }) => l.name)).toEqual(["bug", "mejora"]); // sin "ajena" (otro tablero)
    for (const label of res.body) labelSchema.parse(label);
  });

  it("responde 404 si el tablero no existe o no es visible", async () => {
    const { app } = makeMemoryApp();
    expect((await auth(request(app).get(`/api/v1/boards/${MISSING}/labels`))).status).toBe(404);
  });
});

describe("POST /api/v1/boards/:id/labels", () => {
  it("crea una etiqueta con el color por defecto", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).post(`/api/v1/boards/${ID.board}/labels`)).send({ name: "  urgente  " });
    expect(res.status).toBe(201);
    const label = labelSchema.parse(res.body);
    expect(label.name).toBe("urgente");
    expect(label.color).toBe("#64748b");
    expect(label.boardId).toBe(ID.board);
  });

  it("crea una etiqueta con color personalizado", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).post(`/api/v1/boards/${ID.board}/labels`)).send({ name: "docs", color: "#A855F7" });
    expect(res.status).toBe(201);
    expect(res.body.color).toBe("#A855F7");
  });

  it("responde 409 LABEL_NAME_TAKEN si el nombre ya existe en ese tablero", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).post(`/api/v1/boards/${ID.board}/labels`)).send({ name: "bug" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LABEL_NAME_TAKEN");
  });

  it("permite el mismo nombre en otro tablero", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).post(`/api/v1/boards/${ID.board2}/labels`)).send({ name: "bug" });
    expect(res.status).toBe(201);
  });

  it("valida nombre y color (400), tablero (404) y permisos (403)", async () => {
    const { app } = makeMemoryApp();
    expect((await auth(request(app).post(`/api/v1/boards/${ID.board}/labels`)).send({ name: " " })).status).toBe(400);
    expect((await auth(request(app).post(`/api/v1/boards/${ID.board}/labels`)).send({ name: "x", color: "rojo" })).status).toBe(400);
    expect((await auth(request(app).post(`/api/v1/boards/${MISSING}/labels`)).send({ name: "x" })).status).toBe(404);

    const readOnly = makeMemoryApp({ readOnly: true });
    const res = await auth(request(readOnly.app).post(`/api/v1/boards/${ID.board}/labels`)).send({ name: "nueva" });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/v1/labels/:id", () => {
  it("cambia nombre y color", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/labels/${ID.label}`)).send({ name: "error", color: "#000000" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ID.label, name: "error", color: "#000000" });
  });

  it("cambia solo el color y conserva el nombre", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/labels/${ID.label}`)).send({ color: "#111111" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("bug");
  });

  it("responde 409 LABEL_NAME_TAKEN al renombrar a un nombre existente", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/labels/${ID.label}`)).send({ name: "mejora" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LABEL_NAME_TAKEN");
  });

  it("responde 400 con cuerpo vacío o color inválido, 404 si no existe y 403 si no es editable", async () => {
    const { app } = makeMemoryApp();
    expect((await auth(request(app).patch(`/api/v1/labels/${ID.label}`)).send({})).status).toBe(400);
    expect((await auth(request(app).patch(`/api/v1/labels/${ID.label}`)).send({ color: "azul" })).status).toBe(400);
    expect((await auth(request(app).patch(`/api/v1/labels/${MISSING}`)).send({ name: "x" })).status).toBe(404);

    const readOnly = makeMemoryApp({ readOnly: true });
    expect((await auth(request(readOnly.app).patch(`/api/v1/labels/${ID.label}`)).send({ name: "x" })).status).toBe(403);
  });
});

describe("DELETE /api/v1/labels/:id", () => {
  it("elimina la etiqueta y la quita de las tareas que la tenían", async () => {
    const { app, db } = makeMemoryApp();
    expect(db.tables.task_labels).toHaveLength(1); // t1 tiene "bug"

    const res = await auth(request(app).delete(`/api/v1/labels/${ID.label}`));
    expect(res.status).toBe(204);
    expect(db.tables.labels.some((l) => l.id === ID.label)).toBe(false);
    expect(db.tables.task_labels).toHaveLength(0);

    const detail = boardDetailSchema.parse((await auth(request(app).get(`/api/v1/boards/${ID.board}`))).body);
    expect(detail.tasks.every((task) => task.labelIds.length === 0)).toBe(true);
    expect(detail.labels.map((l) => l.name)).toEqual(["mejora"]);
  });

  it("responde 404 si no existe y 403 si no es editable", async () => {
    const { app } = makeMemoryApp();
    expect((await auth(request(app).delete(`/api/v1/labels/${MISSING}`))).status).toBe(404);

    const readOnly = makeMemoryApp({ readOnly: true });
    expect((await auth(request(readOnly.app).delete(`/api/v1/labels/${ID.label}`))).status).toBe(403);
  });
});

describe("flujo completo: crear etiqueta y asignarla a una tarea", () => {
  it("la etiqueta recién creada se puede asignar con PUT /tasks/:id/labels", async () => {
    const { app } = makeMemoryApp();
    const label = await auth(request(app).post(`/api/v1/boards/${ID.board}/labels`)).send({ name: "nueva", color: "#123456" });
    const res = await auth(request(app).put(`/api/v1/tasks/${ID.t2}/labels`)).send({ labelIds: [label.body.id] });
    expect(res.status).toBe(200);
    expect(res.body.labelIds).toEqual([label.body.id]);
  });
});
