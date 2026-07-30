const express = require('express');
const db = require('../db');
const { ROLES, requireAuth, requireRole, requirePermission, redactSalaryIfManager, staffRoles, applyEmployeeScope, requireEmployeeAccess } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { calculateDharEntry } = require('../lib/calcEngine');
const { EditBlockedError, guardEntryEdit, ensurePeriodStatusRow, cleanupOrphanPeriodStatus } = require('../lib/verificationGuard');
const { requireVisiblePeriod } = require('../lib/periodAccess');
const { assertUniqueLot } = require('../lib/lotUniqueness');

const router = express.Router();
router.use(requireAuth, requirePermission('manage_department_entries'));

const STAFF_ROLES = staffRoles();
const SALARY_AFFECTING_FIELDS = ['weight', 'shape_classification', 'issue_date'];

function normalizeOptionalNumber(value) {
  return value === undefined || value === null || value === '' ? null : Number(value);
}

router.get('/', requireAuth, requireRole(...STAFF_ROLES, ROLES.EMPLOYEE), async (req, res) => {
  const employee_id = req.user.role === ROLES.EMPLOYEE ? req.user.employee_id : req.query.employee_id;
  const { period_id } = req.query;
  if (period_id) {
    try {
      await requireVisiblePeriod(db, req.user, period_id);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }
  }
  let q = db('dhar_entries').orderBy('issue_date', 'desc');
  if (employee_id) q = q.where('employee_id', employee_id);
  q = applyEmployeeScope(q, req.user, 'employee_id');
  if (period_id) {
    q = q.where(function() {
      this.where('payable_period_id', period_id)
          .orWhere('status', 'LOT_IN_HAND');
    });
  }
  res.json(redactSalaryIfManager(req.user.role, await q));
});

// MPS 8: DHAR is a single normalized record -- no Draft/Lot-in-Hand staging
// (MPS 4 defines Lot in Hand as specifically unfinished *Polish* work), so
// creation is immediately calculated and payable into the current period.
router.post('/', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const b = req.body || {};
  const required = ['employee_id', 'issue_date', 'lot_id', 'lot_name', 'weight', 'shape_classification'];
  const missing = required.filter((f) => b[f] === undefined || b[f] === null || b[f] === '');
  if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  if (!['ALL_SHAPE', 'ROUND'].includes(b.shape_classification)) return res.status(400).json({ error: 'shape_classification must be ALL_SHAPE or ROUND.' });
  if (new Date(b.issue_date) > new Date()) return res.status(400).json({ error: 'Issue Date cannot be in the future.' });
  try {
    await assertUniqueLot(db, { lotId: b.lot_id, lotName: b.lot_name });
    await requireEmployeeAccess(req.user, b.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  const openPeriod = await db('periods').where('status', 'OPEN').orderBy('start_date', 'desc').first();
  if (!openPeriod) return res.status(409).json({ error: 'No open payable period is available to submit into.' });

  const calc = await calculateDharEntry(db, b);

  const after = await db.transaction(async (trx) => {
    const [row] = await trx('dhar_entries')
      .insert({
        employee_id: b.employee_id,
        issue_date: b.issue_date,
        lot_id: b.lot_id,
        lot_name: b.lot_name,
        weight: b.weight,
        shape_classification: b.shape_classification,
        weight_slab: calc.weight_slab,
        status: 'LOT_IN_HAND',
        created_by: req.user.id,
        updated_by: req.user.id,
      })
      .returning('*');
    return row;
  });

  await logAudit(db, { actorUserId: req.user.id, action: 'DHAR_ISSUED', entityType: 'dhar_entry', entityId: after.id, after, ipAddress: req.ip });
  res.status(201).json(redactSalaryIfManager(req.user.role, after));
});

router.post('/bulk', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const { employee_id, entries } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: 'employee_id is required.' });
  if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: 'At least one lot row is required.' });

  try {
    await requireEmployeeAccess(req.user, employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  const openPeriod = await db('periods').where('status', 'OPEN').orderBy('start_date', 'desc').first();
  if (!openPeriod) return res.status(409).json({ error: 'No open payable period is available to submit into.' });

  const seenLots = new Map();
  const rows = [];

  for (let index = 0; index < entries.length; index += 1) {
    const b = entries[index] || {};
    const rowNumber = index + 1;
    const required = ['issue_date', 'lot_id', 'lot_name', 'weight', 'shape_classification'];
    const missing = required.filter((f) => b[f] === undefined || b[f] === null || b[f] === '');
    if (missing.length) return res.status(400).json({ error: `Row ${rowNumber}: Missing required fields: ${missing.join(', ')}` });
    if (!['ALL_SHAPE', 'ROUND'].includes(b.shape_classification)) return res.status(400).json({ error: `Row ${rowNumber}: shape_classification must be ALL_SHAPE or ROUND.` });
    if (new Date(b.issue_date) > new Date()) return res.status(400).json({ error: `Row ${rowNumber}: Issue Date cannot be in the future.` });

    const lotKey = `${String(b.lot_id).trim().toLowerCase()}::${String(b.lot_name).trim().toLowerCase()}`;
    if (seenLots.has(lotKey)) return res.status(409).json({ error: `Row ${rowNumber}: Duplicate of row ${seenLots.get(lotKey)} in this bulk entry. Lot ID and Lot Name must be unique.` });
    seenLots.set(lotKey, rowNumber);

    try {
      await assertUniqueLot(db, { lotId: b.lot_id, lotName: b.lot_name });
    } catch (err) {
      return res.status(err.status || 403).json({ error: `Row ${rowNumber}: ${err.message}` });
    }

    const calc = await calculateDharEntry(db, { ...b, employee_id });
    rows.push({
      employee_id,
      issue_date: b.issue_date,
      lot_id: b.lot_id,
      lot_name: b.lot_name,
      weight: normalizeOptionalNumber(b.weight),
      shape_classification: b.shape_classification,
      weight_slab: calc.weight_slab,
      status: 'LOT_IN_HAND',
      created_by: req.user.id,
      updated_by: req.user.id,
    });
  }

  const inserted = await db.transaction(async (trx) => trx('dhar_entries').insert(rows).returning('*'));
  await logAudit(db, { actorUserId: req.user.id, action: 'DHAR_BULK_ISSUED', entityType: 'dhar_entry', metadata: { employee_id, count: inserted.length }, ipAddress: req.ip });
  res.status(201).json(redactSalaryIfManager(req.user.role, inserted));
});

