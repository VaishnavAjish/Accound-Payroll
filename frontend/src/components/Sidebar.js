import Link from "next/link";
import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { MANAGER_ROLES, STAFF_ROLES } from "@/lib/roles";

// SVG icons styled uniformly as 18x18
const ICONS = {
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1"></rect>
      <rect x="14" y="3" width="7" height="5" rx="1"></rect>
      <rect x="14" y="12" width="7" height="9" rx="1"></rect>
      <rect x="3" y="16" width="7" height="5" rx="1"></rect>
    </svg>
  ),
  polish: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12l4 6-10 12L2 9z"></path>
    </svg>
  ),
  dhar: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.7 10.3L12 21l9.3-10.7L16 3H8l-5.3 7.3zM12 3v18M2.7 10.3h18.6M8 3l4 7.3 4-7.3"></path>
    </svg>
  ),
  maxi: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
      <polygon points="2 17 12 22 22 17"></polygon>
      <polygon points="2 12 12 17 22 12"></polygon>
    </svg>
  ),
  lotStatus: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l2 2 4-4"></path>
      <path d="M9 17l2 2 4-4"></path>
      <path d="M5 7h14"></path>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    </svg>
  ),
  production: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18"></path>
      <path d="M5 21V8l6 4V8l6 4V5h2v16"></path>
      <path d="M8 17h1"></path>
      <path d="M12 17h1"></path>
      <path d="M16 17h1"></path>
    </svg>
  ),
  fantacy: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84-5.4 2.84 1.03-6L3.27 9.35l6.03-.88L12 3z"></path>
    </svg>
  ),
  stock: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
      <path d="M3.3 7L12 12l8.7-5"></path>
      <path d="M12 22V12"></path>
    </svg>
  ),
  issueAlert: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
      <path d="M12 9v4"></path>
      <path d="M12 17h.01"></path>
    </svg>
  ),
  returnAlert: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14l-4-4 4-4"></path>
      <path d="M5 10h11a4 4 0 0 1 0 8h-1"></path>
      <path d="M19 4v4"></path>
      <path d="M19 12h.01"></path>
    </svg>
  ),
  dataFetch: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <path d="M7 10l5 5 5-5"></path>
      <path d="M12 15V3"></path>
    </svg>
  ),
  payroll: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2"></rect>
      <path d="M3 10h18"></path>
      <path d="M7 15h4"></path>
      <path d="M15 15h2"></path>
    </svg>
  ),
  management: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="14" rx="2"></rect>
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <path d="M3 13h18"></path>
    </svg>
  ),
  administration: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
      <path d="M9 12l2 2 4-4"></path>
    </svg>
  ),
  account: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4"></circle>
      <path d="M4 21a8 8 0 0 1 16 0"></path>
    </svg>
  ),
  verification: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
  ),
  rates: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h12M6 9h12M6 4a5 5 0 0 1 0 10H6M6 14l9 8"></path>
    </svg>
  ),
  periods: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>
  ),
  reconciliation: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h13a4 4 0 0 1 0 8H7"></path>
      <path d="M7 11l-4-4 4-4"></path>
      <path d="M21 17H8a4 4 0 0 1 0-8h9"></path>
      <path d="M17 13l4 4-4 4"></path>
    </svg>
  ),
  employees: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
  ),
  masterData: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="12" x2="2" y2="12"></line>
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
      <line x1="6" y1="16" x2="6.01" y2="16"></line>
      <line x1="10" y1="16" x2="10.01" y2="16"></line>
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  ),
  myPayable: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
      <line x1="1" y1="10" x2="23" y2="10"></line>
    </svg>
  ),
  admin: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="3" y1="9" x2="21" y2="9"></line>
      <line x1="9" y1="21" x2="9" y2="9"></line>
    </svg>
  ),
  historicalData: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7"></path>
      <path d="M3 4v5h5"></path>
      <path d="M12 7v5l3 2"></path>
    </svg>
  )
};

