"use client";
import RoleGate from "@/components/RoleGate";
import { MANAGER_ROLES } from "@/lib/roles";

export default function FantacyIssueAlertPage() {
  return (
    <RoleGate roles={["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES]} permission="manage_fantacy">
      <div className="card">
        <div className="card-body" style={{ minHeight: 160 }} />
      </div>
    </RoleGate>
  );
}
