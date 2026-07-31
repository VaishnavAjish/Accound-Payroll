"use client";
import { useEffect, useState } from "react";
import { useFeedback } from "@/lib/Feedback";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { useGlobalPeriod } from "@/lib/PeriodContext";
import { useRefresh, useSubscribe } from "@/lib/RefreshContext";
import { exportToExcel } from "@/lib/exportHelper";
import { MANAGER_ROLES, isManagerRole } from "@/lib/roles";
import RoleGate from "@/components/RoleGate";
import Pagination from "@/components/Pagination";
import EmployeePicker from "@/components/EmployeePicker";
import EmployeeEntryTabs from "@/components/EmployeeEntryTabs";

const EMPTY = { employee_id: "", issue_date: "", lot_id: "", lot_name: "", weight: "" };

export function MaxiInner({ overridePeriodId }) {
  const { user } = useAuth();
  const isManager = isManagerRole(user?.role);
  const { activePeriodId, isActivePeriodClosed } = useGlobalPeriod();
  const { showToast, confirmAction } = useFeedback();
  const { broadcast } = useRefresh();
  const [employees, setEmployees] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [filterEmpId, setFilterEmpId] = useState("");
  const [openEmployeeIds, setOpenEmployeeIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterEmpId) qs.append("employee_id", filterEmpId);
      if (overridePeriodId || activePeriodId) qs.append("period_id", overridePeriodId || activePeriodId);
      
      const [emps, list] = await Promise.all([
        api.get("/employees"),
        api.get(`/maxi${qs.toString() ? `?${qs.toString()}` : ""}`),
      ]);
      setEmployees(emps.filter(e => !e.current_code || !e.current_code.toUpperCase().startsWith('DHAR')));
      setEntries(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const handleExport = () => {
    const dataToExport = filteredEntries.map(e => {
      const emp = employees.find(x => x.id === e.employee_id);
      return {
        "Employee Code": emp?.current_code || "",
        "Employee Name": emp?.name || "",
        "Issue Date": e.issue_date || "",
        "Lot ID": e.lot_id || "",
        "Lot Name": e.lot_name || "",
        "WT (ct)": e.weight ?? ""
      };
    });
    exportToExcel(dataToExport, "MAXI_Entries.xlsx", "MAXI Work");
  };

  useEffect(() => { load(); }, [filterEmpId, activePeriodId, overridePeriodId]);
  useSubscribe("maxi", load);
  useSubscribe("employees", load);

  function broadcastMaxiChange() {
    ["maxi", "dashboard", "notifications"].forEach(broadcast);
  }

  async function submit(e) {
    e.preventDefault();
    setFormError("");
    try {
      await api.post("/maxi", form);
      setShowModal(false);
      setForm(EMPTY);
      load();
      broadcastMaxiChange();
    } catch (err) {
      setFormError(err.message);
    }
  }

  async function remove(entry) {
    if (!(await confirmAction("Delete this MAXI entry?", { danger: true, confirmLabel: "Delete" }))) return;
    try {
      await api.del(`/maxi/${entry.id}`);
      load();
      broadcastMaxiChange();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));

  const filteredEntries = entries.filter(entry => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const emp = empMap[entry.employee_id] || {};
    return (
      (entry.lot_id && entry.lot_id.toLowerCase().includes(term)) ||
      (entry.lot_name && entry.lot_name.toLowerCase().includes(term)) ||
      (emp.name && emp.name.toLowerCase().includes(term)) ||
      (emp.current_code && emp.current_code.toLowerCase().includes(term))
    );
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterEmpId]);

  const paginatedEntries = filteredEntries.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div>
      {!overridePeriodId && (
        <div className="page-header">
          <div className="page-header-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input 
              type="search" 
              className="form-input" 
              placeholder="Search Lot or Employee..." 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)} 
              style={{ width: 200 }} 
            />
            <EmployeeEntryTabs employees={employees} activeEmployeeId={filterEmpId} onActiveEmployeeChange={setFilterEmpId} openEmployeeIds={openEmployeeIds} onOpenEmployeeIdsChange={setOpenEmployeeIds} variant="picker" />
            <button className="btn btn-secondary" onClick={handleExport}>Export</button>
            <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setFormError(""); setShowModal(true); }} disabled={isActivePeriodClosed}>+ New Entry</button>
          </div>
        </div>
      )}

      {overridePeriodId && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 16 }}>
          <input 
            type="search" 
            className="form-input" 
            placeholder="Search Lot or Employee..." 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
            style={{ width: 220 }} 
          />
          <EmployeeEntryTabs employees={employees} activeEmployeeId={filterEmpId} onActiveEmployeeChange={setFilterEmpId} openEmployeeIds={openEmployeeIds} onOpenEmployeeIdsChange={setOpenEmployeeIds} variant="picker" />
          <button className="btn btn-secondary" onClick={handleExport}>Export</button>
          <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setFormError(""); setShowModal(true); }} disabled={isActivePeriodClosed}>+ New Entry</button>
        </div>
      )}

      <EmployeeEntryTabs employees={employees} activeEmployeeId={filterEmpId} onActiveEmployeeChange={setFilterEmpId} openEmployeeIds={openEmployeeIds} onOpenEmployeeIdsChange={setOpenEmployeeIds} variant="tabs" />

      {isActivePeriodClosed && (
        <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 500 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          This period is closed. Data cannot be edited.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading entries...</div>
      ) : (
        <div className="card">
          <div className="card-body table-responsive">
            <table className="pro-table">
              <thead><tr><th>Employee</th><th>Issue Date</th><th>Lot ID</th><th>Lot Name</th><th>WT</th><th></th></tr></thead>
              <tbody>
                {paginatedEntries.map((e) => (
                  <tr key={e.id}>
                    <td>{empMap[e.employee_id]?.name || e.employee_id}</td>
                    <td className="mono">{e.issue_date}</td>
                    <td>{e.lot_id || "-"}</td>
                    <td>{e.lot_name || "-"}</td>
                    <td className="mono">{e.weight}</td>
                    <td><button className="btn btn-danger btn-sm" onClick={() => remove(e)} disabled={isActivePeriodClosed}>Delete</button></td>
                  </tr>
                ))}
              {filteredEntries.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">No MAXI entries matching your search.</td>
                </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={filteredEntries.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">New MAXI Entry</span><button className="btn btn-secondary btn-sm" onClick={() => setShowModal(false)}>✕</button></div>
            <form onSubmit={submit}>
              <div className="modal-body">
                {formError && <div className="alert alert-error">{formError}</div>}
                <div className="form-group">
                  <label className="form-label">Employee</label>
                  <EmployeePicker employees={employees} value={form.employee_id} onChange={(employeeId) => setForm({ ...form, employee_id: employeeId })} required />
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Issue Date</label><input type="date" className="form-input" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Lot ID</label><input className="form-input" value={form.lot_id} onChange={(e) => setForm({ ...form, lot_id: e.target.value })} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Lot Name</label><input className="form-input" value={form.lot_name} onChange={(e) => setForm({ ...form, lot_name: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">WT (ct)</label><input type="number" step="0.01" className="form-input" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} required /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MaxiPage() {
  return <RoleGate roles={["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES]} permission="manage_maxi"><MaxiInner /></RoleGate>;
}
