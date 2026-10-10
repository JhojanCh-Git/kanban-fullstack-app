import { taskSchema } from "@kanban/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AUTH_HEADER } from "./helpers/fakeDb.js";
import {
  DONE_AT,
  ID,
  MEMBER,
  MISSING,
  STRANGER,
  USER,
  makeMemoryApp,
  taskIdsIn,
} from "./helpers/memoryDb.js";

const auth = (req: request.Test) => req.set(...AUTH_HEADER);
const completedAt = (db: ReturnType<typeof makeMemoryApp>["db"], id: string) =>
  db.tables.tasks.find((t) => t.id === id)?.completed_at;

describe("POST /api/v1/columns/:id/tasks", () => {
  it("crea la tarea al final de la columna con valores por defecto y cumple el contrato", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).post(`/api/v1/columns/${ID.todo}/tasks`)).send({ title: "  Nueva  " });

    expect(res.status).toBe(201);
    const created = taskSchema.parse(res.body);
    expect(created.title).toBe("Nueva");
    expect(created.priority).toBe("medium");
    expect(created.createdBy).toBe(USER);
    expect(created.completedAt).toBeNull();
    expect(taskIdsIn(db, ID.todo).at(-1)).toBe(created.id);
    expect(created.position > "a1").toBe(true);
  });

  it("crea la primera tarea de una columna vacía en a0 y acepta todos los campos", async () => {
    const { app } = makeMemoryApp();
    const emptyColumn = await auth(request(app).post(`/api/v1/boards/${ID.board}/columns`)).send({ title: "Vacía" });
    const res = await auth(request(app).post(`/api/v1/columns/${emptyColumn.body.id}/tasks`)).send({
      title: "Urgente",
      description: "Detalle",
      priority: "high",
      dueDate: "2026-12-31T23:59:00+00:00",
    });
    expect(res.status).toBe(201);
    expect(res.body.position).toBe("a0");
    expect(res.body.priority).toBe("high");
    expect(res.body.description).toBe("Detalle");
  });

  it("asocia etiquetas del mismo tablero al crear", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).post(`/api/v1/columns/${ID.doing}/tasks`)).send({
      title: "Con etiquetas",
      labelIds: [ID.label, ID.label2],
    });
    expect(res.status).toBe(201);
    expect([...res.body.labelIds].sort()).toEqual([ID.label, ID.label2].sort());
  });

  it("si una etiqueta es de otro tablero responde 422 y no deja la tarea a medias", async () => {
    const { app, db } = makeMemoryApp();
    const before = db.tables.tasks.length;
    const res = await auth(request(app).post(`/api/v1/columns/${ID.doing}/tasks`)).send({
      title: "Mala etiqueta",
      labelIds: [ID.labelOther],
    });
    expect(res.status).toBe(422);
    expect(db.tables.tasks).toHaveLength(before);
  });

  it("valida el cuerpo (400), la columna (404) y los permisos (403)", async () => {
    const { app } = makeMemoryApp();
    expect((await auth(request(app).post(`/api/v1/columns/${ID.todo}/tasks`)).send({ title: " " })).status).toBe(400);
    expect(
      (await auth(request(app).post(`/api/v1/columns/${ID.todo}/tasks`)).send({ title: "X", priority: "urgente" })).status,
    ).toBe(400);
    expect((await auth(request(app).post(`/api/v1/columns/${MISSING}/tasks`)).send({ title: "X" })).status).toBe(404);

    const readOnly = makeMemoryApp({ readOnly: true });
    const res = await auth(request(readOnly.app).post(`/api/v1/columns/${ID.todo}/tasks`)).send({ title: "X" });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/v1/tasks/:id", () => {
  it("actualiza campos sueltos y conserva el resto", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}`)).send({
      title: "Renombrada",
      priority: "high",
      dueDate: "2026-11-01T10:00:00+00:00",
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Renombrada");
    expect(res.body.priority).toBe("high");
    expect(res.body.dueDate).toBe("2026-11-01T10:00:00+00:00");
    expect(res.body.columnId).toBe(ID.todo); // no cambió
    expect(res.body.subtasks).toHaveLength(1); // conserva sus subtareas
  });

  it("permite limpiar la descripción y la fecha con null", async () => {
    const { app } = makeMemoryApp();
    await auth(request(app).patch(`/api/v1/tasks/${ID.t1}`)).send({ description: "algo", dueDate: "2026-11-01T10:00:00+00:00" });
    const res = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}`)).send({ description: null, dueDate: null });
    expect(res.status).toBe(200);
    expect(res.body.description).toBeNull();
    expect(res.body.dueDate).toBeNull();
  });

  it("solo permite asignar a miembros del tablero", async () => {
    const { app } = makeMemoryApp();
    const ok = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}`)).send({ assignedTo: MEMBER });
    expect(ok.status).toBe(200);
    expect(ok.body.assignedTo).toBe(MEMBER);

    const bad = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}`)).send({ assignedTo: STRANGER });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("INVALID_ASSIGNEE");

    const clear = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}`)).send({ assignedTo: null });
    expect(clear.status).toBe(200);
    expect(clear.body.assignedTo).toBeNull();
  });

  it("responde 400 con cuerpo vacío o valores inválidos, 404 si no existe y 403 si no es editable", async () => {
    const { app } = makeMemoryApp();
    expect((await auth(request(app).patch(`/api/v1/tasks/${ID.t1}`)).send({})).status).toBe(400);
    expect((await auth(request(app).patch(`/api/v1/tasks/${ID.t1}`)).send({ priority: "x" })).status).toBe(400);
    expect((await auth(request(app).patch(`/api/v1/tasks/${MISSING}`)).send({ title: "X" })).status).toBe(404);

    const readOnly = makeMemoryApp({ readOnly: true });
    expect((await auth(request(readOnly.app).patch(`/api/v1/tasks/${ID.t1}`)).send({ title: "X" })).status).toBe(403);
  });
});

describe("PATCH /api/v1/tasks/:id/move", () => {
  it("reordena dentro de la misma columna entre dos vecinos", async () => {
    const { app, db } = makeMemoryApp();
    // Orden inicial en Por hacer: t1 (a0), t2 (a1). Creamos t5 al final y la subimos al medio.
    const t5 = await auth(request(app).post(`/api/v1/columns/${ID.todo}/tasks`)).send({ title: "t5" });
    const res = await auth(request(app).patch(`/api/v1/tasks/${t5.body.id}/move`)).send({
      columnId: ID.todo,
      prevId: ID.t1,
      nextId: ID.t2,
    });
    expect(res.status).toBe(200);
    expect(taskIdsIn(db, ID.todo)).toEqual([ID.t1, t5.body.id, ID.t2]);
  });

  it("mueve a otra columna al inicio (solo nextId) y al final (solo prevId)", async () => {
    const { app, db } = makeMemoryApp();
    const toTop = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({ columnId: ID.doing, nextId: ID.t3 });
    expect(toTop.status).toBe(200);
    expect(taskIdsIn(db, ID.doing)).toEqual([ID.t1, ID.t3]);

    const toBottom = await auth(request(app).patch(`/api/v1/tasks/${ID.t2}/move`)).send({ columnId: ID.doing, prevId: ID.t3 });
    expect(toBottom.status).toBe(200);
    expect(taskIdsIn(db, ID.doing)).toEqual([ID.t1, ID.t3, ID.t2]);
  });

  it("sin vecinos la agrega al final de la columna destino (aunque no esté vacía)", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({ columnId: ID.doing });
    expect(res.status).toBe(200);
    expect(taskIdsIn(db, ID.doing)).toEqual([ID.t3, ID.t1]);
  });

  it("al moverla a la última columna fija completed_at; al sacarla lo limpia", async () => {
    const { app, db } = makeMemoryApp();
    const toDone = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({ columnId: ID.done, prevId: ID.t4 });
    expect(toDone.status).toBe(200);
    expect(toDone.body.completedAt).toBeTruthy();
    expect(completedAt(db, ID.t1)).toBeTruthy();

    const out = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({ columnId: ID.todo });
    expect(out.status).toBe(200);
    expect(out.body.completedAt).toBeNull();
  });

  it("reordenar dentro de la última columna conserva el completed_at original", async () => {
    const { app } = makeMemoryApp();
    const second = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({ columnId: ID.done, prevId: ID.t4 });
    const res = await auth(request(app).patch(`/api/v1/tasks/${ID.t4}/move`)).send({ columnId: ID.done, prevId: ID.t1 });
    expect(res.status).toBe(200);
    expect(res.body.completedAt).toBe(DONE_AT);
    expect(second.body.completedAt).not.toBe(DONE_AT);
  });

  it("responde 409 si un vecino no está en la columna destino o ya no existe", async () => {
    const { app } = makeMemoryApp();
    const wrongColumn = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({ columnId: ID.doing, prevId: ID.t4 });
    const missing = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({ columnId: ID.doing, nextId: MISSING });
    expect(wrongColumn.status).toBe(409);
    expect(wrongColumn.body.error.code).toBe("POSITION_CONFLICT");
    expect(missing.status).toBe(409);
  });

  it("responde 409 si los vecinos llegan en orden inverso", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/tasks/${ID.t3}/move`)).send({
      columnId: ID.todo,
      prevId: ID.t2,
      nextId: ID.t1,
    });
    expect(res.status).toBe(409);
  });

  it("responde 422 al cruzar de tablero, 404 si la tarea o la columna no existen, 400 con vecinos inválidos", async () => {
    const { app } = makeMemoryApp();
    expect((await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({ columnId: ID.otherCol })).status).toBe(422);
    expect((await auth(request(app).patch(`/api/v1/tasks/${MISSING}/move`)).send({ columnId: ID.todo })).status).toBe(404);
    expect((await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({ columnId: MISSING })).status).toBe(404);
    expect((await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({ columnId: ID.todo, prevId: ID.t1 })).status).toBe(400);
    expect((await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({})).status).toBe(400);
  });

  it("responde 403 si la tarea es visible pero no editable", async () => {
    const { app } = makeMemoryApp({ readOnly: true });
    const res = await auth(request(app).patch(`/api/v1/tasks/${ID.t1}/move`)).send({ columnId: ID.doing });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/v1/tasks/:id", () => {
  it("elimina la tarea y sus subtareas", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).delete(`/api/v1/tasks/${ID.t1}`));
    expect(res.status).toBe(204);
    expect(db.tables.tasks.some((t) => t.id === ID.t1)).toBe(false);
    expect(db.tables.subtasks).toHaveLength(0);
    expect(db.tables.task_labels).toHaveLength(0);
  });

  it("responde 404 si no existe y 403 si no es editable", async () => {
    const { app } = makeMemoryApp();
    expect((await auth(request(app).delete(`/api/v1/tasks/${MISSING}`))).status).toBe(404);
    const readOnly = makeMemoryApp({ readOnly: true });
    expect((await auth(request(readOnly.app).delete(`/api/v1/tasks/${ID.t1}`))).status).toBe(403);
  });
});

