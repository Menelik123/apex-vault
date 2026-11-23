"use client";

import { useState, useRef } from "react";

// Safely parse a number from CSV cell — handles empty strings, $, commas, and $0
function parseNum(s: string): number | null {
  const cleaned = s.trim().replace(/[$,]/g, "");
  if (cleaned === "") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
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

interface CSVImportProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  userId: string;
}

const INVENTORY_FIELDS = [
  { key: "brand",          label: "Brand",            required: true  },
  { key: "model",          label: "Model",            required: true  },
  { key: "colorway",       label: "Colorway",         required: false },
  { key: "size",           label: "Size",             required: false },
  { key: "condition",      label: "Condition",        required: false },
  { key: "cost",           label: "Cost Paid ($)",    required: false },
  { key: "asking_price",   label: "Asking Price ($)", required: false },
  { key: "upc",            label: "UPC / Barcode",    required: false },
  { key: "purchased_from", label: "Purchased From",   required: false },
  { key: "sale_channel",   label: "Sale Channel",     required: false },
  { key: "notes",          label: "Notes",            required: false },
] as const;

type FieldKey = typeof INVENTORY_FIELDS[number]["key"];

export default function CSVImport({ open, onClose, onImported, userId }: CSVImportProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "map" | "preview" | "done">("upload");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setStep("upload");
    setColumns([]);
    setRows([]);
    setMapping({});
    setError(null);
    onClose();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (!result.data.length) {
          setError("File is empty or could not be parsed.");
          return;
        }
        const cols = result.meta.fields || [];
        setColumns(cols);
        setRows(result.data);

        // Auto-map columns that closely match field names
        const autoMap: Partial<Record<FieldKey, string>> = {};
        for (const field of INVENTORY_FIELDS) {
          const match = cols.find((c) =>
            c.toLowerCase().replace(/[\s_-]/g, "").includes(field.key.replace("_", ""))
            || c.toLowerCase().includes(field.label.toLowerCase().split(" ")[0])
          );
          if (match) autoMap[field.key] = match;
        }
        setMapping(autoMap);
        setStep("map");
      },
      error: () => setError("Failed to parse file. Make sure it's a valid CSV."),
    });
  }

  function setMap(field: FieldKey, col: string) {
    setMapping((prev) => ({ ...prev, [field]: col === "__none__" ? undefined : col }));
  }

  function getMappedValue(row: Record<string, string>, field: FieldKey): string {
    const col = mapping[field];
    return col ? (row[col] || "") : "";
  }

  async function handleImport() {
    if (!mapping.brand || !mapping.model) {
      setError("You must map Brand and Model columns.");
      return;
    }

    setImporting(true);
    setError(null);

    const records = rows.map((row) => ({
      user_id: userId,
      brand:          getMappedValue(row, "brand"),
      model:          getMappedValue(row, "model"),
      colorway:       getMappedValue(row, "colorway") || null,
      size:           getMappedValue(row, "size") || null,
      condition:      getMappedValue(row, "condition") || "Deadstock",
      cost:           parseNum(getMappedValue(row, "cost")),
      asking_price:   parseNum(getMappedValue(row, "asking_price")),
      upc:            getMappedValue(row, "upc") || null,
      purchased_from: getMappedValue(row, "purchased_from") || null,
      sale_channel:   getMappedValue(row, "sale_channel") || null,
      notes:          getMappedValue(row, "notes") || null,
      sold:           false,
    })).filter((r) => r.brand && r.model);

    const BATCH = 50;
    let count = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const { error } = await supabase.from("inventory").insert(records.slice(i, i + BATCH));
      if (error) { setError(error.message); setImporting(false); return; }
      count += records.slice(i, i + BATCH).length;
    }

    setImportedCount(count);
    setImporting(false);
    setStep("done");
    onImported();
  }

  const previewRows = rows.slice(0, 4);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from CSV</DialogTitle>
        </DialogHeader>

        {/* STEP 1 — Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer hover:bg-muted/40 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <p className="text-2xl mb-2">📂</p>
              <p className="font-medium">Click to upload your CSV file</p>
              <p className="text-sm text-muted-foreground mt-1">
                Export your Google Sheet as CSV: File → Download → CSV
              </p>
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {/* STEP 2 — Map columns */}
        {step === "map" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Match your spreadsheet columns to inventory fields. We auto-detected what we could.
            </p>

            <div className="space-y-3">
              {INVENTORY_FIELDS.map((field) => (
                <div key={field.key} className="grid grid-cols-2 items-center gap-3">
                  <label className="text-sm font-medium">
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </label>
                  <Select
                    value={mapping[field.key] || "__none__"}
                    onValueChange={(v) => setMap(field.key, v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="— skip —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— skip —</SelectItem>
                      {columns.map((col) => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {/* Preview table */}
            {previewRows.length > 0 && mapping.brand && mapping.model && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Preview (first {previewRows.length} rows)</p>
                <div className="rounded-lg border overflow-x-auto text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-3 py-2 text-left">Brand</th>
                        <th className="px-3 py-2 text-left">Model</th>
                        <th className="px-3 py-2 text-left">Size</th>
                        <th className="px-3 py-2 text-right">Cost</th>
                        <th className="px-3 py-2 text-right">Ask</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-2">{getMappedValue(row, "brand") || "—"}</td>
                          <td className="px-3 py-2">{getMappedValue(row, "model") || "—"}</td>
                          <td className="px-3 py-2">{getMappedValue(row, "size") || "—"}</td>
                          <td className="px-3 py-2 text-right">{getMappedValue(row, "cost") ? `$${getMappedValue(row, "cost")}` : "—"}</td>
                          <td className="px-3 py-2 text-right">{getMappedValue(row, "asking_price") ? `$${getMappedValue(row, "asking_price")}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("upload")}>Back</Button>
              <Button
                className="flex-1"
                onClick={handleImport}
                disabled={importing || !mapping.brand || !mapping.model}
              >
                {importing ? `Importing...` : `Import ${rows.length} Items`}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3 — Done */}
        {step === "done" && (
          <div className="text-center space-y-4 py-6">
            <p className="text-4xl">✓</p>
            <p className="text-xl font-bold">{importedCount} items imported</p>
            <p className="text-sm text-muted-foreground">Your inventory is ready.</p>
            <Button className="w-full" onClick={handleClose}>Go to Dashboard</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
