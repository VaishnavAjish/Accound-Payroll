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
 */

import { NextResponse } from "next/server";
import https from "https";
import { parseRequestedDepartments } from "@/lib/fantacyDeptMapper";
import { applyStockPipeline } from "@/lib/fantacyStockFilter";

const API_BASE = process.env.SKYLAB_API_BASE;
const USERNAME = process.env.SKYLAB_API_USERNAME;
const PASSWORD = process.env.SKYLAB_API_PASSWORD;

/**
 * Optional strict company scoping.
 *
 * Live Skylab stock records carry NO company field (verified against the real
 * 86-record Polish-2 export and the Skylab sheet export). Company isolation is
 * therefore enforced by the API credential/tenant, not per row. Leave unset.
 *
 * Set it only if a company field is confirmed present in the response, in which
 * case filtering becomes strict exact-match and rows missing the field are
 * rejected. Never guess a value here.
 */
const COMPANY_ID = process.env.SKYLAB_COMPANY_ID || null;

/**
 * Row-level company filtering is SEPARATE from sending CompanyID upstream.
 *
 * Real Skylab records carry no company field, so filtering rows by company
 * would reject everything. Only enable this if the response is confirmed to
 * contain a company field.
 */
const ENFORCE_ROW_COMPANY_FILTER = process.env.SKYLAB_ENFORCE_ROW_COMPANY_FILTER === "true";
const ROW_COMPANY_FILTER = ENFORCE_ROW_COMPANY_FILTER ? COMPANY_ID : null;

const ENABLE_MOCK_DATA = process.env.ENABLE_FANTACY_MOCK_DATA === "true";
const ALLOW_INSECURE_TLS = process.env.SKYLAB_ALLOW_INSECURE_TLS === "true";
const EMIT_DIAGNOSTICS = process.env.SKYLAB_DIAGNOSTICS === "true";

// Pagination guards. The old route accepted take=100000 and asserted a
// hard-coded 2,000,000 total, which drove endless client accumulation.
const MAX_TAKE = 5000;
const DEFAULT_TAKE = 1000;
const MAX_SKIP = 5_000_000;

/**
 * TLS verification stays ON by default. `SKYLAB_ALLOW_INSECURE_TLS=true` is a
 * development escape hatch for a self-signed cert and is refused in production.
 */
const insecureTlsAllowed = ALLOW_INSECURE_TLS && process.env.NODE_ENV !== "production";

/**
 * Requests go through `node:https`, NOT global fetch.
 *
 * Node's global fetch is undici, which silently IGNORES the `agent` option.
 * The previous implementation passed `agent` to fetch, so TLS verification was
 * never actually relaxed -- against a self-signed Skylab certificate every live
 * call failed and the route fell through to the synthetic generator. `node:https`
 * honours `rejectUnauthorized`, so the flag now does what it claims.
 */
function httpsRequest(url, { method = "GET", headers = {}, body } = {}) {
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
        timeout: 60000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );

    req.on("timeout", () => req.destroy(new Error("Skylab request timed out after 60s.")));
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
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username: USERNAME,
      password: PASSWORD,
    }).toString(),
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
 * TEMPORARY diagnostic: Skylab's /api/stock throws a bare .NET
 * NullReferenceException, which names no missing field. `requireTotalCount`
 * identifies this as a DevExtreme.AspNet.Data backend, so the candidate request
 * shapes are a known, finite set rather than open-ended guesses.
 *
 * Hit /api/fantacy-stock?probe=1 to try each shape and report which returns 200.
 * DELETE this function and its branch once the correct shape is known.
 */
