import type { IncomingMessage, ServerResponse } from "node:http";
import { assertSameSiteRequest } from "./_lib/redirect-uri.js";
import { setSession, type SessionPayload } from "./_lib/session.js";
import {
  getDevLoginIdentity,
  isDevAuthEnabled,
  verifyDevLoginCredentials,
} from "../_lib/dev-auth.js";

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function notAvailable(res: ServerResponse) {
  json(res, 404, { error: "Not found", code: "NOT_FOUND" });
}

function readBody(req: IncomingMessage): Record<string, unknown> {
  const raw = (req as IncomingMessage & { body?: unknown }).body;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

async function mintDevSession(res: ServerResponse) {
  const identity = getDevLoginIdentity();
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: identity.sub,
    email: identity.email,
    name: identity.name,
    provider: identity.provider,
    iat: now,
    exp: now + 60 * 60 * 24 * 7,
  };

  try {
    await setSession(res, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create session";
    return json(res, 500, {
      error: message,
      code: "SESSION_ERROR",
    });
  }

  return json(res, 200, {
    ok: true,
    auto: false,
    user: {
      id: payload.sub,
      email: payload.email ?? null,
      name: payload.name ?? null,
      picture: null,
      provider: payload.provider,
    },
  });
}

/**
 * Local development sign-in. Disabled on production (404).
 *
 * GET  — { enabled, email, autoLogin } so the client can auto-sign-in.
 * POST — { auto: true } mints a session for the dedicated dev account (no password).
 * POST — { email|username, password } same session, password fallback.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!isDevAuthEnabled()) {
    return notAvailable(res);
  }

  if (req.method === "GET") {
    const identity = getDevLoginIdentity();
    return json(res, 200, {
      enabled: true,
      autoLogin: true,
      email: identity.email,
      name: identity.name,
    });
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    res.end("Method Not Allowed");
    return;
  }

  if (!assertSameSiteRequest(req)) {
    res.statusCode = 403;
    res.end("Cross-site request blocked");
    return;
  }

  const body = readBody(req);
  const auto = body.auto === true || body.auto === "true" || body.auto === 1;

  if (auto) {
    const identity = getDevLoginIdentity();
    const now = Math.floor(Date.now() / 1000);
    const payload: SessionPayload = {
      sub: identity.sub,
      email: identity.email,
      name: identity.name,
      provider: identity.provider,
      iat: now,
      exp: now + 60 * 60 * 24 * 7,
    };
    try {
      await setSession(res, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create session";
      return json(res, 500, {
        error: message,
        code: "SESSION_ERROR",
      });
    }
    return json(res, 200, {
      ok: true,
      auto: true,
      user: {
        id: payload.sub,
        email: payload.email ?? null,
        name: payload.name ?? null,
        picture: null,
        provider: payload.provider,
      },
    });
  }

  const identifier = String(body.email ?? body.username ?? "").trim();
  const password = String(body.password ?? "");

  if (!verifyDevLoginCredentials(identifier, password)) {
    return json(res, 401, {
      error: "Invalid development username or password",
      code: "INVALID_CREDENTIALS",
    });
  }

  return mintDevSession(res);
}
