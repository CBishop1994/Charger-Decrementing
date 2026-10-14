/**
 * In-memory Supabase/PostgREST-shaped client for local destage (`npm start`).
 *
 * Used only when NODE_ENV=development (dev login enabled) and real
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. Production and
 * preview with real credentials never touch this module's data path.
 *
 * Supports the query surface used by api/inventory.ts and require-auth.js.
 */

const TABLES = [
  "consumables",
  "bin_locations",
  "stock_transactions",
  "stock_orders",
  "printer_settings",
  "approved_emails",
  "procurement_order_lines",
  "procurement_batches",
  "procurement_settings",
  "consumables_alert_batches",
  "consumables_alert_settings",
];

/** @type {Map<string, Array<Record<string, unknown>>> | null} */
let store = null;
/** @type {Map<string, number> | null} */
let seq = null;

function ensureStore() {
  if (!store) {
    store = new Map();
    seq = new Map();
    for (const t of TABLES) {
      store.set(t, []);
      seq.set(t, 1);
    }
  }
  return /** @type {{ store: Map<string, Array<Record<string, unknown>>>, seq: Map<string, number> }} */ ({
    store,
    seq,
  });
}

/** Reset all tables (tests / force re-seed). */
export function resetLocalMemoryDb() {
  store = null;
  seq = null;
}

export function isLocalMemoryActive() {
  return store != null;
}

function clone(row) {
  return { ...row };
}

function nextId(table) {
  const { seq: s } = ensureStore();
  const id = s.get(table) ?? 1;
  s.set(table, id + 1);
  return id;
}

