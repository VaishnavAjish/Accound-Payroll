const express = require('express');
const db = require('../db');
const { ROLES, requireAuth, requireRole, requirePermission, staffRoles, MANAGER_ROLES, accountantRoles, applyEmployeeScope, requireEmployeeAccess, isManagerRole } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { requireVisiblePeriod } = require('../lib/periodAccess');

const router = express.Router();
router.use(requireAuth, requirePermission('manage_verification'));

// MPS 13: "Accounts cannot complete final verification before Manager
// verification" -- this is a genuine separation of duties, so Accounts is
// deliberately NOT included as an allowed actor for manager-verify.
const MANAGER_VERIFIERS = [ROLES.SUPER_ADMIN, ...MANAGER_ROLES];
const ACCOUNTS_VERIFIERS = accountantRoles();

async function hasUnresolvedIssues(trx, employeeId, periodId) {
  const missingPolish = await trx('polish_entries').where({ employee_id: employeeId, payable_period_id: periodId, rate_missing: true }).first();
  if (missingPolish) return true;
  const missingDhar = await trx('dhar_entries').where({ employee_id: employeeId, payable_period_id: periodId, rate_missing: true }).first();
  return !!missingDhar;
}

async function computeFinalSnapshot(trx, employeeId, periodId) {
  const polish = await trx('polish_entries').where({ employee_id: employeeId, payable_period_id: periodId, status: 'COMPLETED' });
  const dhar = await trx('dhar_entries').where({ employee_id: employeeId, payable_period_id: periodId });

  const polishTotal = polish.reduce((s, r) => s + Number(r.calculated_salary || 0), 0);
  const dharTotal = dhar.reduce((s, r) => s + Number(r.calculated_salary || 0), 0);

  return {
    total: Math.round((polishTotal + dharTotal) * 100) / 100,
    breakdown: {
      polish: polish.map((r) => ({ id: r.id, lot_id: r.lot_id, send_weight: r.send_weight, rate_category: r.rate_category, rate_snapshot: r.rate_snapshot, calculated_salary: r.calculated_salary })),
      dhar: dhar.map((r) => ({ id: r.id, lot_id: r.lot_id, weight: r.weight, weight_slab: r.weight_slab, rate_snapshot: r.rate_snapshot, calculated_salary: r.calculated_salary })),
      polish_total: Math.round(polishTotal * 100) / 100,
      dhar_total: Math.round(dharTotal * 100) / 100,
    },
  };
}

