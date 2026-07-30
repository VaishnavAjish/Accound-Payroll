"use client";
import { useEffect, useState } from "react";
import { useFeedback } from "@/lib/Feedback";
import { api } from "@/lib/api";
import { DropdownMenu, DropdownItem } from "@/components/Dropdown";
import Pagination from "@/components/Pagination";
import RoleGate from "@/components/RoleGate";
import { MANAGER_ROLES, roleLabel } from "@/lib/roles";
import EmployeePicker from "@/components/EmployeePicker";

const EMPTY = { email: "", password: "", name: "", role: "POLISH_1_MANAGER", employee_id: "" };
const USER_ROLES = ["ADMIN", "ACCOUNTANT", ...MANAGER_ROLES, "EMPLOYEE"];

export function UsersInner() {
  const { showToast, confirmAction } = useFeedback();
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [created, setCreated] = useState(null);

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY);
  const [editError, setEditError] = useState("");

  function loadUsers() {
    api.get("/auth/users").then(setUsers).catch(err => setError(err.message));
  }

  useEffect(() => { 
    api.get("/employees").then(setEmployees); 
    loadUsers();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      const user = await api.post("/auth/users", { ...form, employee_id: form.role === "EMPLOYEE" ? form.employee_id : undefined });
      setCreated(user);
      setForm(EMPTY);
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  function openEdit(u) {
    setEditTarget(u);
    setEditForm({ name: u.name, role: u.role, active: u.active });
    setEditError("");
  }

  async function submitEdit(e) {
    e.preventDefault();
    setEditError("");
    try {
      await api.patch(`/auth/users/${editTarget.id}`, editForm);
      setEditTarget(null);
      loadUsers();
    } catch (err) {
      setEditError(err.message);
    }
  }

  async function toggleActive(u) {
    try {
      await api.patch(`/auth/users/${u.id}`, { active: !u.active });
      loadUsers();
      showToast(`User '${u.name}' ${u.active ? 'disabled' : 'enabled'}.`, "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function deleteUser(u) {
    if (!(await confirmAction(`Are you sure you want to permanently delete the user '${u.name}'?`, { danger: true, confirmLabel: "Delete" }))) return;
    try {
      await api.del(`/auth/users/${u.id}`);
      showToast(`User '${u.name}' deleted.`, "success");
      loadUsers();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  const filteredUsers = users.filter(u => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (u.name && u.name.toLowerCase().includes(term)) ||
      (u.email && u.email.toLowerCase().includes(term)) ||
      (u.role && u.role.toLowerCase().includes(term))
    );
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const paginatedUsers = filteredUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input 
            type="search" 
            className="form-input" 
            placeholder="Search Name, Email, Role..." 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
            style={{ width: 240 }} 
          />
          <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setError(""); setCreated(null); setShowModal(true); }}>+ Create User</button>
        </div>
      </div>

      <div className="card">
        <div className="card-body table-responsive">
          <table className="pro-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {paginatedUsers.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="mono">{u.email}</td>
                  <td><span className="badge badge-indigo">{roleLabel(u.role)}</span></td>
                  <td>
                    {u.active ? <span className="badge badge-emerald">Active</span> : <span className="badge badge-rose">Inactive</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {u.role !== "SUPER_ADMIN" ? (
                      <DropdownMenu>
                        <DropdownItem onClick={() => openEdit(u)}>Edit</DropdownItem>
                        <DropdownItem danger={u.active} onClick={() => toggleActive(u)}>
                          {u.active ? 'Disable' : 'Enable'}
                        </DropdownItem>
                        <DropdownItem danger onClick={() => deleteUser(u)}>
                          Delete
                        </DropdownItem>
                      </DropdownMenu>
                    ) : (
                      <span style={{ color: "var(--color-text-light)", fontSize: "0.85rem" }}>Super Admin</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && <tr><td colSpan={5} className="empty-state">No users matching your search.</td></tr>}
            </tbody>
          </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={filteredUsers.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">Create User</span><button className="btn btn-secondary btn-sm" onClick={() => setShowModal(false)}>✕</button></div>
            {created ? (
              <div className="modal-body">
                <div className="alert alert-success">Account created for {created.email} ({created.role}).</div>
                <button className="btn btn-primary" onClick={() => setShowModal(false)}>Done</button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <div className="modal-body">
                  {error && <div className="alert alert-error">{error}</div>}
                  <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
                  <div className="form-group"><label className="form-label">Temporary Password</label><input className="form-input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></div>
                  <div className="form-group">
                    <label className="form-label">Role</label>
                    <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                      {USER_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                    </select>
                  </div>
                  {form.role === "EMPLOYEE" && (
                    <div className="form-group">
                      <label className="form-label">Linked Employee</label>
                      <EmployeePicker employees={employees} value={form.employee_id} onChange={(employeeId) => setForm({ ...form, employee_id: employeeId })} required />
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Create</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setEditTarget(null)}>
          <div className="modal">
            <div className="modal-header"><span className="modal-title">Edit User</span><button className="btn btn-secondary btn-sm" onClick={() => setEditTarget(null)}>✕</button></div>
            <form onSubmit={submitEdit}>
              <div className="modal-body">
                {editError && <div className="alert alert-error">{editError}</div>}
                <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required /></div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-select" value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                    {USER_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
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
    </div>
  );
}

export default function UsersPage() {
  return <RoleGate roles={["SUPER_ADMIN", "ADMIN"]} permission="manage_users"><UsersInner /></RoleGate>;
}
