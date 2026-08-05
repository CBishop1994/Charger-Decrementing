/**
 * Normalize Supabase / PostgREST errors into actionable API messages.
 * The most common first-run failure is "table not in schema cache" when the
 * user has linked Supabase but has not clicked "Push to Supabase" yet.
 */

export function isMissingTableError(message) {
  if (!message) return false;
  const m = String(message).toLowerCase();
  return (
    m.includes("schema cache") ||
    m.includes("does not exist") ||
    m.includes("could not find the table") ||
    (m.includes("relation") && m.includes("does not exist"))
  );
}

export const SETUP_REQUIRED_MESSAGE =
  "Database tables are not set up yet. Open the Database panel and click “Push to Supabase”, then reload this app.";

/** Extract a public.table_name (if present) from a PostgREST schema-cache error. */
function missingTableName(message) {
  if (!message) return null;
  const m = String(message);
  const match =
    m.match(/public\.([a-zA-Z0-9_]+)/i) ||
    m.match(/table ['`]?([a-zA-Z0-9_]+)['`]?/i) ||
    m.match(/relation ['`]?([a-zA-Z0-9_\.]+)['`]?/i);
  return match ? match[1].replace(/^public\./i, "") : null;
}

/**
 * Map a Supabase error (or thrown Error) to { status, body } for the response.
 */
export function mapDbError(error) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : error instanceof Error
        ? error.message
        : "Server error";

  if (isMissingTableError(message)) {
    const table = missingTableName(message);
    const errorMsg = table
      ? `The “${table}” table is missing from Supabase. Open the Database panel, click “Push to Supabase”, wait for it to finish, then reload this app.`
      : SETUP_REQUIRED_MESSAGE;
    return {
      status: 503,
      body: {
        error: errorMsg,
        code: "SETUP_REQUIRED",
        detail: message,
        table: table || undefined,
        hint: "Schema is defined in src/db/schema.ts but has not been applied to the linked Supabase project yet.",
      },
    };
  }

  return {
    status: 500,
    body: { error: message },
  };
}

export function sendDbError(res, error) {
  const { status, body } = mapDbError(error);
  return res.status(status).json(body);
}
