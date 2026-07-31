"use client";
import { useEffect, useState, Fragment } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useFeedback } from "@/lib/Feedback";
import { useGlobalPeriod } from "@/lib/PeriodContext";
import { useRefresh, useSubscribe } from "@/lib/RefreshContext";
import { MANAGER_ROLES, isManagerRole } from "@/lib/roles";
import { api } from "@/lib/api";
import { exportToExcel } from "@/lib/exportHelper";
import { DropdownMenu, DropdownItem } from "@/components/Dropdown";
import RoleGate from "@/components/RoleGate";
import Pagination from "@/components/Pagination";
import EmployeePicker from "@/components/EmployeePicker";
import EmployeeEntryTabs from "@/components/EmployeeEntryTabs";

const ISSUE_FIELDS = ["issue_date", "lot_id", "lot_name", "qty", "shape", "send_weight", "estimate_weight"];
const EMPTY_ISSUE = { employee_id: "", issue_date: "", lot_id: "", lot_name: "", qty: 1, shape: "", send_weight: "", estimate_weight: "" };
const EMPTY_COMPLETE = { received_date: "", polished_weight: "", color: "", shade: "", clarity: "", cut_pol_sym: "", grader: "", stone_level: "", lab_name: "", remarks: "", labour_head: "Full Polished" };
const EMPTY_BULK_ISSUE_ROW = { issue_date: "", lot_id: "", lot_name: "", qty: 1, shape: "", send_weight: "", estimate_weight: "" };

function formatIstTime(value) {
  return value ? String(value).slice(0, 5) : "";
}

function useMasterData(categories) {
  const [data, setData] = useState({});
  useEffect(() => {
    Promise.all(categories.map((c) => api.get(`/master-data?category=${c}`))).then((results) => {
      const map = {};
      categories.forEach((c, i) => { map[c] = results[i]; });
      setData(map);
    });
  }, []);
  return data;
}

