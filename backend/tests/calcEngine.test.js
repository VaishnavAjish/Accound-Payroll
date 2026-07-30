require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('../db');
const { calculatePolishEntry, calculateDharEntry, classifyPolishCategory, daysConsumed, sendWeightDifference } = require('../lib/calcEngine');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`PASS: ${msg}`); passed++; }
  else { console.error(`FAIL: ${msg}`); failed++; }
}

async function run() {
  // MPS 5.3: single per-entry lookup, no cumulative bracket splitting.
  const r1 = await calculatePolishEntry(db, { shape: 'Round', labour_head: 'Full Polished', lab_name: 'US', send_weight: 1.0, issue_date: '2026-01-15' });
  assert(r1.calculated_salary === 900, `Round 1.0ct @ 900 slab => got ${r1.calculated_salary}`);
  assert(r1.rate_category === 'ROUND_OEB', `category ROUND_OEB => got ${r1.rate_category}`);

  const r2 = await calculatePolishEntry(db, { shape: 'Round', labour_head: 'Full Polished', lab_name: 'US', send_weight: 0.5, issue_date: '2026-01-15' });
  assert(r2.calculated_salary === 550, `Round 0.5ct @ 1100 slab, entry-level only (no bracket split) => got ${r2.calculated_salary}`);

  // Non-Payable labour head => salary 0, not rate_missing.
  const r3 = await calculatePolishEntry(db, { shape: 'Round', labour_head: 'Damaged', lab_name: 'US', send_weight: 5.0, issue_date: '2026-01-15' });
  assert(r3.calculated_salary === 0 && r3.rate_missing === false, `Damaged => Non-Payable salary 0, not rate_missing => got ${JSON.stringify(r3)}`);

  // Invalid Shape+LAB combo => blocked with error, never silently reclassified.
  const r4 = await calculatePolishEntry(db, { shape: 'Round', labour_head: 'Full Polished', lab_name: 'GIA', send_weight: 1.0, issue_date: '2026-01-15' });
  assert(r4.error !== null, `Round + GIA is invalid combo, must error => got ${JSON.stringify(r4)}`);

  // Fancy GIA
  const r5 = await calculatePolishEntry(db, { shape: 'Emerald', labour_head: 'Full Polished', lab_name: 'GIA', send_weight: 2.0, issue_date: '2026-01-15' });
  assert(r5.calculated_salary === 2500, `Fancy GIA 2.0ct @ 1250 => got ${r5.calculated_salary}`);

  // Rate missing: weight far outside any configured slab boundary shouldn't happen since slabs are unbounded at top,
  // so instead test a category/weight with no covering slab by using a negative min edge case: weight below 0.01.
  const r6 = await calculatePolishEntry(db, { shape: 'Round', labour_head: 'Full Polished', lab_name: 'US', send_weight: 0.00, issue_date: '2026-01-15' });
  assert(r6.rate_missing === true, `Weight 0.00 has no covering slab => rate_missing true, got ${JSON.stringify(r6)}`);

  // DHAR
  const d1 = await calculateDharEntry(db, { shape_classification: 'ALL_SHAPE', weight: 1.5, issue_date: '2026-01-15' });
  assert(d1.calculated_salary === 195, `DHAR ALL_SHAPE 1.5ct @130 (LT_2) => got ${d1.calculated_salary}`);

  const d2 = await calculateDharEntry(db, { shape_classification: 'ROUND', weight: 3.0, issue_date: '2026-01-15' });
  assert(d2.calculated_salary === 105, `DHAR ROUND 3.0ct @35 (GTE_2) => got ${d2.calculated_salary}`);

  // Days consumed / weight difference
  assert(daysConsumed('2026-01-01', '2026-01-11') === 10, `daysConsumed completed => got ${daysConsumed('2026-01-01', '2026-01-11')}`);
  assert(sendWeightDifference(2.0, 1.8) === 0.2, `sendWeightDifference => got ${sendWeightDifference(2.0, 1.8)}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.destroy();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
