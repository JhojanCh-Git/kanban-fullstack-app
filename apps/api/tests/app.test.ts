import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { AUTH_HEADER, USER_ID, makeApp } from "./helpers/fakeDb.js";

describe("health y rutas desconocidas", () => {
  it("GET /health responde 200 sin token", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("una ruta inexistente responde 404 con el formato único de error", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/no-existe");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("un JSON malformado responde 400 BAD_REQUEST", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/api/v1/boards")
      .set(...AUTH_HEADER)
      .set("Content-Type", "application/json")
      .send('{"title": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});

describe("autenticación", () => {
  it("rechaza con 401 si falta el header Authorization", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/api/v1/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rechaza con 401 un esquema que no es Bearer", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/api/v1/me").set("Authorization", "Basic abc");
    expect(res.status).toBe(401);
  });

  it("rechaza con 401 un token inválido", async () => {
    const { app } = makeApp({ claims: null });
    const res = await request(app)
      .get("/api/v1/me")
      .set(...AUTH_HEADER);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rechaza con 401 (no 500) un token que no es un JWT y hace lanzar a getClaims", async () => {
    const { app } = makeApp({ getClaimsThrows: true });
    const res = await request(app)
      .get("/api/v1/me")
      .set("Authorization", "Bearer abc.def.ghi");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });

  it("GET /api/v1/me devuelve el usuario del token", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .get("/api/v1/me")
      .set(...AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: USER_ID, email: "jhojan@example.com" });
  });
});

describe("loadEnv", () => {
  it("aplica valores por defecto y separa los orígenes de CORS", () => {
    const env = loadEnv({
      SUPABASE_URL: "https://abc.supabase.co",
      SUPABASE_ANON_KEY: "clave",
      CORS_ORIGINS: "http://localhost:5173, https://miapp.com",
    });
    expect(env.port).toBe(3001);
    expect(env.corsOrigins).toEqual(["http://localhost:5173", "https://miapp.com"]);
  });

  it("falla con un mensaje legible si faltan variables obligatorias", () => {
    expect(() => loadEnv({})).toThrow(/SUPABASE_URL/);
    expect(() => loadEnv({})).toThrow(/SUPABASE_ANON_KEY/);
  });
});
