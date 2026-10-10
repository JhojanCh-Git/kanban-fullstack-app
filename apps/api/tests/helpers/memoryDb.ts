import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app.js";
import type { UserClient } from "../../src/lib/supabase.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;
export type TableName =
  | "boards"
  | "board_members"
  | "columns"
  | "labels"
  | "tasks"
  | "task_labels"
  | "subtasks";

interface Filter {
  kind: "eq" | "neq" | "in";
  column: string;
  value: unknown;
}
interface Order {
  column: string;
  ascending: boolean;
  referencedTable?: string;
}
interface Result {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/** Tablas hijas que se eliminan en cascada (ON DELETE CASCADE). */
const CHILDREN: Partial<Record<TableName, { table: TableName; fk: string }[]>> = {
  boards: [
    { table: "columns", fk: "board_id" },
    { table: "labels", fk: "board_id" },
    { table: "tasks", fk: "board_id" },
    { table: "board_members", fk: "board_id" },
  ],
  columns: [{ table: "tasks", fk: "column_id" }],
  tasks: [
    { table: "subtasks", fk: "task_id" },
    { table: "task_labels", fk: "task_id" },
  ],
  labels: [{ table: "task_labels", fk: "label_id" }],
};

export interface MemoryDbOptions {
  userId: string;
  tables?: Partial<Record<TableName, Row[]>>;
  /** Simula un rol de solo lectura (viewer): los INSERT fallan con 42501 y UPDATE/DELETE no afectan filas. */
  readOnly?: boolean;
}

export class MemoryDb {
  readonly tables: Record<TableName, Row[]>;

  constructor(private readonly options: MemoryDbOptions) {
    this.tables = {
      boards: [],
      board_members: [],
      columns: [],
      labels: [],
      tasks: [],
      task_labels: [],
      subtasks: [],
      ...structuredClone(options.tables ?? {}),
    };
  }

  /* --- API que usa el servicio (subconjunto de supabase-js) --- */
  auth = {
    getClaims: async () => ({
      data: { claims: { sub: this.options.userId, email: "jhojan@example.com" } },
      error: null,
    }),
  };

  from(table: TableName) {
    return new MemoryQuery(this, table);
  }

  get readOnly(): boolean {
    return this.options.readOnly === true;
  }
  get userId(): string {
    return this.options.userId;
  }

  /** Elimina filas y, en cascada, sus hijas. Devuelve las filas eliminadas. */
  removeWhere(table: TableName, predicate: (row: Row) => boolean): Row[] {
    const removed = this.tables[table].filter(predicate);
    this.tables[table] = this.tables[table].filter((row) => !predicate(row));
    const removedIds = new Set(removed.map((row) => row.id));
    for (const child of CHILDREN[table] ?? []) {
      this.removeWhere(child.table, (row) => removedIds.has(row[child.fk]));
    }
    return removed;
  }
}

class MemoryQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: any;
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private limitCount?: number;
  private selectStr = "*";
  private returning = false;
  private cardinality: "none" | "maybe" | "one" = "none";

  constructor(
    private readonly db: MemoryDb,
    private readonly table: TableName,
  ) {}

