/**
 * Pure filtering pipeline for Skylab stock records.
 *
 * Extracted from the API route so it can be unit-tested without network access.
 * Every stage is explicit and counted, so the route can emit safe diagnostics
 * (counts only -- never credentials, tokens, or record bodies).
 *
 * Ordering is deliberate:
 *   raw -> company filter -> department filter -> dedupe
 * Company is applied first so foreign-company rows can never influence
 * department counts or the dedupe key space.
 */

import { getRecordDepartment, isCanonicalDepartment } from "./fantacyDeptMapper.js";

/**
 * Fingerprints of the retired synthetic generator. Kept here (not in the
 * dev-only module) so the client can purge stale mock rows from IndexedDB
 * without pulling the generator or its fixture into the production bundle.
 */
export const SYNTHETIC_LOT_ID_PREFIX = "831528";
export const SYNTHETIC_SERIE_PREFIX = "SER-50";
export const SYNTHETIC_REMARK_PREFIX = "Remark-10";

/**
 * True for any record produced by the synthetic generator, current or historic.
 *
 * Current generator output is explicitly tagged. Historic rows already sitting
 * in IndexedDB are not, so they are identified by fingerprint: at least two of
 * the three legacy prefixes must match. Requiring two prevents a real lot that
 * coincidentally starts with "831528" from being deleted as fake.
 */
export function isSyntheticRecord(item) {
  if (!item || typeof item !== "object") return false;
  if (item.__synthetic === true) return true;
  if (item.source === "mock") return true;

  const matches =
    (String(item.LotID || "").startsWith(SYNTHETIC_LOT_ID_PREFIX) ? 1 : 0) +
    (String(item.SerieID || "").startsWith(SYNTHETIC_SERIE_PREFIX) ? 1 : 0) +
    (String(item.ExternalSourceLotRemark || "").startsWith(SYNTHETIC_REMARK_PREFIX) ? 1 : 0);

  return matches >= 2;
}

/**
 * Company identity on a Skylab stock record is `CompanyID`, a NUMBER.
 *
 * Established directly against the live API, which validates `select` and names
 * any unknown column:
 *   - `Company`     -> "No property or field 'Company' exists in type 'Lot'"
 *   - `CompanyName` -> same rejection
 *   - `CompanyID`   -> accepted; every row returned by the current credential
 *                      carries CompanyID 1
 *
 * So the "SKYLAB / MAUNI / THE DIAMOND LAB" names in the Skylab UI field picker
 * are NOT available on this entity -- only the numeric id is. Configure
 * SKYLAB_COMPANY_ID with the number, never the display name.
 *
 * The current credential is already company-scoped upstream (a single CompanyID
 * across 1.6M+ rows), so this filter is normally a no-op. It is retained as the
 * guarantee if a broader, multi-company credential is ever used.
 *
 * `CompanyID` is listed first: it is the verified field. The rest are tolerated
 * aliases in case another endpoint spells it differently.
 */
export const COMPANY_ID_FIELDS = Object.freeze([
  "CompanyID",
  "Company_ID",
  "companyId",
  "Company",
  "CompanyName",
]);

