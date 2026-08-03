import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Keyboard,
  Loader2,
  Package,
  ScanLine,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
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

const CAMERA_REGION_ID = "stocktag-qr-reader";
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
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [log, setLog] = useState<ScanLogEntry[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processRef = useRef<(code: string) => Promise<void>>(async () => {});

  const pushLog = useCallback((entry: Omit<ScanLogEntry, "id" | "at">) => {
    setLog((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          at: Date.now(),
          ...entry,
        },
        ...prev,
      ].slice(0, 25),
    );
  }, []);

  const processScan = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code) return;

      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.code === code && now - last.at < DEDUPE_MS) {
        return;
      }
      if (busyRef.current) return;

      lastScanRef.current = { code, at: now };
      busyRef.current = true;
      setBusy(true);
      setLastError(null);

      try {
        const res = await api.post<ScanResult>("/api/scan", {
          code,
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
          variant:
            res.out_of_stock || res.low_stock ? "default" : "success",
        });
        pushLog({
          code,
          ok: true,
          message: res.out_of_stock
            ? "Out of stock"
            : res.low_stock
              ? "Low stock"
              : "Decremented",
          consumable: res.consumable,
          newQty: res.consumable.quantity,
        });
      } catch (err) {
        setLastResult(null);
        let message = "Scan failed";
        let failedItem: Consumable | undefined;
        if (err instanceof ApiError) {
          message = err.message;
          failedItem = (err.details as { consumable?: Consumable } | undefined)
            ?.consumable;
          if (err.code === "OUT_OF_STOCK") playTone("warn");
          else playTone("err");
        } else if (err instanceof Error) {
          message = err.message;
          playTone("err");
        } else {
          playTone("err");
        }
        setLastError(message);
        onToast({
          title: "Scan not applied",
          description: message,
          variant: "destructive",
        });
        pushLog({
          code,
          ok: false,
          message,
          consumable: failedItem,
          newQty: failedItem?.quantity,
        });
      } finally {
        busyRef.current = false;
        setBusy(false);
        setManualCode("");
        // Keep keyboard / USB scanner ready
        window.setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [onToast, pushLog],
  );

  // Keep ref current for camera callback (avoids stale closure / restart loops)
  useEffect(() => {
    processRef.current = processScan;
  }, [processScan]);

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) {
      setCameraOn(false);
      return;
    }
    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      scanner.clear();
    } catch {
      /* ignore stop races */
    }
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      // Ensure DOM node exists
      await new Promise((r) => window.setTimeout(r, 30));
      if (scannerRef.current) {
        await stopCamera();
        await new Promise((r) => window.setTimeout(r, 30));
      }
      const scanner = new Html5Qrcode(CAMERA_REGION_ID, {
        verbose: false,
      });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 8,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const edge = Math.floor(
              Math.min(viewfinderWidth, viewfinderHeight) * 0.72,
            );
            return { width: edge, height: edge };
          },
          aspectRatio: 1.333,
        },
        (decodedText) => {
          void processRef.current(decodedText);
        },
        () => {
          /* frame miss — ignore */
        },
      );
      setCameraOn(true);
    } catch (err) {
      scannerRef.current = null;
      setCameraOn(false);
      const msg =
        err instanceof Error
          ? err.message
          : "Could not start camera. Check browser permissions.";
      setCameraError(msg);
      onToast({
        title: "Camera unavailable",
        description:
          "Allow camera access, or use a USB barcode scanner / type the code.",
        variant: "destructive",
      });
    }
  }, [onToast, stopCamera]);

  useEffect(() => {
    return () => {
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        scanner
          .stop()
          .catch(() => undefined)
          .finally(() => {
            try {
              scanner.clear();
            } catch {
              /* ignore */
            }
          });
      }
    };
  }, []);

  // Focus hidden-friendly input for USB wedge scanners on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    void processScan(manualCode);
  };

  // USB scanners often blast keys then Enter — handle Enter in the field
  const onManualKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void processScan(manualCode);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <BlurFade delay={0.04}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Scan to use</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Scan a consumable QR / barcode or type the asset tag. Each scan
              subtracts <strong className="text-foreground">1</strong> from
              stock immediately.
            </p>
          </div>
          <Badge variant="secondary" className="w-fit gap-1.5">
            <ScanLine className="h-3.5 w-3.5" />
            Ready
          </Badge>
        </div>
      </BlurFade>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Keyboard className="h-4 w-4 text-primary" />
              Scanner / manual entry
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={onManualSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="scan-code">Asset tag or SKU</Label>
                <Input
                  ref={inputRef}
                  id="scan-code"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  onKeyDown={onManualKeyDown}
                  placeholder="Scan here or type AST-…"
                  autoComplete="off"
                  autoFocus
                  disabled={busy}
                  className="h-12 font-mono text-base"
                />
                <p className="text-xs text-muted-foreground">
                  USB barcode scanners work like a keyboard — click this field,
                  then scan. Press Enter if needed.
                </p>
              </div>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={busy || !manualCode.trim()}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating…
                  </>
                ) : (
                  <>
                    <Package className="mr-2 h-4 w-4" />
                    Use 1
                  </>
                )}
              </Button>
            </form>

            <div className="border-t border-border pt-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Camera QR scanner</p>
                {cameraOn ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void stopCamera()}
                  >
                    <CameraOff className="mr-2 h-3.5 w-3.5" />
                    Stop camera
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void startCamera()}
                  >
                    <Camera className="mr-2 h-3.5 w-3.5" />
                    Start camera
                  </Button>
                )}
              </div>
              <div
                className={cn(
                  "relative overflow-hidden rounded-xl border border-border bg-muted/40",
                  !cameraOn && "min-h-[200px]",
                )}
              >
                <div
                  id={CAMERA_REGION_ID}
                  className={cn(
                    "w-full overflow-hidden rounded-xl [&_video]:rounded-xl",
                    !cameraOn && "hidden",
                  )}
                />
                {!cameraOn ? (
                  <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                    <Camera className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Start the camera to scan printed asset-tag QR codes.
                    </p>
                    {cameraError ? (
                      <p className="max-w-sm text-xs text-destructive">
                        {cameraError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Last scan</CardTitle>
          </CardHeader>
          <CardContent>
            {lastResult ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">
                      {lastResult.consumable.name}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {lastResult.consumable.asset_tag ||
                        lastResult.consumable.sku}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      New qty
                    </p>
                    <p className="font-mono text-lg font-semibold tabular-nums">
                      {lastResult.consumable.quantity}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {lastResult.consumable.unit}
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Status
                    </p>
                    <div className="mt-1">
                      <StockBadge
                        quantity={lastResult.consumable.quantity}
                        minLevel={lastResult.consumable.min_level}
                      />
                    </div>
                  </div>
                  {lastResult.consumable.bin_location ? (
                    <div className="col-span-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Bin
                      </p>
                      <p className="font-medium">
                        {lastResult.consumable.bin_location}
                      </p>
                    </div>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Scanned code:{" "}
                  <span className="font-mono text-foreground">
                    {lastResult.scanned}
                  </span>
                </p>
              </div>
            ) : lastError ? (
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <XCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">Not decremented</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {lastError}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <ScanLine className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Scan a tag to subtract one unit.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent scans</CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No scans yet this session.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {log.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    {entry.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {entry.consumable?.name ?? entry.code}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {entry.code}
                        {entry.ok && entry.newQty != null
                          ? ` · qty ${entry.newQty}`
                          : ` · ${entry.message}`}
                      </p>
                    </div>
                  </div>
                  <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {new Date(entry.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
