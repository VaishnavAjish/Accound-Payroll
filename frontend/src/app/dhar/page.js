"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useFeedback } from "@/lib/Feedback";
import { api } from "@/lib/api";
import { useGlobalPeriod } from "@/lib/PeriodContext";
import { useRefresh, useSubscribe } from "@/lib/RefreshContext";
import { MANAGER_ROLES, isManagerRole } from "@/lib/roles";
import { exportToExcel } from "@/lib/exportHelper";
import { DropdownMenu, DropdownItem } from "@/components/Dropdown";
import RoleGate from "@/components/RoleGate";
import Pagination from "@/components/Pagination";
import EmployeePicker from "@/components/EmployeePicker";
import EmployeeEntryTabs from "@/components/EmployeeEntryTabs";

const EMPTY = { employee_id: "", issue_date: "", lot_id: "", lot_name: "", weight: "", shape_classification: "ALL_SHAPE" };
const EMPTY_BULK_ROW = { issue_date: "", lot_id: "", lot_name: "", weight: "", shape_classification: "ALL_SHAPE" };
const EMPTY_RETURN = { received_date: "", remarks: "" };
const STATUS_BADGE = { LOT_IN_HAND: "badge-amber", COMPLETED: "badge-emerald" };

export function DharInner({ overridePeriodId }) {
  const { user } = useAuth();
  const { activePeriodId, isActivePeriodClosed } = useGlobalPeriod();
  const { showToast, confirmAction } = useFeedback();
  const { broadcast } = useRefresh();
  const isManager = isManagerRole(user?.role);
  const [employees, setEmployees] = useState([]);
  const [entries, setEntries] = useState([]);
  const [filterEmpId, setFilterEmpId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkEmployeeId, setBulkEmployeeId] = useState("");
  const [bulkRows, setBulkRows] = useState([{ ...EMPTY_BULK_ROW }]);
  const [bulkError, setBulkError] = useState("");

  const [returnTarget, setReturnTarget] = useState(null);
  const [returnForm, setReturnForm] = useState(EMPTY_RETURN);
  const [returnError, setReturnError] = useState("");

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY);
  const [editError, setEditError] = useState("");

  const [reassignTarget, setReassignTarget] = useState(null);
  const [reassignForm, setReassignForm] = useState({ employee_id: "" });
  const [reassignError, setReassignError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterEmpId) qs.append("employee_id", filterEmpId);
      if (activePeriodId) qs.append("period_id", activePeriodId);
      
      const [emps, list] = await Promise.all([
        api.get("/employees"),
        api.get(`/dhar${qs.toString() ? `?${qs.toString()}` : ""}`),
      ]);
      setEmployees(emps.filter(e => !e.current_code || e.current_code.toUpperCase().startsWith('DHAR')));
      setEntries(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const isFiltered = !!filterEmpId;
  let dharWeight = 0, dharSalary = 0;
  if (isFiltered) {
    entries.forEach(d => {
      dharWeight += Number(d.weight || 0);
      if (d.calculated_salary && d.calculated_salary !== "HIDDEN") dharSalary += Number(d.calculated_salary);
    });
  }

  const handleExport = () => {
    const dataToExport = filteredEntries.map(e => {
      const emp = employees.find(x => x.id === e.employee_id);
      const row = {
        "Employee Code": emp?.current_code || "",
        "Employee Name": emp?.name || "",
        "Status": e.status === "COMPLETED" ? "RETURNED" : (e.status || "").replace(/_/g, " "),
        "Lot ID": e.lot_id || "",
        "Issue Date": e.issue_date || "",
        "WT (ct)": e.weight ?? "",
        "Classification": e.shape_classification?.replace(/_/g, " ") || "",
        "Slab": e.weight_slab === "GTE_2" ? "≥ 2.00" : "< 2.00",
        "Received Date": e.received_date || "",
        "Remarks": e.remarks || ""
      };
      if (!isManager) {
        row["Rate"] = e.rate_snapshot ?? "";
        row["Salary"] = e.calculated_salary === "HIDDEN" ? "HIDDEN" : (e.calculated_salary ?? "");
      }
      return row;
    });
    exportToExcel(dataToExport, "DHAR_Entries.xlsx", "DHAR Work");
  };

  useEffect(() => { load(); }, [filterEmpId, activePeriodId]);
  useSubscribe("dhar", load);
  useSubscribe("employees", load);

  function broadcastDharChange() {
    ["dhar", "verification", "dashboard", "notifications"].forEach(broadcast);
  }

  function openBulkIssue() {
    setBulkEmployeeId(filterEmpId || "");
    setBulkRows([{ ...EMPTY_BULK_ROW }]);
    setBulkError("");
    setShowBulkModal(true);
  }

  function updateBulkRow(index, field, value) {
    setBulkRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  function addBulkRow() {
    setBulkRows((rows) => [...rows, { ...EMPTY_BULK_ROW }]);
  }

  function removeBulkRow(index) {
    setBulkRows((rows) => rows.length === 1 ? rows : rows.filter((_, rowIndex) => rowIndex !== index));
  }

  async function submitBulk(e) {
    e.preventDefault();
    setBulkError("");
    try {
      await api.post("/dhar/bulk", { employee_id: bulkEmployeeId, entries: bulkRows });
      setShowBulkModal(false);
      setBulkEmployeeId("");
      setBulkRows([{ ...EMPTY_BULK_ROW }]);
      load();
      broadcastDharChange();
      showToast(`${bulkRows.length} DHAR lots issued successfully.`, "success");
    } catch (err) {
      setBulkError(err.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setFormError("");
    try {
      await api.post("/dhar", form);
      setShowModal(false);
      setForm(EMPTY);
      load();
      broadcastDharChange();
    } catch (err) {
      setFormError(err.message);
    }
  }

  function openEdit(entry) {
    setEditTarget(entry);
    setEditForm({
      employee_id: entry.employee_id,
      issue_date: entry.issue_date,
      lot_id: entry.lot_id,
      lot_name: entry.lot_name,
      weight: entry.weight,
      shape_classification: entry.shape_classification
    });
    setEditError("");
  }

  async function submitEdit(e) {
    e.preventDefault();
    setEditError("");
    try {
      await api.patch(`/dhar/${editTarget.id}`, editForm);
      setEditTarget(null);
      load();
      broadcastDharChange();
    } catch (err) {
      setEditError(err.message);
    }
  }

  function openReassign(entry) {
    setReassignTarget(entry);
    setReassignForm({ employee_id: "" });
    setReassignError("");
  }

  async function submitReassign(e) {
    e.preventDefault();
    setReassignError("");
    try {
      await api.patch(`/dhar/${reassignTarget.id}`, reassignForm);
      setReassignTarget(null);
      load();
      broadcastDharChange();
    } catch (err) {
      setReassignError(err.message);
    }
  }

  function openReturn(entry) {
    setReturnTarget(entry);
    setReturnForm({ ...EMPTY_RETURN });
    setReturnError("");
  }

  async function submitReturn(e) {
    e.preventDefault();
    setReturnError("");
    try {
      await api.patch(`/dhar/${returnTarget.id}/return`, returnForm);
      setReturnTarget(null);
      load();
      broadcastDharChange();
    } catch (err) {
      setReturnError(err.message);
    }
  }

  async function revertEntry(entry) {
    if (!(await confirmAction("Revert this returned entry back to Lot in Hand?", { danger: true, confirmLabel: "Revert" }))) return;
    try {
      await api.patch(`/dhar/${entry.id}/revert-to-lot-in-hand`);
      load();
      broadcastDharChange();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function remove(entry) {
    if (!(await confirmAction("Delete this DHAR entry?", { danger: true, confirmLabel: "Delete" }))) return;
    try {
      await api.del(`/dhar/${entry.id}`);
      load();
      broadcastDharChange();
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
              placeholder="Search Worker..." 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)} 
              style={{ width: 200 }} 
            />
            <EmployeeEntryTabs employees={employees} activeEmployeeId={filterEmpId} onActiveEmployeeChange={setFilterEmpId} variant="picker" />
            <button className="btn btn-secondary" onClick={handleExport}>Export</button>
            <button className="btn btn-secondary" onClick={openBulkIssue} disabled={isActivePeriodClosed}>Bulk Entry</button>
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
          <EmployeeEntryTabs employees={employees} activeEmployeeId={filterEmpId} onActiveEmployeeChange={setFilterEmpId} variant="picker" />
          <button className="btn btn-secondary" onClick={handleExport}>Export</button>
          <button className="btn btn-secondary" onClick={openBulkIssue} disabled={isActivePeriodClosed}>Bulk Entry</button>
          <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setFormError(""); setShowModal(true); }} disabled={isActivePeriodClosed}>+ New Entry</button>
        </div>
      )}

      <EmployeeEntryTabs employees={employees} activeEmployeeId={filterEmpId} onActiveEmployeeChange={setFilterEmpId} variant="tabs" />

      {isActivePeriodClosed && (
        <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 500 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          This period is closed. Data cannot be edited.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {isFiltered && !loading && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Total WT</div>
            <div className="kpi-value mono">{dharWeight.toFixed(2)} <span style={{fontSize:"0.65em", color:"var(--text-muted)", fontWeight:"500"}}>ct</span></div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Avg WT / Lot</div>
            <div className="kpi-value mono">{entries.length ? (dharWeight / entries.length).toFixed(2) : "0.00"} <span style={{fontSize:"0.65em", color:"var(--text-muted)", fontWeight:"500"}}>ct</span></div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Lots in Hand</div>
            <div className="kpi-value mono">{entries.filter(e => e.status === "LOT_IN_HAND").length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Lots Returned</div>
            <div className="kpi-value mono">{entries.filter(e => e.status === "COMPLETED").length}</div>
          </div>
          <div className="kpi-card" style={{ border: "1px solid var(--accent-primary)", background: "var(--accent-primary-light)" }}>
            <div className="kpi-label" style={{ color: "var(--accent-primary)" }}>Total Payable</div>
            <div className="kpi-value mono" style={{ color: "var(--accent-primary)" }}>₹{dharSalary.toLocaleString("en-IN")}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-state">Loading entries...</div>
      ) : (
        <div className="card">
          <div className="card-body table-responsive">
            <table className="pro-table">
              <thead>
                <tr><th>Employee</th><th>Status</th><th>Lot ID</th><th>Issue Date</th><th>WT</th><th>Classification</th><th>Slab</th><th>Received Date</th><th>Remarks</th><th>Salary</th><th></th></tr>
              </thead>
              <tbody>
                {paginatedEntries.map((e) => (
                  <tr key={e.id}>
                    <td>{empMap[e.employee_id]?.name || e.employee_id}</td>
                    <td><span className={`badge ${STATUS_BADGE[e.status]}`}>{e.status === 'COMPLETED' ? 'RETURNED' : (e.status || "").replace(/_/g, " ")}</span></td>
                    <td>{e.lot_id || "-"}</td>
                    <td className="mono">{e.issue_date}</td>
                    <td className="mono">{e.weight}</td>
                    <td><span className="badge badge-violet">{e.shape_classification.replace("_", " ")}</span></td>
                    <td><span className={`badge ${e.weight_slab === "GTE_2" ? "badge-emerald" : "badge-amber"}`}>{e.weight_slab === "GTE_2" ? "≥ 2.00" : "< 2.00"}</span></td>
                    <td className="mono">{e.received_date || "-"}</td>
                    <td>{e.remarks || "-"}</td>
                    <td className="mono">{e.rate_missing ? <span className="badge badge-rose">Rate Missing</span> : (e.calculated_salary != null ? `₹${Number(e.calculated_salary).toLocaleString("en-IN")}` : "-")}</td>
                    <td style={{ whiteSpace: "nowrap", textAlign: 'right' }}>
                      <DropdownMenu>
                        <DropdownItem onClick={() => openEdit(e)} disabled={isActivePeriodClosed}>Edit</DropdownItem>
                        {e.status === "LOT_IN_HAND" && <DropdownItem onClick={() => openReturn(e)} disabled={isActivePeriodClosed}>Return</DropdownItem>}
                        {e.status === "COMPLETED" && !isActivePeriodClosed && <DropdownItem onClick={() => revertEntry(e)}>Revert</DropdownItem>}
                        <DropdownItem onClick={() => openReassign(e)} disabled={isActivePeriodClosed}>Reassign</DropdownItem>
                        <DropdownItem onClick={() => remove(e)} danger disabled={isActivePeriodClosed}>Delete</DropdownItem>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {filteredEntries.length === 0 && (
                  <tr>
                    <td colSpan={isManager ? 8 : 9} className="empty-state">No DHAR entries matching your search.</td>
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
            <div className="modal-header"><span className="modal-title">Issue DHAR</span><button className="btn btn-secondary btn-sm" onClick={() => setShowModal(false)}>✕</button></div>
            <form onSubmit={submit}>
              <div className="modal-body">
                {formError && <div className="alert alert-error">{formError}</div>}
                <div className="form-group">
                  <label className="form-label">Employee</label>
                  <EmployeePicker employees={employees} value={form.employee_id} onChange={(employeeId) => setForm({ ...form, employee_id: employeeId })} required />
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Issue Date</label><input type="date" className="form-input" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Lot ID</label><input className="form-input" value={form.lot_id} onChange={(e) => setForm({ ...form, lot_id: e.target.value })} required /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Lot Name</label><input className="form-input" value={form.lot_name} onChange={(e) => setForm({ ...form, lot_name: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">WT (ct)</label><input type="number" step="0.01" className="form-input" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} required /></div>
                </div>
                <div className="form-group">
                  <label className="form-label">Shape Classification</label>
                  <select className="form-select" value={form.shape_classification} onChange={(e) => setForm({ ...form, shape_classification: e.target.value })}>
                    <option value="ALL_SHAPE">All Shape</option>
                    <option value="ROUND">Round</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Issue</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBulkModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowBulkModal(false)}>
          <div className="modal" style={{ maxWidth: 980 }}>
            <div className="modal-header"><span className="modal-title">Bulk DHAR Entry</span><button className="btn btn-secondary btn-sm" onClick={() => setShowBulkModal(false)}>✕</button></div>
            <form onSubmit={submitBulk}>
              <div className="modal-body">
                {bulkError && <div className="alert alert-error">{bulkError}</div>}
                <div className="form-group">
                  <label className="form-label">Employee</label>
                  <EmployeePicker employees={employees} value={bulkEmployeeId} onChange={setBulkEmployeeId} required />
                </div>
                <div className="table-responsive" style={{ maxHeight: 360 }}>
                  <table className="pro-table">
                    <thead>
                      <tr>
                        <th>#</th><th>Issue Date</th><th>Lot ID</th><th>Lot Name</th><th>WT</th><th>Classification</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((row, index) => (
                        <tr key={index}>
                          <td className="mono">{index + 1}</td>
                          <td><input type="date" className="form-input" value={row.issue_date} onChange={(e) => updateBulkRow(index, "issue_date", e.target.value)} required /></td>
                          <td><input className="form-input" value={row.lot_id} onChange={(e) => updateBulkRow(index, "lot_id", e.target.value)} required /></td>
                          <td><input className="form-input" value={row.lot_name} onChange={(e) => updateBulkRow(index, "lot_name", e.target.value)} required /></td>
                          <td><input type="number" step="0.01" className="form-input" value={row.weight} onChange={(e) => updateBulkRow(index, "weight", e.target.value)} required style={{ width: 110 }} /></td>
                          <td>
                            <select className="form-select" value={row.shape_classification} onChange={(e) => updateBulkRow(index, "shape_classification", e.target.value)} style={{ minWidth: 150 }}>
                              <option value="ALL_SHAPE">All Shape</option>
                              <option value="ROUND">Round</option>
                            </select>
                          </td>
                          <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => removeBulkRow(index)} disabled={bulkRows.length === 1}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addBulkRow} style={{ marginTop: 12 }}>+ Add Row</button>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowBulkModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Issue {bulkRows.length} Lots</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setEditTarget(null)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">Edit DHAR Entry</span><button className="btn btn-secondary btn-sm" onClick={() => setEditTarget(null)}>✕</button></div>
            <form onSubmit={submitEdit}>
              <div className="modal-body">
                {editError && <div className="alert alert-error">{editError}</div>}
                <div className="form-group">
                  <label className="form-label">Employee</label>
                  <EmployeePicker employees={employees} value={editForm.employee_id} onChange={(employeeId) => setEditForm({ ...editForm, employee_id: employeeId })} required />
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Issue Date</label><input type="date" className="form-input" value={editForm.issue_date} onChange={(e) => setEditForm({ ...editForm, issue_date: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Lot ID</label><input className="form-input" value={editForm.lot_id} onChange={(e) => setEditForm({ ...editForm, lot_id: e.target.value })} required /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Lot Name</label><input className="form-input" value={editForm.lot_name} onChange={(e) => setEditForm({ ...editForm, lot_name: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">WT (ct)</label><input type="number" step="0.01" className="form-input" value={editForm.weight} onChange={(e) => setEditForm({ ...editForm, weight: e.target.value })} required /></div>
                </div>
                <div className="form-group">
                  <label className="form-label">Shape Classification</label>
                  <select className="form-select" value={editForm.shape_classification} onChange={(e) => setEditForm({ ...editForm, shape_classification: e.target.value })}>
                    <option value="ALL_SHAPE">All Shape</option>
                    <option value="ROUND">Round</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reassign Modal */}
      {reassignTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setReassignTarget(null)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">Reassign DHAR Entry</span><button className="btn btn-secondary btn-sm" onClick={() => setReassignTarget(null)}>✕</button></div>
            <form onSubmit={submitReassign}>
              <div className="modal-body">
                <p style={{ marginBottom: "1rem", color: "var(--color-text-light)" }}>Reassigning Lot <strong>{reassignTarget.lot_id}</strong> from <strong>{empMap[reassignTarget.employee_id]?.name}</strong>.</p>
                {reassignError && <div className="alert alert-error">{reassignError}</div>}
                <div className="form-group">
                  <label className="form-label">New Employee</label>
                  <EmployeePicker employees={employees} value={reassignForm.employee_id} onChange={(employeeId) => setReassignForm({ employee_id: employeeId })} excludeId={reassignTarget.employee_id} required />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setReassignTarget(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Reassign</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Return Modal */}
      {returnTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setReturnTarget(null)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">Return DHAR Entry — {returnTarget.lot_id}</span><button className="btn btn-secondary btn-sm" onClick={() => setReturnTarget(null)}>✕</button></div>
            <form onSubmit={submitReturn}>
              <div className="modal-body">
                {returnError && <div className="alert alert-error">{returnError}</div>}
                <div className="form-group">
                  <label className="form-label">Received Date</label>
                  <input type="date" className="form-input" value={returnForm.received_date} onChange={(e) => setReturnForm({ ...returnForm, received_date: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Remarks</label>
                  <input type="text" className="form-input" value={returnForm.remarks} onChange={(e) => setReturnForm({ ...returnForm, remarks: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setReturnTarget(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Return</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DharPage() {
  return <RoleGate roles={["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES]} permission="manage_department_entries"><DharInner /></RoleGate>;
}
