/**
 * Local-only development login. Never enabled on Vercel production.
 *
 * Default identity (override with env):
 *   email/username:  DEV_LOGIN_EMAIL  (default  dev@localhost)
 *   password:        DEV_LOGIN_PASSWORD  (default  dev-local-only)
 *
 * Enable/disable:
 *   On by default when NODE_ENV=development (Vite `npm start` / `npm run dev`).
 *   Off on VERCEL_ENV=production.
 *   Preview/prod-like runtimes stay off unless DEV_LOGIN_ENABLED=true.
 *
 * Auto-login: client POSTs { auto: true } on boot when import.meta.env.DEV
 * and this gate is true. Production builds never call it; the endpoint 404s.
 */

import { timingSafeEqual } from "node:crypto";

const DEFAULT_EMAIL = "dev@localhost";
const DEFAULT_PASSWORD = "dev-local-only";
const DEFAULT_NAME = "Local Dev";
const DEV_PROVIDER = "dev";
const DEV_SUB = "dev-local";
const DEV_FALLBACK_SESSION_SECRET = "local-dev-session-secret-do-not-use-in-prod";

function envFlag(name) {
  return String(process.env[name] ?? "")
    .trim()
    .toLowerCase();
}

export function isDevAuthEnabled() {
  if (envFlag("VERCEL_ENV") === "production") return false;

  const flag = envFlag("DEV_LOGIN_ENABLED");
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;

  if (envFlag("NODE_ENV") === "development") return true;
  return false;
}

export function getDevLoginIdentity() {
  const email = String(process.env.DEV_LOGIN_EMAIL ?? DEFAULT_EMAIL)
    .trim()
    .toLowerCase() || DEFAULT_EMAIL;
  const password = String(process.env.DEV_LOGIN_PASSWORD ?? DEFAULT_PASSWORD);
  const name = String(process.env.DEV_LOGIN_NAME ?? DEFAULT_NAME).trim() || DEFAULT_NAME;
  return {
    email,
    password,
    name,
    provider: DEV_PROVIDER,
    sub: DEV_SUB,
  };
}

export function getDevFallbackSessionSecret() {
  return DEV_FALLBACK_SESSION_SECRET;
}

export function isDevLoginSession(session) {
  if (!session) return false;
  const identity = getDevLoginIdentity();
  const email = String(session.email ?? "")
    .trim()
    .toLowerCase();
  return session.provider === DEV_PROVIDER && email === identity.email;
}

export function syntheticDevApprovedRow() {
  const identity = getDevLoginIdentity();
  return {
    id: 0,
    email: identity.email,
    name: identity.name,
    is_admin: true,
    created_by: "dev-login",
    notes: "Local development account — not stored in the database",
    created_at: null,
  };
}

function utf8(value) {
  return Buffer.from(String(value ?? ""), "utf8");
}

export function passwordsMatch(provided, expected) {
  const a = utf8(provided);
  const b = utf8(expected);
  if (a.length !== b.length) {
    const dummy = a.length > 0 ? a : utf8("x");
    timingSafeEqual(dummy, dummy);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function identifiersMatch(identifier, email) {
  const id = String(identifier ?? "")
    .trim()
    .toLowerCase();
  if (!id) return false;
  const normalizedEmail = String(email ?? "")
    .trim()
    .toLowerCase();
  const local = normalizedEmail.includes("@")
    ? normalizedEmail.split("@")[0]
    : normalizedEmail;
  return id === normalizedEmail || id === local || id === "dev";
}

export function verifyDevLoginCredentials(identifier, password) {
  const identity = getDevLoginIdentity();
  const userOk = identifiersMatch(identifier, identity.email);
  const passOk = passwordsMatch(password, identity.password);
  return userOk && passOk;
}
