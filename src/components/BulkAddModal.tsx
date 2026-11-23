"use client";

import { useState, lazy, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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

const BarcodeScanner = lazy(() => import("./BarcodeScanner"));

interface BulkAddModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  userId: string;
}

const CONDITIONS = ["Deadstock", "Near Deadstock", "Very Good", "Good", "Fair"] as const;
const CHANNELS = ["StockX", "GOAT", "eBay", "Instagram", "Personal", "Other"] as const;

const EMPTY_FORM = {
  brand: "", model: "", colorway: "", size: "",
  condition: "Deadstock", cost: "", asking_price: "",
  upc: "", purchased_from: "", sale_channel: "", notes: "",
};

type FormData = typeof EMPTY_FORM;

type QueueItem = FormData & { _id: number };

export default function BulkAddModal({ open, onClose, onAdded, userId }: BulkAddModalProps) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState(0);

  function set(field: string, value: string) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  function handleClose() {
    setForm(EMPTY_FORM);
    setQueue([]);
    setScanning(false);
    setError(null);
    onClose();
  }

  async function handleScan(upc: string) {
    setScanning(false);
    set("upc", upc);
    setLookingUp(true);
    try {
      const res = await fetch(`/api/lookup?upc=${upc}`);
      const data = await res.json();
      if (res.ok && data.brand) {
        setForm((p) => ({
          ...p,
          upc,
          brand: data.brand || p.brand,
          model: data.model || p.model,
          colorway: data.colorway || p.colorway,
          size: data.size || p.size,
        }));
      } else {
        set("upc", upc);
      }
    } catch {
      set("upc", upc);
    }
    setLookingUp(false);
  }

  function addToQueue() {
    if (!form.brand || !form.model) {
      setError("Brand and model are required.");
      return;
    }
    setError(null);
    setQueue((p) => [...p, { ...form, _id: counter }]);
    setCounter((c) => c + 1);
    // Keep common fields, clear item-specific ones
    setForm((p) => ({
      ...EMPTY_FORM,
      condition: p.condition,
      purchased_from: p.purchased_from,
      sale_channel: p.sale_channel,
    }));
  }

  function removeFromQueue(id: number) {
    setQueue((p) => p.filter((item) => item._id !== id));
  }

  async function saveAll() {
    if (queue.length === 0) return;
    setSaving(true);
    setError(null);

    const records = queue.map((item) => ({
      user_id: userId,
      brand:          item.brand,
      model:          item.model,
      colorway:       item.colorway || null,
      size:           item.size || null,
      condition:      item.condition,
      cost:           item.cost ? parseFloat(item.cost) : null,
      asking_price:   item.asking_price ? parseFloat(item.asking_price) : null,
      upc:            item.upc || null,
      purchased_from: item.purchased_from || null,
      sale_channel:   item.sale_channel || null,
      notes:          item.notes || null,
      sold:           false,
    }));

    const BATCH = 50;
    for (let i = 0; i < records.length; i += BATCH) {
      const { error: err } = await supabase.from("inventory").insert(records.slice(i, i + BATCH));
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onAdded();
    handleClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Bulk Add Inventory
            {queue.length > 0 && (
              <Badge className="bg-primary text-primary-foreground text-xs">
                {queue.length} queued
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* ── LEFT: Entry Form ── */}
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Fill in each shoe and hit <strong>Add to Queue</strong>. Save all when done.</p>

            {scanning ? (
              <Suspense fallback={<div className="text-sm text-muted-foreground">Loading camera...</div>}>
                <BarcodeScanner onScan={handleScan} onClose={() => setScanning(false)} />
              </Suspense>
            ) : (
              <>
                {lookingUp && <p className="text-xs text-primary animate-pulse">Looking up shoe...</p>}

                {/* UPC row */}
                <div className="space-y-1">
                  <Label className="text-xs">UPC / Barcode</Label>
                  <div className="flex gap-2">
                    <Input placeholder="Scan or enter" value={form.upc} onChange={(e) => set("upc", e.target.value)} className="text-sm" />
                    <Button type="button" size="sm" variant="outline" onClick={() => setScanning(true)}>Scan</Button>
                  </div>
                </div>

                {/* Brand + Model */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Brand *</Label>
                    <Input placeholder="Nike" value={form.brand} onChange={(e) => set("brand", e.target.value)} className="text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Model *</Label>
                    <Input placeholder="Air Jordan 4" value={form.model} onChange={(e) => set("model", e.target.value)} className="text-sm" />
                  </div>
                </div>

                {/* Colorway + Size */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Colorway</Label>
                    <Input placeholder="Bred" value={form.colorway} onChange={(e) => set("colorway", e.target.value)} className="text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Size</Label>
                    <Input placeholder="10.5" value={form.size} onChange={(e) => set("size", e.target.value)} className="text-sm" />
                  </div>
                </div>

                {/* Cost + Ask */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Cost ($)</Label>
                    <Input type="number" min="0" step="0.01" placeholder="180" value={form.cost} onChange={(e) => set("cost", e.target.value)} className="text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Ask ($)</Label>
                    <Input type="number" min="0" step="0.01" placeholder="350" value={form.asking_price} onChange={(e) => set("asking_price", e.target.value)} className="text-sm" />
                  </div>
                </div>

                {/* Condition */}
                <div className="space-y-1">
                  <Label className="text-xs">Condition</Label>
                  <Select value={form.condition} onValueChange={(v) => set("condition", v)}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* Purchased From */}
                <div className="space-y-1">
                  <Label className="text-xs">Purchased From</Label>
                  <Input placeholder="SNKRS, eBay, local..." value={form.purchased_from} onChange={(e) => set("purchased_from", e.target.value)} className="text-sm" />
                </div>

                {/* Sale Channel */}
                <div className="space-y-1">
                  <Label className="text-xs">Sale Channel</Label>
                  <Select value={form.sale_channel} onValueChange={(v) => set("sale_channel", v)}>
                    <SelectTrigger className="text-sm"><SelectValue placeholder="Where will you sell?" /></SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}

                <Button className="w-full" onClick={addToQueue}>
                  + Add to Queue
                </Button>
              </>
            )}
          </div>

          {/* ── RIGHT: Queue ── */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Queue {queue.length > 0 ? `(${queue.length} shoes)` : "— empty"}
            </p>

            {queue.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Items you add will appear here before saving
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {queue.map((item) => {
                  const margin = (parseFloat(item.asking_price) || 0) - (parseFloat(item.cost) || 0);
                  return (
                    <div key={item._id} className="flex items-start justify-between gap-2 p-2 rounded-lg border border-border bg-card text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-xs truncate">{item.brand} {item.model}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.size ? `Sz ${item.size}` : ""} {item.colorway || ""}
                        </p>
                        <div className="flex gap-2 mt-0.5">
                          {item.cost && <span className="text-xs text-muted-foreground">Cost: ${item.cost}</span>}
                          {item.asking_price && <span className="text-xs text-muted-foreground">Ask: ${item.asking_price}</span>}
                          {item.cost && item.asking_price && (
                            <span className={`text-xs font-medium ${margin >= 0 ? "text-green-400" : "text-red-400"}`}>
                              +${margin.toFixed(0)}
                            </span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => removeFromQueue(item._id)} className="text-muted-foreground hover:text-destructive text-xs shrink-0 mt-0.5">✕</button>
                    </div>
                  );
                })}
              </div>
            )}

            {queue.length > 0 && (
              <div className="pt-2 space-y-2 border-t border-border">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Total cost in:</span>
                  <span>${queue.reduce((s, i) => s + (parseFloat(i.cost) || 0), 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Total asking:</span>
                  <span>${queue.reduce((s, i) => s + (parseFloat(i.asking_price) || 0), 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs font-medium">
                  <span>Potential profit:</span>
                  <span className="text-green-400">
                    ${(queue.reduce((s, i) => s + (parseFloat(i.asking_price) || 0), 0) -
                       queue.reduce((s, i) => s + (parseFloat(i.cost) || 0), 0)).toLocaleString()}
                  </span>
                </div>
                <Button className="w-full" onClick={saveAll} disabled={saving}>
                  {saving ? "Saving..." : `Save All ${queue.length} Items`}
                </Button>
                <Button variant="outline" className="w-full" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
