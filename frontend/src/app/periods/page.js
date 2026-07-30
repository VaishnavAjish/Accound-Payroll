"use client";
import { useEffect, useState } from "react";
import RoleGate from "@/components/RoleGate";
import { useAuth } from "@/lib/AuthContext";
import { useFeedback } from "@/lib/Feedback";
import { useRefresh } from "@/lib/RefreshContext";
import Pagination from "@/components/Pagination";
import { api } from "@/lib/api";
import { DropdownMenu, DropdownItem } from "@/components/Dropdown";

const EMPTY = { name: "", start_date: "", end_date: "" };

function PeriodsInner() {
  const { user } = useAuth();
  const { showToast, confirmAction } = useFeedback();
  const { broadcast } = useRefresh();
  
  const canManagePeriods = user?.role === "ACCOUNTANT" || user?.role === "SUPER_ADMIN";
  const canOpenPeriod = canManagePeriods;
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [reopenTarget, setReopenTarget] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setPeriods(await api.get("/periods"));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setFormError("");
    try {
      await api.post("/periods", form);
      setShowModal(false);
      setForm(EMPTY);
      load();
      broadcast("periods");
      broadcast("dashboard");
      broadcast("notifications");
    } catch (err) {
      setFormError(err.message);
    }
  }

  async function closePeriod(p) {
    if (!(await confirmAction(`Close period "${p.name}"? Managers will no longer be able to submit into it.`))) return;
    try {
      await api.post(`/periods/${p.id}/close`);
      load();
      broadcast("periods");
      broadcast("dashboard");
      broadcast("notifications");
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function submitReopen(e) {
    e.preventDefault();
    if (submitting || !reopenTarget) return;
    setSubmitting(true);
    try {
      await api.post(`/periods/${reopenTarget.id}/reopen`);
      showToast(`Period "${reopenTarget.name}" reopened successfully.`, "success");
      setReopenTarget(null);
      load();
      broadcast("periods");
      broadcast("dashboard");
      broadcast("notifications");
    } catch (err) {
      showToast(err.message, "error");
      load();
    } finally {
      setSubmitting(false);
    }
  }

  const paginatedPeriods = periods.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-actions">
          {canOpenPeriod && (
            <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setFormError(""); setShowModal(true); }}>+ Open Period</button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading periods...</div>
      ) : (
        <div className="card">
          <div className="card-body table-responsive">
            <table className="pro-table">
              <thead><tr><th>Name</th><th>Start</th><th>End</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {paginatedPeriods.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td className="mono">{p.start_date}</td>
                    <td className="mono">{p.end_date}</td>
                    <td><span className={`badge ${p.status === "OPEN" ? "badge-emerald" : "badge-gray"}`}>{p.status}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <DropdownMenu>
                        {p.status === "OPEN" && canManagePeriods && <DropdownItem danger onClick={() => closePeriod(p)}>Close</DropdownItem>}
                        {p.status === "CLOSED" && canManagePeriods && <DropdownItem danger onClick={() => setReopenTarget(p)}>Reopen</DropdownItem>}
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {periods.length === 0 && <tr><td colSpan={5} className="empty-state">No periods yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={periods.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">Open New Period</span><button className="btn btn-secondary btn-sm" onClick={() => setShowModal(false)}>✕</button></div>
            <form onSubmit={submit}>
              <div className="modal-body">
                {formError && <div className="alert alert-error">{formError}</div>}
                <div className="form-group"><label className="form-label">Name</label><input className="form-input" placeholder="e.g. 2026-08" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Start Date</label><input type="date" className="form-input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">End Date</label><input type="date" className="form-input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Open</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reopenTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setReopenTarget(null)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">Reopen {reopenTarget.name}</span><button className="btn btn-secondary btn-sm" onClick={() => setReopenTarget(null)}>✕</button></div>
            <form onSubmit={submitReopen}>
              <div className="modal-body">
                <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0 }}>
                  This will reopen the closed month and allow entries again.
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setReopenTarget(null)} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? "Reopening..." : "Reopen"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PeriodsPage() {
  return <RoleGate roles={["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"]} permission="manage_periods"><PeriodsInner /></RoleGate>;
}
