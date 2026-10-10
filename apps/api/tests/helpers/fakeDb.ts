import { createApp } from "../../src/app.js";
import type { UserClient } from "../../src/lib/supabase.js";

export interface QueryContext {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: Record<string, unknown>;
  orders: string[];
  single: boolean;
}

export interface FakeResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

type MaybePromise<T> = T | Promise<T>;
export type TableHandler = (ctx: QueryContext) => MaybePromise<FakeResult>;
export type RpcHandler = (args: Record<string, unknown>) => MaybePromise<FakeResult>;

export interface FakeDbOptions {
  /** Claims que devuelve auth.getClaims(); `null` simula un token inválido. */
  claims?: { sub: string; email?: string } | null;
  /** Simula que getClaims() LANZA una excepción (p. ej. token que no es un JWT). */
  getClaimsThrows?: boolean;
  tables?: Record<string, TableHandler>;
  rpc?: Record<string, RpcHandler>;
}

class FakeQuery implements PromiseLike<FakeResult> {
  private readonly ctx: QueryContext;

  constructor(
    table: string,
    private readonly handler: TableHandler | undefined,
    private readonly calls: QueryContext[],
  ) {
    this.ctx = { table, op: "select", filters: {}, orders: [], single: false };
  }

  select(_columns?: string) {
    return this; // no cambia `op`: update().select() sigue siendo un update
  }
  insert(payload: unknown) {
    this.ctx.op = "insert";
    this.ctx.payload = payload;
    return this;
  }
  update(payload: unknown) {
    this.ctx.op = "update";
    this.ctx.payload = payload;
    return this;
  }
  delete() {
    this.ctx.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.ctx.filters[column] = value;
    return this;
  }
  order(column: string, _options?: unknown) {
    this.ctx.orders.push(column);
    return this;
  }
  maybeSingle() {
    this.ctx.single = true;
    return this;
  }

  then<R1 = FakeResult, R2 = never>(
    onfulfilled?: ((value: FakeResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const run = async (): Promise<FakeResult> => {
      this.calls.push(this.ctx);
      if (!this.handler) {
        return { data: null, error: { code: "FAKE", message: `Sin handler para ${this.ctx.table}` } };
      }
      return this.handler(this.ctx);
    };
    return run().then(onfulfilled, onrejected);
  }
}

export function createFakeDb(options: FakeDbOptions = {}) {
  const calls: QueryContext[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  return {
    calls,
    rpcCalls,
    auth: {
      getClaims: async (_jwt?: string) => {
        if (options.getClaimsThrows) throw new Error("Invalid UTF-8 sequence");
        return options.claims
          ? { data: { claims: options.claims }, error: null }
          : { data: null, error: { message: "invalid jwt" } };
      },
    },
    from: (table: string) => new FakeQuery(table, options.tables?.[table], calls),
    rpc: async (fn: string, args: Record<string, unknown>): Promise<FakeResult> => {
      rpcCalls.push({ fn, args });
      const handler = options.rpc?.[fn];
      return handler
        ? handler(args)
        : { data: null, error: { code: "FAKE", message: `Sin handler para rpc ${fn}` } };
    },
  };
}

export const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const AUTH_HEADER = ["Authorization", "Bearer test-token"] as const;

/** Crea la app real con un cliente Supabase falso inyectado. */
export function makeApp(options: FakeDbOptions = {}) {
  const db = createFakeDb({ claims: { sub: USER_ID, email: "jhojan@example.com" }, ...options });
  const app = createApp({
    createUserClient: () => db as unknown as UserClient,
    corsOrigins: ["http://localhost:5173"],
  });
  return { app, db };
}