export function readCompanyId(item) {
  if (!item || typeof item !== "object") return null;
  for (const field of COMPANY_ID_FIELDS) {
    const value = item[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

/**
 * Strict company isolation.
 *
 * Matching is case-insensitive ("SKYLAB" / "Skylab" are the same company) but
 * otherwise exact -- no prefix or substring matching, so "SKYLAB" can never
 * admit a differently-named tenant.
 *
 * A record with NO company field is REJECTED when a filter is active. Company
 * isolation is a correctness boundary: admitting rows of unknown provenance
 * would reintroduce exactly the cross-company bleed this filter exists to stop.
 *
 * @param {object[]} items
 * @param {string|null} expectedCompany  null/"" => company filtering disabled
 * @returns {{ kept: object[], rejected: number, byCompany: Record<string, number>, applied: boolean, missingField: number }}
 */
export function filterByCompany(items, expectedCompany) {
  const byCompany = {};
  let missingField = 0;

  for (const item of items) {
    const key = readCompanyId(item);
    if (key === null) missingField += 1;
    const tallyKey = key ?? "<absent>";
    byCompany[tallyKey] = (byCompany[tallyKey] || 0) + 1;
  }

  const expected = expectedCompany ? String(expectedCompany).trim().toUpperCase() : "";
  if (!expected) {
    return { kept: items, rejected: 0, byCompany, applied: false, missingField };
  }

  const kept = items.filter((item) => {
    const actual = readCompanyId(item);
    return actual !== null && actual.toUpperCase() === expected;
  });

  return { kept, rejected: items.length - kept.length, byCompany, applied: true, missingField };
}

/**
 * Exact canonical department matching against an allow-list.
 *
 * @param {object[]} items
 * @param {string[]} allowedCanonicalKeys  empty => all canonical departments
 * @returns {{ kept: object[], rejected: number, byDepartment: Record<string, number> }}
 */
export function filterByDepartment(items, allowedCanonicalKeys) {
  const allowed = (allowedCanonicalKeys || []).filter(isCanonicalDepartment);
  const allowSet = allowed.length ? new Set(allowed) : null;

  const byDepartment = {};
  const kept = [];

  for (const item of items) {
    const key = getRecordDepartment(item);
    const tallyKey = key || "<unrecognised>";
    byDepartment[tallyKey] = (byDepartment[tallyKey] || 0) + 1;

    // Unrecognised department => always rejected. Never fall back to "keep".
    if (!key) continue;
    if (allowSet && !allowSet.has(key)) continue;
    kept.push(item);
  }

  return { kept, rejected: items.length - kept.length, byDepartment };
}

/**
 * Stable dedupe key. LotID is the business identifier used by the Skylab sheet
 * exports and is unique per stone; Stock_ID is the fallback surrogate.
 * Records with neither are dropped -- they cannot be reconciled or upserted.
 */
export function stockRecordKey(item) {
  if (!item || typeof item !== "object") return null;
  for (const field of ["LotID", "Stock_ID", "DocID"]) {
    const value = item[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return `${field}:${String(value).trim()}`;
    }
  }
  return null;
}

/**
 * @returns {{ kept: object[], duplicates: number, unkeyed: number }}
 */
export function dedupeRecords(items, seenKeys = new Set()) {
  const kept = [];
  let duplicates = 0;
  let unkeyed = 0;

  for (const item of items) {
    const key = stockRecordKey(item);
    if (!key) {
      unkeyed += 1;
      continue;
    }
    if (seenKeys.has(key)) {
      duplicates += 1;
      continue;
    }
    seenKeys.add(key);
    kept.push(item);
  }

  return { kept, duplicates, unkeyed };
}

/**
 * Full pipeline. Returns the final records plus a diagnostics object that is
 * safe to log and safe to return to the client (counts only).
 */
export function applyStockPipeline(rawItems, { company: expectedCompany, companyId, departments } = {}) {
  const received = Array.isArray(rawItems) ? rawItems : [];

  // `companyId` is the legacy parameter name, kept so older callers keep working.
  const company = filterByCompany(received, expectedCompany ?? companyId);
  const department = filterByDepartment(company.kept, departments);
  const deduped = dedupeRecords(department.kept);

  return {
    records: deduped.kept,
    diagnostics: {
      received: received.length,
      companyFilterApplied: company.applied,
      rejectedByCompany: company.rejected,
      // Rows carrying no company field at all. Non-zero while a filter is active
      // means upstream is returning records we cannot attribute -- investigate
      // before trusting the result.
      missingCompanyField: company.missingField,
      countsByCompany: company.byCompany,
      rejectedByDepartment: department.rejected,
      countsByDepartment: department.byDepartment,
      duplicatesDropped: deduped.duplicates,
      unkeyedDropped: deduped.unkeyed,
      finalCount: deduped.kept.length,
    },
  };
}
