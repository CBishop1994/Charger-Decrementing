import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Minus,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { api, isSetupRequiredError, type Consumable, type PrinterSetting } from "@/lib/api";
import { downloadText } from "@/lib/download";
import { buildConsumableLabelZpl, labelPreviewLines } from "@/lib/zpl";
import { StockBadge } from "@/components/StockBadge";
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
  name: string;
  sku: string;
  description: string;
  quantity: string;
  min_level: string;
  unit: string;
  category: string;
  bin_location: string;
  asset_tag: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  name: "",
  sku: "",
  description: "",
  quantity: "0",
  min_level: "0",
  unit: "ea",
  category: "General",
  bin_location: "",
  asset_tag: "",
  notes: "",
});

export function ConsumablesPage({ onToast }: { onToast: ToastFn }) {
  const [items, setItems] = useState<Consumable[]>([]);
  const [printers, setPrinters] = useState<PrinterSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Consumable | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustItem, setAdjustItem] = useState<Consumable | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("1");
  const [adjustMode, setAdjustMode] = useState<"use" | "restock">("use");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  const [printOpen, setPrintOpen] = useState(false);
  const [printItem, setPrintItem] = useState<Consumable | null>(null);
  const [printCopies, setPrintCopies] = useState("1");
  const [printPrinterId, setPrintPrinterId] = useState<string>("");
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (status !== "all") params.set("status", status);
      const qs = params.toString();
      const [data, pr] = await Promise.all([
        api.get<Consumable[]>(`/api/consumables${qs ? `?${qs}` : ""}`),
        api.get<PrinterSetting[]>("/api/printers").catch(() => [] as PrinterSetting[]),
      ]);
      setItems(data);
      setPrinters(pr);
      if (!printPrinterId) {
        const def = pr.find((p) => p.is_default) ?? pr[0];
        if (def) setPrintPrinterId(String(def.id));
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error");
      setLoadError(error);
      setItems([]);
      if (!isSetupRequiredError(error)) {
        onToast({
          title: "Failed to load consumables",
          description: error.message,
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [onToast, search, status, printPrinterId]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (item: Consumable) => {
    setEditing(item);
    setForm({
      name: item.name,
      sku: item.sku,
      description: item.description || "",
      quantity: String(item.quantity),
      min_level: String(item.min_level),
      unit: item.unit || "ea",
      category: item.category || "General",
      bin_location: item.bin_location || "",
      asset_tag: item.asset_tag || "",
      notes: item.notes || "",
    });
    setFormOpen(true);
  };

  const saveForm = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        description: form.description.trim(),
        quantity: Number(form.quantity) || 0,
        min_level: Number(form.min_level) || 0,
        unit: form.unit.trim() || "ea",
        category: form.category.trim() || "General",
        bin_location: form.bin_location.trim(),
        asset_tag: form.asset_tag.trim(),
        notes: form.notes.trim(),
      };
      if (editing) {
        await api.patch(`/api/consumables/${editing.id}`, payload);
        onToast({ title: "Item updated", variant: "success" });
      } else {
        await api.post("/api/consumables", payload);
        onToast({ title: "Item created", variant: "success" });
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

  const removeItem = async (item: Consumable) => {
    if (!window.confirm(`Delete “${item.name}”? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/consumables/${item.id}`);
      onToast({ title: "Item deleted", variant: "success" });
      await load();
    } catch (err) {
      onToast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const openAdjust = (item: Consumable, mode: "use" | "restock") => {
    setAdjustItem(item);
    setAdjustMode(mode);
    setAdjustDelta("1");
    setAdjustNote("");
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    if (!adjustItem) return;
    const amount = Math.abs(Math.trunc(Number(adjustDelta) || 0));
    if (!amount) {
      onToast({ title: "Enter a quantity", variant: "destructive" });
      return;
    }
    const delta = adjustMode === "use" ? -amount : amount;
    setAdjusting(true);
    try {
      const res = await api.post<{
        consumable: Consumable;
        low_stock: boolean;
        out_of_stock: boolean;
      }>(`/api/consumables/${adjustItem.id}/adjust`, {
        delta,
        reason: adjustMode === "use" ? "use" : "restock",
        note: adjustNote.trim(),
        created_by: "operator",
      });
      onToast({
        title:
          adjustMode === "use"
            ? `Used ${amount} ${adjustItem.unit}`
            : `Restocked ${amount} ${adjustItem.unit}`,
        description: res.out_of_stock
          ? "Now out of stock"
          : res.low_stock
            ? "Now at or below minimum level"
            : `New qty: ${res.consumable.quantity}`,
        variant: res.out_of_stock || res.low_stock ? "default" : "success",
      });
      setAdjustOpen(false);
      await load();
    } catch (err) {
      onToast({
        title: "Adjustment failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAdjusting(false);
    }
  };

  const openPrint = (item: Consumable) => {
    setPrintItem(item);
    setPrintCopies("1");
    setPrintOpen(true);
  };

  const downloadZpl = async () => {
    if (!printItem) return;
    try {
      const res = await api.post<{ zpl: string }>("/api/print", {
        type: "consumable",
        id: printItem.id,
        copies: Number(printCopies) || 1,
        dry_run: true,
        printer_id: printPrinterId ? Number(printPrinterId) : undefined,
      });
      downloadText(
        res.zpl,
        `${printItem.asset_tag || printItem.sku}-label.zpl`,
        "application/octet-stream",
      );
      onToast({ title: "ZPL downloaded", variant: "success" });
    } catch (err) {
      // Fallback local generation
      const printer = printers.find((p) => String(p.id) === printPrinterId);
      const zpl = buildConsumableLabelZpl(printItem, {
        widthMm: printer?.label_width_mm ?? 50,
        heightMm: printer?.label_height_mm ?? 25,
        dpi: printer?.dpi ?? 203,
      });
      const copies = Math.max(1, Number(printCopies) || 1);
      downloadText(
        Array.from({ length: copies }, () => zpl).join("\n"),
        `${printItem.asset_tag || printItem.sku}-label.zpl`,
        "application/octet-stream",
      );
      onToast({
        title: "ZPL downloaded (local)",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const sendPrint = async () => {
    if (!printItem) return;
    setPrinting(true);
    try {
      const res = await api.post<{
        ok: boolean;
        printed?: boolean;
        error?: string;
        printer?: { name: string; host: string; port: number };
      }>("/api/print", {
        type: "consumable",
        id: printItem.id,
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
      const hint =
        err && typeof err === "object" && "hint" in err
          ? String((err as { hint?: string }).hint ?? "")
          : "";
      onToast({
        title: "Print failed (network unreachable from cloud)",
        description:
          hint ||
          (err instanceof Error ? err.message : "Unknown error") +
            " — use Download ZPL from a PC on the printer network.",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  };

  const previewLines = printItem
    ? labelPreviewLines({
        title: printItem.name,
        subtitle: `SKU ${printItem.sku}`,
        assetTag: printItem.asset_tag || printItem.sku,
        fields: [
          ...(printItem.bin_location
            ? [{ label: "BIN", value: printItem.bin_location }]
            : []),
          {
            label: "MIN",
            value: `${printItem.min_level} ${printItem.unit}`,
          },
        ],
        footer: "CONSUMABLE",
      })
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, SKU, tag, bin…"
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="ok">In stock</SelectItem>
              <SelectItem value="low">Low stock</SelectItem>
              <SelectItem value="out">Out of stock</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => void load()}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button onClick={openCreate} disabled={isSetupRequiredError(loadError)}>
            <PackagePlus className="mr-2 h-4 w-4" />
            Add item
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
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
              <p className="text-sm font-medium">No consumables match</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Create an item to start decrementing stock and printing asset tags.
              </p>
              <Button onClick={openCreate}>Add first item</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="hidden md:table-cell">Bin</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="hidden sm:table-cell text-right">
                      Min
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[1%] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="font-medium leading-tight">{item.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {item.sku}
                            {item.asset_tag ? ` · ${item.asset_tag}` : ""}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1 md:hidden">
                            {item.bin_location ? (
                              <Badge variant="secondary" className="text-[10px]">
                                {item.bin_location}
                              </Badge>
                            ) : null}
                            <Badge variant="outline" className="text-[10px]">
                              {item.category}
                            </Badge>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="text-sm">
                          <p>{item.bin_location || "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.category}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums font-semibold">
                        {item.quantity}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {item.unit}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-right font-mono text-sm tabular-nums text-muted-foreground">
                        {item.min_level}
                      </TableCell>
                      <TableCell>
                        <StockBadge
                          quantity={item.quantity}
                          minLevel={item.min_level}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            onClick={() => openAdjust(item, "use")}
                            title="Use / decrement"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            onClick={() => openAdjust(item, "restock")}
                            title="Restock"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8 px-2"
                            onClick={() => openPrint(item)}
                            title="Print asset tag"
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
                              <DropdownMenuItem onClick={() => openEdit(item)}>
                                <Pencil className="mr-2 h-3.5 w-3.5" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openPrint(item)}>
                                <Printer className="mr-2 h-3.5 w-3.5" />
                                Print tag
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => void removeItem(item)}
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

      {categories.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Categories in view: {categories.join(" · ")}
        </p>
      ) : null}

      {/* Create / Edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit consumable" : "New consumable"}</DialogTitle>
            <DialogDescription>
              Track quantity against a minimum level. Asset tags are generated if left blank.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-name">Name</Label>
              <Input
                id="c-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="M8 Hex Bolts"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-sku">SKU</Label>
              <Input
                id="c-sku"
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                placeholder="BOLT-M8-25"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-cat">Category</Label>
              <Input
                id="c-cat"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Fasteners"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-qty">Quantity</Label>
              <Input
                id="c-qty"
                type="number"
                min={0}
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-min">Minimum level</Label>
              <Input
                id="c-min"
                type="number"
                min={0}
                value={form.min_level}
                onChange={(e) => setForm((f) => ({ ...f, min_level: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-unit">Unit</Label>
              <Input
                id="c-unit"
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                placeholder="ea"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-bin">Bin location</Label>
              <Input
                id="c-bin"
                value={form.bin_location}
                onChange={(e) =>
                  setForm((f) => ({ ...f, bin_location: e.target.value }))
                }
                placeholder="A-01-01"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-tag">Asset tag</Label>
              <Input
                id="c-tag"
                value={form.asset_tag}
                onChange={(e) => setForm((f) => ({ ...f, asset_tag: e.target.value }))}
                placeholder="Auto-generated if empty"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-desc">Description</Label>
              <Textarea
                id="c-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                rows={2}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-notes">Notes</Label>
              <Textarea
                id="c-notes"
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
            <Button onClick={() => void saveForm()} disabled={saving || !form.name || !form.sku}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust stock */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {adjustMode === "use" ? "Use / decrement" : "Restock"}
            </DialogTitle>
            <DialogDescription>
              {adjustItem
                ? `${adjustItem.name} · on hand ${adjustItem.quantity} ${adjustItem.unit} (min ${adjustItem.min_level})`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={adjustMode === "use" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setAdjustMode("use")}
              >
                <Minus className="mr-2 h-4 w-4" />
                Use
              </Button>
              <Button
                type="button"
                variant={adjustMode === "restock" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setAdjustMode("restock")}
              >
                <Plus className="mr-2 h-4 w-4" />
                Restock
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-qty">Quantity</Label>
              <Input
                id="adj-qty"
                type="number"
                min={1}
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-note">Note (optional)</Label>
              <Input
                id="adj-note"
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder="Job #, line, reason…"
              />
            </div>
            {adjustItem ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                New quantity will be{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {Math.max(
                    0,
                    adjustItem.quantity +
                      (adjustMode === "use" ? -1 : 1) *
                        Math.abs(Math.trunc(Number(adjustDelta) || 0)),
                  )}
                </span>
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitAdjust()} disabled={adjusting}>
              {adjusting ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print */}
      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Print asset tag</DialogTitle>
            <DialogDescription>
              Sends ZPL to your Ethernet label printer, or download the file for
              a local utility.
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
                          {p.name}
                          {p.is_default ? " (default)" : ""} — {p.host}:{p.port}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="copies">Copies</Label>
                <Input
                  id="copies"
                  type="number"
                  min={1}
                  max={20}
                  value={printCopies}
                  onChange={(e) => setPrintCopies(e.target.value)}
                />
              </div>
              {printItem ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{printItem.name}</p>
                  <p className="mt-1 font-mono">{printItem.asset_tag || printItem.sku}</p>
                </div>
              ) : null}
            </div>
            <LabelPreview lines={previewLines} footer={printItem?.asset_tag} />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => void downloadZpl()}>
              <Download className="mr-2 h-4 w-4" />
              Download ZPL
            </Button>
            <Button onClick={() => void sendPrint()} disabled={printing || printers.length === 0}>
              <Printer className="mr-2 h-4 w-4" />
              {printing ? "Sending…" : "Print to network"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
