const express = require('express');
const db = require('../db');
const { ROLES, DEPARTMENTS, MANAGER_ROLES, requireAuth, requireRole, isSuperAdmin, normalizeRole, managerDepartment } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');

const router = express.Router();

const ALL_PERMISSIONS = [
  { key: 'view_dashboard', label: 'View Dashboard', category: 'Pages & Modules' },
  { key: 'manage_department_entries', label: 'Polish + DHAR Department Entries', category: 'Pages & Modules' },
  { key: 'manage_maxi', label: 'MAXI Production Entries', category: 'Pages & Modules' },
  { key: 'manage_verification', label: 'Verification & Payroll Approval', category: 'Pages & Modules' },
  { key: 'manage_rates', label: 'Rate Management (Polish & DHAR)', category: 'Pages & Modules' },
  { key: 'manage_periods', label: 'Period Management (Open/Close)', category: 'Pages & Modules' },
  { key: 'view_closed_periods', label: 'View Closed Periods / Months', category: 'Actions & Visibility' },
  { key: 'manage_employees', label: 'Employee & Code Management', category: 'Pages & Modules' },
  { key: 'manage_master_data', label: 'Master Data Configuration', category: 'Pages & Modules' },
  { key: 'manage_users', label: 'Portal User Management', category: 'Pages & Modules' },
  { key: 'view_historical_data', label: 'Historical Data', category: 'Pages & Modules' },
  { key: 'manage_fantacy', label: 'Fantacy Modules', category: 'Pages & Modules' },
  { key: 'fetch_fantacy_department_data', label: 'Fetch Fantacy Department Data', category: 'Pages & Modules' },
  { key: 'view_salary', label: 'View Salary Amounts & Projections', category: 'Actions & Visibility' },
  { key: 'close_period', label: 'Close Open Periods', category: 'Actions & Visibility' },
  { key: 'reopen_period', label: 'Reopen Closed Periods', category: 'Actions & Visibility' },
  { key: 'delete_records', label: 'Delete Records & Entries', category: 'Actions & Visibility' },
];

async function getFantacyDepartmentAccess(role, trx = db) {
  const normalizedRole = normalizeRole(role);
  try {
    const row = await trx('fantacy_department_access').where({ role: normalizedRole }).first();
    if (row && Array.isArray(row.departments)) {
      return row.departments.includes('ALL')
        ? ['ALL']
        : row.departments.filter((department) => DEPARTMENTS.includes(department));
    }
  } catch (err) {
    if (!['42P01', '42703'].includes(err.code)) throw err;
  }
  const assignedDepartment = managerDepartment(normalizedRole);
  return assignedDepartment ? [assignedDepartment] : [];
}

router.get('/me', requireAuth, async (req, res) => {
  try {
    const permissions = {};
    if (isSuperAdmin(req.user.role)) {
      for (const permission of ALL_PERMISSIONS) permissions[permission.key] = true;
      return res.json({ permissions, departmentAccess: [] });
    }

    for (const permission of ALL_PERMISSIONS) permissions[permission.key] = false;
    const rows = await db('role_permissions').where({ role: normalizeRole(req.user.role) });
    for (const row of rows) permissions[row.permission_key] = Boolean(row.is_allowed);

    const departmentAccess = permissions.fetch_fantacy_department_data
      ? await getFantacyDepartmentAccess(req.user.role)
      : [];
    res.json({ permissions, departmentAccess });
  } catch (err) {
    console.error('Fetch current RBAC permissions error:', err);
    res.status(500).json({ error: 'Failed to fetch current permissions.' });
  }
});

/**
 * GET /rbac/permissions
 * Fetch full RBAC matrix for all roles
 */
