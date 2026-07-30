"use client";
import { useEffect, useMemo, useState } from "react";
import RoleGate from "@/components/RoleGate";
import { useFeedback } from "@/lib/Feedback";
import { useGlobalPeriod } from "@/lib/PeriodContext";
import { useRefresh, useSubscribe } from "@/lib/RefreshContext";
import { STAFF_ROLES } from "@/lib/roles";
import { api } from "@/lib/api";

const EMPTY_POLISH_RETURN = {
  received_date: "",
  polished_weight: "",
  color: "",
  shade: "",
  clarity: "",
  cut_pol_sym: "",
  grader: "",
  stone_level: "",
  lab_name: "",
  remarks: "",
  labour_head: "Full Polished",
};

const EMPTY_DHAR_RETURN = { received_date: "", remarks: "" };

const MASTER_CATEGORIES = ["LABOUR_HEAD", "COLOR", "SHADE", "CLARITY", "CUT_POL_SYM", "GRADER", "STONE_LEVEL", "LAB"];

function isWithinPeriod(dateValue, period) {
  if (!dateValue || !period) return false;
  return dateValue >= period.start_date && dateValue <= period.end_date;
}

function formatIstTime(value) {
  return value ? String(value).slice(0, 5) : "-";
}

function normalizePolishEntry(entry) {
  return {
    ...entry,
    source: "POLISH",
    sourceLabel: "Polish",
    rowKey: `polish-${entry.id}`,
    weight: entry.send_weight,
    detail: entry.estimate_weight ? `Est. ${entry.estimate_weight}` : "-",
    returnWeight: entry.polished_weight,
  };
}

function normalizeDharEntry(entry) {
  return {
    ...entry,
    source: "DHAR",
    sourceLabel: "DHAR",
    rowKey: `dhar-${entry.id}`,
    issue_time: null,
    received_time: null,
    detail: entry.shape_classification || "-",
    returnWeight: "-",
  };
}

function searchableText(entry, employee) {
  return [
    entry.sourceLabel,
    employee?.current_code,
    employee?.name,
    entry.lot_id,
    entry.lot_name,
  ].filter(Boolean).join(" ").toLowerCase();
}

