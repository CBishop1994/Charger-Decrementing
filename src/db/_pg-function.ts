// @appbuilder-pg-function-v1 -- auto-injected by deploy pipeline.
// Do not edit by hand; the pipeline replaces this file on the next deploy.
//
// Declare Postgres functions that the platform will install on the
// next "Push to Supabase" (the same flow that creates tables from
// pgTable). The platform enforces SECURITY INVOKER at install time
// -- no SECURITY DEFINER escalation -- and does not emit GRANT
// EXECUTE for anon/authenticated. Call the installed function from
// an api/*.ts route via:
//   const { data, error } = await supabaseAdmin.rpc("function_name", { ...args });

export type PgFunctionLanguage = "plpgsql" | "sql";

export interface PgFunctionDef {
  /** Parameter list as plain SQL text, e.g. "user_id uuid, amount integer". Empty for no-arg. */
  args?: string;
  /** Postgres return type, e.g. "integer", "void", "setof todos", "jsonb". */
  returns: string;
  /** Defaults to "plpgsql". */
  language?: PgFunctionLanguage;
  /** Function body. For plpgsql: the inner BEGIN ... END; block. For sql: the inner statement(s). */
  body: string;
}

export interface PgFunctionMarker extends PgFunctionDef {
  readonly __pgFunction: true;
  readonly name: string;
  readonly language: PgFunctionLanguage;
}

export function pgFunction(name: string, def: PgFunctionDef): PgFunctionMarker {
  return {
    __pgFunction: true,
    name,
    args: def.args ?? "",
    returns: def.returns,
    language: def.language ?? "plpgsql",
    body: def.body,
  };
}