const NAV = [
  {
    section: "Overview",
    icon: ICONS.dashboard,
    items: [{ label: "Dashboard", href: "/", icon: ICONS.dashboard, roles: STAFF_ROLES, permission: "view_dashboard" }],
  },
  {
    section: "Production",
    icon: ICONS.production,
    items: [
      { label: "Polish", href: "/polish", icon: ICONS.polish, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES], permission: "manage_department_entries" },
      { label: "DHAR", href: "/dhar", icon: ICONS.dhar, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES], permission: "manage_department_entries" },
      { label: "MAXI", href: "/maxi", icon: ICONS.maxi, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES], permission: "manage_maxi" },
      { label: "Lot Status", href: "/lot-status", icon: ICONS.lotStatus, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES], permission: "manage_department_entries" },
    ],
  },
  {
    section: "Fantacy",
    icon: ICONS.fantacy,
    items: [
      { label: "Stock", href: "/fantacy/stock", icon: ICONS.stock, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES], permission: "manage_fantacy" },
      { label: "Data Fetch", href: "/fantacy/data-fetch", icon: ICONS.dataFetch, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES], permission: ["manage_fantacy", "fetch_fantacy_department_data"] },
      { label: "Issue Alert", href: "/fantacy/issue-alert", icon: ICONS.issueAlert, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES], permission: "manage_fantacy" },
      { label: "Return Alert", href: "/fantacy/return-alert", icon: ICONS.returnAlert, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES], permission: "manage_fantacy" },
    ],
  },
  {
    section: "Payroll",
    icon: ICONS.payroll,
    items: [
      { label: "Verification", href: "/verification", icon: ICONS.verification, roles: ["SUPER_ADMIN", "ACCOUNTANT", ...MANAGER_ROLES], permission: "manage_verification" },
      { label: "Periods", href: "/periods", icon: ICONS.periods, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"], permission: "manage_periods" },
      { label: "Re-consilation", href: "/re-consilation", icon: ICONS.reconciliation, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
    ],
  },
  {
    section: "Management",
    icon: ICONS.management,
    items: [
      { label: "Employees", href: "/employees", icon: ICONS.employees, roles: STAFF_ROLES, permission: "manage_employees" },
    ],
  },
  {
    section: "Administration",
    icon: ICONS.administration,
    items: [
      { label: "Admin Panel", href: "/admin", icon: ICONS.admin, roles: ["SUPER_ADMIN"] },
      { label: "Historical Data", href: "/historical-data", icon: ICONS.historicalData, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"], permission: "view_historical_data" },
    ],
  },
  {
    section: "My Account",
    icon: ICONS.account,
    items: [{ label: "My Payable", href: "/portal", icon: ICONS.myPayable, roles: ["EMPLOYEE"] }],
  },
];

export default function Sidebar({ isSidebarCollapsed, onToggleSidebar }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, permissionsLoading, hasPermission } = useAuth();
  const [expandedSections, setExpandedSections] = useState(() => Object.fromEntries(NAV.map((section) => [section.section, true])));
  const [flyoutSection, setFlyoutSection] = useState(null);
  const flyoutCloseTimer = useRef(null);
  if (!user) return null;

  function isActiveHref(href) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  function toggleSection(sectionName) {
    setExpandedSections((current) => ({ ...current, [sectionName]: !current[sectionName] }));
  }

  function navigateTo(href) {
    setFlyoutSection(null);
    router.push(href);
  }

  function openFlyout(sectionName) {
    if (flyoutCloseTimer.current) clearTimeout(flyoutCloseTimer.current);
    setFlyoutSection(sectionName);
  }

  function closeFlyoutSoon() {
    if (flyoutCloseTimer.current) clearTimeout(flyoutCloseTimer.current);
    flyoutCloseTimer.current = setTimeout(() => setFlyoutSection(null), 180);
  }

  return (
    <aside className={`sidebar${isSidebarCollapsed ? " is-collapsed" : ""}`}>
      <div className="sidebar-header" style={{ justifyContent: isSidebarCollapsed ? "center" : "flex-start", padding: isSidebarCollapsed ? "16px 0" : "16px 20px" }}>
        <div className="sidebar-logo">
          <svg width="100%" height="100%" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="16" strokeLinejoin="round" strokeLinecap="round" style={{ width: "65%", height: "65%" }}>
            <polygon points="208,170 304,170 288,228 224,228" fill="rgba(255,255,255,0.25)" />
            <polygon points="160,170 208,170 224,228 112,246" fill="rgba(255,255,255,0.15)" />
            <polygon points="304,170 352,170 400,246 288,228" fill="rgba(255,255,255,0.15)" />
            <polygon points="112,246 224,228 256,382" fill="rgba(255,255,255,0.05)" />
            <polygon points="224,228 288,228 256,382" fill="rgba(255,255,255,0.2)" />
            <polygon points="288,228 400,246 256,382" fill="rgba(255,255,255,0.05)" />
          </svg>
        </div>
        {!isSidebarCollapsed && (
          <div style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden' }}>
            <div className="sidebar-title" style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Account Payroll</div>
            <div className="sidebar-subtitle" style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Production &amp; Payroll</div>
          </div>
        )}
      </div>

      <nav className="sidebar-nav" style={{ padding: isSidebarCollapsed ? "12px 6px" : "12px" }}>
        {NAV.map((section) => {
          const items = section.items.filter((item) => {
            if (!item.roles.includes(user.role)) return false;
            if (user.role === "SUPER_ADMIN") return true;
            if (permissionsLoading) return false;
            return hasPermission(item.permission);
          });
          if (!items.length) return null;
          const isOverview = section.section === "Overview";
          const sectionActive = items.some((item) => isActiveHref(item.href));
          const expanded = !isSidebarCollapsed && expandedSections[section.section];
          const flyoutOpen = isSidebarCollapsed && flyoutSection === section.section;

          if (isOverview) {
            return items.map((item) => {
              const active = isActiveHref(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  className={`nav-item${active ? " active" : ""}`}
                  onClick={() => setFlyoutSection(null)}
                  title={isSidebarCollapsed ? item.label : ""}
                  style={{
                    justifyContent: isSidebarCollapsed ? "center" : "flex-start",
                    padding: isSidebarCollapsed ? "10px 0" : "9px 10px",
                    marginBottom: isSidebarCollapsed ? 8 : 14,
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span className="nav-icon" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {item.icon}
                  </span>
                  {!isSidebarCollapsed && <span>{item.label}</span>}
                </Link>
              );
            });
          }

          return (
            <div
              key={section.section}
              className="nav-feature-wrap"
              onMouseEnter={() => isSidebarCollapsed && openFlyout(section.section)}
              onMouseLeave={() => isSidebarCollapsed && closeFlyoutSoon()}
              style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: isSidebarCollapsed ? 8 : 12, position: "relative" }}
            >
              <div
                className={`nav-item${sectionActive ? " active" : ""}`}
                onClick={() => isSidebarCollapsed ? setFlyoutSection(flyoutOpen ? null : section.section) : toggleSection(section.section)}
                title=""
                style={{
                  justifyContent: isSidebarCollapsed ? "center" : "flex-start",
                  padding: isSidebarCollapsed ? "10px 0" : "9px 10px",
                }}
              >
                <span className="nav-icon" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {section.icon}
                </span>
                {!isSidebarCollapsed && (
                  <>
                    <span>{section.section}</span>
                    <span className={`nav-chevron${expanded ? " open" : ""}`} aria-hidden="true">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18l6-6-6-6"></path>
                      </svg>
                    </span>
                  </>
                )}
              </div>
              {flyoutOpen && (
                <div className="nav-flyout">
                  <div className="nav-flyout-title">{section.section}</div>
                  {items.map((item) => {
                    const active = isActiveHref(item.href);
                    return (
                      <Link key={item.href} href={item.href} prefetch={true} className={`nav-flyout-item${active ? " active" : ""}`} onClick={() => setFlyoutSection(null)} style={{ textDecoration: "none", color: "inherit" }}>
                        <span className="nav-icon">{item.icon}</span>
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
              {items.map((item) => {
                if (!expanded) return null;
                const active = isActiveHref(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    className={`nav-item${active ? " active" : ""}`}
                    onClick={() => setFlyoutSection(null)}
                    title={isSidebarCollapsed ? item.label : ""}
                    style={{
                      justifyContent: isSidebarCollapsed ? "center" : "flex-start",
                      padding: isSidebarCollapsed ? "10px 0" : "8px 10px",
                      marginLeft: isSidebarCollapsed ? 0 : 18,
                      fontSize: isSidebarCollapsed ? undefined : 13,
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <span className="nav-icon" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {item.icon}
                    </span>
                    {!isSidebarCollapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
