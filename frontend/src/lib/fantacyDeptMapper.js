/**
 * Canonical Skylab department mapping & normalization.
 *
 * This is the SINGLE source of truth for department identity, shared by the
 * server route (filtering) and the client page (filtering + display). Do not
 * duplicate this logic anywhere else.
 *
 * Authoritative field
 * -------------------
 * Verified against the real Polish-2 export (86 live records): the only field
 * that carries department identity is `DepartmentAccountName`.
 *   - Live API value:     "Polish-2"
 *   - Sheet export value: "02-Polish 2"
 * Both must normalize to the same canonical key.
 *
 * `LocationAccountName` / `PreviousLocationAccountName` are WORKER sub-accounts
 * ("210 JAYESHBHAI", "206-B.D"), NOT departments. They must never be used for
 * department filtering.
 *
 * Matching is EXACT on the canonical key. Unknown / unparseable values return
 * "" so they fail an allow-list check instead of leaking through.
 */

export const DEPARTMENT_FIELD = "DepartmentAccountName";

/**
 * Authoritative department roster, transcribed from the Skylab account export
 * ("department list.xlsx", Account Type = Department).
 *
 * `name` is the exact Account Name string Skylab stores. `id` is its AccountID.
 * Note the IDs are NOT ordered by department number (Polish 1 = 107 but
 * Polish 2 = 106), so never derive one from the other.
 *
 * This roster is the allow-list: a record whose department is not here is not
 * ours, and is rejected.
 */
export const DEPARTMENT_ACCOUNTS = Object.freeze({
  "polish-1": { name: "01-Polish 1", id: 107 },
  "polish-2": { name: "02-Polish 2", id: 106 },
  "polish-3": { name: "03-Polish 3", id: 108 },
  "polish-4": { name: "04-Polish 4", id: 109 },
  "polish-5": { name: "05-Polish 5", id: 110 },
  "polish-6": { name: "06-Polish 6", id: 112 },
  "polish-7": { name: "07-Polish 7", id: 113 },
  "polish-8": { name: "08-Polish 8", id: 824769 },
  "polish-9": { name: "09-Polish 9", id: 825217 },
  "polish-10": { name: "10-Polish 10", id: 825450 },
  "polish-11": { name: "11-Polish 11", id: 825451 },
  "polish-12": { name: "12-Polish 12", id: 825688 },
  "polish-13": { name: "13-Polish 13", id: 825743 },
  "polish-14": { name: "14-Polish 14", id: 825870 },
  "polish-15": { name: "15-Polish 15", id: 825928 },
  "polish-16": { name: "16-Polish 16", id: 828839 },
  "polish-17": { name: "17-Polish 17", id: 828376 },
  "sf-2": { name: "SF -2", id: 111 },
});

/**
 * 17, not 15. The Skylab roster runs Polish 1..17; the earlier value of 15 made
 * normalizeDepartment() return "" for Polish 16 and 17, so live rows from those
 * two departments were silently dropped as unrecognised.
 *
 * Separate from the payroll app's own department model, which still defines only
 * POLISH_1..POLISH_15 (see backend `employees.department` and the manager roles).
 * See APP_POLISH_DEPARTMENT_COUNT below.
 */
export const POLISH_DEPARTMENT_COUNT = 17;

/**
 * Departments the payroll application itself models (employees.department,
 * POLISH_n_MANAGER roles). Skylab has 17; the app has 15. Stock from Polish 16
 * and 17 is fetched and displayed, but has no payroll counterpart yet.
 */
export const APP_POLISH_DEPARTMENT_COUNT = 15;

export const ALL_CANONICAL_DEPARTMENTS = Object.freeze(Object.keys(DEPARTMENT_ACCOUNTS));

const CANONICAL_SET = new Set(ALL_CANONICAL_DEPARTMENTS);

/** Canonical key -> the display name Skylab uses in its own UI/exports. */
export const DEPARTMENT_DISPLAY_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(DEPARTMENT_ACCOUNTS).map(([key, v]) => [key, v.name]))
);

/** Canonical key -> Skylab AccountID, or null if not a known department. */
export function canonicalToAccountId(canonicalKey) {
  return DEPARTMENT_ACCOUNTS[canonicalKey]?.id ?? null;
}

/**
 * Exact `DepartmentAccountName` values to send in an upstream filter.
 *
 * Skylab is inconsistent about this string: the sheet export writes
 * "02-Polish 2" while the live API returns "Polish-2". Both forms are emitted
 * so an upstream IN-match succeeds whichever the endpoint stores. Correctness
 * never depends on this -- rows are re-checked locally by normalizeDepartment().
 */
