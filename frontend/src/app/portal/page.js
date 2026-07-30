"use client";
import { Fragment, useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { DropdownMenu, DropdownItem } from "@/components/Dropdown";
import RoleGate from "@/components/RoleGate";
import { api } from "@/lib/api";
import LedgerModal from "@/components/LedgerModal";
import Pagination from "@/components/Pagination";

function PortalInner() {
  const [me, setMe] = useState(null);
  const [payable, setPayable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statementPeriod, setStatementPeriod] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  useEffect(() => {
    Promise.all([api.get("/portal/me"), api.get("/portal/payable")])
      .then(([m, p]) => { setMe(m); setPayable(p); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-state">Loading...</div>;

  const paginatedPayable = payable.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div>
      {payable.length === 0 ? (
        <div className="empty-state">No finalized payable records yet.</div>
      ) : (
        <div className="card">
          <div className="card-body table-responsive">
            <table className="pro-table">
              <thead><tr><th>Period</th><th>Total</th><th>Finalized</th><th></th></tr></thead>
              <tbody>
                {paginatedPayable.map((p) => (
                  <Fragment key={p.period_name}>
                    <tr>
                      <td style={{ fontWeight: 500 }}>{p.period_name}</td>
                      <td className="mono">₹{Number(p.final_snapshot_total).toLocaleString("en-IN")}</td>
                      <td className="mono">{new Date(p.accounts_verified_at).toLocaleDateString()}</td>
                      <td style={{ textAlign: "right" }}>
                        <DropdownMenu>
                          <DropdownItem onClick={() => setStatementPeriod(p)}>View Ledger</DropdownItem>
                        </DropdownMenu>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination 
            currentPage={currentPage} 
            totalItems={payable.length} 
            itemsPerPage={itemsPerPage} 
            onPageChange={setCurrentPage} 
            onItemsPerPageChange={setItemsPerPage} 
          />
        </div>
      )}

      {statementPeriod && (
        <LedgerModal
          employee={{ id: me.employee_id, name: me.name }}
          periodId={statementPeriod.period_id}
          periodName={statementPeriod.period_name}
          isManagerOnly={false}
          onClose={() => setStatementPeriod(null)}
        />
      )}
    </div>
  );
}

export default function PortalPage() {
  return <RoleGate roles={["EMPLOYEE"]}><PortalInner /></RoleGate>;
}
