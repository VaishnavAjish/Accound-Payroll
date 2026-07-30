export const DEPARTMENTS = Array.from({ length: 15 }, (_, i) => `POLISH_${i + 1}`);
export const MANAGER_ROLES = [...DEPARTMENTS.map((department) => `${department}_MANAGER`), "SF_2_MANAGER"];
export const STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", ...MANAGER_ROLES];

export function isManagerRole(role) {
  return MANAGER_ROLES.includes(role);
}

export function managerDepartment(role) {
  if (role === "SF_2_MANAGER") return "POLISH_2";
  const match = /^POLISH_(\d+)_MANAGER$/.exec(role || "");
  return match ? `POLISH_${match[1]}` : null;
}

export function departmentLabel(department) {
  const match = /^POLISH_(\d+)$/.exec(department || "");
  return match ? `Polish ${match[1]}` : department?.replaceAll("_", " ");
}

export function fantacyDepartmentName(department) {
  const match = /^POLISH_(\d+)$/.exec(department || "");
  return match ? `Polish-${match[1]}` : department;
}

export function roleLabel(role) {
  if (role === "SUPER_ADMIN") return "Super Admin";
  if (role === "ADMIN") return "Admin";
  if (role === "ACCOUNTANT") return "Accountant";
  if (role === "EMPLOYEE") return "Employee";
  if (role === "SF_2_MANAGER") return "SF 2";
  const dept = managerDepartment(role);
  return dept ? `Polish Manager ${dept.split("_")[1]}` : role?.replaceAll("_", " ");
}
