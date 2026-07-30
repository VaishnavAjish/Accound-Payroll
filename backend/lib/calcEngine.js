// Centralized calculation engine (MPS 12: "Calculation logic belongs in a
// centralized backend/domain calculation engine, not frontend formulas.")
// All money/weight arithmetic goes through Decimal, never native JS floats
// (MPS 12: "never binary floating-point arithmetic for payroll calculations").

const Decimal = require('decimal.js');

// MPS 5.5: Round-rate shapes are exactly Round and Old European Brilliant (OEB).
const ROUND_SHAPES = new Set(['ROUND', 'OLD EUROPEAN BRILLIANT', 'OEB', 'ROUND_OEB']);

function normalize(s) {
  return (s || '').trim().toUpperCase();
}

/**
 * MPS 5.5: classify a Polish entry's rate category from shape + lab, and
 * validate the Shape+LAB combination. Invalid combinations are blocked, never
 * silently reclassified.
 */
function classifyPolishCategory(shape, labName) {
  const shapeU = normalize(shape);
  const labU = normalize(labName);
  const isRoundShape = ROUND_SHAPES.has(shapeU);

  if (isRoundShape) {
    if (labU !== 'US') {
      return { category: null, error: `Round/OEB shape requires LAB = US (got "${labName || ''}").` };
    }
    return { category: 'ROUND_OEB', error: null };
  }

  if (labU === 'IGI') return { category: 'FANCY_IGI', error: null };
  if (labU === 'GIA') return { category: 'FANCY_GIA', error: null };

  return { category: null, error: `Fancy shape requires LAB = IGI or GIA (got "${labName || ''}").` };
}

/**
 * MPS 8: DHAR weight slab is derived automatically from weight, never chosen
 * by the user.
 */
function deriveDharWeightSlab(weight) {
  return new Decimal(weight).gte('2.00') ? 'GTE_2' : 'LT_2';
}

/**
 * MPS 5.4: Days Consumed differs by completion state and is always computed
 * live, never stored, so it can't go stale for incomplete work.
 */
function daysConsumed(issueDate, receivedDate) {
  const issue = new Date(issueDate);
  const end = receivedDate ? new Date(receivedDate) : new Date();
  const ms = end.getTime() - issue.getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

/**
 * MPS 5.4: analytical only, does not affect salary.
 */
function sendWeightDifference(sendWeight, polishedWeight) {
  if (polishedWeight === null || polishedWeight === undefined || polishedWeight === '') return null;
  return new Decimal(sendWeight).minus(polishedWeight).toDecimalPlaces(2).toNumber();
}

/**
 * MPS 5.6 / 11: find the single effective-dated rate row covering this
 * weight, for this category, on this issue date. Returns null if none found
 * -- callers must treat that as Rate Missing / Calculation Blocked, never 0.
 */
async function lookupPolishRate(db, category, weight, issueDate) {
  const row = await db('rates_polish')
    .where('category', category)
    .andWhere('min_weight', '<=', weight)
    .andWhere((qb) => qb.whereNull('max_weight').orWhere('max_weight', '>=', weight))
    .andWhere('effective_from', '<=', issueDate)
    .andWhere((qb) => qb.whereNull('effective_to').orWhere('effective_to', '>=', issueDate))
    .first();
  return row || null;
}

async function lookupDharRate(db, classification, weightSlab, issueDate) {
  const row = await db('rates_dhar')
    .where('classification', classification)
    .andWhere('weight_slab', weightSlab)
    .andWhere('effective_from', '<=', issueDate)
    .andWhere((qb) => qb.whereNull('effective_to').orWhere('effective_to', '>=', issueDate))
    .first();
  return row || null;
}

/**
 * MPS 5.3 / 6: only Full Polished work is currently salary-payable. All other
 * labour heads are Non-Payable -- salary is 0 by design, not a missing-rate
 * block, and no rate lookup is attempted for them.
 *
 * MPS 5.3: "Entry-level salary = eligible send weight x applicable
 * Issue-Date rate." This is a single per-entry lookup -- no cumulative
 * bracket-splitting across an employee's other entries.
 */
async function calculatePolishEntry(db, entry) {
  const labourHeadU = normalize(entry.labour_head);

  if (labourHeadU !== 'FULL POLISHED') {
    return {
      rate_category: null,
      rate_snapshot: null,
      calculated_salary: 0,
      rate_missing: false,
      payable: false,
      error: null,
    };
  }

  const { category, error } = classifyPolishCategory(entry.shape, entry.lab_name);
  if (error) {
    return { rate_category: null, rate_snapshot: null, calculated_salary: null, rate_missing: false, payable: true, error };
  }

  const rateRow = await lookupPolishRate(db, category, entry.send_weight, entry.issue_date);
  if (!rateRow) {
    return { rate_category: category, rate_snapshot: null, calculated_salary: null, rate_missing: true, payable: true, error: null };
  }

  const salary = new Decimal(entry.send_weight).times(rateRow.rate_per_ct).toDecimalPlaces(2).toNumber();
  return {
    rate_category: category,
    rate_snapshot: Number(rateRow.rate_per_ct),
    calculated_salary: salary,
    rate_missing: false,
    payable: true,
    error: null,
  };
}

/**
 * MPS 8: Salary = Weight x applicable Issue-Date rate, keyed by
 * classification + derived weight slab.
 */
async function calculateDharEntry(db, entry) {
  const weightSlab = deriveDharWeightSlab(entry.weight);
  const rateRow = await lookupDharRate(db, entry.shape_classification, weightSlab, entry.issue_date);

  if (!rateRow) {
    return { weight_slab: weightSlab, rate_snapshot: null, calculated_salary: null, rate_missing: true };
  }

  const salary = new Decimal(entry.weight).times(rateRow.rate_per_ct).toDecimalPlaces(2).toNumber();
  return { weight_slab: weightSlab, rate_snapshot: Number(rateRow.rate_per_ct), calculated_salary: salary, rate_missing: false };
}

module.exports = {
  ROUND_SHAPES,
  classifyPolishCategory,
  deriveDharWeightSlab,
  daysConsumed,
  sendWeightDifference,
  lookupPolishRate,
  lookupDharRate,
  calculatePolishEntry,
  calculateDharEntry,
};
