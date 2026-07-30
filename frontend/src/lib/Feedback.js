"use client";
import { createContext, useCallback, useContext, useState } from "react";

const FeedbackContext = createContext(null);

const ICON = { error: "!", success: "✓", warning: "!" };

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const showToast = useCallback((message, type = "success") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Promise-based replacement for window.confirm -- renders as a modal
  // instead of a native browser dialog. Usage: `if (!(await confirmAction("...")))
  // return;` from an async handler.
  const confirmAction = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      setConfirmState({
        message,
        danger: !!opts.danger,
        confirmLabel: opts.confirmLabel || (opts.danger ? "Confirm" : "Confirm"),
        resolve,
      });
    });
  }, []);

  function resolveConfirm(result) {
    confirmState?.resolve(result);
    setConfirmState(null);
  }

  return (
    <FeedbackContext.Provider value={{ showToast, confirmAction }}>
      {children}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-icon">{ICON[t.type] || ICON.success}</span>
            <span className="toast-message">{t.message}</span>
            <button className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">&times;</button>
          </div>
        ))}
      </div>

      {confirmState && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && resolveConfirm(false)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-body" style={{ paddingTop: 22 }}>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{confirmState.message}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => resolveConfirm(false)}>Cancel</button>
              <button className={`btn ${confirmState.danger ? "btn-danger" : "btn-primary"}`} onClick={() => resolveConfirm(true)}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  return useContext(FeedbackContext);
}