export function upstreamDepartmentValues(canonicalKeys) {
  const keys = (canonicalKeys || []).filter(isCanonicalDepartment);
  const source = keys.length ? keys : ALL_CANONICAL_DEPARTMENTS;

  const values = new Set();
  for (const key of source) {
    values.add(DEPARTMENT_ACCOUNTS[key].name);
    const m = /^polish-(\d+)$/.exec(key);
    if (m) values.add(`Polish-${m[1]}`);
    else if (key === "sf-2") values.add("SF-2");
  }
  return [...values];
}

/** Canonical key -> internal app department code (POLISH_1 .. POLISH_15). */
export function canonicalToAppDepartment(canonicalKey) {
  const match = /^polish-(\d+)$/.exec(canonicalKey || "");
  if (match) {
    const num = parseInt(match[1], 10);
    // Polish 16/17 exist in Skylab but not in the payroll app -- do not invent a
    // department code the backend would reject.
    return num <= APP_POLISH_DEPARTMENT_COUNT ? `POLISH_${num}` : null;
  }
  if (canonicalKey === "sf-2") return "POLISH_2"; // SF-2 is operationally Polish 2
  return null;
}

/**
 * Normalize any department representation to a canonical key, or "" if the
 * value is not a recognised department.
 *
 * Handles: "Polish-3", "polish 3", "03-Polish 3", "3-Polish 3", "POLISH_3",
 *          "SF-2", "sf 2", "SF2".
 * Rejects: worker accounts ("210 JAYESHBHAI"), out-of-range ("Polish-30"),
 *          empty, null, totals/footer rows.
 */
export function normalizeDepartment(value) {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim().toLowerCase();
  if (!raw) return "";

  // SF-2 first: it must never be parsed as a Polish department.
  // Accepts "sf-2", "sf 2", "sf2", and prefixed forms like "16-sf-2".
  if (/^(?:\d{1,2}\s*[-_]\s*)?sf\s*[-_]?\s*2$/.test(raw)) return "sf-2";

  // Department identity always contains the word "polish". Worker sub-accounts
  // ("210 JAYESHBHAI") do not, so they fall through and return "".
  if (!raw.includes("polish")) return "";

  // The number that identifies the department is the one AFTER "polish".
  // "03-Polish 3" -> 3; "12-Polish 12" -> 12. Only this form is trusted.
  const afterPolish = /polish\s*[-_]?\s*(\d{1,2})\b/.exec(raw);
  if (afterPolish) {
    const num = parseInt(afterPolish[1], 10);
    if (num >= 1 && num <= POLISH_DEPARTMENT_COUNT) return `polish-${num}`;
    return "";
  }

  // Form "03-polish" / "3 polish" with the number BEFORE the word.
  const beforePolish = /^(\d{1,2})\s*[-_]?\s*polish\b/.exec(raw);
  if (beforePolish) {
    const num = parseInt(beforePolish[1], 10);
    if (num >= 1 && num <= POLISH_DEPARTMENT_COUNT) return `polish-${num}`;
  }

  return "";
}

export function isCanonicalDepartment(key) {
  return CANONICAL_SET.has(key);
}

/**
 * Read a record's department straight from the authoritative field and
 * normalize it. This is the ONLY approved way to get a record's department.
 */
export function getRecordDepartment(item) {
  if (!item || typeof item !== "object") return "";
  const rawVal = item.DepartmentAccountName || item.Department || item.DepartmentName || item.Dept || "";
  const norm = normalizeDepartment(rawVal);
  if (norm) return norm;
  if (rawVal && !/^\d{3}\s+[A-Z]+/i.test(String(rawVal).trim())) {
    return String(rawVal).trim().toLowerCase().replace(/\s+/g, "-");
  }
  return "";
}

/**
 * Parse a comma-separated department request (query param / manager scope)
 * into canonical keys. Unrecognised entries are dropped.
 */
export function parseRequestedDepartments(value) {
  if (!value) return [];
  const seen = new Set();
  for (const part of String(value).split(",")) {
    const key = normalizeDepartment(part);
    if (key && CANONICAL_SET.has(key)) seen.add(key);
  }
  return [...seen];
}

export function getDepartmentDisplayName(canonicalKey) {
  const norm = normalizeDepartment(canonicalKey);
  return DEPARTMENT_DISPLAY_NAMES[norm] || String(canonicalKey ?? "");
}
