import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { api, isSetupRequiredError, type PrinterSetting } from "@/lib/api";
import { SetupRequiredBanner } from "@/components/SetupRequiredBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

type ToastFn = (t: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
}) => void;

type FormState = {
  name: string;
  host: string;
  port: string;
  protocol: string;
  label_width_mm: string;
  label_height_mm: string;
  dpi: string;
  is_default: boolean;
  notes: string;
};

const emptyForm = (): FormState => ({
  name: "",
  host: "",
  port: "9100",
  protocol: "zpl",
  label_width_mm: "50",
  label_height_mm: "25",
  dpi: "203",
  is_default: false,
  notes: "",
});

export function PrintersPage({ onToast }: { onToast: ToastFn }) {
  const [printers, setPrinters] = useState<PrinterSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PrinterSetting | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<PrinterSetting[]>("/api/printers");
      setPrinters(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error");
      setPrinters([]);
      setLoadError(error);
      if (!isSetupRequiredError(error)) {
        onToast({
          title: "Failed to load printers",
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

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm(), is_default: printers.length === 0 });
    setFormOpen(true);
  };

  const openEdit = (p: PrinterSetting) => {
    setEditing(p);
    setForm({
      name: p.name,
      host: p.host,
      port: String(p.port),
      protocol: p.protocol || "zpl",
      label_width_mm: String(p.label_width_mm),
      label_height_mm: String(p.label_height_mm),
      dpi: String(p.dpi),
      is_default: p.is_default,
      notes: p.notes || "",
    });
    setFormOpen(true);
  };

  const saveForm = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 9100,
        protocol: form.protocol.trim() || "zpl",
        label_width_mm: Number(form.label_width_mm) || 50,
        label_height_mm: Number(form.label_height_mm) || 25,
        dpi: Number(form.dpi) || 203,
        is_default: form.is_default,
        notes: form.notes.trim(),
      };
      if (editing) {
        await api.patch(`/api/printers/${editing.id}`, payload);
        onToast({ title: "Printer updated", variant: "success" });
      } else {
        await api.post("/api/printers", payload);
        onToast({ title: "Printer added", variant: "success" });
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      onToast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (p: PrinterSetting) => {
    try {
      await api.patch(`/api/printers/${p.id}`, { is_default: true });
      onToast({ title: `${p.name} is now default`, variant: "success" });
      await load();
    } catch (err) {
      onToast({
        title: "Could not set default",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const remove = async (p: PrinterSetting) => {
    if (!window.confirm(`Remove printer “${p.name}”?`)) return;
    try {
      await api.delete(`/api/printers/${p.id}`);
      onToast({ title: "Printer removed", variant: "success" });
      await load();
    } catch (err) {
      onToast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl space-y-1">
          <p className="text-sm text-muted-foreground">
            Configure Zebra-compatible Ethernet printers (RAW port 9100). The
            server sends ZPL over TCP when you print asset or bin tags.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => void load()}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button onClick={openCreate} disabled={isSetupRequiredError(loadError)}>
            <Plus className="mr-2 h-4 w-4" />
            Add printer
          </Button>
        </div>
      </div>

      {loadError && isSetupRequiredError(loadError) ? (
        <SetupRequiredBanner error={loadError} onRetry={() => void load()} />
      ) : null}

      <BlurFade>
        <Card className="border-primary/15 bg-primary/[0.03]">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Printer className="h-5 w-5" />
            </div>
            <div className="space-y-1 text-sm">
              <p className="font-medium text-foreground">Network requirements</p>
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                <li>
                  Printer must be reachable from the host running this app
                  (same LAN / VPN). Cloud deploys cannot reach private
                  192.168.x.x addresses — use Download ZPL on those hosts, or
                  run the app on-prem.
                </li>
                <li>
                  Enable RAW TCP printing (usually port <strong>9100</strong>)
                  on the printer.
                </li>
                <li>
                  Labels are generated as ZPL with Code 128 barcodes for asset
                  and bin tags.
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </BlurFade>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : printers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="text-sm font-medium">No printers configured</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add your shop-floor label printer IP so asset and bin tags can be
              sent directly over Ethernet.
            </p>
            <Button onClick={openCreate}>Add Ethernet printer</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {printers.map((p, idx) => (
            <BlurFade key={p.id} delay={0.05 * idx}>
              <Card className="h-full">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {p.name}
                      {p.is_default ? (
                        <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                          <Star className="mr-1 h-3 w-3" />
                          Default
                        </Badge>
                      ) : null}
                    </CardTitle>
                    <p className="font-mono text-sm text-muted-foreground">
                      {p.host}:{p.port}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(p)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" />
                        Edit
                      </DropdownMenuItem>
                      {!p.is_default ? (
                        <DropdownMenuItem onClick={() => void setDefault(p)}>
                          <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                          Set as default
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => void remove(p)}
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide">Protocol</p>
                      <p className="font-medium text-foreground uppercase">
                        {p.protocol}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide">DPI</p>
                      <p className="font-medium text-foreground">{p.dpi}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide">Label</p>
                      <p className="font-medium text-foreground">
                        {p.label_width_mm} × {p.label_height_mm} mm
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide">Port</p>
                      <p className="font-medium text-foreground">{p.port}</p>
                    </div>
                  </div>
                  {p.notes ? (
                    <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                      {p.notes}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </BlurFade>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit printer" : "Add Ethernet printer"}
            </DialogTitle>
            <DialogDescription>
              Point at a Zebra (or ZPL-compatible) printer on your network.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Shop Floor Zebra"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-host">Host / IP</Label>
              <Input
                id="p-host"
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                placeholder="192.168.1.50"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-port">Port</Label>
              <Input
                id="p-port"
                type="number"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-w">Label width (mm)</Label>
              <Input
                id="p-w"
                type="number"
                value={form.label_width_mm}
                onChange={(e) =>
                  setForm((f) => ({ ...f, label_width_mm: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-h">Label height (mm)</Label>
              <Input
                id="p-h"
                type="number"
                value={form.label_height_mm}
                onChange={(e) =>
                  setForm((f) => ({ ...f, label_height_mm: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-dpi">DPI</Label>
              <Input
                id="p-dpi"
                type="number"
                value={form.dpi}
                onChange={(e) => setForm((f) => ({ ...f, dpi: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-proto">Protocol</Label>
              <Input
                id="p-proto"
                value={form.protocol}
                onChange={(e) =>
                  setForm((f) => ({ ...f, protocol: e.target.value }))
                }
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="p-default"
                type="checkbox"
                checked={form.is_default}
                onChange={(e) =>
                  setForm((f) => ({ ...f, is_default: e.target.checked }))
                }
                className="h-4 w-4 rounded border-border"
              />
              <Label htmlFor="p-default" className="font-normal">
                Set as default printer
              </Label>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-notes">Notes</Label>
              <Textarea
                id="p-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveForm()}
              disabled={saving || !form.name || !form.host}
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Add printer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
