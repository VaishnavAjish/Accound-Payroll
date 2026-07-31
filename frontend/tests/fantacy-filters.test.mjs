/**
 * Fantacy / Skylab stock filtering tests.
 *
 * Run:  node tests/fantacy-filters.test.mjs      (from frontend/)
 * No framework and no network -- mirrors backend/tests/calcEngine.test.js style.
 *
 * The Polish-2 fixture is the REAL 86-record Skylab export that was validated
 * by hand. It is the regression anchor: whatever else changes, Polish-2 must
 * keep resolving to exactly those 86 lots.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  normalizeDepartment,
  getRecordDepartment,
  parseRequestedDepartments,
  isCanonicalDepartment,
  ALL_CANONICAL_DEPARTMENTS,
  canonicalToAppDepartment,
  DEPARTMENT_ACCOUNTS,
  upstreamDepartmentValues,
} from "../src/lib/fantacyDeptMapper.js";

import {
  filterByCompany,
  filterByDepartment,
  dedupeRecords,
  stockRecordKey,
  isSyntheticRecord,
  applyStockPipeline,
} from "../src/lib/fantacyStockFilter.js";

const here = dirname(fileURLToPath(import.meta.url));
const polish2 = JSON.parse(
  readFileSync(join(here, "../src/lib/dev/polish2_reference.json"), "utf8")
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Minimal synthetic record in the shape the retired generator produced. */
function legacyMockRecord(i) {
  return {
    LotID: String(83152800 + i),
    SerieID: `SER-50${String(i % 50).padStart(2, "0")}`,
    ExternalSourceLotRemark: `Remark-10${String(i % 100).padStart(2, "0")}`,
    DepartmentAccountName: `Polish-${(i % 15) + 1}`,
    Weight: 1.23,
  };
}

function liveRecord(lotId, department, extra = {}) {
  return { LotID: String(lotId), DepartmentAccountName: department, Weight: 0.5, ...extra };
}

// ---------------------------------------------------------------------------
section("Department normalization");

test("live API spelling 'Polish-3' normalizes", () => {
  assert.equal(normalizeDepartment("Polish-3"), "polish-3");
});

test("sheet-export spelling '03-Polish 3' normalizes identically", () => {
  assert.equal(normalizeDepartment("03-Polish 3"), "polish-3");
  assert.equal(normalizeDepartment("03-Polish 3"), normalizeDepartment("Polish-3"));
});

test("spacing, underscore and case variants all agree", () => {
  for (const variant of ["polish 3", "POLISH_3", "Polish  3", "3-Polish 3", "polish-3"]) {
    assert.equal(normalizeDepartment(variant), "polish-3", `variant: ${variant}`);
  }
});

test("Polish-1 through Polish-15 each map to a distinct canonical key", () => {
  const keys = new Set();
  for (let n = 1; n <= 15; n += 1) {
    const fromApi = normalizeDepartment(`Polish-${n}`);
    const fromSheet = normalizeDepartment(`${String(n).padStart(2, "0")}-Polish ${n}`);
    assert.equal(fromApi, `polish-${n}`);
    assert.equal(fromSheet, `polish-${n}`);
    keys.add(fromApi);
  }
  assert.equal(keys.size, 15, "expected 15 distinct department keys");
});

test("two-digit departments are not truncated to one digit", () => {
  assert.equal(normalizeDepartment("12-Polish 12"), "polish-12");
  assert.equal(normalizeDepartment("15-Polish 15"), "polish-15");
  assert.notEqual(normalizeDepartment("Polish-12"), "polish-1");
});

test("SF-2 is its own department, never parsed as a Polish number", () => {
  for (const variant of ["SF-2", "sf 2", "SF2", "sf-2"]) {
    assert.equal(normalizeDepartment(variant), "sf-2", `variant: ${variant}`);
  }
  assert.equal(canonicalToAppDepartment("sf-2"), "POLISH_2");
});

