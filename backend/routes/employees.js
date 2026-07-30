const express = require('express');
const db = require('../db');
const { ROLES, DEPARTMENTS, requireAuth, requireRole, requirePermission, staffRoles, accountantRoles, applyEmployeeScope, managerDepartment } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth, requirePermission('manage_employees'));

// MPS 15: "Normal operational search shows only the active holder of an
// Employee Code." -- join to the one employee_codes row per employee that
// has not been released.
router.get('/', requireAuth, requireRole(...staffRoles()), async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  let q = db('employees as e')
    .leftJoin('employee_codes as ec', function () {
      this.on('ec.employee_id', '=', 'e.id').andOnNull('ec.released_at');
    })
    .select('e.*', 'ec.code as current_code');
  if (!includeInactive) q = q.where('e.active', true);
  q = applyEmployeeScope(q, req.user, 'e.id');
  const rows = await q.orderBy('e.name');
  res.json(rows);
});

// MPS 15: "Historical holders are available specifically through Employee
// Management." -- full code history included here, not in the list view.
router.get('/:id', requireAuth, requireRole(...staffRoles()), async (req, res) => {
  const employee = await db('employees').where({ id: req.params.id }).first();
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });
  if (managerDepartment(req.user.role) && employee.department !== managerDepartment(req.user.role)) {
    return res.status(403).json({ error: 'This employee is outside your assigned Polish department.' });
  }
  const codeHistory = await db('employee_codes').where({ employee_id: employee.id }).orderBy('assigned_at', 'desc');
  res.json({ ...employee, code_history: codeHistory });
});

router.post('/', requireAuth, requireRole(...staffRoles()), async (req, res) => {
  const { name, code, grade, specialist, mobile, hastack, katora, dye, other_item, work_status } = req.body || {};
  const department = managerDepartment(req.user.role) || req.body.department || 'POLISH_1';
  if (!name || !code) return res.status(400).json({ error: 'name and code are required.' });
  if (!DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'department must be POLISH_1 through POLISH_15.' });

  const codeTaken = await db('employee_codes').where({ code, released_at: null }).first();
  if (codeTaken) return res.status(409).json({ error: `Employee Code "${code}" is currently held by another employee.` });

  const employee = await db.transaction(async (trx) => {
    const [emp] = await trx('employees')
      .insert({ name, department, grade, specialist, mobile, hastack, katora, dye, other_item, work_status: work_status || 'WORKING', active: true })
      .returning('*');
    await trx('employee_codes').insert({ code, employee_id: emp.id, assigned_by: req.user.id });
    return emp;
  });

  await logAudit(db, { actorUserId: req.user.id, action: 'EMPLOYEE_CREATED', entityType: 'employee', entityId: employee.id, after: { ...employee, code, department }, ipAddress: req.ip });
  res.status(201).json({ ...employee, current_code: code });
});

