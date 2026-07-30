// MPS 16: Roles, Authorization and RBAC Enforcement
const jwt = require('jsonwebtoken');
const db = require('../db');

const DEPARTMENTS = Object.freeze(Array.from({ length: 15 }, (_, i) => `POLISH_${i + 1}`));
const MANAGER_ROLES = Object.freeze([...DEPARTMENTS.map((department) => `${department}_MANAGER`), 'SF_2_MANAGER']);

const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  ACCOUNTANT: 'ACCOUNTANT',
  EMPLOYEE: 'EMPLOYEE',
  ROOT_ADMIN: 'SUPER_ADMIN',
  ACCOUNTS: 'ACCOUNTANT',
  POLISH_MANAGER: 'POLISH_1_MANAGER',
  DHAR_MANAGER: 'POLISH_1_MANAGER',
  ...Object.fromEntries(MANAGER_ROLES.map((role) => [role, role])),
});

const TOKEN_TTL = '12h';

function generateToken(user) {
  const role = normalizeRole(user.role);
  return jwt.sign(
    { id: user.id, role, employee_id: user.employee_id || null, department: managerDepartment(role) },
    process.env.SECRET_KEY,
    { expiresIn: TOKEN_TTL }
  );
}

function normalizeRole(role) {
  if (role === 'ROOT_ADMIN') return ROLES.SUPER_ADMIN;
  if (role === 'ACCOUNTS') return ROLES.ACCOUNTANT;
  if (role === 'MANAGER' || role === 'POLISH_MANAGER' || role === 'DHAR_MANAGER') return ROLES.POLISH_1_MANAGER;
  return role;
}

function managerDepartment(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'SF_2_MANAGER') return 'POLISH_2';
  const match = /^POLISH_(\d+)_MANAGER$/.exec(normalized || '');
  return match ? `POLISH_${match[1]}` : null;
}

function isManagerRole(role) {
  return MANAGER_ROLES.includes(normalizeRole(role));
}

function isSuperAdmin(role) {
  return normalizeRole(role) === ROLES.SUPER_ADMIN;
}

function isAdmin(role) {
  return normalizeRole(role) === ROLES.ADMIN;
}

function isAccountant(role) {
  return normalizeRole(role) === ROLES.ACCOUNTANT;
}

function isBackOfficeRole(role) {
  return isSuperAdmin(role) || isAdmin(role) || isAccountant(role);
}

function staffRoles() {
  return [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.ACCOUNTANT, ...MANAGER_ROLES];
}

function managementRoles() {
  return [ROLES.SUPER_ADMIN, ROLES.ADMIN];
}

function rateMasterRoles() {
  return [ROLES.SUPER_ADMIN, ROLES.ADMIN];
}

function accountantRoles() {
  return [ROLES.SUPER_ADMIN, ROLES.ACCOUNTANT];
}

function applyEmployeeScope(query, user, column = 'employee_id') {
  const department = managerDepartment(user.role);
  if (!department) return query;
  return query.whereIn(column, db('employees').select('id').where({ department }));
}

async function canAccessEmployee(user, employeeId, trx = db) {
  const department = managerDepartment(user.role);
  if (!department) return true;
  const employee = await trx('employees').where({ id: employeeId, department }).first();
  return !!employee;
}

async function requireEmployeeAccess(user, employeeId, trx = db) {
  if (!(await canAccessEmployee(user, employeeId, trx))) {
    const err = new Error('This employee is outside your assigned Polish department.');
    err.status = 403;
    throw err;
  }
}

async function hasPermission(user, permissionKey, trx = db) {
  if (isSuperAdmin(user.role)) return true;

  const row = await trx('role_permissions')
    .where({ role: normalizeRole(user.role), permission_key: permissionKey })
    .first();

  return !!row?.is_allowed;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authentication token.' });

  try {
    const payload = jwt.verify(token, process.env.SECRET_KEY);
    payload.role = normalizeRole(payload.role);
    payload.department = managerDepartment(payload.role);
    req.user = payload; // { id, role, employee_id }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireRole(...allowedRoles) {
  const normalizedAllowed = allowedRoles.map(normalizeRole);

  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Missing authentication token.' });
    if (!normalizedAllowed.includes(normalizeRole(req.user.role))) {
      return res.status(403).json({ error: `This action requires role: ${allowedRoles.join(' or ')}.` });
    }
    next();
  };
}

function requirePermission(permissionKey) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Missing authentication token.' });
    if (isSuperAdmin(req.user.role)) {
      return next(); // Super Admin always has full access
    }

    try {
      if (await hasPermission(req.user, permissionKey)) {
        return next();
      }

      res.status(403).json({ error: `Access denied. Permission '${permissionKey}' is disabled for your role.` });
    } catch (err) {
      console.error('Permission check error:', err);
      res.status(500).json({ error: 'Failed to verify permissions.' });
    }
  };
}

function redactSalaryIfManager(role, data) {
  if (!isManagerRole(role)) return data;
  const redactOne = (row) => {
    if (!row || typeof row !== 'object') return row;
    const copy = { ...row };
    delete copy.rate_snapshot;
    delete copy.calculated_salary;
    delete copy.final_snapshot_total;
    delete copy.final_snapshot_breakdown;
    delete copy.total_salary;
    delete copy.total_polish_salary;
    delete copy.total_dhar_salary;
    delete copy.salary;
    return copy;
  };
  return Array.isArray(data) ? data.map(redactOne) : redactOne(data);
}

module.exports = {
  ROLES,
  DEPARTMENTS,
  MANAGER_ROLES,
  generateToken,
  normalizeRole,
  managerDepartment,
  isManagerRole,
  isSuperAdmin,
  isAdmin,
  isAccountant,
  isBackOfficeRole,
  staffRoles,
  managementRoles,
  rateMasterRoles,
  accountantRoles,
  applyEmployeeScope,
  canAccessEmployee,
  requireEmployeeAccess,
  hasPermission,
  requireAuth,
  requireRole,
  requirePermission,
  redactSalaryIfManager,
};
