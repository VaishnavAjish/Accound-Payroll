"use client";
import { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { useRefresh } from "./RefreshContext";
import { api } from "./api";

const PeriodContext = createContext({
  periods: [],
  activePeriodId: "",
  setActivePeriodId: () => {},
  loadingPeriods: true,
  isActivePeriodClosed: false
});

export function PeriodProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const { subscribe } = useRefresh();
  const [periods, setPeriods] = useState([]);
  const [activePeriodId, setActivePeriodId] = useState("");
  const [loadingPeriods, setLoadingPeriods] = useState(true);

  async function loadPeriods({ silent = false } = {}) {
    if (authLoading) return;
    if (!user || user.role === "EMPLOYEE") {
      setPeriods([]);
      setActivePeriodId("");
      setLoadingPeriods(false);
      return;
    }

    if (!silent) setLoadingPeriods(true);

    try {
      const [allPeriods, defaultPeriod] = await Promise.all([
        api.get("/periods"),
        api.get("/periods/default")
      ]);
      setPeriods(allPeriods);
      setActivePeriodId((currentId) => {
        if (currentId && allPeriods.some((p) => p.id === currentId)) return currentId;
        if (defaultPeriod) return defaultPeriod.id;
        return allPeriods[0]?.id || "";
      });
    } catch (err) {
      console.error("Failed to fetch periods:", err);
    } finally {
      if (!silent) setLoadingPeriods(false);
    }
  }

  useEffect(() => {
    loadPeriods();
  }, [user, authLoading]);

  useEffect(() => subscribe("periods", () => loadPeriods({ silent: true })), [subscribe, user, authLoading]);

  const activePeriod = periods.find(p => p.id === activePeriodId);
  const isActivePeriodClosed = activePeriod ? activePeriod.status === "CLOSED" : false;

  return (
    <PeriodContext.Provider value={{ periods, activePeriodId, setActivePeriodId, loadingPeriods, isActivePeriodClosed }}>
      {children}
    </PeriodContext.Provider>
  );
}

export function useGlobalPeriod() {
  return useContext(PeriodContext);
}
