const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, requirePermission, staffRoles, applyEmployeeScope } = require('../middleware/auth');
const { requireVisiblePeriod } = require('../lib/periodAccess');

const router = express.Router();

router.use(requireAuth, requireRole(...staffRoles()), requirePermission('view_dashboard'));

const OFFICE_START_MINUTES = 9 * 60;
const OFFICE_END_MINUTES = 20 * 60;
const WORK_HOURS_START_PERIOD = '2026-08-01';

function parseDateParts(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function dateSerial(value) {
  const parts = parseDateParts(value);
  if (!parts) return null;
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

function timeMinutes(value, fallbackMinutes) {
  const match = String(value || '').slice(0, 8).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallbackMinutes;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallbackMinutes;
  return (hours * 60) + minutes;
}

function entryWorkHours(entry) {
  if (!entry.issue_date || !entry.received_date) return 0;
  const issueDay = dateSerial(entry.issue_date);
  const receivedDay = dateSerial(entry.received_date);
  if (issueDay === null || receivedDay === null || receivedDay < issueDay) return 0;

  const issueMinute = timeMinutes(entry.issue_time, OFFICE_START_MINUTES);
  const receivedMinute = timeMinutes(entry.received_time, OFFICE_END_MINUTES);
  let workedMinutes = 0;

  for (let day = issueDay; day <= receivedDay; day += 1) {
    const dayStart = day === issueDay ? issueMinute : OFFICE_START_MINUTES;
    const dayEnd = day === receivedDay ? receivedMinute : OFFICE_END_MINUTES;
    const clampedStart = Math.max(dayStart, OFFICE_START_MINUTES);
    const clampedEnd = Math.min(dayEnd, OFFICE_END_MINUTES);
    workedMinutes += Math.max(0, clampedEnd - clampedStart);
  }

  return workedMinutes / 60;
}

router.get('/stats', async (req, res) => {
  const periodId = req.query.period_id;
  if (!periodId) return res.status(400).json({ error: 'period_id is required' });
  try {
    await requireVisiblePeriod(db, req.user, periodId);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  // 1. Snapshot Aggregations (Total Polish Yield, Total Production, Total Payable Projection)
  const polishStats = await applyEmployeeScope(db('polish_entries'), req.user)
    .where({ payable_period_id: periodId, status: 'COMPLETED' })
    .select(
      db.raw('COALESCE(SUM(send_weight), 0) as total_send_weight'),
      db.raw('COALESCE(SUM(polished_weight), 0) as total_polished'),
      db.raw('COALESCE(SUM(calculated_salary), 0) as total_polish_salary')
    )
    .first();

  const dharStats = await applyEmployeeScope(db('dhar_entries'), req.user)
    .where({ payable_period_id: periodId })
    .select(
      db.raw('COALESCE(SUM(weight), 0) as total_dhar_weight'),
      db.raw('COALESCE(SUM(calculated_salary), 0) as total_dhar_salary')
    )
    .first();

  const [polishLotsInHand] = await applyEmployeeScope(db('polish_entries'), req.user).where({ status: 'LOT_IN_HAND' }).count('* as cnt');
  const [polishLotsReturned] = await applyEmployeeScope(db('polish_entries'), req.user).where({ payable_period_id: periodId, status: 'COMPLETED' }).count('* as cnt');
  const [dharLotsInHand] = await applyEmployeeScope(db('dhar_entries'), req.user).where({ status: 'LOT_IN_HAND' }).count('* as cnt');
  const [dharLotsReturned] = await applyEmployeeScope(db('dhar_entries'), req.user).where({ payable_period_id: periodId, status: 'COMPLETED' }).count('* as cnt');

  // 2. Alerts (Drafts, Missing Rates)
  const [draftPolish] = await applyEmployeeScope(db('polish_entries'), req.user).where({ status: 'DRAFT' }).count('* as cnt');
  const [missingRatesPolish] = await applyEmployeeScope(db('polish_entries'), req.user).where({ payable_period_id: periodId, rate_missing: true }).count('* as cnt');
  const [missingRatesDhar] = await applyEmployeeScope(db('dhar_entries'), req.user).where({ payable_period_id: periodId, rate_missing: true }).count('* as cnt');

  // 3. Top Performers (Employees by Send WT issued in this period)
  const topPerformers = await applyEmployeeScope(db('polish_entries as p'), req.user, 'p.employee_id')
    .join('employees as e', 'p.employee_id', 'e.id')
    .leftJoin('employee_codes as ec', function() {
      this.on('ec.employee_id', '=', 'e.id').andOnNull('ec.released_at');
    })
    .where('p.payable_period_id', periodId)
    .andWhere('p.status', 'COMPLETED')
    .groupBy('e.id', 'e.name', 'ec.code')
    .select(
      'e.id', 
      'e.name', 
      'ec.code as current_code',
      db.raw('COALESCE(SUM(p.send_weight), 0) as total_send_weight'),
      db.raw('COALESCE(SUM(p.polished_weight), 0) as total_polished'),
      db.raw('CASE WHEN SUM(p.send_weight) > 0 THEN (SUM(p.polished_weight) / SUM(p.send_weight)) * 100 ELSE 0 END as yield_pct')
    )
    .orderBy('total_send_weight', 'desc')
    .limit(8);

  // 4. Historical Trends (Last 6 Closed/Finalized/Open Periods)
  const history = await db('periods')
    .orderBy('start_date', 'desc')
    .limit(6)
    .select('id', 'name', 'status');

  // Aggregate historical totals (reverse so chronological left-to-right)
  const trendData = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i];
    const pStats = await applyEmployeeScope(db('polish_entries'), req.user)
      .where({ payable_period_id: p.id, status: 'COMPLETED' })
      .select(
        db.raw('COALESCE(SUM(polished_weight), 0) as total_polished'),
        db.raw('COALESCE(SUM(calculated_salary), 0) as total_polish_salary')
      )
      .first();
    const dStats = await applyEmployeeScope(db('dhar_entries'), req.user)
      .where({ payable_period_id: p.id })
      .select(
        db.raw('COALESCE(SUM(calculated_salary), 0) as total_dhar_salary')
      )
      .first();
    
    trendData.push({
      period_name: p.name,
      total_polished: Number(pStats.total_polished),
      total_salary: Number(pStats.total_polish_salary) + Number(dStats.total_dhar_salary)
    });
  }

  res.json({
    total_send_weight: Number(polishStats.total_send_weight),
    total_polished: Number(polishStats.total_polished),
    total_polish_salary: Number(polishStats.total_polish_salary),
    total_dhar_weight: Number(dharStats.total_dhar_weight),
    total_dhar_salary: Number(dharStats.total_dhar_salary),
    total_salary: Number(polishStats.total_polish_salary) + Number(dharStats.total_dhar_salary),
    polish_lots_in_hand: parseInt(polishLotsInHand.cnt),
    polish_lots_returned: parseInt(polishLotsReturned.cnt),
    dhar_lots_in_hand: parseInt(dharLotsInHand.cnt),
    dhar_lots_returned: parseInt(dharLotsReturned.cnt),
    alerts: {
      draft_polish: Number(draftPolish.cnt),
      missing_rates: Number(missingRatesPolish.cnt) + Number(missingRatesDhar.cnt)
    },
    top_performers: topPerformers.map(r => ({ ...r, total_send_weight: Number(r.total_send_weight), total_polished: Number(r.total_polished), yield_pct: Number(r.yield_pct) })),
    trends: trendData
  });
});

router.get('/employee-summary', async (req, res) => {
  const periodId = req.query.period_id;
  if (!periodId) return res.status(400).json({ error: 'period_id is required' });
  try {
    await requireVisiblePeriod(db, req.user, periodId);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }

  const selectedPeriod = await db('periods').where({ id: periodId }).first();
  const shouldCalculateWorkHours = selectedPeriod?.start_date >= WORK_HOURS_START_PERIOD;

  const emps = await applyEmployeeScope(db('employees as e'), req.user, 'e.id')
    .leftJoin('employee_codes as ec', function() {
      this.on('ec.employee_id', '=', 'e.id').andOnNull('ec.released_at');
    })
    .select('e.id', 'e.name', 'e.mobile', 'e.grade', 'ec.code as current_code');

  const polishRows = await applyEmployeeScope(db('polish_entries'), req.user).where(function() {
    this.where({ payable_period_id: periodId, status: 'COMPLETED' }).orWhere({ status: 'LOT_IN_HAND' });
  });
  const dharRows = await applyEmployeeScope(db('dhar_entries'), req.user).where(function() {
    this.where({ payable_period_id: periodId, status: 'COMPLETED' }).orWhere({ status: 'LOT_IN_HAND' });
  });
  const statuses = await applyEmployeeScope(db('employee_period_status'), req.user).where({ period_id: periodId });
  const statusMap = Object.fromEntries(statuses.map(s => [s.employee_id, s.status]));

  const polishMap = {};
  const dharMap = {};

  polishRows.forEach(r => {
    if (!polishMap[r.employee_id]) {
      polishMap[r.employee_id] = {
        total_lots: 0, lots_in_hand: 0, total_send_weight: 0, total_polished: 0, total_work_hours: 0, salary: 0,
        slab_0_049: 0, slab_05_099: 0, slab_1_249: 0, slab_25_499: 0, slab_5_10: 0, slab_10plus: 0
      };
    }
    const m = polishMap[r.employee_id];
    if (r.status === 'LOT_IN_HAND') {
      m.lots_in_hand++;
    } else {
      m.total_lots++;
      m.total_send_weight += parseFloat(r.send_weight) || 0;
      m.total_polished += parseFloat(r.polished_weight) || 0;
      m.total_work_hours += shouldCalculateWorkHours ? entryWorkHours(r) : 0;
      m.salary += parseFloat(r.calculated_salary) || 0;
      
      const w = parseFloat(r.send_weight) || 0;
      if (w < 0.5) m.slab_0_049++;
      else if (w < 1.0) m.slab_05_099++;
      else if (w < 2.5) m.slab_1_249++;
      else if (w < 5.0) m.slab_25_499++;
      else if (w <= 10.0) m.slab_5_10++;
      else m.slab_10plus++;
    }
  });

  dharRows.forEach(r => {
    if (!dharMap[r.employee_id]) {
      dharMap[r.employee_id] = {
        total_entries: 0, lots_in_hand: 0, total_weight: 0, total_work_hours: 0, salary: 0,
        shapes: { ROUND: 0, FANCY: 0, ALL_SHAPE: 0 }
      };
    }
    const m = dharMap[r.employee_id];
    if (r.status === 'LOT_IN_HAND') {
      m.lots_in_hand++;
    } else {
      m.total_entries++;
      m.total_weight += parseFloat(r.weight) || 0;
      m.total_work_hours += shouldCalculateWorkHours ? entryWorkHours(r) : 0;
      m.salary += parseFloat(r.calculated_salary) || 0;
      if (r.shape_classification) {
        m.shapes[r.shape_classification] = (m.shapes[r.shape_classification] || 0) + 1;
      }
    }
  });

  const result = emps.map(e => ({
    ...e,
    verification_status: statusMap[e.id] || null,
    polish: polishMap[e.id] || null,
    dhar: dharMap[e.id] || null,
  })).filter(e => e.polish || e.dhar || e.verification_status);

  res.json(result);
});

module.exports = router;
