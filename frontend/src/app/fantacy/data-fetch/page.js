"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import RoleGate from "@/components/RoleGate";
import { fantacyDepartmentName, STAFF_ROLES } from "@/lib/roles";
import { useAuth } from "@/lib/AuthContext";
import { useGlobalPeriod } from "@/lib/PeriodContext";
import { exportToExcel } from "@/lib/exportHelper";
import Pagination from "@/components/Pagination";
import { loadRunner } from "@/lib/loadRunner";
import { normalizeDepartment, getRecordDepartment } from "@/lib/fantacyDeptMapper";
import { isSyntheticRecord, stockRecordKey } from "@/lib/fantacyStockFilter";

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const AUTO_REFRESH_INTERVAL_SEC = AUTO_REFRESH_INTERVAL_MS / 1000;

// Page size per request. Must not exceed the route's MAX_TAKE (5000).
const PAGE_SIZE = 1000;

// High-performance global store
let globalDataArray = [];
let globalSeenIds = new Set();
let globalLastFetchedTime = 0;
let globalBatchStatusText = "Complete: Stock Synchronized";
let globalFetchFailCount = 0;
let globalDataSource = "live";
const MAX_AUTO_RETRIES = 3;

const DB_NAME = "FantacyStockStoreDB";
const STORE_NAME = "stock_data";

/**
 * Bump on any change to what gets cached or how it is filtered. A mismatch
 * wipes IndexedDB, which is how historic synthetic rows get evicted.
 * v19: live/mock separation, LotID dedupe key, exact department matching.
 * v20: department roster widened to Polish 1-17 + SF-2 (was 1-15), and the
 *      proxy now filters by department upstream. Any v19 cache was written
 *      under the old scope -- it can contain rows from an unfiltered pull and
 *      is missing Polish 16/17 -- so it must be discarded, not merged.
 */
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

/**
 * Persist the cache, replacing it wholesale rather than appending. Synthetic
 * rows are stripped on the way in, and the source + department scope are
 * recorded so a later load can refuse a mismatched cache.
 */
function saveCacheToIndexedDB(dataArray, lastFetchedTime, source, departmentScope) {
  loadRunner.schedule("saveIndexedDB", async () => {
    try {
      const db = await openStockDB();
      if (!db) return;
      const tx = db.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);

      // Full replace: stale chunks from a longer previous sync must not survive.
      store.clear();

      const cleanItems = source === "mock" ? dataArray : dataArray.filter((i) => !isSyntheticRecord(i));

      store.put(
        {
          version: CACHE_VERSION,
          count: cleanItems.length,
          lastFetchedTime,
          source,
          departmentScope: departmentScope || [],
        },
        CACHE_META_KEY
      );

      const CHUNK_SIZE = 50000;
      for (let i = 0; i < cleanItems.length; i += CHUNK_SIZE) {
        store.put(cleanItems.slice(i, i + CHUNK_SIZE), `cache_chunk_${i / CHUNK_SIZE}`);
      }
    } catch (err) {
      console.warn("IndexedDB save failed:", err);
    }
  });
}

/**
 * Load the cache only if it matches the current schema version, the current
 * data source, and the caller's department scope. Any mismatch returns null so
 * the caller re-syncs from the API instead of showing foreign or stale rows.
 */
