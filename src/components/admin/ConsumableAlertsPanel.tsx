import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Download,
  ExternalLink,
  GripVertical,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Settings2,
} from "lucide-react";
import {
  api,
  isSetupRequiredError,
  parseConsumablesAlertsStatus,
  type Consumable,
  type ConsumablesAlertSettings,
  type ConsumablesAlertsRunResult,
  type ConsumablesAlertsStatus,
  type ConsumablesAlertSkuRow,
} from "@/lib/api";
import { previewAlertTicket } from "@/lib/alert-ticket-preview";
import {
  ALERT_TEMPLATE_PIECES,
  DEFAULT_ALERT_TEMPLATE_VALUES,
  getAlertTemplatePiece,
  type AlertTemplatePieceField,
  type AlertTemplatePieceId,
} from "@/lib/alert-template-pieces";
import { downloadRestockReport } from "@/lib/restock-report";
import { downloadCurrentStockReport } from "@/lib/current-stock-report";
import { SetupRequiredBanner } from "@/components/SetupRequiredBanner";
import { SkuStockBarChart } from "@/components/admin/SkuStockBarChart";
import { StockStatusDonutChart } from "@/components/admin/StockStatusDonutChart";
import { TicketHistoryList } from "@/components/admin/TicketHistoryList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

type ToastFn = (t: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
}) => void;

const WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "7", label: "Sunday" },
];

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label:
    h === 0
      ? "12:00 am"
      : h < 12
        ? `${h}:00 am`
        : h === 12
          ? "12:00 pm"
          : `${h - 12}:00 pm`,
}));

type FilterKey = "all" | "attention" | ConsumablesAlertSkuRow["status"];
type TemplateValues = Record<AlertTemplatePieceField, string>;

const SETTINGS_SHEET_MIN_W = 360;
const SETTINGS_SHEET_DEFAULT_W = 512;
/** Matches AppShell desktop sidebar `w-64` — panel can grow up to that edge. */
const APP_NAVBAR_W = 256;
const MD_BREAKPOINT = 768;

function templatesFromSettings(s: ConsumablesAlertSettings): TemplateValues {
  const next = { ...DEFAULT_ALERT_TEMPLATE_VALUES };
  const legacyDefaults: Partial<Record<AlertTemplatePieceField, string[]>> = {
    jira_summary_template: [
      "Consumables weekly inventory {{week}}: {{out_count}} out, {{below_count}} below min, {{approaching_count}} approaching, {{good_count}} good",
    ],
    jira_intro_template: [
      "Summary: {{out_count}} out of stock · {{below_count}} below minimum · {{approaching_count}} approaching · {{good_count}} good ({{total}} active items){{order_summary_clause}}",
    ],
    jira_section_heading_template: ["## {{title}} ({{count}})"],
    jira_item_line_template: [
      "- {{name}}{{sku_part}}: {{qty}} {{unit}} on hand (min {{min}}){{order_part}}{{bin_part}}",
    ],
    jira_footer_template: [
      "Order total: {{order_total}} units to reach restock target (min × 2).",
      "Total additional quantity to order now: {{order_total}} units, after subtracting on-order stock (min × 2 target).",
    ],
  };
  for (const piece of ALERT_TEMPLATE_PIECES) {
    const raw = s[piece.field];
    const value = typeof raw === "string" ? raw.trim() : "";
    const isLegacyDefault = legacyDefaults[piece.field]?.includes(value) ?? false;
    next[piece.field] =
      value && !isLegacyDefault
        ? value
        : DEFAULT_ALERT_TEMPLATE_VALUES[piece.field];
  }
  return next;
}

