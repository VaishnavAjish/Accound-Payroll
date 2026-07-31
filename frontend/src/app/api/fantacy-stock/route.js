/**
 * Skylab stock proxy.
 *
 * Contract: this route returns LIVE Skylab stock, or an explicit error. It never
 * substitutes generated data for a failed or empty live result.
 *
 * Response `source` is always one of:
 *   "live" - every record came from the Skylab API
 *   "mock" - ENABLE_FANTACY_MOCK_DATA=true; records are synthetic and tagged
 * The two are never mixed in a single response.
 *
 * ---------------------------------------------------------------------------
 * Verified behaviour of Skylab's POST /api/stock (measured, not assumed):
 *
 *   1. `pageSize` and `pageNumber` are IGNORED. A request with pageSize:5
 *      returned 68 records. The endpoint always returns the COMPLETE result set
 *      for the given filters.
 *   2. `IsLoadingAll` changes nothing -- true, false and omitted all behave
 *      identically.
 *   3. Consequently FILTERS ARE THE ONLY VOLUME CONTROL. With no department
 *      filter the endpoint returned 1,668,406 records in a single response.
 *      With a department filter it returned 68 in ~1.5s.
 *   4. `select` is required and validated: an unknown column fails the request
 *      with "No property or field 'X' exists in type 'Lot'". `Company` does NOT
 *      exist; `CompanyID` does.
 *   5. Only ONE access token is valid per user at a time. Authenticating again
 *      invalidates the previous token, and in-flight requests using it start
 *      returning 401. Do not share one credential across applications.
 *
 * Because upstream paging does not exist, this route fetches the full filtered
 * set for a department scope, caches it briefly, and paginates locally. The
 * client's skip/take interface is unchanged.
 */

import { NextResponse } from "next/server";
import https from "https";
import { parseRequestedDepartments, upstreamDepartmentValues } from "@/lib/fantacyDeptMapper";
import { applyStockPipeline } from "@/lib/fantacyStockFilter";
import { STOCK_SELECT_FIELDS } from "@/lib/fantacyStockFields";

const API_BASE = process.env.SKYLAB_API_BASE;
const USERNAME = process.env.SKYLAB_API_USERNAME;
const PASSWORD = process.env.SKYLAB_API_PASSWORD;
const GRANT_TYPE = process.env.SKYLAB_API_GRANT_TYPE || "password";

/**
 * Optional company scoping on the `CompanyID` column.
 *
 * Measured: every row returned by the current credential carries CompanyID 1,
 * so the account is already company-scoped upstream and this filter is a no-op.
 * It is kept because it costs nothing and becomes the guarantee if a broader
 * credential is ever used. Leave unset unless a multi-company account is in use.
 *
 * NOTE: the value is the numeric CompanyID (e.g. "1"), NOT a display name like
 * "SKYLAB". There is no `Company` name column on type `Lot`.
 */
const COMPANY_ID = process.env.SKYLAB_COMPANY_ID?.trim() || null;

const ENABLE_MOCK_DATA = process.env.ENABLE_FANTACY_MOCK_DATA === "true";
const ALLOW_INSECURE_TLS = process.env.SKYLAB_ALLOW_INSECURE_TLS === "true";
const EMIT_DIAGNOSTICS = process.env.SKYLAB_DIAGNOSTICS === "true";

/**
 * Lot statuses treated as live stock. Comma-separated override via
 * SKYLAB_LOT_STATUS; an empty value disables the status filter.
 */
const LOT_STATUS =
  process.env.SKYLAB_LOT_STATUS !== undefined
    ? process.env.SKYLAB_LOT_STATUS.split(",").map((s) => s.trim()).filter(Boolean)
    : ["STOCK", "MEMO"];

/**
 * Columns requested from Skylab. Defined in @/lib/fantacyStockFields so the
 * probe script sends exactly what production sends -- see that file for the
 * verified-present and verified-absent column lists.
 */
const SELECT_FIELDS = STOCK_SELECT_FIELDS;

// Single-pass full payload streaming guard. Upstream already returns full set in memory.
const MAX_TAKE = 100_000;
const DEFAULT_TAKE = 50_000;
const MAX_SKIP = 5_000_000;

/**
 * TLS verification stays ON by default. `SKYLAB_ALLOW_INSECURE_TLS=true` is a
 * development escape hatch for a self-signed cert and is refused in production.
 */
const insecureTlsAllowed = ALLOW_INSECURE_TLS && process.env.NODE_ENV !== "production";

