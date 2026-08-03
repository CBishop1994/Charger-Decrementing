import type { ReactNode } from "react";
import {
  Boxes,
  LayoutDashboard,
  LogOut,
  MapPin,
  Moon,
  Package,
  Printer,
  Shield,
  Sun,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { BlurFade } from "@/components/ui/blur-fade";
import { useAuth } from "@/lib/auth/use-auth";

export type AppView =
  | "dashboard"
  | "consumables"
  | "bins"
  | "printers"
  | "history"
  | "access";

const NAV: Array<{
  id: AppView;
  label: string;
  icon: typeof LayoutDashboard;
  description: string;
}> = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "Stock health overview",
  },
  {
    id: "consumables",
    label: "Consumables",
    icon: Package,
    description: "Decrement & restock",
  },
  {
    id: "bins",
    label: "Bin locations",
    icon: MapPin,
    description: "Location asset tags",
  },
  {
    id: "printers",
    label: "Printers",
    icon: Printer,
    description: "Ethernet label printers",
  },
  {
    id: "history",
    label: "History",
    icon: History,
    description: "Stock movement log",
  },
  {
    id: "access",
    label: "Access",
    icon: Shield,
    description: "Approved Google emails",
  },
];

export function AppShell({
  view,
  onNavigate,
  children,
}: {
  view: AppView;
  onNavigate: (v: AppView) => void;
  children: ReactNode;
}) {
  const { theme, toggle } = useTheme();
  const { user, signOut } = useAuth();
  const active = NAV.find((n) => n.id === view) ?? NAV[0];
  const displayName = user?.name || user?.email || "Signed in";
  const initials = (user?.name || user?.email || "?")
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex">
          <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Boxes className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">
                StockTag
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Consumables & labels
              </p>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-1 p-3">
            {NAV.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === view;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isActive ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-none">
                      {item.label}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="space-y-3 border-t border-sidebar-border p-4">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3">
              {user?.picture ? (
                <img
                  src={user.picture}
                  alt=""
                  className="h-9 w-9 rounded-full border border-border object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {initials}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">
                  {displayName}
                </p>
                {user?.email ? (
                  <p className="truncate text-[11px] text-muted-foreground">
                    {user.email}
                  </p>
                ) : null}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => void signOut()}
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="min-w-0 md:hidden">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Boxes className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">StockTag</p>
                    <p className="text-[11px] text-muted-foreground">
                      {active.label}
                    </p>
                  </div>
                </div>
              </div>
              <div className="hidden min-w-0 md:block">
                <BlurFade delay={0.05}>
                  <h1 className="text-lg font-semibold tracking-tight">
                    {active.label}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {active.description}
                  </p>
                </BlurFade>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-2 sm:flex">
                  {user?.picture ? (
                    <img
                      src={user.picture}
                      alt=""
                      className="h-8 w-8 rounded-full border border-border object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : null}
                  <span className="max-w-[160px] truncate text-xs text-muted-foreground">
                    {user?.email}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={toggle}
                  aria-label="Toggle theme"
                  className="h-9 w-9"
                >
                  {theme === "dark" ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="md:hidden"
                  onClick={() => void signOut()}
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Mobile nav */}
            <div className="flex gap-1 overflow-x-auto border-t border-border px-2 py-2 md:hidden">
              {NAV.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === view;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </header>

          <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
