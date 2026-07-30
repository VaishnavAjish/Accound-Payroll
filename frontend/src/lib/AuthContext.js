"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [departmentAccess, setDepartmentAccess] = useState([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("user") : null;
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (stored && token) {
      try { setUser(JSON.parse(stored)); } catch { /* ignore */ }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) {
      setPermissions({});
      setDepartmentAccess([]);
      setPermissionsLoading(false);
      return;
    }

    let cancelled = false;
    setPermissionsLoading(true);
    api.get("/rbac/me")
      .then((data) => {
        if (!cancelled) {
          setPermissions(data.permissions || {});
          setDepartmentAccess(Array.isArray(data.departmentAccess) ? data.departmentAccess : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPermissions({});
          setDepartmentAccess([]);
        }
      })
      .finally(() => {
        if (!cancelled) setPermissionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (loading) return;
    const isPublic = pathname === "/login";
    if (!user && !isPublic) router.replace("/login");
    if (user && isPublic) router.replace("/");
  }, [user, loading, pathname, router]);

  async function login(email, password) {
    const data = await api.post("/auth/login", { email, password });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setPermissions({});
    setDepartmentAccess([]);
    setUser(null);
    router.replace("/login");
  }

  function hasPermission(permissionKey) {
    if (!permissionKey) return true;
    if (user?.role === "SUPER_ADMIN") return true;
    if (Array.isArray(permissionKey)) return permissionKey.every((key) => Boolean(permissions[key]));
    return Boolean(permissions[permissionKey]);
  }

  return (
    <AuthContext.Provider value={{ user, loading, permissions, departmentAccess, permissionsLoading, hasPermission, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
