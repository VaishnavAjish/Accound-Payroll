const express = require('express');
const db = require('../db');
const { ROLES, requireAuth, requireRole, requirePermission, redactSalaryIfManager, staffRoles, applyEmployeeScope, requireEmployeeAccess } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { calculatePolishEntry, daysConsumed, sendWeightDifference } = require('../lib/calcEngine');
const { EditBlockedError, guardEntryEdit, ensurePeriodStatusRow, cleanupOrphanPeriodStatus } = require('../lib/verificationGuard');
const { requireVisiblePeriod } = require('../lib/periodAccess');
const { assertUniqueLot } = require('../lib/lotUniqueness');

const router = express.Router();
router.use(requireAuth, requirePermission('manage_department_entries'));

const STAFF_ROLES = staffRoles();
const SALARY_AFFECTING_FIELDS = ['send_weight', 'shape', 'lab_name', 'labour_head', 'issue_date'];

function currentIstTime() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

function withComputed(row) {
  return {
    ...row,
    days_consumed: daysConsumed(row.issue_date, row.received_date),
    weight_difference: sendWeightDifference(row.send_weight, row.polished_weight),
  };
}

function normalizeOptionalNumber(value) {
  return value === undefined || value === null || value === '' ? null : Number(value);
}

router.get('/', requireAuth, requireRole(...STAFF_ROLES, ROLES.EMPLOYEE), async (req, res) => {
  const employee_id = req.user.role === ROLES.EMPLOYEE ? req.user.employee_id : req.query.employee_id;
  const { period_id, status } = req.query;
  if (period_id) {
    try {
      await requireVisiblePeriod(db, req.user, period_id);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }
  }
  let q = db('polish_entries')
    .select(
      'polish_entries.*',
      db.raw(`(
        SELECT concat(min_weight, ' to ', coalesce(max_weight::text, 'UP'))
        FROM rates_polish
        WHERE rates_polish.category = polish_entries.rate_category
          AND rates_polish.min_weight <= polish_entries.send_weight
          AND (rates_polish.max_weight IS NULL OR rates_polish.max_weight >= polish_entries.send_weight)
          AND rates_polish.effective_from <= polish_entries.issue_date
          AND (rates_polish.effective_to IS NULL OR rates_polish.effective_to >= polish_entries.issue_date)
        LIMIT 1
      ) as rate_range`)
    )
    .orderBy('issue_date', 'desc');
  if (employee_id) q = q.where('employee_id', employee_id);
  q = applyEmployeeScope(q, req.user, 'employee_id');
  if (period_id) {
    q = q.where(function() {
      this.where('payable_period_id', period_id)
          .orWhereIn('status', ['DRAFT', 'LOT_IN_HAND']);
    });
  }
  if (status) q = q.where('status', status);

  const rows = await q;
  console.log("DEBUG API ROWS:", rows[0]);
  res.json(redactSalaryIfManager(req.user.role, rows.map(withComputed)));
});

