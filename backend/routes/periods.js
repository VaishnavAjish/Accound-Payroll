const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, requirePermission, staffRoles, accountantRoles, hasPermission } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');

const router = express.Router();

// MPS 3.6: "Managers can work only in available open periods and cannot
// open, close, or reopen periods" -- but read access to the list (including
// closed periods, for historical reference) is not restricted.
router.get('/', requireAuth, requireRole(...staffRoles()), async (req, res) => {
  let query = db('periods').orderBy('start_date', 'desc');
  if (!(await hasPermission(req.user, 'view_closed_periods'))) {
    query = query.where('status', 'OPEN');
  }
  const rows = await query;
  res.json(rows);
});

// MPS 3.6: "Multiple periods may remain open when necessary; the latest open
// period is the default." No open period existing yet is a normal state (a
// fresh install, or a gap between periods) rather than an error condition,
// so this returns 200 + null instead of 404 -- callers check for null, they
// don't need to treat "there's nothing to give you" as a failed request.
router.get('/default', requireAuth, requireRole(...staffRoles()), async (req, res) => {
  const row = await db('periods').where('status', 'OPEN').orderBy('start_date', 'desc').first();
  res.json(row || null);
});

router.post('/', requireAuth, requireRole(...accountantRoles()), requirePermission('manage_periods'), async (req, res) => {
  const { name, start_date, end_date } = req.body || {};
  if (!name || !start_date || !end_date) return res.status(400).json({ error: 'name, start_date, and end_date are required.' });

  const [period] = await db('periods').insert({ name, start_date, end_date, status: 'OPEN', opened_by: req.user.id }).returning('*');
  await logAudit(db, { actorUserId: req.user.id, action: 'PERIOD_OPENED', entityType: 'period', entityId: period.id, after: period, ipAddress: req.ip });
  res.status(201).json(period);
});

router.post('/:id/close', requireAuth, requireRole(...accountantRoles()), requirePermission('manage_periods'), async (req, res) => {
  const before = await db('periods').where({ id: req.params.id }).first();
  if (!before) return res.status(404).json({ error: 'Period not found.' });
  if (before.status === 'CLOSED') return res.status(409).json({ error: 'Period is already closed.' });

  // MPS 4: "Closing a month does not require all Lot in Hand records to be
  // completed" -- no completion check here by design; Lot in Hand simply
  // carries forward (it already has no payable_period_id set until
  // completion, so nothing further needs to happen to it at close time).
  const [after] = await db('periods').where({ id: before.id }).update({ status: 'CLOSED', closed_by: req.user.id, closed_at: db.fn.now() }).returning('*');
  await logAudit(db, { actorUserId: req.user.id, action: 'PERIOD_CLOSED', entityType: 'period', entityId: before.id, before, after, ipAddress: req.ip });
  res.json(after);
});

// MPS 3.6: "Root Admin has full override authority, including controlled
// reopening." Reopening a period is distinct from reopening an individual
// employee-month's Final Payable (see verification.js) -- this just lets
// Managers submit into it again.
router.post('/:id/reopen', requireAuth, requireRole(...accountantRoles()), requirePermission('manage_periods'), async (req, res) => {
  const { reason } = req.body || {};

  const before = await db('periods').where({ id: req.params.id }).first();
  if (!before) return res.status(404).json({ error: 'Period not found.' });
  if (before.status !== 'CLOSED') return res.status(409).json({ error: 'Only a closed period can be reopened.' });

  const [after] = await db('periods').where({ id: before.id }).update({ status: 'OPEN', reopened_by: req.user.id, reopened_at: db.fn.now() }).returning('*');
  await logAudit(db, { actorUserId: req.user.id, action: 'PERIOD_REOPENED', entityType: 'period', entityId: before.id, before, after, metadata: reason ? { reason } : undefined, ipAddress: req.ip });
  res.json(after);
});

module.exports = router;
