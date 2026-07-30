import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useFeedback } from "@/lib/Feedback";
import Pagination from "@/components/Pagination";

export default function LedgerModal({ employee, periodId, periodName, isManagerOnly, onClose }) {
  const { showToast } = useFeedback();
  const [statementData, setStatementData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pagePolish, setPagePolish] = useState(1);
  const [pageDhar, setPageDhar] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [polishAll, dharAll] = await Promise.all([
          api.get(`/polish?employee_id=${employee.id}&period_id=${periodId}`),
          api.get(`/dhar?employee_id=${employee.id}&period_id=${periodId}`)
        ]);
        const polish = polishAll.filter(p => p.status === "COMPLETED");
        const dhar = dharAll;
        
        let polishSendWeight = 0;
        let polishPolishedWeight = 0;
        let polishSalary = 0;
        polish.forEach(p => { 
          polishSendWeight += Number(p.send_weight || 0); 
          polishPolishedWeight += Number(p.polished_weight || 0);
          if (p.calculated_salary && p.calculated_salary !== "HIDDEN") polishSalary += Number(p.calculated_salary); 
        });

        let dharWeight = 0;
        let dharSalary = 0;
        dhar.forEach(d => { 
          dharWeight += Number(d.weight || 0); 
          if (d.calculated_salary && d.calculated_salary !== "HIDDEN") dharSalary += Number(d.calculated_salary); 
        });

        const totalSendWeight = polishSendWeight + dharWeight;
        const returnPercent = polishSendWeight > 0 ? ((polishPolishedWeight / polishSendWeight) * 100).toFixed(2) : "0.00";

        setStatementData({
          polish, dhar,
          polishSendWeight, polishPolishedWeight, polishSalary,
          dharWeight, dharSalary,
          totalSendWeight,
          returnPercent,
          totalSalary: polishSalary + dharSalary,
          totalLots: polish.length + dhar.length
        });
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [employee.id, periodId]);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "95vw", maxWidth: "1400px" }}>
        <div className="modal-header">
          <span className="modal-title">Employee Ledger - {employee.name} {periodName ? `(${periodName})` : ""}</span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="loading-state">Loading ledger...</div>
          ) : statementData ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
              
              {/* Summary Dashboard */}
              <div className="kpi-grid">
                <div className="kpi-card">
                  <div className="kpi-label">Total Send WT (ct)</div>
                  <div className="kpi-value mono">{statementData.totalSendWeight.toFixed(2)} <span style={{fontSize:"0.65em", color:"var(--text-muted)", fontWeight:"500"}}>ct</span></div>
                </div>
                {statementData.polish.length > 0 && (
                  <>
                    <div className="kpi-card">
                      <div className="kpi-label">Polished WT</div>
                      <div className="kpi-value mono">{statementData.polishPolishedWeight.toFixed(2)} <span style={{fontSize:"0.65em", color:"var(--text-muted)", fontWeight:"500"}}>ct</span></div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-label">Diff WT</div>
                      <div className="kpi-value mono">{(statementData.polishSendWeight - statementData.polishPolishedWeight).toFixed(2)} <span style={{fontSize:"0.65em", color:"var(--text-muted)", fontWeight:"500"}}>ct</span></div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-label">Return / Yield</div>
                      <div className="kpi-value mono" style={{ color: "var(--green-600)" }}>{statementData.returnPercent} <span style={{fontSize:"0.65em", color:"var(--green-600)", fontWeight:"500"}}>%</span></div>
                    </div>
                  </>
                )}
                <div className="kpi-card">
                  <div className="kpi-label">Avg WT / Lot</div>
                  <div className="kpi-value mono">{statementData.totalLots ? (statementData.totalSendWeight / statementData.totalLots).toFixed(2) : "0.00"} <span style={{fontSize:"0.65em", color:"var(--text-muted)", fontWeight:"500"}}>ct</span></div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Total Lots</div>
                  <div className="kpi-value mono">{statementData.totalLots}</div>
                </div>
                <div className="kpi-card" style={{ gridColumn: "1 / -1", border: "1px solid var(--accent-primary)", background: "var(--accent-primary-light)" }}>
                  <div className="kpi-label" style={{ color: "var(--accent-primary)" }}>Total Payable Amount</div>
                  <div className="kpi-value mono" style={{ color: "var(--accent-primary)" }}>₹{statementData.totalSalary.toLocaleString("en-IN")}</div>
                </div>
              </div>

              {statementData.polish.length > 0 && (
                <>
                  <div className="table-responsive" style={{ marginBottom: "1.5rem" }}>
                    <h3 style={{ marginBottom: "0.5rem", fontSize: "1rem", color: "var(--color-text)" }}>Polish Work</h3>
                    <table className="pro-table" style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>
                      <thead>
                        <tr>
                          <th>Issue Dt</th>
                          <th>Rec. Dt</th>
                          <th>Days</th>
                          <th>Lot</th>
                          <th>Shape</th>
                          <th>Lab</th>
                          <th>Head</th>
                          <th>Send WT (ct)</th>
                          <th>Polish</th>
                          <th>Diff</th>
                          <th>Return</th>
                          <th>Slab</th>
                          <th>Rate</th>
                          <th>Salary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statementData.polish.slice((pagePolish - 1) * itemsPerPage, pagePolish * itemsPerPage).map(p => (
                          <tr key={`p-${p.id}`}>
                            <td className="mono">{p.issue_date}</td>
                            <td className="mono">{p.received_date}</td>
                            <td className="mono">{p.days_consumed !== null ? p.days_consumed : '-'}</td>
                            <td>{p.lot_id}</td>
                            <td>{p.shape}</td>
                            <td>{p.lab_name || '-'}</td>
                            <td>{p.labour_head}</td>
                            <td className="mono">{p.send_weight}</td>
                            <td className="mono">{p.polished_weight}</td>
                            <td className="mono">{p.weight_difference !== null ? p.weight_difference : '-'}</td>
                            <td className="mono">{p.send_weight > 0 ? ((p.polished_weight / p.send_weight) * 100).toFixed(1) : 0}%</td>
                            <td><span className="badge badge-emerald">{p.rate_range || "Standard"}</span></td>
                            <td className="mono">{p.rate_snapshot !== null ? `₹${p.rate_snapshot}` : '-'}</td>
                            <td className="mono">₹{Number(p.calculated_salary).toLocaleString("en-IN")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination 
                    currentPage={pagePolish} 
                    totalItems={statementData.polish.length} 
                    itemsPerPage={itemsPerPage} 
                    onPageChange={setPagePolish} 
                    onItemsPerPageChange={setItemsPerPage} 
                  />
                </>
              )}

              {statementData.dhar.length > 0 && (
                <>
                  <div className="table-responsive" style={{ marginBottom: "1.5rem" }}>
                    <h3 style={{ marginBottom: "0.5rem", fontSize: "1rem", color: "var(--color-text)" }}>DHAR Work</h3>
                    <table className="pro-table" style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Lot</th>
                          <th>Class</th>
                          <th>WT</th>
                          <th>Slab</th>
                          <th>Rate</th>
                          <th>Salary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statementData.dhar.slice((pageDhar - 1) * itemsPerPage, pageDhar * itemsPerPage).map(d => (
                          <tr key={`d-${d.id}`}>
                            <td className="mono">{d.issue_date}</td>
                            <td>{d.lot_id}</td>
                            <td>{d.shape_classification.replace("_", " ")}</td>
                            <td className="mono">{d.weight}</td>
                            <td><span className="badge badge-amber">{d.weight_slab === "GTE_2" ? "≥ 2.00" : "< 2.00"}</span></td>
                            <td className="mono">{d.rate_snapshot !== null ? `₹${d.rate_snapshot}` : '-'}</td>
                            <td className="mono">₹{Number(d.calculated_salary).toLocaleString("en-IN")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination 
                    currentPage={pageDhar} 
                    totalItems={statementData.dhar.length} 
                    itemsPerPage={itemsPerPage} 
                    onPageChange={setPageDhar} 
                    onItemsPerPageChange={setItemsPerPage} 
                  />
                </>
              )}

              {statementData.totalLots === 0 && (
                <div className="empty-state" style={{ padding: "1rem 0" }}>No work recorded in this period.</div>
              )}

            </div>
          ) : null}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