describe("PUT /api/v1/tasks/:id/labels", () => {
  it("reemplaza el conjunto de etiquetas aplicando solo la diferencia", async () => {
    const { app, db } = makeMemoryApp();
    // t1 tiene [label]; pedimos [label2] -> quita label, agrega label2
    const res = await auth(request(app).put(`/api/v1/tasks/${ID.t1}/labels`)).send({ labelIds: [ID.label2] });
    expect(res.status).toBe(200);
    expect(res.body.labelIds).toEqual([ID.label2]);
    expect(db.tables.task_labels).toHaveLength(1);
  });

  it("con una lista vacía quita todas las etiquetas", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).put(`/api/v1/tasks/${ID.t1}/labels`)).send({ labelIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.labelIds).toEqual([]);
  });

  it("es idempotente si el conjunto ya coincide", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).put(`/api/v1/tasks/${ID.t1}/labels`)).send({ labelIds: [ID.label] });
    expect(res.status).toBe(200);
    expect(res.body.labelIds).toEqual([ID.label]);
  });

  it("responde 422 con una etiqueta de otro tablero (sin perder las existentes), 400 si el cuerpo es inválido y 404 si la tarea no existe", async () => {
    const { app } = makeMemoryApp();
    const cross = await auth(request(app).put(`/api/v1/tasks/${ID.t1}/labels`)).send({ labelIds: [ID.label, ID.labelOther] });
    expect(cross.status).toBe(422);
    const after = await auth(request(app).put(`/api/v1/tasks/${ID.t1}/labels`)).send({ labelIds: [ID.label] });
    expect(after.body.labelIds).toEqual([ID.label]);

    expect((await auth(request(app).put(`/api/v1/tasks/${ID.t1}/labels`)).send({ labelIds: ["x"] })).status).toBe(400);
    expect((await auth(request(app).put(`/api/v1/tasks/${MISSING}/labels`)).send({ labelIds: [] })).status).toBe(404);
  });
});
