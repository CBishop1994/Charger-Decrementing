import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { NumberTicker } from "@/components/ui/number-ticker";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  hint,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: "default" | "warning" | "danger" | "success";
  hint?: string;
}) {
  return (
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <div className="mt-2 flex items-baseline gap-1">
            <NumberTicker
              value={value}
              className="text-3xl font-semibold tracking-tight tabular-nums text-foreground"
            />
          </div>
          {hint ? (
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            tone === "default" && "bg-primary/10 text-primary",
            tone === "warning" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
            tone === "danger" && "bg-destructive/15 text-destructive",
            tone === "success" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
