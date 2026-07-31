/**
 * Skylab connectivity + contract probe.
 *
 * Validates credentials and the /api/stock request contract in isolation, so the
 * live route is never edited blind. Prints structure and counts only -- never the
 * password, never the bearer token, never full record bodies.
 *
 * Run:
 *   node --env-file=.env.local scripts/skylab-probe.mjs
 *   node --env-file=.env.local scripts/skylab-probe.mjs --dept "Polish-2"
 *   node --env-file=.env.local scripts/skylab-probe.mjs --raw   (dump 1 record)
 */

import https from "node:https";

const API_BASE = process.env.SKYLAB_API_BASE;
const USERNAME = process.env.SKYLAB_API_USERNAME;
const PASSWORD = process.env.SKYLAB_API_PASSWORD;
const GRANT_TYPE = process.env.SKYLAB_API_GRANT_TYPE || "password";
const INSECURE = process.env.SKYLAB_ALLOW_INSECURE_TLS === "true";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && !String(args[i + 1] ?? "").startsWith("--") ? args[i + 1] : null;
};
const has = (name) => args.includes(`--${name}`);

const DEPARTMENT = flag("dept");
const PAGE_SIZE = Number(flag("pageSize") || 5);
/**
 * Company scoping is by NUMERIC CompanyID -- passing a name yields
 * "SKYLAB is not a valid value for Int32". Off by default: the credential is
 * already company-scoped upstream (every row returns CompanyID 1), so this
 * mirrors the route, where SKYLAB_COMPANY_ID is normally unset.
 * Use --company 1 to exercise the filter.
 */
const COMPANY = args.includes("--company") ? flag("company") ?? "" : "";

/**
 * Imported, never re-declared. A local copy drifted from the route once already
 * and made a probe run "verify" a select list production had stopped using.
 */
const { STOCK_SELECT_FIELD_LIST } = await import("../src/lib/fantacyStockFields.js");

// Company scoping is by numeric CompanyID (already in the shared list). Pass
// --companyField <name> only to test an alternative column name.
const COMPANY_FIELD = flag("companyField") || "CompanyID";
const SELECT_FIELDS = STOCK_SELECT_FIELD_LIST.join(",");

function request(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const t = new URL(url);
    const req = https.request(
      {
        protocol: t.protocol,
        hostname: t.hostname,
        port: t.port || 443,
        path: `${t.pathname}${t.search}`,
        method,
        headers: { ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) },
        rejectUnauthorized: !INSECURE,
        timeout: 60000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("timeout", () => req.destroy(new Error("timed out after 60s")));
    req.on("error", (e) => reject(new Error(e.code ? `${e.code}: ${e.message}` : e.message)));
    if (body) req.write(body);
    req.end();
  });
}

function line(label, value) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

