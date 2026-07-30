"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useTheme } from "@/lib/ThemeContext";
import { useGlobalPeriod } from "@/lib/PeriodContext";
import { useSubscribe } from "@/lib/RefreshContext";
import { api } from "@/lib/api";
import { roleLabel } from "@/lib/roles";

const TITLES = {
  "/": "Dashboard",
  "/employees": "Employee Management",
  "/polish": "Polish Entries",
  "/lot-status": "Lot Status",
  "/dhar": "DHAR Entries",
  "/maxi": "MAXI Entries",
  "/fantacy/stock": "Fantacy Stock",
  "/fantacy/data-fetch": "Fantacy Data Fetch",
  "/fantacy/issue-alert": "Fantacy Issue Alert",
  "/fantacy/return-alert": "Fantacy Return Alert",
  "/verification": "Verification",
  "/rates": "Rate Management",
  "/periods": "Period Management",
  "/re-consilation": "Re-consilation",
  "/master-data": "Master Data",
  "/users": "User Management",
  "/admin": "Super Admin Panel",
  "/historical-data": "Historical Data",
  "/portal": "My Payable",
  "/account": "Manage Account",
};

const NOTIF_POLL_MS = 15000;

function PeriodPicker({ periods, activePeriodId, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const ref = useRef(null);

  const activePeriod = periods.find((period) => String(period.id) === String(activePeriodId)) || periods[0];

  useEffect(() => {
    function handleClick(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredPeriods = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return periods.filter((period) => {
      const matchesQuery = !normalizedQuery || `${period.name} ${period.status}`.toLowerCase().includes(normalizedQuery);
      const matchesStatus = statusFilter === "ALL" || period.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [periods, query, statusFilter]);

  const openPeriods = filteredPeriods.filter((period) => period.status === "OPEN");
  const closedPeriods = filteredPeriods.filter((period) => period.status !== "OPEN");

  function selectPeriod(period) {
    onChange(Number(period.id));
    setOpen(false);
    setQuery("");
  }

  function renderPeriod(period) {
    const selected = String(period.id) === String(activePeriodId);
    return (
      <button
        key={period.id}
        type="button"
        className={`period-picker-item${selected ? " active" : ""}`}
        onClick={() => selectPeriod(period)}
      >
        <span>
          <span className="period-picker-name">{period.name}</span>
          <span className={`badge ${period.status === "OPEN" ? "badge-emerald" : "badge-gray"}`}>{period.status === "OPEN" ? "Open" : "Closed"}</span>
        </span>
        {selected && <span className="period-picker-check">✓</span>}
      </button>
    );
  }

  return (
    <div className="period-picker" ref={ref}>
      <button type="button" className="period-picker-trigger" onClick={() => setOpen((value) => !value)}>
        <span>{activePeriod ? `${activePeriod.name} ${activePeriod.status === "OPEN" ? "(Open)" : "(Closed)"}` : "Select Period"}</span>
        <svg className={`period-picker-chevron${open ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      {open && (
        <div className="period-picker-menu">
          <div className="period-picker-search-wrap">
            <input
              className="form-input period-picker-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search month or year..."
              autoFocus
            />
          </div>
          <div className="period-picker-filters">
            {[
              ["ALL", "All"],
              ["OPEN", "Open"],
              ["CLOSED", "Closed"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`period-picker-filter${statusFilter === value ? " active" : ""}`}
                onClick={() => setStatusFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="period-picker-list">
            {openPeriods.length > 0 && (
              <>
                <div className="period-picker-section">Open Periods</div>
                {openPeriods.map(renderPeriod)}
              </>
            )}
            {closedPeriods.length > 0 && (
              <>
                <div className="period-picker-section">Closed Periods</div>
                {closedPeriods.map(renderPeriod)}
              </>
            )}
            {filteredPeriods.length === 0 && <div className="period-picker-empty">No periods found.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TopHeader({ onToggleSidebar, isSidebarCollapsed }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { periods, activePeriodId, setActivePeriodId } = useGlobalPeriod();

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const notifRef = useRef(null);
  const profileRef = useRef(null);

  // MPS 18 "Notifications & Action Center": a live count derived from
  // existing data (pending verification, rate-missing entries), not a
  // stored event log -- see backend/routes/notifications.js.
  const canSeeNotifications = user && user.role !== "EMPLOYEE";

  const loadNotifications = useCallback(() => {
    if (!canSeeNotifications) return;
    const url = `/notifications${activePeriodId ? `?period_id=${activePeriodId}` : ""}`;
    api.get(url).then((data) => setNotifItems(data.items)).catch(() => {});
  }, [canSeeNotifications, activePeriodId]);

  useEffect(() => {
    if (!canSeeNotifications) return;
    loadNotifications();
    const interval = setInterval(loadNotifications, NOTIF_POLL_MS);
    return () => clearInterval(interval);
  }, [canSeeNotifications, loadNotifications]);

  // Instantly refresh notifications when any page broadcasts a data change
  useSubscribe("notifications", loadNotifications);

  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (!user || pathname === "/login") return null;

  const title = TITLES[pathname] || Object.entries(TITLES).find(([p]) => p !== "/" && pathname.startsWith(p))?.[1] || "";
  const initial = user.name ? user.name.charAt(0).toUpperCase() : "U";

  return (
    <header className="top-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>{TITLES[pathname] || "Dashboard"}</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {pathname === "/historical-data" ? (
          <span className="badge badge-blue" style={{ fontSize: "13px", padding: "6px 12px", fontWeight: 600 }}>
            All Historical Archive
          </span>
        ) : (
          periods && periods.length > 0 && user.role !== "EMPLOYEE" && (
            <PeriodPicker periods={periods} activePeriodId={activePeriodId} onChange={setActivePeriodId} />
          )
        )}

        <button className="header-icon-btn" onClick={toggleTheme} title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}>
          {theme === "light" ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {canSeeNotifications && (
          <div className="header-dropdown-wrap" ref={notifRef}>
            <button className="header-icon-btn" style={{ position: 'relative' }} onClick={() => setNotifOpen((v) => !v)} title="Notifications">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {notifItems.length > 0 && (
                <span className="header-badge-num">
                  {notifItems.length}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="header-dropdown" style={{ width: 340 }}>
                <div className="header-dropdown-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Action Center</span>
                  {notifItems.length > 0 && (
                    <span className="badge badge-blue">{notifItems.length} Pending</span>
                  )}
                </div>
                {notifItems.length === 0 ? (
                  <div className="header-dropdown-empty">You&apos;re all caught up! No pending actions.</div>
                ) : (
                  notifItems.map((n) => (
                    <div key={n.id} className="notif-item" onClick={() => { setNotifOpen(false); router.push(n.href); }}>
                      <span className={`notif-dot ${n.severity}`} />
                      <span style={{ fontSize: 13, lineHeight: 1.4 }}>{n.message}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <div className="header-dropdown-wrap" ref={profileRef}>
          <button className="header-avatar" onClick={() => setProfileOpen((v) => !v)} title={user.name}>{initial}</button>
          {profileOpen && (
            <div className="header-dropdown" style={{ width: 240 }}>
              <div className="profile-menu-header">
                <div className="profile-menu-name">{user.name}</div>
                <div className="profile-menu-email">{user.email}</div>
                <span className="badge badge-blue" style={{ marginTop: 6 }}>{roleLabel(user.role)}</span>
              </div>
              <div className="profile-menu-item" onClick={() => { setProfileOpen(false); router.push("/account"); }}>
                Manage Account
              </div>
              <div className="profile-menu-item danger" onClick={logout}>
                Sign out
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