export function PolishInner({ overridePeriodId }) {
  const { user } = useAuth();
  const { activePeriodId, isActivePeriodClosed } = useGlobalPeriod();
  const { showToast, confirmAction } = useFeedback();
  const { broadcast } = useRefresh();
  const isManager = isManagerRole(user?.role);
  const master = useMasterData(["SHAPE", "LABOUR_HEAD", "COLOR", "SHADE", "CLARITY", "CUT_POL_SYM", "GRADER", "STONE_LEVEL", "LAB"]);
  const [employees, setEmployees] = useState([]);
  const [entries, setEntries] = useState([]);
  const [filterEmpId, setFilterEmpId] = useState("");
  const [openEmployeeIds, setOpenEmployeeIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueForm, setIssueForm] = useState(EMPTY_ISSUE);
  const [issueError, setIssueError] = useState("");
  const [showBulkIssueModal, setShowBulkIssueModal] = useState(false);
  const [bulkEmployeeId, setBulkEmployeeId] = useState("");
  const [bulkRows, setBulkRows] = useState([{ ...EMPTY_BULK_ISSUE_ROW }]);
  const [bulkError, setBulkError] = useState("");

  const [completeTarget, setCompleteTarget] = useState(null);
  const [completeForm, setCompleteForm] = useState(EMPTY_COMPLETE);
  const [completeError, setCompleteError] = useState("");

  const [reassignTarget, setReassignTarget] = useState(null);
  const [reassignForm, setReassignForm] = useState({ new_employee_id: "", new_issue_date: "", send_weight_received: "", reason: "" });
  const [reassignError, setReassignError] = useState("");

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterEmpId) qs.append("employee_id", filterEmpId);
      if (activePeriodId) qs.append("period_id", activePeriodId);
      
      const [emps, list] = await Promise.all([
        api.get("/employees"),
        api.get(`/polish${qs.toString() ? `?${qs.toString()}` : ""}`),
      ]);
      setEmployees(emps.filter(e => !e.current_code || !e.current_code.toUpperCase().startsWith('DHAR')));
      setEntries(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const isFiltered = !!filterEmpId;
  const filteredCompleted = isFiltered ? entries.filter(e => e.status === "COMPLETED") : [];
  let polishSendWeight = 0, polishPolished = 0, polishSalary = 0;
  if (isFiltered) {
    filteredCompleted.forEach(p => {
      polishSendWeight += Number(p.send_weight || 0);
      polishPolished += Number(p.polished_weight || 0);
      if (p.calculated_salary && p.calculated_salary !== "HIDDEN") polishSalary += Number(p.calculated_salary);
    });
  }

  const handleExport = () => {
    const dataToExport = filteredEntries.map(e => {
      const emp = employees.find(x => x.id === e.employee_id);
      const row = {
        "Employee Code": emp?.current_code || "",
        "Employee Name": emp?.name || "",
        "Status": e.status || "",
        "Issue Date": e.issue_date || "",
        "Issue Time (IST)": formatIstTime(e.issue_time),
        "Lot ID": e.lot_id || "",
        "Lot Name": e.lot_name || "",
        "Qty": e.qty ?? "",
        "Shape": e.shape || "",
        "Send WT (ct)": e.send_weight ?? "",
        "Est. WT (ct)": e.estimate_weight ?? "",
        "Labour Head": e.labour_head || "",
        "Received Date": e.received_date || "",
        "Received Time (IST)": formatIstTime(e.received_time),
        "Polished WT (ct)": e.polished_weight ?? "",
        "Diff WT (ct)": e.send_weight != null && e.polished_weight != null ? (e.send_weight - e.polished_weight).toFixed(2) : "",
        "Days Consumed": e.received_date ? Math.max(0, Math.round((new Date(e.received_date) - new Date(e.issue_date)) / 86400000)) : "",
        "Color": e.color || "",
        "Shade": e.shade || "",
        "Clarity": e.clarity || "",
        "Cut/Pol/Sym": e.cut_pol_sym || "",
        "Grader": e.grader || "",
        "Level": e.stone_level || "",
        "Lab": e.lab_name || "",
        "Remarks": e.remarks || "",
        "Rate Range": e.rate_range || ""
      };
      if (!isManager) {
        row["Rate"] = e.rate_snapshot ?? "";
        row["Salary"] = e.calculated_salary === "HIDDEN" ? "HIDDEN" : (e.calculated_salary ?? "");
      }
      return row;
    });
    exportToExcel(dataToExport, "Polish_Entries.xlsx", "Polish Work");
  };

  useEffect(() => { load(); }, [filterEmpId, activePeriodId]);
  useSubscribe("polish", load);
  useSubscribe("employees", load);

  function broadcastPolishChange() {
    ["polish", "verification", "dashboard", "notifications"].forEach(broadcast);
  }

  function openBulkIssue() {
    setBulkEmployeeId(filterEmpId || "");
    setBulkRows([{ ...EMPTY_BULK_ISSUE_ROW }]);
    setBulkError("");
    setShowBulkIssueModal(true);
  }

  function updateBulkRow(index, field, value) {
    setBulkRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  function addBulkRow() {
    setBulkRows((rows) => [...rows, { ...EMPTY_BULK_ISSUE_ROW }]);
  }

  function removeBulkRow(index) {
    setBulkRows((rows) => rows.length === 1 ? rows : rows.filter((_, rowIndex) => rowIndex !== index));
  }

  async function submitBulkIssue(e) {
    e.preventDefault();
    setBulkError("");
    try {
      await api.post("/polish/bulk", { employee_id: bulkEmployeeId, entries: bulkRows });
      setShowBulkIssueModal(false);
      setBulkEmployeeId("");
      setBulkRows([{ ...EMPTY_BULK_ISSUE_ROW }]);
      load();
      broadcastPolishChange();
      showToast(`${bulkRows.length} Polish lots issued successfully.`, "success");
    } catch (err) {
      setBulkError(err.message);
    }
  }

  async function submitIssue(e, asDraft) {
    e.preventDefault();
    setIssueError("");
    try {
      await api.post("/polish", { ...issueForm, is_draft: asDraft });
      setShowIssueModal(false);
      setIssueForm(EMPTY_ISSUE);
      load();
      broadcastPolishChange();
    } catch (err) {
      setIssueError(err.message);
    }
  }

  async function submitDraft(entry) {
    try {
      await api.patch(`/polish/${entry.id}/submit`);
      load();
      broadcastPolishChange();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  function openComplete(entry) {
    setCompleteTarget(entry);
    setCompleteForm({ ...EMPTY_COMPLETE, labour_head: entry.labour_head || "Full Polished" });
    setCompleteError("");
  }

  async function submitComplete(e) {
    e.preventDefault();
    setCompleteError("");
    try {
      await api.patch(`/polish/${completeTarget.id}/complete`, completeForm);
      setCompleteTarget(null);
      load();
      broadcastPolishChange();
    } catch (err) {
      setCompleteError(err.message);
    }
  }

  async function revertEntry(entry) {
    if (!(await confirmAction("Revert this returned entry back to Lot in Hand? This removes its salary from the period total.", { danger: true, confirmLabel: "Revert" }))) return;
    try {
      await api.patch(`/polish/${entry.id}/revert-to-lot-in-hand`);
      load();
      broadcastPolishChange();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  function openReassign(entry) {
    setReassignTarget(entry);
    setReassignForm({ new_employee_id: "", new_issue_date: "", send_weight_received: "", reason: "" });
    setReassignError("");
  }

  async function submitReassign(e) {
    e.preventDefault();
    setReassignError("");
    try {
      await api.post(`/polish/${reassignTarget.id}/reassign`, reassignForm);
      setReassignTarget(null);
      load();
      broadcastPolishChange();
    } catch (err) {
      setReassignError(err.message);
    }
  }

  function openEdit(entry) {
    setEditTarget(entry);
    setEditForm({ ...entry, labour_head: entry.labour_head || "" });
    setEditError("");
  }

  async function submitEdit(e) {
    e.preventDefault();
    setEditError("");
    const editable = ['issue_date', 'lot_id', 'lot_name', 'qty', 'shape', 'send_weight', 'estimate_weight', 'labour_head', 'received_date', 'polished_weight', 'color', 'shade', 'clarity', 'cut_pol_sym', 'grader', 'stone_level', 'lab_name', 'remarks'];
    const payload = {};
    for (const f of editable) if (editForm[f] !== undefined) payload[f] = editForm[f];
    try {
      await api.patch(`/polish/${editTarget.id}`, payload);
      setEditTarget(null);
      load();
      broadcastPolishChange();
    } catch (err) {
      setEditError(err.message);
    }
  }

  async function deleteEntry(entry) {
    if (!(await confirmAction("Delete this entry? This cannot be undone.", { danger: true, confirmLabel: "Delete" }))) return;
    try {
      await api.del(`/polish/${entry.id}`);
      load();
      broadcastPolishChange();
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

  const STATUS_BADGE = { DRAFT: "badge-gray", LOT_IN_HAND: "badge-amber", COMPLETED: "badge-emerald", TRANSFERRED: "badge-violet" };

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
            <button className="btn btn-secondary" disabled={isActivePeriodClosed} onClick={openBulkIssue}>Bulk Entry</button>
            <button className="btn btn-primary" disabled={isActivePeriodClosed} onClick={() => { setIssueForm(EMPTY_ISSUE); setIssueError(""); setShowIssueModal(true); }}>+ New Entry</button>
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
          <button className="btn btn-secondary" disabled={isActivePeriodClosed} onClick={openBulkIssue}>Bulk Entry</button>
          <button className="btn btn-primary" disabled={isActivePeriodClosed} onClick={() => { setIssueForm(EMPTY_ISSUE); setIssueError(""); setShowIssueModal(true); }}>+ New Entry</button>
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

      {isFiltered && !loading && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Total Send WT (ct)</div>
            <div className="kpi-value mono">{polishSendWeight.toFixed(2)} <span style={{fontSize:"0.65em", color:"var(--text-muted)", fontWeight:"500"}}>ct</span></div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Total Polished</div>
            <div className="kpi-value mono">{polishPolished.toFixed(2)} <span style={{fontSize:"0.65em", color:"var(--text-muted)", fontWeight:"500"}}>ct</span></div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Diff WT</div>
            <div className="kpi-value mono">{(polishSendWeight - polishPolished).toFixed(2)} <span style={{fontSize:"0.65em", color:"var(--text-muted)", fontWeight:"500"}}>ct</span></div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Avg WT / Lot</div>
            <div className="kpi-value mono">{filteredCompleted.length ? (polishSendWeight / filteredCompleted.length).toFixed(2) : "0.00"} <span style={{fontSize:"0.65em", color:"var(--text-muted)", fontWeight:"500"}}>ct</span></div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Lots in Hand</div>
            <div className="kpi-value mono">{isFiltered ? entries.filter(e => e.status === "LOT_IN_HAND").length : 0}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Lots Returned</div>
            <div className="kpi-value mono">{filteredCompleted.length}</div>
          </div>
          <div className="kpi-card" style={{ border: "1px solid var(--accent-primary)", background: "var(--accent-primary-light)" }}>
            <div className="kpi-label" style={{ color: "var(--accent-primary)" }}>Total Payable</div>
            <div className="kpi-value mono" style={{ color: "var(--accent-primary)" }}>₹{polishSalary.toLocaleString("en-IN")}</div>
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
                <tr>
                  <th>Emp Code</th>
                  <th>Status</th>
                  <th>Employee Name</th>
                  <th>Issue Date</th>
                  <th>Issue Time (IST)</th>
                  <th>Lot ID</th>
                  <th>Lot Name</th>
                  <th>Qty</th>
                  <th>Shape</th>
                  <th>Send WT (ct)</th>
                  <th>Est. WT</th>
                  <th>Labour Head</th>
                  <th>Received Date</th>
                  <th>Received Time (IST)</th>
                  <th>Polished WT</th>
                  <th>Diff WT</th>
                  <th>Days</th>
                  <th>Color</th>
                  <th>Shade</th>
                  <th>Clarity</th>
                  <th>Cut/Pol/Sym</th>
                  <th>Grader</th>
                  <th>Level</th>
                  <th>Lab</th>
                  <th>Remarks</th>
                  <th>Range</th>
                  <th>Salary</th>
                  <th style={{ width: '60px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{empMap[e.employee_id]?.current_code || "-"}</td>
                    <td><span className={`badge ${STATUS_BADGE[e.status]}`}>{e.status === 'COMPLETED' ? 'RETURNED' : e.status.replace(/_/g, " ")}</span></td>
                    <td style={{ whiteSpace: "nowrap" }}>{empMap[e.employee_id]?.name || e.employee_id}</td>
                    <td className="mono">{e.issue_date}</td>
                    <td className="mono">{formatIstTime(e.issue_time) || "-"}</td>
                    <td>{e.lot_id || "-"}</td>
                    <td>{e.lot_name || "-"}</td>
                    <td className="mono">{e.qty ?? "-"}</td>
                    <td>{e.shape || "-"}</td>
                    <td className="mono">{e.send_weight ?? "-"}</td>
                    <td className="mono">{e.estimate_weight ?? "-"}</td>
                    <td>{e.labour_head || "-"}</td>
                    <td className="mono">{e.received_date || "-"}</td>
                    <td className="mono">{formatIstTime(e.received_time) || "-"}</td>
                    <td className="mono">{e.polished_weight ?? "-"}</td>
                    <td className="mono">{e.send_weight != null && e.polished_weight != null ? (e.send_weight - e.polished_weight).toFixed(2) : "-"}</td>
                    <td className="mono">{e.received_date ? Math.max(0, Math.round((new Date(e.received_date) - new Date(e.issue_date)) / 86400000)) : (e.issue_date ? Math.max(0, Math.round((new Date() - new Date(e.issue_date)) / 86400000)) : "-")}</td>
                    <td>{e.color || "-"}</td>
                    <td>{e.shade || "-"}</td>
                    <td>{e.clarity || "-"}</td>
                    <td>{e.cut_pol_sym || "-"}</td>
                    <td>{e.grader || "-"}</td>
                    <td>{e.stone_level || "-"}</td>
                    <td>{e.lab_name || "-"}</td>
                    <td>{e.remarks || "-"}</td>
                    <td className="mono">{e.rate_range || "-"}</td>
                    <td className="mono">
                      {e.rate_missing ? <span className="badge badge-rose">Rate Missing</span> : (e.calculated_salary != null ? `₹${Number(e.calculated_salary).toLocaleString("en-IN")}` : "-")}
                    </td>
                    <td style={{ whiteSpace: "nowrap", textAlign: 'right' }}>
                      <DropdownMenu>
                        <DropdownItem onClick={() => openEdit(e)} disabled={isActivePeriodClosed}>Edit</DropdownItem>
                        {e.status === "DRAFT" && <DropdownItem onClick={() => submitDraft(e)} disabled={isActivePeriodClosed}>Submit</DropdownItem>}
                        {e.status === "LOT_IN_HAND" && <DropdownItem onClick={() => openComplete(e)} disabled={isActivePeriodClosed}>Return</DropdownItem>}
                        {e.status === "COMPLETED" && !isActivePeriodClosed && (
                          <>
                            <DropdownItem onClick={() => revertEntry(e)}>Revert</DropdownItem>
                            <DropdownItem onClick={() => openReassign(e)}>Reassign</DropdownItem>
                          </>
                        )}
                        <DropdownItem danger onClick={() => deleteEntry(e)} disabled={isActivePeriodClosed}>Delete</DropdownItem>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {filteredEntries.length === 0 && <tr><td colSpan={26} className="empty-state">No entries matching your search.</td></tr>}
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

      {showIssueModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowIssueModal(false)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">New Polish Entry</span><button className="btn btn-secondary btn-sm" onClick={() => setShowIssueModal(false)}>✕</button></div>
            <form onSubmit={(e) => submitIssue(e, false)}>
              <div className="modal-body">
                {issueError && <div className="alert alert-error">{issueError}</div>}
                <div className="form-group">
                  <label className="form-label">Employee</label>
                  <EmployeePicker employees={employees} value={issueForm.employee_id} onChange={(employeeId) => setIssueForm({ ...issueForm, employee_id: employeeId })} required />
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Issue Date</label><input type="date" className="form-input" value={issueForm.issue_date} onChange={(e) => setIssueForm({ ...issueForm, issue_date: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Lot ID</label><input className="form-input" value={issueForm.lot_id} onChange={(e) => setIssueForm({ ...issueForm, lot_id: e.target.value })} required /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Lot Name</label><input className="form-input" value={issueForm.lot_name} onChange={(e) => setIssueForm({ ...issueForm, lot_name: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Qty</label><input type="number" className="form-input" value={issueForm.qty} onChange={(e) => setIssueForm({ ...issueForm, qty: e.target.value })} required /></div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Shape</label>
                    <select className="form-select" value={issueForm.shape} onChange={(e) => setIssueForm({ ...issueForm, shape: e.target.value })} required>
                      <option value="">Select...</option>
                      {(master.SHAPE || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Send WT (ct)</label><input type="number" step="0.01" className="form-input" value={issueForm.send_weight} onChange={(e) => setIssueForm({ ...issueForm, send_weight: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Est. WT (ct)</label><input type="number" step="0.01" className="form-input" value={issueForm.estimate_weight} onChange={(e) => setIssueForm({ ...issueForm, estimate_weight: e.target.value })} required /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={(e) => submitIssue(e, true)}>Save Draft</button>
                <button type="submit" className="btn btn-primary">Submit</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBulkIssueModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowBulkIssueModal(false)}>
          <div className="modal" style={{ maxWidth: 1100 }}>
            <div className="modal-header"><span className="modal-title">Bulk Polish Entry</span><button className="btn btn-secondary btn-sm" onClick={() => setShowBulkIssueModal(false)}>✕</button></div>
            <form onSubmit={submitBulkIssue}>
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
                        <th>#</th><th>Issue Date</th><th>Lot ID</th><th>Lot Name</th><th>Qty</th><th>Shape</th><th>Send WT</th><th>Est. WT</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((row, index) => (
                        <tr key={index}>
                          <td className="mono">{index + 1}</td>
                          <td><input type="date" className="form-input" value={row.issue_date} onChange={(e) => updateBulkRow(index, "issue_date", e.target.value)} required /></td>
                          <td><input className="form-input" value={row.lot_id} onChange={(e) => updateBulkRow(index, "lot_id", e.target.value)} required /></td>
                          <td><input className="form-input" value={row.lot_name} onChange={(e) => updateBulkRow(index, "lot_name", e.target.value)} required /></td>
                          <td><input type="number" className="form-input" value={row.qty} onChange={(e) => updateBulkRow(index, "qty", e.target.value)} required style={{ width: 80 }} /></td>
                          <td>
                            <select className="form-select" value={row.shape} onChange={(e) => updateBulkRow(index, "shape", e.target.value)} required style={{ minWidth: 140 }}>
                              <option value="">Select...</option>
                              {(master.SHAPE || []).map((shape) => <option key={shape.id} value={shape.value}>{shape.value}</option>)}
                            </select>
                          </td>
                          <td><input type="number" step="0.01" className="form-input" value={row.send_weight} onChange={(e) => updateBulkRow(index, "send_weight", e.target.value)} required style={{ width: 110 }} /></td>
                          <td><input type="number" step="0.01" className="form-input" value={row.estimate_weight} onChange={(e) => updateBulkRow(index, "estimate_weight", e.target.value)} required style={{ width: 110 }} /></td>
                          <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => removeBulkRow(index)} disabled={bulkRows.length === 1}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addBulkRow} style={{ marginTop: 12 }}>+ Add Row</button>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowBulkIssueModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Issue {bulkRows.length} Lots</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {completeTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setCompleteTarget(null)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">Return Entry — {completeTarget.lot_id}</span><button className="btn btn-secondary btn-sm" onClick={() => setCompleteTarget(null)}>✕</button></div>
            <form onSubmit={submitComplete}>
              <div className="modal-body">
                {completeError && <div className="alert alert-error">{completeError}</div>}
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Received Date</label><input type="date" className="form-input" value={completeForm.received_date} onChange={(e) => setCompleteForm({ ...completeForm, received_date: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Polished WT</label><input type="number" step="0.01" className="form-input" value={completeForm.polished_weight} onChange={(e) => setCompleteForm({ ...completeForm, polished_weight: e.target.value })} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Labour Head</label>
                    <select className="form-select" value={completeForm.labour_head} onChange={(e) => setCompleteForm({ ...completeForm, labour_head: e.target.value })} required>
                      <option value="">Select...</option>
                      {(master.LABOUR_HEAD || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Color</label>
                    <select className="form-select" value={completeForm.color} onChange={(e) => setCompleteForm({ ...completeForm, color: e.target.value })}>
                      <option value="">—</option>{(master.COLOR || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Shade</label>
                    <select className="form-select" value={completeForm.shade} onChange={(e) => setCompleteForm({ ...completeForm, shade: e.target.value })}>
                      <option value="">—</option>{(master.SHADE || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Clarity</label>
                    <select className="form-select" value={completeForm.clarity} onChange={(e) => setCompleteForm({ ...completeForm, clarity: e.target.value })}>
                      <option value="">—</option>{(master.CLARITY || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Cut/Pol/Sym</label>
                    <select className="form-select" value={completeForm.cut_pol_sym} onChange={(e) => setCompleteForm({ ...completeForm, cut_pol_sym: e.target.value })}>
                      <option value="">—</option>{(master.CUT_POL_SYM || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Grader</label>
                    <select className="form-select" value={completeForm.grader} onChange={(e) => setCompleteForm({ ...completeForm, grader: e.target.value })}>
                      <option value="">—</option>{(master.GRADER || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Stone Level</label>
                    <select className="form-select" value={completeForm.stone_level} onChange={(e) => setCompleteForm({ ...completeForm, stone_level: e.target.value })}>
                      <option value="">—</option>{(master.STONE_LEVEL || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">LAB</label>
                  <select className="form-select" value={completeForm.lab_name} onChange={(e) => setCompleteForm({ ...completeForm, lab_name: e.target.value })}>
                    <option value="">—</option>{(master.LAB || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Remarks (optional)</label>
                  <input className="form-input" value={completeForm.remarks} onChange={(e) => setCompleteForm({ ...completeForm, remarks: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setCompleteTarget(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Return</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reassignTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setReassignTarget(null)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">Reassign — {reassignTarget.lot_id}</span><button className="btn btn-secondary btn-sm" onClick={() => setReassignTarget(null)}>✕</button></div>
            <form onSubmit={submitReassign}>
              <div className="modal-body">
                {reassignError && <div className="alert alert-error">{reassignError}</div>}
                <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 0 }}>The original entry closes as Transferred (non-payable). A new linked entry is created for the receiving employee.</p>
                <div className="form-group">
                  <label className="form-label">Receiving Employee</label>
                  <EmployeePicker employees={employees} value={reassignForm.new_employee_id} onChange={(employeeId) => setReassignForm({ ...reassignForm, new_employee_id: employeeId })} excludeId={reassignTarget.employee_id} required />
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">New Issue Date</label><input type="date" className="form-input" value={reassignForm.new_issue_date} onChange={(e) => setReassignForm({ ...reassignForm, new_issue_date: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Send WT Received</label><input type="number" step="0.01" className="form-input" value={reassignForm.send_weight_received} onChange={(e) => setReassignForm({ ...reassignForm, send_weight_received: e.target.value })} required /></div>
                </div>
                <div className="form-group">
                  <label className="form-label">Reason</label>
                  <input className="form-input" value={reassignForm.reason} onChange={(e) => setReassignForm({ ...reassignForm, reason: e.target.value })} required />
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

      {editTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setEditTarget(null)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">Edit Entry — {editTarget.lot_id}</span><button className="btn btn-secondary btn-sm" onClick={() => setEditTarget(null)}>✕</button></div>
            <form onSubmit={submitEdit}>
              <div className="modal-body">
                {editError && <div className="alert alert-error">{editError}</div>}
                
                <div className="nav-section-title" style={{ marginTop: 0 }}>Issue Details</div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Issue Date</label><input type="date" className="form-input" value={editForm.issue_date || ""} onChange={(e) => setEditForm({ ...editForm, issue_date: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Lot ID</label><input className="form-input" value={editForm.lot_id || ""} onChange={(e) => setEditForm({ ...editForm, lot_id: e.target.value })} required /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Lot Name</label><input className="form-input" value={editForm.lot_name || ""} onChange={(e) => setEditForm({ ...editForm, lot_name: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Qty</label><input type="number" className="form-input" value={editForm.qty ?? ""} onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })} required /></div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Shape</label>
                    <select className="form-select" value={editForm.shape || ""} onChange={(e) => setEditForm({ ...editForm, shape: e.target.value })} required>
                      <option value="">Select...</option>
                      {(master.SHAPE || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                    </select>
                  </div>
                  <div className="form-group"><label className="form-label">Send WT (ct)</label><input type="number" step="0.01" className="form-input" value={editForm.send_weight ?? ""} onChange={(e) => setEditForm({ ...editForm, send_weight: e.target.value })} required /></div>
                </div>
                <div className="form-group"><label className="form-label">Est. WT (ct)</label><input type="number" step="0.01" className="form-input" value={editForm.estimate_weight ?? ""} onChange={(e) => setEditForm({ ...editForm, estimate_weight: e.target.value })} required /></div>

                {editTarget.status === 'COMPLETED' && (
                  <>
                    <div className="nav-section-title" style={{ marginTop: '16px' }}>Completion Details</div>
                    <div className="form-row">
                      <div className="form-group"><label className="form-label">Received Date</label><input type="date" className="form-input" value={editForm.received_date || ""} onChange={(e) => setEditForm({ ...editForm, received_date: e.target.value })} required /></div>
                      <div className="form-group">
                        <label className="form-label">Labour Head</label>
                        <select className="form-select" value={editForm.labour_head || ""} onChange={(e) => setEditForm({ ...editForm, labour_head: e.target.value })} required>
                          <option value="">Select...</option>
                          {(master.LABOUR_HEAD || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                        </select>
                      </div>
                      <div className="form-group"><label className="form-label">Polished WT</label><input type="number" step="0.01" className="form-input" value={editForm.polished_weight ?? ""} onChange={(e) => setEditForm({ ...editForm, polished_weight: e.target.value })} /></div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Color</label>
                        <select className="form-select" value={editForm.color || ""} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}>
                          <option value="">—</option>{(master.COLOR || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Shade</label>
                        <select className="form-select" value={editForm.shade || ""} onChange={(e) => setEditForm({ ...editForm, shade: e.target.value })}>
                          <option value="">—</option>{(master.SHADE || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Clarity</label>
                        <select className="form-select" value={editForm.clarity || ""} onChange={(e) => setEditForm({ ...editForm, clarity: e.target.value })}>
                          <option value="">—</option>{(master.CLARITY || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Cut/Pol/Sym</label>
                        <select className="form-select" value={editForm.cut_pol_sym || ""} onChange={(e) => setEditForm({ ...editForm, cut_pol_sym: e.target.value })}>
                          <option value="">—</option>{(master.CUT_POL_SYM || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Grader</label>
                        <select className="form-select" value={editForm.grader || ""} onChange={(e) => setEditForm({ ...editForm, grader: e.target.value })}>
                          <option value="">—</option>{(master.GRADER || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Stone Level</label>
                        <select className="form-select" value={editForm.stone_level || ""} onChange={(e) => setEditForm({ ...editForm, stone_level: e.target.value })}>
                          <option value="">—</option>{(master.STONE_LEVEL || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">LAB</label>
                        <select className="form-select" value={editForm.lab_name || ""} onChange={(e) => setEditForm({ ...editForm, lab_name: e.target.value })}>
                          <option value="">—</option>{(master.LAB || []).map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Remarks (optional)</label>
                      <input className="form-input" value={editForm.remarks || ""} onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })} />
                    </div>
                  </>
                )}

              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PolishPage() {
  return <RoleGate roles={["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES]} permission="manage_department_entries"><PolishInner /></RoleGate>;
}
