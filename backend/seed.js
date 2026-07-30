// One-time seed: master data (MPS 10), Polish/DHAR rate baselines (MPS 5.6,
// 8), and the single permanent Super Admin account (MPS 16).
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

// Baseline effective date for the initial rate versions -- an arbitrarily
// early date so any historical entry (e.g. reconciliation against
// Demo P3.xlsx) resolves to a rate. Real rate changes going forward get
// their own effective_from and never touch this row.
const BASELINE_DATE = '2000-01-01';

const MASTER_DATA = {
  SHAPE: [
    'Round', 'Old European Brilliant', 'Asscher', 'Cushion', 'Emerald', 'Heart', 'Marquise', 'Oval', 'Pear',
    'Princess', 'Radiant', 'Cushion Brilliant', 'Cushion Modified', 'Sq Cushion', 'Sq Cushion Brilliant',
    'Sq Cushion Modified', 'Aq Cushion', 'Sq Antiques Cushion', 'Step Cut Cushion', 'Sq Emerald', 'Kriss',
    'Aq Marquise', 'Marquise Modified', 'Step Marquise', 'Moon Half', 'Aq Oval', 'Kriss Oval', 'Step Oval',
    'Step Pear', 'Sq Radiant', 'Radiant Modified', 'Rose Cut', 'Trapezoid', 'Brilliant Trapezoid', 'Ashoka',
    'Briolet', 'Bullets', 'Choki', 'Kite', 'Triangle', 'Baguette',
  ],
  COLOR: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'Fancy Vivid'],
  CLARITY: ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1'],
  LABOUR_HEAD: ['Full Polished', 'Blocking', 'HPHT', 'Damaged', 'Repairing', 'Transfer'],
  SHADE: ['Blues', 'Brown', 'Greys', 'Heavy Greys', 'White', 'Yellow', 'Pink', 'Orange'],
  STONE_LEVEL: ['Propper', 'Nice Stone', 'Not Good', 'Little Problem'],
  LAB: ['GIA', 'IGI', 'US'],
  CUT_POL_SYM: ['EX EX EX', 'EX VG VG', 'EX EX VG', 'VG EX VG', 'VG VG EX', 'VG VG VG'],
  GRADER: ['J.J.', 'N.K.', 'D.K.', 'C.B.', 'A.G.', 'K.K.', 'V.D.', 'M.T.', 'R.S.', 'K.R.', 'S.K.'],
  SPECIALIST: ['OTHER', 'EM, RAD', 'PN, OV, MQ, CU', 'PR', 'RD', 'RD, OV', 'ALL'],
  WORK_STATUS: ['WORKING', 'RESIGN'],
  VERIFY_STATUS: ['PENDING', 'VERIFIED'],
};

const ROUND_SHAPE_VALUES = new Set(['Round', 'Old European Brilliant']);

const RATES_POLISH = [
  // MPS 5.6
  { category: 'ROUND_OEB', min_weight: 0.01, max_weight: 0.99, rate_per_ct: 1100 },
  { category: 'ROUND_OEB', min_weight: 1.00, max_weight: 2.99, rate_per_ct: 900 },
  { category: 'ROUND_OEB', min_weight: 3.00, max_weight: null, rate_per_ct: 800 },
  { category: 'FANCY_IGI', min_weight: 0.01, max_weight: 0.99, rate_per_ct: 1250 },
  { category: 'FANCY_IGI', min_weight: 1.00, max_weight: 1.99, rate_per_ct: 1250 },
  { category: 'FANCY_IGI', min_weight: 2.00, max_weight: 4.99, rate_per_ct: 1050 },
  { category: 'FANCY_IGI', min_weight: 5.00, max_weight: 9.99, rate_per_ct: 850 },
  { category: 'FANCY_IGI', min_weight: 10.00, max_weight: null, rate_per_ct: 650 },
  { category: 'FANCY_GIA', min_weight: 0.01, max_weight: 0.99, rate_per_ct: 1650 },
  { category: 'FANCY_GIA', min_weight: 1.00, max_weight: 1.99, rate_per_ct: 1450 },
  { category: 'FANCY_GIA', min_weight: 2.00, max_weight: 4.99, rate_per_ct: 1250 },
  { category: 'FANCY_GIA', min_weight: 5.00, max_weight: 9.99, rate_per_ct: 1050 },
  { category: 'FANCY_GIA', min_weight: 10.00, max_weight: null, rate_per_ct: 850 },
];

const RATES_DHAR = [
  // MPS 8
  { classification: 'ALL_SHAPE', weight_slab: 'LT_2', rate_per_ct: 130 },
  { classification: 'ALL_SHAPE', weight_slab: 'GTE_2', rate_per_ct: 80 },
  { classification: 'ROUND', weight_slab: 'LT_2', rate_per_ct: 45 },
  { classification: 'ROUND', weight_slab: 'GTE_2', rate_per_ct: 35 },
];

async function seedMasterData() {
  const rows = [];
  for (const [category, values] of Object.entries(MASTER_DATA)) {
    values.forEach((value, idx) => {
      rows.push({
        category,
        value,
        sort_order: idx,
        is_round_classification: category === 'SHAPE' && ROUND_SHAPE_VALUES.has(value),
      });
    });
  }
  await db('master_data').insert(rows).onConflict(['category', 'value']).ignore();
  console.log(`Seeded ${rows.length} master data rows.`);
}

async function seedRates() {
  const polishRows = RATES_POLISH.map((r) => ({ ...r, effective_from: BASELINE_DATE }));
  const dharRows = RATES_DHAR.map((r) => ({ ...r, effective_from: BASELINE_DATE }));
  await db('rates_polish').insert(polishRows);
  await db('rates_dhar').insert(dharRows);
  console.log(`Seeded ${polishRows.length} Polish rate rows and ${dharRows.length} DHAR rate rows.`);
}

async function seedRootAdmin() {
  const existing = await db('users').where('role', 'SUPER_ADMIN').first();
  if (existing) {
    console.log('Super Admin already exists, skipping.');
    return;
  }
  const email = process.env.SUPER_ADMIN_EMAIL || process.env.ROOT_ADMIN_EMAIL || 'superadmin@nidhiimpex.com';
  const password = process.env.SUPER_ADMIN_PASSWORD || process.env.ROOT_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const password_hash = await bcrypt.hash(password, 12);
  await db('users').insert({ email, password_hash, name: 'Super Admin', role: 'SUPER_ADMIN', active: true });

  console.log('\n==================== SUPER ADMIN CREATED ====================');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log('  Save this now -- it will not be shown again. Change it after first login.');
  console.log('==============================================================\n');
}

async function main() {
  await seedMasterData();
  await seedRates();
  await seedRootAdmin();
  await db.destroy();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
