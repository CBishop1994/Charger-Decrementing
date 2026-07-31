import type { ReactNode } from "react";
import {
  Boxes,
  LayoutDashboard,
  MapPin,
  Moon,
  Package,
  Printer,
  Sun,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { BlurFade } from "@/components/ui/blur-fade";

export type AppView =
  | "dashboard"
  | "consumables"
  | "bins"
  | "printers"
  | "history";

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
  const active = NAV.find((n) => n.id === view) ?? NAV[0];

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

          <div className="border-t border-sidebar-border p-4">
            <div className="rounded-xl border border-border bg-card/60 p-3">
              <p className="text-xs font-medium text-foreground">
                Floor-ready inventory
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Track mins, decrement stock, and print ZPL asset tags to your
                Ethernet label printer.
              </p>
            </div>
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
