import { boardDetailSchema, subtaskSchema } from "@kanban/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AUTH_HEADER } from "./helpers/fakeDb.js";
import { ID, MISSING, makeMemoryApp } from "./helpers/memoryDb.js";

const auth = (req: request.Test) => req.set(...AUTH_HEADER);

describe("POST /api/v1/tasks/:id/subtasks", () => {
  it("agrega la subtarea al final del checklist y cumple el contrato", async () => {
    const { app } = makeMemoryApp();
    // t1 ya tiene una subtarea en a0
    const res = await auth(request(app).post(`/api/v1/tasks/${ID.t1}/subtasks`)).send({ title: "  Paso 2  " });

    expect(res.status).toBe(201);
    const created = subtaskSchema.parse(res.body);
    expect(created.title).toBe("Paso 2");
    expect(created.isCompleted).toBe(false);
    expect(created.taskId).toBe(ID.t1);
    expect(created.position > "a0").toBe(true);
  });

  it("la primera subtarea de una tarea queda en a0", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).post(`/api/v1/tasks/${ID.t2}/subtasks`)).send({ title: "Primero" });
    expect(res.status).toBe(201);
    expect(res.body.position).toBe("a0");
  });

  it("valida el título (400), la tarea (404) y los permisos (403)", async () => {
    const { app } = makeMemoryApp();
    expect((await auth(request(app).post(`/api/v1/tasks/${ID.t1}/subtasks`)).send({ title: "  " })).status).toBe(400);
    expect((await auth(request(app).post(`/api/v1/tasks/${ID.t1}/subtasks`)).send({})).status).toBe(400);
    expect((await auth(request(app).post(`/api/v1/tasks/${MISSING}/subtasks`)).send({ title: "X" })).status).toBe(404);

    const readOnly = makeMemoryApp({ readOnly: true });
    const res = await auth(request(readOnly.app).post(`/api/v1/tasks/${ID.t1}/subtasks`)).send({ title: "X" });
    expect(res.status).toBe(403);
  });

  it("el detalle del tablero muestra el checklist en orden", async () => {
    const { app } = makeMemoryApp();
    for (const title of ["B", "C", "D"]) {
      await auth(request(app).post(`/api/v1/tasks/${ID.t1}/subtasks`)).send({ title });
    }
    const res = await auth(request(app).get(`/api/v1/boards/${ID.board}`));
    const detail = boardDetailSchema.parse(res.body);
    const t1 = detail.tasks.find((task) => task.id === ID.t1);
    expect(t1?.subtasks.map((s) => s.title)).toEqual(["Paso 1", "B", "C", "D"]);
  });
});

describe("PATCH /api/v1/subtasks/:id", () => {
  it("marca y desmarca una subtarea como completada", async () => {
    const { app } = makeMemoryApp();
    const done = await auth(request(app).patch(`/api/v1/subtasks/${ID.subtask}`)).send({ isCompleted: true });
    expect(done.status).toBe(200);
    expect(done.body.isCompleted).toBe(true);
    expect(done.body.title).toBe("Paso 1"); // conserva el título

    const undone = await auth(request(app).patch(`/api/v1/subtasks/${ID.subtask}`)).send({ isCompleted: false });
    expect(undone.body.isCompleted).toBe(false);
  });

  it("renombra la subtarea", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/subtasks/${ID.subtask}`)).send({ title: "Renombrada" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Renombrada");
    expect(res.body.isCompleted).toBe(false);
  });

  it("responde 400 con cuerpo vacío o tipos inválidos, 404 si no existe y 403 si no es editable", async () => {
    const { app } = makeMemoryApp();
    expect((await auth(request(app).patch(`/api/v1/subtasks/${ID.subtask}`)).send({})).status).toBe(400);
    expect((await auth(request(app).patch(`/api/v1/subtasks/${ID.subtask}`)).send({ isCompleted: "si" })).status).toBe(400);
    expect((await auth(request(app).patch(`/api/v1/subtasks/${MISSING}`)).send({ isCompleted: true })).status).toBe(404);

    const readOnly = makeMemoryApp({ readOnly: true });
    const res = await auth(request(readOnly.app).patch(`/api/v1/subtasks/${ID.subtask}`)).send({ isCompleted: true });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/v1/subtasks/:id", () => {
  it("elimina la subtarea", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).delete(`/api/v1/subtasks/${ID.subtask}`));
    expect(res.status).toBe(204);
    expect(db.tables.subtasks).toHaveLength(0);
  });

  it("responde 404 si no existe y 403 si no es editable", async () => {
    const { app } = makeMemoryApp();
    expect((await auth(request(app).delete(`/api/v1/subtasks/${MISSING}`))).status).toBe(404);

    const readOnly = makeMemoryApp({ readOnly: true });
    expect((await auth(request(readOnly.app).delete(`/api/v1/subtasks/${ID.subtask}`))).status).toBe(403);
  });
});
