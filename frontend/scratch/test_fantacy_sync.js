const assert = require("assert");
const { normalizeDepartment, parseRequestedDepartments, ALL_CANONICAL_DEPARTMENTS } = require("../src/lib/fantacyDeptMapper.js");

console.log("=== Running Department Normalization Test Suite ===\n");

// 1. New format: "XX-Polish X"
console.log("1. Testing new 'XX-Polish X' format...");
assert.strictEqual(normalizeDepartment("01-Polish 1"), "polish-1");
assert.strictEqual(normalizeDepartment("02-Polish 2"), "polish-2");
assert.strictEqual(normalizeDepartment("03-Polish 3"), "polish-3");
assert.strictEqual(normalizeDepartment("10-Polish 10"), "polish-10");
assert.strictEqual(normalizeDepartment("15-Polish 15"), "polish-15");
assert.strictEqual(normalizeDepartment("SF-2"), "sf-2");
console.log("✔ All new format assertions passed!");

// 2. Old format backwards compat
console.log("\n2. Testing old format backwards compat...");
assert.strictEqual(normalizeDepartment("Polish-1"), "polish-1");
assert.strictEqual(normalizeDepartment("Polish-2"), "polish-2");
assert.strictEqual(normalizeDepartment("Polish-3"), "polish-3");
assert.strictEqual(normalizeDepartment("Polish 3"), "polish-3");
assert.strictEqual(normalizeDepartment("SF 2"), "sf-2");
assert.strictEqual(normalizeDepartment("sf-2"), "sf-2");
assert.strictEqual(normalizeDepartment("sf2"), "sf-2");
console.log("✔ All old format assertions passed!");

// 3. Parse requested departments
console.log("\n3. Testing parseRequestedDepartments...");
const parsed = parseRequestedDepartments("03-Polish 3,02-Polish 2,SF-2");
assert.deepStrictEqual(parsed, ["polish-3", "polish-2", "sf-2"]);
console.log("✔ Parse requested departments passed!");

// 4. Filtering with new department names
console.log("\n4. Testing filtering with new department names...");
const mockItems = [
  { LotID: "101", DepartmentAccountName: "02-Polish 2", CompanyID: "2139" },
  { LotID: "102", DepartmentAccountName: "03-Polish 3", CompanyID: "2139" },
  { LotID: "103", DepartmentAccountName: "04-Polish 4", CompanyID: "2139" },
  { LotID: "104", DepartmentAccountName: "SF-2", CompanyID: "2139" },
];

const allowedSet = new Set(ALL_CANONICAL_DEPARTMENTS);
const polish3Only = mockItems.filter(i => normalizeDepartment(i.DepartmentAccountName) === "polish-3");
assert.strictEqual(polish3Only.length, 1);
assert.strictEqual(polish3Only[0].LotID, "102");

const sf2Only = mockItems.filter(i => normalizeDepartment(i.DepartmentAccountName) === "sf-2");
assert.strictEqual(sf2Only.length, 1);
assert.strictEqual(sf2Only[0].LotID, "104");

const allAllowed = mockItems.filter(i => allowedSet.has(normalizeDepartment(i.DepartmentAccountName)));
assert.strictEqual(allAllowed.length, 4);
console.log("✔ Department filtering with new names passed!");

console.log("\n================ ALL TESTS PASSED ================");
