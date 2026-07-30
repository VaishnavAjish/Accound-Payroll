"use client";
import { createContext, useContext, useCallback, useRef, useEffect, useState } from "react";

/**
 * Global Refresh Context
 * 
 * A lightweight event bus that lets any component broadcast "data changed" and
 * lets any other component subscribe to be notified. This eliminates the need
 * for manual page refreshes after mutations.
 *
 * Usage:
 *   const { broadcast, useSubscribe } = useRefresh();
 *   
 *   // After a mutation (e.g., creating an entry):
 *   broadcast("polish");          // notify all polish subscribers
 *   broadcast("notifications");   // also refresh the notification bell
 *
 *   // In a component that displays data:
 *   useSubscribe("polish", loadData);  // re-runs loadData whenever "polish" is broadcast
 */

const RefreshContext = createContext(null);

export function RefreshProvider({ children }) {
  const listenersRef = useRef(new Map()); // channel -> Set<callback>

  const subscribe = useCallback((channel, callback) => {
    if (!listenersRef.current.has(channel)) {
      listenersRef.current.set(channel, new Set());
    }
    listenersRef.current.get(channel).add(callback);
    return () => {
      const set = listenersRef.current.get(channel);
      if (set) {
        set.delete(callback);
        if (set.size === 0) listenersRef.current.delete(channel);
      }
    };
  }, []);

  const broadcast = useCallback((channel) => {
    const set = listenersRef.current.get(channel);
    if (set) {
      set.forEach((cb) => {
        try { cb(); } catch (e) { console.error(`[RefreshBus] Error in ${channel} subscriber:`, e); }
      });
    }
  }, []);

  return (
    <RefreshContext.Provider value={{ subscribe, broadcast }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  const ctx = useContext(RefreshContext);
  if (!ctx) throw new Error("useRefresh must be used within RefreshProvider");
  return ctx;
}

/**
 * Hook to subscribe to a refresh channel. When the channel is broadcast,
 * the provided callback is called. Automatically unsubscribes on unmount.
 */
export function useSubscribe(channel, callback) {
  const { subscribe } = useRefresh();
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    return subscribe(channel, () => callbackRef.current());
  }, [subscribe, channel]);
}