function LotStatusInner() {
  const { activePeriodId, periods, isActivePeriodClosed } = useGlobalPeriod();
  const { broadcast } = useRefresh();
  const { showToast } = useFeedback();

  const [polishEntries, setPolishEntries] = useState([]);
  const [dharEntries, setDharEntries] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [master, setMaster] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("HAND");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [polishTarget, setPolishTarget] = useState(null);
  const [polishForm, setPolishForm] = useState(EMPTY_POLISH_RETURN);
  const [polishError, setPolishError] = useState("");
  const [dharTarget, setDharTarget] = useState(null);
  const [dharForm, setDharForm] = useState(EMPTY_DHAR_RETURN);
  const [dharError, setDharError] = useState("");

  const activePeriod = periods.find((period) => String(period.id) === String(activePeriodId));

  async function load() {
    if (!activePeriodId) return;
    setLoading(true);
    setError("");
    try {
      const [polishRows, dharRows, employeeRows, ...masterRows] = await Promise.all([
        api.get(`/polish?period_id=${activePeriodId}`),
        api.get(`/dhar?period_id=${activePeriodId}`),
        api.get("/employees"),
        ...MASTER_CATEGORIES.map((category) => api.get(`/master-data?category=${category}`)),
      ]);
      setPolishEntries(polishRows);
      setDharEntries(dharRows);
      setEmployees(employeeRows);
      const masterMap = {};
      MASTER_CATEGORIES.forEach((category, index) => {
        masterMap[category] = masterRows[index];
      });
      setMaster(masterMap);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [activePeriodId]);
  useSubscribe("polish", load);
  useSubscribe("dhar", load);
  useSubscribe("employees", load);

  const empMap = useMemo(() => Object.fromEntries(employees.map((employee) => [employee.id, employee])), [employees]);

  const monthlyLots = useMemo(() => {
    if (!activePeriod) return [];
    return [
      ...polishEntries.map(normalizePolishEntry),
      ...dharEntries.map(normalizeDharEntry),
    ].filter((entry) => {
      if (entry.status === "LOT_IN_HAND") return isWithinPeriod(entry.issue_date, activePeriod);
      if (entry.status === "COMPLETED") return String(entry.payable_period_id) === String(activePeriodId);
      return false;
    });
  }, [polishEntries, dharEntries, activePeriod, activePeriodId]);

  const filteredLots = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return monthlyLots;
    return monthlyLots.filter((entry) => searchableText(entry, empMap[entry.employee_id]).includes(term));
  }, [monthlyLots, searchTerm, empMap]);

  const lotsInHand = filteredLots.filter((entry) => entry.status === "LOT_IN_HAND");
  const lotsReturned = filteredLots.filter((entry) => entry.status === "COMPLETED");
  const activeRows = activeTab === "HAND" ? lotsInHand : lotsReturned;
  const totalLots = lotsInHand.length + lotsReturned.length;

  function broadcastLotChange(source) {
    [source.toLowerCase(), "verification", "dashboard", "notifications"].forEach(broadcast);
  }

  function openReturn(entry) {
    if (entry.source === "DHAR") {
      setDharTarget(entry);
      setDharForm(EMPTY_DHAR_RETURN);
      setDharError("");
      return;
    }
    setPolishTarget(entry);
    setPolishForm({ ...EMPTY_POLISH_RETURN, labour_head: entry.labour_head || "Full Polished" });
    setPolishError("");
  }

  async function submitPolishReturn(event) {
    event.preventDefault();
    if (!polishTarget) return;
    setPolishError("");
    try {
      await api.patch(`/polish/${polishTarget.id}/complete`, polishForm);
      setPolishTarget(null);
      setPolishForm(EMPTY_POLISH_RETURN);
      await load();
      broadcastLotChange("POLISH");
      showToast("Polish lot returned successfully.", "success");
    } catch (err) {
      setPolishError(err.message);
    }
  }

  async function submitDharReturn(event) {
    event.preventDefault();
    if (!dharTarget) return;
    setDharError("");
    try {
      await api.patch(`/dhar/${dharTarget.id}/return`, dharForm);
      setDharTarget(null);
      setDharForm(EMPTY_DHAR_RETURN);
      await load();
      broadcastLotChange("DHAR");
      showToast("DHAR lot returned successfully.", "success");
    } catch (err) {
      setDharError(err.message);
    }
  }

  function renderLotRows(rows) {
    return rows.map((entry) => {
      const employee = empMap[entry.employee_id];
      const canReturn = activeTab === "HAND" && !isActivePeriodClosed;
      return (
        <tr key={entry.rowKey} onDoubleClick={() => canReturn && openReturn(entry)} style={{ cursor: canReturn ? "pointer" : "default" }}>
          <td><span className="badge badge-blue">{entry.sourceLabel}</span></td>
          <td className="mono">{employee?.current_code || "-"}</td>
          <td>{employee?.name || entry.employee_id}</td>
          <td>{entry.lot_id || "-"}</td>
          <td>{entry.lot_name || "-"}</td>
          <td className="mono">{entry.issue_date || "-"}</td>
          <td className="mono">{formatIstTime(entry.issue_time)}</td>
          <td className="mono">{entry.weight ?? "-"}</td>
          <td>{entry.detail}</td>
          {activeTab === "RETURNED" && (
            <>
              <td className="mono">{entry.received_date || "-"}</td>
              <td className="mono">{formatIstTime(entry.received_time)}</td>
              <td className="mono">{entry.returnWeight ?? "-"}</td>
            </>
          )}
          {activeTab === "HAND" && (
            <td style={{ textAlign: "right" }}>
              <button className="btn btn-primary btn-sm" disabled={isActivePeriodClosed} onClick={() => openReturn(entry)}>Return</button>
            </td>
          )}
        </tr>
      );
    });
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-actions">
          <input
            type="search"
            className="form-input"
            placeholder="Search employee code, name, lot ID, lot name..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            style={{ maxWidth: 380 }}
          />
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Total Lots</div>
          <div className="kpi-value mono">{totalLots}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Lots In Hand</div>
          <div className="kpi-value mono">{lotsInHand.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Returned Lots</div>
          <div className="kpi-value mono">{lotsReturned.length}</div>
        </div>
      </div>

      <div className="tab-nav">
        <div className={`tab-item${activeTab === "HAND" ? " active" : ""}`} onClick={() => setActiveTab("HAND")}>Lot In Hand ({lotsInHand.length})</div>
        <div className={`tab-item${activeTab === "RETURNED" ? " active" : ""}`} onClick={() => setActiveTab("RETURNED")}>Returned ({lotsReturned.length})</div>
      </div>

      {loading ? (
        <div className="loading-state">Loading lot status...</div>
      ) : (
        <div className="card">
          <div className="card-header">
            <span className="card-title">{activeTab === "HAND" ? "Lots In Hand" : "Returned Lots"}</span>
            <span className={`badge ${activeTab === "HAND" ? "badge-amber" : "badge-emerald"}`}>{activeRows.length}</span>
          </div>
          <div className="card-body table-responsive">
            <table className="pro-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Emp Code</th>
                  <th>Employee</th>
                  <th>Lot ID</th>
                  <th>Lot Name</th>
                  <th>Issue Date</th>
                  <th>Issue Time</th>
                  <th>WT</th>
                  <th>{activeTab === "HAND" ? "Details" : "Issue Details"}</th>
                  {activeTab === "RETURNED" && (
                    <>
                      <th>Received Date</th>
                      <th>Received Time</th>
                      <th>Return WT</th>
                    </>
                  )}
                  {activeTab === "HAND" && <th style={{ textAlign: "right" }}>Action</th>}
                </tr>
              </thead>
              <tbody>
                {renderLotRows(activeRows)}
                {activeRows.length === 0 && (
                  <tr>
                    <td colSpan={activeTab === "HAND" ? 10 : 12} className="empty-state">
                      {activeTab === "HAND" ? "No lots in hand for this month." : "No returned lots for this month."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {polishTarget && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setPolishTarget(null)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Return Polish Lot - {polishTarget.lot_id}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setPolishTarget(null)}>x</button>
            </div>
            <form onSubmit={submitPolishReturn}>
              <div className="modal-body">
                {polishError && <div className="alert alert-error">{polishError}</div>}
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Received Date</label><input type="date" className="form-input" value={polishForm.received_date} onChange={(event) => setPolishForm({ ...polishForm, received_date: event.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Polished WT</label><input type="number" step="0.01" className="form-input" value={polishForm.polished_weight} onChange={(event) => setPolishForm({ ...polishForm, polished_weight: event.target.value })} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Labour Head</label>
                    <select className="form-select" value={polishForm.labour_head} onChange={(event) => setPolishForm({ ...polishForm, labour_head: event.target.value })} required>
                      <option value="">Select...</option>
                      {(master.LABOUR_HEAD || []).map((item) => <option key={item.id} value={item.value}>{item.value}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">LAB</label>
                    <select className="form-select" value={polishForm.lab_name} onChange={(event) => setPolishForm({ ...polishForm, lab_name: event.target.value })}>
                      <option value="">-</option>{(master.LAB || []).map((item) => <option key={item.id} value={item.value}>{item.value}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Color</label><select className="form-select" value={polishForm.color} onChange={(event) => setPolishForm({ ...polishForm, color: event.target.value })}><option value="">-</option>{(master.COLOR || []).map((item) => <option key={item.id} value={item.value}>{item.value}</option>)}</select></div>
                  <div className="form-group"><label className="form-label">Shade</label><select className="form-select" value={polishForm.shade} onChange={(event) => setPolishForm({ ...polishForm, shade: event.target.value })}><option value="">-</option>{(master.SHADE || []).map((item) => <option key={item.id} value={item.value}>{item.value}</option>)}</select></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Clarity</label><select className="form-select" value={polishForm.clarity} onChange={(event) => setPolishForm({ ...polishForm, clarity: event.target.value })}><option value="">-</option>{(master.CLARITY || []).map((item) => <option key={item.id} value={item.value}>{item.value}</option>)}</select></div>
                  <div className="form-group"><label className="form-label">Cut/Pol/Sym</label><select className="form-select" value={polishForm.cut_pol_sym} onChange={(event) => setPolishForm({ ...polishForm, cut_pol_sym: event.target.value })}><option value="">-</option>{(master.CUT_POL_SYM || []).map((item) => <option key={item.id} value={item.value}>{item.value}</option>)}</select></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Grader</label><select className="form-select" value={polishForm.grader} onChange={(event) => setPolishForm({ ...polishForm, grader: event.target.value })}><option value="">-</option>{(master.GRADER || []).map((item) => <option key={item.id} value={item.value}>{item.value}</option>)}</select></div>
                  <div className="form-group"><label className="form-label">Stone Level</label><select className="form-select" value={polishForm.stone_level} onChange={(event) => setPolishForm({ ...polishForm, stone_level: event.target.value })}><option value="">-</option>{(master.STONE_LEVEL || []).map((item) => <option key={item.id} value={item.value}>{item.value}</option>)}</select></div>
                </div>
                <div className="form-group">
                  <label className="form-label">Remarks</label>
                  <input className="form-input" value={polishForm.remarks} onChange={(event) => setPolishForm({ ...polishForm, remarks: event.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setPolishTarget(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Return Lot</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dharTarget && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setDharTarget(null)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Return DHAR Lot - {dharTarget.lot_id}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setDharTarget(null)}>x</button>
            </div>
            <form onSubmit={submitDharReturn}>
              <div className="modal-body">
                {dharError && <div className="alert alert-error">{dharError}</div>}
                <div className="form-group">
                  <label className="form-label">Received Date</label>
                  <input type="date" className="form-input" value={dharForm.received_date} onChange={(event) => setDharForm({ ...dharForm, received_date: event.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Remarks</label>
                  <input className="form-input" value={dharForm.remarks} onChange={(event) => setDharForm({ ...dharForm, remarks: event.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDharTarget(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Return DHAR Lot</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LotStatusPage() {
  return (
    <RoleGate roles={STAFF_ROLES} permission="manage_department_entries">
      <LotStatusInner />
    </RoleGate>
  );
}