async function loadCacheFromIndexedDB(expectedSource, departmentScope) {
  try {
    const db = await openStockDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(CACHE_META_KEY);
      req.onsuccess = async () => {
        const meta = req.result;
        if (!meta || !meta.count || meta.version !== CACHE_VERSION) return resolve(null);

        const cachedScope = (meta.departmentScope || []).slice().sort().join(",");
        const wantedScope = (departmentScope || []).slice().sort().join(",");
        if (cachedScope !== wantedScope) return resolve(null);

        const items = [];
        const CHUNK_SIZE = 50000;
        for (let i = 0; i < meta.count; i += CHUNK_SIZE) {
          const chunkReq = store.get(`cache_chunk_${i / CHUNK_SIZE}`);
          const chunkData = await new Promise((r) => {
            chunkReq.onsuccess = () => r(chunkReq.result || []);
            chunkReq.onerror = () => r([]);
          });
          // Belt-and-braces: purge any synthetic row that predates versioning.
          items.push(...chunkData.filter((row) => expectedSource === "mock" || !isSyntheticRecord(row)));
        }
        resolve({ items, lastFetchedTime: meta.lastFetchedTime, source: meta.source });
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function clearCacheFromIndexedDB() {
  try {
    const db = await openStockDB();
    if (!db) return;
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
  } catch (err) {
    console.error("IndexedDB clear error:", err);
  }
}

function formatCountdown(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function AutoFetchCountdownBadge({ onTriggerRefresh }) {
  const [secondsUntilNextFetch, setSecondsUntilNextFetch] = useState(AUTO_REFRESH_INTERVAL_SEC);

  useEffect(() => {
    const timer = setInterval(() => {
      if (globalLastFetchedTime === 0) {
        setSecondsUntilNextFetch(AUTO_REFRESH_INTERVAL_SEC);
        return;
      }
      const elapsed = Date.now() - globalLastFetchedTime;
      const remainingSec = Math.max(0, Math.ceil((AUTO_REFRESH_INTERVAL_MS - elapsed) / 1000));
      setSecondsUntilNextFetch(remainingSec);

      if (remainingSec === 0 && globalFetchFailCount < MAX_AUTO_RETRIES) {
        if (onTriggerRefresh) onTriggerRefresh();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [onTriggerRefresh]);

  return (
    <span className="badge badge-blue">
      Next auto fetch: {formatCountdown(secondsUntilNextFetch)}
    </span>
  );
}

export default function FantacyDataFetchPage() {
  const { user, departmentAccess, permissionsLoading } = useAuth();
  const { activePeriodId, periods } = useGlobalPeriod();
  const canViewSyncControls = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";
  const [dataVersion, setDataVersion] = useState(0);
  const [loading, setLoading] = useState(() => globalDataArray.length === 0);
  const [batchLoading, setBatchLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [batchStatusText, setBatchStatusText] = useState(() => globalBatchStatusText);

  // View Options
  const [filterDepartmentOnly, setFilterDepartmentOnly] = useState(false);
  const [filterByPeriod, setFilterByPeriod] = useState(false);
  const [viewPreset, setViewPreset] = useState("ALL");
  const [compactDensity, setCompactDensity] = useState(false);

  // Filters & Search
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

  /** Manager scope, expressed as canonical department keys. */
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

  const activePeriod = useMemo(
    () => periods.find((period) => String(period.id) === String(activePeriodId)),
    [periods, activePeriodId]
  );

  function getStockRecordDate(item) {
    return normalizeToIsoDate(item.ProcessSendDate || item.DocDate || item.PreviousProcessRtnDate);
  }

  /**
   * Upsert by stable key. The server already filtered and deduped this page;
   * this guards against overlapping pages and repeated auto-refreshes adding
   * the same lot twice.
   */
  const mergeItems = useCallback((newItems) => {
    let added = 0;
    for (const item of newItems) {
      // A live response must never carry synthetic rows, but re-check here so a
      // misconfigured deployment cannot leak them into the store or the cache.
      if (globalDataSource !== "mock" && isSyntheticRecord(item)) continue;

      // Department must resolve to a canonical key. Unrecognised => dropped.
      if (!getRecordDepartment(item)) continue;

      const key = stockRecordKey(item);
      if (!key || globalSeenIds.has(key)) continue;

      globalSeenIds.add(key);
      globalDataArray.push(item);
      added += 1;
    }
    if (added > 0) {
      setDataVersion((v) => v + 1);
    }
  }, []);

  // Deferred continuations (retry backoff, next page) go through this ref so
  // they always invoke the current fetchBatch instead of capturing a stale one.
  const fetchBatchRef = useRef(null);

  const fetchBatch = useCallback(async (skip = 0, take = PAGE_SIZE, isRefresh = false) => {
    if (skip === 0 && !isRefresh && globalDataArray.length === 0) {
      setLoading(true);
    }
    setBatchLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        skip: String(skip),
        take: String(take),
        _t: String(Date.now()),
      });
      if (managerScopeKeys.length) params.set("departments", managerScopeKeys.join(","));
      const res = await fetch(`/api/fantacy-stock?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
      });
      const text = await res.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch (jsonErr) {
        console.error("JSON parse error on fantacy-stock response:", jsonErr);
      }

      if (res.status >= 400 || json.success === false) {
        globalFetchFailCount++;
        // CRITICAL: Set globalLastFetchedTime even on failure to prevent the
        // 1-second timer from immediately re-triggering handleManualRefresh()
        globalLastFetchedTime = Date.now();
        if (typeof window !== "undefined") {
          localStorage.setItem("fantacy_last_sync_time", String(globalLastFetchedTime));
        }
        const retryMsg = globalFetchFailCount < MAX_AUTO_RETRIES
          ? ` (retry ${globalFetchFailCount}/${MAX_AUTO_RETRIES} in ${Math.pow(2, globalFetchFailCount) * 5}s)`
          : " — auto-retry stopped. Use Refresh Data button.";
        setError((json.error || `Skylab Sync Error (${res.status})`) + retryMsg);
        setBatchStatusText("Error: Skylab API Unavailable");
        globalBatchStatusText = "Error: Skylab API Unavailable";
        setBatchLoading(false);
        setLoading(false);

        // Auto-retry with exponential backoff, up to MAX_AUTO_RETRIES
        if (globalFetchFailCount < MAX_AUTO_RETRIES) {
          const backoffMs = Math.pow(2, globalFetchFailCount) * 5000; // 10s, 20s, 40s
          setTimeout(() => {
            fetchBatchRef.current?.(0, take, false);
          }, backoffMs);
        }
        return;
      }

      // Track which source this sync came from so mock and live rows can never
      // share a store or a cache entry.
      const responseSource = json.source === "mock" ? "mock" : "live";
      if (skip === 0) globalDataSource = responseSource;

      const allItems = Array.isArray(json.data) ? json.data : (Array.isArray(json.records) ? json.records : []);
      mergeItems(allItems);
      setLastUpdated(json.lastUpdated ? new Date(json.lastUpdated) : new Date());

      // nextSkip advances by the RAW page size, not the filtered count, so
      // pagination does not stall when a page filters down to nothing.
      const currentSkip = Number.isFinite(json.nextSkip)
        ? json.nextSkip
        : skip + (json.rawPageCount ?? allItems.length);

      globalLastFetchedTime = Date.now();
      globalFetchFailCount = 0; // Reset fail counter on success
      if (typeof window !== "undefined") {
        localStorage.setItem("fantacy_last_sync_time", String(globalLastFetchedTime));
        localStorage.setItem("fantacy_accumulated_skip", String(currentSkip));
      }

      // Continue only while the API itself says there is more, and only while
      // skip actually advances -- a non-advancing skip would loop forever.
      if (json.hasMore && currentSkip > skip) {
        const scanned = currentSkip.toLocaleString();
        const matched = globalDataArray.length.toLocaleString();
        const statusMsg = `Synchronizing: ${scanned} scanned, ${matched} matched`;
        setBatchStatusText(statusMsg);
        globalBatchStatusText = statusMsg;

        setTimeout(() => {
          fetchBatchRef.current?.(currentSkip, take, isRefresh);
        }, 15);
      } else {
        const statusMsg = `Complete: ${globalDataArray.length.toLocaleString()} lots synchronized`;
        setBatchStatusText(statusMsg);
        globalBatchStatusText = statusMsg;
        if (typeof window !== "undefined") {
          localStorage.setItem("fantacy_sync_complete", "true");
        }
        setBatchLoading(false);
        saveCacheToIndexedDB(globalDataArray, globalLastFetchedTime, responseSource, managerScopeKeys);
      }
    } catch (err) {
      console.error("Fantacy stock fetch error:", err);
      globalFetchFailCount++;
      globalLastFetchedTime = Date.now();
      if (typeof window !== "undefined") {
        localStorage.setItem("fantacy_last_sync_time", String(globalLastFetchedTime));
      }
      setError(err.message || "Failed to fetch stock data from Skylab API");
      setBatchStatusText("Error: Connection Failed");
      globalBatchStatusText = "Error: Connection Failed";
      setBatchLoading(false);
    } finally {
      setLoading(false);
    }
  }, [managerScopeKeys, mergeItems]);

  useEffect(() => {
    fetchBatchRef.current = fetchBatch;
  }, [fetchBatch]);

  const handleManualRefresh = useCallback(() => {
    globalLastFetchedTime = 0;
    globalFetchFailCount = 0; // Reset fail counter so manual refresh always works
    if (typeof window !== "undefined") {
      localStorage.setItem("fantacy_sync_complete", "false");
      localStorage.setItem("fantacy_accumulated_skip", "0");
      localStorage.removeItem("fantacy_last_sync_time");
    }

    globalDataArray = [];
    globalSeenIds.clear();
    setDataVersion((v) => v + 1);
    clearCacheFromIndexedDB();

    setLoading(true);
    setBatchLoading(true);
    const initialStatus = "Synchronizing Stock Data...";
    setBatchStatusText(initialStatus);
    globalBatchStatusText = initialStatus;

    fetchBatch(0, PAGE_SIZE, true);
    setSecondsUntilNextFetch(AUTO_REFRESH_INTERVAL_SEC);
  }, [fetchBatch]);

  useEffect(() => {
    if (permissionsLoading) return;
    let isMounted = true;

    async function initializeStockData() {
      const now = Date.now();
      let storedTime = 0;
      let isComplete = false;
      let cacheVersion = "";

      if (typeof window !== "undefined") {
        cacheVersion = localStorage.getItem("fantacy_cache_version") || "";
        storedTime = parseInt(localStorage.getItem("fantacy_last_sync_time") || "0", 10);
        isComplete = localStorage.getItem("fantacy_sync_complete") === "true";
      }

      // One-time migration: any cache written by an earlier version is dropped
      // wholesale. This is what evicts the historic synthetic fallback rows.
      if (cacheVersion !== CACHE_VERSION) {
        globalDataArray = [];
        globalSeenIds.clear();
        globalLastFetchedTime = 0;
        if (typeof window !== "undefined") {
          localStorage.setItem("fantacy_cache_version", CACHE_VERSION);
          localStorage.removeItem("fantacy_sync_complete");
          localStorage.removeItem("fantacy_last_sync_time");
          localStorage.removeItem("fantacy_accumulated_skip");
        }
        await clearCacheFromIndexedDB();
        storedTime = 0;
        isComplete = false;
      }

      let hasData = globalDataArray.length > 0;

      if (!hasData) {
        // Only a cache written by the same source and the same department scope
        // is eligible; anything else is discarded and re-fetched.
        const dbCache = await loadCacheFromIndexedDB(globalDataSource, managerScopeKeys);
        if (dbCache && dbCache.items && dbCache.items.length > 0) {
          globalDataArray = dbCache.items;
          globalSeenIds.clear();
          globalDataArray.forEach((item) => {
            const key = stockRecordKey(item);
            if (key) globalSeenIds.add(key);
          });
          globalLastFetchedTime = dbCache.lastFetchedTime || storedTime;
          hasData = globalDataArray.length > 0;
          if (hasData) {
            setDataVersion((v) => v + 1);
            setLoading(false);
          }
        }
      }

      const timeSinceLastFetch = now - (globalLastFetchedTime || storedTime);
      const isLockExpired = timeSinceLastFetch >= AUTO_REFRESH_INTERVAL_MS;

      if (!hasData || !isComplete || isLockExpired) {
        if (isLockExpired) {
          globalDataArray = [];
          globalSeenIds.clear();
          setDataVersion((v) => v + 1);
          clearCacheFromIndexedDB();
        }
        fetchBatch(0, PAGE_SIZE, false);
      } else {
        setLoading(false);
        setBatchLoading(false);
      }
    }

    initializeStockData();

    return () => {
      isMounted = false;
    };
  }, [permissionsLoading, fetchBatch]);

  const activeDataset = useMemo(() => {
    const base =
      globalDataSource === "mock" ? globalDataArray : globalDataArray.filter((i) => !isSyntheticRecord(i));
    const scopedByDepartment = managerScopeKeys.length ? base.filter(isAllowedForManager) : base;
    if (!filterByPeriod || !activePeriod?.start_date || !activePeriod?.end_date) return scopedByDepartment;

    const periodStart = normalizeToIsoDate(activePeriod.start_date);
    const periodEnd = normalizeToIsoDate(activePeriod.end_date);
    return scopedByDepartment.filter((item) => {
      const itemDate = getStockRecordDate(item);
      return itemDate && itemDate >= periodStart && itemDate <= periodEnd;
    });
  }, [dataVersion, filterByPeriod, managerScopeKeys.length, isAllowedForManager, activePeriod?.start_date, activePeriod?.end_date]);

  // Unique Options lists for dropdown filters
  const departmentOptions = useMemo(() => {
    const set = new Set();
    activeDataset.forEach((item) => {
      const d = item.DepartmentAccountName || item.Department;
      if (d) set.add(String(d));
    });
    return Array.from(set).sort();
  }, [dataVersion, activeDataset]);

  const shapeOptions = useMemo(() => {
    const set = new Set();
    activeDataset.forEach((item) => (item.ShapeID || item.ShapeName || item.EstimateShapeID) && set.add(String(item.ShapeID || item.ShapeName || item.EstimateShapeID)));
    return Array.from(set).sort();
  }, [dataVersion, activeDataset]);

  const colorOptions = useMemo(() => {
    const set = new Set();
    activeDataset.forEach((item) => (item.ColorID || item.ColorName || item.EstimateColorID) && set.add(String(item.ColorID || item.ColorName || item.EstimateColorID)));
    return Array.from(set).sort();
  }, [dataVersion, activeDataset]);

  const clarityOptions = useMemo(() => {
    const set = new Set();
    activeDataset.forEach((item) => (item.ClarityID || item.ClarityName || item.EstimateClarityID) && set.add(String(item.ClarityID || item.ClarityName || item.EstimateClarityID)));
    return Array.from(set).sort();
  }, [dataVersion, activeDataset]);

  const labOptions = useMemo(() => {
    const set = new Set();
    activeDataset.forEach((item) => {
      const l = item.LabAccountName || item.Lab || item.LabName;
      if (l) set.add(String(l));
    });
    return Array.from(set).sort();
  }, [dataVersion, activeDataset]);

  function normalizeToIsoDate(val) {
    if (!val) return "";
    const str = String(val).trim();
    const dmY = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (dmY) {
      const [, d, m, y] = dmY;
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const yMD = str.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (yMD) {
      const [, y, m, d] = yMD;
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    return str.slice(0, 10);
  }

  // Filtered dataset
  const filteredData = useMemo(() => {
    return activeDataset.filter((item) => {
      // Department Filter -- exact canonical match on the authoritative field.
      // An unrecognised value normalizes to "" and can never equal a real
      // department key, so selecting one department never leaks another's rows.
      if (departmentFilter !== "ALL") {
        const itemDeptNorm = getRecordDepartment(item);
        const filterDeptNorm = normalizeDepartment(departmentFilter);
        if (!itemDeptNorm || itemDeptNorm !== filterDeptNorm) return false;
      }

      // Shape Filter
      if (shapeFilter !== "ALL") {
        const val = String(item.ShapeID || item.ShapeName || item.EstimateShapeID || "");
        if (val !== shapeFilter) return false;
      }

      // Color Filter
      if (colorFilter !== "ALL") {
        const val = String(item.ColorID || item.ColorName || item.EstimateColorID || "");
        if (val !== colorFilter) return false;
      }

      // Clarity Filter
      if (clarityFilter !== "ALL") {
        const val = String(item.ClarityID || item.ClarityName || item.EstimateClarityID || "");
        if (val !== clarityFilter) return false;
      }

      // Lab Filter
      if (labFilter !== "ALL") {
        const val = String(item.LabAccountName || item.Lab || item.LabName || "");
        if (val !== labFilter) return false;
      }

      // Date Range Filters
      if (fromDateFilter || toDateFilter) {
        const itemDateStr = getStockRecordDate(item);
        if (itemDateStr) {
          if (fromDateFilter && itemDateStr < fromDateFilter) return false;
          if (toDateFilter && itemDateStr > toDateFilter) return false;
        }
      }

      // Search Term
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
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!searchableText.includes(term)) return false;
      }

      return true;
    });
  }, [dataVersion, activeDataset, departmentFilter, shapeFilter, colorFilter, clarityFilter, labFilter, fromDateFilter, toDateFilter, debouncedSearchTerm]);

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
  }, [dataVersion, filteredData, sortField, sortAsc]);

  // Paginated data
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedData.slice(startIndex, startIndex + itemsPerPage);
  }, [dataVersion, sortedData, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage) || 1;

  // Dynamic KPI Metrics Calculation based on active filters
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
      isFiltered: filteredData.length !== activeDataset.length,
    };
  }, [filteredData, activeDataset.length]);

  // Preset-filtered Columns Mapping
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
    exportToExcel(sortedData, `Fantacy_Polish_Stock_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const formatCountdown = (totalSec) => {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  };

  const displayBatchStatusText = batchStatusText.replace(/^[^A-Za-z0-9]+,?\s*/, "");
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
      // No CompanyID/CompanyName fallback. These previously defaulted to
      // "2139" / "Skylab Diamond", which INVENTED provenance: the live API
      // returns CompanyID 1, and there is no CompanyName column at all. A
      // missing value must render as "-", never as a plausible-looking guess.
      if (colKey === "DepartmentAccountName") val = row.DepartmentAccountID || row.Department;
      else if (colKey === "LocationAccountName") val = row.LocationAccountID || row.Location;
      else if (colKey === "ProcessID") val = row.ProcessName || row.Process;
      // `ProductionStatus` and `Status` do not exist on type Lot -- verified
      // against the live API. `ProductionStatusID` is the real column and is
      // requested directly, so this fallback only covers genuinely empty values.
      else if (colKey === "ProductionStatusID") val = row.ProductionStatus || row.Status;
      else if (colKey === "Quantity") val = row.Qty || row.Pcs;
      else if (colKey === "TB104ID") val = row.StoneLevel;
      else if (colKey === "TB401") val = row.Table;
      else if (colKey === "TB209") val = row.NewDesign;
      else if (colKey === "ExternalSourceLotRemark") val = row.ExternalNotes || row.Remark;
    }

    if (val === undefined || val === null || val === "") return <span style={{ color: "var(--text-muted)" }}>-</span>;

    // 1. Status Badges
    if (colKey === "ProductionStatusID") {
      const statusStr = String(val).toUpperCase();
      let badgeClass = "badge-gray";
      if (statusStr.includes("ACTIVE") || statusStr.includes("COMPLET")) badgeClass = "badge-emerald";
      else if (statusStr.includes("IN_PROGRESS") || statusStr.includes("INPROCESS") || statusStr.includes("PROGRESS")) badgeClass = "badge-blue";
      else if (statusStr.includes("PENDING") || statusStr.includes("WAIT")) badgeClass = "badge-amber";
      return <span className={`badge ${badgeClass}`}>{statusStr.replace(/_/g, " ")}</span>;
    }

    // 2. Item Type ID
    if (colKey === "ItemTypeID") {
      const text = String(val).replace(/_/g, " ");
      return <span className="badge badge-gray" style={{ fontWeight: 600 }}>{text}</span>;
    }

    // 3. Lot ID
    if (colKey === "LotID") {
      return <span style={{ fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.5px" }}>{String(val)}</span>;
    }

    // 4. Lot Name
    if (colKey === "LotName") {
      return <span style={{ fontWeight: 700, color: "var(--accent-primary)" }}>{String(val)}</span>;
    }

    // 5. External Notes (Truncated with tooltip hover)
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

    // 6. Numeric Values
    if (["Weight", "EstimateWeight", "LotMeasurements1", "LotMeasurements2", "LotMeasurements3", "TB401"].includes(colKey)) {
      const num = parseFloat(val);
      const formatted = !isNaN(num) ? num.toFixed(2) : String(val);
      return (
        <span style={{ fontFamily: "monospace", fontFeatureSettings: '"tnum"', fontWeight: 600, color: "var(--text-primary)" }}>
          {formatted}
        </span>
      );
    }

    // 7. Shape, Color, Clarity Badges
    if (colKey === "EstimateShapeID") {
      return <span className="badge badge-gray" style={{ fontWeight: 600, background: "var(--gray-100)", color: "var(--text-primary)" }}>{String(val)}</span>;
    }
    if (["EstimateColorID", "EstimateClarityID"].includes(colKey)) {
      return <span className="badge badge-blue" style={{ fontWeight: 700, fontSize: "11px" }}>{String(val)}</span>;
    }

    // 8. Dates
    if (["ProcessSendDate", "PreviousProcessRtnDate"].includes(colKey)) {
      const dateStr = typeof val === "string" ? val.slice(0, 10) : String(val);
      return <span style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{dateStr}</span>;
    }

    return String(val);
  };

  return (
    <RoleGate roles={STAFF_ROLES} permission={["manage_fantacy", "fetch_fantacy_department_data"]}>
      <div>
        <div className="page-header" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div className="page-header-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-secondary" onClick={handleExport} disabled={sortedData.length === 0}>Export</button>
            {canViewSyncControls && <button className="btn btn-primary" onClick={handleManualRefresh} disabled={loading}>{batchLoading ? "Syncing..." : "Refresh Data"}</button>}
          </div>
        </div>

        {canViewSyncControls && <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 240 }}>
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: batchLoading ? "var(--accent-primary)" : "var(--green-600)", boxShadow: batchLoading ? "0 0 0 4px var(--accent-primary-light)" : "0 0 0 4px var(--green-50)" }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{displayBatchStatusText}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{lastUpdated ? `Last updated ${lastUpdated.toLocaleString()}` : "Waiting for first sync"}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <AutoFetchCountdownBadge onTriggerRefresh={handleManualRefresh} />
              <span className="badge badge-emerald">{activeDataset.length.toLocaleString()} active lots ({filterByPeriod ? (activePeriod?.name || "Active Period") : "All Periods"})</span>
              <span className="badge badge-gray">{globalDataArray.length.toLocaleString()} total synced</span>
              {managerScopedDepartments.length > 0 ? <span className="badge badge-gray">{managerScopedDepartments.join(", ")} only</span> : filterDepartmentOnly && <span className="badge badge-gray">Polish department only</span>}
            </div>
          </div>
        </div>}

        {error && <div className="alert alert-error">{error}</div>}

        <div className="kpi-grid" style={{ marginBottom: 18 }}>
          <div className="kpi-card"><div className="kpi-label">Total Polish Lots</div><div className="kpi-value">{kpis.totalLots.toLocaleString()}</div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{kpis.isFiltered ? "Filtered stock items" : "Active stock items"}</div></div>
          <div className="kpi-card"><div className="kpi-label">Total WT</div><div className="kpi-value">{kpis.totalCarats} <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>ct</span></div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{kpis.isFiltered ? "Filtered diamond weight" : "Gross diamond weight"}</div></div>
          <div className="kpi-card"><div className="kpi-label">Total Pieces</div><div className="kpi-value">{kpis.totalPcs.toLocaleString()} <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>pcs</span></div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{kpis.isFiltered ? "Filtered stone count" : "Total stone count"}</div></div>
          <div className="kpi-card"><div className="kpi-label">Avg WT / Stone</div><div className="kpi-value">{kpis.avgWeight} <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>ct</span></div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Average carat per stone</div></div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span className="card-title">Filters & View</span>
            <button className="btn btn-secondary btn-sm" onClick={() => { setSearchTerm(""); setDepartmentFilter("ALL"); setShapeFilter("ALL"); setColorFilter("ALL"); setClarityFilter("ALL"); setLabFilter("ALL"); setFromDateFilter(""); setToDateFilter(""); setCurrentPage(1); }}>Reset Filters</button>
          </div>
          <div className="card-body" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1.35fr) repeat(auto-fit, minmax(150px, 1fr))", columnGap: 12, rowGap: 10, alignItems: "center" }}>
              <input className="input" type="text" placeholder="Search lot, certificate, process, department..." value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setCurrentPage(1); }} style={filterControlStyle} />
              <select className="input" value={departmentFilter} onChange={(event) => { setDepartmentFilter(event.target.value); setCurrentPage(1); }} style={filterControlStyle}><option value="ALL">{managerScopedDepartments.length ? `Assigned Departments (${departmentOptions.length})` : `All Departments (${departmentOptions.length})`}</option>{departmentOptions.map((department) => <option key={department} value={department}>{department}</option>)}</select>
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
          <div className="card-header"><span className="card-title">Fetched Stock Data</span><span className="badge badge-gray">Showing {sortedData.length.toLocaleString()} records</span></div>
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
                      {loading ? "Loading stock data from Skylab API..." : "No matching stock records found."}
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
