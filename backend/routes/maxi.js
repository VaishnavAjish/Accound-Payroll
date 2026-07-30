const express = require('express');
const db = require('../db');
const { ROLES, requireAuth, requireRole, requirePermission, staffRoles, applyEmployeeScope, requireEmployeeAccess } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { assertUniqueLot } = require('../lib/lotUniqueness');

const router = express.Router();
router.use(requireAuth, requirePermission('manage_maxi'));
const STAFF_ROLES = staffRoles();

// MPS 9: MAXI is strictly Non-Payable and must never contribute to Final
// Payable -- notice there is no rate lookup, no calculated_salary, and no
// payable_period_id anywhere in this file.
router.get('/', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const { employee_id } = req.query;
  let q = db('maxi_entries').orderBy('issue_date', 'desc');
  if (employee_id) q = q.where('employee_id', employee_id);
  q = applyEmployeeScope(q, req.user, 'employee_id');
  res.json(await q);
});

router.post('/', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const { employee_id, issue_date, lot_id, lot_name, weight } = req.body || {};
  if (!employee_id || !issue_date || !weight) return res.status(400).json({ error: 'employee_id, issue_date, and weight are required.' });
  if (new Date(issue_date) > new Date()) return res.status(400).json({ error: 'Issue Date cannot be in the future.' });
  try {
    await assertUniqueLot(db, { lotId: lot_id, lotName: lot_name });
    await requireEmployeeAccess(req.user, employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  const [row] = await db('maxi_entries').insert({ employee_id, issue_date, lot_id, lot_name, weight, created_by: req.user.id }).returning('*');
  await logAudit(db, { actorUserId: req.user.id, action: 'MAXI_CREATED', entityType: 'maxi_entry', entityId: row.id, after: row, ipAddress: req.ip });
  res.status(201).json(row);
});

router.patch('/:id', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const before = await db('maxi_entries').where({ id: req.params.id }).first();
  if (!before) return res.status(404).json({ error: 'Entry not found.' });
  try {
    await requireEmployeeAccess(req.user, before.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  if (before.period_id) {
    const period = await db('periods').where({ id: before.period_id }).first();
    if (period && period.status === 'CLOSED') {
      return res.status(409).json({ error: 'This period is closed. Data cannot be edited.' });
    }
  }

  const editable = ['issue_date', 'lot_id', 'lot_name', 'weight'];
  const update = {};
  for (const f of editable) if (req.body[f] !== undefined) update[f] = req.body[f];
  try {
    const nextLotId = update.lot_id !== undefined ? update.lot_id : before.lot_id;
    const nextLotName = update.lot_name !== undefined ? update.lot_name : before.lot_name;
    await assertUniqueLot(db, { lotId: nextLotId, lotName: nextLotName, exclude: { maxi_entries: before.id } });
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  const [after] = await db('maxi_entries').where({ id: before.id }).update(update).returning('*');
  await logAudit(db, { actorUserId: req.user.id, action: 'MAXI_UPDATED', entityType: 'maxi_entry', entityId: before.id, before, after, ipAddress: req.ip });
  res.json(after);
});

router.delete('/:id', requireAuth, requireRole(...STAFF_ROLES), async (req, res) => {
  const before = await db('maxi_entries').where({ id: req.params.id }).first();
  if (!before) return res.status(404).json({ error: 'Entry not found.' });
  try {
    await requireEmployeeAccess(req.user, before.employee_id);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  if (before.period_id) {
    const period = await db('periods').where({ id: before.period_id }).first();
    if (period && period.status === 'CLOSED') {
      return res.status(409).json({ error: 'This period is closed. Data cannot be deleted.' });
    }
  }
  await db('maxi_entries').where({ id: before.id }).del();
  await logAudit(db, { actorUserId: req.user.id, action: 'MAXI_DELETED', entityType: 'maxi_entry', entityId: before.id, before, ipAddress: req.ip });
  res.json({ ok: true });
});

module.exports = router;
