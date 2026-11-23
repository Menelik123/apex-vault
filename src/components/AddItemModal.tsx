"use client";

import { useState, useEffect, useRef, lazy, Suspense, useCallback } from "react";
import { supabase, type InventoryItem } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface AddItemModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  userId: string;
  item?: InventoryItem;
}

interface SearchResult {
  name: string;
  brand: string;
  colorway: string;
  retailPrice: number;
  thumbnail: string;
  styleID: string;
}

const CONDITIONS = ["Deadstock", "Near Deadstock", "Very Good", "Good", "Fair"] as const;
const CHANNELS = ["StockX", "GOAT", "eBay", "Instagram", "Personal", "Other"] as const;

const EMPTY_FORM = {
  brand: "",
  model: "",
  colorway: "",
  size: "",
  condition: "Deadstock",
  cost: "",
  asking_price: "",
  upc: "",
  sale_channel: "",
  purchased_from: "",
  notes: "",
};

export default function AddItemModal({ open, onClose, onAdded, userId, item }: AddItemModalProps) {
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedThumbnail, setSelectedThumbnail] = useState<string | null>(null);
  const [selectedShoeName, setSelectedShoeName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  useEffect(() => {
    if (open && item) {
      setForm({
        brand: item.brand || "",
        model: item.model || "",
        colorway: item.colorway || "",
        size: item.size || "",
        condition: item.condition || "Deadstock",
        cost: item.cost != null ? String(item.cost) : "",
        asking_price: item.asking_price != null ? String(item.asking_price) : "",
        upc: item.upc || "",
        sale_channel: item.sale_channel || "",
        purchased_from: item.purchased_from || "",
        notes: item.notes || "",
      });
      setPhotoPreview(item.photo_url || null);
      setSelectedThumbnail(null);
      setSelectedShoeName(null);
    }
  }, [open, item]);

  function handleClose() {
    abortRef.current?.abort();
    abortRef.current = null;
    setForm(EMPTY_FORM);
    setSearchQuery("");
    setSearchResults([]);
    setError(null);
    setScanning(false);
    setPhotoFile(null);
    setPhotoPreview(null);
    setSelectedThumbnail(null);
    setSelectedShoeName(null);
    onClose();
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  // Search sneaker database by name — aborts any previous in-flight request
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    setSelectedShoeName(null);

    if (query.length < 3) {
      abortRef.current?.abort();
      abortRef.current = null;
      setSearchResults([]);
      setSearching(false);
      return;
    }

    // Cancel previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      // Ignore aborted fetches — they're intentional
      if ((err as Error).name !== "AbortError") {
        setSearchResults([]);
      }
    }
    setSearching(false);
  }, []);

  // User taps a search result — cancel any pending search, auto-fill form + photo
  function selectResult(result: SearchResult) {
    // Kill any in-flight request so stale results don't repopulate the dropdown
    abortRef.current?.abort();
    abortRef.current = null;

    setForm((prev) => ({
      ...prev,
      brand: result.brand || prev.brand,
      model: result.name || prev.model,
      colorway: result.colorway || prev.colorway,
      asking_price: result.retailPrice ? String(result.retailPrice) : prev.asking_price,
    }));
    if (result.thumbnail) {
      setPhotoPreview(result.thumbnail);
      setSelectedThumbnail(result.thumbnail);
    }
    setSelectedShoeName(result.name);
    setSearchQuery("");
    setSearchResults([]);
    setSearching(false);
  }

  // Barcode scan → try UPC lookup, fall back to search
  async function handleScan(upc: string) {
    setScanning(false);
    setForm((prev) => ({ ...prev, upc }));
    setLookingUp(true);
    setError(null);

    try {
      const res = await fetch(`/api/lookup?upc=${upc}`);
      const data = await res.json();

      if (res.ok && data.brand) {
        setForm((prev) => ({
          ...prev,
          brand: data.brand,
          model: data.model,
          size: data.size || prev.size,
        }));
      } else {
        // UPC not found — prompt user to search by name
        setError("UPC not found. Search by shoe name below to auto-fill.");
      }
    } catch {
      setError("UPC not found. Search by shoe name below to auto-fill.");
    }

    setLookingUp(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.brand || !form.model) {
      setError("Brand and model are required.");
      return;
    }
    setLoading(true);
    setError(null);

    // Priority: 1) newly uploaded file  2) thumbnail from search  3) existing photo (edit mode)
    let photo_url: string | null = item?.photo_url ?? selectedThumbnail ?? null;
    if (photoFile) {
      const ext = photoFile.name.split(".").pop();
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("shoes").upload(path, photoFile);
      if (!upErr) {
        const { data } = supabase.storage.from("shoes").getPublicUrl(path);
        photo_url = data.publicUrl;
      }
    }

    const payload = {
      brand: form.brand,
      model: form.model,
      colorway: form.colorway || null,
      size: form.size || null,
      condition: form.condition,
      cost: form.cost ? parseFloat(form.cost) : null,
      asking_price: form.asking_price ? parseFloat(form.asking_price) : null,
      upc: form.upc || null,
      sale_channel: form.sale_channel || null,
      purchased_from: form.purchased_from || null,
      notes: form.notes || null,
      photo_url,
    };

    if (item) {
      const { error } = await supabase.from("inventory").update(payload).eq("id", item.id);
      setLoading(false);
      if (error) {
        setError(error.message);
      } else {
        onAdded();
        handleClose();
      }
    } else {
      const { error } = await supabase.from("inventory").insert({ user_id: userId, ...payload });
      setLoading(false);
      if (error) {
        setError(error.message);
      } else {
        setForm(EMPTY_FORM);
        setSearchQuery("");
        setSearchResults([]);
        setPhotoFile(null);
        setPhotoPreview(null);
        setSelectedShoeName(null);
        onAdded();
        onClose();
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-full max-w-lg mx-auto max-h-[95dvh] overflow-y-auto p-4 sm:p-6 rounded-t-2xl sm:rounded-2xl fixed bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 translate-y-0">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-lg">{item ? "Edit Item" : "Add Item"}</DialogTitle>
        </DialogHeader>

        {scanning ? (
          <Suspense fallback={<div className="text-sm text-muted-foreground">Loading camera...</div>}>
            <BarcodeScanner onScan={handleScan} onClose={() => setScanning(false)} />
          </Suspense>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Shoe search — only shown when adding, not editing */}
            {!item && <div className="space-y-1">
              <Label>Search Shoe Name</Label>

              {/* Selected shoe confirmation chip */}
              {selectedShoeName ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
                  <span className="text-sm font-medium text-primary flex-1 truncate">{selectedShoeName}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedShoeName(null);
                      setSelectedThumbnail(null);
                      setPhotoPreview(null);
                      setForm((prev) => ({ ...prev, brand: "", model: "", colorway: "", asking_price: "" }));
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    placeholder="e.g. Yeezy Slide, Jordan 4, Nike Dunk..."
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    autoComplete="off"
                  />
                  {searching && (
                    <p className="text-xs text-muted-foreground animate-pulse">Searching...</p>
                  )}
                  {searchResults.length > 0 && (
                    <div className="border rounded-lg overflow-hidden divide-y max-h-48 overflow-y-auto">
                      {searchResults.map((result, i) => (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={(e) => {
                            // Use onMouseDown so click fires before input blur
                            e.preventDefault();
                            selectResult(result);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted text-left transition-colors"
                        >
                          {result.thumbnail && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={result.thumbnail} alt="" className="w-10 h-10 object-contain rounded shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{result.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{result.brand} · {result.colorway}</p>
                          </div>
                          {result.retailPrice > 0 && (
                            <span className="text-xs text-muted-foreground ml-auto shrink-0">${result.retailPrice}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>}

            {/* Status messages */}
            {lookingUp && (
              <p className="text-sm text-muted-foreground text-center animate-pulse">Looking up barcode...</p>
            )}
            {error && <p className="text-sm text-amber-600">{error}</p>}

            {/* Scan button */}
            <div className="space-y-1">
              <Label>Barcode / UPC</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Scan or enter manually"
                  value={form.upc}
                  onChange={(e) => set("upc", e.target.value)}
                />
                <Button type="button" variant="outline" onClick={() => setScanning(true)}>
                  Scan
                </Button>
              </div>
            </div>

            {/* Form fields — pre-filled from search or editable */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Brand *</Label>
                <Input placeholder="Nike" value={form.brand} onChange={(e) => set("brand", e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label>Model *</Label>
                <Input placeholder="Air Jordan 4" value={form.model} onChange={(e) => set("model", e.target.value)} required />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Colorway</Label>
              <Input placeholder="Off-White" value={form.colorway} onChange={(e) => set("colorway", e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Size</Label>
                <Input placeholder="10.5" value={form.size} onChange={(e) => set("size", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Condition</Label>
                <Select value={form.condition} onValueChange={(v) => set("condition", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Cost Paid ($)</Label>
                <Input type="number" min="0" step="0.01" placeholder="200" value={form.cost} onChange={(e) => set("cost", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Asking Price ($)</Label>
                <Input type="number" min="0" step="0.01" placeholder="400" value={form.asking_price} onChange={(e) => set("asking_price", e.target.value)} />
              </div>
            </div>

            {/* Photo upload */}
            <div className="space-y-1">
              <Label>Photo</Label>
              <div className="flex items-center gap-3">
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoPreview} alt="" className="w-16 h-16 object-cover rounded-lg border border-border" />
                ) : (
                  <div className="w-16 h-16 rounded-lg border border-dashed border-border flex items-center justify-center text-2xl bg-muted/20">👟</div>
                )}
                <div className="space-y-0.5">
                  <label className="cursor-pointer block">
                    <span className="text-sm text-primary underline">
                      {photoPreview ? "Change photo" : "Upload photo"}
                    </span>
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoChange} />
                  </label>
                  {selectedThumbnail && !photoFile && (
                    <p className="text-xs text-muted-foreground">Auto-filled from search</p>
                  )}
                </div>
              </div>
            </div>

            {/* Purchased from */}
            <div className="space-y-1">
              <Label>Purchased From</Label>
              <Input placeholder="e.g. Nike SNKRS, Flight Club, eBay, Local..." value={form.purchased_from} onChange={(e) => set("purchased_from", e.target.value)} />
            </div>

            {/* Sale channel */}
            <div className="space-y-1">
              <Label>Sale Channel</Label>
              <Select value={form.sale_channel} onValueChange={(v) => set("sale_channel", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Where will you sell?" />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Notes</Label>
              <Input placeholder="Any additional info..." value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? "Saving..." : item ? "Save Changes" : "Add to Inventory"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
