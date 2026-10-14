/**
 * Persist current app navigation across browser refresh (sessionStorage).
 */

import type { AppView } from "@/components/AppShell";

const VIEW_KEY = "stocktag_app_view";
const ADMIN_TAB_KEY = "stocktag_admin_tab";

const VIEWS: AppView[] = [
  "dashboard",
  "scan",
  "consumables",
  "procurement",
  "bins",
  "printers",
  "history",
  "admin",
];

export type AdminTabId =
  | "main"
  | "access"
  | "alerts"
  | "procurement"
  | "printers"
  | "local"
  /** @deprecated merged into Main */
  | "integrations";

const ADMIN_TABS: AdminTabId[] = [
  "main",
  "access",
  "alerts",
  "procurement",
  "printers",
  "local",
];

/** Map legacy top-level views into Admin tabs. */
export function migrateLegacyView(view: string): {
  view: AppView;
  adminTab?: AdminTabId;
} {
  if (view === "printers") {
    return { view: "admin", adminTab: "printers" };
  }
  if ((VIEWS as string[]).includes(view)) {
    return { view: view as AppView };
  }
  return { view: "dashboard" };
}

function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage may be unavailable
  }
}

export function readPersistedView(fallback: AppView = "dashboard"): AppView {
  const raw = readStorage(VIEW_KEY);
  if (!raw) return fallback;
  const migrated = migrateLegacyView(raw);
  if (migrated.adminTab) {
    persistAdminTab(migrated.adminTab);
    persistView(migrated.view);
  }
  return migrated.view || fallback;
}

export function persistView(view: AppView): void {
  writeStorage(VIEW_KEY, view);
}

export function readPersistedAdminTab(
  fallback: AdminTabId = "main",
): AdminTabId {
  const raw = readStorage(ADMIN_TAB_KEY);
  if (raw === "integrations") return "main";
  if (raw && (ADMIN_TABS as string[]).includes(raw)) return raw as AdminTabId;
  return fallback;
}

export function persistAdminTab(tab: AdminTabId): void {
  writeStorage(ADMIN_TAB_KEY, tab);
}
