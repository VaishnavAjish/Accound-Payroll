"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useFeedback } from "@/lib/Feedback";
import { useRefresh, useSubscribe } from "@/lib/RefreshContext";
import { api } from "@/lib/api";
import { DropdownMenu, DropdownItem } from "@/components/Dropdown";
import Pagination from "@/components/Pagination";
import RoleGate from "@/components/RoleGate";
import { DEPARTMENTS, MANAGER_ROLES, isManagerRole } from "@/lib/roles";

const EMPTY_FORM = { name: "", code: "", department: "POLISH_1", grade: "", specialist: "", mobile: "", hastack: "", katora: "", dye: "", work_status: "WORKING" };

function EmployeesInner() {
  const { user } = useAuth();
  const router = useRouter();
  const { showToast } = useFeedback();
  const { broadcast } = useRefresh();
  const [employees, setEmployees] = useState([]);
  const [specialists, setSpecialists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  async function load() {
    setLoading(true);
    try {
      const [emps, master] = await Promise.all([
        api.get("/employees"),
        api.get("/master-data?category=SPECIALIST"),
      ]);
      setEmployees(emps);
      setSpecialists(master);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useSubscribe("employees", load);

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (form.id) {
        await api.patch(`/employees/${form.id}`, form);
      } else {
        await api.post("/employees", form);
      }
      setShowModal(false);
      setForm(EMPTY_FORM);
      load();
      broadcast("employees");
      broadcast("dashboard");
      broadcast("notifications");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function openEditModal(emp) {
    setForm({
      id: emp.id,
      name: emp.name || "",
      code: emp.current_code || "",
      department: emp.department || "POLISH_1",
      grade: emp.grade || "",
      specialist: emp.specialist || "",
      mobile: emp.mobile || "",
      hastack: emp.hastack || "",
      katora: emp.katora || "",
      dye: emp.dye || "",
      work_status: emp.work_status || "WORKING"
    });
    setShowModal(true);
  }

  async function toggleActive(emp) {
    try {
      await api.post(`/employees/${emp.id}/${emp.active ? "deactivate" : "reactivate"}`);
      load();
      broadcast("employees");
      broadcast("dashboard");
      broadcast("notifications");
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  const filteredEmployees = employees.filter(emp => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (emp.name && emp.name.toLowerCase().includes(term)) ||
      (emp.current_code && emp.current_code.toLowerCase().includes(term)) ||
      (emp.mobile && emp.mobile.toLowerCase().includes(term)) ||
      (emp.grade && emp.grade.toLowerCase().includes(term)) ||
      (emp.department && emp.department.toLowerCase().includes(term))
    );
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const paginatedEmployees = filteredEmployees.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input 
            type="search" 
            className="form-input" 
            placeholder="Search Name, Code, Mobile..." 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
            style={{ width: 240 }} 
          />
          <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setShowModal(true); }}>+ Add Employee</button>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Loading employees...</div>
      ) : (
        <div className="card">
          <div className="card-body table-responsive">
            <table className="pro-table">
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Department</th><th>Grade</th><th>Specialist</th><th>Work Status</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {paginatedEmployees.map((e) => (
                  <tr key={e.id} style={{ opacity: e.active ? 1 : 0.5 }}>
                    <td>{e.current_code ? <span className="badge badge-blue">{e.current_code}</span> : <span className="text-muted">— released —</span>}</td>
                    <td style={{ fontWeight: 500, cursor: "pointer" }} onClick={() => router.push(`/employees/${e.id}`)}>{e.name}</td>
                    <td><span className="badge badge-indigo">{e.department || "POLISH_1"}</span></td>
                    <td>{e.grade || "-"}</td>
                    <td>{e.specialist || "-"}</td>
                    <td><span className={`badge ${e.work_status === "WORKING" ? "badge-emerald" : "badge-rose"}`}>{e.work_status}</span></td>
                    <td><span className={`badge ${e.active ? "badge-emerald" : "badge-gray"}`}>{e.active ? "Active" : "Inactive"}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <DropdownMenu>
                        <DropdownItem onClick={() => router.push(`/employees/${e.id}`)}>View</DropdownItem>
                        {(user.role === "ACCOUNTANT" || user.role === "SUPER_ADMIN" || user.role === "ADMIN" || isManagerRole(user.role)) && (
                          <DropdownItem onClick={() => openEditModal(e)}>Edit</DropdownItem>
                        )}
                        {(user.role === "ACCOUNTANT" || user.role === "SUPER_ADMIN") && (
                          <DropdownItem onClick={() => toggleActive(e)}>
                            {e.active ? "Deactivate" : "Reactivate"}
                          </DropdownItem>
                        )}
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {filteredEmployees.length === 0 && (
                  <tr><td colSpan={8} className="empty-state">No employees matching your search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={filteredEmployees.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">{form.id ? "Edit Employee" : "Add Employee"}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                {error && <div className="alert alert-error">{error}</div>}
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Employee Code</label>
                    <input className="form-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                  </div>
                </div>
                <div className="form-row">
                  {!isManagerRole(user?.role) && (
                    <div className="form-group">
                      <label className="form-label">Department</label>
                      <select className="form-select" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                        {DEPARTMENTS.map((dept) => <option key={dept} value={dept}>{dept.replace("_", " ")}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label">Grade</label>
                    <input className="form-input" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="e.g. A+" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Specialist</label>
                    <select className="form-select" value={form.specialist} onChange={(e) => setForm({ ...form, specialist: e.target.value })}>
                      <option value="">—</option>
                      {specialists.map((s) => <option key={s.id} value={s.value}>{s.value}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Mobile</label>
                    <input className="form-input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Work Status</label>
                    <select className="form-select" value={form.work_status} onChange={(e) => setForm({ ...form, work_status: e.target.value })}>
                      <option value="WORKING">WORKING</option>
                      <option value="RESIGN">RESIGN</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmployeesPage() {
  return <RoleGate roles={["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES]} permission="manage_employees"><EmployeesInner /></RoleGate>;
}