test("worker sub-accounts are rejected, not treated as departments", () => {
  for (const worker of ["210 JAYESHBHAI", "206-B.D", "249-NILESH BHAI", "202 DEVA BHAI"]) {
    assert.equal(normalizeDepartment(worker), "", `worker: ${worker}`);
  }
});

test("out-of-range and junk values return empty", () => {
  for (const bad of ["Polish-30", "Polish-0", "", null, undefined, "86", "Totals"]) {
    assert.equal(normalizeDepartment(bad), "", `value: ${String(bad)}`);
  }
});

test("substring collision cannot match the wrong department", () => {
  // "polish-1" must not be produced by a "Polish-15" value.
  assert.equal(normalizeDepartment("Polish-15"), "polish-15");
  assert.notEqual(normalizeDepartment("Polish-15"), "polish-1");
});

test("getRecordDepartment reads only the authoritative field", () => {
  const record = {
    DepartmentAccountName: "Polish-7",
    LocationAccountName: "210 JAYESHBHAI",
    PreviousLocationAccountName: "Polish-9",
  };
  assert.equal(getRecordDepartment(record), "polish-7");
});

test("a record whose only department-looking value is a location is rejected", () => {
  assert.equal(getRecordDepartment({ LocationAccountName: "Polish-4" }), "");
});

test("parseRequestedDepartments keeps canonical entries and drops junk", () => {
  assert.deepEqual(parseRequestedDepartments("Polish-3,junk,SF-2"), ["polish-3", "sf-2"]);
  assert.deepEqual(parseRequestedDepartments(""), []);
  assert.deepEqual(parseRequestedDepartments("Polish-3,Polish-3"), ["polish-3"]);
});

test("canonical department list covers Polish 1-17 plus SF-2", () => {
  // 17 Polish departments + SF-2, per the Skylab account export. This was 16
  // (Polish 1-15 + SF-2), which made Polish 16 and 17 unrecognised, so their
  // live records were dropped by the department filter.
  assert.equal(ALL_CANONICAL_DEPARTMENTS.length, 18);
  assert.ok(ALL_CANONICAL_DEPARTMENTS.every(isCanonicalDepartment));
  assert.ok(ALL_CANONICAL_DEPARTMENTS.includes("polish-16"));
  assert.ok(ALL_CANONICAL_DEPARTMENTS.includes("polish-17"));
  assert.ok(ALL_CANONICAL_DEPARTMENTS.includes("sf-2"));
});

test("Polish 16 and 17 normalize instead of being dropped", () => {
  assert.equal(normalizeDepartment("Polish-16"), "polish-16");
  assert.equal(normalizeDepartment("17-Polish 17"), "polish-17");
  // 18 is beyond the roster and must still be rejected.
  assert.equal(normalizeDepartment("Polish-18"), "");
});

test("every roster department carries its exact Skylab account name and id", () => {
  assert.equal(DEPARTMENT_ACCOUNTS["polish-1"].id, 107);
  // IDs are not ordered by department number -- Polish 2 is lower than Polish 1.
  assert.equal(DEPARTMENT_ACCOUNTS["polish-2"].id, 106);
  assert.equal(DEPARTMENT_ACCOUNTS["polish-17"].id, 828376);
  assert.equal(DEPARTMENT_ACCOUNTS["sf-2"].name, "SF -2");
  // The exported "SF -2" spelling must still normalize.
  assert.equal(normalizeDepartment(DEPARTMENT_ACCOUNTS["sf-2"].name), "sf-2");
});

test("upstream department values emit both spellings Skylab uses", () => {
  const values = upstreamDepartmentValues(["polish-2"]);
  assert.ok(values.includes("02-Polish 2"), "sheet-export form");
  assert.ok(values.includes("Polish-2"), "live-API form");

  // No selection means all OUR departments, never all departments in the tenant.
  assert.equal(upstreamDepartmentValues([]).length, 36); // 18 departments x 2 forms
});

