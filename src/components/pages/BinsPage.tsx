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
import { copyText, downloadText } from "@/lib/download";
import {
  buildBinLocationLabelZpl,
  finalizeZpl,
  labelPreviewLines,
} from "@/lib/zpl";
import {
  BrowserPrintError,
  discoverZebraPrinters,
  pickDefaultPrinter,
  sendZplToBrowserPrint,
  withCopies,
  type ZebraBrowserPrinter,
} from "@/lib/zebra-browser-print";
import { cn } from "@/lib/utils";
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
  const [printing, setPrinting] = useState(false);
  const [bpPrinters, setBpPrinters] = useState<ZebraBrowserPrinter[]>([]);
  const [bpSelectedUid, setBpSelectedUid] = useState("");
  const [bpStatus, setBpStatus] = useState<
    "idle" | "checking" | "online" | "offline"
  >("idle");
  const [bpError, setBpError] = useState<string | null>(null);
  const [bpRefreshing, setBpRefreshing] = useState(false);
  const [labelProfiles, setLabelProfiles] = useState<PrinterSetting[]>([]);
  const [labelProfileId, setLabelProfileId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      const qs = params.toString();
      const [data, pr] = await Promise.all([
        api.get<BinLocation[]>(`/api/bin-locations${qs ? `?${qs}` : ""}`),
        api
          .get<PrinterSetting[]>("/api/printers")
          .catch(() => [] as PrinterSetting[]),
      ]);
      setBins(data);
      setLabelProfiles(pr);
      setLabelProfileId((prev) => {
        if (prev) return prev;
        const def = pr.find((p) => p.is_default) ?? pr[0];
        return def ? String(def.id) : "";
      });
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
  }, [onToast, search]);

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

  const refreshBrowserPrinters = useCallback(async () => {
    setBpRefreshing(true);
    setBpStatus("checking");
    setBpError(null);
    try {
      const list = await discoverZebraPrinters();
      setBpPrinters(list);
      setBpStatus("online");
      setBpSelectedUid((prev) => {
        if (prev && list.some((p) => p.uid === prev)) return prev;
        const pick = pickDefaultPrinter(list);
        return pick?.uid ?? "";
      });
      if (list.length === 0) {
        setBpError(
          "Browser Print is running, but no Zebra printers were found.",
        );
      }
    } catch (err) {
      setBpPrinters([]);
      setBpSelectedUid("");
      setBpStatus("offline");
      setBpError(
        err instanceof BrowserPrintError
          ? err.message
          : "Could not reach Zebra Browser Print on this computer.",
      );
    } finally {
      setBpRefreshing(false);
    }
  }, []);

  const openPrint = (bin: BinLocation) => {
    setPrintBin(bin);
    setPrintCopies("1");
    setPrintOpen(true);
    void refreshBrowserPrinters();
  };

  const buildSingleBinZpl = (): string => {
    if (!printBin) throw new Error("No bin selected");
    const profile =
      labelProfiles.find((p) => String(p.id) === labelProfileId) ??
      labelProfiles.find((p) => p.is_default) ??
      labelProfiles[0];
    return finalizeZpl(
      buildBinLocationLabelZpl(printBin, {
        widthMm: profile?.label_width_mm ?? 101.6,
        heightMm: profile?.label_height_mm ?? 50.8,
        dpi: profile?.dpi ?? 203,
      }),
    );
  };

  const resolveBinZpl = async (): Promise<string> => {
    if (!printBin) throw new Error("No bin selected");
    const copies = Math.max(1, Math.min(99, Number(printCopies) || 1));
    return withCopies(buildSingleBinZpl(), copies);
  };

  const downloadZpl = async () => {
    if (!printBin) return;
    try {
      const zpl = await resolveBinZpl();
      downloadText(
        zpl,
        `${printBin.asset_tag || printBin.code}-bin.txt`,
        "text/plain;charset=utf-8",
      );
      onToast({
        title: "Label file downloaded",
        description: "Raw ZPL backup for Zebra Setup Utilities.",
        variant: "success",
      });
    } catch (err) {
      onToast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const copyZpl = async () => {
    if (!printBin) return;
    try {
      const zpl = await resolveBinZpl();
      await copyText(zpl);
      onToast({
        title: "ZPL copied",
        variant: "success",
      });
    } catch (err) {
      onToast({
        title: "Copy failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const sendPrint = async () => {
    if (!printBin) return;
    const copies = Math.max(1, Math.min(99, Number(printCopies) || 1));
    setPrinting(true);
    try {
      let list = bpPrinters;
      if (list.length === 0) {
        list = await discoverZebraPrinters();
        setBpPrinters(list);
        setBpStatus("online");
      }
      if (list.length === 0) {
        throw new BrowserPrintError(
          "No Zebra printers found. Open Browser Print and connect your printer.",
          "NO_PRINTERS",
        );
      }
      const printer =
        list.find((p) => p.uid === bpSelectedUid) ?? pickDefaultPrinter(list);
      if (!printer) {
        throw new BrowserPrintError("Select a printer first.", "NO_PRINTERS");
      }
      if (printer.uid !== bpSelectedUid) setBpSelectedUid(printer.uid);

      const zpl = withCopies(buildSingleBinZpl(), copies);
      await sendZplToBrowserPrint(printer, zpl);

      onToast({
        title:
          copies === 1
            ? "Label sent to printer"
            : `${copies} labels sent to printer`,
        description: `${printer.name} · ${printBin.asset_tag || printBin.code}`,
        variant: "success",
      });
      setPrintOpen(false);
    } catch (err) {
      const message =
        err instanceof BrowserPrintError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Print failed";
      setBpError(message);
      if (err instanceof BrowserPrintError && err.code === "OFFLINE") {
        setBpStatus("offline");
      }
      onToast({
        title: "Print failed",
        description: message,
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
              Sends labels through <strong>Zebra Browser Print</strong> on this
              computer. Set copies for a batch.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>Zebra printer</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => void refreshBrowserPrinters()}
                    disabled={bpRefreshing}
                  >
                    <RefreshCw
                      className={cn(
                        "mr-1 h-3 w-3",
                        bpRefreshing && "animate-spin",
                      )}
                    />
                    Refresh
                  </Button>
                </div>
                <Select
                  value={bpSelectedUid || undefined}
                  onValueChange={setBpSelectedUid}
                  disabled={bpPrinters.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        bpStatus === "checking"
                          ? "Looking for printers…"
                          : bpStatus === "offline"
                            ? "Browser Print offline"
                            : "Select printer"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {bpPrinters.length === 0 ? (
                      <SelectItem value="none" disabled>
                        No printers found
                      </SelectItem>
                    ) : (
                      bpPrinters.map((p) => (
                        <SelectItem key={p.uid} value={p.uid}>
                          {p.name}
                          {p.connection ? ` · ${p.connection}` : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-copies">Copies (batch)</Label>
                <Input
                  id="b-copies"
                  type="number"
                  min={1}
                  max={99}
                  value={printCopies}
                  onChange={(e) => setPrintCopies(e.target.value)}
                />
                <div className="flex flex-wrap gap-1.5">
                  {[1, 5, 10, 20, 50].map((n) => (
                    <Button
                      key={n}
                      type="button"
                      size="sm"
                      variant={
                        String(n) === String(Number(printCopies) || 0)
                          ? "default"
                          : "outline"
                      }
                      className="h-7 px-2.5 text-xs"
                      onClick={() => setPrintCopies(String(n))}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
              {labelProfiles.length > 0 ? (
                <div className="space-y-1.5">
                  <Label>Label size profile</Label>
                  <Select
                    value={labelProfileId || undefined}
                    onValueChange={setLabelProfileId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Default 4×2 in" />
                    </SelectTrigger>
                    <SelectContent>
                      {labelProfiles.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} · {p.label_width_mm}×{p.label_height_mm} mm
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <LabelPreview lines={previewLines} footer={printBin?.asset_tag} />
          </div>
          {bpError ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              <p className="font-medium">Browser Print</p>
              <p className="mt-0.5">{bpError}</p>
              <p className="mt-1.5">
                Install Zebra Browser Print on this PC, keep it running, then
                click Refresh.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              Prints from this PC via Browser Print. Download is a backup.
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button variant="outline" onClick={() => void copyZpl()}>
              Copy ZPL
            </Button>
            <Button variant="outline" onClick={() => void downloadZpl()}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
            <Button
              onClick={() => void sendPrint()}
              disabled={
                printing ||
                bpStatus === "checking" ||
                (bpStatus === "offline" && bpPrinters.length === 0)
              }
            >
              <Printer className="mr-2 h-4 w-4" />
              {printing
                ? "Sending…"
                : Number(printCopies) > 1
                  ? `Print ${Math.max(1, Math.min(99, Number(printCopies) || 1))} labels`
                  : "Print label"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
