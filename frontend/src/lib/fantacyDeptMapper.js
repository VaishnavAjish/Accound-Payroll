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

export const POLISH_DEPARTMENT_COUNT = 15;

export const ALL_CANONICAL_DEPARTMENTS = Object.freeze([
  ...Array.from({ length: POLISH_DEPARTMENT_COUNT }, (_, i) => `polish-${i + 1}`),
  "sf-2",
]);

const CANONICAL_SET = new Set(ALL_CANONICAL_DEPARTMENTS);

/** Canonical key -> the display name Skylab uses in its own UI/exports. */
export const DEPARTMENT_DISPLAY_NAMES = Object.freeze({
  ...Object.fromEntries(
    Array.from({ length: POLISH_DEPARTMENT_COUNT }, (_, i) => [
      `polish-${i + 1}`,
      `${String(i + 1).padStart(2, "0")}-Polish ${i + 1}`,
    ])
  ),
  "sf-2": "SF-2",
});

/** Canonical key -> internal app department code (POLISH_1 .. POLISH_15). */
export function canonicalToAppDepartment(canonicalKey) {
  const match = /^polish-(\d+)$/.exec(canonicalKey || "");
  if (match) return `POLISH_${match[1]}`;
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
  return normalizeDepartment(item[DEPARTMENT_FIELD]);
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
