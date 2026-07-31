import { useCallback, useEffect, useState } from "react";
import {
  Download,
  MapPinPlus,
  MoreHorizontal,
  Pencil,
  Printer,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { api, isSetupRequiredError, type BinLocation, type PrinterSetting } from "@/lib/api";
import { downloadText } from "@/lib/download";
import { buildBinLocationLabelZpl, labelPreviewLines } from "@/lib/zpl";
import { LabelPreview } from "@/components/LabelPreview";
import { SetupRequiredBanner } from "@/components/SetupRequiredBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ToastFn = (t: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
}) => void;

type FormState = {
  code: string;
  name: string;
  zone: string;
  aisle: string;
  shelf: string;
  description: string;
  asset_tag: string;
};

const emptyForm = (): FormState => ({
  code: "",
  name: "",
  zone: "",
  aisle: "",
  shelf: "",
  description: "",
  asset_tag: "",
});

export function BinsPage({ onToast }: { onToast: ToastFn }) {
  const [bins, setBins] = useState<BinLocation[]>([]);
  const [printers, setPrinters] = useState<PrinterSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BinLocation | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [printOpen, setPrintOpen] = useState(false);
  const [printBin, setPrintBin] = useState<BinLocation | null>(null);
  const [printCopies, setPrintCopies] = useState("1");
  const [printPrinterId, setPrintPrinterId] = useState("");
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      const qs = params.toString();
      const [data, pr] = await Promise.all([
        api.get<BinLocation[]>(`/api/bin-locations${qs ? `?${qs}` : ""}`),
        api.get<PrinterSetting[]>("/api/printers").catch(() => [] as PrinterSetting[]),
      ]);
      setBins(data);
      setPrinters(pr);
      if (!printPrinterId) {
        const def = pr.find((p) => p.is_default) ?? pr[0];
        if (def) setPrintPrinterId(String(def.id));
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error");
      setLoadError(error);
      setBins([]);
      if (!isSetupRequiredError(error)) {
        onToast({
          title: "Failed to load bins",
          description: error.message,
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [onToast, search, printPrinterId]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (bin: BinLocation) => {
    setEditing(bin);
    setForm({
      code: bin.code,
      name: bin.name,
      zone: bin.zone || "",
      aisle: bin.aisle || "",
      shelf: bin.shelf || "",
      description: bin.description || "",
      asset_tag: bin.asset_tag || "",
    });
    setFormOpen(true);
  };

  const saveForm = async () => {
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        zone: form.zone.trim(),
        aisle: form.aisle.trim(),
        shelf: form.shelf.trim(),
        description: form.description.trim(),
        asset_tag: form.asset_tag.trim(),
      };
      if (editing) {
        await api.patch(`/api/bin-locations/${editing.id}`, payload);
        onToast({ title: "Bin updated", variant: "success" });
      } else {
        await api.post("/api/bin-locations", payload);
        onToast({ title: "Bin created", variant: "success" });
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

  const removeBin = async (bin: BinLocation) => {
    if (!window.confirm(`Delete bin “${bin.code}”?`)) return;
    try {
      await api.delete(`/api/bin-locations/${bin.id}`);
      onToast({ title: "Bin deleted", variant: "success" });
      await load();
    } catch (err) {
      onToast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const openPrint = (bin: BinLocation) => {
    setPrintBin(bin);
    setPrintCopies("1");
    setPrintOpen(true);
  };

  const downloadZpl = async () => {
    if (!printBin) return;
    try {
      const res = await api.post<{ zpl: string }>("/api/print", {
        type: "bin",
        id: printBin.id,
        copies: Number(printCopies) || 1,
        dry_run: true,
        printer_id: printPrinterId ? Number(printPrinterId) : undefined,
      });
      downloadText(
        res.zpl,
        `${printBin.asset_tag || printBin.code}-bin.zpl`,
        "application/octet-stream",
      );
      onToast({ title: "ZPL downloaded", variant: "success" });
    } catch {
      const printer = printers.find((p) => String(p.id) === printPrinterId);
      const zpl = buildBinLocationLabelZpl(printBin, {
        widthMm: printer?.label_width_mm ?? 50,
        heightMm: printer?.label_height_mm ?? 25,
        dpi: printer?.dpi ?? 203,
      });
      const copies = Math.max(1, Number(printCopies) || 1);
      downloadText(
        Array.from({ length: copies }, () => zpl).join("\n"),
        `${printBin.asset_tag || printBin.code}-bin.zpl`,
        "application/octet-stream",
      );
      onToast({ title: "ZPL downloaded (local)" });
    }
  };

  const sendPrint = async () => {
    if (!printBin) return;
    setPrinting(true);
    try {
      const res = await api.post<{
        printer?: { name: string; host: string; port: number };
      }>("/api/print", {
        type: "bin",
        id: printBin.id,
        copies: Number(printCopies) || 1,
        printer_id: printPrinterId ? Number(printPrinterId) : undefined,
      });
      onToast({
        title: "Sent to printer",
        description: res.printer
          ? `${res.printer.name} @ ${res.printer.host}:${res.printer.port}`
          : undefined,
        variant: "success",
      });
      setPrintOpen(false);
    } catch (err) {
      onToast({
        title: "Print failed",
        description:
          (err instanceof Error ? err.message : "Unknown error") +
          " — try Download ZPL from a machine on the printer LAN.",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  };

  const previewLines = printBin
    ? labelPreviewLines({
        title: printBin.code,
        subtitle: printBin.name,
        assetTag: printBin.asset_tag || printBin.code,
        fields: [
          {
            label: "LOC",
            value: [printBin.zone, printBin.aisle, printBin.shelf]
              .filter(Boolean)
              .join(" / "),
          },
        ].filter((f) => f.value),
        footer: "BIN LOCATION",
      })
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, name, zone, tag…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => void load()}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button onClick={openCreate} disabled={isSetupRequiredError(loadError)}>
            <MapPinPlus className="mr-2 h-4 w-4" />
            Add bin
          </Button>
        </div>
      </div>

      {loadError && isSetupRequiredError(loadError) ? (
        <SetupRequiredBanner error={loadError} onRetry={() => void load()} />
      ) : null}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : bins.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
              <p className="text-sm font-medium">No bin locations yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Define shelves and racks so you can print location asset tags for
                the floor.
              </p>
              <Button onClick={openCreate}>Add first bin</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Location</TableHead>
                    <TableHead className="hidden sm:table-cell">Asset tag</TableHead>
                    <TableHead className="w-[1%] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bins.map((bin) => (
                    <TableRow key={bin.id}>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono">
                          {bin.code}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{bin.name}</p>
                          {bin.description ? (
                            <p className="text-xs text-muted-foreground">
                              {bin.description}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {[bin.zone, bin.aisle, bin.shelf].filter(Boolean).join(" / ") ||
                          "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell font-mono text-xs">
                        {bin.asset_tag || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8 px-2"
                            onClick={() => openPrint(bin)}
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(bin)}>
                                <Pencil className="mr-2 h-3.5 w-3.5" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openPrint(bin)}>
                                <Printer className="mr-2 h-3.5 w-3.5" />
                                Print location tag
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => void removeBin(bin)}
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit bin location" : "New bin location"}</DialogTitle>
            <DialogDescription>
              Codes appear on printed location tags. Asset tags auto-generate if blank.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="b-code">Code</Label>
              <Input
                id="b-code"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="A-01-01"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-name">Name</Label>
              <Input
                id="b-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Fasteners — Upper"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-zone">Zone</Label>
              <Input
                id="b-zone"
                value={form.zone}
                onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-aisle">Aisle</Label>
              <Input
                id="b-aisle"
                value={form.aisle}
                onChange={(e) => setForm((f) => ({ ...f, aisle: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-shelf">Shelf</Label>
              <Input
                id="b-shelf"
                value={form.shelf}
                onChange={(e) => setForm((f) => ({ ...f, shelf: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-tag">Asset tag</Label>
              <Input
                id="b-tag"
                value={form.asset_tag}
                onChange={(e) => setForm((f) => ({ ...f, asset_tag: e.target.value }))}
                placeholder="Auto if empty"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="b-desc">Description</Label>
              <Textarea
                id="b-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
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
              disabled={saving || !form.code || !form.name}
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Create bin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Print bin location tag</DialogTitle>
            <DialogDescription>
              ZPL location label for rack / shelf identification.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Printer</Label>
                <Select value={printPrinterId} onValueChange={setPrintPrinterId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select printer" />
                  </SelectTrigger>
                  <SelectContent>
                    {printers.length === 0 ? (
                      <SelectItem value="none" disabled>
                        No printers configured
                      </SelectItem>
                    ) : (
                      printers.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} — {p.host}:{p.port}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-copies">Copies</Label>
                <Input
                  id="b-copies"
                  type="number"
                  min={1}
                  max={20}
                  value={printCopies}
                  onChange={(e) => setPrintCopies(e.target.value)}
                />
              </div>
            </div>
            <LabelPreview lines={previewLines} footer={printBin?.asset_tag} />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => void downloadZpl()}>
              <Download className="mr-2 h-4 w-4" />
              Download ZPL
            </Button>
            <Button
              onClick={() => void sendPrint()}
              disabled={printing || printers.length === 0}
            >
              <Printer className="mr-2 h-4 w-4" />
              {printing ? "Sending…" : "Print to network"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
