import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  CheckCircle2,
  Keyboard,
  Loader2,
  Package,
  ScanLine,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { api, ApiError, type Consumable, type ScanResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { StockBadge } from "@/components/StockBadge";

type ToastFn = (t: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
}) => void;

type ScanLogEntry = {
  id: string;
  at: number;
  code: string;
  ok: boolean;
  message: string;
  consumable?: Consumable;
  newQty?: number;
};

/** Ignore duplicate scans of the same code within this window. */
const DEDUPE_MS = 2200;

function playTone(kind: "ok" | "warn" | "err") {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    if (kind === "ok") {
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1175, now + 0.08);
    } else if (kind === "warn") {
      osc.frequency.setValueAtTime(520, now);
    } else {
      osc.frequency.setValueAtTime(220, now);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.start(now);
    osc.stop(now + 0.24);
    window.setTimeout(() => void ctx.close(), 400);
  } catch {
    /* audio optional */
  }
}

export function ScanPage({ onToast }: { onToast: ToastFn }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const busyRef = useRef(false);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [log, setLog] = useState<ScanLogEntry[]>([]);

  const focusInput = useCallback(() => {
    window.setTimeout(() => inputRef.current?.focus(), 40);
  }, []);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  const pushLog = useCallback((entry: Omit<ScanLogEntry, "id" | "at">) => {
    const row: ScanLogEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
    };
    setLog((prev) => [row, ...prev].slice(0, 25));
  }, []);

  const processCode = useCallback(
    async (raw: string) => {
      const scanned = String(raw ?? "").trim();
      if (!scanned) return;
      if (busyRef.current) return;

      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.code === scanned && now - last.at < DEDUPE_MS) {
        return;
      }
      lastScanRef.current = { code: scanned, at: now };

      busyRef.current = true;
      setBusy(true);
      setLastError(null);

      try {
        const res = await api.post<ScanResult>("/api/scan", {
          code: scanned,
          note: "scanned",
        });
        setLastResult(res);
        playTone(res.out_of_stock || res.low_stock ? "warn" : "ok");
        onToast({
          title: `Used 1 ${res.consumable.unit}`,
          description: res.out_of_stock
            ? `${res.consumable.name} is now out of stock`
            : res.low_stock
              ? `${res.consumable.name} is at or below minimum · qty ${res.consumable.quantity}`
              : `${res.consumable.name} · qty ${res.consumable.quantity}`,
          variant: res.out_of_stock || res.low_stock ? "default" : "success",
        });
        pushLog({
          code: scanned,
          ok: true,
          message: `−1 → ${res.consumable.quantity} ${res.consumable.unit}`,
          consumable: res.consumable,
          newQty: res.consumable.quantity,
        });
      } catch (err) {
        setLastResult(null);
        const message =
          err instanceof Error ? err.message : "Scan failed";
        let tone: "warn" | "err" = "err";
        if (err instanceof ApiError && err.code === "OUT_OF_STOCK") {
          tone = "warn";
          const c = err.details?.consumable as Consumable | undefined;
          if (c) {
            setLastResult({
              ok: false,
              consumable: c,
              low_stock: true,
              out_of_stock: true,
              scanned,
            });
          }
        }
        playTone(tone);
        setLastError(message);
        onToast({
          title: "Scan not applied",
          description: message,
          variant: "destructive",
        });
        pushLog({
          code: scanned,
          ok: false,
          message,
          consumable:
            err instanceof ApiError
              ? (err.details?.consumable as Consumable | undefined)
              : undefined,
        });
      } finally {
        busyRef.current = false;
        setBusy(false);
        setCode("");
        focusInput();
      }
    },
    [focusInput, onToast, pushLog],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void processCode(code);
  };

  /** Many USB scanners append Enter after the code. */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void processCode(code);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <BlurFade delay={0.04}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Scan to use</h2>
            <p className="text-sm text-muted-foreground">
              Point a USB barcode / QR scanner at a printed asset tag. Each scan
              subtracts <strong>1</strong> from stock automatically.
            </p>
          </div>
          <Badge variant="secondary" className="w-fit gap-1">
            <ScanLine className="h-3.5 w-3.5" />
            Scanner ready
          </Badge>
        </div>
      </BlurFade>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Keyboard className="h-4 w-4 text-primary" />
              USB scanner input
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="scan-code">Scan or type asset tag / SKU</Label>
                <div className="flex gap-2">
                  <Input
                    id="scan-code"
                    ref={inputRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Scan label here…"
                    autoComplete="off"
                    autoFocus
                    disabled={busy}
                    className="font-mono text-base"
                  />
                  <Button type="submit" disabled={busy || !code.trim()}>
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Use 1"
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Keep this field focused. Most USB scanners type the code and
                  press Enter automatically.
                </p>
              </div>
            </form>

            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              <ol className="list-decimal space-y-1.5 pl-4">
                <li>Click the input box above (it should stay focused).</li>
                <li>Scan the QR / barcode on the printed consumable tag.</li>
                <li>Stock drops by 1 and a history entry is logged as “scan”.</li>
              </ol>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Last result</CardTitle>
          </CardHeader>
          <CardContent>
            {busy ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Applying scan…
              </div>
            ) : lastResult?.consumable ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Package className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-tight">
                      {lastResult.consumable.name}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {lastResult.consumable.sku}
                      {lastResult.consumable.asset_tag
                        ? ` · ${lastResult.consumable.asset_tag}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-2xl font-semibold tabular-nums">
                    {lastResult.consumable.quantity}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {lastResult.consumable.unit}
                  </span>
                  <StockBadge
                    quantity={lastResult.consumable.quantity}
                    minLevel={lastResult.consumable.min_level}
                  />
                </div>
                {lastResult.ok !== false ? (
                  <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Subtracted 1
                    {lastResult.previous_quantity != null
                      ? ` (${lastResult.previous_quantity} → ${lastResult.new_quantity})`
                      : ""}
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" />
                    Already out of stock
                  </p>
                )}
                {lastResult.consumable.bin_location ? (
                  <p className="text-xs text-muted-foreground">
                    Bin {lastResult.consumable.bin_location}
                  </p>
                ) : null}
              </div>
            ) : lastError ? (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{lastError}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Scan a tag to decrement stock. Results show here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent scans</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {log.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No scans yet this session.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {log.map((row) => (
                <li
                  key={row.id}
                  className="flex items-start justify-between gap-3 px-6 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">
                      {row.consumable?.name ?? "Unknown item"}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {row.code}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={cn(
                        "text-xs font-medium",
                        row.ok
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive",
                      )}
                    >
                      {row.message}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {new Date(row.at).toLocaleTimeString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
