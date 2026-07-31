"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import RoleGate from "@/components/RoleGate";
import { fantacyDepartmentName, STAFF_ROLES } from "@/lib/roles";
import { useAuth } from "@/lib/AuthContext";
import { useGlobalPeriod } from "@/lib/PeriodContext";
import { exportToExcel } from "@/lib/exportHelper";
import Pagination from "@/components/Pagination";
import { normalizeDepartment, getRecordDepartment } from "@/lib/fantacyDeptMapper";
import { isSyntheticRecord, stockRecordKey } from "@/lib/fantacyStockFilter";

const DB_NAME = "FantacyStockStoreDB";
const STORE_NAME = "stock_data";
// MUST stay in lockstep with the same constants in /fantacy/data-fetch: both
// pages share this database and store. If they disagree, each page treats the
// other's cache as stale and wipes it, so the two thrash on every navigation.
const CACHE_VERSION = "v20_dept_1_17";
const CACHE_META_KEY = "cache_meta_v20";

function openStockDB() {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.indexedDB) return resolve(null);
    try {
      const req = window.indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function loadCacheFromIndexedDB() {
  try {
    const db = await openStockDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(CACHE_META_KEY);
      req.onsuccess = async () => {
        const meta = req.result;
        if (!meta || !meta.count) return resolve(null);

        const items = [];
        const CHUNK_SIZE = 50000;
        for (let i = 0; i < meta.count; i += CHUNK_SIZE) {
          const chunkReq = store.get(`cache_chunk_${i / CHUNK_SIZE}`);
          const chunkData = await new Promise((r) => {
            chunkReq.onsuccess = () => r(chunkReq.result || []);
            chunkReq.onerror = () => r([]);
          });
          items.push(...chunkData);
        }
        resolve({ items, lastFetchedTime: meta.lastFetchedTime, source: meta.source });
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function saveCacheToIndexedDB(dataArray, lastFetchedTime) {
  if (typeof window === "undefined") return;
  openStockDB().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();

      store.put(
        {
          version: CACHE_VERSION,
          count: dataArray.length,
          lastFetchedTime: lastFetchedTime || Date.now(),
          source: "historical_upsert",
        },
        CACHE_META_KEY
      );

      const CHUNK_SIZE = 50000;
      for (let i = 0; i < dataArray.length; i += CHUNK_SIZE) {
        store.put(dataArray.slice(i, i + CHUNK_SIZE), `cache_chunk_${i / CHUNK_SIZE}`);
      }
    } catch (err) {
      console.warn("IndexedDB save failed:", err);
    }
  });
}

function upsertStockRecords(existingItems = [], incomingItems = []) {
  const map = new Map();

  for (const item of existingItems) {
    if (!item) continue;
    const key = stockRecordKey(item) || String(item.LotID || item.Stock_ID || item.DocID || "");
    if (key) map.set(key, item);
  }

  for (const item of incomingItems) {
    if (!item) continue;
    const key = stockRecordKey(item) || String(item.LotID || item.Stock_ID || item.DocID || "");
    if (key) map.set(key, item);
  }

  return Array.from(map.values());
}

function getStockRecordDate(item) {
  if (!item || typeof item !== "object") return "";
  const rawDate =
    item.ProcessSendDate ||
    item.PreviousProcessRtnDate ||
    item.DocDate ||
    item.SendDate ||
    item.Date ||
    "";
  if (!rawDate) return "";
  const str = String(rawDate).trim();
  if (str.length >= 10 && str.charAt(4) === "-" && str.charAt(7) === "-") {
    return str.slice(0, 10);
  }
  const dmY = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (dmY) {
    const [, d, m, y] = dmY;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return str.slice(0, 10);
}

export default function HistoricalDataPage() {
  const { user, departmentAccess } = useAuth();
  const { activePeriodId, setActivePeriodId, periods } = useGlobalPeriod();
  const [dataArray, setDataArray] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // View Options & Filters
  const [selectedPeriodId, setSelectedPeriodId] = useState("ALL");
  const [viewPreset, setViewPreset] = useState("ALL");
  const [compactDensity, setCompactDensity] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("ALL");
  const [shapeFilter, setShapeFilter] = useState("ALL");
  const [colorFilter, setColorFilter] = useState("ALL");
  const [clarityFilter, setClarityFilter] = useState("ALL");
  const [labFilter, setLabFilter] = useState("ALL");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 150);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Sorting & Pagination
  const [sortField, setSortField] = useState("DocDate");
  const [sortAsc, setSortAsc] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(100);

  const managerScopedDepartments = useMemo(() => {
    if (!user || user.role === "SUPER_ADMIN") return [];
    if ((departmentAccess || []).includes("ALL")) return [];
    return (departmentAccess || []).map(fantacyDepartmentName).filter(Boolean);
  }, [user?.role, departmentAccess]);

  const managerScopeKeys = useMemo(
    () => managerScopedDepartments.map(normalizeDepartment).filter(Boolean),
    [managerScopedDepartments]
  );

  const isAllowedForManager = useCallback(
    (item) => {
      if (!managerScopeKeys.length) return true;
      return managerScopeKeys.includes(getRecordDepartment(item));
    },
    [managerScopeKeys]
  );

  const fetchStockData = useCallback(async () => {
    setLoading(true);
    setError(null);

    // 1. Try loading cached items from IndexedDB
    let currentDataset = [];
    const cached = await loadCacheFromIndexedDB();
    if (cached && cached.items && cached.items.length > 0) {
      currentDataset = cached.items;
      setDataArray(currentDataset);
      setLastUpdated(cached.lastFetchedTime ? new Date(cached.lastFetchedTime) : new Date());
      setLoading(false);
    }

    // 2. Fetch fresh dataset from API and perform cumulative upsert
    try {
      const params = new URLSearchParams({
        skip: "0",
        take: "5000",
        _t: String(Date.now()),
      });
      if (managerScopeKeys.length) params.set("departments", managerScopeKeys.join(","));

      const res = await fetch(`/api/fantacy-stock?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.records || json.data)) {
        const incoming = json.records || json.data;
        // Cumulative upsert: preserve past records, replace matching keys, never duplicate
        const merged = upsertStockRecords(currentDataset, incoming);
        setDataArray(merged);
        const now = Date.now();
        setLastUpdated(new Date(now));
        saveCacheToIndexedDB(merged, now);
      } else if (json.error) {
        if (!cached || cached.items.length === 0) {
          setError(json.error);
        }
      }
    } catch (err) {
      if (!cached || cached.items.length === 0) {
        setError(err.message || "Failed to load historical stock records.");
      }
    } finally {
      setLoading(false);
    }
  }, [managerScopeKeys]);

  useEffect(() => {
    fetchStockData();
  }, [fetchStockData]);

  const handlePeriodChange = (newPeriodId) => {
    setSelectedPeriodId(newPeriodId);
    if (newPeriodId !== "ALL" && setActivePeriodId) {
      setActivePeriodId(newPeriodId);
    }
    setCurrentPage(1);
  };

  // Selected Period Object
  const selectedPeriod = useMemo(() => {
    if (selectedPeriodId === "ALL") return null;
    return periods?.find((p) => String(p.id) === String(selectedPeriodId)) || null;
  }, [periods, selectedPeriodId]);

  // Active dataset filtered by manager department scope and selected period
  const activeDataset = useMemo(() => {
    return dataArray.filter((item) => {
      if (managerScopeKeys.length && !isAllowedForManager(item)) return false;
      if (selectedPeriod?.start_date && selectedPeriod?.end_date) {
        const pStart = String(selectedPeriod.start_date).slice(0, 10);
        const pEnd = String(selectedPeriod.end_date).slice(0, 10);
        const itemDate = getStockRecordDate(item);
        if (!itemDate || itemDate < pStart || itemDate > pEnd) return false;
      }
      return true;
    });
  }, [dataArray, selectedPeriod, managerScopeKeys, isAllowedForManager]);

  // Dynamic Options for Dropdowns
  const departmentOptions = useMemo(() => {
    const set = new Set();
    activeDataset.forEach((item) => {
      const d = item.DepartmentAccountName || item.Department;
      if (d) set.add(String(d));
    });
    return Array.from(set).sort();
  }, [activeDataset]);

  const shapeOptions = useMemo(() => {
    const set = new Set();
    activeDataset.forEach((item) => (item.ShapeID || item.ShapeName || item.EstimateShapeID) && set.add(String(item.ShapeID || item.ShapeName || item.EstimateShapeID)));
    return Array.from(set).sort();
  }, [activeDataset]);

  const colorOptions = useMemo(() => {
    const set = new Set();
    activeDataset.forEach((item) => (item.ColorID || item.ColorName || item.EstimateColorID) && set.add(String(item.ColorID || item.ColorName || item.EstimateColorID)));
    return Array.from(set).sort();
  }, [activeDataset]);

  const clarityOptions = useMemo(() => {
    const set = new Set();
    activeDataset.forEach((item) => (item.ClarityID || item.ClarityName || item.EstimateClarityID) && set.add(String(item.ClarityID || item.ClarityName || item.EstimateClarityID)));
    return Array.from(set).sort();
  }, [activeDataset]);

  const labOptions = useMemo(() => {
    const set = new Set();
    activeDataset.forEach((item) => {
      const l = item.LabAccountName || item.Lab || item.LabName;
      if (l) set.add(String(l));
    });
    return Array.from(set).sort();
  }, [activeDataset]);

  // Filtered dataset
  const filteredData = useMemo(() => {
    return activeDataset.filter((item) => {
      if (departmentFilter !== "ALL") {
        const itemDeptNorm = getRecordDepartment(item);
        const filterDeptNorm = normalizeDepartment(departmentFilter);
        if (!itemDeptNorm || itemDeptNorm !== filterDeptNorm) return false;
      }
      if (shapeFilter !== "ALL") {
        const val = String(item.ShapeID || item.ShapeName || item.EstimateShapeID || "");
        if (val !== shapeFilter) return false;
      }
      if (colorFilter !== "ALL") {
        const val = String(item.ColorID || item.ColorName || item.EstimateColorID || "");
        if (val !== colorFilter) return false;
      }
      if (clarityFilter !== "ALL") {
        const val = String(item.ClarityID || item.ClarityName || item.EstimateClarityID || "");
        if (val !== clarityFilter) return false;
      }
      if (labFilter !== "ALL") {
        const val = String(item.LabAccountName || item.Lab || item.LabName || "");
        if (val !== labFilter) return false;
      }
      if (fromDateFilter || toDateFilter) {
        const itemDateStr = getStockRecordDate(item);
        if (itemDateStr) {
          if (fromDateFilter && itemDateStr < fromDateFilter) return false;
          if (toDateFilter && itemDateStr > toDateFilter) return false;
        }
      }
      if (debouncedSearchTerm.trim()) {
        const term = debouncedSearchTerm.toLowerCase();
        const searchableText = [
          item.Stock_ID,
          item.LotID,
          item.LotName,
          item.DepartmentAccountName,
          item.EstimateShapeID,
          item.EstimateColorID,
          item.EstimateClarityID,
          item.ProcessName,
          item.ProcessID,
          item.ExternalSourceLotRemark,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!searchableText.includes(term)) return false;
      }
      return true;
    });
  }, [activeDataset, departmentFilter, shapeFilter, colorFilter, clarityFilter, labFilter, fromDateFilter, toDateFilter, debouncedSearchTerm]);

  // Sorted dataset
  const sortedData = useMemo(() => {
    if (sortField === "DocDate" && !sortAsc) return filteredData;
    return [...filteredData].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (valA === undefined || valA === null) valA = "";
      if (valB === undefined || valB === null) valB = "";

      if (typeof valA === "number" && typeof valB === "number") {
        return sortAsc ? valA - valB : valB - valA;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();

      if (strA < strB) return sortAsc ? -1 : 1;
      if (strA > strB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortField, sortAsc]);

  // Paginated dataset
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedData.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedData, currentPage, itemsPerPage]);

  // KPI Metrics Calculation
  const kpis = useMemo(() => {
    let totalCarats = 0;
    let totalPcs = 0;

    filteredData.forEach((item) => {
      const wt = parseFloat(item.Weight || item.EstimateWeight) || 0;
      const qty = parseInt(item.Quantity, 10) || 1;
      totalCarats += wt;
      totalPcs += qty;
    });

    const avgWeight = totalPcs > 0 ? (totalCarats / totalPcs).toFixed(3) : "0.000";

    return {
      totalLots: filteredData.length,
      totalCarats: totalCarats.toFixed(2),
      totalPcs: totalPcs,
      avgWeight: avgWeight,
      isFiltered: filteredData.length !== dataArray.length,
    };
  }, [filteredData, dataArray.length]);

  // Columns Mapping
  const requestedColumns = [
    { key: "ItemTypeID", label: "Item Type ID", minWidth: "130px" },
    { key: "SerieID", label: "Serie ID", minWidth: "100px" },
    { key: "Quantity", label: "Qty", minWidth: "70px", align: "center" },
    { key: "ExternalSourceLotRemark", label: "External Notes", minWidth: "180px" },
    { key: "LotName", label: "Lot Name", minWidth: "130px", isBold: true },
    { key: "LotID", label: "Lot ID", minWidth: "110px", isBold: true },
    { key: "EstimateWeight", label: "Est. Weight", minWidth: "100px", align: "right" },
    { key: "Weight", label: "Weight", minWidth: "95px", align: "right" },
    { key: "ProductionStatusID", label: "Production Status", minWidth: "150px" },
    { key: "DepartmentAccountName", label: "Department Account Name", minWidth: "170px" },
    { key: "EstimateShapeID", label: "Est. Shape ID", minWidth: "130px" },
    { key: "ProcessID", label: "Process Name", minWidth: "130px" },
    { key: "LocationAccountName", label: "Location Account Name", minWidth: "160px" },
    { key: "EstimateColorID", label: "Est. Color ID", minWidth: "100px" },
    { key: "EstimateClarityID", label: "Est. Clarity ID", minWidth: "110px" },
    { key: "EstimateQualityID", label: "Est. Quality ID", minWidth: "110px" },
    { key: "ProcessSendDate", label: "Process Send Date", minWidth: "140px" },
    { key: "PreviousProcessRtnDate", label: "Previous Process Rtn Date", minWidth: "160px" },
    { key: "TB209", label: "New Design (TB209)", minWidth: "150px" },
    { key: "LotMeasurements1", label: "M1", minWidth: "75px", align: "right" },
    { key: "LotMeasurements2", label: "M2", minWidth: "75px", align: "right" },
    { key: "LotMeasurements3", label: "M3", minWidth: "75px", align: "right" },
    { key: "TB401", label: "Table", minWidth: "85px", align: "right" },
    { key: "TB104ID", label: "Stone Level", minWidth: "100px" },
    { key: "PreviousLocationAccountName", label: "Previous Location Account Name", minWidth: "190px" },
    { key: "PreviousProcessReturnStatusID", label: "Previous Process Return Status ID", minWidth: "210px" },
  ];

  const primaryKeys = requestedColumns.map((col) => col.key);
  const financialKeys = [
    "LotID", "LotName", "Quantity", "ExternalSourceLotRemark", "EstimateWeight",
    "Weight", "DepartmentAccountName", "LocationAccountName", "ProcessSendDate", "PreviousProcessRtnDate"
  ];

  const columns = useMemo(() => {
    if (viewPreset === "FINANCIAL") {
      return requestedColumns.filter((col) => financialKeys.includes(col.key));
    }
    return requestedColumns;
  }, [viewPreset]);

  const handleSort = (key) => {
    if (sortField === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(key);
      setSortAsc(true);
    }
  };

  const handleExport = () => {
    exportToExcel(sortedData, `Historical_Stock_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const filterControlStyle = {
    width: "100%",
    minWidth: 0,
    height: 34,
    padding: "7px 10px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border-primary)",
    background: "var(--bg-card)",
    color: "var(--text-primary)",
    fontSize: 13,
  };

  const renderCellContent = (row, colKey) => {
    let val = row[colKey];

    if (val === undefined || val === null || val === "") {
      if (colKey === "CompanyID") val = "2139";
      else if (colKey === "CompanyName") val = "Skylab Diamond";
      else if (colKey === "DepartmentAccountName") val = row.DepartmentAccountID || row.Department;
      else if (colKey === "LocationAccountName") val = row.LocationAccountID || row.Location;
      else if (colKey === "ProcessID") val = row.ProcessName || row.Process;
      else if (colKey === "ProductionStatusID") val = row.ProductionStatus || row.Status;
      else if (colKey === "Quantity") val = row.Qty || row.Pcs;
      else if (colKey === "TB104ID") val = row.StoneLevel;
      else if (colKey === "TB401") val = row.Table;
      else if (colKey === "TB209") val = row.NewDesign;
      else if (colKey === "ExternalSourceLotRemark") val = row.ExternalNotes || row.Remark;
    }

    if (val === undefined || val === null || val === "") return <span style={{ color: "var(--text-muted)" }}>-</span>;

    // Status Badges
    if (colKey === "ProductionStatusID") {
      const statusStr = String(val).toUpperCase();
      let badgeClass = "badge-gray";
      if (statusStr.includes("ACTIVE") || statusStr.includes("COMPLET")) badgeClass = "badge-emerald";
      else if (statusStr.includes("IN_PROGRESS") || statusStr.includes("INPROCESS") || statusStr.includes("PROGRESS")) badgeClass = "badge-blue";
      else if (statusStr.includes("PENDING") || statusStr.includes("WAIT")) badgeClass = "badge-amber";
      return <span className={`badge ${badgeClass}`}>{statusStr.replace(/_/g, " ")}</span>;
    }

    if (colKey === "ItemTypeID") {
      const text = String(val).replace(/_/g, " ");
      return <span className="badge badge-gray" style={{ fontWeight: 600 }}>{text}</span>;
    }

    if (colKey === "LotID") {
      return <span style={{ fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.5px" }}>{String(val)}</span>;
    }

    if (colKey === "LotName") {
      return <span style={{ fontWeight: 700, color: "var(--accent-primary)" }}>{String(val)}</span>;
    }

    if (colKey === "ExternalSourceLotRemark") {
      return (
        <div
          title={String(val)}
          style={{
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "12.5px",
            color: "var(--text-secondary)",
          }}
        >
          {String(val)}
        </div>
      );
    }

    if (["Weight", "EstimateWeight", "LotMeasurements1", "LotMeasurements2", "LotMeasurements3", "TB401"].includes(colKey)) {
      const num = parseFloat(val);
      const formatted = !isNaN(num) ? num.toFixed(2) : String(val);
      return (
        <span style={{ fontFamily: "monospace", fontFeatureSettings: '"tnum"', fontWeight: 600, color: "var(--text-primary)" }}>
          {formatted}
        </span>
      );
    }

    if (colKey === "EstimateShapeID") {
      return <span className="badge badge-gray" style={{ fontWeight: 600, background: "var(--gray-100)", color: "var(--text-primary)" }}>{String(val)}</span>;
    }
    if (["EstimateColorID", "EstimateClarityID"].includes(colKey)) {
      return <span className="badge badge-blue" style={{ fontWeight: 700, fontSize: "11px" }}>{String(val)}</span>;
    }

    if (["ProcessSendDate", "PreviousProcessRtnDate"].includes(colKey)) {
      const dateStr = typeof val === "string" ? val.slice(0, 10) : String(val);
      return <span style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{dateStr}</span>;
    }

    return String(val);
  };

  return (
    <RoleGate roles={["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "MANAGER"]} permission={["view_historical_data", "manage_fantacy"]}>
      <div>
        <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1>Historical Stock Data</h1>
            <p>Complete historical archive of all synchronized stock records across all periods.</p>
          </div>
          <div className="page-header-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-secondary" onClick={handleExport} disabled={sortedData.length === 0}>Export</button>
            <button className="btn btn-primary" onClick={fetchStockData} disabled={loading}>{loading ? "Syncing..." : "Refresh Data"}</button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 240 }}>
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: loading ? "var(--accent-primary)" : "var(--green-600)", boxShadow: loading ? "0 0 0 4px var(--accent-primary-light)" : "0 0 0 4px var(--green-50)" }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                  {loading ? "Loading Historical Data..." : "Historical Archive Synchronized"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  {lastUpdated ? `Last updated ${lastUpdated.toLocaleString()}` : "Ready"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="badge badge-emerald">{dataArray.length.toLocaleString()} Total Historical Lots</span>
              <span className="badge badge-blue">{activeDataset.length.toLocaleString()} Selected Scope Lots</span>
              {managerScopedDepartments.length > 0 && <span className="badge badge-gray">{managerScopedDepartments.join(", ")} only</span>}
            </div>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="kpi-grid" style={{ marginBottom: 18 }}>
          <div className="kpi-card"><div className="kpi-label">Total Historical Lots</div><div className="kpi-value">{kpis.totalLots.toLocaleString()}</div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{kpis.isFiltered ? "Filtered historical items" : "Active stock items"}</div></div>
          <div className="kpi-card"><div className="kpi-label">Total WT</div><div className="kpi-value">{kpis.totalCarats} <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>ct</span></div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{kpis.isFiltered ? "Filtered diamond weight" : "Gross diamond weight"}</div></div>
          <div className="kpi-card"><div className="kpi-label">Total Pieces</div><div className="kpi-value">{kpis.totalPcs.toLocaleString()} <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>pcs</span></div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{kpis.isFiltered ? "Filtered stone count" : "Total stone count"}</div></div>
          <div className="kpi-card"><div className="kpi-label">Avg WT / Stone</div><div className="kpi-value">{kpis.avgWeight} <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>ct</span></div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Average carat per stone</div></div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span className="card-title">Filters & View</span>
            <button className="btn btn-secondary btn-sm" onClick={() => { setSearchTerm(""); setSelectedPeriodId("ALL"); setDepartmentFilter("ALL"); setShapeFilter("ALL"); setColorFilter("ALL"); setClarityFilter("ALL"); setLabFilter("ALL"); setFromDateFilter(""); setToDateFilter(""); setCurrentPage(1); }}>Reset Filters</button>
          </div>
          <div className="card-body" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1.35fr) repeat(auto-fit, minmax(150px, 1fr))", columnGap: 12, rowGap: 10, alignItems: "center" }}>
              <input className="input" type="text" placeholder="Search lot, certificate, process, department..." value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setCurrentPage(1); }} style={filterControlStyle} />
              <select className="input" value={selectedPeriodId} onChange={(event) => handlePeriodChange(event.target.value)} style={filterControlStyle}>
                <option value="ALL">All Periods ({periods?.length || 0})</option>
                {periods?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select className="input" value={departmentFilter} onChange={(event) => { setDepartmentFilter(event.target.value); setCurrentPage(1); }} style={filterControlStyle}><option value="ALL">All Departments ({departmentOptions.length})</option>{departmentOptions.map((department) => <option key={department} value={department}>{department}</option>)}</select>
              <select className="input" value={shapeFilter} onChange={(event) => { setShapeFilter(event.target.value); setCurrentPage(1); }} style={filterControlStyle}><option value="ALL">All Shapes ({shapeOptions.length})</option>{shapeOptions.map((shape) => <option key={shape} value={shape}>{shape}</option>)}</select>
              <select className="input" value={colorFilter} onChange={(event) => { setColorFilter(event.target.value); setCurrentPage(1); }} style={filterControlStyle}><option value="ALL">All Colors ({colorOptions.length})</option>{colorOptions.map((color) => <option key={color} value={color}>{color}</option>)}</select>
              <select className="input" value={clarityFilter} onChange={(event) => { setClarityFilter(event.target.value); setCurrentPage(1); }} style={filterControlStyle}><option value="ALL">All Clarities ({clarityOptions.length})</option>{clarityOptions.map((clarity) => <option key={clarity} value={clarity}>{clarity}</option>)}</select>
              <select className="input" value={labFilter} onChange={(event) => { setLabFilter(event.target.value); setCurrentPage(1); }} style={filterControlStyle}><option value="ALL">All Labs ({labOptions.length})</option>{labOptions.map((lab) => <option key={lab} value={lab}>{lab}</option>)}</select>
              <input className="input" type="date" value={fromDateFilter} onChange={(event) => { setFromDateFilter(event.target.value); setCurrentPage(1); }} title="From Date" style={filterControlStyle} />
              <input className="input" type="date" value={toDateFilter} onChange={(event) => { setToDateFilter(event.target.value); setCurrentPage(1); }} title="To Date" style={filterControlStyle} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["PRIMARY", "FINANCIAL", "ALL"].map((preset) => <button key={preset} className={`btn btn-sm ${viewPreset === preset ? "btn-primary" : "btn-secondary"}`} onClick={() => setViewPreset(preset)}>{preset === "PRIMARY" ? "Standard" : preset === "FINANCIAL" ? "Financial" : "All Fields"}</button>)}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setCompactDensity(!compactDensity)}>{compactDensity ? "Comfortable Density" : "Compact Density"}</button>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Historical Stock Records</span><span className="badge badge-gray">Showing {sortedData.length.toLocaleString()} records</span></div>
          <div className="table-responsive" style={{ maxHeight: "calc(100vh - 280px)", overflow: "auto" }}>
            <table className={`pro-table ${compactDensity ? "table-compact" : ""}`} style={{ width: "100%", tableLayout: "auto" }}>
              <thead>
                <tr>
                  <th style={{ width: "50px", textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "var(--bg-card)", borderBottom: "2px solid var(--border-primary)", whiteSpace: "nowrap" }}>#</th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{
                        minWidth: col.minWidth,
                        textAlign: col.align || "left",
                        cursor: "pointer",
                        userSelect: "none",
                        position: "sticky",
                        top: 0,
                        zIndex: 10,
                        background: "var(--bg-card)",
                        borderBottom: "2px solid var(--border-primary)",
                        whiteSpace: "nowrap",
                        padding: compactDensity ? "8px 10px" : "11px 14px",
                      }}
                    >
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", width: "100%", justifyContent: col.align === "right" ? "flex-end" : col.align === "center" ? "center" : "flex-start" }}>
                        <span>{col.label}</span>
                        <span style={{ fontSize: "11px", opacity: sortField === col.key ? 1 : 0.35, color: sortField === col.key ? "var(--accent-primary)" : "inherit" }}>
                          {sortField === col.key ? (sortAsc ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedData.length > 0 ? (
                  paginatedData.map((row, idx) => (
                    <tr key={row.Stock_ID || row.LotID || idx}>
                      <td style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "12px", fontFamily: "monospace", padding: compactDensity ? "6px 10px" : "9px 14px" }}>
                        {(currentPage - 1) * itemsPerPage + idx + 1}
                      </td>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          style={{
                            textAlign: col.align || "left",
                            padding: compactDensity ? "6px 10px" : "9px 14px",
                            verticalAlign: "middle",
                          }}
                        >
                          {renderCellContent(row, col.key)}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={columns.length + 1} style={{ textAlign: "center", padding: "48px 16px", color: "var(--text-secondary)" }}>
                      {loading ? "Loading historical stock records..." : "No matching historical stock records found."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination totalItems={sortedData.length} itemsPerPage={itemsPerPage} currentPage={currentPage} onPageChange={(page) => setCurrentPage(page)} onItemsPerPageChange={(count) => { setItemsPerPage(count); setCurrentPage(1); }} />
        </div>
      </div>
    </RoleGate>
  );
}
