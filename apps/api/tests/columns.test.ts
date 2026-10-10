import { columnSchema } from "@kanban/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AUTH_HEADER } from "./helpers/fakeDb.js";
import {
  DONE_AT,
  ID,
  MISSING,
  columnIdsOf,
  makeMemoryApp,
  taskIdsIn,
} from "./helpers/memoryDb.js";

const auth = (req: request.Test) => req.set(...AUTH_HEADER);

describe("POST /api/v1/boards/:id/columns", () => {
  it("agrega la columna al final con una posición mayor que la última", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).post(`/api/v1/boards/${ID.board}/columns`)).send({ title: " Revisión " });

    expect(res.status).toBe(201);
    const column = columnSchema.parse(res.body);
    expect(column.title).toBe("Revisión");
    expect(column.position > "a2").toBe(true);
    expect(columnIdsOf(db, ID.board).at(-1)).toBe(column.id);
  });

  it("responde 400 si el título está vacío", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).post(`/api/v1/boards/${ID.board}/columns`)).send({ title: "" });
    expect(res.status).toBe(400);
  });

  it("responde 404 si el tablero no existe o no es visible", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).post(`/api/v1/boards/${MISSING}/columns`)).send({ title: "X" });
    expect(res.status).toBe(404);
  });

  it("responde 403 si RLS rechaza el INSERT (rol de solo lectura)", async () => {
    const { app } = makeMemoryApp({ readOnly: true });
    const res = await auth(request(app).post(`/api/v1/boards/${ID.board}/columns`)).send({ title: "X" });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/v1/columns/:id", () => {
  it("renombra la columna", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/columns/${ID.doing}`)).send({ title: "Haciendo" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Haciendo");
  });

  it("responde 404 si no existe", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/columns/${MISSING}`)).send({ title: "X" });
    expect(res.status).toBe(404);
  });

  it("responde 403 si la columna es visible pero no editable", async () => {
    const { app } = makeMemoryApp({ readOnly: true });
    const res = await auth(request(app).patch(`/api/v1/columns/${ID.doing}`)).send({ title: "X" });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/v1/columns/:id/move", () => {
  it("mueve la última columna entre las dos primeras", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/columns/${ID.done}/move`)).send({
      prevId: ID.todo,
      nextId: ID.doing,
    });
    expect(res.status).toBe(200);
    expect(res.body.position > "a0" && res.body.position < "a1").toBe(true);
    expect(columnIdsOf(db, ID.board)).toEqual([ID.todo, ID.done, ID.doing]);
  });

  it("mueve una columna al inicio (solo nextId)", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/columns/${ID.done}/move`)).send({ nextId: ID.todo });
    expect(res.status).toBe(200);
    expect(columnIdsOf(db, ID.board)).toEqual([ID.done, ID.todo, ID.doing]);
  });

  it("mueve una columna al final (solo prevId)", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/columns/${ID.todo}/move`)).send({ prevId: ID.done });
    expect(res.status).toBe(200);
    expect(columnIdsOf(db, ID.board)).toEqual([ID.doing, ID.done, ID.todo]);
  });

  it("sin vecinos la agrega al final", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/columns/${ID.todo}/move`)).send({});
    expect(res.status).toBe(200);
    expect(columnIdsOf(db, ID.board).at(-1)).toBe(ID.todo);
  });

  it("responde 409 si un vecino es de otro tablero", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/columns/${ID.todo}/move`)).send({ prevId: ID.otherCol });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("POSITION_CONFLICT");
  });

  it("responde 409 si un vecino ya no existe", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/columns/${ID.todo}/move`)).send({ nextId: MISSING });
    expect(res.status).toBe(409);
  });

  it("responde 409 si los vecinos llegan en orden inverso (cliente desactualizado)", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/columns/${ID.todo}/move`)).send({
      prevId: ID.done,
      nextId: ID.doing,
    });
    expect(res.status).toBe(409);
  });

  it("responde 400 si una columna es vecina de sí misma o prevId = nextId", async () => {
    const { app } = makeMemoryApp();
    const self = await auth(request(app).patch(`/api/v1/columns/${ID.todo}/move`)).send({ prevId: ID.todo });
    const same = await auth(request(app).patch(`/api/v1/columns/${ID.todo}/move`)).send({
      prevId: ID.doing,
      nextId: ID.doing,
    });
    expect(self.status).toBe(400);
    expect(same.status).toBe(400);
  });

  it("responde 404 si la columna no existe", async () => {
    const { app } = makeMemoryApp();
    const res = await auth(request(app).patch(`/api/v1/columns/${MISSING}/move`)).send({ prevId: ID.todo });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/columns/:id", () => {
  it("elimina una columna vacía", async () => {
    const { app, db } = makeMemoryApp();
    // "En proceso" tiene t3; primero la vaciamos con cascade desde otra columna sin tareas
    db.tables.tasks = db.tables.tasks.filter((t) => t.column_id !== ID.doing);
    const res = await auth(request(app).delete(`/api/v1/columns/${ID.doing}`));
    expect(res.status).toBe(204);
    expect(columnIdsOf(db, ID.board)).toEqual([ID.todo, ID.done]);
  });

  it("responde 409 COLUMN_NOT_EMPTY si tiene tareas y no se indica qué hacer, sin borrar nada", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).delete(`/api/v1/columns/${ID.todo}`));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("COLUMN_NOT_EMPTY");
    expect(res.body.error.details).toEqual([{ taskCount: 2 }]);
    expect(columnIdsOf(db, ID.board)).toContain(ID.todo);
    expect(taskIdsIn(db, ID.todo)).toEqual([ID.t1, ID.t2]);
  });

  it("con moveTo mueve las tareas al final del destino conservando su orden", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).delete(`/api/v1/columns/${ID.todo}`).query({ moveTo: ID.doing }));
    expect(res.status).toBe(204);
    expect(columnIdsOf(db, ID.board)).toEqual([ID.doing, ID.done]);
    expect(taskIdsIn(db, ID.doing)).toEqual([ID.t3, ID.t1, ID.t2]);
    // "En proceso" no es la última columna: no quedan tareas completadas
    expect(db.tables.tasks.find((t) => t.id === ID.t1)?.completed_at).toBeNull();
  });

  it("con moveTo hacia la última columna marca las tareas como completadas", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).delete(`/api/v1/columns/${ID.todo}`).query({ moveTo: ID.done }));
    expect(res.status).toBe(204);
    expect(taskIdsIn(db, ID.done)).toEqual([ID.t4, ID.t1, ID.t2]);
    expect(db.tables.tasks.find((t) => t.id === ID.t1)?.completed_at).toBeTruthy();
    expect(db.tables.tasks.find((t) => t.id === ID.t4)?.completed_at).toBe(DONE_AT); // conserva la suya
  });

  it("con cascade=true elimina la columna y sus tareas", async () => {
    const { app, db } = makeMemoryApp();
    const res = await auth(request(app).delete(`/api/v1/columns/${ID.todo}`).query({ cascade: "true" }));
    expect(res.status).toBe(204);
    expect(columnIdsOf(db, ID.board)).toEqual([ID.doing, ID.done]);
    expect(db.tables.tasks.some((t) => t.id === ID.t1 || t.id === ID.t2)).toBe(false);
    expect(db.tables.subtasks).toHaveLength(0); // las subtareas de t1 también se fueron
  });

  it("responde 400 si se pide moveTo y cascade a la vez, o moveTo igual a la columna", async () => {
    const { app } = makeMemoryApp();
    const both = await auth(request(app).delete(`/api/v1/columns/${ID.todo}`).query({ moveTo: ID.doing, cascade: "true" }));
    const same = await auth(request(app).delete(`/api/v1/columns/${ID.todo}`).query({ moveTo: ID.todo }));
    expect(both.status).toBe(400);
    expect(same.status).toBe(400);
  });

  it("responde 404 si el destino de moveTo no existe y 422 si es de otro tablero", async () => {
    const { app, db } = makeMemoryApp();
    const missing = await auth(request(app).delete(`/api/v1/columns/${ID.todo}`).query({ moveTo: MISSING }));
    const cross = await auth(request(app).delete(`/api/v1/columns/${ID.todo}`).query({ moveTo: ID.otherCol }));
    expect(missing.status).toBe(404);
    expect(cross.status).toBe(422);
    expect(columnIdsOf(db, ID.board)).toContain(ID.todo); // nada se borró
  });

  it("responde 404 si la columna no existe y 403 si es visible pero no editable", async () => {
    const { app } = makeMemoryApp();
    const missing = await auth(request(app).delete(`/api/v1/columns/${MISSING}`));
    expect(missing.status).toBe(404);

    const readOnly = makeMemoryApp({ readOnly: true });
    const forbidden = await auth(
      request(readOnly.app).delete(`/api/v1/columns/${ID.todo}`).query({ cascade: "true" }),
    );
    expect(forbidden.status).toBe(403);
  });
});
