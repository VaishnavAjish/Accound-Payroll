"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useFeedback } from "@/lib/Feedback";
import { api } from "@/lib/api";
import Pagination from "@/components/Pagination";
import RoleGate from "@/components/RoleGate";
import { STAFF_ROLES } from "@/lib/roles";

function EmployeeDetailInner() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useFeedback();
  const [employee, setEmployee] = useState(null);
  const [error, setError] = useState("");
  const [newCode, setNewCode] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  async function load() {
    try {
      setEmployee(await api.get(`/employees/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function releaseCode() {
    setError("");
    try {
      await api.post(`/employees/${id}/release-code`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function assignCode(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/employees/${id}/assign-code`, { code: newCode });
      setNewCode("");
      load();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  const codeHistory = employee?.code_history || [];
  const paginatedCodeHistory = codeHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  if (!employee) return <div className="loading-state">Loading...</div>;
  const canManageCode = user.role === "ACCOUNTANT" || user.role === "SUPER_ADMIN";

  return (
    <div>
      <div className="page-header">
        <button className="btn btn-secondary btn-sm" onClick={() => router.push("/employees")}>← Back</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><span className="card-title">Details</span></div>
        <div className="card-body">
          <div className="form-row">
            <div><div className="form-label">Department</div><div>{employee.department || "POLISH_1"}</div></div>
            <div><div className="form-label">Grade</div><div>{employee.grade || "-"}</div></div>
            <div><div className="form-label">Specialist</div><div>{employee.specialist || "-"}</div></div>
          </div>
          <div className="form-row" style={{ marginTop: 12 }}>
            <div><div className="form-label">Work Status</div><div>{employee.work_status}</div></div>
            <div><div className="form-label">Mobile</div><div>{employee.mobile || "-"}</div></div>
          </div>
        </div>
      </div>

      {canManageCode && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><span className="card-title">Employee Code Lifecycle</span></div>
          <div className="card-body">
            {employee.current_code ? (
              <div>
                <p style={{ fontSize: 13, marginBottom: 10 }}>Releasing a code is blocked while this employee has unresolved Lot in Hand or unfinalized payroll.</p>
                <button className="btn btn-danger btn-sm" onClick={releaseCode}>Release Code {employee.current_code}</button>
              </div>
            ) : (
              <form onSubmit={assignCode} style={{ display: "flex", gap: 8 }}>
                <input className="form-input" placeholder="New code" value={newCode} onChange={(e) => setNewCode(e.target.value)} required />
                <button className="btn btn-primary btn-sm" type="submit">Assign</button>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header"><span className="card-title">Code History</span></div>
        <div className="card-body table-responsive">
          <table className="pro-table">
            <thead><tr><th>Code</th><th>Assigned</th><th>Released</th></tr></thead>
            <tbody>
              {paginatedCodeHistory.map((c) => (
                <tr key={c.id}>
                  <td><span className="badge badge-blue">{c.code}</span></td>
                  <td>{c.assigned_at ? new Date(c.assigned_at).toLocaleDateString() : "-"}</td>
                  <td>{c.released_at ? new Date(c.released_at).toLocaleDateString() : <span className="badge badge-emerald">Active</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={codeHistory.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
      </div>
    </div>
  );
}

export default function EmployeeDetailPage() {
  return <RoleGate roles={STAFF_ROLES} permission="manage_employees"><EmployeeDetailInner /></RoleGate>;
}