  select(columns = "*") {
    this.selectStr = columns;
    this.returning = true;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }
  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }
  order(column: string, options: { ascending?: boolean; referencedTable?: string } = {}) {
    this.orders.push({ column, ascending: options.ascending ?? true, referencedTable: options.referencedTable });
    return this;
  }
  limit(count: number) {
    this.limitCount = count;
    return this;
  }
  maybeSingle() {
    this.cardinality = "maybe";
    return this;
  }
  single() {
    this.cardinality = "one";
    return this;
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  /* --- ejecución --- */
  private matches(row: Row): boolean {
    return this.filters.every((filter) => {
      const value = row[filter.column];
      if (filter.kind === "eq") return value === filter.value;
      if (filter.kind === "neq") return value !== filter.value;
      return (filter.value as unknown[]).includes(value);
    });
  }

  private sorted(rows: Row[], orders: Order[]): Row[] {
    return [...rows].sort((a, b) => {
      for (const { column, ascending } of orders) {
        const x = a[column];
        const y = b[column];
        if (x === y) continue;
        const result = x < y ? -1 : 1;
        return ascending ? result : -result;
      }
      return 0;
    });
  }

  private project(row: Row): Row {
    const copy = { ...row };
    if (this.table === "tasks" && /subtasks\(/.test(this.selectStr)) {
      const subtaskOrders = this.orders.filter((o) => o.referencedTable === "subtasks");
      const subtasks = this.db.tables.subtasks.filter((s) => s.task_id === row.id);
      copy.subtasks = this.sorted(subtasks, subtaskOrders.length ? subtaskOrders : [{ column: "position", ascending: true }]).map(
        (s) => ({ ...s }),
      );
      copy.task_labels = this.db.tables.task_labels
        .filter((link) => link.task_id === row.id)
        .map((link) => ({ label_id: link.label_id }));
    }
    return copy;
  }

  private shape(rows: Row[]): Result {
    if (!this.returning) return { data: null, error: null };
    const data = rows.map((row) => this.project(row));
    if (this.cardinality === "one") {
      return data.length === 1
        ? { data: data[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "no rows" } };
    }
    if (this.cardinality === "maybe") {
      return data.length <= 1
        ? { data: data[0] ?? null, error: null }
        : { data: null, error: { code: "PGRST116", message: "multiple rows" } };
    }
    return { data, error: null };
  }

  private run(): Result {
    const rows = this.db.tables[this.table];
    const now = new Date().toISOString();

    if (this.op === "select") {
      let found = this.sorted(rows.filter((row) => this.matches(row)), this.orders.filter((o) => !o.referencedTable));
      if (this.limitCount !== undefined) found = found.slice(0, this.limitCount);
      this.returning = true;
      return this.shape(found);
    }

    if (this.op === "insert") {
      if (this.db.readOnly) {
        return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
      }
      const inserted: Row[] = [];
      for (const input of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const row: Row = { ...input };
        const error = this.applyInsertRules(row, now);
        if (error) return { data: null, error };
        rows.push(row);
        inserted.push(row);
      }
      return this.shape(inserted);
    }

    if (this.op === "update") {
      if (this.db.readOnly) return this.shape([]);
      const targets = rows.filter((row) => this.matches(row));
      if (this.table === "labels" && this.payload.name !== undefined) {
        for (const row of targets) {
          const clash = rows.some((l) => l !== row && l.board_id === row.board_id && l.name === this.payload.name);
          if (clash) return { data: null, error: { code: "23505", message: "duplicate label name" } };
        }
      }
      for (const row of targets) {
        Object.assign(row, this.payload);
        if (this.table === "tasks") row.updated_at = now;
      }
      return this.shape(targets);
    }

    // delete
    if (this.db.readOnly) return this.shape([]);
    // Se compara por referencia: tablas como task_labels no tienen columna id.
    const targets = new Set(rows.filter((row) => this.matches(row)));
    const removed = this.db.removeWhere(this.table, (row) => targets.has(row));
    return this.shape(removed);
  }

  /** Defaults de columnas y comprobaciones equivalentes a FKs/triggers de la BD. */
  private applyInsertRules(row: Row, now: string): { code: string; message: string } | null {
    const t = this.db.tables;
    if (this.table !== "task_labels") row.id ??= randomUUID();
    row.created_at ??= now;

    if (this.table === "tasks") {
      row.priority ??= "medium";
      row.description ??= null;
      row.due_date ??= null;
      row.assigned_to ??= null;
      row.completed_at ??= null;
      row.created_by ??= this.db.userId;
      row.updated_at ??= now;
      const column = t.columns.find((c) => c.id === row.column_id);
      if (!column) return { code: "23503", message: "column not found" };
      row.board_id = column.board_id; // trigger tasks_sync_board_id
    }
    if (this.table === "columns" && !t.boards.some((b) => b.id === row.board_id)) {
      return { code: "23503", message: "board not found" };
    }
    if (this.table === "subtasks") {
      row.is_completed ??= false;
      if (!t.tasks.some((x) => x.id === row.task_id)) return { code: "23503", message: "task not found" };
    }
    if (this.table === "labels") {
      row.color ??= "#64748b";
      if (!t.boards.some((b) => b.id === row.board_id)) return { code: "23503", message: "board not found" };
      if (t.labels.some((l) => l.board_id === row.board_id && l.name === row.name)) {
        return { code: "23505", message: "duplicate label name" }; // UNIQUE (board_id, name)
      }
    }
    if (this.table === "task_labels") {
      const task = t.tasks.find((x) => x.id === row.task_id);
      const label = t.labels.find((x) => x.id === row.label_id);
      if (!task || !label) return { code: "23503", message: "fk violation" };
      if (task.board_id !== label.board_id) return { code: "23514", message: "different boards" };
      if (t.task_labels.some((l) => l.task_id === row.task_id && l.label_id === row.label_id)) {
        return { code: "23505", message: "duplicate" };
      }
    }
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Datos de prueba                                                     */
/* ------------------------------------------------------------------ */
export const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const STRANGER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const MISSING = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

export const ID = {
  board: "11111111-1111-4111-8111-111111111111",
  board2: "12121212-1212-4212-8212-121212121212",
  todo: "21111111-1111-4111-8111-111111111111",
  doing: "22222222-2222-4222-8222-222222222222",
  done: "23333333-3333-4333-8333-333333333333",
  otherCol: "24444444-4444-4444-8444-444444444444",
  t1: "31111111-1111-4111-8111-111111111111",
  t2: "32222222-2222-4222-8222-222222222222",
  t3: "33333333-3333-4333-8333-333333333333",
  t4: "34444444-4444-4444-8444-444444444444",
  tOther: "35555555-5555-4555-8555-555555555555",
  label: "41111111-1111-4111-8111-111111111111",
  label2: "42222222-2222-4222-8222-222222222222",
  labelOther: "43333333-3333-4333-8333-333333333333",
  subtask: "51111111-1111-4111-8111-111111111111",
};

export const DONE_AT = "2026-10-01T10:00:00.000000+00:00";
const TS = "2026-10-09T12:00:00.000000+00:00";

const task = (id: string, column_id: string, position: string, extra: Row = {}): Row => ({
  id,
  column_id,
  board_id: ID.board,
  created_by: USER,
  assigned_to: null,
  title: `Tarea ${id.slice(0, 2)}`,
  description: null,
  priority: "medium",
  due_date: null,
  position,
  created_at: TS,
  updated_at: TS,
  completed_at: null,
  ...extra,
});

/**
 * Tablero 1 (del usuario): columnas Por hacer (a0), En proceso (a1), Completado (a2).
 *   t1 (a0) y t2 (a1) en Por hacer; t3 (a0) en En proceso; t4 (a0) en Completado (ya completada).
 * Tablero 2 (otro dueño) con una columna y una tarea, para probar cruces entre tableros.
 */
export function seedData(): Partial<Record<TableName, Row[]>> {
  return {
    boards: [
      { id: ID.board, title: "Proyecto", description: null, owner_id: USER, created_at: TS },
      { id: ID.board2, title: "Ajeno", description: null, owner_id: STRANGER, created_at: TS },
    ],
    board_members: [
      { id: "61111111-1111-4111-8111-111111111111", board_id: ID.board, user_id: USER, role: "owner", created_at: TS },
      { id: "62222222-2222-4222-8222-222222222222", board_id: ID.board, user_id: MEMBER, role: "editor", created_at: TS },
    ],
    columns: [
      { id: ID.todo, board_id: ID.board, title: "Por hacer", position: "a0", created_at: TS },
      { id: ID.doing, board_id: ID.board, title: "En proceso", position: "a1", created_at: TS },
      { id: ID.done, board_id: ID.board, title: "Completado", position: "a2", created_at: TS },
      { id: ID.otherCol, board_id: ID.board2, title: "Otra", position: "a0", created_at: TS },
    ],
    labels: [
      { id: ID.label, board_id: ID.board, name: "bug", color: "#ef4444", created_at: TS },
      { id: ID.label2, board_id: ID.board, name: "mejora", color: "#22c55e", created_at: TS },
      { id: ID.labelOther, board_id: ID.board2, name: "ajena", color: "#3b82f6", created_at: TS },
    ],
    tasks: [
      task(ID.t1, ID.todo, "a0"),
      task(ID.t2, ID.todo, "a1"),
      task(ID.t3, ID.doing, "a0"),
      task(ID.t4, ID.done, "a0", { completed_at: DONE_AT }),
      task(ID.tOther, ID.otherCol, "a0", { board_id: ID.board2 }),
    ],
    task_labels: [{ task_id: ID.t1, label_id: ID.label }],
    subtasks: [
      { id: ID.subtask, task_id: ID.t1, title: "Paso 1", is_completed: false, position: "a0", created_at: TS },
    ],
  };
}

/** Crea la app real con la base de datos en memoria inyectada. */
export function makeMemoryApp(options: Partial<MemoryDbOptions> = {}) {
  const db = new MemoryDb({ userId: USER, tables: seedData(), ...options });
  const app = createApp({
    createUserClient: () => db as unknown as UserClient,
    corsOrigins: ["http://localhost:5173"],
  });
  return { app, db };
}

/** Ids de las tareas de una columna, en el orden en que las vería el tablero. */
export function taskIdsIn(db: MemoryDb, columnId: string): string[] {
  return db.tables.tasks
    .filter((t) => t.column_id === columnId)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
    .map((t) => t.id);
}

export function columnIdsOf(db: MemoryDb, boardId: string): string[] {
  return db.tables.columns
    .filter((c) => c.board_id === boardId)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
    .map((c) => c.id);
}