function candidateRequestShapes(skip, take) {
  const devExtremeFull = {
    skip,
    take,
    requireTotalCount: true,
    requireGroupCount: false,
    isCountQuery: false,
    isSummaryQuery: false,
    sort: [],
    filter: [],
    group: null,
    select: [],
    totalSummary: [],
    groupSummary: [],
  };

  return [
    { name: "current (take/skip/requireTotalCount)", body: { take, skip, requireTotalCount: true } },
    { name: "devextreme-full", body: devExtremeFull },
    { name: "devextreme-nulls", body: { ...devExtremeFull, sort: null, filter: null, select: null, totalSummary: null, groupSummary: null } },
    { name: "wrapped-loadOptions", body: { loadOptions: devExtremeFull } },
    { name: "minimal (take/skip)", body: { take, skip } },
    { name: "empty-object", body: {} },
  ];
}

async function runShapeProbe(skip, take) {
  const token = await getAuthToken();
  const results = [];

  for (const shape of candidateRequestShapes(skip, take)) {
    try {
      const res = await httpsRequest(`${API_BASE}/api/stock`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(shape.body),
      });

      let recordCount = null;
      let topLevelKeys = null;
      if (res.status === 200) {
        try {
          const parsed = JSON.parse(res.text);
          const items = Array.isArray(parsed) ? parsed : parsed?.data;
          recordCount = Array.isArray(items) ? items.length : null;
          topLevelKeys = Array.isArray(parsed) ? ["<array>"] : Object.keys(parsed || {});
        } catch {
          topLevelKeys = ["<non-JSON>"];
        }
      }

      results.push({
        shape: shape.name,
        status: res.status,
        recordCount,
        topLevelKeys,
        upstream: res.status === 200 ? null : String(res.text || "").slice(0, 160),
      });
    } catch (err) {
      results.push({ shape: shape.name, status: "request-error", upstream: err.message.slice(0, 160) });
    }
  }

  return results;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const skip = clampInt(searchParams.get("skip"), 0, 0, MAX_SKIP);
  const take = clampInt(searchParams.get("take"), DEFAULT_TAKE, 1, MAX_TAKE);
  const departments = parseRequestedDepartments(searchParams.get("departments"));

  /**
   * TEMPORARY control test. Every request body returns the same
   * NullReferenceException, which is ALSO what a catch-all error handler would
   * return for a wrong path. Probing a deliberately nonsense path reveals which:
   *   nonsense -> 404  => /api/stock really exists; the 500 is account/permission
   *   nonsense -> 500  => their handler masks everything; conclusions unreliable
   * DELETE with the other probe code.
   */
  if (searchParams.get("probe") === "2" && !ENABLE_MOCK_DATA) {
    if (missingCredentials()) {
      return NextResponse.json({ error: "Skylab API is not configured." }, { status: 500 });
    }
    try {
      const token = await getAuthToken();
      const attempts = [
        { method: "POST", path: "/api/stock" },
        { method: "GET", path: "/api/stock" },
        { method: "POST", path: "/api/definitely-not-a-real-endpoint-xyz" },
        { method: "GET", path: "/api/definitely-not-a-real-endpoint-xyz" },
      ];
      const results = [];
      for (const attempt of attempts) {
        try {
          const res = await httpsRequest(`${API_BASE}${attempt.path}`, {
            method: attempt.method,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            ...(attempt.method === "POST"
              ? { body: JSON.stringify({ skip: 0, take: 5, requireTotalCount: true }) }
              : {}),
          });
          results.push({
            call: `${attempt.method} ${attempt.path}`,
            status: res.status,
            body: String(res.text || "").slice(0, 150),
          });
        } catch (err) {
          results.push({ call: `${attempt.method} ${attempt.path}`, status: "error", body: err.message.slice(0, 150) });
        }
      }
      return NextResponse.json({ endpointProbe: results });
    } catch (err) {
      return NextResponse.json({ endpointProbe: null, error: err.message }, { status: 502 });
    }
  }

  if (searchParams.get("probe") === "1" && !ENABLE_MOCK_DATA) {
    if (missingCredentials()) {
      return NextResponse.json({ error: "Skylab API is not configured." }, { status: 500 });
    }
    try {
      return NextResponse.json({ probe: await runShapeProbe(skip, Math.min(take, 5)) });
    } catch (err) {
      return NextResponse.json({ probe: null, error: err.message }, { status: 502 });
    }
  }

  try {
    let rawItems = [];
    let reportedTotal = null;
    let source = "live";

    if (ENABLE_MOCK_DATA) {
      // Development mode only. Never reached in a normal production build.
      source = "mock";
      const { generateMockStock } = await import("@/lib/dev/fantacyMockStock");
      rawItems = generateMockStock(skip, take, 5000);
      reportedTotal = 5000;
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

      // Skylab's /api/stock throws a .NET NullReferenceException when expected
      // parameters are absent, so send the full shape. CompanyID is included
      // when configured -- server-side company scoping is stronger than
      // filtering rows after the fact.
      const stockRequestBody = {
        take,
        skip,
        requireTotalCount: true,
        ...(COMPANY_ID ? { CompanyID: COMPANY_ID } : {}),
      };

      const token = await getAuthToken();
      const stockRes = await httpsRequest(`${API_BASE}/api/stock`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(stockRequestBody),
      });

      if (stockRes.status !== 200) {
        // Drop a stale token so the next attempt re-authenticates.
        if (stockRes.status === 401) {
          cachedToken = null;
          tokenExpiresAt = 0;
        }
        return errorResponse({
          status: 502,
          message: `Skylab stock request failed (HTTP ${stockRes.status}).`,
          skip,
          take,
          // Upstream stock-endpoint error text. Safe: this endpoint never echoes
          // credentials (unlike /token, whose body is deliberately never read).
          diagnostics: {
            requestBody: stockRequestBody,
            upstreamBody: String(stockRes.text || "").slice(0, 600),
          },
        });
      }

      let payload;
      try {
        payload = JSON.parse(stockRes.text);
      } catch {
        return errorResponse({
          status: 502,
          message: "Skylab returned a non-JSON stock response.",
          skip,
          take,
        });
      }

      if (Array.isArray(payload)) {
        rawItems = payload;
      } else if (payload && Array.isArray(payload.data)) {
        rawItems = payload.data;
        reportedTotal = Number.isFinite(payload.totalCount) ? payload.totalCount : null;
      } else {
        return errorResponse({
          status: 502,
          message: "Skylab returned an unrecognised stock response shape.",
          skip,
          take,
          diagnostics: {
            topLevelType: Array.isArray(payload) ? "array" : typeof payload,
            topLevelKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
          },
        });
      }
    }

    // Company -> department -> dedupe. Zero matches stays zero: there is no
    // "if empty, return everything" fallback anywhere in this path.
    const { records, diagnostics } = applyStockPipeline(rawItems, {
      companyId: ROW_COMPANY_FILTER,
      departments,
    });

    // hasMore is driven by what the API actually reported, never by a constant.
    // Falling back to "a full raw page implies another page" keeps pagination
    // correct when the endpoint omits totalCount.
    const pageWasFull = rawItems.length >= take;
    const hasMore =
      reportedTotal !== null ? skip + rawItems.length < reportedTotal : pageWasFull;

    if (EMIT_DIAGNOSTICS) {
      console.log("[fantacy-stock] page diagnostics", {
        skip,
        take,
        source,
        requestedDepartments: departments,
        ...diagnostics,
      });
    }

    return NextResponse.json(
      {
        success: true,
        source,
        data: records,
        records,
        batchCount: records.length,
        skip,
        take,
        // Counts describe the FILTERED real result, not the upstream catalogue.
        filteredCount: records.length,
        totalCount: reportedTotal,
        rawPageCount: rawItems.length,
        hasMore,
        nextSkip: skip + rawItems.length,
        lastUpdated: new Date().toISOString(),
        error: null,
        ...(EMIT_DIAGNOSTICS ? { diagnostics } : {}),
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
    });
  }
}
