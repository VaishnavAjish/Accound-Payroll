"use client";
import React, { useEffect, useState } from "react";
import RoleGate from "@/components/RoleGate";
import { useAuth } from "@/lib/AuthContext";
import { useFeedback } from "@/lib/Feedback";
import { api } from "@/lib/api";
import { DEPARTMENTS, MANAGER_ROLES, departmentLabel, roleLabel } from "@/lib/roles";

const compactRoleLabel = (role) => role.startsWith("POLISH_") ? `P${role.split("_")[1]}` : roleLabel(role);

import { UsersInner } from "../users/page";
import { RatesInner } from "../rates/page";
import { MasterDataInner } from "../master-data/page";

const ICONS = {
  shield: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
  ),
  rates: (
    <span style={{ width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 500, lineHeight: 1 }}>₹</span>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
  ),
  save: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
      <polyline points="17 21 17 13 7 13 7 21"></polyline>
      <polyline points="7 3 7 8 15 8"></polyline>
    </svg>
  )
};

const MANAGED_ROLES = [
  { key: "ADMIN", label: "Admin", badgeClass: "badge-indigo" },
  { key: "ACCOUNTANT", label: "Accountant", badgeClass: "badge-blue" },
  ...MANAGER_ROLES.map((role) => ({ key: role, label: roleLabel(role), badgeClass: "badge-emerald" })),
];

const FANTACY_ALL_DEPARTMENTS = "ALL";

function summarizeFantacyDepartments(departments = []) {
  if (!departments.length) return "No Access";
  if (departments.includes(FANTACY_ALL_DEPARTMENTS)) return "All Departments";
  if (departments.length === 1) return departmentLabel(departments[0]);
  return `${departments.length} Departments`;
}

function nextFantacyDepartments(current = [], department) {
  if (!department) return [];
  if (department === FANTACY_ALL_DEPARTMENTS) {
    return current.includes(FANTACY_ALL_DEPARTMENTS) ? [] : [FANTACY_ALL_DEPARTMENTS];
  }

  const withoutAll = current.filter((item) => item !== FANTACY_ALL_DEPARTMENTS);
  if (withoutAll.includes(department)) {
    return withoutAll.filter((item) => item !== department);
  }
  return [...withoutAll, department];
}

