"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useGlobalPeriod } from "@/lib/PeriodContext";
import { api } from "@/lib/api";
import { useSubscribe } from "@/lib/RefreshContext";
import { PolishInner } from "@/app/polish/page";
import { DharInner } from "@/app/dhar/page";
import { MaxiInner } from "@/app/maxi/page";
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell 
} from "recharts";
import Pagination from "@/components/Pagination";
import { isManagerRole } from "@/lib/roles";

function formatWorkHours(hours) {
  const value = Number(hours || 0);
  if (!value) return "0 min";
  const totalMinutes = Math.round(value * 60);
  const hoursPart = Math.floor(totalMinutes / 60);
  const minutesPart = totalMinutes % 60;
  if (hoursPart > 0) return `${hoursPart}h ${minutesPart}m`;
  return `${minutesPart} min`;
}

function PolishDashboard({ selectedPeriodId, isManager, stats }) {
  const [data, setData] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  async function loadPolishSummary() {
    if (!selectedPeriodId) return;
    const res = await api.get(`/dashboard/employee-summary?period_id=${selectedPeriodId}`);
    const p = res.filter(e => e.polish).sort((a,b) => b.polish.total_send_weight - a.polish.total_send_weight);
    setData(p);
  }

  useEffect(() => {
    loadPolishSummary();
  }, [selectedPeriodId]);
  useSubscribe("dashboard", loadPolishSummary);
  useSubscribe("polish", loadPolishSummary);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  const filtered = data.filter(e => !searchTerm || e.name.toLowerCase().includes(searchTerm.toLowerCase()) || e.current_code?.toLowerCase().includes(searchTerm.toLowerCase()));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const paginatedData = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const highest = data.length > 0 ? data[0] : null;
  const lowest = data.length > 0 ? data[data.length - 1] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {stats && (
        <div className="card">
          <div className="card-header"><span className="card-title">Polish Production Snapshot</span></div>
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total Send WT (ct)</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.total_send_weight.toFixed(2)} <span style={{fontSize: 13, color: 'var(--text-muted)'}}>ct</span></div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total Polished Produced</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.total_polished.toFixed(2)} <span style={{fontSize: 13, color: 'var(--text-muted)'}}>ct</span></div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lots in Hand</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.polish_lots_in_hand || 0}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lots Returned</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.polish_lots_returned || 0}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--accent-primary)' }}>Polish Payable Projection</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-primary)' }}>
                ₹{(stats.total_polish_salary || 0).toLocaleString("en-IN")}
              </div>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 20 }}>
        <div className="card" style={{ flex: 1 }}>
          <div className="card-body" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--amber-800)', fontWeight: 600, textTransform: 'uppercase' }}>Highest Send WT Polisher</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--amber-900)' }}>{highest ? `(${highest.current_code}) ${highest.name}` : '-'}</div>
            <div style={{ fontSize: 14, color: 'var(--amber-800)' }}>{highest ? `${Number(highest.polish.total_send_weight).toFixed(2)} ct Send WT` : ''}</div>
            <div style={{ fontSize: 12, color: 'var(--amber-800)', marginTop: 4 }}>{highest ? `${formatWorkHours(highest.polish.total_work_hours)} worked` : ''}</div>
          </div>
        </div>
        <div className="card" style={{ flex: 1, backgroundColor: 'var(--gray-50)' }}>
          <div className="card-body" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Lowest Send WT Polisher</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{lowest ? `(${lowest.current_code}) ${lowest.name}` : '-'}</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{lowest ? `${Number(lowest.polish.total_send_weight).toFixed(2)} ct Send WT` : ''}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{lowest ? `${formatWorkHours(lowest.polish.total_work_hours)} worked` : ''}</div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card-title">Send WT Variations in Different Ranges</span>
          <input type="search" className="form-input" placeholder="Search Employee..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ width: 220 }} />
        </div>
        <div className="table-responsive">
          <table className="pro-table" style={{ fontSize: 12, minWidth: 1200, width: '100%' }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ borderRight: '1px solid var(--border-primary)' }}>Sr No</th>
                <th rowSpan={2}>Code</th>
                <th rowSpan={2}>Employee Name</th>
                <th rowSpan={2} style={{ borderRight: '1px solid var(--border-primary)' }}>Grade</th>
                <th rowSpan={2}>Issue Pcs</th>
                <th rowSpan={2}>Returned</th>
                <th rowSpan={2}>Lots In Hand</th>
                <th rowSpan={2}>Send WT</th>
                <th rowSpan={2}>Worked Hours</th>
                <th rowSpan={2} style={{ borderRight: '1px solid var(--border-primary)' }}>Total Salary</th>
                <th colSpan={6} style={{ textAlign: 'center' }}>Send WT Slab Counts</th>
              </tr>
              <tr>
                <th style={{ backgroundColor: 'var(--gray-50)', fontWeight: 500, top: 35 }}>0.00-0.49</th>
                <th style={{ backgroundColor: 'var(--gray-50)', fontWeight: 500, top: 35 }}>0.50-0.99</th>
                <th style={{ backgroundColor: 'var(--gray-50)', fontWeight: 500, top: 35 }}>1.00-2.49</th>
                <th style={{ backgroundColor: 'var(--gray-50)', fontWeight: 500, top: 35 }}>2.50-4.99</th>
                <th style={{ backgroundColor: 'var(--gray-50)', fontWeight: 500, top: 35 }}>5.00-10.0</th>
                <th style={{ backgroundColor: 'var(--gray-50)', fontWeight: 500, top: 35 }}>Above 10.0</th>
              </tr>
            </thead>
            <tbody>
              {paginatedData.map((e, i) => (
                <tr key={e.id}>
                  <td style={{ borderRight: '1px solid var(--border-primary)', color: 'var(--text-muted)' }}>{i+1}</td>
                  <td className="mono">{e.current_code}</td>
                  <td style={{ fontWeight: 500 }}>{e.name}</td>
                  <td style={{ borderRight: '1px solid var(--border-primary)' }}><span className="badge badge-gray">{e.grade}</span></td>
                  <td className="mono">{(e.polish.lots_in_hand || 0) + (e.polish.total_lots || 0)}</td>
                  <td className="mono">{e.polish.total_lots || 0}</td>
                  <td className="mono">{e.polish.lots_in_hand || 0}</td>
                  <td className="mono">{Number(e.polish.total_send_weight).toFixed(2)}ct</td>
                  <td className="mono">{formatWorkHours(e.polish.total_work_hours)}</td>
                  <td className="mono" style={{ borderRight: '1px solid var(--border-primary)' }}>₹{Number(e.polish.salary).toLocaleString('en-IN')}</td>
                  <td className="mono">{e.polish.slab_0_049 || '-'}</td>
                  <td className="mono">{e.polish.slab_05_099 || '-'}</td>
                  <td className="mono">{e.polish.slab_1_249 || '-'}</td>
                  <td className="mono">{e.polish.slab_25_499 || '-'}</td>
                  <td className="mono">{e.polish.slab_5_10 || '-'}</td>
                  <td className="mono">{e.polish.slab_10plus || '-'}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={15} className="empty-state">No polish data found for this month.</td></tr>}
            </tbody>
          </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={filtered.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
      </div>
    </div>
  );
}

function DharDashboard({ selectedPeriodId, isManager, stats }) {
  const [data, setData] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  async function loadDharSummary() {
    if (!selectedPeriodId) return;
    const res = await api.get(`/dashboard/employee-summary?period_id=${selectedPeriodId}`);
    const d = res.filter(e => e.dhar).sort((a,b) => b.dhar.total_weight - a.dhar.total_weight);
    setData(d);
  }

  useEffect(() => {
    loadDharSummary();
  }, [selectedPeriodId]);
  useSubscribe("dashboard", loadDharSummary);
  useSubscribe("dhar", loadDharSummary);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  const filtered = data.filter(e => !searchTerm || e.name.toLowerCase().includes(searchTerm.toLowerCase()) || e.current_code?.toLowerCase().includes(searchTerm.toLowerCase()));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const paginatedData = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const highest = data.length > 0 ? data[0] : null;
  const lowest = data.length > 0 ? data[data.length - 1] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {stats && (
        <div className="card">
          <div className="card-header"><span className="card-title">DHAR Production Snapshot</span></div>
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total WT Processed</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.total_dhar_weight.toFixed(2)} <span style={{fontSize: 13, color: 'var(--text-muted)'}}>ct</span></div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lots in Hand</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.dhar_lots_in_hand || 0}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lots Returned</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.dhar_lots_returned || 0}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--accent-primary)' }}>DHAR Payable Projection</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-primary)' }}>
                ₹{(stats.total_dhar_salary || 0).toLocaleString("en-IN")}
              </div>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 20 }}>
        <div className="card" style={{ flex: 1 }}>
          <div className="card-body" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--emerald-800)', fontWeight: 600, textTransform: 'uppercase' }}>Highest DHAR Worker</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--emerald-900)' }}>{highest ? `(${highest.current_code}) ${highest.name}` : '-'}</div>
            <div style={{ fontSize: 14, color: 'var(--emerald-800)' }}>{highest ? `${Number(highest.dhar.total_weight).toFixed(2)} ct` : ''}</div>
            <div style={{ fontSize: 12, color: 'var(--emerald-800)', marginTop: 4 }}>{highest ? `${formatWorkHours(highest.dhar.total_work_hours)} worked` : ''}</div>
          </div>
        </div>
        <div className="card" style={{ flex: 1, backgroundColor: 'var(--gray-50)' }}>
          <div className="card-body" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Lowest DHAR Worker</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{lowest ? `(${lowest.current_code}) ${lowest.name}` : '-'}</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{lowest ? `${Number(lowest.dhar.total_weight).toFixed(2)} ct` : ''}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{lowest ? `${formatWorkHours(lowest.dhar.total_work_hours)} worked` : ''}</div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card-title">DHAR Production Report</span>
          <input type="search" className="form-input" placeholder="Search Employee..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ width: 220 }} />
        </div>
        <div className="table-responsive">
          <table className="pro-table" style={{ fontSize: 12, minWidth: 600, width: '100%' }}>
            <thead>
              <tr>
                <th>Sr No</th>
                <th>Code</th>
                <th>Employee Name</th>
                <th>Issue Pcs</th>
                <th>Returned</th>
                <th>Lots In Hand</th>
                <th>Total WT</th>
                <th>Worked Hours</th>
                <th>Total Salary</th>
                <th>Round Lots</th>
                <th>Fancy Lots</th>
              </tr>
            </thead>
            <tbody>
              {paginatedData.map((e, i) => (
                <tr key={e.id}>
                  <td style={{ color: 'var(--text-muted)' }}>{i+1}</td>
                  <td className="mono">{e.current_code}</td>
                  <td style={{ fontWeight: 500 }}>{e.name}</td>
                  <td className="mono">{(e.dhar.lots_in_hand || 0) + (e.dhar.total_entries || 0)}</td>
                  <td className="mono">{e.dhar.total_entries || 0}</td>
                  <td className="mono">{e.dhar.lots_in_hand || 0}</td>
                  <td className="mono">{Number(e.dhar.total_weight).toFixed(2)}ct</td>
                  <td className="mono">{formatWorkHours(e.dhar.total_work_hours)}</td>
                  <td className="mono">₹{Number(e.dhar.salary).toLocaleString('en-IN')}</td>
                  <td className="mono">{e.dhar.shapes['ROUND'] || '-'}</td>
                  <td className="mono">{e.dhar.shapes['FANCY'] || '-'}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={11} className="empty-state">No DHAR data found for this month.</td></tr>}
            </tbody>
          </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={filtered.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, permissions, permissionsLoading, hasPermission } = useAuth();
  const { activePeriodId: selectedPeriodId, periods } = useGlobalPeriod();
  const [employees, setEmployees] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("OVERVIEW");

  const router = useRouter();

  async function loadEmployees() {
    if (!user || user.role === "EMPLOYEE") return;
    if (permissionsLoading || !hasPermission("manage_employees")) {
      setEmployees([]);
      setLoading(false);
      return;
    }
    try {
      const emps = await api.get("/employees");
      setEmployees(emps);
    } catch (err) {
      console.error("Failed to load employees:", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadPeriodStats() {
    if (!user || !selectedPeriodId) return;
    if (permissionsLoading) return;
    if (!hasPermission("view_dashboard")) {
      setStatuses([]);
      setStats(null);
      return;
    }
    try {
      const [st, dashboardStats] = await Promise.all([
        hasPermission("manage_verification") ? api.get(`/verification?period_id=${selectedPeriodId}`) : Promise.resolve([]),
        api.get(`/dashboard/stats?period_id=${selectedPeriodId}`)
      ]);
      setStatuses(st);
      setStats(dashboardStats);
    } catch (err) {
      console.error("Failed to load period stats:", err);
    }
  }

  useEffect(() => {
    if (user?.role === "EMPLOYEE") router.replace("/portal");
  }, [user, router]);

  useEffect(() => {
    loadEmployees();
  }, [user, permissionsLoading, permissions]);

  useEffect(() => {
    loadPeriodStats();
  }, [selectedPeriodId, permissionsLoading, permissions]);
  useSubscribe("dashboard", loadPeriodStats);
  useSubscribe("employees", loadEmployees);

  if (!user || user.role === "EMPLOYEE") return null;
  if (permissionsLoading) return <div className="loading-state">Loading dashboard...</div>;
  if (!hasPermission("view_dashboard")) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Access restricted</div>
        This section isn&apos;t available for your role.
      </div>
    );
  }
  if (loading) return <div className="loading-state">Loading dashboard...</div>;

  const totalEmps = statuses.length;
  const calculated = statuses.filter((s) => s.status === "CALCULATED").length;
  const managerVerified = statuses.filter((s) => s.status === "MANAGER_VERIFIED").length;
  const finalPayable = statuses.filter((s) => s.status === "ACCOUNTS_VERIFIED").length;
  const pendingCalc = totalEmps - (calculated + managerVerified + finalPayable);

  // Calculate percentages for the progress bar
  const pctCalc = totalEmps ? (calculated / totalEmps) * 100 : 0;
  const pctMgr = totalEmps ? (managerVerified / totalEmps) * 100 : 0;
  const pctAcc = totalEmps ? (finalPayable / totalEmps) * 100 : 0;
  
  const isManager = isManagerRole(user.role);
  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);

  return (
    <div>
      <div className="tab-nav">
        <div className={`tab-item ${activeTab === "OVERVIEW" ? "active" : ""}`} onClick={() => setActiveTab("OVERVIEW")}>Overview</div>
        <div className={`tab-item ${activeTab === "POLISH_DASH" ? "active" : ""}`} onClick={() => setActiveTab("POLISH_DASH")}>Polish Dashboard</div>
        <div className={`tab-item ${activeTab === "DHAR_DASH" ? "active" : ""}`} onClick={() => setActiveTab("DHAR_DASH")}>DHAR Dashboard</div>
      </div>

      {!selectedPeriod && (user.role === "ACCOUNTANT" || user.role === "SUPER_ADMIN") && (
        <div className="alert alert-warning" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>No periods found in the system.</span>
          <button className="btn btn-primary btn-sm" onClick={() => router.push("/periods")}>Open a Period</button>
        </div>
      )}
      {!selectedPeriod && isManagerRole(user.role) && (
        <div className="alert alert-warning">No period is open yet — ask Accountant or Super Admin to open one.</div>
      )}

      {selectedPeriod && activeTab === "OVERVIEW" && stats && (
        <div className="tab-pane">
          {/* Financial & Production Snapshot */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><span className="card-title">Consolidated Business Overview</span></div>
            <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Polish Production</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.total_polished.toFixed(2)} <span style={{fontSize: 14, color: 'var(--text-muted)'}}>ct</span></div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>from {stats.total_send_weight.toFixed(2)} ct send WT ({(stats.total_send_weight > 0 ? (stats.total_polished / stats.total_send_weight * 100).toFixed(1) : 0)}% yield)</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>DHAR Production</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.total_dhar_weight.toFixed(2)} <span style={{fontSize: 14, color: 'var(--text-muted)'}}>ct</span></div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>total WT processed</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: 'var(--accent-primary)' }}>Combined Payroll Projection</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-primary)' }}>
                  ₹{stats.total_salary.toLocaleString("en-IN")}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Polish: ₹{(stats.total_polish_salary || 0).toLocaleString("en-IN")} | DHAR: ₹{(stats.total_dhar_salary || 0).toLocaleString("en-IN")}</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
            
            {/* Left Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* Verification Progress */}
              <div className="card">
                <div className="card-header"><span className="card-title">Verification Progress</span></div>
                <div className="card-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, fontWeight: 500 }}>
                    <span>{finalPayable} Finalized</span>
                    <span>{totalEmps} Total</span>
                  </div>
                  <div style={{ width: '100%', height: 24, backgroundColor: 'var(--gray-200)', borderRadius: 12, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${pctAcc}%`, backgroundColor: 'var(--green-600)', transition: 'width 0.5s' }} title="Accountant Verified" />
                    <div style={{ width: `${pctMgr}%`, backgroundColor: 'var(--amber-600)', transition: 'width 0.5s' }} title="Manager Verified" />
                    <div style={{ width: `${pctCalc}%`, backgroundColor: 'var(--violet-600)', transition: 'width 0.5s' }} title="Calculated (Pending Manager)" />
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--green-600)'}}></span> Accountant Verified</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--amber-600)'}}></span> Manager Verified</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--violet-600)'}}></span> Pending Manager</div>
                  </div>
                </div>
              </div>

              {/* Historical Trends */}
              <div className="card">
                <div className="card-header"><span className="card-title">Recent Historical Trends</span></div>
                <div className="card-body" style={{ padding: '20px 20px 0 0', height: 380 }}>
                  {stats.trends.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stats.trends} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorPolished" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--navy-500)" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="var(--navy-500)" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorSalary" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--green-600)" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="var(--green-600)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-primary)" />
                        <XAxis dataKey="period_name" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: 'var(--text-muted)'}} dy={10} />
                        <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: 'var(--text-muted)'}} />
                        <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: 'var(--text-muted)'}} tickFormatter={(val) => `₹${(val/1000).toFixed(0)}k`} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: 'var(--surface)', color: 'var(--text-primary)', borderRadius: 8, border: '1px solid var(--border-primary)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
                          itemStyle={{ color: 'var(--text-secondary)' }}
                          labelStyle={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}
                          formatter={(value, name) => [name === 'Total Payable (₹)' ? `₹${value.toLocaleString()}` : `${value.toFixed(2)} ct`, name]}
                        />
                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: 13, fontWeight: 500 }} />
                        <Area yAxisId="left" type="monotone" dataKey="total_polished" name="Polished Produced (ct)" stroke="var(--navy-500)" strokeWidth={2} fillOpacity={1} fill="url(#colorPolished)" />
                        <Area yAxisId="right" type="monotone" dataKey="total_salary" name="Total Payable (₹)" stroke="var(--green-600)" strokeWidth={2} fillOpacity={1} fill="url(#colorSalary)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="empty-state" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No historical data available.</div>
                  )}
                </div>
              </div>

            </div>

            {/* Right Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* Action Alerts */}
              <div className="card" style={{ borderColor: (stats.alerts.draft_polish > 0 || stats.alerts.missing_rates > 0) ? 'var(--amber-300)' : 'var(--border-primary)' }}>
                <div className="card-header" style={{ borderBottomColor: (stats.alerts.draft_polish > 0 || stats.alerts.missing_rates > 0) ? 'var(--amber-200)' : 'var(--border-primary)', backgroundColor: (stats.alerts.draft_polish > 0 || stats.alerts.missing_rates > 0) ? 'var(--amber-50)' : 'transparent' }}>
                  <span className="card-title" style={{ color: (stats.alerts.draft_polish > 0 || stats.alerts.missing_rates > 0) ? 'var(--amber-800)' : 'inherit' }}>Attention Required</span>
                </div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {stats.alerts.draft_polish > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13 }}>{stats.alerts.draft_polish} Polish lots in Draft</span>
                      <button className="btn btn-secondary btn-sm" onClick={() => router.push("/polish")}>Review</button>
                    </div>
                  ) : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No draft polish entries.</div>}

                  {stats.alerts.missing_rates > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: 'var(--red-600)' }}>{stats.alerts.missing_rates} entries missing rates</span>
                      <button className="btn btn-secondary btn-sm" onClick={() => router.push("/rates")}>Fix Rates</button>
                    </div>
                  ) : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>All rates are configured.</div>}
                </div>
              </div>

              {/* Top Performers */}
              <div className="card" style={{ flexGrow: 1 }}>
                <div className="card-header"><span className="card-title">Top Performers (Send WT)</span></div>
                <div className="card-body" style={{ padding: '20px 20px 10px 0', height: 380 }}>
                  {stats.top_performers.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={stats.top_performers} margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="var(--border-primary)" />
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize: 11, fill: 'var(--text-secondary)'}} width={90} />
                        <Tooltip 
                          cursor={{fill: 'var(--gray-100)'}}
                          contentStyle={{ backgroundColor: 'var(--surface)', color: 'var(--text-primary)', borderRadius: 8, border: '1px solid var(--border-primary)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
                          itemStyle={{ color: 'var(--text-secondary)' }}
                          labelStyle={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}
                          formatter={(value, name) => [`${value.toFixed(2)} ct`, name]}
                        />
                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: 13, fontWeight: 500 }} />
                        <Bar dataKey="total_send_weight" name="Send WT Issued (ct)" radius={[0, 4, 4, 0]} barSize={20}>
                          {stats.top_performers.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={index === 0 ? 'var(--amber-600)' : 'var(--navy-400)'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="empty-state" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No production data yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedPeriod && activeTab === "POLISH_DASH" && (
        <div className="tab-pane">
          <PolishDashboard selectedPeriodId={selectedPeriodId} isManager={isManager} stats={stats} />
        </div>
      )}

      {selectedPeriod && activeTab === "DHAR_DASH" && (
        <div className="tab-pane">
          <DharDashboard selectedPeriodId={selectedPeriodId} isManager={isManager} stats={stats} />
        </div>
      )}

    </div>
  );
}
