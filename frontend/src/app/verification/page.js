"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useGlobalPeriod } from "@/lib/PeriodContext";
import { useRefresh, useSubscribe } from "@/lib/RefreshContext";
import Pagination from "@/components/Pagination";
import { exportToExcel } from "@/lib/exportHelper";
import { DropdownMenu, DropdownItem } from "@/components/Dropdown";
import { useFeedback } from "@/lib/Feedback";
import { api } from "@/lib/api";
import LedgerModal from "@/components/LedgerModal";
import RoleGate from "@/components/RoleGate";
import { MANAGER_ROLES, isManagerRole } from "@/lib/roles";

const STATUS_LABEL = { CALCULATED: "Calculated", MANAGER_VERIFIED: "Manager Verified", ACCOUNTS_VERIFIED: "Final Payable" };
const STATUS_BADGE = { CALCULATED: "badge-amber", MANAGER_VERIFIED: "badge-blue", ACCOUNTS_VERIFIED: "badge-emerald" };

export function VerificationPageInner() {
  const { user } = useAuth();
  const { activePeriodId: periodId, isActivePeriodClosed } = useGlobalPeriod();
  const { showToast } = useFeedback();
  const { broadcast } = useRefresh();
  const isManagerOnly = isManagerRole(user?.role);
  // MPS 13: Accounts cannot complete final verification before Manager
  // verification -- that separation is enforced by the backend regardless of
  // what this UI shows, but Root Admin genuinely can act at either stage, so
  // the two bulk-selection sets below are tracked independently rather than
  // collapsed into one "mode" per role.
  const canAccountsVerify = user?.role === "ACCOUNTANT" || user?.role === "SUPER_ADMIN";
  const canManagerVerify = isManagerRole(user?.role) || user?.role === "SUPER_ADMIN";

  const [rows, setRows] = useState([]);
  const [selectedManager, setSelectedManager] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [reopenTarget, setReopenTarget] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const searchParams = useSearchParams();

  useEffect(() => {
    const s = searchParams.get("search");
    if (s) {
      setSearchTerm(s);
    }
  }, [searchParams]);

  const [statementTarget, setStatementTarget] = useState(null);

  async function load() {
    if (!periodId) return;
    setLoading(true);
    setError("");
    try {
      setRows(await api.get(`/verification?period_id=${periodId}`));
      setSelectedManager([]);
      setSelectedAccounts([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [periodId]);
  useSubscribe("verification", load);

  function broadcastVerificationChange() {
    ["verification", "polish", "dhar", "maxi", "dashboard", "notifications"].forEach(broadcast);
  }

  async function managerVerify(employeeId) {
    try {
      await api.post(`/verification/${employeeId}/${periodId}/manager-verify`);
      showToast("Manager verification recorded.", "success");
      load();
      broadcastVerificationChange();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function accountsVerify(employeeId) {
    try {
      await api.post(`/verification/${employeeId}/${periodId}/accounts-verify`);
      showToast("Accountant verification recorded -- Final Payable.", "success");
      load();
      broadcastVerificationChange();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function bulkVerify(stage) {
    const ids = stage === "manager" ? selectedManager : selectedAccounts;
    if (!ids.length) return;
    const path = stage === "manager" ? "manager-verify" : "accounts-verify";
    try {
      const results = await api.post(`/verification/bulk/${path}`, { period_id: periodId, employee_ids: ids });
      const failed = Object.entries(results).filter(([, r]) => !r.ok);
      const okCount = ids.length - failed.length;
      if (okCount > 0) showToast(`${okCount} employee${okCount === 1 ? "" : "s"} verified.`, "success");
      if (failed.length) {
        showToast(`${failed.length} skipped:\n` + failed.map(([id, r]) => `#${id}: ${r.reason}`).join("\n"), "warning");
      }
      load();
      broadcastVerificationChange();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function submitReopen(e) {
    e.preventDefault();
    try {
      const endpoint = isManagerOnly 
        ? `/verification/${reopenTarget.employee_id}/${periodId}/request-reopen`
        : `/verification/${reopenTarget.employee_id}/${periodId}/reopen`;
      await api.post(endpoint);
      showToast(isManagerOnly ? "Reopen request submitted." : "Reopened for correction.", "success");
      setReopenTarget(null);
      load();
      broadcastVerificationChange();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function rejectReopenRequest(employeeId) {
    try {
      await api.post(`/verification/${employeeId}/${periodId}/reject-reopen-request`);
      showToast("Reopen request rejected/dismissed.", "success");
      load();
      broadcastVerificationChange();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  function openStatement(emp) {
    setStatementTarget(emp);
  }

  function toggle(setFn, list, id) {
    setFn(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  const filteredRows = rows.filter(r => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (r.employee_name && r.employee_name.toLowerCase().includes(term)) ||
      (r.employee_code && r.employee_code.toLowerCase().includes(term))
    );
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const paginatedRows = filteredRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleExport = () => {
    const dataToExport = filteredRows.map(r => {
      const row = {
        "Employee Code": r.employee_code || "",
        "Employee Name": r.employee_name || "",
        "Verification Status": STATUS_LABEL[r.status] || r.status
      };
      if (!isManagerOnly) {
        row["Final Payable Amount"] = r.final_snapshot_total != null ? r.final_snapshot_total : "—";
      }
      return row;
    });
    exportToExcel(dataToExport, "Verification_Summary.xlsx", "Payroll Summary");
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input 
            type="search" 
            className="form-input" 
            placeholder="Search Name or Code..." 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
            style={{ width: 220 }} 
          />
          <button className="btn btn-secondary" onClick={handleExport}>Export</button>
          {selectedManager.length > 0 && (
            <button className="btn btn-primary" onClick={() => bulkVerify("manager")} disabled={isActivePeriodClosed}>Bulk Manager Verify ({selectedManager.length})</button>
          )}
          {selectedAccounts.length > 0 && (
            <button className="btn btn-primary" onClick={() => bulkVerify("accounts")} disabled={isActivePeriodClosed}>Bulk Accountant Verify ({selectedAccounts.length})</button>
          )}
        </div>
      </div>

      {isActivePeriodClosed && (
        <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 500 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          This period is closed. Verification actions are locked.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading...</div>
      ) : (
        <div className="card">
          <div className="card-body table-responsive">
            <table className="pro-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>EMP - Code</th><th>Employee</th><th>Status</th><th>Final Total</th><th></th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((r) => {
                  const canSelectManager = canManagerVerify && r.status === "CALCULATED";
                  const canSelectAccounts = canAccountsVerify && r.status === "MANAGER_VERIFIED";
                  return (
                    <tr key={r.employee_id}>
                      <td>
                        {canSelectManager && (
                          <input type="checkbox" checked={selectedManager.includes(r.employee_id)} onChange={() => toggle(setSelectedManager, selectedManager, r.employee_id)} title="Select for bulk Manager verify" />
                        )}
                        {canSelectAccounts && (
                          <input type="checkbox" checked={selectedAccounts.includes(r.employee_id)} onChange={() => toggle(setSelectedAccounts, selectedAccounts, r.employee_id)} title="Select for bulk Accounts verify" />
                        )}
                      </td>
                      <td style={{ fontWeight: 500, color: "var(--text-secondary)" }}>{r.employee_code || "—"}</td>
                      <td style={{ fontWeight: 500 }}>{r.employee_name}</td>
                      <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                      <td className="mono">{r.final_snapshot_total != null ? `₹${Number(r.final_snapshot_total).toLocaleString("en-IN")}` : "—"}</td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        <DropdownMenu>
                          <DropdownItem onClick={() => openStatement(r)}>View Ledger</DropdownItem>
                          {r.status === "CALCULATED" && canManagerVerify && <DropdownItem onClick={() => managerVerify(r.employee_id)} disabled={isActivePeriodClosed}>Manager Verify</DropdownItem>}
                          {r.status === "MANAGER_VERIFIED" && canAccountsVerify && <DropdownItem onClick={() => accountsVerify(r.employee_id)} disabled={isActivePeriodClosed}>Final Payable Verify</DropdownItem>}
                          {r.status === "MANAGER_VERIFIED" && canAccountsVerify && (
                            <DropdownItem onClick={() => setReopenTarget(r)} danger disabled={isActivePeriodClosed}>Reopen for Correction...</DropdownItem>
                          )}
                          {r.status === "ACCOUNTS_VERIFIED" && (
                            <>
                              {isManagerOnly ? (
                                r.reopen_requested_by ? (
                                  <DropdownItem disabled>Reopen Requested (Pending)</DropdownItem>
                                ) : (
                                  <DropdownItem onClick={() => setReopenTarget(r)} danger disabled={isActivePeriodClosed}>Request Reopen...</DropdownItem>
                                )
                              ) : (
                                <>
                                  {r.reopen_requested_by ? (
                                    <>
                                      <DropdownItem onClick={() => setReopenTarget(r)} danger disabled={isActivePeriodClosed}>Approve Reopen Request...</DropdownItem>
                                      <DropdownItem onClick={() => rejectReopenRequest(r.employee_id)} danger disabled={isActivePeriodClosed}>Reject Reopen Request</DropdownItem>
                                    </>
                                  ) : (
                                    <DropdownItem onClick={() => setReopenTarget(r)} danger disabled={isActivePeriodClosed}>Reopen for Correction...</DropdownItem>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && <tr><td colSpan={isManagerOnly ? 5 : 6} className="empty-state">No records.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={filteredRows.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
        </div>
      )}

      {reopenTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setReopenTarget(null)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">
                {isManagerOnly ? "Request Reopen" : "Reopen"} — {reopenTarget.employee_name}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => setReopenTarget(null)}>✕</button>
            </div>
            <form onSubmit={submitReopen}>
              <div className="modal-body">
                <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 0 }}>
                  {isManagerOnly 
                    ? "This sends a request to Accountant and Super Admin to reopen this Final Payable record for corrections." 
                    : "This resets verification back to Calculated. The employee-month must go through Manager and Accountant verification again."}
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setReopenTarget(null)}>Cancel</button>
                <button type="submit" className="btn btn-danger">
                  {isManagerOnly ? "Submit Reopen Request" : "Reopen for Correction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {statementTarget && (
        <LedgerModal 
          employee={{ id: statementTarget.employee_id, name: statementTarget.employee_name }} 
          periodId={periodId} 
          isManagerOnly={isManagerOnly} 
          onClose={() => setStatementTarget(null)} 
        />
      )}
    </div>
  );
}

export default function VerificationPage() {
  return (
    <RoleGate roles={["SUPER_ADMIN", "ACCOUNTANT", ...MANAGER_ROLES]} permission="manage_verification">
      <Suspense fallback={<div className="loading-state">Loading page...</div>}>
        <VerificationPageInner />
      </Suspense>
    </RoleGate>
  );
}
