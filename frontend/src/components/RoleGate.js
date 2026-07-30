"use client";
import { useAuth } from "@/lib/AuthContext";

export default function RoleGate({ roles = [], permission, children }) {
  const { user, permissionsLoading, hasPermission } = useAuth();
  if (!user) return null;
  
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const hasRole = isSuperAdmin || roles.includes(user.role);
  const allowedByPermission = !permission || isSuperAdmin || (!permissionsLoading && hasPermission(permission));

  if (!hasRole || !allowedByPermission) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Access restricted</div>
        This section isn&apos;t available for your role.
      </div>
    );
  }
  return children;
}
