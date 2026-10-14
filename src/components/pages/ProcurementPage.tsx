import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  ClipboardList,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  ExternalLink,
} from "lucide-react";
import {
  api,
  isSetupRequiredError,
  type ProcurementOrderLine,
  type ProcurementStatus,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/use-auth";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { SetupRequiredBanner } from "@/components/SetupRequiredBanner";
import { TicketHistoryList } from "@/components/admin/TicketHistoryList";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ToastFn = (t: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
}) => void;

type DraftLine = {
  link: string;
  quantity: string;
  notes: string;
};

const emptyDraft = (): DraftLine => ({
  link: "",
  quantity: "1",
  notes: "",
});

export function ProcurementPage({ onToast }: { onToast: ToastFn }) {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const [lines, setLines] = useState<ProcurementOrderLine[]>([]);
  const [status, setStatus] = useState<ProcurementStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<DraftLine>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<DraftLine>(emptyDraft);

  const locked = Boolean(status?.locked);
  const queueDayKey = status?.queue_day_key ?? status?.day_key ?? "";
  const queuingForTomorrow =
    locked && Boolean(queueDayKey) && queueDayKey !== status?.day_key;
  const myEmail = (user?.email ?? "").toLowerCase();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lineData, statusData] = await Promise.all([
        api.get<ProcurementOrderLine[]>("/api/procurement"),
        api.get<ProcurementStatus>("/api/procurement/status"),
      ]);
      setLines(lineData);
      setStatus(statusData);
    } catch (err) {
      setError(err);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const qty = Number(draft.quantity);
      await api.post<ProcurementOrderLine>("/api/procurement", {
        link: draft.link.trim(),
        quantity: qty,
        notes: draft.notes.trim(),
        created_by_email: user?.email ?? "local@browser",
        created_by_name: user?.name ?? "Local user",
      });
      setDraft(emptyDraft());
      onToast({
        title: "Line added",
        description: queuingForTomorrow
          ? `Queued for ${queueDayKey}.`
          : undefined,
        variant: "success",
      });
      await load();
    } catch (err) {
      onToast({
        title: "Could not add line",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  function startEdit(line: ProcurementOrderLine) {
    setEditId(line.id);
    setEditDraft({
      link: line.link,
      quantity: String(line.quantity),
      notes: line.notes ?? "",
    });
  }

  async function saveEdit() {
    if (editId == null) return;
    setBusyId(editId);
    try {
      await api.patch<ProcurementOrderLine>(`/api/procurement/${editId}`, {
        link: editDraft.link.trim(),
        quantity: Number(editDraft.quantity),
        notes: editDraft.notes.trim(),
      });
      onToast({ title: "Line updated", variant: "success" });
      setEditId(null);
      await load();
    } catch (err) {
      onToast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function removeLine(line: ProcurementOrderLine) {
    setBusyId(line.id);
    try {
      await api.delete(`/api/procurement/${line.id}`);
      onToast({ title: "Line removed", variant: "success" });
      await load();
    } catch (err) {
      onToast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  function canEdit(line: ProcurementOrderLine) {
    if (line.status !== "open") return false;
    if (locked && line.day_key === status?.day_key) return false;
    return (
      isAdmin ||
      String(line.created_by_email ?? "").toLowerCase() === myEmail
    );
  }

  if (isSetupRequiredError(error)) {
    return <SetupRequiredBanner error={error} />;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <BlurFade delay={0.04}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              <h2 className="text-base font-semibold tracking-tight">
                {queuingForTomorrow
                  ? `Queue for ${queueDayKey}`
                  : "Today's orders"}
              </h2>
              {locked ? <Badge>Closed</Badge> : null}
              {status ? (
                <span className="text-sm text-muted-foreground">
                  {status.open_count} open
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {queuingForTomorrow ? (
                <>
                  {status?.day_key} closed · Closes{" "}
                  {status?.close_schedule ?? "2:30pm MST"}
                </>
              ) : (
                <>
                  {status?.day_key ?? "…"} · Closes{" "}
                  {status?.close_schedule ?? "2:30pm MST"}
                </>
              )}
              {status?.batch?.jira_issue_url ? (
                <>
                  {" · "}
                  <a
                    href={status.batch.jira_issue_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {status.batch.jira_issue_key || "Jira"}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              ) : null}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </BlurFade>

      <BlurFade delay={0.08}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {queuingForTomorrow ? `Add for ${queueDayKey}` : "Add line"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => void handleAdd(e)}
              className="grid gap-4 md:grid-cols-[1fr_120px_1fr_auto]"
            >
              <div className="space-y-2">
                <Label htmlFor="proc-link">Product link</Label>
                <Input
                  id="proc-link"
                  type="url"
                  required
                  placeholder="https://…"
                  value={draft.link}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, link: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="proc-qty">Quantity</Label>
                <Input
                  id="proc-qty"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={draft.quantity}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, quantity: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="proc-notes">Notes</Label>
                <Input
                  id="proc-notes"
                  placeholder="Optional"
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 h-4 w-4" />
                  )}
                  {queuingForTomorrow ? "Queue" : "Add"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </BlurFade>

      {(status?.history?.length ?? 0) > 0 ? (
        <BlurFade delay={0.09}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Ticket history</CardTitle>
            </CardHeader>
            <CardContent>
              <TicketHistoryList
                countSuffix="lines"
                rows={(status?.history ?? []).map((b) => ({
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
      ) : null}

      <BlurFade delay={0.1}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Order lines</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : lines.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                {queuingForTomorrow
                  ? `No lines for ${queueDayKey}.`
                  : "No order lines for today."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Creator</TableHead>
                    <TableHead>Link</TableHead>
                    <TableHead className="w-24">Qty</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-36 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const editing = editId === line.id;
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="align-top text-sm">
                          <div className="font-medium">
                            {line.created_by_name || "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {line.created_by_email}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          {editing ? (
                            <Input
                              value={editDraft.link}
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  link: e.target.value,
                                }))
                              }
                            />
                          ) : (
                            <a
                              href={line.link}
                              target="_blank"
                              rel="noreferrer"
                              className="break-all text-sm text-primary hover:underline"
                            >
                              {line.link}
                            </a>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {editing ? (
                            <Input
                              type="number"
                              min={1}
                              value={editDraft.quantity}
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  quantity: e.target.value,
                                }))
                              }
                            />
                          ) : (
                            line.quantity
                          )}
                        </TableCell>
                        <TableCell className="align-top text-sm">
                          {editing ? (
                            <Textarea
                              rows={2}
                              value={editDraft.notes}
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  notes: e.target.value,
                                }))
                              }
                            />
                          ) : (
                            line.notes || (
                              <span className="text-muted-foreground">—</span>
                            )
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            variant={
                              line.status === "open" ? "secondary" : "default"
                            }
                          >
                            {line.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top text-right">
                          {canEdit(line) ? (
                            editing ? (
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditId(null)}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={busyId === line.id}
                                  onClick={() => void saveEdit()}
                                >
                                  <Save className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => startEdit(line)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busyId === line.id}
                                  onClick={() => void removeLine(line)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </BlurFade>
    </div>
  );
}
