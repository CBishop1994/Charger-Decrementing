import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Minus,
  MoreHorizontal,
  PackageCheck,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  XCircle,
} from "lucide-react";
import {
  api,
  isSetupRequiredError,
  type Consumable,
  type PrinterSetting,
  type StockOrder,
} from "@/lib/api";
import { copyText, downloadText } from "@/lib/download";
import { downloadRestockReport } from "@/lib/restock-report";
import {
  buildConsumableLabelZpl,
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
  const [adjustNote, setAdjustNote] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  /** Row id currently running a use decrement. */
  const [usingId, setUsingId] = useState<number | null>(null);
  const [useCustomOpen, setUseCustomOpen] = useState(false);
  const [useCustomItem, setUseCustomItem] = useState<Consumable | null>(null);
  const [useCustomQty, setUseCustomQty] = useState("1");
  const [useCustomNote, setUseCustomNote] = useState("");

  const [printOpen, setPrintOpen] = useState(false);
  const [printItem, setPrintItem] = useState<Consumable | null>(null);
  const [printCopies, setPrintCopies] = useState("1");
  const [printing, setPrinting] = useState(false);
  /** Local printers from Zebra Browser Print on this PC. */
  const [bpPrinters, setBpPrinters] = useState<ZebraBrowserPrinter[]>([]);
  const [bpSelectedUid, setBpSelectedUid] = useState("");
  const [bpStatus, setBpStatus] = useState<
    "idle" | "checking" | "online" | "offline"
  >("idle");
  const [bpError, setBpError] = useState<string | null>(null);
  const [bpRefreshing, setBpRefreshing] = useState(false);
  /** Optional saved label-size profiles (width/height/dpi) from Printers page. */
  const [labelProfiles, setLabelProfiles] = useState<PrinterSetting[]>([]);
  const [labelProfileId, setLabelProfileId] = useState("");

  /** Open purchase orders (status = ordered). */
  const [pendingOrders, setPendingOrders] = useState<StockOrder[]>([]);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderItem, setOrderItem] = useState<Consumable | null>(null);
  const [orderQty, setOrderQty] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [ordering, setOrdering] = useState(false);

  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliverOrder, setDeliverOrder] = useState<StockOrder | null>(null);
  const [deliverQty, setDeliverQty] = useState("");
  const [deliverNote, setDeliverNote] = useState("");
  const [delivering, setDelivering] = useState(false);
  const [orderActionId, setOrderActionId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      // "ordered" is filtered client-side against pending orders
      if (status !== "all" && status !== "ordered") params.set("status", status);
      const qs = params.toString();
      const [data, pr, orders] = await Promise.all([
        api.get<Consumable[]>(`/api/consumables${qs ? `?${qs}` : ""}`),
        api
          .get<PrinterSetting[]>("/api/printers")
          .catch(() => [] as PrinterSetting[]),
        api
          .get<StockOrder[]>("/api/stock-orders?status=ordered")
          .catch(() => [] as StockOrder[]),
      ]);
      setItems(data);
      setPendingOrders(orders);
      setLabelProfiles(pr);
      setLabelProfileId((prev) => {
        if (prev) return prev;
        const def = pr.find((p) => p.is_default) ?? pr[0];
        return def ? String(def.id) : "";
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error");
      setLoadError(error);
      setItems([]);
      setPendingOrders([]);
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
  }, [onToast, search, status]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  /** Sum of open ordered qty per consumable. */
  const pendingByItem = useMemo(() => {
    const map = new Map<number, { total: number; orders: StockOrder[] }>();
    for (const o of pendingOrders) {
      const cur = map.get(o.consumable_id) ?? { total: 0, orders: [] };
      cur.total += Number(o.quantity_ordered) || 0;
      cur.orders.push(o);
      map.set(o.consumable_id, cur);
    }
    return map;
  }, [pendingOrders]);

  const visibleItems = useMemo(() => {
    if (status !== "ordered") return items;
    return items.filter((i) => pendingByItem.has(i.id));
  }, [items, status, pendingByItem]);

  const suggestedOrderQty = (item: Consumable) => {
    // Match restock report: target = min × 2, need = max(0, target − on hand − already ordered)
    const target = Math.max(0, (Number(item.min_level) || 0) * 2);
    const already = pendingByItem.get(item.id)?.total ?? 0;
    return Math.max(1, target - (Number(item.quantity) || 0) - already);
  };

  const openOrder = (item: Consumable) => {
    setOrderItem(item);
    setOrderQty(String(suggestedOrderQty(item)));
    setOrderNote("");
    setOrderOpen(true);
  };

  const submitOrder = async () => {
    if (!orderItem) return;
    const qty = Math.trunc(Number(orderQty) || 0);
    if (qty <= 0) {
      onToast({ title: "Enter how many you ordered", variant: "destructive" });
      return;
    }
    setOrdering(true);
    try {
      const created = await api.post<StockOrder>("/api/stock-orders", {
        consumable_id: orderItem.id,
        quantity_ordered: qty,
        note: orderNote.trim(),
      });
      setPendingOrders((prev) => [
        {
          ...created,
          consumable_name: orderItem.name,
          consumable_sku: orderItem.sku,
          consumable_unit: orderItem.unit,
        },
        ...prev,
      ]);
      setOrderOpen(false);
      onToast({
        title: "Marked as ordered",
        description: `${qty} ${orderItem.unit} of ${orderItem.name} — waiting on delivery`,
        variant: "success",
      });
    } catch (err) {
      onToast({
        title: "Could not record order",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setOrdering(false);
    }
  };

  const openDeliver = (order: StockOrder) => {
    setDeliverOrder(order);
    setDeliverQty(String(order.quantity_ordered));
    setDeliverNote("");
    setDeliverOpen(true);
  };

  const submitDeliver = async () => {
    if (!deliverOrder) return;
    const qty = Math.trunc(Number(deliverQty) || 0);
    if (qty <= 0) {
      onToast({
        title: "Enter how many were received",
        variant: "destructive",
      });
      return;
    }
    setDelivering(true);
    try {
      const res = await api.post<{
        order: StockOrder;
        consumable: Consumable;
        quantity_received: number;
        previous_quantity: number;
        new_quantity: number;
        variance: number;
      }>(`/api/stock-orders/${deliverOrder.id}/deliver`, {
        quantity_received: qty,
        note: deliverNote.trim(),
      });
      setPendingOrders((prev) =>
        prev.filter((o) => o.id !== deliverOrder.id),
      );
      setItems((prev) =>
        prev.map((row) =>
          row.id === res.consumable.id ? res.consumable : row,
        ),
      );
      setDeliverOpen(false);
      const variance = res.variance ?? 0;
      onToast({
        title: "Delivery recorded — stock updated",
        description:
          variance === 0
            ? `+${res.quantity_received} → on hand ${res.new_quantity}`
            : `+${res.quantity_received} (ordered ${deliverOrder.quantity_ordered}) → on hand ${res.new_quantity}`,
        variant: "success",
      });
    } catch (err) {
      onToast({
        title: "Could not mark delivered",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDelivering(false);
    }
  };

  const cancelOrder = async (order: StockOrder) => {
    if (
      !window.confirm(
        `Cancel order of ${order.quantity_ordered} for ${order.consumable_name || "this item"}?`,
      )
    ) {
      return;
    }
    setOrderActionId(order.id);
    try {
      await api.post(`/api/stock-orders/${order.id}/cancel`, {});
      setPendingOrders((prev) => prev.filter((o) => o.id !== order.id));
      onToast({ title: "Order cancelled", variant: "success" });
    } catch (err) {
      onToast({
        title: "Cancel failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setOrderActionId(null);
    }
  };

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

  /** Subtract a fixed amount (1 / 10 / 20 / custom). Caps at on-hand qty. */
  const quickUse = async (
    item: Consumable,
    amount: number,
    note = "",
  ) => {
    if (item.quantity <= 0) {
      onToast({
        title: "Already out of stock",
        description: item.name,
        variant: "destructive",
      });
      return;
    }
    const qty = Math.abs(Math.trunc(amount));
    if (!qty) {
      onToast({ title: "Enter a quantity", variant: "destructive" });
      return;
    }
    if (usingId != null) return;

    const used = Math.min(qty, item.quantity);
    setUsingId(item.id);
    // Optimistic UI: drop qty immediately, then reconcile with server.
    setItems((prev) =>
      prev.map((row) =>
        row.id === item.id
          ? { ...row, quantity: Math.max(0, row.quantity - used) }
          : row,
      ),
    );
    try {
      const res = await api.post<{
        consumable: Consumable;
        low_stock: boolean;
        out_of_stock: boolean;
      }>(`/api/consumables/${item.id}/adjust`, {
        delta: -used,
        reason: "use",
        note: note.trim(),
      });
      setItems((prev) =>
        prev.map((row) => (row.id === item.id ? res.consumable : row)),
      );
      onToast({
        title: `Used ${used} ${item.unit}`,
        description: res.out_of_stock
          ? `${item.name} is now out of stock`
          : res.low_stock
            ? `${item.name} is at or below minimum`
            : `${item.name} · qty ${res.consumable.quantity}`,
        variant: res.out_of_stock || res.low_stock ? "default" : "success",
      });
    } catch (err) {
      // Roll back optimistic update
      setItems((prev) =>
        prev.map((row) => (row.id === item.id ? item : row)),
      );
      onToast({
        title: "Could not subtract",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUsingId(null);
    }
  };

  const openUseCustom = (item: Consumable) => {
    setUseCustomItem(item);
    setUseCustomQty("1");
    setUseCustomNote("");
    setUseCustomOpen(true);
  };

  const submitUseCustom = async () => {
    if (!useCustomItem) return;
    const amount = Math.abs(Math.trunc(Number(useCustomQty) || 0));
    if (!amount) {
      onToast({ title: "Enter a quantity", variant: "destructive" });
      return;
    }
    setUseCustomOpen(false);
    await quickUse(useCustomItem, amount, useCustomNote);
  };

  const downloadReport = () => {
    try {
      const result = downloadRestockReport(items);
      if (result.count === 0) {
        onToast({
          title: "Nothing to restock",
          description:
            "No items in the current list are at or below minimum. Clear filters or check other statuses.",
        });
        return;
      }
      onToast({
        title: "Restock report downloaded",
        description: `${result.count} item${result.count === 1 ? "" : "s"} · ${result.totalNeeded} units to order (target = min × 2)`,
        variant: "success",
      });
    } catch (err) {
      onToast({
        title: "Report failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const openRestock = (item: Consumable) => {
    setAdjustItem(item);
    setAdjustDelta("1");
    setAdjustNote("");
    setAdjustOpen(true);
  };

  const submitRestock = async () => {
    if (!adjustItem) return;
    const amount = Math.abs(Math.trunc(Number(adjustDelta) || 0));
    if (!amount) {
      onToast({ title: "Enter a quantity", variant: "destructive" });
      return;
    }
    setAdjusting(true);
    try {
      const res = await api.post<{
        consumable: Consumable;
        low_stock: boolean;
        out_of_stock: boolean;
      }>(`/api/consumables/${adjustItem.id}/adjust`, {
        delta: amount,
        reason: "restock",
        note: adjustNote.trim(),
      });
      onToast({
        title: `Restocked ${amount} ${adjustItem.unit}`,
        description: `New qty: ${res.consumable.quantity}`,
        variant: "success",
      });
      setAdjustOpen(false);
      await load();
    } catch (err) {
      onToast({
        title: "Restock failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAdjusting(false);
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
          "Browser Print is running, but no Zebra printers were found. Open Browser Print and confirm your ZT411 is listed.",
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

  const openPrint = (item: Consumable) => {
    setPrintItem(item);
    setPrintCopies("1");
    setPrintOpen(true);
    void refreshBrowserPrinters();
  };

  /** Single-label ZPL (no batch copies) — used as the base for Browser Print ^PQ. */
  const buildSingleLabelZpl = (): string => {
    if (!printItem) throw new Error("No item selected");
    const profile =
      labelProfiles.find((p) => String(p.id) === labelProfileId) ??
      labelProfiles.find((p) => p.is_default) ??
      labelProfiles[0];
    return finalizeZpl(
      buildConsumableLabelZpl(printItem, {
        widthMm: profile?.label_width_mm ?? 101.6,
        heightMm: profile?.label_height_mm ?? 50.8,
        dpi: profile?.dpi ?? 203,
      }),
    );
  };

  const resolveLabelZpl = async (): Promise<string> => {
    if (!printItem) throw new Error("No item selected");
    const copies = Math.max(1, Math.min(99, Number(printCopies) || 1));
    // Prefer local generation so Browser Print / download work offline.
    const single = buildSingleLabelZpl();
    return withCopies(single, copies);
  };

  const downloadZpl = async () => {
    if (!printItem) return;
    try {
      const zpl = await resolveLabelZpl();
      downloadText(
        zpl,
        `${printItem.asset_tag || printItem.sku}-label.txt`,
        "text/plain;charset=utf-8",
      );
      onToast({
        title: "Label file downloaded",
        description:
          "Raw ZPL backup. Prefer Print labels when Browser Print is running.",
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
    if (!printItem) return;
    try {
      const zpl = await resolveLabelZpl();
      await copyText(zpl);
      onToast({
        title: "ZPL copied",
        description: "Paste into Zebra Setup Utilities if needed.",
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
    if (!printItem) return;
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
        list.find((p) => p.uid === bpSelectedUid) ??
        pickDefaultPrinter(list);
      if (!printer) {
        throw new BrowserPrintError("Select a printer first.", "NO_PRINTERS");
      }
      if (printer.uid !== bpSelectedUid) setBpSelectedUid(printer.uid);

      const zpl = withCopies(buildSingleLabelZpl(), copies);
      await sendZplToBrowserPrint(printer, zpl);

      onToast({
        title:
          copies === 1
            ? "Label sent to printer"
            : `${copies} labels sent to printer`,
        description: `${printer.name} · ${printItem.asset_tag || printItem.sku}`,
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
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="ok">In stock</SelectItem>
              <SelectItem value="low">Low stock</SelectItem>
              <SelectItem value="out">Out of stock</SelectItem>
              <SelectItem value="ordered">
                On order
                {pendingOrders.length > 0 ? ` (${pendingOrders.length})` : ""}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={downloadReport}
            disabled={loading || isSetupRequiredError(loadError)}
            title="CSV of items at/below minimum. Qty to restock = (min × 2) − on hand."
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Restock report
          </Button>
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

      {/* Pending orders strip */}
      {!loading && pendingOrders.length > 0 ? (
        <Card className="border-sky-500/25 bg-sky-500/[0.04]">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-400">
                  <Truck className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-tight">
                    Awaiting delivery
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {pendingOrders.length} open order
                    {pendingOrders.length === 1 ? "" : "s"} · stock is not
                    increased until you mark delivered
                  </p>
                </div>
              </div>
              <Badge
                variant="outline"
                className="border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300"
              >
                <ClipboardList className="mr-1 h-3 w-3" />
                {pendingOrders.reduce(
                  (sum, o) => sum + (Number(o.quantity_ordered) || 0),
                  0,
                )}{" "}
                units inbound
              </Badge>
            </div>
            <div className="divide-y divide-border/70 rounded-lg border border-border/70 bg-background/70">
              {pendingOrders.map((order) => {
                const item = items.find((i) => i.id === order.consumable_id);
                const name =
                  order.consumable_name || item?.name || `Item #${order.consumable_id}`;
                const unit =
                  order.consumable_unit || item?.unit || "ea";
                const sku = order.consumable_sku || item?.sku || "";
                return (
                  <div
                    key={order.id}
                    className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono font-semibold text-foreground">
                          +{order.quantity_ordered}
                        </span>{" "}
                        {unit}
                        {sku ? ` · ${sku}` : ""}
                        {order.ordered_by ? ` · ordered by ${order.ordered_by}` : ""}
                        {order.note ? ` · ${order.note}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => openDeliver(order)}
                        disabled={orderActionId === order.id}
                      >
                        <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
                        Mark delivered
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-muted-foreground"
                        onClick={() => void cancelOrder(order)}
                        disabled={orderActionId === order.id}
                        title="Cancel order"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
              <p className="text-sm font-medium">
                {status === "ordered"
                  ? "No items currently on order"
                  : "No consumables match"}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {status === "ordered"
                  ? "Use Mark ordered on an item after you place a supplier order."
                  : "Create an item to start decrementing stock and printing asset tags."}
              </p>
              {status !== "ordered" ? (
                <Button onClick={openCreate}>Add first item</Button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="hidden md:table-cell">Bin</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">
                      On order
                    </TableHead>
                    <TableHead className="hidden sm:table-cell text-right">
                      Min
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[1%] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleItems.map((item) => {
                    const pending = pendingByItem.get(item.id);
                    return (
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
                            {pending ? (
                              <Badge
                                variant="outline"
                                className="border-sky-500/30 bg-sky-500/10 text-[10px] text-sky-800 dark:text-sky-300"
                              >
                                +{pending.total} on order
                              </Badge>
                            ) : null}
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
                      <TableCell className="hidden lg:table-cell text-right font-mono text-sm tabular-nums">
                        {pending ? (
                          <span className="font-semibold text-sky-700 dark:text-sky-400">
                            +{pending.total}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-right font-mono text-sm tabular-nums text-muted-foreground">
                        {item.min_level}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <StockBadge
                            quantity={item.quantity}
                            minLevel={item.min_level}
                          />
                          {pending ? (
                            <Badge
                              variant="outline"
                              className="border-sky-500/30 bg-sky-500/10 text-[10px] text-sky-800 dark:text-sky-300"
                            >
                              On order
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1 px-2"
                                disabled={
                                  item.quantity <= 0 || usingId === item.id
                                }
                                title="Use stock"
                              >
                                <Minus className="h-3.5 w-3.5" />
                                <span className="hidden text-xs sm:inline">
                                  Use
                                </span>
                                <ChevronDown className="h-3 w-3 opacity-70" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem
                                onClick={() => void quickUse(item, 1)}
                              >
                                Use 1
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={item.quantity < 10}
                                onClick={() => void quickUse(item, 10)}
                              >
                                Use 10
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={item.quantity < 20}
                                onClick={() => void quickUse(item, 20)}
                              >
                                Use 20
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => openUseCustom(item)}
                              >
                                Use custom amount…
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            onClick={() => openOrder(item)}
                            title="Mark ordered"
                          >
                            <ShoppingCart className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            onClick={() => openRestock(item)}
                            title="Restock now (no order)"
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
                              <DropdownMenuItem onClick={() => openOrder(item)}>
                                <ShoppingCart className="mr-2 h-3.5 w-3.5" />
                                Mark ordered…
                              </DropdownMenuItem>
                              {pending?.orders[0] ? (
                                <DropdownMenuItem
                                  onClick={() => openDeliver(pending.orders[0])}
                                >
                                  <PackageCheck className="mr-2 h-3.5 w-3.5" />
                                  Mark delivered…
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem onClick={() => openRestock(item)}>
                                <Plus className="mr-2 h-3.5 w-3.5" />
                                Restock now
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
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
                    );
                  })}
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

      {/* Custom use amount */}
      <Dialog open={useCustomOpen} onOpenChange={setUseCustomOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Use custom amount</DialogTitle>
            <DialogDescription>
              {useCustomItem
                ? `${useCustomItem.name} · on hand ${useCustomItem.quantity} ${useCustomItem.unit}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="use-qty">Quantity to use</Label>
              <Input
                id="use-qty"
                type="number"
                min={1}
                max={useCustomItem?.quantity ?? undefined}
                value={useCustomQty}
                onChange={(e) => setUseCustomQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitUseCustom();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="use-note">Note (optional)</Label>
              <Input
                id="use-note"
                value={useCustomNote}
                onChange={(e) => setUseCustomNote(e.target.value)}
                placeholder="Job #, line, reason…"
              />
            </div>
            {useCustomItem ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                New quantity will be{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {Math.max(
                    0,
                    useCustomItem.quantity -
                      Math.abs(Math.trunc(Number(useCustomQty) || 0)),
                  )}
                </span>
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUseCustomOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitUseCustom()}
              disabled={usingId != null || !useCustomItem}
            >
              {usingId != null ? "Saving…" : "Use stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restock (quantity prompt). */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restock</DialogTitle>
            <DialogDescription>
              {adjustItem
                ? `${adjustItem.name} · on hand ${adjustItem.quantity} ${adjustItem.unit} (min ${adjustItem.min_level})`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="adj-qty">Quantity to add</Label>
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
                placeholder="PO #, delivery, reason…"
              />
            </div>
            {adjustItem ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                New quantity will be{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {adjustItem.quantity +
                    Math.abs(Math.trunc(Number(adjustDelta) || 0))}
                </span>
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitRestock()} disabled={adjusting}>
              {adjusting ? "Saving…" : "Add stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print via Zebra Browser Print (local PC helper) */}
      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Print asset tag</DialogTitle>
            <DialogDescription>
              Sends labels through <strong>Zebra Browser Print</strong> on this
              computer. Set copies to print a batch (e.g. 20).
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
                <p className="text-[11px] text-muted-foreground">
                  {bpStatus === "online" && bpPrinters.length > 0
                    ? "Browser Print connected"
                    : bpStatus === "checking"
                      ? "Checking localhost for Browser Print…"
                      : "Requires Zebra Browser Print running on this PC"}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="copies">Copies (batch)</Label>
                <Input
                  id="copies"
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
              {printItem ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{printItem.name}</p>
                  <p className="mt-1 font-mono">
                    {printItem.asset_tag || printItem.sku}
                  </p>
                </div>
              ) : null}
            </div>
            <LabelPreview lines={previewLines} footer={printItem?.asset_tag} />
          </div>
          {bpError ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              <p className="font-medium">Browser Print</p>
              <p className="mt-0.5">{bpError}</p>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                <li>
                  Install{" "}
                  <a
                    className="underline underline-offset-2"
                    href="https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Zebra Browser Print
                  </a>{" "}
                  on this computer.
                </li>
                <li>Keep it running in the background (system tray).</li>
                <li>
                  Accept the certificate prompt if the browser asks (HTTPS app →
                  local printer).
                </li>
                <li>Click Refresh, then Print labels.</li>
              </ol>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              Labels print from <strong>this PC</strong> via Browser Print — not
              from the cloud. Download remains available as a backup.
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

      {/* Mark ordered */}
      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as ordered</DialogTitle>
            <DialogDescription>
              {orderItem
                ? `${orderItem.name} · on hand ${orderItem.quantity} ${orderItem.unit}`
                : "Record a supplier order. Stock stays the same until delivery."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {orderItem ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <p>
                  Minimum {orderItem.min_level} {orderItem.unit}
                  {(pendingByItem.get(orderItem.id)?.total ?? 0) > 0
                    ? ` · already on order ${pendingByItem.get(orderItem.id)!.total}`
                    : ""}
                </p>
                <p className="mt-0.5">
                  Suggested order qty (to min × 2):{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {suggestedOrderQty(orderItem)}
                  </span>
                </p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="order-qty">How many did you order?</Label>
              <Input
                id="order-qty"
                type="number"
                min={1}
                value={orderQty}
                onChange={(e) => setOrderQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitOrder();
                  }
                }}
                autoFocus
              />
              {orderItem ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    suggestedOrderQty(orderItem),
                    Math.max(1, orderItem.min_level),
                    Math.max(1, orderItem.min_level * 2),
                    10,
                    20,
                    50,
                  ]
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .slice(0, 5)
                    .map((n) => (
                      <Button
                        key={n}
                        type="button"
                        size="sm"
                        variant={String(n) === orderQty ? "default" : "outline"}
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setOrderQty(String(n))}
                      >
                        {n}
                      </Button>
                    ))}
                </div>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-note">Note (optional)</Label>
              <Input
                id="order-note"
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                placeholder="PO number, supplier…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitOrder()} disabled={ordering}>
              <ShoppingCart className="mr-2 h-4 w-4" />
              {ordering ? "Saving…" : "Mark ordered"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark delivered */}
      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark delivered</DialogTitle>
            <DialogDescription>
              {deliverOrder
                ? `${deliverOrder.consumable_name || "Item"} · ordered ${deliverOrder.quantity_ordered}${
                    deliverOrder.consumable_unit
                      ? ` ${deliverOrder.consumable_unit}`
                      : ""
                  }`
                : "Confirm what arrived. On-hand stock will increase by this amount."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-950 dark:text-sky-100">
              Was the delivery the correct amount? Enter the quantity actually
              received — it can differ from the order.
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deliver-qty">Quantity received</Label>
              <Input
                id="deliver-qty"
                type="number"
                min={1}
                value={deliverQty}
                onChange={(e) => setDeliverQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitDeliver();
                  }
                }}
                autoFocus
              />
              {deliverOrder ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      deliverQty === String(deliverOrder.quantity_ordered)
                        ? "default"
                        : "outline"
                    }
                    className="h-7 px-2.5 text-xs"
                    onClick={() =>
                      setDeliverQty(String(deliverOrder.quantity_ordered))
                    }
                  >
                    Full order ({deliverOrder.quantity_ordered})
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deliver-note">Note (optional)</Label>
              <Input
                id="deliver-note"
                value={deliverNote}
                onChange={(e) => setDeliverNote(e.target.value)}
                placeholder="Short / damaged / packing slip #"
              />
            </div>
            {deliverOrder &&
            Math.trunc(Number(deliverQty) || 0) > 0 &&
            Math.trunc(Number(deliverQty) || 0) !==
              Number(deliverOrder.quantity_ordered) ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Variance: ordered {deliverOrder.quantity_ordered}, receiving{" "}
                {Math.trunc(Number(deliverQty) || 0)} (
                {Math.trunc(Number(deliverQty) || 0) -
                  Number(deliverOrder.quantity_ordered) >
                0
                  ? "+"
                  : ""}
                {Math.trunc(Number(deliverQty) || 0) -
                  Number(deliverOrder.quantity_ordered)}
                )
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitDeliver()} disabled={delivering}>
              <PackageCheck className="mr-2 h-4 w-4" />
              {delivering ? "Updating stock…" : "Confirm & add to stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
