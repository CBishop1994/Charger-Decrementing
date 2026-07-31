import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function stockStatus(quantity: number, minLevel: number) {
  if (quantity <= 0) return "out" as const;
  if (quantity <= minLevel) return "low" as const;
  return "ok" as const;
}

export function StockBadge({
  quantity,
  minLevel,
  className,
}: {
  quantity: number;
  minLevel: number;
  className?: string;
}) {
  const status = stockStatus(quantity, minLevel);
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium",
        status === "ok" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        status === "low" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        status === "out" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
        className,
      )}
    >
      {status === "ok" ? "In stock" : status === "low" ? "Low stock" : "Out of stock"}
    </Badge>
  );
}
