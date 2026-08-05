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
  ChevronDown,
  Keyboard,
  Loader2,
  Minus,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  amount?: number;
  consumable?: Consumable;
  newQty?: number;
};

/** Ignore duplicate scans of the same code within this window. */
const DEDUPE_MS = 2200;

const USE_PRESETS = [1, 10, 20] as const;

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
  /** Always-current amount so scanner submit doesn't use a stale closure. */
  const amountRef = useRef(1);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [log, setLog] = useState<ScanLogEntry[]>([]);

  /** Amount applied on the next scan. Default Use 1. */
  const [useAmount, setUseAmount] = useState(1);
  const [customOpen, setCustomOpen] = useState(false);
  const [customQty, setCustomQty] = useState("5");

  useEffect(() => {
    amountRef.current = useAmount;
  }, [useAmount]);

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

  const selectAmount = useCallback(
    (n: number) => {
      const amount = Math.max(1, Math.trunc(n) || 1);
      setUseAmount(amount);
      amountRef.current = amount;
      focusInput();
    },
    [focusInput],
  );

  const applyCustomAmount = () => {
    const n = Math.abs(Math.trunc(Number(customQty) || 0));
    if (!n) {
      onToast({ title: "Enter a quantity of at least 1", variant: "destructive" });
      return;
    }
    selectAmount(n);
    setCustomOpen(false);
    onToast({
      title: `Next scan will use ${n}`,
      description: "Scan a label to subtract this amount.",
      variant: "success",
    });
  };

  const processCode = useCallback(
    async (raw: string) => {
      const scanned = String(raw ?? "").trim();
      if (!scanned) return;
      if (busyRef.current) return;

      const amount = Math.max(1, Math.trunc(amountRef.current) || 1);

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
          amount,
          note: amount === 1 ? "scanned" : `scanned ×${amount}`,
        });
        setLastResult(res);
        const used = res.amount ?? amount;
        playTone(res.out_of_stock || res.low_stock || res.capped ? "warn" : "ok");
        onToast({
          title: `Used ${used} ${res.consumable.unit}`,
          description: res.capped
            ? `Only ${used} on hand (requested ${res.requested_amount}) · qty ${res.consumable.quantity}`
            : res.out_of_stock
              ? `${res.consumable.name} is now out of stock`
              : res.low_stock
                ? `${res.consumable.name} is at or below minimum · qty ${res.consumable.quantity}`
                : `${res.consumable.name} · qty ${res.consumable.quantity}`,
          variant:
            res.out_of_stock || res.low_stock || res.capped
              ? "default"
              : "success",
        });
        pushLog({
          code: scanned,
          ok: true,
          amount: used,
          message: `−${used} → ${res.consumable.quantity} ${res.consumable.unit}`,
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
              amount,
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
          amount,
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

  const amountLabel = `Use ${useAmount}`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <BlurFade delay={0.04}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Scan to use</h2>
            <p className="text-sm text-muted-foreground">
              Choose how many to take, then scan a printed asset tag. Each scan
              subtracts the selected amount.
            </p>
          </div>
          <Badge variant="secondary" className="w-fit gap-1">
            <ScanLine className="h-3.5 w-3.5" />
            Next scan: −{useAmount}
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
            <div className="space-y-1.5">
              <Label>Amount per scan</Label>
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-w-[8.5rem] justify-between"
                      disabled={busy}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Minus className="h-3.5 w-3.5" />
                        {amountLabel}
                      </span>
                      <ChevronDown className="ml-2 h-3.5 w-3.5 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {USE_PRESETS.map((n) => (
                      <DropdownMenuItem
                        key={n}
                        onClick={() => selectAmount(n)}
                        className={cn(useAmount === n && "bg-accent")}
                      >
                        Use {n}
                        {useAmount === n ? (
                          <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-primary" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                    {!USE_PRESETS.includes(useAmount as (typeof USE_PRESETS)[number]) ? (
                      <DropdownMenuItem
                        onClick={() => selectAmount(useAmount)}
                        className="bg-accent"
                      >
                        Use {useAmount}
                        <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-primary" />
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setCustomQty(String(useAmount > 1 ? useAmount : 5));
                        setCustomOpen(true);
                      }}
                    >
                      Use custom amount…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {useAmount !== 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => selectAmount(1)}
                    disabled={busy}
                  >
                    Reset to 1
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Defaults to <strong>Use 1</strong>. Pick 10, 20, or custom before
                scanning a bulk pick — the amount stays selected until you change it.
              </p>
            </div>

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
                      amountLabel
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Keep this field focused. Most USB scanners type the code and
                  press Enter — stock updates automatically by{" "}
                  <strong>−{useAmount}</strong>.
                </p>
              </div>
            </form>

            {lastError ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{lastError}</span>
              </div>
            ) : null}

            {lastResult?.consumable ? (
              <div
                className={cn(
                  "rounded-xl border p-4",
                  lastResult.out_of_stock
                    ? "border-destructive/40 bg-destructive/5"
                    : lastResult.low_stock
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-emerald-500/30 bg-emerald-500/5",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Last scan
                    </p>
                    <p className="mt-1 truncate text-base font-semibold">
                      {lastResult.consumable.name}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {lastResult.consumable.asset_tag || lastResult.consumable.sku}
                      {lastResult.scanned &&
                      lastResult.scanned !== lastResult.consumable.asset_tag
                        ? ` · scanned “${lastResult.scanned}”`
                        : ""}
                    </p>
                  </div>
                  {lastResult.ok !== false ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono tabular-nums">
                    −{lastResult.amount ?? useAmount}{" "}
                    {lastResult.consumable.unit}
                  </Badge>
                  {lastResult.capped ? (
                    <Badge variant="secondary">Capped to on-hand</Badge>
                  ) : null}
                  <span className="text-sm text-muted-foreground">New qty</span>
                  <span className="font-mono text-lg font-semibold tabular-nums">
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
                {lastResult.consumable.bin_location ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Bin {lastResult.consumable.bin_location}
                    {lastResult.consumable.category
                      ? ` · ${lastResult.consumable.category}`
                      : ""}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-10 text-center">
                <Package className="h-8 w-8 text-muted-foreground/70" />
                <p className="text-sm font-medium">Waiting for a scan</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Set the amount (default Use 1), then scan a consumable QR /
                  barcode. History logs each scan.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent scans</CardTitle>
          </CardHeader>
          <CardContent>
            {log.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No scans yet this session.
              </p>
            ) : (
              <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {log.map((row) => (
                  <li
                    key={row.id}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm",
                      row.ok
                        ? "border-border bg-card"
                        : "border-destructive/30 bg-destructive/5",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {row.consumable?.name || row.code}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {row.code}
                          {row.amount != null ? ` · −${row.amount}` : ""}
                        </p>
                      </div>
                      {row.ok ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                      )}
                    </div>
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        row.ok ? "text-muted-foreground" : "text-destructive",
                      )}
                    >
                      {row.message}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {new Date(row.at).toLocaleTimeString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={customOpen}
        onOpenChange={(open) => {
          setCustomOpen(open);
          if (!open) focusInput();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Custom amount per scan</DialogTitle>
            <DialogDescription>
              Every scan will subtract this many until you change it again.
              Defaults back is always available via <strong>Use 1</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="scan-custom-qty">Quantity</Label>
              <Input
                id="scan-custom-qty"
                type="number"
                min={1}
                value={customQty}
                onChange={(e) => setCustomQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyCustomAmount();
                  }
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCustomOpen(false);
                focusInput();
              }}
            >
              Cancel
            </Button>
            <Button onClick={applyCustomAmount}>Set amount</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