router.patch('/:id/return', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const { received_date, remarks } = req.body || {};
  if (!received_date) return res.status(400).json({ error: 'received_date is required to return a lot.' });

  const entry = await db('dhar_entries').where({ id: req.params.id }).first();
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });
  try {
    await requireEmployeeAccess(req.user, entry.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  if (entry.status === 'COMPLETED') return res.status(409).json({ error: 'This entry is already returned.' });

  const openPeriod = await db('periods').where('status', 'OPEN').orderBy('start_date', 'desc').first();
  if (!openPeriod) return res.status(409).json({ error: 'No open payable period is available to submit into.' });

  const calc = await calculateDharEntry(db, entry);

  const after = await db.transaction(async (trx) => {
    const [row] = await trx('dhar_entries').where({ id: entry.id }).update({
      received_date,
      remarks,
      status: 'COMPLETED',
      payable_period_id: openPeriod.id,
      weight_slab: calc.weight_slab,
      rate_snapshot: calc.rate_snapshot,
      calculated_salary: calc.calculated_salary,
      rate_missing: calc.rate_missing,
      updated_by: req.user.id,
      updated_at: trx.fn.now()
    }).returning('*');
    await ensurePeriodStatusRow(trx, { employeeId: row.employee_id, periodId: openPeriod.id });
    return row;
  });

  await logAudit(db, { actorUserId: req.user.id, action: 'DHAR_RETURNED', entityType: 'dhar_entry', entityId: entry.id, before: entry, after, ipAddress: req.ip });
  res.json(redactSalaryIfManager(req.user.role, after));
});

