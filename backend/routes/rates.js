const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, requirePermission, rateMasterRoles } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { calculatePolishEntry, calculateDharEntry } = require('../lib/calcEngine');

const router = express.Router();

async function reevaluateMissingRates() {
  try {
    const missingPolish = await db('polish_entries').where({ rate_missing: true });
    for (const entry of missingPolish) {
      const calc = await calculatePolishEntry(db, entry);
      if (!calc.rate_missing) {
        await db('polish_entries').where({ id: entry.id }).update({
          rate_category: calc.rate_category,
          rate_snapshot: calc.rate_snapshot,
          calculated_salary: calc.calculated_salary,
          rate_missing: false
        });
      }
    }

    const missingDhar = await db('dhar_entries').where({ rate_missing: true });
    for (const entry of missingDhar) {
      const calc = await calculateDharEntry(db, entry);
      if (!calc.rate_missing) {
        await db('dhar_entries').where({ id: entry.id }).update({
          weight_slab: calc.weight_slab,
          rate_snapshot: calc.rate_snapshot,
          calculated_salary: calc.calculated_salary,
          rate_missing: false
        });
      }
    }
  } catch (err) {
    console.error('Error reevaluating missing rates:', err);
  }
}

// MPS 16: rate management belongs to Accounts / Root Admin only -- Manager
// has "no rate management" per the roles table.
const RATE_MANAGERS = rateMasterRoles();

router.get('/polish', requireAuth, requireRole(...RATE_MANAGERS), requirePermission('manage_rates'), async (req, res) => {
  const rows = await db('rates_polish').orderBy(['category', 'min_weight', 'effective_from']);
  res.json(rows);
});

router.get('/dhar', requireAuth, requireRole(...RATE_MANAGERS), requirePermission('manage_rates'), async (req, res) => {
  const rows = await db('rates_dhar').orderBy(['classification', 'weight_slab', 'effective_from']);
  res.json(rows);
});

function dayBefore(dateStr) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

// MPS 11: "Historical rates and finalized payroll are immutable." A rate
// change is never an edit to an existing row -- it closes out whichever row
// is currently open-ended for the same slab (setting only its effective_to
// boundary) and inserts a new versioned row. "Future rate versions may be
// prepared in advance" by passing an effective_from in the future.
router.post('/polish', requireAuth, requireRole(...RATE_MANAGERS), requirePermission('manage_rates'), async (req, res) => {
  const { category, min_weight, max_weight, rate_per_ct, effective_from } = req.body || {};
  if (!category || min_weight === undefined || !rate_per_ct || !effective_from) {
    return res.status(400).json({ error: 'category, min_weight, rate_per_ct, and effective_from are required.' });
  }
  if (!['ROUND_OEB', 'FANCY_IGI', 'FANCY_GIA'].includes(category)) {
    return res.status(400).json({ error: 'category must be ROUND_OEB, FANCY_IGI, or FANCY_GIA.' });
  }
  if (Number(rate_per_ct) <= 0) return res.status(400).json({ error: 'rate_per_ct must be a positive number.' });

  try {
    const created = await db.transaction(async (trx) => {
      const openEnded = await trx('rates_polish')
        .where({ category, min_weight })
        .andWhere((qb) => (max_weight == null ? qb.whereNull('max_weight') : qb.where('max_weight', max_weight)))
        .whereNull('effective_to')
        .first();

      if (openEnded) {
        await trx('rates_polish').where({ id: openEnded.id }).update({ effective_to: dayBefore(effective_from) });
      }

      const [row] = await trx('rates_polish')
        .insert({ category, min_weight, max_weight: max_weight ?? null, rate_per_ct, effective_from, created_by: req.user.id })
        .returning('*');
      return row;
    });

    await logAudit(db, { actorUserId: req.user.id, action: 'POLISH_RATE_VERSIONED', entityType: 'rates_polish', entityId: created.id, after: created, ipAddress: req.ip });
    await reevaluateMissingRates();
    res.status(201).json(created);
  } catch (err) {
    if (err.code === '23P01') return res.status(409).json({ error: 'This creates an overlapping rate for the same category/weight slab and time window.' });
    throw err;
  }
});