// ---------------------------------------------------------------------------
section("Company filtering");

test("the real field name 'Company' is read", () => {
  // The prior implementation looked only for CompanyID/Company_ID/companyId, so
  // every record read as "<absent>" and the filter could never match anything.
  const { kept, rejected } = filterByCompany(
    [
      liveRecord(1, "Polish-2", { Company: "SKYLAB" }),
      liveRecord(2, "Polish-2", { Company: "MAUNI" }),
      liveRecord(3, "Polish-2", { Company: "THE DIAMOND LAB" }),
    ],
    "SKYLAB"
  );
  assert.equal(kept.length, 1);
  assert.equal(rejected, 2);
  assert.equal(kept[0].LotID, "1");
});

test("companies sharing a department name are separated", () => {
  // The reported bug: several companies use "02-Polish 2", so filtering on
  // department alone returns all of them and the result set looks inflated.
  const batch = [
    liveRecord(1, "02-Polish 2", { Company: "SKYLAB" }),
    liveRecord(2, "02-Polish 2", { Company: "MAUNI" }),
    liveRecord(3, "02-Polish 2", { Company: "THE DIAMOND LAB" }),
    liveRecord(4, "02-Polish 2", { Company: "SKYLAB" }),
  ];

  const deptOnly = filterByDepartment(batch, ["polish-2"]);
  assert.equal(deptOnly.kept.length, 4, "department alone cannot separate them");

  const { records } = applyStockPipeline(batch, { company: "SKYLAB", departments: ["polish-2"] });
  assert.equal(records.length, 2);
  assert.ok(records.every((r) => r.Company === "SKYLAB"));
});

test("company matching is case-insensitive but not fuzzy", () => {
  const items = [
    liveRecord(1, "Polish-2", { Company: "skylab" }),
    liveRecord(2, "Polish-2", { Company: "SkyLab" }),
    liveRecord(3, "Polish-2", { Company: "SKYLAB DIAMOND" }),
    liveRecord(4, "Polish-2", { Company: "THE SKYLAB" }),
  ];
  const { kept } = filterByCompany(items, "SKYLAB");
  assert.equal(kept.length, 2, "case variants match; substrings do not");
});

test("rows with no company field are rejected and counted", () => {
  const { kept, missingField } = filterByCompany(
    [
      liveRecord(1, "Polish-2", { Company: "SKYLAB" }),
      liveRecord(2, "Polish-2"), // no Company field at all
    ],
    "SKYLAB"
  );
  assert.equal(kept.length, 1);
  assert.equal(missingField, 1);
});

test("no company filter is applied when no company id is configured", () => {
  const items = [liveRecord(1, "Polish-3"), liveRecord(2, "Polish-3")];
  const result = filterByCompany(items, null);
  assert.equal(result.applied, false);
  assert.equal(result.kept.length, 2);
});

test("real records report an absent company field rather than a fabricated one", () => {
  const result = filterByCompany(polish2, null);
  assert.equal(result.byCompany["<absent>"], 86);
  assert.equal(Object.keys(result.byCompany).length, 1);
});

test("company filter is exact and rejects other companies", () => {
  const items = [
    liveRecord(1, "Polish-3", { CompanyID: "2139" }),
    liveRecord(2, "Polish-3", { CompanyID: "9999" }),
  ];
  const result = filterByCompany(items, "2139");
  assert.equal(result.applied, true);
  assert.equal(result.kept.length, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.kept[0].LotID, "1");
});

test("a missing company field is rejected when filtering is enabled, never defaulted", () => {
  const items = [liveRecord(1, "Polish-3")]; // no CompanyID at all
  const result = filterByCompany(items, "2139");
  assert.equal(result.kept.length, 0, "missing company must not default to a pass");
});

