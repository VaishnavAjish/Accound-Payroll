"use client";
import { useEffect, useMemo, useState } from "react";
import EmployeePicker from "@/components/EmployeePicker";

function labelFor(employee) {
  if (!employee) return "";
  return `${employee.current_code || "No Code"} — ${employee.name}`;
}

export default function EmployeeEntryTabs({
  employees,
  activeEmployeeId,
  onActiveEmployeeChange,
  pickerWidth = 260,
  variant = "full",
}) {
  const [openTabs, setOpenTabs] = useState([]);
  const [pickerValue, setPickerValue] = useState("");
  const employeeMap = useMemo(() => Object.fromEntries(employees.map((employee) => [String(employee.id), employee])), [employees]);

  useEffect(() => {
    if (!activeEmployeeId) return;
    setOpenTabs((tabs) => tabs.includes(String(activeEmployeeId)) ? tabs : [...tabs, String(activeEmployeeId)]);
  }, [activeEmployeeId]);

  const visibleTabs = openTabs.filter((employeeId) => employeeMap[employeeId]);

  function closeTab(employeeId, event) {
    event.stopPropagation();
    const nextTabs = visibleTabs.filter((id) => id !== employeeId);
    setOpenTabs(nextTabs);
    if (String(activeEmployeeId || "") === employeeId) {
      onActiveEmployeeChange(nextTabs.length ? nextTabs[nextTabs.length - 1] : "");
    }
  }

  function selectEmployee(employeeId) {
    onActiveEmployeeChange(employeeId);
    setPickerValue("");
  }

  const picker = (
    <EmployeePicker
      employees={employees}
      value={pickerValue}
      onChange={selectEmployee}
      allLabel="All employees"
      placeholder="Search employee..."
      style={{ width: pickerWidth }}
    />
  );

  const tabs = (
      <div className="employee-tab-strip">
        <button
          type="button"
          className={`employee-tab${!activeEmployeeId ? " active" : ""}`}
          onClick={() => onActiveEmployeeChange("")}
        >
          All
        </button>
        {visibleTabs.map((employeeId) => {
          const employee = employeeMap[employeeId];
          return (
            <button
              type="button"
              key={employeeId}
              className={`employee-tab${String(activeEmployeeId || "") === employeeId ? " active" : ""}`}
              onClick={() => onActiveEmployeeChange(employeeId)}
              title={labelFor(employee)}
            >
              <span>{employee.current_code || employee.name}</span>
              <span className="employee-tab-close" onClick={(event) => closeTab(employeeId, event)}>×</span>
            </button>
          );
        })}
      </div>
  );

  if (variant === "picker") return picker;
  if (variant === "tabs") return <div className="employee-entry-tabs employee-entry-tabs-strip-only">{tabs}</div>;

  return (
    <div className="employee-entry-tabs">
      {picker}
      {tabs}
    </div>
  );
}
