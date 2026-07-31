import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  History,
  MapPin,
  Package,
  PackageX,
  RefreshCw,
  Sprout,
} from "lucide-react";
import { api, isSetupRequiredError, type DashboardStats } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { SetupRequiredBanner } from "@/components/SetupRequiredBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";

type Props = {
  onToast: (t: {
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  }) => void;
  onGoConsumables: () => void;
  onGoBins: () => void;
};

type DashData = DashboardStats & {
  low_stock_items?: Array<Record<string, unknown>>;
};

export function DashboardPage({ onToast, onGoConsumables, onGoBins }: Props) {
  const [stats, setStats] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<DashData>("/api/dashboard");
      setStats(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error");
      setStats(null);
      setLoadError(error);
      if (!isSetupRequiredError(error)) {
        onToast({
          title: "Could not load dashboard",
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

  const seed = async () => {
    setSeeding(true);
    try {
      const res = await api.post<{
        ok: boolean;
        skipped?: boolean;
        message?: string;
        consumables?: number;
        bins?: number;
      }>("/api/seed", {});
      if (res.skipped) {
        onToast({
          title: "Already seeded",
          description: res.message,
        });
      } else {
        onToast({
          title: "Sample data loaded",
          description: `${res.consumables ?? 0} items, ${res.bins ?? 0} bins`,
          variant: "success",
        });
      }
      await load();
    } catch (err) {
      onToast({
        title: "Seed failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSeeding(false);
    }
  };

  const setupRequired = isSetupRequiredError(loadError);
  const empty = !loading && !setupRequired && (stats?.total_items ?? 0) === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Live stock health and recent floor activity
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void seed()}
            disabled={seeding || setupRequired}
          >
            <Sprout className="mr-2 h-3.5 w-3.5" />
            {seeding ? "Seeding…" : "Load sample data"}
          </Button>
        </div>
      </div>

      {setupRequired && loadError ? (
        <SetupRequiredBanner error={loadError} onRetry={() => void load()} />
      ) : null}

      {empty ? (
        <BlurFade>
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Package className="h-7 w-7" />
              </div>
              <div className="max-w-md space-y-2">
                <h2 className="text-xl font-semibold tracking-tight">
                  No consumables yet
                </h2>
                <p className="text-sm text-muted-foreground">
                  Add your first items, or load sample shop-floor data to explore
                  decrementing stock and printing asset tags.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={onGoConsumables}>Add consumables</Button>
                <Button variant="outline" onClick={() => void seed()} disabled={seeding}>
                  Load sample data
                </Button>
              </div>
            </CardContent>
          </Card>
        </BlurFade>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <BlurFade delay={0.05}>
              <StatCard
                label="Total items"
                value={stats?.total_items ?? 0}
                icon={Package}
                tone="default"
                hint="Tracked consumables"
              />
            </BlurFade>
            <BlurFade delay={0.1}>
              <StatCard
                label="Low stock"
                value={stats?.low_stock_count ?? 0}
                icon={AlertTriangle}
                tone="warning"
                hint="At or below minimum"
              />
            </BlurFade>
            <BlurFade delay={0.15}>
              <StatCard
                label="Out of stock"
                value={stats?.out_of_stock_count ?? 0}
                icon={PackageX}
                tone="danger"
                hint="Quantity is zero"
              />
            </BlurFade>
            <BlurFade delay={0.2}>
              <StatCard
                label="Bin locations"
                value={stats?.total_bins ?? 0}
                icon={MapPin}
                tone="success"
                hint="Active bins"
              />
            </BlurFade>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <BlurFade delay={0.12}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-base font-semibold">
                    Needs attention
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={onGoConsumables}>
                    View all
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {loading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-14 animate-pulse rounded-lg bg-muted"
                        />
                      ))}
                    </div>
                  ) : (stats?.low_stock_items?.length ?? 0) === 0 &&
                    (stats?.out_of_stock_count ?? 0) === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      All items are above minimum levels.
                    </p>
                  ) : (
                    (stats?.low_stock_items ?? []).map((item) => {
                      const qty = Number(item.quantity ?? 0);
                      const min = Number(item.min_level ?? 0);
                      const out = qty <= 0;
                      return (
                        <div
                          key={String(item.id)}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-card px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {String(item.name)}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {String(item.sku)} · min {min}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              out
                                ? "border-destructive/30 bg-destructive/10 text-destructive"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                            )}
                          >
                            {qty} left
                          </Badge>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </BlurFade>

            <BlurFade delay={0.18}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <History className="h-4 w-4 text-muted-foreground" />
                    Recent activity
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={onGoBins}>
                    Bins
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {loading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-12 animate-pulse rounded-lg bg-muted"
                        />
                      ))}
                    </div>
                  ) : (stats?.recent_transactions?.length ?? 0) === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No stock movements yet. Decrement an item to start the log.
                    </p>
                  ) : (
                    stats!.recent_transactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/80 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {tx.consumable_name || `Item #${tx.consumable_id}`}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {tx.reason}
                            {tx.note ? ` · ${tx.note}` : ""} · {tx.created_by}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 font-mono text-sm font-semibold tabular-nums",
                            tx.change_amount < 0
                              ? "text-destructive"
                              : "text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {tx.change_amount > 0 ? "+" : ""}
                          {tx.change_amount}
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </BlurFade>
          </div>
        </>
      )}
    </div>
  );
}
