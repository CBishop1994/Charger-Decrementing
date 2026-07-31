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
    return {
      status: 503,
      body: {
        error: SETUP_REQUIRED_MESSAGE,
        code: "SETUP_REQUIRED",
        detail: message,
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