export function SuperAdminPanelInner() {
  const { user } = useAuth();
  const { showToast } = useFeedback();

  const [activeTab, setActiveTab] = useState("RBAC"); // RBAC | USERS | RATES | MASTER_DATA

  // RBAC State
  const [definitions, setDefinitions] = useState([]);
  const [departmentDefinitions, setDepartmentDefinitions] = useState(DEPARTMENTS);
  const [departmentAccess, setDepartmentAccess] = useState({});
  const [matrix, setMatrix] = useState({});
  const [loadingRbac, setLoadingRbac] = useState(true);
  const [savingRbac, setSavingRbac] = useState(false);

  async function loadRbac() {
    setLoadingRbac(true);
    try {
      const data = await api.get("/rbac/permissions");
      setDefinitions(data.permissionDefinitions || []);
      setDepartmentDefinitions(data.departmentDefinitions || DEPARTMENTS);
      setDepartmentAccess(data.departmentAccess || {});
      setMatrix(data.matrix || {});
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoadingRbac(false);
    }
  }

  useEffect(() => {
    loadRbac();
  }, []);

  function togglePermission(roleKey, permKey) {
    setMatrix(prev => ({
      ...prev,
      [roleKey]: {
        ...prev[roleKey],
        [permKey]: !prev[roleKey]?.[permKey]
      }
    }));
  }

  function changeFantacyDepartment(roleKey, department) {
    const nextDepartments = nextFantacyDepartments(departmentAccess[roleKey] || [], department);
    setDepartmentAccess((prev) => ({
      ...prev,
      [roleKey]: nextDepartments,
    }));
    setMatrix((prev) => ({
      ...prev,
      [roleKey]: {
        ...prev[roleKey],
        fetch_fantacy_department_data: nextDepartments.length > 0,
      },
    }));
  }

  async function saveRbac() {
    setSavingRbac(true);
    try {
      const updates = [];
      for (const roleObj of MANAGED_ROLES) {
        for (const perm of definitions) {
          updates.push({
            role: roleObj.key,
            permission_key: perm.key,
            is_allowed: Boolean(matrix[roleObj.key]?.[perm.key])
          });
        }
      }

      await api.post("/rbac/permissions", { updates, departmentAccess });
      showToast("RBAC Permission Matrix updated successfully!", "success");
      loadRbac();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSavingRbac(false);
    }
  }

  // Group definitions by category
  const categories = Array.from(new Set(definitions.map(d => d.category)));

  return (
    <div>
      {/* Main Tabs Navigation */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, padding: '4px', background: 'var(--bg-secondary, #f8fafc)', borderRadius: 10, border: '1px solid var(--border-primary, #e2e8f0)', width: 'fit-content' }}>
        <button 
          className={`admin-tab-btn ${activeTab === "RBAC" ? "active" : ""}`}
          onClick={() => setActiveTab("RBAC")}
        >
          {ICONS.shield}
          <span>Permissions & RBAC</span>
        </button>

        <button 
          className={`admin-tab-btn ${activeTab === "USERS" ? "active" : ""}`}
          onClick={() => setActiveTab("USERS")}
        >
          {ICONS.users}
          <span>User Management</span>
        </button>

        <button 
          className={`admin-tab-btn ${activeTab === "RATES" ? "active" : ""}`}
          onClick={() => setActiveTab("RATES")}
        >
          {ICONS.rates}
          <span>Rate Management</span>
        </button>

        <button 
          className={`admin-tab-btn ${activeTab === "MASTER_DATA" ? "active" : ""}`}
          onClick={() => setActiveTab("MASTER_DATA")}
        >
          {ICONS.settings}
          <span>Master Data</span>
        </button>
      </div>

      {/* Tab 1: RBAC Matrix */}
      {activeTab === "RBAC" && (
        <div>
          {loadingRbac ? (
            <div className="loading-state">Loading RBAC matrix...</div>
          ) : definitions.length === 0 ? (
            <div className="empty-state">No RBAC permissions loaded. Please refresh the page or restart the backend server.</div>
          ) : (
            <>
              <div className="card">
                <div className="card-body table-responsive" style={{ padding: 0 }}>
                  <table className="pro-table rbac-table">
                    <thead>
                      <tr>
                        <th>Permission / Feature</th>
                        {MANAGED_ROLES.map((roleObj) => (
                          <th key={roleObj.key}>
                            <span className={`badge ${roleObj.badgeClass}`} title={roleObj.label}>
                              {compactRoleLabel(roleObj.key)}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map((cat) => (
                        <React.Fragment key={cat}>
                          <tr style={{ background: 'var(--bg-secondary, #f8fafc)' }}>
                            <td colSpan={MANAGED_ROLES.length + 1} className="rbac-category-row">
                              {cat}
                            </td>
                          </tr>
                          {definitions.filter(d => d.category === cat).map((perm) => (
                            <tr key={perm.key} style={{ transition: 'background 0.15s ease' }}>
                              <td>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{perm.label}</div>
                                <div className="mono rbac-permission-key">{perm.key}</div>
                              </td>

                              {MANAGED_ROLES.map((roleObj) => {
                                const checked = Boolean(matrix[roleObj.key]?.[perm.key]);
                                if (perm.key === "fetch_fantacy_department_data") {
                                  const selectedDepartments = departmentAccess[roleObj.key] || [];
                                  const allSelected = selectedDepartments.includes(FANTACY_ALL_DEPARTMENTS);
                                  return (
                                    <td key={roleObj.key} style={{ position: "relative" }}>
                                      <details style={{ position: "relative" }}>
                                        <summary
                                          className="form-select"
                                          style={{
                                            minWidth: 132,
                                            height: 30,
                                            padding: "5px 24px 5px 8px",
                                            fontSize: 12,
                                            cursor: "pointer",
                                            listStyle: "none",
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                          }}
                                          title={selectedDepartments.includes(FANTACY_ALL_DEPARTMENTS) ? "All Departments" : selectedDepartments.map(departmentLabel).join(", ") || "No Access"}
                                        >
                                          {summarizeFantacyDepartments(selectedDepartments)}
                                        </summary>
                                        <div
                                          style={{
                                            position: "absolute",
                                            left: 0,
                                            bottom: "calc(100% + 6px)",
                                            zIndex: 30,
                                            minWidth: 170,
                                            maxHeight: 230,
                                            overflowY: "auto",
                                            padding: 8,
                                            border: "1px solid var(--border-primary)",
                                            borderRadius: "var(--radius-md)",
                                            background: "var(--bg-card)",
                                            boxShadow: "var(--shadow-md)",
                                          }}
                                        >
                                          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", fontSize: 12, cursor: "pointer" }}>
                                            <input type="checkbox" checked={!selectedDepartments.length} onChange={() => changeFantacyDepartment(roleObj.key, "")} />
                                            <span>No Access</span>
                                          </label>
                                          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", fontSize: 12, cursor: "pointer" }}>
                                            <input type="checkbox" checked={allSelected} onChange={() => changeFantacyDepartment(roleObj.key, FANTACY_ALL_DEPARTMENTS)} />
                                            <span>All Departments</span>
                                          </label>
                                          <div style={{ height: 1, background: "var(--border-primary)", margin: "6px 0" }} />
                                          {departmentDefinitions.map((department) => (
                                            <label key={department} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", fontSize: 12, cursor: allSelected ? "not-allowed" : "pointer", opacity: allSelected ? 0.5 : 1 }}>
                                              <input
                                                type="checkbox"
                                                checked={!allSelected && selectedDepartments.includes(department)}
                                                disabled={allSelected}
                                                onChange={() => changeFantacyDepartment(roleObj.key, department)}
                                              />
                                              <span>{departmentLabel(department)}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </details>
                                    </td>
                                  );
                                }
                                return (
                                  <td key={roleObj.key}>
                                    <label className="toggle-switch compact">
                                      <input 
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => togglePermission(roleObj.key, perm.key)}
                                      />
                                      <span className="toggle-slider"></span>
                                    </label>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                <button 
                  className="btn btn-primary" 
                  onClick={saveRbac} 
                  disabled={savingRbac || loadingRbac}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                >
                  {ICONS.save}
                  <span>{savingRbac ? "Saving..." : "Save Permission Changes"}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab 2: User Management */}
      {activeTab === "USERS" && (
        <div>
          <UsersInner />
        </div>
      )}

      {/* Tab 3: Rate Management */}
      {activeTab === "RATES" && (
        <div>
          <RatesInner />
        </div>
      )}

      {/* Tab 4: Master Data */}
      {activeTab === "MASTER_DATA" && (
        <div>
          <MasterDataInner />
        </div>
      )}
    </div>
  );
}

export default function SuperAdminPanelPage() {
  return (
    <RoleGate roles={["SUPER_ADMIN"]}>
      <SuperAdminPanelInner />
    </RoleGate>
  );
}
