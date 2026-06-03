import { useState, useEffect, useCallback, useMemo } from "react";

const STORAGE_KEY = "hbs_finance_v1";
const DEFAULT_DATA = {
  accounts: [], income: [], bills: [], expenses: [], debt: [], goals: [],
  budget: [],
  settings: { currency: "USD" },
};

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DATA;
    return { ...DEFAULT_DATA, ...JSON.parse(raw) };
  } catch { return DEFAULT_DATA; }
}

function saveData(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

function fmt(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function generateId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function advanceDate(iso, freq) {
  if (!iso) return iso;
  const d = new Date(iso + "T12:00:00");
  if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "biweekly") d.setDate(d.getDate() + 14);
  else if (freq === "monthly") d.setMonth(d.getMonth() + 1);
  else if (freq === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (freq === "annual") d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function daysDiff(iso) {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(iso + "T12:00:00");
  return Math.round((d - today) / 86400000);
}

// Count how many times a weekly/biweekly pay cycle lands in a given month
// anchorDate: a known pay date (ISO string), freq: "weekly"|"biweekly"
// monthKey: "YYYY-MM"
function countOccurrencesInMonth(anchorDate, freq, monthKey) {
  if (!anchorDate) return freq === "biweekly" ? 2 : 4; // fallback
  const [yr, mo] = monthKey.split("-").map(Number);
  const monthStart = new Date(yr, mo - 1, 1);
  const monthEnd = new Date(yr, mo, 0, 23, 59, 59);
  const stepDays = freq === "weekly" ? 7 : 14;
  // Walk anchor forward/backward to find first occurrence on or after monthStart
  let d = new Date(anchorDate + "T12:00:00");
  // Step backward until before monthStart
  while (d >= monthStart) d.setDate(d.getDate() - stepDays);
  // Now step forward counting hits within month
  let count = 0;
  d.setDate(d.getDate() + stepDays);
  while (d <= monthEnd) {
    if (d >= monthStart) count++;
    d.setDate(d.getDate() + stepDays);
  }
  return count;
}

function monthlyEquivalent(amount, freq, customMonths) {
  const a = parseFloat(amount) || 0;
  if (freq === "custom") return customMonths > 0 ? a / customMonths : 0;
  const map = { weekly: a*52/12, biweekly: a*26/12, monthly: a, quarterly: a/3, annual: a/12 };
  return map[freq] || a;
}

function budgetNextDate(startDate, freq, customMonths) {
  if (!startDate) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  let d = new Date(startDate + "T12:00:00");
  const maxIter = 500;
  let iter = 0;
  while (d <= today && iter < maxIter) {
    iter++;
    if (freq === "weekly") d.setDate(d.getDate() + 7);
    else if (freq === "biweekly") d.setDate(d.getDate() + 14);
    else if (freq === "monthly") d.setMonth(d.getMonth() + 1);
    else if (freq === "quarterly") d.setMonth(d.getMonth() + 3);
    else if (freq === "annual") d.setFullYear(d.getFullYear() + 1);
    else if (freq === "custom") d.setMonth(d.getMonth() + (parseInt(customMonths) || 1));
    else break;
  }
  return d.toISOString().slice(0, 10);
}

function budgetHitsInMonth(startDate, freq, customMonths, monthKey) {
  // Returns true if this budget envelope hits in the given month (YYYY-MM)
  if (!startDate) return false;
  if (freq === "monthly") return true;
  const [yr, mo] = monthKey.split("-").map(Number);
  const monthStart = new Date(yr, mo - 1, 1);
  const monthEnd = new Date(yr, mo, 0, 23, 59, 59);
  let d = new Date(startDate + "T12:00:00");
  const maxIter = 500;
  let iter = 0;
  while (d <= monthEnd && iter < maxIter) {
    iter++;
    if (d >= monthStart && d <= monthEnd) return true;
    if (freq === "weekly") d.setDate(d.getDate() + 7);
    else if (freq === "biweekly") d.setDate(d.getDate() + 14);
    else if (freq === "quarterly") d.setMonth(d.getMonth() + 3);
    else if (freq === "annual") d.setFullYear(d.getFullYear() + 1);
    else if (freq === "custom") d.setMonth(d.getMonth() + (parseInt(customMonths) || 1));
    else break;
  }
  return false;
}

const ACCOUNT_TYPES = ["Checking","Savings","Money Market","Investment","Cash","Other"];
const ACCOUNT_COLORS = ["#4ade80","#60a5fa","#f59e0b","#a78bfa","#f472b6","#34d399","#fb923c","#818cf8"];
const FREQUENCIES = ["weekly","biweekly","monthly","quarterly","annual"];
const EXPENSE_CATEGORIES = ["Food & Dining","Groceries","Transportation","Gas","Entertainment","Shopping","Health","Personal Care","Utilities","Subscriptions","Travel","Education","Gifts","Home","Other"];

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:#1a1d27;}::-webkit-scrollbar-thumb{background:#2e3347;border-radius:2px;}
input,select,textarea{background:#1a1d27!important;border:1px solid #2e3347!important;color:#e8eaf0!important;border-radius:6px!important;padding:8px 12px!important;font-family:inherit!important;font-size:13px!important;outline:none!important;width:100%;transition:border-color 0.15s;}
input:focus,select:focus,textarea:focus{border-color:#f59e0b!important;}
select option{background:#1a1d27;}
label{font-size:11px;letter-spacing:0.08em;color:#8b90a0;text-transform:uppercase;display:block;margin-bottom:4px;}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all 0.15s;border:1px solid transparent;}
.btn-primary{background:#f59e0b;color:#0f1117;border-color:#f59e0b;}
.btn-primary:hover{background:#fbbf24;}
.btn-primary:disabled{opacity:0.4;cursor:not-allowed;}
.btn-ghost{background:transparent;color:#6b7280;border-color:#2e3347;}
.btn-ghost:hover{background:#1a1d27;color:#e8eaf0;}
.btn-edit{background:transparent;color:#60a5fa;border-color:#60a5fa40;}
.btn-edit:hover{background:#60a5fa12;border-color:#60a5fa;}
.btn-success{background:transparent;color:#4ade80;border-color:#4ade8040;}
.btn-success:hover{background:#4ade8015;border-color:#4ade80;}
.btn-danger{background:transparent;color:#ef4444;border-color:#ef444440;}
.btn-danger:hover{background:#ef444415;border-color:#ef4444;}
.btn-confirm{background:#ef4444;color:#fff;border-color:#ef4444;}
.btn-confirm:hover{background:#dc2626;}
.card{background:#1a1d27;border:1px solid #2e3347;border-radius:10px;padding:20px;}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px;}
.modal{background:#1a1d27;border:1px solid #2e3347;border-radius:12px;padding:24px;width:100%;max-width:500px;max-height:90vh;overflow-y:auto;}
.form-row{margin-bottom:14px;}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;}
.section-title{font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#f59e0b;}
.empty-state{text-align:center;padding:48px 24px;color:#8b90a0;font-size:13px;}
.list-item{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#12141c;border:1px solid #2e3347;border-radius:8px;margin-bottom:8px;}
.list-item:last-child{margin-bottom:0;}
.toast{position:fixed;bottom:24px;right:24px;background:#1a1d27;border:1px solid #2e3347;border-radius:8px;padding:12px 18px;font-size:13px;z-index:200;display:flex;align-items:center;gap:8px;animation:slideUp 0.2s ease;}
@keyframes slideUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
.progress-bar{height:4px;background:#2e3347;border-radius:2px;overflow:hidden;margin-top:8px;}
.progress-fill{height:100%;border-radius:2px;transition:width 0.3s;}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;letter-spacing:0.04em;}
.tab-pills{display:flex;gap:6px;margin-bottom:20px;border-bottom:1px solid #2e3347;padding-bottom:0;}
.tab-pill{padding:8px 14px;font-size:12px;font-family:inherit;cursor:pointer;border:none;background:transparent;color:#8b90a0;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all 0.15s;letter-spacing:0.04em;}
.tab-pill.active{color:#f59e0b;border-bottom-color:#f59e0b;}
.tab-pill:hover:not(.active){color:#e8eaf0;}
`;

// ─── DELETE CONFIRM HOOK ──────────────────────────────────────────────────────
function useDeleteConfirm() {
  const [confirmId, setConfirmId] = useState(null);
  const request = (id) => setConfirmId(id);
  const cancel = () => setConfirmId(null);
  const isConfirming = (id) => confirmId === id;
  return { request, cancel, isConfirming };
}

// ─── ACTION BUTTONS ───────────────────────────────────────────────────────────
function ActionButtons({ id, onEdit, onDelete, dc }) {
  if (dc.isConfirming(id)) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#ef4444", letterSpacing: "0.04em" }}>Delete?</span>
        <button className="btn btn-confirm" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => { onDelete(); dc.cancel(); }}>Yes</button>
        <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={dc.cancel}>No</button>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button className="btn btn-edit" style={{ padding: "6px 10px", fontSize: 12 }} onClick={onEdit} title="Edit">
        <i className="ti ti-edit" aria-hidden="true" />
      </button>
      <button className="btn btn-danger" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => dc.request(id)} title="Delete">
        <i className="ti ti-trash" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function FinanceTracker() {
  const [data, setData] = useState(loadData);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [toastMsg, setToastMsg] = useState(null);

  useEffect(() => { saveData(data); }, [data]);

  const showToast = useCallback((msg, type = "success") => {
    setToastMsg({ msg, type });
    setTimeout(() => setToastMsg(null), 2800);
  }, []);

  const updateData = useCallback((key, val) => {
    setData(prev => ({ ...prev, [key]: val }));
  }, []);

  const adjustAccountBalance = useCallback((accountId, delta) => {
    if (!accountId) return;
    setData(prev => ({
      ...prev,
      accounts: prev.accounts.map(a =>
        a.id === accountId ? { ...a, balance: (parseFloat(a.balance) || 0) + delta } : a
      )
    }));
  }, []);

  const allocatedByAccount = useMemo(() => {
    const map = {};
    data.goals.forEach(g => {
      if (g.linkedAccountId) {
        map[g.linkedAccountId] = (map[g.linkedAccountId] || 0) + (parseFloat(g.currentAmount) || 0);
      }
    });
    return map;
  }, [data.goals]);

  const totalBalance = useMemo(() =>
    data.accounts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0), [data.accounts]);

  const exportData = () => {
    const json = JSON.stringify(data, null, 2);
    const uri = "data:text/json;charset=utf-8," + encodeURIComponent(json);
    const a = document.createElement("a");
    a.href = uri;
    a.download = `ledger-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("Backup exported");
  };

  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        setData({ ...DEFAULT_DATA, ...parsed });
        showToast("Data restored from backup");
      } catch { showToast("Invalid backup file", "error"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: "ti-layout-dashboard" },
    { id: "income", label: "Income", icon: "ti-trending-up" },
    { id: "bills", label: "Bills", icon: "ti-file-invoice" },
    { id: "expenses", label: "Expenses", icon: "ti-receipt" },
    { id: "cashflow", label: "Cash Flow", icon: "ti-chart-line" },
    { id: "debt", label: "Debt", icon: "ti-credit-card" },
    { id: "goals", label: "Goals", icon: "ti-target" },
    { id: "budget", label: "Budget", icon: "ti-wallet" },
    { id: "settings", label: "Settings", icon: "ti-settings" },
  ];

  const sharedProps = { data, updateData, adjustAccountBalance, showToast, allocatedByAccount };

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#e8eaf0", fontFamily: "'IBM Plex Mono','Courier New',monospace" }}>
      <style>{STYLES}</style>
      <div style={{ borderBottom: "1px solid #2e3347", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, background: "#f59e0b", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="ti ti-chart-pie" style={{ color: "#0f1117", fontSize: 15 }} aria-hidden="true" />
          </div>
          <span style={{ fontFamily: "'IBM Plex Sans',sans-serif", fontWeight: 600, fontSize: 15, letterSpacing: "0.02em" }}>LEDGER</span>
          <span style={{ fontSize: 11, color: "#8b90a0", marginLeft: 4, letterSpacing: "0.06em" }}>PERSONAL FINANCE</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }} onClick={exportData}>
            <i className="ti ti-download" aria-hidden="true" /> Export
          </button>
          <label className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px", cursor: "pointer" }}>
            <i className="ti ti-upload" aria-hidden="true" /> Import
            <input type="file" accept=".json" onChange={importData} style={{ display: "none", width: "auto" }} />
          </label>
        </div>
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 56px)" }}>
        <div style={{ width: 200, borderRight: "1px solid #2e3347", padding: "16px 0", flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0 12px", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "#8b90a0", letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 8px", marginBottom: 4 }}>Navigation</div>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 7, border: "none", cursor: "pointer", background: activeTab === tab.id ? "#f59e0b18" : "transparent", color: activeTab === tab.id ? "#f59e0b" : "#8b90a0", fontSize: 13, fontFamily: "inherit", fontWeight: activeTab === tab.id ? 500 : 400, marginBottom: 2, transition: "all 0.12s", textAlign: "left" }}>
                <i className={`ti ${tab.icon}`} style={{ fontSize: 15 }} aria-hidden="true" />
                {tab.label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: "auto", padding: "12px 20px", borderTop: "1px solid #2e3347" }}>
            <div style={{ fontSize: 11, color: "#8b90a0", marginBottom: 4, letterSpacing: "0.06em" }}>NET WORTH</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: totalBalance >= 0 ? "#4ade80" : "#ef4444" }}>{fmt(totalBalance)}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {activeTab === "dashboard" && <DashboardTab {...sharedProps} />}
          {activeTab === "income" && <IncomeTab {...sharedProps} />}
          {activeTab === "bills" && <BillsTab {...sharedProps} />}
          {activeTab === "expenses" && <ExpensesTab {...sharedProps} />}
          {activeTab === "cashflow" && <CashFlowTab {...sharedProps} />}
          {activeTab === "debt" && <DebtTab {...sharedProps} />}
          {activeTab === "goals" && <GoalsTab {...sharedProps} />}
          {activeTab === "budget" && <BudgetTab {...sharedProps} />}
          {activeTab === "settings" && <SettingsTab {...sharedProps} />}
        </div>
      </div>

      {toastMsg && (
        <div className="toast">
          <i className={`ti ${toastMsg.type === "error" ? "ti-alert-circle" : "ti-circle-check"}`} style={{ color: toastMsg.type === "error" ? "#ef4444" : "#4ade80", fontSize: 16 }} aria-hidden="true" />
          {toastMsg.msg}
        </div>
      )}
    </div>
  );
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function DashboardTab({ data, allocatedByAccount }) {
  const totalBalance = data.accounts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
  const totalAllocated = Object.values(allocatedByAccount).reduce((s, v) => s + v, 0);
  const totalFree = totalBalance - totalAllocated;
  const totalDebt = data.debt.reduce((s, d) => s + (parseFloat(d.balance) || 0), 0);

  const upcomingBills = useMemo(() =>
    [...data.bills].filter(b => !b.paid).sort((a, b) => (a.nextDate||"").localeCompare(b.nextDate||"")).slice(0, 6),
    [data.bills]);

  const recentExpenses = useMemo(() =>
    [...data.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    [data.expenses]);

  const monthStart = todayISO().slice(0, 7) + "-01";
  const monthKey = todayISO().slice(0, 7);
  const monthExpenses = data.expenses.filter(e => e.date >= monthStart).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const monthIncome = useMemo(() => data.income.filter(i => i.recurring).reduce((s, i) => {
    if ((i.frequency === "biweekly" || i.frequency === "weekly") && i.anchorDate) {
      return s + (parseFloat(i.amount)||0) * countOccurrencesInMonth(i.anchorDate, i.frequency, monthKey);
    }
    return s + monthlyEquivalent(i.amount, i.frequency);
  }, 0), [data.income, monthKey]);

  const goalsSummary = data.goals.map(g => {
    const pct = g.targetAmount > 0 ? Math.min(100, ((parseFloat(g.currentAmount)||0) / parseFloat(g.targetAmount)) * 100) : 0;
    return { ...g, pct };
  });

  const budgetHealth = useMemo(() => (data.budget||[]).map(env => {
    const spent = data.expenses
      .filter(e => e.date >= monthStart && e.category === env.category)
      .reduce((s, e) => s + (parseFloat(e.amount)||0), 0);
    const allocated = parseFloat(env.amount)||0;
    const pct = allocated > 0 ? Math.min(120, (spent/allocated)*100) : 0;
    const hitsThisMonth = budgetHitsInMonth(env.startDate, env.freq, env.customMonths, monthKey);
    return { ...env, spent, allocated, pct, hitsThisMonth };
  }).filter(e => e.hitsThisMonth), [data.budget, data.expenses, monthStart, monthKey]);

  return (
    <div>
      <PageHeader title="Overview" subtitle="Dashboard" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Total Balance", value: fmt(totalBalance), color: "#f59e0b" },
          { label: "Available", value: fmt(totalFree), color: "#4ade80" },
          { label: "Total Debt", value: fmt(totalDebt), color: "#ef4444" },
          { label: "Month Expenses", value: fmt(monthExpenses), color: "#8b90a0" },
        ].map(s => (
          <div key={s.label} className="card">
            <div style={{ fontSize: 11, color: "#8b90a0", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-header">
          <div className="section-title">Accounts</div>
          <span style={{ fontSize: 12, color: "#8b90a0" }}>{data.accounts.length} account{data.accounts.length !== 1 ? "s" : ""}</span>
        </div>
        {data.accounts.length === 0
          ? <div className="empty-state"><i className="ti ti-building-bank" style={{ fontSize: 32, display: "block", marginBottom: 8 }} aria-hidden="true" />No accounts — add one in Settings</div>
          : data.accounts.map(acc => {
            const allocated = allocatedByAccount[acc.id] || 0;
            const free = (parseFloat(acc.balance)||0) - allocated;
            const allocPct = acc.balance > 0 ? Math.min(100,(allocated/acc.balance)*100) : 0;
            const goalNames = data.goals.filter(g => g.linkedAccountId === acc.id).map(g => g.name);
            return (
              <div key={acc.id} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid #2e3347" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: acc.color||"#f59e0b", flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{acc.name}</div>
                      <div style={{ fontSize: 11, color: "#8b90a0" }}>{acc.type}{goalNames.length > 0 ? ` · ${goalNames.join(", ")}` : ""}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{fmt(acc.balance)}</div>
                    {allocated > 0 && <div style={{ fontSize: 11, color: "#8b90a0" }}>{fmt(free)} free · {fmt(allocated)} allocated</div>}
                  </div>
                </div>
                {allocated > 0 && <div className="progress-bar"><div className="progress-fill" style={{ width: `${allocPct}%`, background: "#a78bfa" }} /></div>}
              </div>
            );
          })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="section-title" style={{ marginBottom: 14 }}>Upcoming Bills</div>
          {upcomingBills.length === 0
            ? <div style={{ fontSize: 12, color: "#8b90a0", padding: "16px 0", textAlign: "center" }}>No bills added yet</div>
            : upcomingBills.map(b => {
              const diff = daysDiff(b.nextDate);
              const overdue = diff < 0;
              const soon = diff >= 0 && diff <= 3;
              return (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #2e3347" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: overdue ? "#ef4444" : soon ? "#f59e0b" : "#8b90a0" }}>
                      {overdue ? `${Math.abs(diff)}d overdue` : diff === 0 ? "Due today" : `in ${diff}d`} · {fmtDate(b.nextDate)}
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#ef4444" }}>-{fmt(b.amount)}</div>
                </div>
              );
            })}
        </div>
        <div className="card">
          <div className="section-title" style={{ marginBottom: 14 }}>Recent Expenses</div>
          {recentExpenses.length === 0
            ? <div style={{ fontSize: 12, color: "#8b90a0", padding: "16px 0", textAlign: "center" }}>No expenses logged yet</div>
            : recentExpenses.map(e => (
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #2e3347" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{e.description}</div>
                  <div style={{ fontSize: 11, color: "#8b90a0" }}>{e.category} · {fmtDate(e.date)}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#ef4444" }}>-{fmt(e.amount)}</div>
              </div>
            ))}
        </div>
      </div>

      {goalsSummary.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginBottom: 14 }}>Goal Progress</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
            {goalsSummary.map(g => (
              <div key={g.id} style={{ padding: 12, background: "#12141c", borderRadius: 8, border: "1px solid #2e3347" }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{g.name}</div>
                <div style={{ fontSize: 12, color: "#8b90a0", marginBottom: 6 }}>{fmt(g.currentAmount)} / {fmt(g.targetAmount)}</div>
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${g.pct}%`, background: g.pct >= 100 ? "#4ade80" : "#a78bfa" }} /></div>
                <div style={{ fontSize: 11, color: g.pct >= 100 ? "#4ade80" : "#8b90a0", marginTop: 4, textAlign: "right" }}>{Math.round(g.pct)}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {budgetHealth.length > 0 && (
        <div className="card">
          <div className="section-title" style={{ marginBottom: 14 }}>Budget Health — This Month</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {budgetHealth.map(env => {
              const color = env.pct >= 100 ? "#ef4444" : env.pct >= 80 ? "#f59e0b" : "#4ade80";
              return (
                <div key={env.id} style={{ padding: 12, background: "#12141c", borderRadius: 8, border: `1px solid ${env.pct >= 100 ? "#ef444430" : "#2e3347"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{env.name}</div>
                    <span style={{ fontSize: 10, color, letterSpacing: "0.04em", fontWeight: 600 }}>
                      {env.pct >= 100 ? "OVER" : env.pct >= 80 ? "NEAR" : "OK"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#8b90a0", marginBottom: 6 }}>{fmt(env.spent)} / {fmt(env.allocated)}</div>
                  <div className="progress-bar" style={{ height: 6 }}>
                    <div className="progress-fill" style={{ width: `${Math.min(100, env.pct)}%`, background: color }} />
                  </div>
                  <div style={{ fontSize: 11, color, marginTop: 4, textAlign: "right" }}>{Math.round(env.pct)}% spent</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── INCOME ──────────────────────────────────────────────────────────────────
function IncomeTab({ data, updateData, adjustAccountBalance, showToast }) {
  const [subTab, setSubTab] = useState("recurring");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const dc = useDeleteConfirm();
  const emptyForm = { name: "", amount: "", frequency: "monthly", linkedAccountId: "", nextDate: todayISO(), anchorDate: todayISO(), date: todayISO(), notes: "" };
  const [form, setForm] = useState(emptyForm);

  const items = useMemo(() => {
    const filtered = data.income.filter(i => i.recurring === (subTab === "recurring"));
    return [...filtered].sort((a, b) => (subTab === "recurring" ? (a.nextDate||"").localeCompare(b.nextDate||"") : b.date.localeCompare(a.date)));
  }, [data.income, subTab]);

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm, linkedAccountId: data.accounts[0]?.id||"" }); setShowModal(true); };
  const openEdit = (item) => { setEditing(item.id); setForm({ ...item }); setShowModal(true); };

  const save = () => {
    if (!form.name.trim() || !form.amount) return;
    const entry = { ...form, amount: parseFloat(form.amount), recurring: subTab === "recurring", id: editing||generateId() };
    if (editing) { updateData("income", data.income.map(i => i.id === editing ? entry : i)); showToast("Income updated"); }
    else { updateData("income", [...data.income, entry]); showToast("Income added"); }
    setShowModal(false);
  };

  const remove = (id) => { updateData("income", data.income.filter(i => i.id !== id)); showToast("Income removed"); };

  const markReceived = (item) => {
    const acc = data.accounts.find(a => a.id === item.linkedAccountId);
    adjustAccountBalance(item.linkedAccountId, parseFloat(item.amount)||0);
    if (item.recurring) updateData("income", data.income.map(i => i.id === item.id ? { ...i, nextDate: advanceDate(i.nextDate, i.frequency) } : i));
    showToast(`${fmt(item.amount)} received${acc ? ` → ${acc.name}` : ""}`);
  };

  return (
    <div>
      <PageHeader title="Income" subtitle="Income">
        <button className="btn btn-primary" onClick={openAdd} style={{ fontSize: 12, padding: "7px 14px" }}>
          <i className="ti ti-plus" aria-hidden="true" /> Add Income
        </button>
      </PageHeader>
      <div className="tab-pills">
        <button className={`tab-pill ${subTab === "recurring" ? "active" : ""}`} onClick={() => setSubTab("recurring")}>Recurring</button>
        <button className={`tab-pill ${subTab === "onetime" ? "active" : ""}`} onClick={() => setSubTab("onetime")}>One-Time</button>
      </div>
      {items.length === 0
        ? <EmptyState icon="ti-trending-up" text={`No ${subTab === "recurring" ? "recurring" : "one-time"} income added yet`} />
        : items.map(item => {
          const acc = data.accounts.find(a => a.id === item.linkedAccountId);
          const diff = item.nextDate ? daysDiff(item.nextDate) : null;
          return (
            <div key={item.id} className="list-item">
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: "#4ade8018", border: "1px solid #4ade8030", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <i className="ti ti-trending-up" style={{ color: "#4ade80", fontSize: 16 }} aria-hidden="true" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: "#8b90a0", marginTop: 2 }}>
                    {item.recurring
                      ? `${item.frequency}${(item.frequency === "biweekly" || item.frequency === "weekly") && item.anchorDate ? ` · anchored ${fmtDate(item.anchorDate)}` : ` · next ${fmtDate(item.nextDate)}`}`
                      : fmtDate(item.date)}
                    {acc ? ` → ${acc.name}` : ""}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#4ade80" }}>+{fmt(item.amount)}</div>
                  {item.recurring && diff !== null && (
                    <div style={{ fontSize: 11, color: diff < 0 ? "#ef4444" : diff <= 3 ? "#f59e0b" : "#8b90a0" }}>
                      {diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? "today" : `in ${diff}d`}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {item.linkedAccountId && (
                    <button className="btn btn-success" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => markReceived(item)} title="Mark received">
                      <i className="ti ti-check" aria-hidden="true" />
                    </button>
                  )}
                  <ActionButtons id={item.id} onEdit={() => openEdit(item)} onDelete={() => remove(item.id)} dc={dc} />
                </div>
              </div>
            </div>
          );
        })}
      {showModal && (
        <Modal title={`${editing ? "Edit" : "Add"} ${subTab === "recurring" ? "Recurring" : "One-Time"} Income`} onClose={() => setShowModal(false)}>
          <div className="form-row"><label>Source Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Salary, Freelance" /></div>
          <div className="form-grid form-row">
            <div><label>Amount</label><input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></div>
            <div><label>Deposit to Account</label>
              <select value={form.linkedAccountId} onChange={e => setForm(f => ({ ...f, linkedAccountId: e.target.value }))}>
                <option value="">— unlinked —</option>
                {data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          {subTab === "recurring"
            ? <>
                <div className="form-grid form-row">
                  <div><label>Frequency</label>
                    <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                      {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </div>
                  {(form.frequency === "biweekly" || form.frequency === "weekly")
                    ? <div><label>A Known Pay Date</label><input type="date" value={form.anchorDate||todayISO()} onChange={e => setForm(f => ({ ...f, anchorDate: e.target.value }))} /></div>
                    : <div><label>Next Date</label><input type="date" value={form.nextDate} onChange={e => setForm(f => ({ ...f, nextDate: e.target.value }))} /></div>
                  }
                </div>
                {(form.frequency === "biweekly" || form.frequency === "weekly") && (
                  <div style={{ padding: "10px 14px", background: "#4ade8012", border: "1px solid #4ade8030", borderRadius: 6, fontSize: 12, color: "#4ade80", marginBottom: 14 }}>
                    <i className="ti ti-info-circle" style={{ marginRight: 6 }} aria-hidden="true" />
                    Enter any date you received this paycheck. Cash flow will count actual pay periods per month rather than averaging.
                  </div>
                )}
              </>
            : <div className="form-row"><label>Date</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
          }
          <div className="form-row"><label>Notes (optional)</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note" /></div>
          <ModalFooter onCancel={() => setShowModal(false)} onSave={save} disabled={!form.name.trim() || !form.amount} />
        </Modal>
      )}
    </div>
  );
}

// ─── BILLS ───────────────────────────────────────────────────────────────────
function BillsTab({ data, updateData, adjustAccountBalance, showToast }) {
  const [subTab, setSubTab] = useState("recurring");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const dc = useDeleteConfirm();
  const BILL_CATS = ["Housing","Utilities","Insurance","Subscriptions","Loan Payment","Medical","Phone","Internet","Transportation","Other"];
  const emptyForm = { name: "", amount: "", frequency: "monthly", linkedAccountId: "", nextDate: todayISO(), category: "Other", autopay: false, notes: "" };
  const [form, setForm] = useState(emptyForm);

  const items = useMemo(() => {
    const filtered = data.bills.filter(b => b.recurring === (subTab === "recurring"));
    return [...filtered].sort((a, b) => (a.nextDate||"").localeCompare(b.nextDate||""));
  }, [data.bills, subTab]);

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm, linkedAccountId: data.accounts[0]?.id||"" }); setShowModal(true); };
  const openEdit = (item) => { setEditing(item.id); setForm({ ...item }); setShowModal(true); };

  const save = () => {
    if (!form.name.trim() || !form.amount) return;
    const entry = { ...form, amount: parseFloat(form.amount), recurring: subTab === "recurring", id: editing||generateId() };
    if (editing) { updateData("bills", data.bills.map(b => b.id === editing ? entry : b)); showToast("Bill updated"); }
    else { updateData("bills", [...data.bills, entry]); showToast("Bill added"); }
    setShowModal(false);
  };

  const remove = (id) => { updateData("bills", data.bills.filter(b => b.id !== id)); showToast("Bill removed"); };

  const markPaid = (item) => {
    adjustAccountBalance(item.linkedAccountId, -(parseFloat(item.amount)||0));
    if (item.recurring) {
      updateData("bills", data.bills.map(b => b.id === item.id ? { ...b, nextDate: advanceDate(b.nextDate, b.frequency), lastPaid: todayISO() } : b));
    } else {
      updateData("bills", data.bills.map(b => b.id === item.id ? { ...b, paid: true, lastPaid: todayISO() } : b));
    }
    const acc = data.accounts.find(a => a.id === item.linkedAccountId);
    showToast(`${item.name} paid${acc ? ` · -${fmt(item.amount)} from ${acc.name}` : ""}`);
  };

  return (
    <div>
      <PageHeader title="Bills" subtitle="Bills">
        <button className="btn btn-primary" onClick={openAdd} style={{ fontSize: 12, padding: "7px 14px" }}>
          <i className="ti ti-plus" aria-hidden="true" /> Add Bill
        </button>
      </PageHeader>
      <div className="tab-pills">
        <button className={`tab-pill ${subTab === "recurring" ? "active" : ""}`} onClick={() => setSubTab("recurring")}>Recurring</button>
        <button className={`tab-pill ${subTab === "onetime" ? "active" : ""}`} onClick={() => setSubTab("onetime")}>One-Time</button>
      </div>
      {items.length === 0
        ? <EmptyState icon="ti-file-invoice" text={`No ${subTab === "recurring" ? "recurring" : "one-time"} bills added yet`} />
        : items.map(item => {
          const diff = item.nextDate ? daysDiff(item.nextDate) : null;
          const overdue = diff !== null && diff < 0 && !item.paid;
          const soon = diff !== null && diff >= 0 && diff <= 3;
          const acc = data.accounts.find(a => a.id === item.linkedAccountId);
          return (
            <div key={item.id} className="list-item" style={{ borderColor: overdue ? "#ef444430" : soon ? "#f59e0b30" : "#2e3347", opacity: item.paid ? 0.55 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: overdue ? "#ef444418" : "#ef444410", border: `1px solid ${overdue ? "#ef444440" : "#ef444425"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <i className="ti ti-file-invoice" style={{ color: "#ef4444", fontSize: 16 }} aria-hidden="true" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{item.name}</span>
                    {item.autopay && <span className="badge" style={{ background: "#60a5fa18", color: "#60a5fa", fontSize: 10 }}>autopay</span>}
                    {item.paid && <span className="badge" style={{ background: "#4ade8018", color: "#4ade80", fontSize: 10 }}>paid</span>}
                  </div>
                  <div style={{ fontSize: 11, color: overdue ? "#ef4444" : soon ? "#f59e0b" : "#8b90a0", marginTop: 2 }}>
                    {item.category} · {item.recurring ? item.frequency : "one-time"}
                    {item.nextDate && ` · ${overdue ? `${Math.abs(diff)}d overdue` : diff === 0 ? "due today" : item.paid ? "paid" : `due in ${diff}d`} (${fmtDate(item.nextDate)})`}
                    {acc ? ` · ${acc.name}` : ""}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#ef4444" }}>-{fmt(item.amount)}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {!item.paid && (
                    <button className="btn btn-success" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => markPaid(item)} title="Mark paid">
                      <i className="ti ti-check" aria-hidden="true" />
                    </button>
                  )}
                  <ActionButtons id={item.id} onEdit={() => openEdit(item)} onDelete={() => remove(item.id)} dc={dc} />
                </div>
              </div>
            </div>
          );
        })}
      {showModal && (
        <Modal title={`${editing ? "Edit" : "Add"} ${subTab === "recurring" ? "Recurring" : "One-Time"} Bill`} onClose={() => setShowModal(false)}>
          <div className="form-row"><label>Bill Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Rent, Netflix, Electric" /></div>
          <div className="form-grid form-row">
            <div><label>Amount</label><input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></div>
            <div><label>Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {BILL_CATS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-grid form-row">
            <div><label>Pay from Account</label>
              <select value={form.linkedAccountId} onChange={e => setForm(f => ({ ...f, linkedAccountId: e.target.value }))}>
                <option value="">— unlinked —</option>
                {data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {subTab === "recurring"
              ? <div><label>Frequency</label>
                  <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                    {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
                  </select>
                </div>
              : <div><label>Due Date</label><input type="date" value={form.nextDate} onChange={e => setForm(f => ({ ...f, nextDate: e.target.value }))} /></div>
            }
          </div>
          {subTab === "recurring" && <div className="form-row"><label>Next Due Date</label><input type="date" value={form.nextDate} onChange={e => setForm(f => ({ ...f, nextDate: e.target.value }))} /></div>}
          <div className="form-row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="checkbox" id="autopay" checked={!!form.autopay} onChange={e => setForm(f => ({ ...f, autopay: e.target.checked }))} style={{ width: "auto" }} />
            <label htmlFor="autopay" style={{ margin: 0, cursor: "pointer" }}>Autopay enabled</label>
          </div>
          <div className="form-row"><label>Notes (optional)</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note" /></div>
          <ModalFooter onCancel={() => setShowModal(false)} onSave={save} disabled={!form.name.trim() || !form.amount} />
        </Modal>
      )}
    </div>
  );
}

// ─── EXPENSES ────────────────────────────────────────────────────────────────
function ExpensesTab({ data, updateData, adjustAccountBalance, showToast }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("all");
  const dc = useDeleteConfirm();
  const emptyForm = { description: "", amount: "", category: "Food & Dining", linkedAccountId: "", date: todayISO(), notes: "" };
  const [form, setForm] = useState(emptyForm);

  const debtCategories = useMemo(() => data.debt.map(d => ({ id: d.id, label: d.name })), [data.debt]);

  const sorted = useMemo(() => [...data.expenses].sort((a, b) => b.date.localeCompare(a.date)), [data.expenses]);
  const filtered = useMemo(() => filter === "all" ? sorted : sorted.filter(e => e.category === filter), [sorted, filter]);
  const uniqueCats = useMemo(() => ["all", ...new Set(data.expenses.map(e => e.category))], [data.expenses]);

  const monthStart = todayISO().slice(0, 7) + "-01";
  const monthTotal = data.expenses.filter(e => e.date >= monthStart).reduce((s, e) => s + (parseFloat(e.amount)||0), 0);
  const monthCount = data.expenses.filter(e => e.date >= monthStart).length;

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm, linkedAccountId: data.accounts[0]?.id||"" }); setShowModal(true); };
  const openEdit = (item) => { setEditing(item.id); setForm({ ...item }); setShowModal(true); };

  const save = () => {
    if (!form.description.trim() || !form.amount) return;
    const amt = parseFloat(form.amount);
    const entry = { ...form, amount: amt, id: editing||generateId() };
    if (!editing) {
      if (form.linkedAccountId) adjustAccountBalance(form.linkedAccountId, -amt);
      const debt = debtCategories.find(d => d.label === form.category);
      if (debt) updateData("debt", data.debt.map(d => d.id === debt.id ? { ...d, balance: (parseFloat(d.balance)||0) + amt } : d));
      updateData("expenses", [...data.expenses, entry]);
      showToast("Expense logged");
    } else {
      updateData("expenses", data.expenses.map(e => e.id === editing ? entry : e));
      showToast("Expense updated");
    }
    setShowModal(false);
  };

  const remove = (item) => {
    if (item.linkedAccountId) adjustAccountBalance(item.linkedAccountId, parseFloat(item.amount)||0);
    const debt = debtCategories.find(d => d.label === item.category);
    if (debt) updateData("debt", data.debt.map(d => d.id === debt.id ? { ...d, balance: Math.max(0,(parseFloat(d.balance)||0)-(parseFloat(item.amount)||0)) } : d));
    updateData("expenses", data.expenses.filter(e => e.id !== item.id));
    showToast("Expense removed");
  };

  return (
    <div>
      <PageHeader title="Expenses" subtitle="Expenses">
        <button className="btn btn-primary" onClick={openAdd} style={{ fontSize: 12, padding: "7px 14px" }}>
          <i className="ti ti-plus" aria-hidden="true" /> Log Expense
        </button>
      </PageHeader>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "This Month", value: fmt(monthTotal), color: "#ef4444" },
          { label: "Entries This Month", value: monthCount, color: "#f59e0b" },
          { label: "Avg per Entry", value: fmt(monthCount ? monthTotal/monthCount : 0), color: "#8b90a0" },
        ].map(s => (
          <div key={s.label} className="card">
            <div style={{ fontSize: 11, color: "#8b90a0", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>
      {data.expenses.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {uniqueCats.map(cat => (
            <button key={cat} onClick={() => setFilter(cat)}
              style={{ padding: "4px 12px", borderRadius: 20, border: `1px solid ${filter === cat ? "#f59e0b" : "#2e3347"}`, background: filter === cat ? "#f59e0b18" : "transparent", color: filter === cat ? "#f59e0b" : "#8b90a0", fontSize: 12, cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s" }}>
              {cat === "all" ? "All" : cat}
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0
        ? <EmptyState icon="ti-receipt" text="No expenses logged yet" />
        : filtered.map(item => {
          const acc = data.accounts.find(a => a.id === item.linkedAccountId);
          const isDebt = debtCategories.some(d => d.label === item.category);
          return (
            <div key={item.id} className="list-item">
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: isDebt ? "#a78bfa18" : "#ef444410", border: `1px solid ${isDebt ? "#a78bfa30" : "#ef444425"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <i className={`ti ${isDebt ? "ti-credit-card" : "ti-receipt"}`} style={{ color: isDebt ? "#a78bfa" : "#ef4444", fontSize: 16 }} aria-hidden="true" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{item.description}</div>
                  <div style={{ fontSize: 11, color: "#8b90a0", marginTop: 2 }}>
                    {item.category} · {fmtDate(item.date)}{acc ? ` · ${acc.name}` : ""}
                    {isDebt && <span style={{ color: "#a78bfa", marginLeft: 6 }}>→ balance updated</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#ef4444" }}>-{fmt(item.amount)}</div>
                <ActionButtons id={item.id} onEdit={() => openEdit(item)} onDelete={() => remove(item)} dc={dc} />
              </div>
            </div>
          );
        })}
      {showModal && (
        <Modal title={`${editing ? "Edit" : "Log"} Expense`} onClose={() => setShowModal(false)}>
          <div className="form-row"><label>Description</label><input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Whole Foods, Uber" /></div>
          <div className="form-grid form-row">
            <div><label>Amount</label><input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></div>
            <div><label>Date</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
          </div>
          <div className="form-grid form-row">
            <div><label>Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <optgroup label="General">{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</optgroup>
                {debtCategories.length > 0 && <optgroup label="Credit Cards / Loans">{debtCategories.map(d => <option key={d.id} value={d.label}>{d.label}</option>)}</optgroup>}
              </select>
            </div>
            <div><label>Deduct from Account</label>
              <select value={form.linkedAccountId} onChange={e => setForm(f => ({ ...f, linkedAccountId: e.target.value }))}>
                <option value="">— unlinked —</option>
                {data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row"><label>Notes (optional)</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note" /></div>
          {debtCategories.some(d => d.label === form.category) && (
            <div style={{ padding: "10px 14px", background: "#a78bfa12", border: "1px solid #a78bfa30", borderRadius: 6, fontSize: 12, color: "#a78bfa", marginBottom: 14 }}>
              <i className="ti ti-info-circle" style={{ marginRight: 6 }} aria-hidden="true" />
              This will increase the balance on <strong>{form.category}</strong>
            </div>
          )}
          <ModalFooter onCancel={() => setShowModal(false)} onSave={save} disabled={!form.description.trim() || !form.amount} />
        </Modal>
      )}
    </div>
  );
}

// ─── DEBT ─────────────────────────────────────────────────────────────────────
function DebtTab({ data, updateData, adjustAccountBalance, showToast }) {
  const [subTab, setSubTab] = useState("cards");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showPayModal, setShowPayModal] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payAccountId, setPayAccountId] = useState("");
  const dc = useDeleteConfirm();

  const emptyCard = { name: "", balance: "", creditLimit: "", apr: "", targetPayment: "", linkedAccountId: "", notes: "", type: "card" };
  const emptyLoan = { name: "", balance: "", originalAmount: "", apr: "", minimumPayment: "", targetPayment: "", linkedAccountId: "", startDate: todayISO(), notes: "", type: "loan" };
  const [form, setForm] = useState(emptyCard);

  const items = useMemo(() =>
    [...data.debt.filter(d => subTab === "cards" ? d.type === "card" : d.type === "loan")]
    .sort((a, b) => (parseFloat(b.balance)||0) - (parseFloat(a.balance)||0)),
    [data.debt, subTab]);

  const totalDebt = data.debt.reduce((s, d) => s + (parseFloat(d.balance)||0), 0);
  const totalCards = data.debt.filter(d => d.type === "card").reduce((s, d) => s + (parseFloat(d.balance)||0), 0);
  const totalLoans = data.debt.filter(d => d.type === "loan").reduce((s, d) => s + (parseFloat(d.balance)||0), 0);

  const openAdd = () => {
    setEditing(null);
    setForm(subTab === "cards" ? { ...emptyCard, linkedAccountId: data.accounts[0]?.id||"" } : { ...emptyLoan, linkedAccountId: data.accounts[0]?.id||"" });
    setShowModal(true);
  };
  const openEdit = (item) => { setEditing(item.id); setForm({ ...item }); setShowModal(true); };

  const save = () => {
    if (!form.name.trim()) return;
    const entry = { ...form, balance: parseFloat(form.balance)||0, id: editing||generateId(), type: subTab === "cards" ? "card" : "loan" };
    if (editing) { updateData("debt", data.debt.map(d => d.id === editing ? entry : d)); showToast("Updated"); }
    else { updateData("debt", [...data.debt, entry]); showToast(`${subTab === "cards" ? "Card" : "Loan"} added`); }
    setShowModal(false);
  };

  const remove = (id) => { updateData("debt", data.debt.filter(d => d.id !== id)); showToast("Removed"); };

  const openPayment = (item) => {
    setShowPayModal(item);
    setPayAmount(item.targetPayment || item.minimumPayment || "");
    setPayAccountId(item.linkedAccountId || data.accounts[0]?.id || "");
  };

  const makePayment = () => {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) return;
    adjustAccountBalance(payAccountId, -amt);
    updateData("debt", data.debt.map(d => d.id === showPayModal.id
      ? { ...d, balance: Math.max(0,(parseFloat(d.balance)||0) - amt), lastPayment: { date: todayISO(), amount: amt } }
      : d));
    const acc = data.accounts.find(a => a.id === payAccountId);
    showToast(`Payment of ${fmt(amt)} applied${acc ? ` from ${acc.name}` : ""}`);
    setShowPayModal(null);
  };

  const payoffMonths = (item) => {
    const bal = parseFloat(item.balance)||0;
    const rate = (parseFloat(item.apr)||0) / 100 / 12;
    const pmt = parseFloat(item.targetPayment || item.minimumPayment)||0;
    if (!bal || !pmt) return null;
    if (!rate) return Math.ceil(bal/pmt);
    if (pmt <= bal * rate) return null;
    return Math.ceil(-Math.log(1 - (bal*rate)/pmt) / Math.log(1+rate));
  };

  return (
    <div>
      <PageHeader title="Debt" subtitle="Debt">
        <button className="btn btn-primary" onClick={openAdd} style={{ fontSize: 12, padding: "7px 14px" }}>
          <i className="ti ti-plus" aria-hidden="true" /> Add {subTab === "cards" ? "Card" : "Loan"}
        </button>
      </PageHeader>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Debt", value: fmt(totalDebt), color: "#ef4444" },
          { label: "Credit Cards", value: fmt(totalCards), color: "#a78bfa" },
          { label: "Loans", value: fmt(totalLoans), color: "#f59e0b" },
        ].map(s => (
          <div key={s.label} className="card">
            <div style={{ fontSize: 11, color: "#8b90a0", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="tab-pills">
        <button className={`tab-pill ${subTab === "cards" ? "active" : ""}`} onClick={() => setSubTab("cards")}>Credit Cards</button>
        <button className={`tab-pill ${subTab === "loans" ? "active" : ""}`} onClick={() => setSubTab("loans")}>Loans</button>
      </div>

      {items.length === 0
        ? <EmptyState icon="ti-credit-card" text={`No ${subTab === "cards" ? "credit cards" : "loans"} added yet`} />
        : items.map(item => {
          const months = payoffMonths(item);
          const utilPct = item.creditLimit > 0 ? Math.min(100, ((parseFloat(item.balance)||0)/parseFloat(item.creditLimit))*100) : null;
          const acc = data.accounts.find(a => a.id === item.linkedAccountId);
          return (
            <div key={item.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: "#8b90a0", marginTop: 2 }}>
                    {item.apr ? `${item.apr}% APR` : "No APR set"}
                    {acc ? ` · pay from ${acc.name}` : ""}
                    {item.lastPayment && ` · last paid ${fmtDate(item.lastPayment.date)}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-success" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => openPayment(item)}>
                    <i className="ti ti-credit-card" aria-hidden="true" /> Pay
                  </button>
                  <ActionButtons id={item.id} onEdit={() => openEdit(item)} onDelete={() => remove(item.id)} dc={dc} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
                <div style={{ padding: "10px 12px", background: "#12141c", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "#8b90a0", marginBottom: 2 }}>Current Balance</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "#ef4444" }}>{fmt(item.balance)}</div>
                </div>
                {item.type === "card" && item.creditLimit && (
                  <div style={{ padding: "10px 12px", background: "#12141c", borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: "#8b90a0", marginBottom: 2 }}>Credit Limit</div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{fmt(item.creditLimit)}</div>
                  </div>
                )}
                {(item.targetPayment || item.minimumPayment) && (
                  <div style={{ padding: "10px 12px", background: "#12141c", borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: "#8b90a0", marginBottom: 2 }}>{item.type === "card" ? "Target Payment" : "Min. Payment"}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#f59e0b" }}>{fmt(item.targetPayment || item.minimumPayment)}</div>
                  </div>
                )}
                {months !== null && (
                  <div style={{ padding: "10px 12px", background: "#12141c", borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: "#8b90a0", marginBottom: 2 }}>Est. Payoff</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#4ade80" }}>{months}mo</div>
                  </div>
                )}
              </div>

              {utilPct !== null && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8b90a0", marginBottom: 4 }}>
                    <span>Utilization</span>
                    <span style={{ color: utilPct > 70 ? "#ef4444" : utilPct > 30 ? "#f59e0b" : "#4ade80" }}>{Math.round(utilPct)}%</span>
                  </div>
                  <div className="progress-bar" style={{ height: 6 }}>
                    <div className="progress-fill" style={{ width: `${utilPct}%`, background: utilPct > 70 ? "#ef4444" : utilPct > 30 ? "#f59e0b" : "#4ade80" }} />
                  </div>
                </div>
              )}

              {item.notes && <div style={{ fontSize: 12, color: "#8b90a0", marginTop: 10 }}>{item.notes}</div>}
            </div>
          );
        })}

      {showModal && (
        <Modal title={`${editing ? "Edit" : "Add"} ${subTab === "cards" ? "Credit Card" : "Loan"}`} onClose={() => setShowModal(false)}>
          <div className="form-row"><label>Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={subTab === "cards" ? "e.g. Chase Sapphire, Amex" : "e.g. Car Loan, Student Loan"} /></div>
          <div className="form-grid form-row">
            <div><label>Current Balance</label><input type="number" step="0.01" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} placeholder="0.00" /></div>
            <div><label>APR (%)</label><input type="number" step="0.01" value={form.apr} onChange={e => setForm(f => ({ ...f, apr: e.target.value }))} placeholder="e.g. 24.99" /></div>
          </div>
          {subTab === "cards"
            ? <div className="form-grid form-row">
                <div><label>Credit Limit</label><input type="number" step="0.01" value={form.creditLimit||""} onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))} placeholder="0.00" /></div>
                <div><label>Target Monthly Payment</label><input type="number" step="0.01" value={form.targetPayment||""} onChange={e => setForm(f => ({ ...f, targetPayment: e.target.value }))} placeholder="0.00 (flexible)" /></div>
              </div>
            : <div className="form-grid form-row">
                <div><label>Minimum Payment</label><input type="number" step="0.01" value={form.minimumPayment||""} onChange={e => setForm(f => ({ ...f, minimumPayment: e.target.value }))} placeholder="0.00" /></div>
                <div><label>Target Payment</label><input type="number" step="0.01" value={form.targetPayment||""} onChange={e => setForm(f => ({ ...f, targetPayment: e.target.value }))} placeholder="0.00" /></div>
              </div>
          }
          <div className="form-row"><label>Pay from Account</label>
            <select value={form.linkedAccountId} onChange={e => setForm(f => ({ ...f, linkedAccountId: e.target.value }))}>
              <option value="">— unlinked —</option>
              {data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Notes (optional)</label><input value={form.notes||""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note" /></div>
          <ModalFooter onCancel={() => setShowModal(false)} onSave={save} disabled={!form.name.trim()} />
        </Modal>
      )}

      {showPayModal && (
        <Modal title={`Make Payment — ${showPayModal.name}`} onClose={() => setShowPayModal(null)}>
          <div style={{ fontSize: 13, color: "#8b90a0", marginBottom: 16 }}>
            Current balance: <strong style={{ color: "#ef4444" }}>{fmt(showPayModal.balance)}</strong>
            {showPayModal.targetPayment && <span> · target: <strong style={{ color: "#f59e0b" }}>{fmt(showPayModal.targetPayment)}</strong></span>}
          </div>
          <div className="form-row"><label>Payment Amount</label><input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0.00" /></div>
          <div className="form-row"><label>Pay from Account</label>
            <select value={payAccountId} onChange={e => setPayAccountId(e.target.value)}>
              <option value="">— unlinked —</option>
              {data.accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({fmt(a.balance)})</option>)}
            </select>
          </div>
          <ModalFooter onCancel={() => setShowPayModal(null)} onSave={makePayment} saveLabel="Apply Payment" disabled={!payAmount || parseFloat(payAmount) <= 0} />
        </Modal>
      )}
    </div>
  );
}

// ─── GOALS ────────────────────────────────────────────────────────────────────
function GoalsTab({ data, updateData, adjustAccountBalance, showToast, allocatedByAccount }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showContribModal, setShowContribModal] = useState(null);
  const [contribAmount, setContribAmount] = useState("");
  const [contribNote, setContribNote] = useState("");
  const dc = useDeleteConfirm();

  const emptyForm = { name: "", targetAmount: "", currentAmount: "0", linkedAccountId: "", monthlyContribution: "", targetDate: "", notes: "" };
  const [form, setForm] = useState(emptyForm);

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm, linkedAccountId: data.accounts[0]?.id||"" }); setShowModal(true); };
  const openEdit = (g) => { setEditing(g.id); setForm({ ...g }); setShowModal(true); };

  const save = () => {
    if (!form.name.trim() || !form.targetAmount) return;
    const entry = { ...form, targetAmount: parseFloat(form.targetAmount), currentAmount: parseFloat(form.currentAmount)||0, id: editing||generateId() };
    if (editing) { updateData("goals", data.goals.map(g => g.id === editing ? entry : g)); showToast("Goal updated"); }
    else { updateData("goals", [...data.goals, entry]); showToast("Goal added"); }
    setShowModal(false);
  };

  const remove = (id) => { updateData("goals", data.goals.filter(g => g.id !== id)); showToast("Goal removed"); };

  const openContrib = (goal) => { setShowContribModal(goal); setContribAmount(goal.monthlyContribution||""); setContribNote(""); };

  const addContribution = () => {
    const amt = parseFloat(contribAmount);
    if (!amt || amt <= 0) return;
    const goal = showContribModal;
    const newAmount = (parseFloat(goal.currentAmount)||0) + amt;
    const contrib = { date: todayISO(), amount: amt, note: contribNote };
    updateData("goals", data.goals.map(g => g.id === goal.id
      ? { ...g, currentAmount: newAmount, contributions: [...(g.contributions||[]), contrib] }
      : g));
    if (goal.linkedAccountId) adjustAccountBalance(goal.linkedAccountId, 0);
    showToast(`${fmt(amt)} added to ${goal.name}`);
    setShowContribModal(null);
  };

  return (
    <div>
      <PageHeader title="Goals" subtitle="Goals">
        <button className="btn btn-primary" onClick={openAdd} style={{ fontSize: 12, padding: "7px 14px" }}>
          <i className="ti ti-plus" aria-hidden="true" /> Add Goal
        </button>
      </PageHeader>

      {data.goals.length === 0
        ? <EmptyState icon="ti-target" text="No savings goals yet. Add one to get started." />
        : data.goals.map(goal => {
          const current = parseFloat(goal.currentAmount)||0;
          const target = parseFloat(goal.targetAmount)||0;
          const pct = target > 0 ? Math.min(100,(current/target)*100) : 0;
          const remaining = Math.max(0, target - current);
          const acc = data.accounts.find(a => a.id === goal.linkedAccountId);
          const accBalance = acc ? parseFloat(acc.balance)||0 : 0;
          const accAllocated = allocatedByAccount[goal.linkedAccountId]||0;
          const accFree = accBalance - accAllocated;
          const monthsLeft = goal.monthlyContribution && remaining > 0
            ? Math.ceil(remaining / (parseFloat(goal.monthlyContribution)||1)) : null;

          return (
            <div key={goal.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{goal.name}</div>
                  <div style={{ fontSize: 11, color: "#8b90a0", marginTop: 2 }}>
                    {acc ? `in ${acc.name}` : "No account linked"}
                    {goal.targetDate ? ` · target ${fmtDate(goal.targetDate)}` : ""}
                    {monthsLeft ? ` · ~${monthsLeft}mo to go` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-success" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => openContrib(goal)}>
                    <i className="ti ti-plus" aria-hidden="true" /> Contribute
                  </button>
                  <ActionButtons id={goal.id} onEdit={() => openEdit(goal)} onDelete={() => remove(goal.id)} dc={dc} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
                <div style={{ padding: "10px 12px", background: "#12141c", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "#8b90a0", marginBottom: 2 }}>Saved</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "#a78bfa" }}>{fmt(current)}</div>
                </div>
                <div style={{ padding: "10px 12px", background: "#12141c", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "#8b90a0", marginBottom: 2 }}>Target</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{fmt(target)}</div>
                </div>
                <div style={{ padding: "10px 12px", background: "#12141c", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "#8b90a0", marginBottom: 2 }}>Remaining</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: remaining > 0 ? "#f59e0b" : "#4ade80" }}>{remaining > 0 ? fmt(remaining) : "Complete!"}</div>
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8b90a0", marginBottom: 4 }}>
                  <span>Progress</span>
                  <span style={{ color: pct >= 100 ? "#4ade80" : "#a78bfa" }}>{Math.round(pct)}%</span>
                </div>
                <div className="progress-bar" style={{ height: 8 }}>
                  <div className="progress-fill" style={{ width: `${pct}%`, background: pct >= 100 ? "#4ade80" : "#a78bfa" }} />
                </div>
              </div>

              {acc && (
                <div style={{ padding: "8px 12px", background: "#12141c", borderRadius: 6, fontSize: 12, color: "#8b90a0" }}>
                  <i className="ti ti-building-bank" style={{ marginRight: 6 }} aria-hidden="true" />
                  {acc.name}: <span style={{ color: "#e8eaf0" }}>{fmt(accBalance)}</span> total ·
                  <span style={{ color: "#a78bfa" }}> {fmt(accAllocated)} allocated</span> ·
                  <span style={{ color: "#4ade80" }}> {fmt(accFree)} free</span>
                </div>
              )}

              {goal.contributions && goal.contributions.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "#8b90a0", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Recent Contributions</div>
                  {[...goal.contributions].reverse().slice(0, 3).map((c, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #2e3347" }}>
                      <span style={{ color: "#8b90a0" }}>{fmtDate(c.date)}{c.note ? ` · ${c.note}` : ""}</span>
                      <span style={{ color: "#4ade80" }}>+{fmt(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

      {showModal && (
        <Modal title={`${editing ? "Edit" : "Add"} Goal`} onClose={() => setShowModal(false)}>
          <div className="form-row"><label>Goal Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Emergency Fund, Vacation, Down Payment" /></div>
          <div className="form-grid form-row">
            <div><label>Target Amount</label><input type="number" step="0.01" value={form.targetAmount} onChange={e => setForm(f => ({ ...f, targetAmount: e.target.value }))} placeholder="0.00" /></div>
            <div><label>Starting Amount</label><input type="number" step="0.01" value={form.currentAmount} onChange={e => setForm(f => ({ ...f, currentAmount: e.target.value }))} placeholder="0.00" /></div>
          </div>
          <div className="form-grid form-row">
            <div><label>Linked Account</label>
              <select value={form.linkedAccountId} onChange={e => setForm(f => ({ ...f, linkedAccountId: e.target.value }))}>
                <option value="">— unlinked —</option>
                {data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div><label>Monthly Contribution</label><input type="number" step="0.01" value={form.monthlyContribution||""} onChange={e => setForm(f => ({ ...f, monthlyContribution: e.target.value }))} placeholder="0.00 (optional)" /></div>
          </div>
          <div className="form-row"><label>Target Date (optional)</label><input type="date" value={form.targetDate||""} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} /></div>
          <div className="form-row"><label>Notes (optional)</label><input value={form.notes||""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note" /></div>
          <ModalFooter onCancel={() => setShowModal(false)} onSave={save} disabled={!form.name.trim() || !form.targetAmount} />
        </Modal>
      )}

      {showContribModal && (
        <Modal title={`Add Contribution — ${showContribModal.name}`} onClose={() => setShowContribModal(null)}>
          <div style={{ fontSize: 13, color: "#8b90a0", marginBottom: 16 }}>
            Current: <strong style={{ color: "#a78bfa" }}>{fmt(showContribModal.currentAmount)}</strong> / <strong>{fmt(showContribModal.targetAmount)}</strong>
            {showContribModal.monthlyContribution && <span> · suggested {fmt(showContribModal.monthlyContribution)}/mo</span>}
          </div>
          <div className="form-row"><label>Amount</label><input type="number" step="0.01" value={contribAmount} onChange={e => setContribAmount(e.target.value)} placeholder="0.00" autoFocus /></div>
          <div className="form-row"><label>Note (optional)</label><input value={contribNote} onChange={e => setContribNote(e.target.value)} placeholder="e.g. Monthly transfer, bonus" /></div>
          <ModalFooter onCancel={() => setShowContribModal(null)} onSave={addContribution} saveLabel="Add Contribution" disabled={!contribAmount || parseFloat(contribAmount) <= 0} />
        </Modal>
      )}
    </div>
  );
}

// ─── CASH FLOW ────────────────────────────────────────────────────────────────
function CashFlowTab({ data }) {
  const months = 3;

  const projection = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const results = [];
    for (let m = 0; m < months; m++) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() + m, 1);
      const monthKey = monthDate.toISOString().slice(0, 7);
      const monthLabel = monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      let income = 0, bills = 0, budgetTotal = 0;
      const incomeItems = [], billItems = [], budgetItems = [];

      // Recurring income — biweekly/weekly use actual occurrence count for this month
      data.income.filter(i => i.recurring).forEach(i => {
        let monthly;
        if ((i.frequency === "biweekly" || i.frequency === "weekly") && i.anchorDate) {
          const count = countOccurrencesInMonth(i.anchorDate, i.frequency, monthKey);
          monthly = (parseFloat(i.amount)||0) * count;
        } else {
          monthly = monthlyEquivalent(i.amount, i.frequency);
        }
        income += monthly;
        const freq = i.frequency;
        const isDateBased = (freq === "biweekly" || freq === "weekly") && i.anchorDate;
        const count = isDateBased ? countOccurrencesInMonth(i.anchorDate, i.frequency, monthKey) : null;
        incomeItems.push({ name: i.name, amount: monthly, paychecks: count });
      });
      // One-time income in this month
      data.income.filter(i => !i.recurring && i.date && i.date.startsWith(monthKey)).forEach(i => {
        income += parseFloat(i.amount)||0;
        incomeItems.push({ name: i.name, amount: parseFloat(i.amount)||0, oneTime: true });
      });

      // Recurring bills
      data.bills.filter(b => b.recurring && !b.paid).forEach(b => {
        const monthly = monthlyEquivalent(b.amount, b.frequency);
        bills += monthly;
        billItems.push({ name: b.name, amount: monthly });
      });
      // One-time bills due this month
      data.bills.filter(b => !b.recurring && !b.paid && b.nextDate && b.nextDate.startsWith(monthKey)).forEach(b => {
        bills += parseFloat(b.amount)||0;
        billItems.push({ name: b.name, amount: parseFloat(b.amount)||0, oneTime: true });
      });

      // Budget envelopes
      (data.budget||[]).forEach(env => {
        const amt = parseFloat(env.amount)||0;
        if (!amt) return;
        const hits = budgetHitsInMonth(env.startDate, env.freq, env.customMonths, monthKey);
        const monthlyAvg = monthlyEquivalent(amt, env.freq, parseInt(env.customMonths)||1);
        if (hits) {
          // Show lump sum in the month it actually hits
          budgetTotal += amt;
          budgetItems.push({ name: env.name, amount: amt, lump: true });
        } else if (env.freq === "monthly") {
          // Monthly envelopes always show
          budgetTotal += amt;
          budgetItems.push({ name: env.name, amount: amt });
        } else {
          // Non-monthly, not hitting this month — show smoothed average
          budgetTotal += monthlyAvg;
          budgetItems.push({ name: env.name, amount: monthlyAvg, avg: true });
        }
      });

      results.push({ monthKey, monthLabel, income, bills, budgetTotal, net: income - bills - budgetTotal, incomeItems, billItems, budgetItems });
    }
    return results;
  }, [data, months]);

  const startBalance = data.accounts.reduce((s, a) => s + (parseFloat(a.balance)||0), 0);
  let runningBalance = startBalance;

  return (
    <div>
      <PageHeader title="Cash Flow" subtitle="Cash Flow" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Current Balance", value: fmt(startBalance), color: "#f59e0b" },
          { label: "Monthly Income", value: fmt(projection[0]?.income||0), color: "#4ade80" },
          { label: "Bills + Budget", value: fmt((projection[0]?.bills||0) + (projection[0]?.budgetTotal||0)), color: "#ef4444" },
        ].map(s => (
          <div key={s.label} className="card">
            <div style={{ fontSize: 11, color: "#8b90a0", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>
      {data.income.filter(i => i.recurring).length === 0 && data.bills.filter(b => b.recurring).length === 0 && (data.budget||[]).length === 0 ? (
        <div className="empty-state">
          <i className="ti ti-chart-line" style={{ fontSize: 32, display: "block", marginBottom: 8 }} aria-hidden="true" />
          Add recurring income, bills, or budget envelopes to see your cash flow projection
        </div>
      ) : projection.map((month) => {
        const openingBalance = runningBalance;
        runningBalance += month.net;
        const closingBalance = runningBalance;
        return (
          <div key={month.monthKey} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{month.monthLabel}</div>
                <div style={{ fontSize: 11, color: "#8b90a0", marginTop: 2 }}>
                  Opening: {fmt(openingBalance)} → Closing: <span style={{ color: closingBalance >= openingBalance ? "#4ade80" : "#ef4444" }}>{fmt(closingBalance)}</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, color: "#8b90a0" }}>Net</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: month.net >= 0 ? "#4ade80" : "#ef4444" }}>
                  {month.net >= 0 ? "+" : ""}{fmt(month.net)}
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: month.budgetItems.length > 0 ? "1fr 1fr 1fr" : "1fr 1fr", gap: 12 }}>
              <div style={{ padding: "12px", background: "#12141c", borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: "#4ade80", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Income · {fmt(month.income)}</div>
                {month.incomeItems.length === 0
                  ? <div style={{ fontSize: 12, color: "#8b90a0" }}>None</div>
                  : month.incomeItems.map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                      <span style={{ color: "#8b90a0" }}>
                        {item.name}{item.oneTime ? " (one-time)" : ""}
                        {item.paychecks != null && <span style={{ color: "#6b7280", marginLeft: 4 }}>×{item.paychecks}</span>}
                      </span>
                      <span style={{ color: "#4ade80" }}>+{fmt(item.amount)}</span>
                    </div>
                  ))}
              </div>
              <div style={{ padding: "12px", background: "#12141c", borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: "#ef4444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Bills · {fmt(month.bills)}</div>
                {month.billItems.length === 0
                  ? <div style={{ fontSize: 12, color: "#8b90a0" }}>None</div>
                  : month.billItems.map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                      <span style={{ color: "#8b90a0" }}>{item.name}{item.oneTime ? " (one-time)" : ""}</span>
                      <span style={{ color: "#ef4444" }}>-{fmt(item.amount)}</span>
                    </div>
                  ))}
              </div>
              {month.budgetItems.length > 0 && (
                <div style={{ padding: "12px", background: "#12141c", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#f59e0b", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Budget · {fmt(month.budgetTotal)}</div>
                  {month.budgetItems.map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                      <span style={{ color: "#8b90a0" }}>
                        {item.name}
                        {item.lump && <span style={{ color: "#f59e0b", marginLeft: 4 }}>●</span>}
                        {item.avg && <span style={{ color: "#6b7280", marginLeft: 4, fontSize: 10 }}>avg</span>}
                      </span>
                      <span style={{ color: "#f59e0b" }}>-{fmt(item.amount)}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 10, color: "#6b7280", marginTop: 6 }}>● = hits this month</div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function SettingsTab({ data, updateData, showToast, allocatedByAccount }) {
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [adjustValue, setAdjustValue] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const dc = useDeleteConfirm();
  const emptyForm = { name: "", type: "Checking", balance: "", color: ACCOUNT_COLORS[0], notes: "" };
  const [form, setForm] = useState(emptyForm);

  const openAdd = () => { setEditingAccount(null); setForm(emptyForm); setShowAccountModal(true); };
  const openEdit = (acc) => { setEditingAccount(acc.id); setForm({ name: acc.name, type: acc.type, balance: acc.balance, color: acc.color||ACCOUNT_COLORS[0], notes: acc.notes||"" }); setShowAccountModal(true); };
  const openAdjust = (acc) => { setAdjustTarget(acc); setAdjustValue(acc.balance); setAdjustNote(""); setShowAdjustModal(true); };

  const saveAccount = () => {
    if (!form.name.trim()) return;
    const bal = parseFloat(form.balance)||0;
    if (editingAccount) { updateData("accounts", data.accounts.map(a => a.id === editingAccount ? { ...a, ...form, balance: bal } : a)); showToast("Account updated"); }
    else { updateData("accounts", [...data.accounts, { id: generateId(), ...form, balance: bal }]); showToast("Account added"); }
    setShowAccountModal(false);
  };

  const saveAdjust = () => {
    const newBal = parseFloat(adjustValue);
    if (isNaN(newBal)) return;
    updateData("accounts", data.accounts.map(a => a.id === adjustTarget.id
      ? { ...a, balance: newBal, adjustments: [...(a.adjustments||[]), { date: todayISO(), from: a.balance, to: newBal, note: adjustNote }] }
      : a));
    showToast("Balance reconciled");
    setShowAdjustModal(false);
  };

  const deleteAccount = (id) => {
    if (allocatedByAccount[id]) { showToast("Cannot delete — account has allocated goals", "error"); return; }
    updateData("accounts", data.accounts.filter(a => a.id !== id));
    showToast("Account removed");
  };

  return (
    <div>
      <PageHeader title="Accounts & Preferences" subtitle="Settings" />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-header">
          <div className="section-title">Accounts</div>
          <button className="btn btn-primary" onClick={openAdd} style={{ fontSize: 12, padding: "7px 14px" }}>
            <i className="ti ti-plus" aria-hidden="true" /> Add Account
          </button>
        </div>
        {data.accounts.length === 0
          ? <div className="empty-state"><i className="ti ti-building-bank" style={{ fontSize: 32, display: "block", marginBottom: 8 }} aria-hidden="true" />No accounts yet.</div>
          : data.accounts.map(acc => {
            const allocated = allocatedByAccount[acc.id]||0;
            const free = (parseFloat(acc.balance)||0) - allocated;
            return (
              <div key={acc.id} className="list-item">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: acc.color+"22", border: `1px solid ${acc.color}44`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: acc.color }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{acc.name}</div>
                    <div style={{ fontSize: 11, color: "#8b90a0" }}>{acc.type}{acc.notes ? ` · ${acc.notes}` : ""}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{fmt(acc.balance)}</div>
                    {allocated > 0 && <div style={{ fontSize: 11, color: "#8b90a0" }}>{fmt(free)} available</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 12 }} title="Reconcile balance" onClick={() => openAdjust(acc)}>
                      <i className="ti ti-adjustments" aria-hidden="true" />
                    </button>
                    <ActionButtons id={acc.id} onEdit={() => openEdit(acc)} onDelete={() => deleteAccount(acc.id)} dc={dc} />
                  </div>
                </div>
              </div>
            );
          })}
      </div>
      <div className="card">
        <div className="section-title" style={{ marginBottom: 12 }}>Data Management</div>
        <div style={{ fontSize: 13, color: "#8b90a0", marginBottom: 14, lineHeight: 1.6 }}>All data is stored locally in your browser. Export a JSON backup regularly. Import to restore a previous state.</div>
        <div style={{ padding: 14, background: "#12141c", borderRadius: 8, border: "1px solid #2e3347" }}>
          <div style={{ fontSize: 11, color: "#8b90a0", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Storage Summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[["Accounts",data.accounts.length],["Income",data.income.length],["Bills",data.bills.length],["Expenses",data.expenses.length],["Debt",data.debt.length],["Goals",data.goals.length]].map(([l,v]) => (
              <div key={l}><div style={{ fontSize: 18, fontWeight: 600, color: "#f59e0b" }}>{v}</div><div style={{ fontSize: 11, color: "#8b90a0" }}>{l}</div></div>
            ))}
          </div>
        </div>
      </div>
      {showAccountModal && (
        <Modal title={editingAccount ? "Edit Account" : "Add Account"} onClose={() => setShowAccountModal(false)}>
          <div className="form-row"><label>Account Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Chase Checking" /></div>
          <div className="form-grid form-row">
            <div><label>Account Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div><label>Current Balance</label><input type="number" step="0.01" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} placeholder="0.00" /></div>
          </div>
          <div className="form-row">
            <label>Color Tag</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {ACCOUNT_COLORS.map(c => (
                <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                  style={{ width: 28, height: 28, borderRadius: "50%", background: c, border: form.color === c ? "3px solid #fff" : "2px solid transparent", cursor: "pointer" }} />
              ))}
            </div>
          </div>
          <div className="form-row"><label>Notes (optional)</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. primary checking" /></div>
          <ModalFooter onCancel={() => setShowAccountModal(false)} onSave={saveAccount} disabled={!form.name.trim()} />
        </Modal>
      )}
      {showAdjustModal && adjustTarget && (
        <Modal title="Reconcile Balance" onClose={() => setShowAdjustModal(false)}>
          <div style={{ fontSize: 13, color: "#8b90a0", marginBottom: 16, lineHeight: 1.6 }}>
            Set <strong style={{ color: "#e8eaf0" }}>{adjustTarget.name}</strong> to your actual bank balance. Currently tracking: <strong style={{ color: "#f59e0b" }}>{fmt(adjustTarget.balance)}</strong>
          </div>
          <div className="form-row"><label>Actual Balance</label><input type="number" step="0.01" value={adjustValue} onChange={e => setAdjustValue(e.target.value)} placeholder="0.00" /></div>
          <div className="form-row"><label>Reason / Note</label><input value={adjustNote} onChange={e => setAdjustNote(e.target.value)} placeholder="e.g. reconciled with bank statement" /></div>
          {adjustValue !== "" && !isNaN(parseFloat(adjustValue)) && (
            <div style={{ padding: "10px 14px", background: "#12141c", borderRadius: 6, border: "1px solid #2e3347", fontSize: 12, color: "#8b90a0", marginBottom: 14 }}>
              Adjustment: <span style={{ color: parseFloat(adjustValue)-adjustTarget.balance >= 0 ? "#4ade80" : "#ef4444", fontWeight: 600 }}>
                {parseFloat(adjustValue)-adjustTarget.balance >= 0 ? "+" : ""}{fmt(parseFloat(adjustValue)-adjustTarget.balance)}
              </span>
            </div>
          )}
          <ModalFooter onCancel={() => setShowAdjustModal(false)} onSave={saveAdjust} saveLabel="Reconcile" disabled={adjustValue===""||isNaN(parseFloat(adjustValue))} />
        </Modal>
      )}
    </div>
  );
}

// ─── BUDGET ───────────────────────────────────────────────────────────────────
function BudgetTab({ data, updateData, showToast }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const dc = useDeleteConfirm();

  const ALL_CATS = [...EXPENSE_CATEGORIES, ...data.debt.map(d => d.name)];
  const FREQ_OPTIONS = ["weekly","biweekly","monthly","quarterly","annual","custom"];

  const emptyForm = { name: "", category: "Food & Dining", amount: "", freq: "monthly", customMonths: "", startDate: todayISO(), notes: "" };
  const [form, setForm] = useState(emptyForm);

  const monthKey = todayISO().slice(0, 7);
  const monthStart = todayISO().slice(0, 7) + "-01";

  const envelopes = useMemo(() => [...(data.budget||[])].sort((a,b) => a.name.localeCompare(b.name)), [data.budget]);

  const totalMonthlyBudget = useMemo(() =>
    envelopes.reduce((s, env) => s + monthlyEquivalent(env.amount, env.freq, parseInt(env.customMonths)||1), 0),
    [envelopes]);

  const totalMonthSpent = useMemo(() => {
    return envelopes.reduce((s, env) => {
      const spent = data.expenses.filter(e => e.date >= monthStart && e.category === env.category).reduce((ss, e) => ss + (parseFloat(e.amount)||0), 0);
      return s + spent;
    }, 0);
  }, [envelopes, data.expenses, monthStart]);

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (env) => { setEditing(env.id); setForm({ ...env }); setShowModal(true); };

  const save = () => {
    if (!form.name.trim() || !form.amount) return;
    const entry = { ...form, amount: parseFloat(form.amount), id: editing||generateId() };
    if (editing) { updateData("budget", (data.budget||[]).map(e => e.id === editing ? entry : e)); showToast("Envelope updated"); }
    else { updateData("budget", [...(data.budget||[]), entry]); showToast("Envelope added"); }
    setShowModal(false);
  };

  const remove = (id) => { updateData("budget", (data.budget||[]).filter(e => e.id !== id)); showToast("Envelope removed"); };

  return (
    <div>
      <PageHeader title="Budget" subtitle="Budget">
        <button className="btn btn-primary" onClick={openAdd} style={{ fontSize: 12, padding: "7px 14px" }}>
          <i className="ti ti-plus" aria-hidden="true" /> Add Envelope
        </button>
      </PageHeader>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Monthly Budget", value: fmt(totalMonthlyBudget), color: "#f59e0b" },
          { label: "Spent This Month", value: fmt(totalMonthSpent), color: totalMonthSpent > totalMonthlyBudget ? "#ef4444" : "#8b90a0" },
          { label: "Remaining", value: fmt(Math.max(0, totalMonthlyBudget - totalMonthSpent)), color: "#4ade80" },
        ].map(s => (
          <div key={s.label} className="card">
            <div style={{ fontSize: 11, color: "#8b90a0", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {envelopes.length === 0
        ? <EmptyState icon="ti-wallet" text="No budget envelopes yet. Add one to start tracking spending categories." />
        : envelopes.map(env => {
          const spent = data.expenses.filter(e => e.date >= monthStart && e.category === env.category).reduce((s, e) => s + (parseFloat(e.amount)||0), 0);
          const allocated = parseFloat(env.amount)||0;
          const pct = allocated > 0 ? Math.min(120, (spent/allocated)*100) : 0;
          const color = pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#4ade80";
          const monthlyAvg = monthlyEquivalent(allocated, env.freq, parseInt(env.customMonths)||1);
          const nextDate = env.freq !== "monthly" ? budgetNextDate(env.startDate, env.freq, env.customMonths) : null;
          const hitsThisMonth = budgetHitsInMonth(env.startDate, env.freq, env.customMonths, monthKey);
          const isNonMonthly = env.freq !== "monthly" && env.freq !== "weekly" && env.freq !== "biweekly";

          return (
            <div key={env.id} className="card" style={{ marginBottom: 12, borderColor: pct >= 100 ? "#ef444330" : "#2e3347" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{env.name}</div>
                    {hitsThisMonth && isNonMonthly && (
                      <span className="badge" style={{ background: "#f59e0b18", color: "#f59e0b", fontSize: 10 }}>hits this month</span>
                    )}
                    <span className="badge" style={{ background: "#2e3347", color: "#8b90a0", fontSize: 10 }}>{env.category}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#8b90a0" }}>
                    {env.freq === "custom" ? `every ${env.customMonths} months` : env.freq}
                    {isNonMonthly && ` · ${fmt(monthlyAvg)}/mo avg`}
                    {nextDate && ` · next ${fmtDate(nextDate)}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginLeft: 12 }}>
                  <ActionButtons id={env.id} onEdit={() => openEdit(env)} onDelete={() => remove(env.id)} dc={dc} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div style={{ padding: "8px 12px", background: "#12141c", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "#8b90a0", marginBottom: 2 }}>Envelope</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#f59e0b" }}>{fmt(allocated)}</div>
                </div>
                <div style={{ padding: "8px 12px", background: "#12141c", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "#8b90a0", marginBottom: 2 }}>Spent</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: pct >= 100 ? "#ef4444" : "#e8eaf0" }}>{fmt(spent)}</div>
                </div>
                <div style={{ padding: "8px 12px", background: "#12141c", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "#8b90a0", marginBottom: 2 }}>{pct >= 100 ? "Over by" : "Remaining"}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color }}>
                    {pct >= 100 ? fmt(spent - allocated) : fmt(allocated - spent)}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8b90a0", marginBottom: 4 }}>
                  <span>This month</span>
                  <span style={{ color, fontWeight: 600 }}>
                    {pct >= 100 ? "OVER BUDGET" : pct >= 80 ? "NEAR LIMIT" : "ON TRACK"} · {Math.round(pct)}%
                  </span>
                </div>
                <div className="progress-bar" style={{ height: 7 }}>
                  <div className="progress-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                </div>
              </div>

              {env.notes && <div style={{ fontSize: 12, color: "#8b90a0", marginTop: 10 }}>{env.notes}</div>}
            </div>
          );
        })}

      {showModal && (
        <Modal title={`${editing ? "Edit" : "Add"} Budget Envelope`} onClose={() => setShowModal(false)}>
          <div className="form-row"><label>Envelope Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Groceries, Gas, Dining Out" /></div>
          <div className="form-grid form-row">
            <div><label>Expense Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <optgroup label="General">{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</optgroup>
                {data.debt.length > 0 && <optgroup label="Debt">{data.debt.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</optgroup>}
              </select>
            </div>
            <div><label>Amount</label><input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></div>
          </div>
          <div className="form-grid form-row">
            <div><label>Cycle</label>
              <select value={form.freq} onChange={e => setForm(f => ({ ...f, freq: e.target.value }))}>
                {FREQ_OPTIONS.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            {form.freq === "custom"
              ? <div><label>Every N months</label><input type="number" min="1" step="1" value={form.customMonths} onChange={e => setForm(f => ({ ...f, customMonths: e.target.value }))} placeholder="e.g. 5" /></div>
              : <div><label>Cycle Start Date</label><input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
            }
          </div>
          {form.freq === "custom" && (
            <div className="form-row"><label>Cycle Start Date</label><input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
          )}
          {form.freq !== "monthly" && form.amount && (
            <div style={{ padding: "10px 14px", background: "#f59e0b12", border: "1px solid #f59e0b30", borderRadius: 6, fontSize: 12, color: "#f59e0b", marginBottom: 14 }}>
              Monthly equivalent: <strong>{fmt(monthlyEquivalent(parseFloat(form.amount)||0, form.freq, parseInt(form.customMonths)||1))}</strong>/mo
            </div>
          )}
          <div className="form-row"><label>Notes (optional)</label><input value={form.notes||""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note" /></div>
          <ModalFooter onCancel={() => setShowModal(false)} onSave={save} disabled={!form.name.trim() || !form.amount || (form.freq === "custom" && !form.customMonths)} />
        </Modal>
      )}
    </div>
  );
}

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────
function PageHeader({ title, subtitle, children }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
      <div>
        <div style={{ fontSize: 11, color: "#8b90a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{subtitle}</div>
        <div style={{ fontSize: 24, fontWeight: 600, fontFamily: "'IBM Plex Sans',sans-serif" }}>{title}</div>
      </div>
      {children && <div style={{ paddingTop: 4 }}>{children}</div>}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
          <button className="btn btn-ghost" style={{ padding: "4px 8px" }} onClick={onClose}><i className="ti ti-x" aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({ onCancel, onSave, disabled, saveLabel="Save" }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
      <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      <button className="btn btn-primary" onClick={onSave} disabled={disabled}>{saveLabel}</button>
    </div>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div className="empty-state">
      <i className={`ti ${icon}`} style={{ fontSize: 32, display: "block", marginBottom: 8 }} aria-hidden="true" />
      {text}
    </div>
  );
}
