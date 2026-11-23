"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

type Transaction = {
  date: string;
  description: string;
  amount: number;
  type: "debit" | "credit";
};

type Category = {
  name: string;
  total: number;
  count: number;
  isIncome?: boolean;
  transactions: Transaction[];
};

type ParsedStatement = {
  summary: {
    totalIncome: number;
    totalExpenses: number;
    netCashFlow: number;
    dateRange: string;
    transactionCount: number;
  };
  categories: Category[];
};

type SavedStatement = {
  id: string;
  filename: string;
  session_name: string | null;
  parsed_data: ParsedStatement;
  created_at: string;
};

// Merge multiple parsed statements into one combined view
function combineStatements(statements: SavedStatement[]): ParsedStatement {
  const categoryMap: Record<string, Category> = {};
  let totalIncome = 0;
  let totalExpenses = 0;
  let transactionCount = 0;
  const dateRanges: string[] = [];

  statements.forEach((s) => {
    const data = s.parsed_data;
    totalIncome += data.summary.totalIncome;
    totalExpenses += data.summary.totalExpenses;
    transactionCount += data.summary.transactionCount;
    if (data.summary.dateRange) dateRanges.push(data.summary.dateRange);

    data.categories.forEach((cat) => {
      if (!categoryMap[cat.name]) {
        categoryMap[cat.name] = { ...cat, transactions: [...cat.transactions] };
      } else {
        categoryMap[cat.name].total += cat.total;
        categoryMap[cat.name].count += cat.count;
        categoryMap[cat.name].transactions = [
          ...categoryMap[cat.name].transactions,
          ...cat.transactions,
        ];
      }
    });
  });

  const categories = Object.values(categoryMap).sort((a, b) => {
    if (a.isIncome && !b.isIncome) return -1;
    if (!a.isIncome && b.isIncome) return 1;
    return b.total - a.total;
  });

  return {
    summary: {
      totalIncome,
      totalExpenses,
      netCashFlow: totalIncome - totalExpenses,
      dateRange: dateRanges.length > 0 ? dateRanges.join(" · ") : "",
      transactionCount,
    },
    categories,
  };
}

const CATEGORY_COLORS: Record<string, string> = {
  "Sales Income": "bg-green-500/20 text-green-300 border-green-500/30",
  "Inventory": "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  "Shipping & Fulfillment": "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "Platform Fees": "bg-purple-500/20 text-purple-300 border-purple-500/30",
  "Food & Dining": "bg-orange-500/20 text-orange-300 border-orange-500/30",
  "Gas & Transportation": "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  "Rent & Utilities": "bg-red-500/20 text-red-300 border-red-500/30",
  "Marketing & Advertising": "bg-pink-500/20 text-pink-300 border-pink-500/30",
};

function catColor(name: string) {
  return CATEGORY_COLORS[name] || "bg-muted/30 text-muted-foreground border-border";
}

const DEMO_MULTIPLIER = 3.8;

function applyDemoMultiplier(data: ParsedStatement): ParsedStatement {
  return {
    summary: {
      ...data.summary,
      totalIncome: Math.round(data.summary.totalIncome * DEMO_MULTIPLIER),
      totalExpenses: Math.round(data.summary.totalExpenses * DEMO_MULTIPLIER),
      netCashFlow: Math.round(data.summary.netCashFlow * DEMO_MULTIPLIER),
    },
    categories: data.categories.map((cat) => ({
      ...cat,
      total: Math.round(cat.total * DEMO_MULTIPLIER * 100) / 100,
      transactions: cat.transactions.map((tx) => ({
        ...tx,
        amount: Math.round(tx.amount * DEMO_MULTIPLIER * 100) / 100,
      })),
    })),
  };
}

