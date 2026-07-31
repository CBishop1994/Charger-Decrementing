import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, isSetupRequiredError, type StockTransaction } from "@/lib/api";
import { SetupRequiredBanner } from "@/components/SetupRequiredBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ToastFn = (t: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
}) => void;

type TxRow = StockTransaction & {
  consumable_name?: string;
  consumable_sku?: string;
};

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function HistoryPage({ onToast }: { onToast: ToastFn }) {
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<TxRow[]>("/api/transactions?limit=100");
      setRows(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error");
      setLoadError(error);
      setRows([]);
      if (!isSetupRequiredError(error)) {
        onToast({
          title: "Failed to load history",
          description: error.message,
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Audit trail of every use and restock
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loadError && isSetupRequiredError(loadError) ? (
        <SetupRequiredBanner error={loadError} onRetry={() => void load()} />
      ) : null}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">
              No stock movements recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="hidden sm:table-cell text-right">
                      Before → After
                    </TableHead>
                    <TableHead className="hidden md:table-cell">By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatWhen(tx.created_at)}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">
                            {tx.consumable_name || `#${tx.consumable_id}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {tx.consumable_sku || ""}
                            {tx.note ? ` · ${tx.note}` : ""}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {tx.reason}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-sm font-semibold tabular-nums",
                          tx.change_amount < 0
                            ? "text-destructive"
                            : "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {tx.change_amount > 0 ? "+" : ""}
                        {tx.change_amount}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {tx.previous_quantity} → {tx.new_quantity}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {tx.created_by}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