router.patch('/:id', requireAuth, requireRole(...staffRoles()), async (req, res) => {
  const before = await db('employees').where({ id: req.params.id }).first();
  if (!before) return res.status(404).json({ error: 'Employee not found.' });
  const managerDept = managerDepartment(req.user.role);
  if (managerDept && before.department !== managerDept) return res.status(403).json({ error: 'This employee is outside your assigned Polish department.' });

  const allowed = ['name', 'department', 'grade', 'specialist', 'mobile', 'hastack', 'katora', 'dye', 'other_item', 'work_status', 'verify_status'];
  const update = {};
  for (const k of allowed) if (req.body[k] !== undefined) update[k] = req.body[k];
  if (managerDept) delete update.department;
  if (update.department && !DEPARTMENTS.includes(update.department)) return res.status(400).json({ error: 'department must be POLISH_1 through POLISH_15.' });
  update.updated_at = db.fn.now();

  const requestedCode = req.body.code !== undefined ? String(req.body.code).trim() : null;
  if (requestedCode === '') return res.status(400).json({ error: 'code cannot be blank.' });

  try {
    const after = await db.transaction(async (trx) => {
      const activeCode = await trx('employee_codes').where({ employee_id: before.id, released_at: null }).first();
      if (requestedCode && (!activeCode || activeCode.code !== requestedCode)) {
        const codeTaken = await trx('employee_codes')
          .where({ code: requestedCode, released_at: null })
          .whereNot({ employee_id: before.id })
          .first();
        if (codeTaken) {
          const err = new Error(`Employee Code "${requestedCode}" is currently held by another employee.`);
          err.status = 409;
          throw err;
        }

        if (activeCode) {
          await trx('employee_codes').where({ id: activeCode.id }).update({ code: requestedCode });
        } else {
          await trx('employee_codes').insert({ code: requestedCode, employee_id: before.id, assigned_by: req.user.id });
        }
      }

      const [employee] = await trx('employees').where({ id: before.id }).update(update).returning('*');
      return { ...employee, current_code: requestedCode || activeCode?.code || null };
    });

    await logAudit(db, { actorUserId: req.user.id, action: 'EMPLOYEE_UPDATED', entityType: 'employee', entityId: before.id, before, after, ipAddress: req.ip });
    res.json(after);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

router.post('/:id/deactivate', requireAuth, requireRole(...accountantRoles()), async (req, res) => {
  const [after] = await db('employees').where({ id: req.params.id }).update({ active: false, updated_at: db.fn.now() }).returning('*');
  if (!after) return res.status(404).json({ error: 'Employee not found.' });
  await logAudit(db, { actorUserId: req.user.id, action: 'EMPLOYEE_DEACTIVATED', entityType: 'employee', entityId: after.id, ipAddress: req.ip });
  res.json(after);
});

router.post('/:id/reactivate', requireAuth, requireRole(...accountantRoles()), async (req, res) => {
  const [after] = await db('employees').where({ id: req.params.id }).update({ active: true, updated_at: db.fn.now() }).returning('*');
  if (!after) return res.status(404).json({ error: 'Employee not found.' });
  await logAudit(db, { actorUserId: req.user.id, action: 'EMPLOYEE_REACTIVATED', entityType: 'employee', entityId: after.id, ipAddress: req.ip });
  res.json(after);
});

// MPS 15: "Only Accounts and Root Admin can manually release an Employee
// Code. Release is blocked while the previous employee has unresolved Lot in
// Hand or unfinalized payroll."
router.post('/:id/release-code', requireAuth, requireRole(...accountantRoles()), async (req, res) => {
  const employeeId = req.params.id;
  const activeCode = await db('employee_codes').where({ employee_id: employeeId, released_at: null }).first();
  if (!activeCode) return res.status(404).json({ error: 'This employee has no active code to release.' });

  const lotInHand = await db('polish_entries').where({ employee_id: employeeId, status: 'LOT_IN_HAND' }).first();
  if (lotInHand) return res.status(409).json({ error: 'Cannot release code: employee has unresolved Lot in Hand.' });

  const unfinalized = await db('employee_period_status').where({ employee_id: employeeId }).whereNot('status', 'ACCOUNTS_VERIFIED').first();
  if (unfinalized) return res.status(409).json({ error: 'Cannot release code: employee has unfinalized payroll for at least one period.' });

  const [released] = await db('employee_codes')
    .where({ id: activeCode.id })
    .update({ released_at: db.fn.now(), released_by: req.user.id })
    .returning('*');

  await logAudit(db, { actorUserId: req.user.id, action: 'EMPLOYEE_CODE_RELEASED', entityType: 'employee', entityId: employeeId, after: released, ipAddress: req.ip });
  res.json(released);
});

router.post('/:id/assign-code', requireAuth, requireRole(...accountantRoles()), async (req, res) => {
  const employeeId = req.params.id;
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required.' });

  const existingActive = await db('employee_codes').where({ employee_id: employeeId, released_at: null }).first();
  if (existingActive) return res.status(409).json({ error: 'This employee already holds an active code. Release it first.' });

  const codeTaken = await db('employee_codes').where({ code, released_at: null }).first();
  if (codeTaken) return res.status(409).json({ error: `Employee Code "${code}" is currently held by another employee.` });

  const [assigned] = await db('employee_codes').insert({ code, employee_id: employeeId, assigned_by: req.user.id }).returning('*');
  await logAudit(db, { actorUserId: req.user.id, action: 'EMPLOYEE_CODE_ASSIGNED', entityType: 'employee', entityId: employeeId, after: assigned, ipAddress: req.ip });
  res.status(201).json(assigned);
});

module.exports = router;