/**
 * Requests go through `node:https`, NOT global fetch.
 *
 * Node's global fetch is undici, which silently IGNORES the `agent` option, so
 * `rejectUnauthorized` passed to fetch never takes effect. `node:https` honours
 * it, so the flag does what it claims.
 *
 * The timeout is generous: an unfiltered query can return >1.6M records.
 */
function httpsRequest(url, { method = "GET", headers = {}, body, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          ...headers,
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
        rejectUnauthorized: !insecureTlsAllowed,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );

    req.on("timeout", () =>
      req.destroy(new Error(`Skylab request timed out after ${Math.round(timeoutMs / 1000)}s.`))
    );
    // Surface the TLS/DNS/connection code -- this is what distinguishes a bad
    // certificate from a wrong host from refused credentials.
    req.on("error", (err) => reject(new Error(err.code ? `${err.code}: ${err.message}` : err.message)));

    if (body) req.write(body);
    req.end();
  });
}

let cachedToken = null;
let tokenExpiresAt = 0;

function missingCredentials() {
  return !API_BASE || !USERNAME || !PASSWORD;
}

async function getAuthToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await httpsRequest(`${API_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: GRANT_TYPE,
      username: USERNAME,
      password: PASSWORD,
    }).toString(),
    timeoutMs: 30000,
  });

  if (res.status !== 200) {
    // Status only -- the body can echo credentials back.
    const hint =
      res.status === 400 || res.status === 401
        ? " Check SKYLAB_API_USERNAME / SKYLAB_API_PASSWORD."
        : "";
    throw new Error(`Skylab authentication failed (HTTP ${res.status}).${hint}`);
  }

  let data;
  try {
    data = JSON.parse(res.text);
  } catch {
    throw new Error("Skylab authentication returned a non-JSON response.");
  }
  if (!data.access_token) throw new Error("Skylab authentication returned no access token.");

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + ((data.expires_in || 3600) - 300) * 1000;
  return cachedToken;
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * Cache of FULL filtered result sets, keyed by department scope.
 *
 * Upstream returns everything matching the filters, so re-fetching per client
 * page would repeat the entire transfer. One fetch serves every page within the
 * TTL. Kept short so "real time" still means minutes-fresh, not hours.
 */
const SCOPE_CACHE_TTL_MS = 60 * 1000;
const scopeCache = new Map();

function getCachedScope(key) {
  const entry = scopeCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    scopeCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedScope(key, records, diagnostics) {
  if (scopeCache.size > 20) {
    const firstKey = scopeCache.keys().next().value;
    if (firstKey) scopeCache.delete(firstKey);
  }
  scopeCache.set(key, { records, diagnostics, expiresAt: Date.now() + SCOPE_CACHE_TTL_MS });
}

function errorResponse({ status, message, skip, take, diagnostics }) {
  return NextResponse.json(
    {
      success: false,
      source: "live",
      data: [],
      records: [],
      batchCount: 0,
      skip,
      take,
      totalCount: 0,
      filteredCount: 0,
      hasMore: false,
      nextSkip: skip,
      lastUpdated: new Date().toISOString(),
      error: message,
      ...(EMIT_DIAGNOSTICS && diagnostics ? { diagnostics } : {}),
    },
    { status, headers: NO_CACHE_HEADERS }
  );
}

/**
 * Build the /api/stock request body.
 *
 * Skylab's documented envelope: `request` carrying `select` plus a declarative
 * `filters` tree. Filters combine with implicit AND.
 *
 * pageSize/pageNumber are sent for protocol completeness but are known to be
 * ignored -- never rely on them to bound the response.
 */
function buildStockRequest(departments) {
  const filters = [];

  if (COMPANY_ID) {
    filters.push({ fieldName: "CompanyID", value: COMPANY_ID });
  }
  if (LOT_STATUS.length) {
    filters.push({ fieldName: "LotStatusDB", value: LOT_STATUS });
  }

  // ALWAYS present. Without a department filter the endpoint returns the entire
  // catalogue (measured: 1,668,406 rows). An empty `departments` request means
  // "all OUR departments", never "everything".
  filters.push({
    fieldName: "DepartmentAccountName",
    value: upstreamDepartmentValues(departments),
  });

  return {
    requestType: "GET",
    request: { select: SELECT_FIELDS, filters, IsLoadingAll: true },
    pageSize: 0,
    pageNumber: 0,
  };
}

/** Fetch and filter the complete result set for a department scope. */
async function fetchScope(departments) {
  const token = await getAuthToken();
  const requestBody = buildStockRequest(departments);

  let res = await httpsRequest(`${API_BASE}/api/stock`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  // Skylab invalidates a token when the same user authenticates elsewhere, so a
  // 401 mid-session is expected rather than exceptional. Re-auth once.
  if (res.status === 401) {
    cachedToken = null;
    tokenExpiresAt = 0;
    const freshToken = await getAuthToken();
    res = await httpsRequest(`${API_BASE}/api/stock`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${freshToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  }

  if (res.status !== 200) {
    const err = new Error(`Skylab stock request failed (HTTP ${res.status}).`);
    // Upstream stock-endpoint error text. Safe: this endpoint never echoes
    // credentials (unlike /token, whose body is deliberately never read).
    err.diagnostics = {
      requestBody,
      upstreamBody: String(res.text || "").slice(0, 600),
    };
    throw err;
  }

  let payload;
  try {
    payload = JSON.parse(res.text);
  } catch {
    throw new Error("Skylab returned a non-JSON stock response.");
  }

  let rawItems;
  if (Array.isArray(payload)) {
    rawItems = payload;
  } else if (payload && Array.isArray(payload.data)) {
    rawItems = payload.data;
  } else {
    const err = new Error("Skylab returned an unrecognised stock response shape.");
    err.diagnostics = {
      topLevelType: Array.isArray(payload) ? "array" : typeof payload,
      topLevelKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
    };
    throw err;
  }

  // Re-apply company and department filtering locally. Intentional, not
  // redundant: if Skylab ever ignores or drops a filter it does not recognise,
  // this is what stops unrelated rows reaching the client.
  const { records, diagnostics } = applyStockPipeline(rawItems, {
    company: COMPANY_ID,
    departments,
  });

  return { records, diagnostics: { ...diagnostics, upstreamRows: rawItems.length } };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const skip = clampInt(searchParams.get("skip"), 0, 0, MAX_SKIP);
  const take = clampInt(searchParams.get("take"), DEFAULT_TAKE, 1, MAX_TAKE);
  const departments = parseRequestedDepartments(searchParams.get("departments"));
  const forceFresh = searchParams.get("fresh") === "1";

  // Keyed by SCOPE, not by page: one upstream fetch serves every page.
  const scopeKey = `${departments.join(",")}_${COMPANY_ID || ""}_${LOT_STATUS.join(",")}`;

  try {
    let scope = forceFresh ? null : getCachedScope(scopeKey);

    if (!scope) {
      if (ENABLE_MOCK_DATA) {
        // Development mode only. Never reached in a normal production build.
        const { generateMockStock } = await import("@/lib/dev/fantacyMockStock");
        const mock = generateMockStock(0, 5000, 5000);
        scope = { records: mock, diagnostics: { received: mock.length, finalCount: mock.length } };
      } else {
        if (missingCredentials()) {
          return errorResponse({
            status: 500,
            message:
              "Skylab API is not configured. Set SKYLAB_API_BASE, SKYLAB_API_USERNAME and SKYLAB_API_PASSWORD.",
            skip,
            take,
          });
        }
        scope = await fetchScope(departments);
      }
      setCachedScope(scopeKey, scope.records, scope.diagnostics);
    }

    const all = scope.records;
    // Pagination is OURS: upstream has already returned everything.
    const page = all.slice(skip, skip + take);
    const nextSkip = skip + page.length;
    const hasMore = nextSkip < all.length;

    if (EMIT_DIAGNOSTICS) {
      console.log("[fantacy-stock] page diagnostics", {
        skip,
        take,
        requestedDepartments: departments,
        scopeTotal: all.length,
        ...scope.diagnostics,
      });
    }

    return NextResponse.json(
      {
        success: true,
        source: ENABLE_MOCK_DATA ? "mock" : "live",
        data: page,
        records: page,
        batchCount: page.length,
        skip,
        take,
        // Counts describe the FILTERED real result, not the upstream catalogue.
        filteredCount: page.length,
        totalCount: all.length,
        rawPageCount: page.length,
        hasMore,
        nextSkip,
        lastUpdated: new Date().toISOString(),
        error: null,
        ...(EMIT_DIAGNOSTICS ? { diagnostics: scope.diagnostics } : {}),
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (err) {
    console.error("[fantacy-stock] proxy error:", err.message);
    return errorResponse({
      status: 502,
      message: err.message || "Skylab synchronisation failed.",
      skip,
      take,
      diagnostics: err.diagnostics,
    });
  }
}