router.post('/dhar', requireAuth, requireRole(...RATE_MANAGERS), requirePermission('manage_rates'), async (req, res) => {
  const { classification, weight_slab, rate_per_ct, effective_from } = req.body || {};
  if (!classification || !weight_slab || !rate_per_ct || !effective_from) {
    return res.status(400).json({ error: 'classification, weight_slab, rate_per_ct, and effective_from are required.' });
  }
  if (!['ALL_SHAPE', 'ROUND'].includes(classification)) return res.status(400).json({ error: 'classification must be ALL_SHAPE or ROUND.' });
  if (!['LT_2', 'GTE_2'].includes(weight_slab)) return res.status(400).json({ error: 'weight_slab must be LT_2 or GTE_2.' });
  if (Number(rate_per_ct) <= 0) return res.status(400).json({ error: 'rate_per_ct must be a positive number.' });

  try {
    const created = await db.transaction(async (trx) => {
      const openEnded = await trx('rates_dhar').where({ classification, weight_slab }).whereNull('effective_to').first();
      if (openEnded) {
        await trx('rates_dhar').where({ id: openEnded.id }).update({ effective_to: dayBefore(effective_from) });
      }
      const [row] = await trx('rates_dhar')
        .insert({ classification, weight_slab, rate_per_ct, effective_from, created_by: req.user.id })
        .returning('*');
      return row;
    });

    await logAudit(db, { actorUserId: req.user.id, action: 'DHAR_RATE_VERSIONED', entityType: 'rates_dhar', entityId: created.id, after: created, ipAddress: req.ip });
    await reevaluateMissingRates();
    res.status(201).json(created);
  } catch (err) {
    if (err.code === '23P01') return res.status(409).json({ error: 'This creates an overlapping rate for the same classification/slab and time window.' });
    throw err;
  }
});

router.put('/polish/:id', requireAuth, requireRole(...RATE_MANAGERS), async (req, res) => {
  const { id } = req.params;
  const { category, min_weight, max_weight, rate_per_ct, effective_from, effective_to } = req.body;
  
  if (rate_per_ct && Number(rate_per_ct) <= 0) {
    return res.status(400).json({ error: 'rate_per_ct must be a positive number.' });
  }

  try {
    const [updated] = await db('rates_polish')
      .where({ id })
      .update({
        ...(category && { category }),
        ...(min_weight !== undefined && { min_weight }),
        ...(max_weight !== undefined && { max_weight: max_weight || null }),
        ...(rate_per_ct && { rate_per_ct }),
        ...(effective_from && { effective_from }),
        ...(effective_to !== undefined && { effective_to: effective_to || null })
      })
      .returning('*');

    if (!updated) return res.status(404).json({ error: 'Rate not found.' });

    await logAudit(db, { actorUserId: req.user.id, action: 'POLISH_RATE_EDITED', entityType: 'rates_polish', entityId: updated.id, after: updated, ipAddress: req.ip });
    await reevaluateMissingRates();
    res.json(updated);
  } catch (err) {
    if (err.code === '23P01') return res.status(409).json({ error: 'This creates an overlapping rate time window.' });
    throw err;
  }
});

router.put('/dhar/:id', requireAuth, requireRole(...RATE_MANAGERS), async (req, res) => {
  const { id } = req.params;
  const { classification, weight_slab, rate_per_ct, effective_from, effective_to } = req.body;

  if (rate_per_ct && Number(rate_per_ct) <= 0) {
    return res.status(400).json({ error: 'rate_per_ct must be a positive number.' });
  }

  try {
    const [updated] = await db('rates_dhar')
      .where({ id })
      .update({
        ...(classification && { classification }),
        ...(weight_slab && { weight_slab }),
        ...(rate_per_ct && { rate_per_ct }),
        ...(effective_from && { effective_from }),
        ...(effective_to !== undefined && { effective_to: effective_to || null })
      })
      .returning('*');

    if (!updated) return res.status(404).json({ error: 'Rate not found.' });

    await logAudit(db, { actorUserId: req.user.id, action: 'DHAR_RATE_EDITED', entityType: 'rates_dhar', entityId: updated.id, after: updated, ipAddress: req.ip });
    await reevaluateMissingRates();
    res.json(updated);
  } catch (err) {
    if (err.code === '23P01') return res.status(409).json({ error: 'This creates an overlapping rate time window.' });
    throw err;
  }
});

module.exports = router;
