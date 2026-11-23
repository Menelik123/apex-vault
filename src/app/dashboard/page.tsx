"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, type InventoryItem, type Expense } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AddItemModal from "@/components/AddItemModal";
import CSVImport from "@/components/CSVImport";
import BulkAddModal from "@/components/BulkAddModal";
import StatementParser from "@/components/StatementParser";

type Tab = "inventory" | "expenses" | "statements";
type SortKey = "created_at" | "brand" | "cost" | "asking_price" | "margin";

const CHANNELS = ["StockX", "GOAT", "eBay", "Instagram", "Personal", "Other"];
const EXPENSE_CATEGORIES = ["Shipping", "Fees", "Storage", "Tools & Software", "Marketing", "Travel", "Other"];

function formatExpMonth(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("default", { month: "short", year: "numeric" });
}

function DashboardPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [demoMode, setDemoMode] = useState(searchParams.get("demo") === "1");

  const DEMO_STATS = {
    activeCount: 47,
    totalCost: 18450,
    totalValue: 31200,
    netProfit: 5840,
    totalExpenses: 3120,
    realizedRevenue: 8960,
  };

  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("inventory");

  // Inventory state
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSaleChannel, setBulkSaleChannel] = useState("");

  // Filters & sort
  const [search, setSearch] = useState("");
  const [filterBrand, setFilterBrand] = useState("__all__");
  const [filterStatus, setFilterStatus] = useState("__all__");
  const [filterCondition, setFilterCondition] = useState("__all__");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Expenses state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expLoading, setExpLoading] = useState(false);
  const [expForm, setExpForm] = useState({ description: "", amount: "", category: "Other", date: new Date().toISOString().slice(0, 10), notes: "" });
  const [expSaving, setExpSaving] = useState(false);

  // Bulk scan
  const [bulkScanning, setBulkScanning] = useState(false);
  const [bulkQueue, setBulkQueue] = useState<string[]>([]);
  const bulkScanRef = useRef(false);

  // Edit item
  const [showEdit, setShowEdit] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);

  // Sold price capture
  const [soldDialog, setSoldDialog] = useState<{ item: InventoryItem } | null>(null);
  const [soldPriceInput, setSoldPriceInput] = useState("");
  const [soldChannelInput, setSoldChannelInput] = useState("");

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; label: string } | null>(null);

  // Expense month filter
  const [expMonthFilter, setExpMonthFilter] = useState("__all__");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push("/login");
      else setUserId(session.user.id);
    });
  }, [router]);

  const fetchInventory = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await supabase
      .from("inventory").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (data) setInventory(data);
    setLoading(false);
  }, [userId]);

  const fetchExpenses = useCallback(async () => {
    if (!userId) return;
    setExpLoading(true);
    const { data } = await supabase
      .from("expenses").select("*").eq("user_id", userId).order("date", { ascending: false });
    if (data) setExpenses(data);
    setExpLoading(false);
  }, [userId]);

  useEffect(() => { if (userId) { fetchInventory(); fetchExpenses(); } }, [userId, fetchInventory, fetchExpenses]);

  // ── Inventory actions ──────────────────────────────────────────
  function handleDelete(id: string) {
    const it = inventory.find((i) => i.id === id);
    setDeleteConfirm({ ids: [id], label: it ? `${it.brand} ${it.model}` : "this item" });
  }

  async function toggleSold(item: InventoryItem) {
    if (!item.sold) {
      // Marking as sold — show price + channel capture dialog
      setSoldPriceInput(item.asking_price ? String(item.asking_price) : "");
      setSoldChannelInput(item.sale_channel || "");
      setSoldDialog({ item });
    } else {
      // Marking as unsold — just clear it
      const { error } = await supabase.from("inventory").update({ sold: false, sold_price: null }).eq("id", item.id);
      if (error) { alert(`Failed to update: ${error.message}`); return; }
      setInventory((p) => p.map((i) => i.id === item.id ? { ...i, sold: false, sold_price: null } : i));
    }
  }

  async function handleConfirmSold(price: number | null, channel: string | null) {
    if (!soldDialog) return;
    const { error } = await supabase.from("inventory").update({ sold: true, sold_price: price, sale_channel: channel || null }).eq("id", soldDialog.item.id);
    if (error) { alert(`Failed to mark sold: ${error.message}`); return; }
    setInventory((p) => p.map((i) => i.id === soldDialog.item.id ? { ...i, sold: true, sold_price: price, sale_channel: channel || i.sale_channel } : i));
    setSoldDialog(null);
    setSoldPriceInput("");
    setSoldChannelInput("");
  }

  function toggleSelect(id: string) {
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleBulkSell() {
    if (!selected.size) return;
    const ids = [...selected];
    const { error } = await supabase.from("inventory").update({ sold: true, sale_channel: bulkSaleChannel || null }).in("id", ids);
    if (error) { alert(`Failed to mark sold: ${error.message}`); return; }
    setInventory((p) => p.map((i) => ids.includes(i.id) ? { ...i, sold: true, sale_channel: bulkSaleChannel || i.sale_channel } : i));
    setSelected(new Set());
    setBulkSaleChannel("");
  }

  function handleBulkDelete() {
    if (!selected.size) return;
    setDeleteConfirm({ ids: [...selected], label: `${selected.size} item${selected.size > 1 ? "s" : ""}` });
  }

  async function executeDelete() {
    if (!deleteConfirm) return;
    const { ids } = deleteConfirm;
    if (ids.length === 1) {
      await supabase.from("inventory").delete().eq("id", ids[0]);
    } else {
      await supabase.from("inventory").delete().in("id", ids);
    }
    setInventory((p) => p.filter((i) => !ids.includes(i.id)));
    setSelected((p) => { const n = new Set(p); ids.forEach((id) => n.delete(id)); return n; });
    setDeleteConfirm(null);
  }

  // ── Export CSV ─────────────────────────────────────────────────
  function exportCSV() {
    const headers = ["Brand","Model","Colorway","Size","Condition","Cost","Asking Price","UPC","Status","Sale Channel","Notes","Date Added"];
    const rows = inventory.map((i) => [
      i.brand, i.model, i.colorway || "", i.size || "", i.condition,
      i.cost || "", i.asking_price || "", i.upc || "",
      i.sold ? "Sold" : "Active", i.sale_channel || "", i.notes || "",
      new Date(i.created_at).toLocaleDateString(),
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "apex-vault-inventory.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Expenses ───────────────────────────────────────────────────
  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!expForm.description || !expForm.amount) return;
    setExpSaving(true);
    const { data } = await supabase.from("expenses").insert({
      user_id: userId,
      description: expForm.description,
      amount: parseFloat(expForm.amount),
      category: expForm.category,
      date: expForm.date,
      notes: expForm.notes || null,
    }).select().single();
    if (data) setExpenses((p) => [data, ...p]);
    setExpForm({ description: "", amount: "", category: "Other", date: new Date().toISOString().slice(0, 10), notes: "" });
    setExpSaving(false);
  }

  async function deleteExpense(id: string) {
    await supabase.from("expenses").delete().eq("id", id);
    setExpenses((p) => p.filter((e) => e.id !== id));
  }

  // ── Filtered + sorted inventory ────────────────────────────────
  const brands = [...new Set(inventory.map((i) => i.brand))].sort();
  const conditions = [...new Set(inventory.map((i) => i.condition))].sort();

  const filtered = inventory
    .filter((i) => {
      const q = search.toLowerCase();
      if (q && !`${i.brand} ${i.model} ${i.colorway || ""} ${i.size || ""}`.toLowerCase().includes(q)) return false;
      if (filterBrand !== "__all__" && i.brand !== filterBrand) return false;
      if (filterStatus === "active" && i.sold) return false;
      if (filterStatus === "sold" && !i.sold) return false;
      if (filterCondition !== "__all__" && i.condition !== filterCondition) return false;
      return true;
    })
    .sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sortKey === "brand")        { av = a.brand; bv = b.brand; }
      if (sortKey === "cost")         { av = a.cost || 0; bv = b.cost || 0; }
      if (sortKey === "asking_price") { av = a.asking_price || 0; bv = b.asking_price || 0; }
      if (sortKey === "margin")       { av = (a.asking_price || 0) - (a.cost || 0); bv = (b.asking_price || 0) - (b.cost || 0); }
      if (sortKey === "created_at")   { av = a.created_at; bv = b.created_at; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? <span className="ml-1 opacity-60">{sortDir === "asc" ? "↑" : "↓"}</span> : null;

  // ── Stats ──────────────────────────────────────────────────────
  const active = inventory.filter((i) => !i.sold);
  const soldItems = inventory.filter((i) => i.sold);
  const totalCost = active.reduce((s, i) => s + (i.cost || 0), 0);
  const totalValue = active.reduce((s, i) => s + (i.asking_price || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const realizedRevenue = soldItems.reduce((s, i) => s + (i.sold_price ?? i.asking_price ?? 0), 0);
  const netProfit = realizedRevenue - soldItems.reduce((s, i) => s + (i.cost || 0), 0) - totalExpenses;

  // Expense date filtering
  const expenseMonths = [...new Set(expenses.map((e) => e.date.slice(0, 7)))].sort().reverse();
  const filteredExpenses = expMonthFilter === "__all__" ? expenses : expenses.filter((e) => e.date.startsWith(expMonthFilter));
  const filteredExpTotal = filteredExpenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Ambient top glow */}
      <div className="pointer-events-none fixed top-0 left-0 right-0 h-[300px] z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-primary/10 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="border-b border-border/60 px-4 sm:px-6 py-3 sm:py-4 sticky top-0 bg-background/90 backdrop-blur-sm z-10 shadow-[0_1px_0_0_oklch(0.78_0.14_85_/_12%)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-6 h-6 rounded-md bg-primary/20 border border-primary/40 flex items-center justify-center">
                <span className="text-primary font-black text-[10px]">AV</span>
              </div>
              <h1 className="text-base sm:text-xl font-black tracking-tight text-primary shrink-0 drop-shadow-[0_0_8px_oklch(0.78_0.14_85_/_40%)]">Apex Vault</h1>
            </div>
            <div className="flex gap-1">
              {(["inventory","expenses","statements"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium capitalize transition-all ${tab === t ? "bg-primary/20 text-primary border border-primary/40 shadow-[0_0_8px_oklch(0.78_0.14_85_/_20%)]" : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {tab === "inventory" && (
              <>
                <Button size="sm" variant="outline" className="hidden sm:flex text-xs border-border/60 hover:border-primary/40 hover:text-primary" onClick={exportCSV}>Export CSV</Button>
                <Button size="sm" variant="outline" className="hidden sm:flex text-xs border-border/60 hover:border-primary/40 hover:text-primary" onClick={() => setShowImport(true)}>Import CSV</Button>
                <Button size="sm" variant="outline" className="hidden sm:flex text-xs border-border/60 hover:border-primary/40 hover:text-primary" onClick={() => setShowBulkAdd(true)}>Bulk Add</Button>
                <Button size="sm" className="text-xs px-3 shadow-[0_0_12px_oklch(0.78_0.14_85_/_30%)]" onClick={() => setShowModal(true)}>+ Add</Button>
              </>
            )}
            <button
              onClick={() => setDemoMode((d) => !d)}
              className={`text-xs px-2 py-1 rounded-md font-medium transition-all ${demoMode ? "bg-primary/20 text-primary border border-primary/40" : "text-muted-foreground/40 hover:text-muted-foreground border border-transparent"}`}
              title="Toggle demo mode"
            >
              {demoMode ? "Demo ON" : "Demo"}
            </button>
            <Button size="sm" variant="ghost" className="text-xs px-2 text-muted-foreground hover:text-foreground" onClick={async () => { await supabase.auth.signOut(); router.push("/login"); }}>
              Out
            </Button>
          </div>
        </div>
        {/* Mobile-only action bar */}
        {tab === "inventory" && (
          <div className="flex sm:hidden gap-2 mt-2">
            <Button size="sm" variant="outline" className="flex-1 text-xs border-border/60" onClick={exportCSV}>Export CSV</Button>
            <Button size="sm" variant="outline" className="flex-1 text-xs border-border/60" onClick={() => setShowImport(true)}>Import CSV</Button>
            <Button size="sm" variant="outline" className="flex-1 text-xs border-border/60" onClick={() => setShowBulkAdd(true)}>Bulk Add</Button>
          </div>
        )}
      </header>

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto space-y-6 relative z-10">

        {/* ── INVENTORY TAB ── */}
        {tab === "inventory" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "In Stock", value: demoMode ? DEMO_STATS.activeCount : active.length, icon: "📦" },
                { label: "Total Cost In", value: `$${(demoMode ? DEMO_STATS.totalCost : totalCost).toLocaleString()}`, icon: "💰" },
                { label: "Portfolio Value", value: `$${(demoMode ? DEMO_STATS.totalValue : totalValue).toLocaleString()}`, icon: "📈" },
                { label: "Net Profit (Sold)", value: `$${(demoMode ? DEMO_STATS.netProfit : netProfit).toLocaleString()}`, color: (demoMode ? DEMO_STATS.netProfit : netProfit) >= 0 ? "text-green-400" : "text-red-400", icon: (demoMode ? DEMO_STATS.netProfit : netProfit) >= 0 ? "✅" : "⚠️" },
              ].map((s) => (
                <Card key={s.label} className="bg-card border-primary/25 shadow-[0_0_0_1px_oklch(0.78_0.14_85_/_8%),0_4px_20px_rgba(0,0,0,0.3)] hover:border-primary/40 hover:shadow-[0_0_16px_oklch(0.78_0.14_85_/_15%)] transition-all">
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                      <span>{s.icon}</span>{s.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className={`text-2xl font-black tracking-tight ${s.color || "text-foreground"}`}>{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Bulk sale bar */}
            {selected.size > 0 && (
              <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                <span className="text-sm font-medium text-primary">{selected.size} selected</span>
                <Select value={bulkSaleChannel} onValueChange={setBulkSaleChannel}>
                  <SelectTrigger className="w-40 h-8 text-sm">
                    <SelectValue placeholder="Sale channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleBulkSell}>Mark Sold</Button>
                <Button size="sm" variant="destructive" onClick={handleBulkDelete}>Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                placeholder="Search shoes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-48 h-8 text-sm"
              />
              <Select value={filterBrand} onValueChange={setFilterBrand}>
                <SelectTrigger className="w-36 h-8 text-sm"><SelectValue placeholder="Brand" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Brands</SelectItem>
                  {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-32 h-8 text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="sold">Sold</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterCondition} onValueChange={setFilterCondition}>
                <SelectTrigger className="w-40 h-8 text-sm"><SelectValue placeholder="Condition" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Conditions</SelectItem>
                  {conditions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {(search || filterBrand !== "__all__" || filterStatus !== "__all__" || filterCondition !== "__all__") && (
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setSearch(""); setFilterBrand("__all__"); setFilterStatus("__all__"); setFilterCondition("__all__"); }}>
                  Clear filters
                </Button>
              )}
              <span className="text-xs text-muted-foreground ml-auto">{filtered.length} of {inventory.length} items</span>
            </div>

            {/* Inventory table */}
            <div className="rounded-xl border border-primary/20 overflow-hidden shadow-[0_0_0_1px_oklch(0.78_0.14_85_/_6%),0_4px_24px_rgba(0,0,0,0.4)]">
              {loading ? (
                <div className="py-12 text-center text-muted-foreground text-sm">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  {inventory.length === 0 ? 'No items yet. Hit "+ Add Item" or "Import CSV" to get started.' : "No items match your filters."}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-primary/15 bg-primary/5">
                        <th className="px-3 py-3 w-8">
                          <input type="checkbox"
                            checked={selected.size === filtered.length && filtered.length > 0}
                            onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((i) => i.id)) : new Set())}
                            className="accent-primary"
                          />
                        </th>
                        <th className="px-3 py-3 w-14 text-left text-xs font-medium text-muted-foreground">Photo</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("brand")}>
                          Shoe <SortIcon k="brand" />
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Size</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Condition</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("cost")}>
                          Cost <SortIcon k="cost" />
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("asking_price")}>
                          Ask <SortIcon k="asking_price" />
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("margin")}>
                          Margin <SortIcon k="margin" />
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Bought From</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Channel</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground">Sold $</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => toggleSort("created_at")}>
                          Date Added <SortIcon k="created_at" />
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                        <th className="px-3 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((item) => {
                        const margin = (item.asking_price || 0) - (item.cost || 0);
                        return (
                          <tr key={item.id} className={`border-b border-primary/10 last:border-0 hover:bg-primary/[0.08] transition-colors ${selected.has(item.id) ? "bg-primary/[0.12]" : ""}`}>
                            <td className="px-3 py-3">
                              <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} className="accent-primary" />
                            </td>
                            <td className="px-3 py-3">
                              {item.photo_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.photo_url} alt="" className="w-10 h-10 object-cover rounded-md border border-border" />
                              ) : (
                                <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center text-lg">👟</div>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <div className="font-medium">{item.brand} {item.model}</div>
                              {item.colorway && <div className="text-xs text-muted-foreground">{item.colorway}</div>}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">{item.size || "—"}</td>
                            <td className="px-3 py-3 text-muted-foreground text-xs">{item.condition}</td>
                            <td className="px-3 py-3 text-right">{item.cost ? `$${item.cost.toLocaleString()}` : "—"}</td>
                            <td className="px-3 py-3 text-right">{item.asking_price ? `$${item.asking_price.toLocaleString()}` : "—"}</td>
                            <td className={`px-3 py-3 text-right font-medium ${margin > 0 ? "text-green-400" : margin < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                              {item.cost != null && item.asking_price != null ? `$${margin.toLocaleString()}` : "—"}
                            </td>
                            <td className="px-3 py-3 text-xs text-muted-foreground">{item.purchased_from || "—"}</td>
                            <td className="px-3 py-3 text-xs text-muted-foreground">{item.sale_channel || "—"}</td>
                            <td className="px-3 py-3 text-right text-xs font-medium">
                              {item.sold
                                ? item.sold_price != null
                                  ? <span className="text-green-400">${item.sold_price.toLocaleString()}</span>
                                  : <span className="text-muted-foreground">—</span>
                                : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-3 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleDateString()}</td>
                            <td className="px-3 py-3">
                              <Badge
                                variant={item.sold ? "secondary" : "default"}
                                className={`cursor-pointer text-xs ${item.sold ? "" : "bg-primary text-primary-foreground hover:bg-primary/80"}`}
                                onClick={() => toggleSold(item)}
                              >
                                {item.sold ? "Sold" : "Active"}
                              </Badge>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground h-7 text-xs px-2" onClick={() => { setEditItem(item); setShowEdit(true); }}>
                                Edit
                              </Button>
                              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive h-7 text-xs px-2" onClick={() => handleDelete(item.id)}>
                                Delete
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── EXPENSES TAB ── */}
        {tab === "expenses" && (
          <div className="space-y-6">
            {/* Expense stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: "Total Expenses", value: `$${(demoMode ? DEMO_STATS.totalExpenses : totalExpenses).toLocaleString()}`, icon: "💸" },
                { label: "Realized Revenue", value: `$${(demoMode ? DEMO_STATS.realizedRevenue : realizedRevenue).toLocaleString()}`, icon: "💵" },
                { label: "Net Profit", value: `$${(demoMode ? DEMO_STATS.netProfit : netProfit).toLocaleString()}`, color: (demoMode ? DEMO_STATS.netProfit : netProfit) >= 0 ? "text-green-400" : "text-red-400", icon: (demoMode ? DEMO_STATS.netProfit : netProfit) >= 0 ? "✅" : "⚠️" },
              ].map((s) => (
                <Card key={s.label} className="bg-card border-primary/25 shadow-[0_0_0_1px_oklch(0.78_0.14_85_/_8%),0_4px_20px_rgba(0,0,0,0.3)] hover:border-primary/40 hover:shadow-[0_0_16px_oklch(0.78_0.14_85_/_15%)] transition-all">
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                      <span>{s.icon}</span>{s.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className={`text-2xl font-black tracking-tight ${s.color || "text-foreground"}`}>{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Add expense form */}
            <div className="rounded-xl border border-primary/25 bg-primary/[0.03] p-4 space-y-3 shadow-[0_0_0_1px_oklch(0.78_0.14_85_/_6%)]">
              <h3 className="font-semibold text-sm">Add Expense</h3>
              <form onSubmit={addExpense} className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Input placeholder="Description" value={expForm.description} onChange={(e) => setExpForm((p) => ({ ...p, description: e.target.value }))} required className="md:col-span-2" />
                <Input type="number" min="0" step="0.01" placeholder="Amount ($)" value={expForm.amount} onChange={(e) => setExpForm((p) => ({ ...p, amount: e.target.value }))} required />
                <Select value={expForm.category} onValueChange={(v) => setExpForm((p) => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={expSaving}>{expSaving ? "Saving..." : "Add"}</Button>
              </form>
            </div>

            {/* Expenses list */}
            <div className="rounded-xl border border-primary/20 overflow-hidden shadow-[0_0_0_1px_oklch(0.78_0.14_85_/_6%),0_4px_24px_rgba(0,0,0,0.4)]">
              <div className="px-4 py-3 border-b border-primary/15 bg-primary/5 flex flex-wrap items-center gap-3 justify-between">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="font-semibold text-sm">
                    {expMonthFilter === "__all__" ? "All Expenses" : formatExpMonth(expMonthFilter)}
                  </h3>
                  <Select value={expMonthFilter} onValueChange={setExpMonthFilter}>
                    <SelectTrigger className="w-36 h-7 text-xs">
                      <SelectValue placeholder="Filter by month" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All Time</SelectItem>
                      {expenseMonths.map((m) => (
                        <SelectItem key={m} value={m}>{formatExpMonth(m)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {expMonthFilter !== "__all__" && (
                    <span className="text-xs text-muted-foreground font-medium">
                      ${filteredExpTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} total
                    </span>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => {
                  const headers = ["Date","Description","Category","Amount","Notes"];
                  const rows = filteredExpenses.map((e) => [e.date, e.description, e.category, e.amount, e.notes || ""]);
                  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob); const a = document.createElement("a");
                  a.href = url; a.download = "apex-vault-expenses.csv"; a.click(); URL.revokeObjectURL(url);
                }}>Export for Taxes</Button>
              </div>
              {expLoading ? (
                <div className="py-10 text-center text-muted-foreground text-sm">Loading...</div>
              ) : filteredExpenses.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground text-sm">
                  {expenses.length === 0 ? "No expenses logged yet." : "No expenses in this period."}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Description</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Category</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Amount</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExpenses.map((exp) => (
                      <tr key={exp.id} className="border-b border-primary/10 last:border-0 hover:bg-primary/[0.08] transition-colors">
                        <td className="px-4 py-3 text-muted-foreground text-xs">{exp.date}</td>
                        <td className="px-4 py-3 font-medium">{exp.description}</td>
                        <td className="px-4 py-3"><Badge variant="secondary" className="text-xs">{exp.category}</Badge></td>
                        <td className="px-4 py-3 text-right text-red-400 font-medium">-${exp.amount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive h-7 text-xs" onClick={() => deleteExpense(exp.id)}>Delete</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── STATEMENTS TAB ── */}
        {tab === "statements" && <StatementParser demo={demoMode} />}

      </main>

      <AddItemModal open={showModal} onClose={() => setShowModal(false)} onAdded={fetchInventory} userId={userId || ""} />
      <AddItemModal open={showEdit} onClose={() => { setShowEdit(false); setEditItem(null); }} onAdded={fetchInventory} userId={userId || ""} item={editItem ?? undefined} />
      <CSVImport open={showImport} onClose={() => setShowImport(false)} onImported={fetchInventory} userId={userId || ""} />
      <BulkAddModal open={showBulkAdd} onClose={() => setShowBulkAdd(false)} onAdded={fetchInventory} userId={userId || ""} />

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base">Delete {deleteConfirm.label}?</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <p className="text-sm text-muted-foreground">This cannot be undone.</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                <Button variant="destructive" className="flex-1" onClick={executeDelete}>Delete</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Sold price capture dialog */}
      {soldDialog && (
        <Dialog open={!!soldDialog} onOpenChange={() => { setSoldDialog(null); setSoldChannelInput(""); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base">Record Sale</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <p className="text-sm text-muted-foreground">
                {soldDialog.item.brand} {soldDialog.item.model}
                {soldDialog.item.size ? ` · Sz ${soldDialog.item.size}` : ""}
              </p>
              <div className="space-y-1">
                <p className="text-sm font-medium">Actual Sale Price ($)</p>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={soldDialog.item.asking_price ? String(soldDialog.item.asking_price) : "Enter amount"}
                  value={soldPriceInput}
                  onChange={(e) => setSoldPriceInput(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Listed at {soldDialog.item.asking_price ? `$${soldDialog.item.asking_price.toLocaleString()}` : "no price set"}. Leave blank to skip.
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Sold On</p>
                <Select value={soldChannelInput} onValueChange={setSoldChannelInput}>
                  <SelectTrigger>
                    <SelectValue placeholder="Where did you sell it?" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setSoldDialog(null); setSoldChannelInput(""); }}>Cancel</Button>
                <Button className="flex-1" onClick={() => handleConfirmSold(soldPriceInput ? parseFloat(soldPriceInput) : null, soldChannelInput || null)}>
                  Mark Sold
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardPageInner />
    </Suspense>
  );
}
