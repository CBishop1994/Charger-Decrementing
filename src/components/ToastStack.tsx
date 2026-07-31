import { X } from "lucide-react";
import type { Toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-xl border bg-card p-3 shadow-lg animate-in fade-in slide-in-from-bottom-2",
            t.variant === "destructive" &&
              "border-destructive/40 bg-destructive/10",
            t.variant === "success" && "border-emerald-500/30 bg-emerald-500/10",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{t.title}</p>
            {t.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t.description}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => onDismiss(t.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