router.get('/:employeeId/:periodId', requireAuth, requireRole(...staffRoles()), async (req, res) => {
  try {
    await requireEmployeeAccess(req.user, req.params.employeeId);
    await requireVisiblePeriod(db, req.user, req.params.periodId);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  const row = await db('employee_period_status').where({ employee_id: req.params.employeeId, period_id: req.params.periodId }).first();
  if (!row) return res.status(404).json({ error: 'No payroll status for this employee in this period yet.' });
  res.json(row);
});

// MPS 13: bulk / individual list for a period, so Accounts/Manager can see what's pending.
router.get('/', requireAuth, requireRole(...staffRoles()), async (req, res) => {
  const { period_id } = req.query;
  if (!period_id) return res.status(400).json({ error: 'period_id is required.' });
  try {
    await requireVisiblePeriod(db, req.user, period_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  let query = db('employee_period_status as eps')
    .join('employees as e', 'e.id', 'eps.employee_id')
    .leftJoin('employee_codes as ec', function() {
      this.on('ec.employee_id', '=', 'e.id').andOnNull('ec.released_at');
    })
    .where('eps.period_id', period_id)
    .select('eps.*', 'e.name as employee_name', 'ec.code as employee_code');
  query = applyEmployeeScope(query, req.user, 'eps.employee_id');
  const rows = await query;

  res.json(rows);
});

async function managerVerifyOne(trx, employeeId, periodId, actorId) {
  const status = await trx('employee_period_status').where({ employee_id: employeeId, period_id: periodId }).first();
  if (!status) return { ok: false, reason: 'No calculated payroll found for this employee in this period.' };
  if (status.status !== 'CALCULATED') return { ok: false, reason: `Cannot Manager-verify from status ${status.status}.` };
  if (await hasUnresolvedIssues(trx, employeeId, periodId)) return { ok: false, reason: 'Employee has unresolved Rate Missing entries.' };

  await trx('employee_period_status').where({ id: status.id }).update({
    status: 'MANAGER_VERIFIED', manager_verified_by: actorId, manager_verified_at: trx.fn.now(), updated_at: trx.fn.now(),
  });
  return { ok: true };
}

async function accountsVerifyOne(trx, employeeId, periodId, actorId) {
  const status = await trx('employee_period_status').where({ employee_id: employeeId, period_id: periodId }).first();
  if (!status) return { ok: false, reason: 'No calculated payroll found for this employee in this period.' };
  if (status.status !== 'MANAGER_VERIFIED') return { ok: false, reason: `Cannot Accounts-verify from status ${status.status}; Manager verification is required first.` };
  if (await hasUnresolvedIssues(trx, employeeId, periodId)) return { ok: false, reason: 'Employee has unresolved Rate Missing entries.' };

  const snapshot = await computeFinalSnapshot(trx, employeeId, periodId);
  await trx('employee_period_status').where({ id: status.id }).update({
    status: 'ACCOUNTS_VERIFIED',
    accounts_verified_by: actorId,
    accounts_verified_at: trx.fn.now(),
    final_snapshot_total: snapshot.total,
    final_snapshot_breakdown: JSON.stringify(snapshot.breakdown),
    updated_at: trx.fn.now(),
  });
  return { ok: true, total: snapshot.total };
}

router.post('/:employeeId/:periodId/manager-verify', requireAuth, requireRole(...MANAGER_VERIFIERS), async (req, res) => {
  try {
    await requireEmployeeAccess(req.user, req.params.employeeId);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  const result = await db.transaction((trx) => managerVerifyOne(trx, req.params.employeeId, req.params.periodId, req.user.id));
  if (!result.ok) return res.status(409).json({ error: result.reason });
  await logAudit(db, { actorUserId: req.user.id, action: 'MANAGER_VERIFIED', entityType: 'employee_period_status', entityId: req.params.employeeId, metadata: { period_id: req.params.periodId }, ipAddress: req.ip });
  res.json({ ok: true });
});

router.post('/:employeeId/:periodId/accounts-verify', requireAuth, requireRole(...ACCOUNTS_VERIFIERS), async (req, res) => {
  const result = await db.transaction((trx) => accountsVerifyOne(trx, req.params.employeeId, req.params.periodId, req.user.id));
  if (!result.ok) return res.status(409).json({ error: result.reason });
  await logAudit(db, { actorUserId: req.user.id, action: 'ACCOUNTS_VERIFIED_FINAL_PAYABLE', entityType: 'employee_period_status', entityId: req.params.employeeId, metadata: { period_id: req.params.periodId, total: result.total }, ipAddress: req.ip });
  res.json({ ok: true, total: result.total });
});

// MPS 13: "Employees with unresolved warnings/issues are excluded from bulk
// verification" -- each employee gets an individual ok/skip result rather
// than the whole batch failing together.
router.post('/bulk/manager-verify', requireAuth, requireRole(...MANAGER_VERIFIERS), async (req, res) => {
  const { period_id, employee_ids } = req.body || {};
  if (!period_id || !Array.isArray(employee_ids) || !employee_ids.length) return res.status(400).json({ error: 'period_id and employee_ids[] are required.' });

  const results = {};
  for (const empId of employee_ids) {
    if (isManagerRole(req.user.role) && !(await requireEmployeeAccess(req.user, empId).then(() => true).catch(() => false))) {
      results[empId] = { ok: false, reason: 'Employee is outside your assigned Polish department.' };
      continue;
    }
    results[empId] = await db.transaction((trx) => managerVerifyOne(trx, empId, period_id, req.user.id));
  }
  await logAudit(db, { actorUserId: req.user.id, action: 'BULK_MANAGER_VERIFIED', entityType: 'employee_period_status', metadata: { period_id, results }, ipAddress: req.ip });
  res.json(results);
});

router.post('/bulk/accounts-verify', requireAuth, requireRole(...ACCOUNTS_VERIFIERS), async (req, res) => {
  const { period_id, employee_ids } = req.body || {};
  if (!period_id || !Array.isArray(employee_ids) || !employee_ids.length) return res.status(400).json({ error: 'period_id and employee_ids[] are required.' });

  const results = {};
  for (const empId of employee_ids) {
    results[empId] = await db.transaction((trx) => accountsVerifyOne(trx, empId, period_id, req.user.id));
  }
  await logAudit(db, { actorUserId: req.user.id, action: 'BULK_ACCOUNTS_VERIFIED', entityType: 'employee_period_status', metadata: { period_id, results }, ipAddress: req.ip });
  res.json(results);
});

// MPS 14 Reopen workflow: "Final Payable -> Accounts/Root Admin Reopens ->
// Verification Reset -> Correction -> Recalculation ->
// Manager Re-verification -> Accounts Re-verification -> New Final Snapshot."
router.post('/:employeeId/:periodId/reopen', requireAuth, requireRole(...ACCOUNTS_VERIFIERS), async (req, res) => {
  const { reason } = req.body || {};

  const before = await db('employee_period_status').where({ employee_id: req.params.employeeId, period_id: req.params.periodId }).first();
  if (!before) return res.status(404).json({ error: 'No payroll status found for this employee in this period.' });
  if (before.status !== 'ACCOUNTS_VERIFIED') return res.status(409).json({ error: 'Only a Final Payable (Accounts-verified) record can be reopened.' });

  const [after] = await db('employee_period_status')
    .where({ id: before.id })
    .update({
      status: 'CALCULATED',
      manager_verified_by: null,
      manager_verified_at: null,
      accounts_verified_by: null,
      accounts_verified_at: null,
      final_snapshot_total: null,
      final_snapshot_breakdown: null,
      reopened_by: req.user.id,
      reopened_at: db.fn.now(),
      reopen_reason: reason || null,
      reopen_requested_by: null,
      reopen_requested_at: null,
      reopen_request_reason: null,
      updated_at: db.fn.now(),
    })
    .returning('*');

  await logAudit(db, { actorUserId: req.user.id, action: 'FINAL_PAYABLE_REOPENED', entityType: 'employee_period_status', entityId: before.id, before, after, metadata: reason ? { reason } : undefined, ipAddress: req.ip });
  res.json(after);
});

// Manager requests a reopen
router.post('/:employeeId/:periodId/request-reopen', requireAuth, requireRole(...MANAGER_VERIFIERS), async (req, res) => {
  try {
    await requireEmployeeAccess(req.user, req.params.employeeId);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  const { reason } = req.body || {};

  const before = await db('employee_period_status').where({ employee_id: req.params.employeeId, period_id: req.params.periodId }).first();
  if (!before) return res.status(404).json({ error: 'No payroll status found for this employee in this period.' });
  if (before.status !== 'ACCOUNTS_VERIFIED') return res.status(409).json({ error: 'Reopen request can only be submitted for Final Payable (Accounts-verified) records.' });

  const [after] = await db('employee_period_status')
    .where({ id: before.id })
    .update({
      reopen_requested_by: req.user.id,
      reopen_requested_at: db.fn.now(),
      reopen_request_reason: reason || null,
      updated_at: db.fn.now(),
    })
    .returning('*');

  await logAudit(db, { actorUserId: req.user.id, action: 'FINAL_PAYABLE_REOPEN_REQUESTED', entityType: 'employee_period_status', entityId: before.id, before, after, metadata: reason ? { reason } : undefined, ipAddress: req.ip });
  res.json(after);
});

// Higher-ups reject/dismiss the reopen request
router.post('/:employeeId/:periodId/reject-reopen-request', requireAuth, requireRole(...ACCOUNTS_VERIFIERS), async (req, res) => {
  const before = await db('employee_period_status').where({ employee_id: req.params.employeeId, period_id: req.params.periodId }).first();
  if (!before) return res.status(404).json({ error: 'No payroll status found for this employee in this period.' });

  const [after] = await db('employee_period_status')
    .where({ id: before.id })
    .update({
      reopen_requested_by: null,
      reopen_requested_at: null,
      reopen_request_reason: null,
      updated_at: db.fn.now(),
    })
    .returning('*');

  await logAudit(db, { actorUserId: req.user.id, action: 'FINAL_PAYABLE_REOPEN_REQUEST_REJECTED', entityType: 'employee_period_status', entityId: before.id, before, after, ipAddress: req.ip });
  res.json(after);
});

module.exports = router;
