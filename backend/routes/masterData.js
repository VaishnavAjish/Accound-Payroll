const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, requirePermission, staffRoles, rateMasterRoles } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');

const router = express.Router();

// MPS 10: "Master values must be centrally managed. Historically used values
// are deactivated rather than destructively deleted." -- there is
// deliberately no DELETE route in this file.
router.get('/', requireAuth, requireRole(...staffRoles()), async (req, res) => {
  const { category, includeInactive } = req.query;
  let q = db('master_data').orderBy(['category', 'sort_order', 'value']);
  if (category) q = q.where('category', category);
  if (includeInactive !== 'true') q = q.where('active', true);
  res.json(await q);
});

router.post('/', requireAuth, requireRole(...rateMasterRoles()), requirePermission('manage_master_data'), async (req, res) => {
  const { category, value, is_round_classification } = req.body || {};
  if (!category || !value) return res.status(400).json({ error: 'category and value are required.' });

  const [row] = await db('master_data')
    .insert({ category, value, is_round_classification: !!is_round_classification })
    .returning('*');
  await logAudit(db, { actorUserId: req.user.id, action: 'MASTER_DATA_CREATED', entityType: 'master_data', entityId: row.id, after: row, ipAddress: req.ip });
  res.status(201).json(row);
});

router.post('/:id/deactivate', requireAuth, requireRole(...rateMasterRoles()), requirePermission('manage_master_data'), async (req, res) => {
  const [row] = await db('master_data').where({ id: req.params.id }).update({ active: false }).returning('*');
  if (!row) return res.status(404).json({ error: 'Master data value not found.' });
  await logAudit(db, { actorUserId: req.user.id, action: 'MASTER_DATA_DEACTIVATED', entityType: 'master_data', entityId: row.id, after: row, ipAddress: req.ip });
  res.json(row);
});

router.post('/:id/reactivate', requireAuth, requireRole(...rateMasterRoles()), requirePermission('manage_master_data'), async (req, res) => {
  const [row] = await db('master_data').where({ id: req.params.id }).update({ active: true }).returning('*');
  if (!row) return res.status(404).json({ error: 'Master data value not found.' });
  await logAudit(db, { actorUserId: req.user.id, action: 'MASTER_DATA_REACTIVATED', entityType: 'master_data', entityId: row.id, after: row, ipAddress: req.ip });
  res.json(row);
});

module.exports = router;
