"use client";
import RoleGate from "@/components/RoleGate";

export default function ReConsilationPage() {
  return (
    <RoleGate roles={["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"]}>
      <div className="card">
        <div className="card-body" style={{ minHeight: 160 }} />
      </div>
    </RoleGate>
  );
}