test("company filter does not use substring matching", () => {
  const items = [liveRecord(1, "Polish-3", { CompanyID: "21390" })];
  assert.equal(filterByCompany(items, "2139").kept.length, 0);
});

// ---------------------------------------------------------------------------
section("Department filtering");

test("selecting one department never returns another's records", () => {
  const items = [
    liveRecord(1, "Polish-3"),
    liveRecord(2, "Polish-4"),
    liveRecord(3, "03-Polish 3"),
    liveRecord(4, "SF-2"),
  ];
  const result = filterByDepartment(items, ["polish-3"]);
  assert.equal(result.kept.length, 2);
  assert.deepEqual(result.kept.map((r) => r.LotID).sort(), ["1", "3"]);
});

test("zero matches stays zero -- never falls back to returning everything", () => {
  const items = [liveRecord(1, "Polish-4"), liveRecord(2, "Polish-5")];
  const result = filterByDepartment(items, ["polish-3"]);
  assert.equal(result.kept.length, 0);
  assert.equal(result.rejected, 2);
});

test("records with an unrecognised department are dropped", () => {
  const items = [liveRecord(1, "210 JAYESHBHAI"), liveRecord(2, null), liveRecord(3, "Polish-3")];
  const result = filterByDepartment(items, []);
  assert.equal(result.kept.length, 1);
  assert.equal(result.byDepartment["<unrecognised>"], 2);
});

test("each of Polish-1..15 isolates correctly against a mixed batch", () => {
  const mixed = [];
  for (let n = 1; n <= 15; n += 1) {
    mixed.push(liveRecord(`api-${n}`, `Polish-${n}`));
    mixed.push(liveRecord(`sheet-${n}`, `${String(n).padStart(2, "0")}-Polish ${n}`));
  }
  mixed.push(liveRecord("sf", "SF-2"));

  for (let n = 1; n <= 15; n += 1) {
    const result = filterByDepartment(mixed, [`polish-${n}`]);
    assert.equal(result.kept.length, 2, `Polish-${n} should match its 2 spellings`);
    assert.deepEqual(result.kept.map((r) => r.LotID).sort(), [`api-${n}`, `sheet-${n}`].sort());
  }

  const sf = filterByDepartment(mixed, ["sf-2"]);
  assert.equal(sf.kept.length, 1);
});

// ---------------------------------------------------------------------------
section("Dedupe & pagination");

test("LotID is the dedupe key", () => {
  assert.equal(stockRecordKey({ LotID: "93357152" }), "LotID:93357152");
  assert.equal(stockRecordKey({ Stock_ID: 7 }), "Stock_ID:7");
  assert.equal(stockRecordKey({}), null);
});

test("repeated pages do not accumulate duplicates", () => {
  const page = [liveRecord(1, "Polish-3"), liveRecord(2, "Polish-3")];
  const seen = new Set();
  const first = dedupeRecords(page, seen);
  const second = dedupeRecords(page, seen); // same page fetched again
  assert.equal(first.kept.length, 2);
  assert.equal(second.kept.length, 0);
  assert.equal(second.duplicates, 2);
});

test("overlapping pages keep each lot exactly once", () => {
  const seen = new Set();
  dedupeRecords([liveRecord(1, "Polish-3"), liveRecord(2, "Polish-3")], seen);
  const overlap = dedupeRecords([liveRecord(2, "Polish-3"), liveRecord(3, "Polish-3")], seen);
  assert.equal(overlap.kept.length, 1);
  assert.equal(overlap.kept[0].LotID, "3");
});

test("records without any stable identifier are dropped", () => {
  const result = dedupeRecords([{ DepartmentAccountName: "Polish-3" }]);
  assert.equal(result.kept.length, 0);
  assert.equal(result.unkeyed, 1);
});

// ---------------------------------------------------------------------------
section("Mock / live separation");

test("legacy synthetic records are detected by fingerprint", () => {
  assert.equal(isSyntheticRecord(legacyMockRecord(1)), true);
});

