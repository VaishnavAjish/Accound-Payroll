"use client";
import { useEffect, useState } from "react";
import RoleGate from "@/components/RoleGate";
import { useFeedback } from "@/lib/Feedback";
import { api } from "@/lib/api";
import { DropdownMenu, DropdownItem } from "@/components/Dropdown";
import Pagination from "@/components/Pagination";

const CATEGORIES = ["SHAPE", "COLOR", "CLARITY", "LABOUR_HEAD", "SHADE", "STONE_LEVEL", "LAB", "CUT_POL_SYM", "GRADER", "SPECIALIST", "WORK_STATUS", "VERIFY_STATUS"];

export function MasterDataInner() {
  const { showToast } = useFeedback();
  const [category, setCategory] = useState("SHAPE");
  const [values, setValues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  async function load() {
    setLoading(true);
    try {
      setValues(await api.get(`/master-data?category=${category}&includeInactive=true`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [category]);

  async function add(e) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/master-data", { category, value: newValue });
      setNewValue("");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggle(v) {
    try {
      await api.post(`/master-data/${v.id}/${v.active ? "deactivate" : "reactivate"}`);
      load();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  const filteredValues = values.filter((v) => {
    if (!searchTerm) return true;
    return v.value && v.value.toLowerCase().includes(searchTerm.toLowerCase());
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, category]);

  const paginatedValues = filteredValues.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div>
      <div className="page-header">
        <div>
          <input 
            className="form-input" 
            placeholder="Search value..." 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
          />
        </div>
      </div>

      <div className="tab-nav" style={{ flexWrap: "wrap" }}>
        {CATEGORIES.map((c) => (
          <div key={c} className={`tab-item${category === c ? " active" : ""}`} onClick={() => setCategory(c)}>{c.replace(/_/g, " ")}</div>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div key={category} className="tab-pane">
        <form onSubmit={add} style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input className="form-input" placeholder={`New ${category.replace(/_/g, " ").toLowerCase()} value`} value={newValue} onChange={(e) => setNewValue(e.target.value)} required style={{ maxWidth: 320 }} />
          <button className="btn btn-primary" type="submit">Add</button>
        </form>

        {loading ? (
          <div className="loading-state">Loading...</div>
        ) : (
          <div className="card">
            <div className="card-body table-responsive">
              <table className="pro-table">
                <thead><tr><th>Value</th><th>Status</th><th></th></tr></thead>
                <tbody>
                {paginatedValues.map((v) => (
                  <tr key={v.id} style={{ opacity: v.active ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 500 }}>{v.value}</td>
                    <td><span className={`badge ${v.active ? "badge-emerald" : "badge-gray"}`}>{v.active ? "Active" : "Inactive"}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <DropdownMenu>
                        <DropdownItem onClick={() => toggle(v)}>
                          {v.active ? "Deactivate" : "Reactivate"}
                        </DropdownItem>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {filteredValues.length === 0 && (
                  <tr><td colSpan={3} className="empty-state">No values found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={filteredValues.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
          </div>
        )}
      </div>
    </div>
  );
}

export default function MasterDataPage() {
  return <RoleGate roles={["SUPER_ADMIN", "ADMIN"]} permission="manage_master_data"><MasterDataInner /></RoleGate>;
}
