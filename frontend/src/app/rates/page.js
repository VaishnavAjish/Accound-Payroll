"use client";
import { useEffect, useState } from "react";
import RoleGate from "@/components/RoleGate";
import { useRefresh, useSubscribe } from "@/lib/RefreshContext";
import { useFeedback } from "@/lib/Feedback";
import { api } from "@/lib/api";
import { DropdownMenu, DropdownItem } from "@/components/Dropdown";
import Pagination from "@/components/Pagination";

const POLISH_EMPTY = { category: "ROUND_OEB", min_weight: "", max_weight: "", rate_per_ct: "", effective_from: "" };
const DHAR_EMPTY = { classification: "ALL_SHAPE", weight_slab: "LT_2", rate_per_ct: "", effective_from: "" };

export function RatesInner() {
  const [tab, setTab] = useState("polish");
  const [polishRates, setPolishRates] = useState([]);
  const [dharRates, setDharRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [polishForm, setPolishForm] = useState(POLISH_EMPTY);
  const [dharForm, setDharForm] = useState(DHAR_EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const { broadcast } = useRefresh();
  const { showToast, confirmAction } = useFeedback();

  async function load() {
    setLoading(true);
    try {
      const [pr, dr] = await Promise.all([api.get("/rates/polish"), api.get("/rates/dhar")]);
      setPolishRates(pr);
      setDharRates(dr);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useSubscribe("rates", load);

  function broadcastRateChange() {
    ["rates", "polish", "dhar", "verification", "dashboard", "notifications"].forEach(broadcast);
  }

  async function submitPolish(e) {
    e.preventDefault();
    setError("");
    try {
      if (editingId) {
        await api.put(`/rates/polish/${editingId}`, { ...polishForm, max_weight: polishForm.max_weight || null });
      } else {
        await api.post("/rates/polish", { ...polishForm, max_weight: polishForm.max_weight || null });
      }
      setShowModal(false);
      setPolishForm(POLISH_EMPTY);
      setEditingId(null);
      load();
      broadcastRateChange();
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitDhar(e) {
    e.preventDefault();
    setError("");
    try {
      if (editingId) {
        await api.put(`/rates/dhar/${editingId}`, dharForm);
      } else {
        await api.post("/rates/dhar", dharForm);
      }
      setShowModal(false);
      setDharForm(DHAR_EMPTY);
      setEditingId(null);
      load();
      broadcastRateChange();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deactivateRate(type, r) {
    if (!(await confirmAction(`Are you sure you want to deactivate this rate?`, { danger: true, confirmLabel: "Deactivate" }))) return;
    try {
      const today = new Date().toISOString().split("T")[0];
      await api.put(`/rates/${type}/${r.id}`, { effective_to: today });
      load();
      broadcastRateChange();
      showToast("Rate deactivated", "success");
    } catch (err) {
      showToast("Failed to deactivate: " + err.message, "error");
    }
  }

  async function reactivateRate(type, r) {
    if (!(await confirmAction(`Are you sure you want to reactivate this rate?`, { confirmLabel: "Reactivate" }))) return;
    try {
      await api.put(`/rates/${type}/${r.id}`, { effective_to: null });
      load();
      broadcastRateChange();
      showToast("Rate reactivated", "success");
    } catch (err) {
      showToast("Failed to reactivate: " + err.message, "error");
    }
  }

  function handleEdit(type, r) {
    setEditingId(r.id);
    if (type === "polish") {
      setTab("polish");
      setPolishForm({
        category: r.category,
        min_weight: r.min_weight,
        max_weight: r.max_weight || "",
        rate_per_ct: r.rate_per_ct,
        effective_from: r.effective_from,
      });
    } else {
      setTab("dhar");
      setDharForm({
        classification: r.classification,
        weight_slab: r.weight_slab,
        rate_per_ct: r.rate_per_ct,
        effective_from: r.effective_from,
      });
    }
    setError("");
    setShowModal(true);
  }

  useEffect(() => {
    setCurrentPage(1);
  }, [tab]);

  const isActive = (r) => !r.effective_to;
  
  const paginatedPolish = polishRates.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const paginatedDhar = dharRates.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => { setEditingId(null); setPolishForm(POLISH_EMPTY); setDharForm(DHAR_EMPTY); setError(""); setShowModal(true); }}>+ New Rate Version</button>
        </div>
      </div>

      <div className="tab-nav">
        <div className={`tab-item${tab === "polish" ? " active" : ""}`} onClick={() => setTab("polish")}>Polish Rates</div>
        <div className={`tab-item${tab === "dhar" ? " active" : ""}`} onClick={() => setTab("dhar")}>DHAR Rates</div>
      </div>

      {loading ? (
        <div className="loading-state">Loading rates...</div>
      ) : tab === "polish" ? (
        <div key="polish" className="tab-pane">
          <div className="card">
            <div className="card-body table-responsive">
            <table className="pro-table">
              <thead><tr><th>Category</th><th>WT Slab</th><th>Rate/ct</th><th>Effective From</th><th>Effective To</th><th>Status</th><th style={{textAlign: "right"}}>Actions</th></tr></thead>
              <tbody>
                {paginatedPolish.map((r) => (
                  <tr key={r.id}>
                    <td><span className="badge badge-blue">{r.category.replace(/_/g, " ")}</span></td>
                    <td className="mono">{r.min_weight} – {r.max_weight ?? "∞"}</td>
                    <td className="mono">₹{Number(r.rate_per_ct).toLocaleString("en-IN")}</td>
                    <td className="mono">{r.effective_from}</td>
                    <td className="mono">{r.effective_to || "—"}</td>
                    <td>{isActive(r) ? <span className="badge badge-emerald">Active</span> : <span className="badge badge-gray">Inactive</span>}</td>
                    <td style={{textAlign: "right"}}>
                      <DropdownMenu>
                        <DropdownItem onClick={() => handleEdit("polish", r)}>Edit</DropdownItem>
                        {isActive(r) ? (
                          <DropdownItem onClick={() => deactivateRate("polish", r)} danger>Deactivate</DropdownItem>
                        ) : (
                          <DropdownItem onClick={() => reactivateRate("polish", r)}>Reactivate</DropdownItem>
                        )}
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {polishRates.length === 0 && <tr><td colSpan={7} className="empty-state">No Polish rates configured.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={polishRates.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
        </div>
      </div>
      ) : (
        <div key="dhar" className="tab-pane">
          <div className="card">
          <div className="card-body table-responsive">
            <table className="pro-table">
              <thead><tr><th>Classification</th><th>WT Slab</th><th>Rate/ct</th><th>Effective From</th><th>Effective To</th><th>Status</th><th style={{textAlign: "right"}}>Actions</th></tr></thead>
              <tbody>
                {paginatedDhar.map((r) => (
                  <tr key={r.id}>
                    <td><span className="badge badge-violet">{r.classification.replace("_", " ")}</span></td>
                    <td>{r.weight_slab === "GTE_2" ? "≥ 2.00" : "< 2.00"}</td>
                    <td className="mono">₹{Number(r.rate_per_ct).toLocaleString("en-IN")}</td>
                    <td className="mono">{r.effective_from}</td>
                    <td className="mono">{r.effective_to || "—"}</td>
                    <td>{isActive(r) ? <span className="badge badge-emerald">Active</span> : <span className="badge badge-gray">Inactive</span>}</td>
                    <td style={{textAlign: "right"}}>
                      <DropdownMenu>
                        <DropdownItem onClick={() => handleEdit("dhar", r)}>Edit</DropdownItem>
                        {isActive(r) ? (
                          <DropdownItem onClick={() => deactivateRate("dhar", r)} danger>Deactivate</DropdownItem>
                        ) : (
                          <DropdownItem onClick={() => reactivateRate("dhar", r)}>Reactivate</DropdownItem>
                        )}
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {dharRates.length === 0 && <tr><td colSpan={7} className="empty-state">No DHAR rates configured.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={dharRates.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
        </div>
      </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">{editingId ? "Edit Rate" : "New Rate Version"} ({tab === "polish" ? "Polish" : "DHAR"})</span><button className="btn btn-secondary btn-sm" onClick={() => setShowModal(false)}>✕</button></div>
            {tab === "polish" ? (
              <form onSubmit={submitPolish}>
                <div className="modal-body">
                  {error && <div className="alert alert-error">{error}</div>}
                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <select className="form-select" value={polishForm.category} onChange={(e) => setPolishForm({ ...polishForm, category: e.target.value })}>
                      <option value="ROUND_OEB">Round / OEB</option>
                      <option value="FANCY_IGI">Fancy IGI</option>
                      <option value="FANCY_GIA">Fancy GIA</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Min WT</label><input type="number" step="0.01" className="form-input" value={polishForm.min_weight} onChange={(e) => setPolishForm({ ...polishForm, min_weight: e.target.value })} required /></div>
                    <div className="form-group"><label className="form-label">Max WT (blank = unbounded)</label><input type="number" step="0.01" className="form-input" value={polishForm.max_weight} onChange={(e) => setPolishForm({ ...polishForm, max_weight: e.target.value })} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Rate per ct (₹)</label><input type="number" step="0.01" min="0.01" className="form-input" value={polishForm.rate_per_ct} onChange={(e) => setPolishForm({ ...polishForm, rate_per_ct: e.target.value })} required /></div>
                    <div className="form-group"><label className="form-label">Effective From</label><input type="date" className="form-input" value={polishForm.effective_from} onChange={(e) => setPolishForm({ ...polishForm, effective_from: e.target.value })} required /></div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save</button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitDhar}>
                <div className="modal-body">
                  {error && <div className="alert alert-error">{error}</div>}
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Classification</label>
                      <select className="form-select" value={dharForm.classification} onChange={(e) => setDharForm({ ...dharForm, classification: e.target.value })}>
                        <option value="ALL_SHAPE">All Shape</option>
                        <option value="ROUND">Round</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">WT Slab</label>
                      <select className="form-select" value={dharForm.weight_slab} onChange={(e) => setDharForm({ ...dharForm, weight_slab: e.target.value })}>
                        <option value="LT_2">&lt; 2.00</option>
                        <option value="GTE_2">≥ 2.00</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Rate per ct (₹)</label><input type="number" step="0.01" min="0.01" className="form-input" value={dharForm.rate_per_ct} onChange={(e) => setDharForm({ ...dharForm, rate_per_ct: e.target.value })} required /></div>
                    <div className="form-group"><label className="form-label">Effective From</label><input type="date" className="form-input" value={dharForm.effective_from} onChange={(e) => setDharForm({ ...dharForm, effective_from: e.target.value })} required /></div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RatesPage() {
  return <RoleGate roles={["SUPER_ADMIN", "ADMIN"]} permission="manage_rates"><RatesInner /></RoleGate>;
}