async function main() {
  console.log("\n=== Skylab probe ===\n");

  const missing = ["SKYLAB_API_BASE", "SKYLAB_API_USERNAME", "SKYLAB_API_PASSWORD"].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    console.error(`FAIL: missing env vars: ${missing.join(", ")}`);
    console.error("Run with: node --env-file=.env.local scripts/skylab-probe.mjs");
    process.exit(1);
  }

  console.log("Step 0 - configuration");
  line("base URL", API_BASE);
  line("username", USERNAME);
  line("password", `set (${PASSWORD.length} chars, not shown)`);
  line("grant_type", GRANT_TYPE);
  line("TLS verification", INSECURE ? "DISABLED (insecure)" : "enabled");

  // --- Step 1: token -------------------------------------------------------
  console.log("\nStep 1 - POST /token");
  let token;
  try {
    const res = await request(`${API_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: GRANT_TYPE,
        username: USERNAME,
        password: PASSWORD,
      }).toString(),
    });

    line("HTTP status", res.status);
    if (res.status !== 200) {
      // Body may echo credentials back -- show status only.
      console.error("  FAIL: authentication rejected. Check username/password/grant_type.");
      process.exit(1);
    }

    const data = JSON.parse(res.text);
    token = data.access_token;
    if (!token) {
      console.error("  FAIL: 200 OK but no access_token in response.");
      console.error(`  keys returned: ${Object.keys(data).join(", ")}`);
      process.exit(1);
    }
    line("access_token", `received (${token.length} chars, not shown)`);
    line("token_type", data.token_type ?? "(absent)");
    line("expires_in", data.expires_in ?? "(absent)");
    if (data.userName) line("userName", data.userName);
    console.log("  OK");
  } catch (err) {
    console.error(`  FAIL: ${err.message}`);
    if (/CERT|SELF_SIGNED|ALT_NAME/i.test(err.message)) {
      console.error("  -> TLS cert problem. For local testing only, set SKYLAB_ALLOW_INSECURE_TLS=true");
    }
    process.exit(1);
  }

  // --- Step 2: stock, documented contract ----------------------------------
  console.log("\nStep 2 - POST /api/stock (documented contract)");

  const filters = [
    ...(COMPANY && COMPANY_FIELD ? [{ fieldName: COMPANY_FIELD, value: COMPANY }] : []),
    { fieldName: "LotStatusDB", value: ["STOCK", "MEMO"] },
    ...(DEPARTMENT ? [{ fieldName: "DepartmentAccountName", value: [DEPARTMENT] }] : []),
  ];

  const body = {
    requestType: "GET",
    request: { select: SELECT_FIELDS, filters, IsLoadingAll: true },
    pageSize: PAGE_SIZE,
    pageNumber: 0,
  };

  line("pageSize / pageNumber", `${PAGE_SIZE} / 0`);
  line("company field", COMPANY_FIELD || "(unknown - not filtering by company)");
  line("company filter", COMPANY_FIELD ? COMPANY || "(none)" : "(disabled)");
  line("department filter", DEPARTMENT || "(none - all departments)");
  line("select fields", SELECT_FIELDS.split(",").length);

  const res = await request(`${API_BASE}/api/stock`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  line("HTTP status", res.status);

  if (res.status !== 200) {
    console.error("\n  FAIL: stock request rejected.");
    console.error(`  upstream body: ${String(res.text || "").slice(0, 800)}`);
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(res.text);
  } catch {
    console.error("  FAIL: non-JSON response.");
    console.error(`  first 400 chars: ${String(res.text).slice(0, 400)}`);
    process.exit(1);
  }

  const items = Array.isArray(payload) ? payload : payload?.data ?? payload?.Data ?? null;

  console.log("\nStep 3 - response shape");
  line("top level", Array.isArray(payload) ? "array" : `object {${Object.keys(payload).join(", ")}}`);
  line("records this page", Array.isArray(items) ? items.length : "COULD NOT LOCATE ARRAY");

  if (!Array.isArray(items)) {
    console.error("\n  Records array not found. Inspect the keys above and adjust.");
    process.exit(1);
  }
  for (const k of ["totalCount", "TotalCount", "totalRecords", "recordsTotal"]) {
    if (payload && payload[k] !== undefined) line(`total (${k})`, payload[k]);
  }

  if (!items.length) {
    console.log("\n  0 records. Credentials work but filters matched nothing.");
    console.log("  Try widening: drop --dept, or check LotStatusDB values for this account.");
    process.exit(0);
  }

  console.log("\nStep 4 - first record fields");
  const first = items[0];
  console.log(`  ${Object.keys(first).length} fields returned:`);
  for (const [k, v] of Object.entries(first)) {
    const shown = v === null ? "null" : String(v).slice(0, 48);
    console.log(`    ${k.padEnd(34)} ${shown}`);
  }

  console.log("\nStep 5 - company + department spread on this page");
  const tally = (field) => {
    const out = {};
    for (const it of items) {
      const v = it[field] ?? "<absent>";
      out[v] = (out[v] || 0) + 1;
    }
    return out;
  };

  const companies = COMPANY_FIELD ? tally(COMPANY_FIELD) : {};
  if (COMPANY_FIELD) line(COMPANY_FIELD, JSON.stringify(companies));
  if (COMPANY && COMPANY_FIELD) {
    const foreign = Object.keys(companies).filter(
      (c) => c !== "<absent>" && c.toUpperCase() !== COMPANY.toUpperCase()
    );
    if (foreign.length) {
      console.log(`  WARNING: upstream company filter did NOT hold. Foreign: ${foreign.join(", ")}`);
      console.log("  -> the route's local filter will still remove these, but every");
      console.log("     foreign row is wasted transfer. Report the field name to Skylab.");
    } else if (companies["<absent>"]) {
      console.log("  WARNING: some rows carry no Company field; the route rejects those.");
    } else {
      console.log("  OK: upstream company filter held.");
    }
  }

  line("DepartmentAccountName", JSON.stringify(tally("DepartmentAccountName")));
  console.log("  -> these values must normalize via fantacyDeptMapper.normalizeDepartment()");

  if (has("raw")) {
    console.log("\nRaw first record:\n");
    console.log(JSON.stringify(first, null, 2));
  }

  console.log("\n=== probe complete ===\n");
}

main().catch((err) => {
  console.error(`\nUnexpected failure: ${err.message}`);
  process.exit(1);
});
