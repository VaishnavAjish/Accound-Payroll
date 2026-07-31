"use client";
import { useMemo, useState } from "react";
import EmployeePicker from "@/components/EmployeePicker";

function labelFor(employee) {
  if (!employee) return "";
  return `${employee.current_code || "No Code"} — ${employee.name}`;
}

export default function EmployeeEntryTabs({
  employees,
  activeEmployeeId,
  onActiveEmployeeChange,
  openEmployeeIds,
  onOpenEmployeeIdsChange,
  pickerWidth = 260,
  variant = "full",
}) {
  const isControlled = Array.isArray(openEmployeeIds);
  const [internalOpenTabs, setInternalOpenTabs] = useState([]);
  const [pickerValue, setPickerValue] = useState("");
  const employeeMap = useMemo(() => Object.fromEntries(employees.map((employee) => [String(employee.id), employee])), [employees]);
  const openTabs = isControlled ? openEmployeeIds.map(String) : internalOpenTabs;

  function setOpenTabs(updater) {
    const nextTabs = typeof updater === "function" ? updater(openTabs) : updater;
    const uniqueTabs = [...new Set(nextTabs.map(String))];
    if (isControlled) onOpenEmployeeIdsChange?.(uniqueTabs);
    else setInternalOpenTabs(uniqueTabs);
  }

  const visibleTabs = useMemo(() => {
    const ids = [...openTabs];
    if (activeEmployeeId && !ids.includes(String(activeEmployeeId))) ids.push(String(activeEmployeeId));
    return ids.filter((employeeId) => employeeMap[employeeId]);
  }, [activeEmployeeId, employeeMap, openTabs]);

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
    if (employeeId) {
      setOpenTabs((tabs) => tabs.includes(String(employeeId)) ? tabs : [...tabs, String(employeeId)]);
    }
    setPickerValue("");
  }

  function updateCheckedEmployees(employeeIds) {
    const nextTabs = employeeIds.map(String);
    setOpenTabs(nextTabs);
    if (activeEmployeeId && !nextTabs.includes(String(activeEmployeeId))) {
      onActiveEmployeeChange(nextTabs[nextTabs.length - 1] || "");
    }
  }

  const picker = (
    <EmployeePicker
      employees={employees}
      value={pickerValue}
      displayValue={activeEmployeeId}
      onChange={selectEmployee}
      multiple
      checkedValues={visibleTabs}
      onCheckedValuesChange={updateCheckedEmployees}
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