export default function StatementParser({ demo = false }: { demo?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedStatement[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<{ result: ParsedStatement; label: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchSaved = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase
      .from("statements")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });
    if (data) setSaved(data);
    setLoadingSaved(false);
  }, []);

  useEffect(() => { fetchSaved(); }, [fetchSaved]);

  async function handleParse() {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const form = new FormData();
      form.append("file", file);
      // Step 1 — parse the file
      const res = await fetch("/api/parse-statement", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to parse statement");

      // Show results immediately — don't wait for save
      const label = sessionName.trim() || file.name;
      setActiveView({ result: data, label });

      // Step 2 — save to Supabase (non-blocking, won't break results if it fails)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const insertData: Record<string, unknown> = {
            user_id: session.user.id,
            filename: file.name,
            parsed_data: data,
          };
          // Only include session_name if provided (handles missing column gracefully)
          if (sessionName.trim()) insertData.session_name = sessionName.trim();

          const { data: savedRow, error: saveErr } = await supabase
            .from("statements")
            .insert(insertData)
            .select()
            .single();

          if (savedRow && !saveErr) {
            setSaved((p) => [savedRow, ...p]);
            setSelected((prev) => [...prev, savedRow.id]);
          } else if (saveErr) {
            console.warn("Save failed (results still shown):", saveErr.message);
          }
        }
      } catch (saveErr) {
        console.warn("Could not save statement:", saveErr);
      }

      setFile(null);
      setSessionName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Check that your Anthropic API key is set in Vercel.");
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function viewCombined() {
    const selectedStatements = saved.filter((s) => selected.includes(s.id));
    if (selectedStatements.length === 0) return;
    if (selectedStatements.length === 1) {
      const s = selectedStatements[0];
      setActiveView({ result: s.parsed_data, label: s.session_name || s.filename });
    } else {
      const combined = combineStatements(selectedStatements);
      setActiveView({ result: combined, label: `Combined: ${selectedStatements.length} statements` });
    }
    setExpanded(null);
  }

  async function deleteSaved(id: string) {
    await supabase.from("statements").delete().eq("id", id);
    setSaved((p) => p.filter((s) => s.id !== id));
    setSelected((p) => p.filter((x) => x !== id));
  }

  function exportCSV() {
    if (!activeView) return;
    const rows: string[][] = [["Date", "Description", "Category", "Type", "Amount"]];
    activeView.result.categories.forEach((cat) => {
      cat.transactions.forEach((tx) => {
        rows.push([tx.date, tx.description, cat.name, tx.type, String(tx.amount)]);
      });
    });
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeView.label.replace(/[^a-z0-9]/gi, "-")}-breakdown.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const result = activeView ? (demo ? applyDemoMultiplier(activeView.result) : activeView.result) : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* ── LEFT PANEL ── */}
        <div className="space-y-4">

          {/* Upload section */}
          <div className="rounded-lg border border-border p-4 space-y-3">
            <h3 className="font-semibold text-sm">Upload Statement</h3>

            <div
              className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {file ? (
                <div>
                  <p className="text-xs font-medium text-primary truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · tap to change</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-2xl">📄</p>
                  <p className="text-xs font-medium">Tap to upload</p>
                  <p className="text-xs text-muted-foreground">PDF or CSV</p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.csv,application/pdf,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setError(null); } }}
              />
            </div>

            <Input
              placeholder='Label (e.g. "March – Chase Debit")'
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              className="text-sm"
            />

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button onClick={handleParse} disabled={!file || loading} className="w-full" size="sm">
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Parsing...
                </span>
              ) : "Parse & Save"}
            </Button>
          </div>

          {/* Saved list with checkboxes */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Saved Statements</h3>

            {loadingSaved ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : saved.length === 0 ? (
              <p className="text-xs text-muted-foreground">No saved statements yet.</p>
            ) : (
              saved.map((s) => (
                <div
                  key={s.id}
                  className={`rounded-lg border p-3 transition-colors ${selected.includes(s.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(s.id)}
                      onChange={() => toggleSelect(s.id)}
                      className="accent-primary mt-0.5 shrink-0"
                    />
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
                      setActiveView({ result: s.parsed_data, label: s.session_name || s.filename });
                      setExpanded(null);
                    }}>
                      <p className="text-xs font-medium truncate">{s.session_name || s.filename}</p>
                      {s.session_name && <p className="text-xs text-muted-foreground truncate">{s.filename}</p>}
                      <p className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</p>
                      <div className="flex gap-2 mt-0.5">
                        <span className="text-xs text-green-400">+${(demo ? Math.round(s.parsed_data.summary.totalIncome * DEMO_MULTIPLIER) : s.parsed_data.summary.totalIncome).toLocaleString()}</span>
                        <span className="text-xs text-red-400">-${(demo ? Math.round(s.parsed_data.summary.totalExpenses * DEMO_MULTIPLIER) : s.parsed_data.summary.totalExpenses).toLocaleString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSaved(s.id); }}
                      className="text-muted-foreground hover:text-destructive text-xs shrink-0"
                    >✕</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Combine button — always visible when 2+ selected */}
          {selected.length >= 2 && (
            <Button className="w-full" onClick={viewCombined}>
              Combine {selected.length} Statements →
            </Button>
          )}
          {selected.length === 1 && (
            <Button variant="outline" className="w-full" onClick={viewCombined}>
              View Statement →
            </Button>
          )}
        </div>

        {/* ── RIGHT PANEL — Results ── */}
        <div className="md:col-span-2 space-y-4">
          {!result ? (
            <div className="rounded-lg border border-dashed border-border p-12 text-center space-y-2">
              <p className="text-muted-foreground text-sm">Upload a statement or select saved ones to view breakdown</p>
              <p className="text-xs text-muted-foreground">Select multiple statements + click Combine to see a unified view across all accounts</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-semibold text-sm">{activeView?.label}</h3>
                  {result.summary.dateRange && (
                    <p className="text-xs text-muted-foreground">{result.summary.dateRange}</p>
                  )}
                  {selected.length > 1 && (
                    <p className="text-xs text-primary mt-0.5">{selected.length} statements combined</p>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={exportCSV}>Export CSV</Button>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Total In", value: `$${result.summary.totalIncome.toLocaleString()}`, color: "text-green-400" },
                  { label: "Total Out", value: `$${result.summary.totalExpenses.toLocaleString()}`, color: "text-red-400" },
                  {
                    label: "Net Cash Flow",
                    value: `$${result.summary.netCashFlow.toLocaleString()}`,
                    color: result.summary.netCashFlow >= 0 ? "text-green-400" : "text-red-400",
                  },
                  { label: "Transactions", value: result.summary.transactionCount, color: "text-foreground" },
                ].map((s) => (
                  <Card key={s.label} className="bg-card border-border">
                    <CardHeader className="pb-1 pt-3 px-3">
                      <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Category breakdown */}
              <div className="space-y-2">
                {result.categories.map((cat) => (
                  <div key={cat.name} className="rounded-lg border border-border overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors text-left"
                      onClick={() => setExpanded(expanded === cat.name ? null : cat.name)}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`text-xs border ${catColor(cat.name)}`}>{cat.name}</Badge>
                        <span className="text-xs text-muted-foreground">{cat.count} transactions</span>
                        {cat.isIncome && <span className="text-xs text-green-400 font-medium">INCOME</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold text-sm ${cat.isIncome ? "text-green-400" : "text-red-400"}`}>
                          {cat.isIncome ? "+" : "-"}${cat.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                        <span className="text-muted-foreground text-xs">{expanded === cat.name ? "▲" : "▼"}</span>
                      </div>
                    </button>

                    {expanded === cat.name && (
                      <div className="border-t border-border overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-muted/10">
                              <th className="px-4 py-2 text-left text-xs text-muted-foreground whitespace-nowrap">Date</th>
                              <th className="px-4 py-2 text-left text-xs text-muted-foreground">Description</th>
                              <th className="px-4 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cat.transactions
                              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                              .map((tx, i) => (
                                <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/10">
                                  <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{tx.date}</td>
                                  <td className="px-4 py-2 text-xs">{tx.description}</td>
                                  <td className={`px-4 py-2 text-xs text-right font-medium whitespace-nowrap ${tx.type === "credit" ? "text-green-400" : "text-red-400"}`}>
                                    {tx.type === "credit" ? "+" : "-"}${Math.abs(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