router.patch('/:id/revert-to-lot-in-hand', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const entry = await db('dhar_entries').where({ id: req.params.id }).first();
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });
  try {
    await requireEmployeeAccess(req.user, entry.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  if (entry.status !== 'COMPLETED') return res.status(409).json({ error: 'Only a returned entry can be reverted.' });

  const after = await db.transaction(async (trx) => {
    await guardEntryEdit(trx, { employeeId: entry.employee_id, periodId: entry.payable_period_id, isSalaryAffecting: true, actorUserId: req.user.id });

    const [row] = await trx('dhar_entries').where({ id: entry.id }).update({
      status: 'LOT_IN_HAND',
      received_date: null,
      payable_period_id: null,
      rate_snapshot: null,
      calculated_salary: null,
      rate_missing: false,
      updated_by: req.user.id,
      updated_at: trx.fn.now()
    }).returning('*');
    return row;
  });

  await logAudit(db, { actorUserId: req.user.id, action: 'DHAR_REVERTED', entityType: 'dhar_entry', entityId: entry.id, before: entry, after, ipAddress: req.ip });
  res.json(redactSalaryIfManager(req.user.role, after));
});

router.patch('/:id', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const entry = await db('dhar_entries').where({ id: req.params.id }).first();
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });
  try {
    await requireEmployeeAccess(req.user, entry.employee_id);
    if (req.body.employee_id !== undefined) await requireEmployeeAccess(req.user, req.body.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  const editable = ['employee_id', 'issue_date', 'lot_id', 'lot_name', 'weight', 'shape_classification'];
  const update = {};
  for (const f of editable) if (req.body[f] !== undefined) update[f] = req.body[f];
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No editable fields supplied.' });

  const isSalaryAffecting = editable.some((f) => SALARY_AFFECTING_FIELDS.includes(f) && update[f] !== undefined);

  try {
    const nextLotId = update.lot_id !== undefined ? update.lot_id : entry.lot_id;
    const nextLotName = update.lot_name !== undefined ? update.lot_name : entry.lot_name;
    await assertUniqueLot(db, { lotId: nextLotId, lotName: nextLotName, exclude: { dhar_entries: entry.id } });

    const after = await db.transaction(async (trx) => {
      await guardEntryEdit(trx, { employeeId: entry.employee_id, periodId: entry.payable_period_id, isSalaryAffecting, actorUserId: req.user.id });

      const merged = { ...entry, ...update };
      if (isSalaryAffecting && merged.status === 'COMPLETED') {
        const calc = await calculateDharEntry(trx, merged);
        update.weight_slab = calc.weight_slab;
        update.rate_snapshot = calc.rate_snapshot;
        update.calculated_salary = calc.calculated_salary;
        update.rate_missing = calc.rate_missing;
      }
      update.updated_by = req.user.id;
      update.updated_at = trx.fn.now();

      const [row] = await trx('dhar_entries').where({ id: entry.id }).update(update).returning('*');
      return row;
    });

    await logAudit(db, { actorUserId: req.user.id, action: 'DHAR_UPDATED', entityType: 'dhar_entry', entityId: entry.id, before: entry, after, ipAddress: req.ip });
    res.json(redactSalaryIfManager(req.user.role, after));
  } catch (err) {
    if (err instanceof EditBlockedError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

router.delete('/:id', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const entry = await db('dhar_entries').where({ id: req.params.id }).first();
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });
  try {
    await requireEmployeeAccess(req.user, entry.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  if (entry.payable_period_id) {
    const period = await db('periods').where({ id: entry.payable_period_id }).first();
    if (period && period.status === 'CLOSED') {
      return res.status(409).json({ error: 'Cannot delete: this period is closed.' });
    }
    const status = await db('employee_period_status').where({ employee_id: entry.employee_id, period_id: entry.payable_period_id }).first();
    if (status && status.status === 'ACCOUNTS_VERIFIED') return res.status(409).json({ error: 'Cannot delete: this employee-period is Final Payable. Use Reopen for Correction.' });
  }

  await db.transaction(async (trx) => {
    await trx('dhar_entries').where({ id: entry.id }).del();
    if (entry.payable_period_id) {
      await cleanupOrphanPeriodStatus(trx, { employeeId: entry.employee_id, periodId: entry.payable_period_id });
    }
  });
  await logAudit(db, { actorUserId: req.user.id, action: 'DHAR_DELETED', entityType: 'dhar_entry', entityId: entry.id, before: entry, ipAddress: req.ip });
  res.json({ ok: true });
});

module.exports = router;
