import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  Bell,
  Cable,
  ClipboardList,
  ExternalLink,
  Loader2,
  Play,
  Printer,
  RefreshCw,
  Save,
  Settings2,
  Shield,
  Sprout,
  Users,
} from "lucide-react";
import {
  api,
  isSetupRequiredError,
  parseConsumablesAlertsStatus,
  type ConsumablesAlertsStatus,
  type IntegrationTestResult,
  type ProcurementCloseResult,
  type ProcurementSettings,
  type ProcurementStatus,
} from "@/lib/api";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import {
  persistAdminTab,
  readPersistedAdminTab,
  type AdminTabId,
} from "@/lib/nav-persistence";
import { AccessManagementSection } from "@/components/admin/AccessManagementSection";
import { ConsumableAlertsPanel } from "@/components/admin/ConsumableAlertsPanel";
import { TicketHistoryList } from "@/components/admin/TicketHistoryList";
import { PrintersPage } from "@/components/pages/PrintersPage";
import { SetupRequiredBanner } from "@/components/SetupRequiredBanner";
import { BlurFade } from "@/components/ui/blur-fade";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type ToastFn = (t: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
}) => void;

type AdminTab = AdminTabId;

export function AdminPage({ onToast }: { onToast: ToastFn }) {
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const [tab, setTab] = useState<AdminTab>(() => readPersistedAdminTab("main"));

  useEffect(() => {
    // Don't persist DEV-only Local tab into non-dev sessions after refresh.
    if (tab === "local" && !import.meta.env.DEV) {
      setTab("main");
      return;
    }
    if (tab === "integrations") {
      setTab("main");
      return;
    }
    persistAdminTab(tab);
  }, [tab]);
  const [alertsStatus, setAlertsStatus] =
    useState<ConsumablesAlertsStatus | null>(null);
  const [procStatus, setProcStatus] = useState<ProcurementStatus | null>(null);
  const [settings, setSettings] = useState<ProcurementSettings | null>(null);
  const [opsLoading, setOpsLoading] = useState(true);
  const [opsError, setOpsError] = useState<Error | null>(null);
  const [closing, setClosing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [testingIntegrations, setTestingIntegrations] = useState(false);
  const [lastIntegrationTest, setLastIntegrationTest] =
    useState<IntegrationTestResult | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [summaryTpl, setSummaryTpl] = useState("");
  const [descTpl, setDescTpl] = useState("");
  const [slackChannel, setSlackChannel] = useState("");
  const [slackPing, setSlackPing] = useState("");
  const [jiraProject, setJiraProject] = useState("");
  const [jiraIssueType, setJiraIssueType] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);

  const loadOps = useCallback(async () => {
    setOpsLoading(true);
    setOpsError(null);
    try {
      const [alerts, statusData, settingsData] = await Promise.all([
        api
          .get<unknown>("/api/consumables-alerts/status")
          .then(parseConsumablesAlertsStatus)
          .catch(() => null),
        api.get<ProcurementStatus>("/api/procurement/status"),
        api.get<ProcurementSettings>("/api/procurement/settings"),
      ]);
      setAlertsStatus(alerts);
      setProcStatus(statusData);
      setSettings(settingsData);
      setSummaryTpl(settingsData.jira_summary_template ?? "");
      setDescTpl(settingsData.jira_description_template ?? "");
      setSlackChannel(settingsData.slack_channel_id ?? "");
      setSlackPing(settingsData.slack_ping_user_id ?? "");
      setJiraProject(settingsData.jira_project_key ?? "");
      setJiraIssueType(settingsData.jira_issue_type ?? "");
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error");
      setOpsError(error);
      if (!isSetupRequiredError(error)) {
        onToast({
          title: "Could not load admin tools",
          description: error.message,
          variant: "destructive",
        });
      }
    } finally {
      setOpsLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadOps();
  }, [isAdmin, loadOps]);

  const runIntegrationTest = async (
    mode: "auth" | "write",
    targets: "slack" | "jira" | "both" = "both",
    live = false,
  ) => {
    setTestingIntegrations(true);
    try {
      const result = await api.post<IntegrationTestResult>(
        "/api/integrations/test",
        {
          mode,
          targets,
          dry_run: live ? false : true,
        },
      );
      setLastIntegrationTest(result);
      if (result.ok) {
        onToast({
          title: result.dry_run
            ? "Integration dry-run OK"
            : mode === "write"
              ? "Live integration write OK"
              : "Live integration auth OK",
          description: result.message,
          variant: "success",
        });
      } else {
        onToast({
          title: "Integration test failed",
          description: result.message,
          variant: "destructive",
        });
      }
    } catch (err) {
      onToast({
        title: "Integration test failed",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setTestingIntegrations(false);
    }
  };

  const runClose = async () => {
    setClosing(true);
    try {
      // Do not force dry_run from the client — server resolves env / auto /
      // live so Admin cannot accidentally pin dry-run after .env changes.
      const result = await api.post<ProcurementCloseResult>(
        "/api/procurement/close",
        {},
      );
      if (result.skipped && result.reason === "no_orders") {
        onToast({
          title: "No orders today",
          description: "Close recorded; no Jira or Slack message.",
        });
      } else if (result.skipped && result.reason === "already_closed") {
        onToast({
          title: "Already closed",
          description: `Day ${result.dayKey} already submitted.`,
        });
      } else if (result.dryRun) {
        onToast({
          title: "Dry-run complete — Slack not posted",
          description:
            result.message ||
            `Mode dry-run (${result.dryRunReason ?? "env"}). Fake Jira ${result.issue?.key ?? "n/a"}. Set PROCUREMENT_DRY_RUN=false and configure Jira + Slack for a real post.`,
        });
      } else {
        onToast({
          title: result.slackPosted
            ? "Procurement closed — Slack posted"
            : "Procurement closed",
          description:
            result.message ||
            (result.issue?.url
              ? `Jira ${result.issue.key}`
              : `${result.lineCount ?? 0} lines submitted`),
          variant: "success",
        });
      }
      await loadOps();
    } catch (err) {
      onToast({
        title: "Close failed",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setClosing(false);
    }
  };

  async function saveTemplate(e: FormEvent) {
    e.preventDefault();
    setSavingTpl(true);
    try {
      const updated = await api.patch<ProcurementSettings>(
        "/api/procurement/settings",
        {
          jira_summary_template: summaryTpl,
          jira_description_template: descTpl,
          slack_channel_id: slackChannel,
          slack_ping_user_id: slackPing,
          jira_project_key: jiraProject,
          jira_issue_type: jiraIssueType,
        },
      );
      setSettings(updated);
      onToast({ title: "Template saved", variant: "success" });
      setTemplateOpen(false);
      await loadOps();
    } catch (err) {
      onToast({
        title: "Could not save settings",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setSavingTpl(false);
    }
  }

  const seed = async () => {
    setSeeding(true);
    try {
      const res = await api.post<{
        ok: boolean;
        skipped?: boolean;
        message?: string;
        consumables?: number;
        bins?: number;
        stock_orders?: number;
      }>("/api/seed", {});
      if (res.skipped) {
        onToast({
          title: "Already seeded",
          description: res.message,
        });
      } else {
        onToast({
          title: "Sample data loaded",
          description: `${res.consumables ?? 0} items, ${res.bins ?? 0} bins${
            res.stock_orders ? `, ${res.stock_orders} open orders` : ""
          }`,
          variant: "success",
        });
      }
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

  if (adminLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking admin access…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-border px-6 py-12 text-center">
        <Shield className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">Admin only</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You do not have administrator access. Ask an existing admin to grant
          the Admin role on your approved email.
        </p>
      </div>
    );
  }

  const setupRequired = isSetupRequiredError(opsError);
  const isDev = import.meta.env.DEV;
  const attentionCount =
    (alertsStatus?.counts?.out_of_stock ?? 0) +
    (alertsStatus?.counts?.below_minimum ?? 0) +
    (alertsStatus?.counts?.approaching ?? 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <BlurFade delay={0.04}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Administrator
            </h2>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadOps()}
            disabled={opsLoading}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </BlurFade>

      {setupRequired && opsError ? (
        <SetupRequiredBanner error={opsError} onRetry={() => void loadOps()} />
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as AdminTab)}
        className="gap-4"
      >
        <TabsList
          variant="line"
          className="h-auto w-full flex-wrap items-center justify-start gap-1 border-b border-border pb-0"
        >
          <TabsTrigger value="main" className="px-3">
            Main
          </TabsTrigger>
          <TabsTrigger value="access" className="px-3">
            Access
          </TabsTrigger>
          <TabsTrigger value="alerts" className="px-3">
            Alerts
          </TabsTrigger>
          <TabsTrigger value="procurement" className="px-3">
            Procurement
          </TabsTrigger>
          <TabsTrigger value="printers" className="px-3">
            Printers
          </TabsTrigger>
          {isDev ? (
            <TabsTrigger value="local" className="px-3">
              Local
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="main" className="mt-2 space-y-4">
          <BlurFade delay={0.06}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <CategoryNavCard
                icon={Users}
                title="Access"
                description="Approved emails and roles"
                onClick={() => setTab("access")}
              />
              <CategoryNavCard
                icon={Bell}
                title="Alerts"
                description={
                  alertsStatus
                    ? `${attentionCount} needing attention`
                    : "Weekly stock report"
                }
                badge={
                  alertsStatus?.locked
                    ? "Sent"
                    : alertsStatus?.settings &&
                        !alertsStatus.settings.weekly_enabled
                      ? "Off"
                      : undefined
                }
                onClick={() => setTab("alerts")}
              />
              <CategoryNavCard
                icon={ClipboardList}
                title="Procurement"
                description={
                  procStatus
                    ? `${procStatus.open_count} open · ${procStatus.day_key}`
                    : "Daily close"
                }
                badge={procStatus?.locked ? "Closed" : undefined}
                onClick={() => setTab("procurement")}
              />
              <CategoryNavCard
                icon={Printer}
                title="Printers"
                description="Ethernet label printers"
                onClick={() => setTab("printers")}
              />
              {isDev ? (
                <CategoryNavCard
                  icon={Sprout}
                  title="Local"
                  description="Sample data"
                  onClick={() => setTab("local")}
                />
              ) : null}
            </div>
          </BlurFade>

          <BlurFade delay={0.1}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Cable className="h-4 w-4 text-primary" />
                  Slack & Jira
                </CardTitle>
                {procStatus?.integrations.dry_run ? (
                  <p className="text-xs text-muted-foreground">
                    Dry-run
                    {procStatus.integrations.dry_run_reason
                      ? ` (${procStatus.integrations.dry_run_reason})`
                      : ""}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={testingIntegrations}
                    onClick={() =>
                      void runIntegrationTest("auth", "both", true)
                    }
                  >
                    {testingIntegrations ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Test auth
                  </Button>
                  <Button
                    size="sm"
                    disabled={testingIntegrations}
                    onClick={() =>
                      void runIntegrationTest("write", "both", true)
                    }
                  >
                    Test write
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={testingIntegrations}
                    onClick={() =>
                      void runIntegrationTest("write", "slack", true)
                    }
                  >
                    Slack
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={testingIntegrations}
                    onClick={() =>
                      void runIntegrationTest("write", "jira", true)
                    }
                  >
                    Jira
                  </Button>
                </div>
                {lastIntegrationTest ? (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
                    <p className="font-medium">
                      {lastIntegrationTest.ok ? "OK" : "Failed"}
                      {lastIntegrationTest.message
                        ? ` · ${lastIntegrationTest.message}`
                        : ""}
                    </p>
                    {lastIntegrationTest.slack?.error ? (
                      <p>Slack: {lastIntegrationTest.slack.error}</p>
                    ) : null}
                    {lastIntegrationTest.jira?.error ? (
                      <p>Jira: {lastIntegrationTest.jira.error}</p>
                    ) : null}
                    {lastIntegrationTest.jira?.issue?.url ? (
                      <a
                        href={lastIntegrationTest.jira.issue.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {lastIntegrationTest.jira.issue.key}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </BlurFade>
        </TabsContent>

        <TabsContent value="access" className="mt-2">
          <BlurFade delay={0.04}>
            <AccessManagementSection onToast={onToast} />
          </BlurFade>
        </TabsContent>

        <TabsContent value="alerts" className="mt-2">
          <BlurFade delay={0.04}>
            <ConsumableAlertsPanel onToast={onToast} />
          </BlurFade>
        </TabsContent>

        <TabsContent value="procurement" className="mt-2 space-y-4">
          <BlurFade delay={0.04}>
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-3">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-base font-semibold">
                    Daily close
                  </CardTitle>
                  {procStatus ? (
                    <p className="text-xs text-muted-foreground">
                      {procStatus.day_key} · {procStatus.open_count} open ·
                      Closes {procStatus.close_schedule ?? "2:30pm MST"}
                      {procStatus.locked ? (
                        <Badge className="ml-2">Closed</Badge>
                      ) : null}
                      {procStatus.batch?.jira_issue_url ? (
                        <>
                          {" · "}
                          <a
                            href={procStatus.batch.jira_issue_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            {procStatus.batch.jira_issue_key || "Jira"}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </>
                      ) : null}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {opsLoading ? "Loading…" : "Status unavailable."}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTemplateOpen(true)}
                    disabled={!settings}
                  >
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                    Jira template
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void runClose()}
                    disabled={
                      closing ||
                      setupRequired ||
                      !procStatus ||
                      procStatus.locked
                    }
                  >
                    {closing ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Run close now
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <p className="text-xs font-medium text-muted-foreground">
                  Ticket history
                </p>
                <TicketHistoryList
                  countSuffix="lines"
                  rows={(procStatus?.history ?? []).map((b) => ({
                    id: b.id,
                    period: b.day_key,
                    status: b.status,
                    jira_issue_key: b.jira_issue_key,
                    jira_issue_url: b.jira_issue_url,
                    dry_run: b.dry_run,
                    line_or_item_count: b.line_count,
                    submitted_at: b.submitted_at,
                  }))}
                />
              </CardContent>
            </Card>
          </BlurFade>
        </TabsContent>

        <TabsContent value="printers" className="mt-2">
          <BlurFade delay={0.04}>
            <PrintersPage onToast={onToast} embedded />
          </BlurFade>
        </TabsContent>

        {isDev ? (
          <TabsContent value="local" className="mt-2">
            <BlurFade delay={0.04}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <p className="text-sm font-medium">Sample data</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void seed()}
                    disabled={seeding || setupRequired}
                  >
                    <Sprout className="mr-2 h-3.5 w-3.5" />
                    {seeding ? "Seeding…" : "Load sample data"}
                  </Button>
                </CardContent>
              </Card>
            </BlurFade>
          </TabsContent>
        ) : null}
      </Tabs>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Jira template</DialogTitle>
            <DialogDescription>
              Placeholders: {"{{date}}"}, {"{{line_count}}"}, {"{{lines}}"}.
              Channel and project fields override env when set.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void saveTemplate(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tpl-summary">Summary template</Label>
              <Input
                id="tpl-summary"
                value={summaryTpl}
                onChange={(e) => setSummaryTpl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-desc">Description template</Label>
              <Textarea
                id="tpl-desc"
                rows={10}
                value={descTpl}
                onChange={(e) => setDescTpl(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tpl-channel">Slack channel ID override</Label>
                <Input
                  id="tpl-channel"
                  placeholder={settings?.resolved?.slackChannelId || "C…"}
                  value={slackChannel}
                  onChange={(e) => setSlackChannel(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-ping">Slack ping user ID</Label>
                <Input
                  id="tpl-ping"
                  placeholder={settings?.resolved?.slackPingUserId || "U…"}
                  value={slackPing}
                  onChange={(e) => setSlackPing(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-project">Jira project key</Label>
                <Input
                  id="tpl-project"
                  placeholder={settings?.resolved?.jiraProjectKey || "WH"}
                  value={jiraProject}
                  onChange={(e) => setJiraProject(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-type">Jira issue type</Label>
                <Input
                  id="tpl-type"
                  placeholder={settings?.resolved?.jiraIssueType || "Task"}
                  value={jiraIssueType}
                  onChange={(e) => setJiraIssueType(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTemplateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingTpl}>
                {savingTpl ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryNavCard({
  icon: Icon,
  title,
  description,
  badge,
  onClick,
}: {
  icon: typeof Shield;
  title: string;
  description: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-left transition-colors",
        "hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      </div>
      <p className="mt-3 text-sm font-semibold tracking-tight">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}