function matchIlike(value, pattern) {
  const raw = String(pattern ?? "");
  // Escape sequences from escapeIlike: \% \_ \\
  let reSrc = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      const next = raw[i + 1];
      reSrc += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
      continue;
    }
    if (ch === "%") {
      reSrc += ".*";
      continue;
    }
    if (ch === "_") {
      reSrc += ".";
      continue;
    }
    reSrc += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${reSrc}$`, "i").test(String(value ?? ""));
}

function parseOrFilter(orExpr) {
  // e.g. name.ilike.%foo%,sku.ilike.%foo%
  const parts = String(orExpr ?? "").split(",");
  /** @type {Array<{ field: string, op: string, value: string }>} */
  const clauses = [];
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z0-9_]+)\.(eq|neq|ilike|like)\.(.*)$/i);
    if (!m) continue;
    clauses.push({ field: m[1], op: m[2].toLowerCase(), value: m[3] });
  }
  return clauses;
}

function applyFilter(row, field, op, value) {
  const cell = row[field];
  switch (op) {
    case "eq":
      return cell === value || String(cell) === String(value);
    case "neq":
      return cell !== value && String(cell) !== String(value);
    case "ilike":
    case "like":
      return matchIlike(cell, value);
    case "in":
      return Array.isArray(value) && value.some((v) => v === cell || String(v) === String(cell));
    default:
      return true;
  }
}

class QueryBuilder {
  /**
   * @param {string} table
   * @param {"select"|"insert"|"update"|"delete"} kind
   */
  constructor(table, kind) {
    this.table = table;
    this.kind = kind;
    /** @type {Record<string, unknown> | Record<string, unknown>[] | null} */
    this._payload = null;
    /** @type {Array<{ field: string, op: string, value: unknown }>} */
    this._filters = [];
    /** @type {Array<{ field: string, op: string, value: string }> | null} */
    this._or = null;
    /** @type {Array<{ field: string, ascending: boolean }>} */
    this._orders = [];
    this._limit = null;
    this._head = false;
    this._countExact = false;
    this._single = false;
    this._maybeSingle = false;
    this._returning = true;
  }

  select(_columns, opts) {
    if (opts && typeof opts === "object") {
      if (opts.head) this._head = true;
      if (opts.count === "exact") this._countExact = true;
    }
    return this;
  }

  insert(rows) {
    this.kind = "insert";
    this._payload = rows;
    return this;
  }

  update(patch) {
    this.kind = "update";
    this._payload = patch;
    return this;
  }

  delete() {
    this.kind = "delete";
    return this;
  }

  eq(field, value) {
    this._filters.push({ field, op: "eq", value });
    return this;
  }

  neq(field, value) {
    this._filters.push({ field, op: "neq", value });
    return this;
  }

  ilike(field, value) {
    this._filters.push({ field, op: "ilike", value });
    return this;
  }

  in(field, values) {
    this._filters.push({ field, op: "in", value: values });
    return this;
  }

  or(expr) {
    this._or = parseOrFilter(expr);
    return this;
  }

  order(field, opts) {
    this._orders.push({
      field,
      ascending: opts?.ascending !== false,
    });
    return this;
  }

  limit(n) {
    this._limit = Number(n) || null;
    return this;
  }

  single() {
    this._single = true;
    return this;
  }

  maybeSingle() {
    this._maybeSingle = true;
    return this;
  }

  then(resolve, reject) {
    return this._execute().then(resolve, reject);
  }

  async _execute() {
    try {
      const { store: db } = ensureStore();
      if (!db.has(this.table)) {
        return {
          data: null,
          error: {
            message: `Could not find the table 'public.${this.table}' in the schema cache`,
          },
          count: null,
        };
      }

      let rows = db.get(this.table) ?? [];

      const filtered = () =>
        rows.filter((row) => {
          for (const f of this._filters) {
            if (!applyFilter(row, f.field, f.op, f.value)) return false;
          }
          if (this._or && this._or.length) {
            const any = this._or.some((c) =>
              applyFilter(row, c.field, c.op, c.value),
            );
            if (!any) return false;
          }
          return true;
        });

      if (this.kind === "insert") {
        const incoming = Array.isArray(this._payload)
          ? this._payload
          : [this._payload];
        const inserted = [];
        const now = new Date().toISOString();
        for (const raw of incoming) {
          const row = {
            id: nextId(this.table),
            created_at: now,
            ...raw,
          };
          if (row.updated_at === undefined && "updated_at" in (raw ?? {})) {
            // keep provided
          }
          rows.push(row);
          inserted.push(clone(row));
        }
        db.set(this.table, rows);
        if (this._single || this._maybeSingle) {
          return { data: inserted[0] ?? null, error: null, count: null };
        }
        return { data: inserted, error: null, count: null };
      }

      if (this.kind === "update") {
        const matches = filtered();
        const patch = /** @type {Record<string, unknown>} */ (this._payload ?? {});
        const updated = [];
        for (const row of matches) {
          Object.assign(row, patch);
          updated.push(clone(row));
        }
        if (this._single) {
          if (updated.length === 0) {
            return {
              data: null,
              error: { message: "JSON object requested, multiple (or no) rows returned" },
              count: null,
            };
          }
          return { data: updated[0], error: null, count: null };
        }
        if (this._maybeSingle) {
          return { data: updated[0] ?? null, error: null, count: null };
        }
        return { data: updated, error: null, count: null };
      }

      if (this.kind === "delete") {
        const matches = new Set(filtered());
        const kept = rows.filter((r) => !matches.has(r));
        db.set(this.table, kept);
        return { data: null, error: null, count: null };
      }

      // select
      let result = filtered().map(clone);
      const count = this._countExact ? result.length : null;

      if (this._head) {
        return { data: null, error: null, count };
      }

      if (this._orders.length) {
        result.sort((a, b) => {
          for (const ord of this._orders) {
            const av = a[ord.field];
            const bv = b[ord.field];
            if (av === bv) continue;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (av < bv) return ord.ascending ? -1 : 1;
            return ord.ascending ? 1 : -1;
          }
          return 0;
        });
      }

      if (this._limit != null) {
        result = result.slice(0, this._limit);
      }

      if (this._single) {
        if (result.length !== 1) {
          return {
            data: null,
            error: {
              message:
                result.length === 0
                  ? "JSON object requested, multiple (or no) rows returned"
                  : "JSON object requested, multiple (or no) rows returned",
            },
            count,
          };
        }
        return { data: result[0], error: null, count };
      }

      if (this._maybeSingle) {
        return { data: result[0] ?? null, error: null, count };
      }

      return { data: result, error: null, count };
    } catch (err) {
      return {
        data: null,
        error: {
          message: err instanceof Error ? err.message : String(err),
        },
        count: null,
      };
    }
  }
}

/**
 * Create a supabaseAdmin-compatible client backed by process memory.
 */
export function createLocalMemoryClient() {
  ensureStore();
  return {
    from(table) {
      return new QueryBuilder(String(table), "select");
    },
  };
}