export function ConsumableAlertsPanel({ onToast }: { onToast: ToastFn }) {
  const [status, setStatus] = useState<ConsumablesAlertsStatus | null>(null);
  const [settings, setSettings] = useState<ConsumablesAlertSettings | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [currentStockBusy, setCurrentStockBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheetWidth, setSheetWidth] = useState(SETTINGS_SHEET_DEFAULT_W);
  const resizeDragRef = useRef<{ startX: number; startW: number } | null>(
    null,
  );
  const [filter, setFilter] = useState<FilterKey>("attention");
  const [activePieceId, setActivePieceId] =
    useState<AlertTemplatePieceId>("intro");

  const clampSheetWidth = useCallback((w: number) => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    // Desktop: stop at the left navbar edge. Mobile: near full viewport.
    const reserved =
      vw >= MD_BREAKPOINT ? APP_NAVBAR_W : 16;
    const max = Math.max(SETTINGS_SHEET_MIN_W, vw - reserved);
    return Math.max(SETTINGS_SHEET_MIN_W, Math.min(max, Math.round(w)));
  }, []);

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resizeDragRef.current = { startX: e.clientX, startW: sheetWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    // Right-side sheet: drag handle leftward (smaller clientX) → wider panel
    const next = drag.startW + (drag.startX - e.clientX);
    setSheetWidth(clampSheetWidth(next));
  };

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeDragRef.current) return;
    resizeDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  useEffect(() => {
    if (!settingsOpen) return;
    const onWinResize = () => {
      setSheetWidth((w) => clampSheetWidth(w));
    };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, [settingsOpen, clampSheetWidth]);

  const [ratio, setRatio] = useState("1.25");
  const [weeklyEnabled, setWeeklyEnabled] = useState(true);
  const [incOut, setIncOut] = useState(true);
  const [incBelow, setIncBelow] = useState(true);
  const [incApproach, setIncApproach] = useState(true);

  const [weekday, setWeekday] = useState("1");
  const [hour, setHour] = useState("8");
  const [slackChannel, setSlackChannel] = useState("");
  const [slackPing, setSlackPing] = useState("");
  const [jiraProject, setJiraProject] = useState("");
  const [jiraIssueType, setJiraIssueType] = useState("");
  const [templates, setTemplates] = useState<TemplateValues>(
    () => ({ ...DEFAULT_ALERT_TEMPLATE_VALUES }),
  );

  const applySettingsDraft = useCallback((s: ConsumablesAlertSettings) => {
    setSettings(s);
    setRatio(String(s.approaching_ratio ?? 1.25));
    setWeeklyEnabled(s.weekly_enabled !== false);
    setIncOut(s.include_out_of_stock !== false);
    setIncBelow(s.include_below_minimum !== false);
    setIncApproach(s.include_approaching !== false);

    setWeekday(String(s.schedule_weekday ?? 1));
    setHour(String(s.schedule_hour_mst ?? 8));
    setSlackChannel(s.slack_channel_id ?? "");
    setSlackPing(s.slack_ping_user_id ?? "");
    setJiraProject(s.jira_project_key ?? "");
    setJiraIssueType(s.jira_issue_type ?? "");
    setTemplates(templatesFromSettings(s));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rawStatus, settingsData] = await Promise.all([
        api
          .get<unknown>("/api/consumables-alerts/status")
          .then(parseConsumablesAlertsStatus),
        api.get<ConsumablesAlertSettings>("/api/consumables-alerts/settings"),
      ]);
      setStatus(rawStatus);
      applySettingsDraft(settingsData);
      if (rawStatus?.settings) {
        applySettingsDraft({ ...settingsData, ...rawStatus.settings });
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error("Unknown error");
      setError(e);
      if (!isSetupRequiredError(e)) {
        onToast({
          title: "Could not load alerts",
          description: e.message,
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [applySettingsDraft, onToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = status?.items ?? [];
  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "attention") {
      return items.filter((i) => i.status !== "good");
    }
    return items.filter((i) => i.status === filter);
  }, [filter, items]);

  const runWeeklyAlerts = async () => {
    setRunning(true);
    try {
      const result = await api.post<ConsumablesAlertsRunResult>(
        "/api/consumables-alerts/run",
        {
          dry_run: status?.integrations?.dry_run ? true : undefined,
          force: Boolean(status?.locked),
        },
      );
      if (result.skipped) {
        onToast({
          title:
            result.reason === "weekly_disabled"
              ? "Weekly auto-run is off"
              : "Weekly report already sent",
          description: `${result.weekKey} · ${result.reason}`,
        });
      } else if (result.dryRun) {
        onToast({
          title: "Dry-run weekly report — Slack not posted",
          description: result.issue?.url
            ? `Fake Jira ${result.issue.key} · ${result.counts?.out_of_stock ?? 0} out / ${result.counts?.below_minimum ?? 0} below`
            : result.weekKey,
        });
      } else {
        onToast({
          title: "Weekly report sent — Slack posted",
          description: result.issue?.url
            ? `${result.issue.key} · ${result.counts?.out_of_stock ?? 0} out / ${result.counts?.below_minimum ?? 0} below`
            : result.weekKey,
          variant: "success",
        });
      }
      await load();
    } catch (err) {
      onToast({
        title: "Weekly report failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.patch<ConsumablesAlertSettings>(
        "/api/consumables-alerts/settings",
        {
          approaching_ratio: Number(ratio),
          weekly_enabled: weeklyEnabled,
          include_out_of_stock: incOut,
          include_below_minimum: incBelow,
          include_approaching: incApproach,
          include_good: false,
          schedule_weekday: Number(weekday),
          schedule_hour_mst: Number(hour),
          slack_channel_id: slackChannel,
          slack_ping_user_id: slackPing,
          jira_project_key: jiraProject,
          jira_issue_type: jiraIssueType,
          ...templates,
        },
      );
      applySettingsDraft(updated);
      onToast({ title: "Alert settings saved", variant: "success" });
      await load();
    } catch (err) {
      onToast({
        title: "Could not save settings",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const downloadRestockCsv = async () => {
    setReportBusy(true);
    try {
      const list =
        (status?.items?.length ?? 0) > 0
          ? status!.items!
          : await api.get<Consumable[]>("/api/consumables");
      const result = downloadRestockReport(list);
      if (result.count === 0) {
        onToast({
          title: "Nothing to restock",
          description: "All items are above their minimum levels.",
        });
        return;
      }
      onToast({
        title: "Restock report downloaded",
        description: `${result.count} item${result.count === 1 ? "" : "s"} · ${result.totalNeeded} units to order`,
        variant: "success",
      });
    } catch (err) {
      onToast({
        title: "Report failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setReportBusy(false);
    }
  };

  const downloadCurrentStockCsv = async () => {
    setCurrentStockBusy(true);
    try {
      const inventory = await api.get<Consumable[]>(
        "/api/consumables?status=active",
      );
      const alertRows = new Map(
        (status?.items ?? []).map((item) => [item.id, item]),
      );
      const reportItems = inventory.map((item) => {
        const alertItem = alertRows.get(item.id);
        return {
          ...item,
          quantity_on_order: alertItem?.quantity_on_order ?? null,
          stock_status: alertItem?.status ?? null,
        };
      });
      const result = downloadCurrentStockReport(reportItems);
      onToast({
        title: "Current stock report downloaded",
        description: `${result.count} active item${result.count === 1 ? "" : "s"} included`,
        variant: "success",
      });
    } catch (err) {
      onToast({
        title: "Current stock report failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCurrentStockBusy(false);
    }
  };

  const setupRequired = isSetupRequiredError(error);
  const counts = status?.counts;
  const unitsToOrder = counts?.units_to_order ?? 0;
  const skusToOrder = counts?.skus_to_order ?? 0;

  const activePiece = getAlertTemplatePiece(activePieceId);
  const activeValue = templates[activePiece.field];

  const ticketPreview = useMemo(() => {
    if (!status?.items?.length && !status?.week_key) return null;
    return previewAlertTicket({
      weekKey: status?.week_key || "YYYY-Www",
      items: status?.items ?? [],
      draft: {
        include_out_of_stock: incOut,
        include_below_minimum: incBelow,
        include_approaching: incApproach,
        include_good: false,
        ...templates,
      },
    });
  }, [
    status?.week_key,
    status?.items,
    incOut,
    incBelow,
    incApproach,

    templates,
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">
            Consumable alerts
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Weekly stock report and alert settings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            Settings
          </Button>
        </div>
      </div>

      {setupRequired && error ? (
        <SetupRequiredBanner error={error} onRetry={() => void load()} />
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base font-semibold">
              Weekly report
            </CardTitle>
            {loading && !status ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : status ? (
              <p className="text-xs text-muted-foreground">
                {status.week_key} · {status.schedule}
                {status.integrations?.dry_run ? (
                  <Badge variant="secondary" className="ml-2">
                    Dry-run
                  </Badge>
                ) : null}
                {settings && !settings.weekly_enabled ? (
                  <Badge variant="secondary" className="ml-2">
                    Auto-run off
                  </Badge>
                ) : null}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Status unavailable.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status?.batch?.jira_issue_url ? (
              <a
                href={status.batch.jira_issue_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {status.batch.jira_issue_key || "Jira ticket"}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void downloadRestockCsv()}
              disabled={reportBusy || currentStockBusy || setupRequired || loading}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {reportBusy ? "Preparing…" : "Restock CSV"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void downloadCurrentStockCsv()}
              disabled={currentStockBusy || reportBusy || setupRequired || loading}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {currentStockBusy ? "Preparing…" : "Current Stock CSV"}
            </Button>
            <Button
              size="sm"
              onClick={() => void runWeeklyAlerts()}
              disabled={running || setupRequired || !status}
            >
              {running ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {status?.locked ? "Re-run weekly report" : "Run weekly report now"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(unitsToOrder > 0 || skusToOrder > 0) && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="font-medium">Order </span>
              <span className="tabular-nums font-semibold">{unitsToOrder}</span>
              <span className="text-muted-foreground">
                {" "}
                units across {skusToOrder} SKU
                {skusToOrder === 1 ? "" : "s"} to reach restock target
              </span>
            </div>
          )}
          <StockStatusDonutChart
            counts={{
              out_of_stock: counts?.out_of_stock ?? 0,
              below_minimum: counts?.below_minimum ?? 0,
              approaching: counts?.approaching ?? 0,
              good: counts?.good ?? 0,
            }}
          />
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Ticket history
            </p>
            <TicketHistoryList
              countSuffix="SKUs"
              rows={(status?.history ?? []).map((b) => ({
                id: b.id,
                period: b.week_key,
                status: b.status,
                jira_issue_key: b.jira_issue_key,
                jira_issue_url: b.jira_issue_url,
                dry_run: b.dry_run,
                line_or_item_count: b.item_count,
                submitted_at: b.submitted_at,
              }))}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold tracking-tight">
              Per-SKU stock
            </h4>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["attention", "Needs attention"],
                ["all", "All"],
                ["out_of_stock", "Out"],
                ["below_minimum", "Below"],
                ["approaching", "Approaching"],
                ["good", "Good"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={filter === key ? "secondary" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setFilter(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-lg bg-muted"
              />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No SKUs in this filter.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => (
              <SkuStockBarChart key={item.id || item.sku} item={item} />
            ))}
          </div>
        )}
      </div>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent
          side="right"
          className="flex w-full max-w-none flex-col gap-0 p-0 sm:max-w-none"
          style={{ width: sheetWidth }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize settings panel"
            title="Drag to resize"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            onPointerCancel={onResizePointerUp}
            className="absolute inset-y-0 left-0 z-20 flex w-3 cursor-col-resize items-center justify-center border-r border-transparent hover:border-border hover:bg-muted/60 active:bg-muted"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground/70" />
          </div>

          <SheetHeader className="border-b border-border px-4 py-4 pl-5 text-left">
            <SheetTitle>Alert settings</SheetTitle>
            <SheetDescription>
              Schedule, sections, routing, and Jira ticket templates. Drag the
              left edge to widen.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            <form
              id="alert-settings-form"
              onSubmit={(e) => void saveSettings(e)}
              className="space-y-5 px-4 py-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="alert-ratio">Approaching ratio</Label>
                  <Input
                    id="alert-ratio"
                    type="number"
                    step="0.01"
                    min="1.01"
                    max="3"
                    value={ratio}
                    onChange={(e) => setRatio(e.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={weeklyEnabled}
                      onChange={(e) => setWeeklyEnabled(e.target.checked)}
                    />
                    Enable weekly auto-run (cron)
                  </label>
                </div>
                <div className="space-y-2">
                  <Label>Schedule day (MST)</Label>
                  <Select value={weekday} onValueChange={setWeekday}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Weekday" />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((d) => (
                        <SelectItem key={d.value} value={d.value}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Schedule hour (MST)</Label>
                  <Select value={hour} onValueChange={setHour}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Hour" />
                    </SelectTrigger>
                    <SelectContent>
                      {HOURS.map((h) => (
                        <SelectItem key={h.value} value={h.value}>
                          {h.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Report sections</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["Out of stock", incOut, setIncOut],
                      ["Below minimum", incBelow, setIncBelow],
                      ["Approaching", incApproach, setIncApproach],
                    ] as const
                  ).map(([label, checked, setChecked]) => (
                    <label
                      key={label}
                      className="flex items-center gap-2 rounded-md border border-border/80 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Jira ticket templates</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pick a template by ID, then edit it in the single field
                    below.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="alert-template-piece">Template</Label>
                  <Select
                    value={activePieceId}
                    onValueChange={(v) =>
                      setActivePieceId(v as AlertTemplatePieceId)
                    }
                  >
                    <SelectTrigger id="alert-template-piece" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALERT_TEMPLATE_PIECES.map((piece) => (
                        <SelectItem key={piece.id} value={piece.id}>
                          <span className="font-mono text-xs text-muted-foreground">
                            {piece.id}
                          </span>
                          <span className="ml-2">{piece.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    id: <span className="font-mono">{activePiece.id}</span>
                    {activePiece.isDescription
                      ? " · description piece"
                      : " · issue title"}
                    {" · "}
                    {activePiece.hint}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="alert-template-body">
                    {activePiece.isDescription
                      ? "Ticket description"
                      : "Issue summary"}
                  </Label>
                  <Textarea
                    id="alert-template-body"
                    rows={activePiece.rows}
                    value={activeValue}
                    onChange={(e) =>
                      setTemplates((prev) => ({
                        ...prev,
                        [activePiece.field]: e.target.value,
                      }))
                    }
                    className="font-mono text-xs"
                  />
                </div>

                {ticketPreview ? (
                  <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Live preview (current stock)
                    </p>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Issue summary
                      </p>
                      <p className="text-sm font-medium leading-snug">
                        {ticketPreview.summary || "(empty)"}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Description
                      </p>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-xs leading-relaxed">
                        {ticketPreview.description || "(empty)"}
                      </pre>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="alert-channel">Slack channel ID</Label>
                  <Input
                    id="alert-channel"
                    placeholder={settings?.resolved?.slackChannelId || "C…"}
                    value={slackChannel}
                    onChange={(e) => setSlackChannel(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="alert-ping">Slack ping user ID</Label>
                  <Input
                    id="alert-ping"
                    placeholder={settings?.resolved?.slackPingUserId || "U…"}
                    value={slackPing}
                    onChange={(e) => setSlackPing(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="alert-project">Jira project key</Label>
                  <Input
                    id="alert-project"
                    placeholder={settings?.resolved?.jiraProjectKey || "WH"}
                    value={jiraProject}
                    onChange={(e) => setJiraProject(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="alert-type">Jira issue type</Label>
                  <Input
                    id="alert-type"
                    placeholder={settings?.resolved?.jiraIssueType || "Task"}
                    value={jiraIssueType}
                    onChange={(e) => setJiraIssueType(e.target.value)}
                  />
                </div>
              </div>
            </form>
          </ScrollArea>

          <SheetFooter className="border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSettingsOpen(false)}
            >
              Close
            </Button>
            <Button
              type="submit"
              form="alert-settings-form"
              disabled={saving || setupRequired}
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              Save settings
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
