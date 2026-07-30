"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import Sidebar from "./Sidebar";
import TopHeader from "./TopHeader";

export default function AppShell({ children }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  if (loading) return null;
  if (!user || pathname === "/login") return <>{children}</>;

  return (
    <div className={`app-layout ${isSidebarCollapsed ? "collapsed" : ""}`}>
      <Sidebar isSidebarCollapsed={isSidebarCollapsed} onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)} />
      
      <button 
        className="sidebar-toggle-tab" 
        onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isSidebarCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}>
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>

      <TopHeader onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)} isSidebarCollapsed={isSidebarCollapsed} />
      <main className="main-content">{children}</main>
    </div>
  );
}
