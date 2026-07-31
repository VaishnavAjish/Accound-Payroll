/**
 * Skylab field discovery.
 *
 * /api/stock rejects an unknown column with a precise message:
 *   "No property or field 'Company' exists in type 'Lot'"
 * That makes the endpoint its own schema oracle. This script tests candidate
 * column names one at a time and reports which actually exist on type `Lot`.
 *
 * Used to find the column that identifies the owning company (SKYLAB / MAUNI /
 * THE DIAMOND LAB), which is NOT `Company`.
 *
 * Run:
 *   node --env-file=.env.local scripts/skylab-fields.mjs
 *   node --env-file=.env.local scripts/skylab-fields.mjs --try Foo,Bar
 *   node --env-file=.env.local scripts/skylab-fields.mjs --dump   (all fields of one lot)
 */

import https from "node:https";

const API_BASE = process.env.SKYLAB_API_BASE;
const USERNAME = process.env.SKYLAB_API_USERNAME;
const PASSWORD = process.env.SKYLAB_API_PASSWORD;
const GRANT_TYPE = process.env.SKYLAB_API_GRANT_TYPE || "password";
const INSECURE = process.env.SKYLAB_ALLOW_INSECURE_TLS === "true";

const args = process.argv.slice(2);
const flagVal = (n) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] ?? null : null;
};

/** Column names that plausibly carry company/tenant identity. */
const CANDIDATES = (flagVal("try")?.split(",").map((s) => s.trim()).filter(Boolean)) || [
  "Company", "CompanyID", "CompanyName", "CompanyAccountName", "CompanyAccountID",
  "CompanyCode", "CompanyDesc", "Comp", "CompID", "CompanyMasterID",
  "Firm", "FirmName", "FirmID",
  "Branch", "BranchName", "BranchID", "BranchAccountName",
  "Owner", "OwnerName", "OwnerCompany", "OwnerAccountName",
  "Division", "DivisionName", "Location", "LocationAccountName",
  "AccountName", "AccountID", "DepartmentAccountID", "DepartmentID",
  "TB100ID", "TB101ID", "TB102ID", "TB103ID", "TB104ID", "TB105ID",
  "OrgID", "OrganizationName", "TenantID", "GroupName", "GroupID",
];

function request(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const t = new URL(url);
    const req = https.request(
      {
        protocol: t.protocol, hostname: t.hostname, port: t.port || 443,
        path: `${t.pathname}${t.search}`, method,
        headers: { ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) },
        rejectUnauthorized: !INSECURE, timeout: 60000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", (e) => reject(new Error(e.code ? `${e.code}: ${e.message}` : e.message)));
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  const res = await request(`${API_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: GRANT_TYPE, username: USERNAME, password: PASSWORD }).toString(),
  });
  if (res.status !== 200) throw new Error(`auth failed (HTTP ${res.status})`);
  const t = JSON.parse(res.text).access_token;
  if (!t) throw new Error("no access_token returned");
  return t;
}

/**
 * A department filter is ESSENTIAL here, not cosmetic. Without it the endpoint
 * scans the whole catalogue (1.6M+ rows) for every probe, which takes minutes
 * per candidate. Scoped to one small department each probe returns in ~1.5s.
 */
function stockBody(select, pageSize = 1) {
  return JSON.stringify({
    requestType: "GET",
    request: {
      select,
      filters: [
        { fieldName: "LotStatusDB", value: ["STOCK", "MEMO"] },
        { fieldName: "DepartmentAccountName", value: ["02-Polish 2", "Polish-2"] },
      ],
      IsLoadingAll: true,
    },
    pageSize,
    pageNumber: 0,
  });
}

async function callStock(token, select, pageSize = 1) {
  return request(`${API_BASE}/api/stock`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: stockBody(select, pageSize),
  });
}

const MISSING_FIELD = /No property or field '([^']+)' exists/i;

async function main() {
  if (!API_BASE || !USERNAME || !PASSWORD) {
    console.error("Missing SKYLAB_API_* env vars. Use --env-file=.env.local");
    process.exit(1);
  }

  console.log("\n=== Skylab field discovery ===\n");
  const token = await getToken();
  console.log("auth OK\n");

  // --dump: fetch one lot with a known-good column set and print every key the
  // API actually returns. `select` restricts the projection, so this shows what
  // comes back for our current field list -- useful for spotting a company value
  // hiding under an unexpected name.
  if (args.includes("--dump")) {
    const res = await callStock(token, "LotID,LotName,DepartmentAccountName,LotStatusDB", 1);
    console.log(`HTTP ${res.status}`);
    if (res.status !== 200) {
      console.log(res.text.slice(0, 500));
      process.exit(1);
    }
    const payload = JSON.parse(res.text);
    const items = Array.isArray(payload) ? payload : payload?.data ?? [];
    console.log(`top level: ${Array.isArray(payload) ? "array" : Object.keys(payload).join(", ")}`);
    console.log(`records: ${items.length}\n`);
    if (items[0]) console.log(JSON.stringify(items[0], null, 2));
    return;
  }

  console.log(`Testing ${CANDIDATES.length} candidate column names on type 'Lot'...\n`);

  const exists = [];
  const absent = [];
  const unclear = [];

  for (const name of CANDIDATES) {
    let res;
    try {
      res = await callStock(token, `LotID,${name}`, 1);
    } catch (err) {
      unclear.push([name, err.message.slice(0, 60)]);
      continue;
    }

    if (res.status === 200) {
      exists.push(name);
      console.log(`  EXISTS   ${name}`);
      continue;
    }

    const m = MISSING_FIELD.exec(res.text || "");
    if (m && m[1].toLowerCase() === name.toLowerCase()) {
      absent.push(name);
    } else {
      unclear.push([name, String(res.text || "").slice(0, 80)]);
      console.log(`  ?        ${name} -> HTTP ${res.status}: ${String(res.text || "").slice(0, 70)}`);
    }
  }

  console.log(`\n--- ${exists.length} exist, ${absent.length} absent, ${unclear.length} unclear ---`);
  if (exists.length) {
    console.log(`\nEXISTING COLUMNS: ${exists.join(", ")}`);
    console.log("\nSampling values for each existing column...\n");
    for (const name of exists) {
      const res = await callStock(token, `LotID,${name}`, 25);
      if (res.status !== 200) continue;
      const payload = JSON.parse(res.text);
      const items = Array.isArray(payload) ? payload : payload?.data ?? [];
      const values = {};
      for (const it of items) {
        const v = it[name] ?? "<null>";
        values[v] = (values[v] || 0) + 1;
      }
      console.log(`  ${name}: ${JSON.stringify(values).slice(0, 220)}`);
    }
    console.log("\nLook for the column whose values include SKYLAB / MAUNI / THE DIAMOND LAB.");
  } else {
    console.log("\nNo candidate matched. Re-run with --try Name1,Name2 using names from");
    console.log("the Skylab field picker, or ask the provider for the Lot company column.");
  }
  console.log();
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}`);
  process.exit(1);
});