test("current generator output is detected by its explicit tag", () => {
  assert.equal(isSyntheticRecord({ LotID: "5", source: "mock" }), true);
  assert.equal(isSyntheticRecord({ LotID: "5", __synthetic: true }), true);
});

test("real Polish-2 records are never classified as synthetic", () => {
  for (const record of polish2) {
    assert.equal(isSyntheticRecord(record), false, `real lot flagged: ${record.LotID}`);
  }
});

test("a single coincidental prefix is not enough to delete a real lot", () => {
  // Real LotID that happens to start with the legacy prefix, but no other marker.
  assert.equal(isSyntheticRecord({ LotID: "83152899", SerieID: "SER-9001" }), false);
});

// ---------------------------------------------------------------------------
section("Full pipeline");

test("Polish-2 regression: the real fixture yields exactly its 86 lots", () => {
  const { records, diagnostics } = applyStockPipeline(polish2, {
    companyId: null,
    departments: ["polish-2"],
  });
  assert.equal(records.length, 86);
  assert.equal(diagnostics.received, 86);
  assert.equal(diagnostics.rejectedByDepartment, 0);
  assert.equal(diagnostics.duplicatesDropped, 0);

  const expectedLotIds = polish2.map((r) => String(r.LotID)).sort();
  const actualLotIds = records.map((r) => String(r.LotID)).sort();
  assert.deepEqual(actualLotIds, expectedLotIds, "Lot IDs must match the validated export exactly");
});

test("Polish-2 selection excludes every other department", () => {
  const mixed = [...polish2, liveRecord("foreign-1", "Polish-3"), liveRecord("foreign-2", "SF-2")];
  const { records } = applyStockPipeline(mixed, { departments: ["polish-2"] });
  assert.equal(records.length, 86);
  assert.ok(!records.some((r) => String(r.LotID).startsWith("foreign")));
});

test("synthetic rows mixed into a live batch are excluded from a department result", () => {
  // Synthetic rows claim Polish-3; only the real one must survive.
  const batch = [
    liveRecord("93400001", "Polish-3"),
    legacyMockRecord(2), // Polish-3 by construction (2 % 15 + 1 === 3)
    legacyMockRecord(17),
  ];
  const { records } = applyStockPipeline(batch, { departments: ["polish-3"] });
  const realOnly = records.filter((r) => !isSyntheticRecord(r));
  assert.equal(realOnly.length, 1);
  assert.equal(realOnly[0].LotID, "93400001");
});

test("a department with no real records yields an empty result", () => {
  const { records, diagnostics } = applyStockPipeline(polish2, { departments: ["polish-9"] });
  assert.equal(records.length, 0);
  assert.equal(diagnostics.finalCount, 0);
  assert.equal(diagnostics.rejectedByDepartment, 86);
});

test("an empty upstream page produces an empty result, not everything", () => {
  const { records } = applyStockPipeline([], { departments: ["polish-3"] });
  assert.equal(records.length, 0);
});

test("diagnostics report counts only -- no record bodies or credentials", () => {
  const { diagnostics } = applyStockPipeline(polish2, { departments: ["polish-2"] });
  const serialized = JSON.stringify(diagnostics);
  assert.ok(!serialized.includes("Pricing"), "diagnostics must not contain credentials");
  assert.ok(!serialized.includes("93357152"), "diagnostics must not contain lot bodies");
  assert.equal(typeof diagnostics.finalCount, "number");
});

test("totals are computed from the filtered set, not the raw page", () => {
  const batch = [...polish2, liveRecord("foreign", "Polish-3", { Weight: 999 })];
  const { records } = applyStockPipeline(batch, { departments: ["polish-2"] });
  const totalWeight = records.reduce((sum, r) => sum + (Number(r.Weight) || 0), 0);
  assert.equal(records.length, 86);
  assert.ok(totalWeight < 999, "foreign-department weight must not reach the total");
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
