"use client";
import { useEffect, useMemo, useRef, useState } from "react";

function employeeLabel(employee) {
  if (!employee) return "";
  return `${employee.current_code || "No Code"} — ${employee.name}`;
}

export default function EmployeePicker({
  employees,
  value,
  onChange,
  placeholder = "Search employee code or name...",
  disabled = false,
  required = false,
  excludeId = null,
  allLabel = "",
  style,
}) {
  const wrapperRef = useRef(null);
  const searchRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const availableEmployees = useMemo(
    () => employees.filter((employee) => String(employee.id) !== String(excludeId || "")),
    [employees, excludeId]
  );

  const selectedEmployee = availableEmployees.find((employee) => String(employee.id) === String(value || ""));

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredEmployees = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return availableEmployees.slice(0, 30);
    return availableEmployees.filter((employee) => {
      const text = [employee.current_code, employee.name].filter(Boolean).join(" ").toLowerCase();
      return text.includes(term);
    }).slice(0, 30);
  }, [availableEmployees, query]);

  function selectEmployee(employeeId) {
    onChange(employeeId);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="employee-picker" ref={wrapperRef} style={style}>
      <button
        type="button"
        className="form-input employee-picker-trigger"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
      >
        <span className={selectedEmployee ? "employee-picker-trigger-text" : "employee-picker-trigger-placeholder"}>
          {selectedEmployee ? employeeLabel(selectedEmployee) : placeholder}
        </span>
        <svg className={`employee-picker-chevron${open ? " open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {required && (
        <input
          className="employee-picker-required-input"
          value={value || ""}
          onChange={() => {}}
          required
          tabIndex={-1}
          aria-hidden="true"
        />
      )}
      {open && !disabled && (
        <div className="employee-picker-menu">
          <div className="employee-picker-search-wrap">
            <input
              ref={searchRef}
              className="form-input employee-picker-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search employee code or name..."
            />
          </div>
          <div className="employee-picker-list">
            <div className="employee-picker-section">
              {query.trim() ? "Matching Employees" : "Recent Employees"}
            </div>
            {allLabel && (
              <button
                type="button"
                className={`employee-picker-option${!value ? " active" : ""}`}
                onMouseDown={(event) => { event.preventDefault(); selectEmployee(""); }}
              >
                <span>
                  <span className="employee-picker-name">{allLabel}</span>
                </span>
                {!value && <span className="employee-picker-check">✓</span>}
              </button>
            )}
            {filteredEmployees.map((employee) => {
              const selected = String(employee.id) === String(value || "");
              return (
                <button
                  type="button"
                  key={employee.id}
                  className={`employee-picker-option${selected ? " active" : ""}`}
                  onMouseDown={(event) => { event.preventDefault(); selectEmployee(employee.id); }}
                >
                  <span>
                    <span className="employee-picker-code">{employee.current_code || "No Code"}</span>
                    <span className="employee-picker-name">{employee.name}</span>
                  </span>
                  {selected && <span className="employee-picker-check">✓</span>}
                </button>
              );
            })}
            {filteredEmployees.length === 0 && <div className="employee-picker-empty">No employee found.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