router.get('/permissions', requireAuth, async (req, res) => {
  try {
    const rows = await db('role_permissions');
    let accessRows = [];
    try {
      accessRows = await db('fantacy_department_access');
    } catch (err) {
      if (!['42P01', '42703'].includes(err.code)) throw err;
    }
    
    // Group permissions by role
    const matrix = {};
    const roles = [ROLES.ADMIN, ROLES.ACCOUNTANT, ...MANAGER_ROLES];

    for (const r of roles) {
      matrix[r] = {};
      for (const p of ALL_PERMISSIONS) {
        // Super Admin always has true
        if (r === ROLES.SUPER_ADMIN) {
          matrix[r][p.key] = true;
        } else {
          const found = rows.find(row => row.role === r && row.permission_key === p.key);
          matrix[r][p.key] = found ? Boolean(found.is_allowed) : false;
        }
      }
    }

    const departmentAccess = {};
    for (const role of roles) {
      const found = accessRows.find((row) => row.role === role);
      if (found && Array.isArray(found.departments)) {
        departmentAccess[role] = found.departments.includes('ALL')
          ? ['ALL']
          : found.departments.filter((department) => DEPARTMENTS.includes(department));
      } else if (matrix[role]?.fetch_fantacy_department_data) {
        const assignedDepartment = managerDepartment(role);
        departmentAccess[role] = assignedDepartment ? [assignedDepartment] : [];
      } else {
        departmentAccess[role] = [];
      }
    }

    res.json({
      permissionDefinitions: ALL_PERMISSIONS,
      departmentDefinitions: DEPARTMENTS,
      departmentAccess,
      matrix
    });
  } catch (err) {
    console.error('Fetch RBAC matrix error:', err);
    res.status(500).json({ error: 'Failed to fetch permission matrix.' });
  }
});

/**
 * PUT /rbac/permissions
 * Super Admin updates permission matrix
 */
router.post('/permissions', requireAuth, requireRole(ROLES.SUPER_ADMIN), async (req, res) => {
  const { updates, departmentAccess } = req.body || {};
  if (!Array.isArray(updates)) {
    return res.status(400).json({ error: 'updates array is required.' });
  }

  try {
    await db.transaction(async (trx) => {
      for (const item of updates) {
        const { role, permission_key, is_allowed } = item;
        if (!role || !permission_key || role === ROLES.SUPER_ADMIN) continue; // SUPER_ADMIN is immutable

        await trx('role_permissions')
          .insert({
            role,
            permission_key,
            is_allowed: Boolean(is_allowed),
            updated_at: trx.fn.now()
          })
          .onConflict(['role', 'permission_key'])
          .merge({
            is_allowed: Boolean(is_allowed),
            updated_at: trx.fn.now()
          });
      }

      if (departmentAccess && typeof departmentAccess === 'object') {
        for (const [role, departments] of Object.entries(departmentAccess)) {
          const normalizedRole = normalizeRole(role);
          if (![ROLES.ADMIN, ROLES.ACCOUNTANT, ...MANAGER_ROLES].includes(normalizedRole)) continue;
          const cleanDepartments = Array.isArray(departments)
            ? (departments.includes('ALL') ? ['ALL'] : departments.filter((department) => DEPARTMENTS.includes(department)))
            : [];

          try {
            await trx('fantacy_department_access')
              .insert({ role: normalizedRole, departments: cleanDepartments, updated_at: trx.fn.now() })
              .onConflict('role')
              .merge({ departments: cleanDepartments, updated_at: trx.fn.now() });
          } catch (err) {
            if (!['42P01', '42703'].includes(err.code)) throw err;
          }

          await trx('role_permissions')
            .insert({
              role: normalizedRole,
              permission_key: 'fetch_fantacy_department_data',
              is_allowed: cleanDepartments.length > 0,
              updated_at: trx.fn.now()
            })
            .onConflict(['role', 'permission_key'])
            .merge({
              is_allowed: cleanDepartments.length > 0,
              updated_at: trx.fn.now()
            });
        }
      }
    });

    await logAudit(db, {
      actorUserId: req.user.id,
      action: 'RBAC_PERMISSIONS_UPDATED',
      entityType: 'rbac',
      metadata: { count: updates.length, department_access_roles: departmentAccess ? Object.keys(departmentAccess).length : 0 },
      ipAddress: req.ip
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Update RBAC matrix error:', err);
    res.status(500).json({ error: 'Failed to update permissions.' });
  }
});

module.exports = router;