router.get('/:id', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const row = await db('polish_entries')
    .select(
      'polish_entries.*',
      db.raw(`(
        SELECT concat(min_weight, ' to ', coalesce(max_weight::text, 'UP'))
        FROM rates_polish
        WHERE rates_polish.category = polish_entries.rate_category
          AND rates_polish.min_weight <= polish_entries.send_weight
          AND (rates_polish.max_weight IS NULL OR rates_polish.max_weight >= polish_entries.send_weight)
          AND rates_polish.effective_from <= polish_entries.issue_date
          AND (rates_polish.effective_to IS NULL OR rates_polish.effective_to >= polish_entries.issue_date)
        LIMIT 1
      ) as rate_range`)
    )
    .where({ id: req.params.id }).first();
  if (!row) return res.status(404).json({ error: 'Entry not found.' });
  try {
    await requireEmployeeAccess(req.user, row.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  res.json(redactSalaryIfManager(req.user.role, withComputed(row)));
});

// MPS 5.2 / 19: "Draft records may remain incomplete; Submit enforces the
// requirements for the relevant workflow stage."
router.post('/', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const b = req.body || {};
  const isDraft = !!b.is_draft;

  if (!b.employee_id) return res.status(400).json({ error: 'employee_id is required.' });
  try {
    await assertUniqueLot(db, { lotId: b.lot_id, lotName: b.lot_name });

    await requireEmployeeAccess(req.user, b.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  if (!isDraft) {
    // MPS 5.2: Polish Issue submission required fields.
    const required = ['issue_date', 'lot_id', 'lot_name', 'qty', 'shape', 'send_weight', 'estimate_weight'];
    const missing = required.filter((f) => b[f] === undefined || b[f] === null || b[f] === '');
    if (missing.length) return res.status(400).json({ error: `Missing required fields for submission: ${missing.join(', ')}` });
    if (new Date(b.issue_date) > new Date()) return res.status(400).json({ error: 'Issue Date cannot be in the future.' });
  }

  const [row] = await db('polish_entries')
    .insert({
      employee_id: b.employee_id,
      status: isDraft ? 'DRAFT' : 'LOT_IN_HAND',
      issue_date: b.issue_date || null,
      issue_time: currentIstTime(),
      lot_id: b.lot_id || null,
      lot_name: b.lot_name || null,
      qty: b.qty || null,
      shape: b.shape || null,
      send_weight: b.send_weight ?? null,
      estimate_weight: b.estimate_weight ?? null,
      labour_head: b.labour_head || 'Full Polished',
      created_by: req.user.id,
      updated_by: req.user.id,
    })
    .returning('*');

  await logAudit(db, { actorUserId: req.user.id, action: isDraft ? 'POLISH_DRAFT_CREATED' : 'POLISH_ISSUED', entityType: 'polish_entry', entityId: row.id, after: row, ipAddress: req.ip });
  res.status(201).json(redactSalaryIfManager(req.user.role, withComputed(row)));
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

  const seenLots = new Map();
  const issueTime = currentIstTime();
  const rows = [];

  for (let index = 0; index < entries.length; index += 1) {
    const b = entries[index] || {};
    const rowNumber = index + 1;
    const required = ['issue_date', 'lot_id', 'lot_name', 'qty', 'shape', 'send_weight', 'estimate_weight'];
    const missing = required.filter((f) => b[f] === undefined || b[f] === null || b[f] === '');
    if (missing.length) return res.status(400).json({ error: `Row ${rowNumber}: Missing required fields: ${missing.join(', ')}` });
    if (new Date(b.issue_date) > new Date()) return res.status(400).json({ error: `Row ${rowNumber}: Issue Date cannot be in the future.` });

    const lotKey = `${String(b.lot_id).trim().toLowerCase()}::${String(b.lot_name).trim().toLowerCase()}`;
    if (seenLots.has(lotKey)) return res.status(409).json({ error: `Row ${rowNumber}: Duplicate of row ${seenLots.get(lotKey)} in this bulk entry. Lot ID and Lot Name must be unique.` });
    seenLots.set(lotKey, rowNumber);

    try {
      await assertUniqueLot(db, { lotId: b.lot_id, lotName: b.lot_name });
    } catch (err) {
      return res.status(err.status || 403).json({ error: `Row ${rowNumber}: ${err.message}` });
    }

    rows.push({
      employee_id,
      status: 'LOT_IN_HAND',
      issue_date: b.issue_date,
      issue_time: issueTime,
      lot_id: b.lot_id,
      lot_name: b.lot_name,
      qty: normalizeOptionalNumber(b.qty),
      shape: b.shape,
      send_weight: normalizeOptionalNumber(b.send_weight),
      estimate_weight: normalizeOptionalNumber(b.estimate_weight),
      labour_head: b.labour_head || 'Full Polished',
      created_by: req.user.id,
      updated_by: req.user.id,
    });
  }

  const inserted = await db.transaction(async (trx) => trx('polish_entries').insert(rows).returning('*'));
  await logAudit(db, { actorUserId: req.user.id, action: 'POLISH_BULK_ISSUED', entityType: 'polish_entry', metadata: { employee_id, count: inserted.length }, ipAddress: req.ip });
  res.status(201).json(redactSalaryIfManager(req.user.role, inserted.map(withComputed)));
});

// Promote a DRAFT to LOT_IN_HAND, enforcing the issue-stage required fields.
router.patch('/:id/submit', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const entry = await db('polish_entries').where({ id: req.params.id }).first();
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });
  try {
    await requireEmployeeAccess(req.user, entry.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  if (entry.status !== 'DRAFT') return res.status(409).json({ error: 'Only a draft entry can be submitted.' });

  const required = ['issue_date', 'lot_id', 'lot_name', 'qty', 'shape', 'send_weight', 'estimate_weight'];
  const missing = required.filter((f) => entry[f] === undefined || entry[f] === null || entry[f] === '');
  if (missing.length) return res.status(400).json({ error: `Missing required fields for submission: ${missing.join(', ')}` });
  try {
    await assertUniqueLot(db, { lotId: entry.lot_id, lotName: entry.lot_name, exclude: { polish_entries: entry.id } });
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  const [after] = await db('polish_entries').where({ id: entry.id }).update({
    status: 'LOT_IN_HAND',
    updated_by: req.user.id,
    updated_at: db.fn.now(),
  }).returning('*');
  await logAudit(db, { actorUserId: req.user.id, action: 'POLISH_SUBMITTED', entityType: 'polish_entry', entityId: entry.id, before: entry, after, ipAddress: req.ip });
  res.json(redactSalaryIfManager(req.user.role, withComputed(after)));
});

// General field edit (issue-stage fields, before/without breaching Final Payable).
router.patch('/:id', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const entry = await db('polish_entries').where({ id: req.params.id }).first();
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });
  try {
    await requireEmployeeAccess(req.user, entry.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  const editable = ['issue_date', 'lot_id', 'lot_name', 'qty', 'shape', 'send_weight', 'estimate_weight', 'labour_head', 'received_date', 'polished_weight', 'color', 'shade', 'clarity', 'cut_pol_sym', 'grader', 'stone_level', 'lab_name', 'remarks'];
  const update = {};
  for (const f of editable) if (req.body[f] !== undefined) update[f] = req.body[f];
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No editable fields supplied.' });

  const isSalaryAffecting = editable.some((f) => SALARY_AFFECTING_FIELDS.includes(f) && update[f] !== undefined);

  try {
    const nextLotId = update.lot_id !== undefined ? update.lot_id : entry.lot_id;
    const nextLotName = update.lot_name !== undefined ? update.lot_name : entry.lot_name;
    await assertUniqueLot(db, { lotId: nextLotId, lotName: nextLotName, exclude: { polish_entries: entry.id } });

    const after = await db.transaction(async (trx) => {
      await guardEntryEdit(trx, { employeeId: entry.employee_id, periodId: entry.payable_period_id, isSalaryAffecting, actorUserId: req.user.id });

      update.updated_by = req.user.id;
      update.updated_at = trx.fn.now();
      const [row] = await trx('polish_entries').where({ id: entry.id }).update(update).returning('*');

      // MPS 5.3: recalc only applies once the entry has moved into Completed
      // (has a payable period). Draft / Lot in Hand entries just save.
      if (row.status === 'COMPLETED' && isSalaryAffecting) {
        const calc = await calculatePolishEntry(trx, row);
        if (calc.error) throw new EditBlockedError(calc.error);
        const [recalced] = await trx('polish_entries')
          .where({ id: row.id })
          .update({ rate_category: calc.rate_category, rate_snapshot: calc.rate_snapshot, calculated_salary: calc.calculated_salary, rate_missing: calc.rate_missing })
          .returning('*');
        return recalced;
      }
      return row;
    });

    await logAudit(db, { actorUserId: req.user.id, action: 'POLISH_UPDATED', entityType: 'polish_entry', entityId: entry.id, before: entry, after, ipAddress: req.ip });
    res.json(redactSalaryIfManager(req.user.role, withComputed(after)));
  } catch (err) {
    if (err instanceof EditBlockedError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// MPS 5.2 / 5.3: completion submission -> calculate salary, mark payable
// period as the currently-open default period (MPS 3.4: the official
// completion submission determines the PAYABLE period, not the received
// date).
router.patch('/:id/complete', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const entry = await db('polish_entries').where({ id: req.params.id }).first();
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });
  try {
    await requireEmployeeAccess(req.user, entry.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  if (entry.status === 'COMPLETED') return res.status(409).json({ error: 'This entry is already completed.' });
  if (entry.status === 'TRANSFERRED') return res.status(409).json({ error: 'This entry was transferred and cannot be completed here.' });

  const b = req.body || {};
  if (!b.received_date) return res.status(400).json({ error: 'received_date is required.' });
  if (new Date(b.received_date) < new Date(entry.issue_date)) return res.status(400).json({ error: 'Received Date cannot be earlier than Issue Date.' });
  if (new Date(b.received_date) > new Date()) return res.status(400).json({ error: 'Received Date cannot be in the future.' });

  if (!b.labour_head) return res.status(400).json({ error: 'labour_head is required.' });

  const isFullPolished = (b.labour_head || '').trim().toUpperCase() === 'FULL POLISHED';
  if (isFullPolished) {
    const required = ['polished_weight', 'color', 'shade', 'clarity', 'cut_pol_sym', 'grader', 'stone_level', 'lab_name'];
    const missing = required.filter((f) => b[f] === undefined || b[f] === null || b[f] === '');
    if (missing.length) return res.status(400).json({ error: `Full Polished completion requires: ${missing.join(', ')}` });
  }

  try {
    const openPeriod = await db('periods').where('status', 'OPEN').orderBy('start_date', 'desc').first();
    if (!openPeriod) return res.status(409).json({ error: 'No open payable period is available to submit into.' });

    const after = await db.transaction(async (trx) => {
      const completionFields = {
        received_date: b.received_date,
        received_time: currentIstTime(),
        polished_weight: b.polished_weight ?? null,
        color: b.color || null,
        shade: b.shade || null,
        clarity: b.clarity || null,
        cut_pol_sym: b.cut_pol_sym || null,
        grader: b.grader || null,
        stone_level: b.stone_level || null,
        lab_name: b.lab_name || null,
        remarks: b.remarks || null,
        labour_head: b.labour_head,
      };

      const calc = await calculatePolishEntry(trx, { ...entry, ...completionFields });
      if (calc.error) throw new EditBlockedError(calc.error);

      const [row] = await trx('polish_entries')
        .where({ id: entry.id })
        .update({
          ...completionFields,
          status: 'COMPLETED',
          payable_period_id: openPeriod.id,
          rate_category: calc.rate_category,
          rate_snapshot: calc.rate_snapshot,
          calculated_salary: calc.calculated_salary,
          rate_missing: calc.rate_missing,
          updated_by: req.user.id,
          updated_at: trx.fn.now(),
        })
        .returning('*');

      await ensurePeriodStatusRow(trx, { employeeId: row.employee_id, periodId: openPeriod.id });
      return row;
    });

    await logAudit(db, { actorUserId: req.user.id, action: 'POLISH_COMPLETED', entityType: 'polish_entry', entityId: entry.id, before: entry, after, ipAddress: req.ip });
    res.json(redactSalaryIfManager(req.user.role, withComputed(after)));
  } catch (err) {
    if (err instanceof EditBlockedError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// MPS 7: "Changing a completed record back to Lot in Hand before
// finalization removes its salary from the affected employee-period total
// and resets verification where required."
router.patch('/:id/revert-to-lot-in-hand', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const entry = await db('polish_entries').where({ id: req.params.id }).first();
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });
  try {
    await requireEmployeeAccess(req.user, entry.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  if (entry.status !== 'COMPLETED') return res.status(409).json({ error: 'Only a completed entry can be reverted to Lot in Hand.' });

  try {
    const after = await db.transaction(async (trx) => {
      await guardEntryEdit(trx, { employeeId: entry.employee_id, periodId: entry.payable_period_id, isSalaryAffecting: true, actorUserId: req.user.id });

      const [row] = await trx('polish_entries')
        .where({ id: entry.id })
        .update({
          status: 'LOT_IN_HAND',
          payable_period_id: null,
          rate_category: null,
          rate_snapshot: null,
          calculated_salary: null,
          rate_missing: false,
          updated_by: req.user.id,
          updated_at: trx.fn.now(),
        })
        .returning('*');
      return row;
    });

    await logAudit(db, { actorUserId: req.user.id, action: 'POLISH_REVERTED_TO_LOT_IN_HAND', entityType: 'polish_entry', entityId: entry.id, before: entry, after, ipAddress: req.ip });
    res.json(redactSalaryIfManager(req.user.role, withComputed(after)));
  } catch (err) {
    if (err instanceof EditBlockedError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// MPS 7: real physical reassignment. Original closes Non-Payable
// (labour_head Transfer); a brand new linked entry is created for the
// receiving employee with its own new Issue Date and rate.
router.post('/:id/reassign', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const original = await db('polish_entries').where({ id: req.params.id }).first();
  if (!original) return res.status(404).json({ error: 'Entry not found.' });

  const { new_employee_id, new_issue_date, send_weight_received, reason } = req.body || {};
  if (!new_employee_id || !new_issue_date || !send_weight_received || !reason) {
    return res.status(400).json({ error: 'new_employee_id, new_issue_date, send_weight_received, and reason are required.' });
  }
  try {
    await requireEmployeeAccess(req.user, original.employee_id);
    await requireEmployeeAccess(req.user, new_employee_id);
    await assertUniqueLot(db, { lotId: original.lot_id, lotName: original.lot_name });
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await guardEntryEdit(trx, { employeeId: original.employee_id, periodId: original.payable_period_id, isSalaryAffecting: true, actorUserId: req.user.id });

      const [closedOriginal] = await trx('polish_entries')
        .where({ id: original.id })
        .update({
          status: 'TRANSFERRED',
          labour_head: 'Transfer',
          calculated_salary: 0,
          rate_missing: false,
          reassignment_reason: reason,
          updated_by: req.user.id,
          updated_at: trx.fn.now(),
        })
        .returning('*');

      const [newAssignment] = await trx('polish_entries')
        .insert({
          employee_id: new_employee_id,
          status: 'LOT_IN_HAND',
          issue_date: new_issue_date,
          issue_time: currentIstTime(),
          lot_id: original.lot_id,
          lot_name: original.lot_name,
          qty: original.qty,
          shape: original.shape,
          send_weight: send_weight_received,
          estimate_weight: original.estimate_weight,
          labour_head: 'Full Polished',
          reassigned_from_entry_id: original.id,
          reassignment_reason: reason,
          created_by: req.user.id,
          updated_by: req.user.id,
        })
        .returning('*');

      return { closedOriginal, newAssignment };
    });

    await logAudit(db, { actorUserId: req.user.id, action: 'POLISH_REASSIGNED', entityType: 'polish_entry', entityId: original.id, before: original, after: result, metadata: { reason }, ipAddress: req.ip });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof EditBlockedError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

router.delete('/:id', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const entry = await db('polish_entries').where({ id: req.params.id }).first();
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
  }

  if (entry.status === 'COMPLETED' && entry.payable_period_id) {
    const status = await db('employee_period_status').where({ employee_id: entry.employee_id, period_id: entry.payable_period_id }).first();
    if (status && status.status === 'ACCOUNTS_VERIFIED') return res.status(409).json({ error: 'Cannot delete: this employee-period is Final Payable. Use Reopen for Correction.' });
  }

  await db.transaction(async (trx) => {
    await trx('polish_entries').where({ id: entry.id }).del();
    if (entry.payable_period_id) {
      await cleanupOrphanPeriodStatus(trx, { employeeId: entry.employee_id, periodId: entry.payable_period_id });
    }
  });
  // MPS 14: "Incorrect entries may be deleted only under the approved
  // lifecycle rules; a minimal audit/security event remains."
  await logAudit(db, { actorUserId: req.user.id, action: 'POLISH_DELETED', entityType: 'polish_entry', entityId: entry.id, before: entry, ipAddress: req.ip });
  res.json({ ok: true });
});

module.exports = router;
