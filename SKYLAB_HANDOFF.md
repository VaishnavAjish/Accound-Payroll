# Skylab Stock Integration — Handoff Prompt

Copy everything below the line into Antigravity (or any agent). It is self-contained.

---

You are picking up work on the **Account Payroll** project at `Z:\Account Payroll`
(Next.js 16 App Router frontend + Node/Express backend + PostgreSQL).

The work concerns the **Skylab / Fantacy stock integration** only. Changes have
already been made and verified against the live API. **Do not deploy. Do not
commit secrets. Do not change payroll, salary, or verification logic.**

## 1. Verified facts about Skylab's API — do NOT re-derive these

These were measured against the live endpoint, not assumed. Trust them.

**Endpoints:** `POST /token` (OAuth2 password grant, form-encoded),
`POST /api/stock` (JSON).

**Request body for `/api/stock`:**
```json
{
  "requestType": "GET",
  "request": {
    "select": "Comma,Separated,Column,Names",
    "filters": [ { "fieldName": "X", "value": "Y" } ],
    "IsLoadingAll": true
  },
  "pageSize": 0,
  "pageNumber": 0
}
```

1. **`pageSize` and `pageNumber` are IGNORED.** A request with `pageSize: 5`
   returned 68 records. The endpoint always returns the COMPLETE result set for
   the given filters. Do not add upstream pagination — it does not exist.
2. **`IsLoadingAll` has no effect.** true, false and omitted behave identically.
3. **Filters are the ONLY volume control.**
   - No department filter → **1,668,406 rows**
   - With department filter → **16,674 rows**, ~38s, 6.4 MB
4. **`select` is validated.** An unknown column fails the whole request with
   `No property or field 'X' exists in type 'Lot'`. Use this as a schema oracle
   if you need to test a column name.
5. **`Company` and `CompanyName` do NOT exist on type `Lot`. `CompanyID` does**,
   and is numeric. The current credential returns `CompanyID: 1` for every row —
   the account is already company-scoped upstream. The
   "SKYLAB / MAUNI / THE DIAMOND LAB" names visible in the Skylab UI field
   picker are not available on this entity.
6. **Only ONE access token is valid per user at a time.** Authenticating again
   invalidates the previous token and in-flight requests begin returning 401.
   Never run two scripts against the same credential concurrently — it produces
   misleading 401s that look like schema errors.
7. Live API returns department as `"02-Polish 2"` (the sheet-export spelling),
   not `"Polish-2"`.
8. **Verified columns on type `Lot`** (all 29 confirmed present, request returns
   HTTP 200 with them):
   `CompanyID, DepartmentAccountName, LotStatusDB, LotID, Stock_ID, ItemTypeID,
   SerieID, Quantity, Remark, LotName, EstimateWeight, Weight,
   ProductionStatusID, EstimateShapeID, ProcessID, LocationAccountName,
   EstimateColorID, EstimateClarityID, EstimateQualityID, ProcessSendDate,
   PreviousProcessRtnDate, TB209, LotMeasurements1, LotMeasurements2,
   LotMeasurements3, TB401, TB104ID, PreviousLocationAccountName,
   PreviousProcessReturnStatusID`
9. **Verified ABSENT — never add to `select`, they break the whole request:**
   `Company`, `CompanyName`, `ExternalNotes`, `ProductionStatus`, `Status`.
   The grid's "External Notes" comes from `Remark`; its "Production Status"
   comes from `ProductionStatusID`.
10. **`ENABLE_FANTACY_MOCK_DATA` must be `false` in `frontend/.env.local`.**
    When true the route never calls Skylab — it generates 5,000 synthetic rows
    and reports `source: "mock"`, which makes the client deliberately STOP
    filtering synthetic records so they render as if real. Synthetic rows are
    recognisable by `SerieID` starting `SER-50`, `Remark` starting `Remark-10`,
    `LotID` starting `831528`, and status `IN PROGRESS` (real values are
    `ACTIVE` / `INPROCESS`).

## 2. Department roster — authoritative

From the Skylab account export. **17 Polish departments + SF-2 = 18.** The code
previously hard-coded 15, so Polish 16 and 17 normalized to `""` and their rows
were silently discarded (2,752 records).

| Canonical | Account Name | AccountID |
|---|---|---|
| polish-1..7 | `01-Polish 1` … `07-Polish 7` | 107,106,108,109,110,112,113 |
| polish-8..17 | `08-Polish 8` … `17-Polish 17` | 824769, 825217, 825450, 825451, 825688, 825743, 825870, 825928, 828839, 828376 |
| sf-2 | `SF -2` | 111 |

AccountIDs are **not** ordered by department number (Polish 1 = 107, Polish 2 =
106). Never derive one from the other.

Live record counts at time of verification (14 of 18 had stock; Polish 6, 9, 12,
13 returned zero):
```
sf-2 10762 | polish-17 1860 | polish-4 1529 | polish-16 892 | polish-10 852
polish-1 185 | polish-11 97 | polish-5 94 | polish-15 89 | polish-7 75
polish-3 72 | polish-2 67 | polish-14 59 | polish-8 41
```

## 3. Changes already applied

**`frontend/src/lib/fantacyDeptMapper.js`**
- Added `DEPARTMENT_ACCOUNTS` — the 18-department roster with exact names + AccountIDs.
- `POLISH_DEPARTMENT_COUNT` 15 → **17**. Added `APP_POLISH_DEPARTMENT_COUNT = 15`.
- Added `upstreamDepartmentValues()` — emits BOTH spellings (`02-Polish 2` and
  `Polish-2`) so an upstream IN-match works either way.
- Added `canonicalToAccountId()`.
- `canonicalToAppDepartment()` returns `null` for Polish 16/17 (the payroll
  backend only models POLISH_1..15) instead of inventing a code it would reject.

**`frontend/src/lib/fantacyStockFilter.js`**
- `COMPANY_ID_FIELDS` now leads with `CompanyID` (verified) — corrected an
  earlier comment that wrongly claimed no company field exists.
- `filterByCompany()` — case-insensitive but exact; rows missing the field are
  rejected when a filter is active; reports `missingField` count.
- `applyStockPipeline()` accepts `{ company }` (legacy `companyId` still works)
  and reports `countsByCompany` + `missingCompanyField`.

**`frontend/src/app/api/fantacy-stock/route.js`** — rewritten.
- Uses the documented request envelope with `select` + `filters`.
- **Always** sends a department filter. Empty request = all 18 OF OURS, never
  "everything".
- Deleted ~130 lines of dead probe scaffolding (`candidateRequestShapes`,
  `runShapeProbe`, `?probe=1`, `?probe=2`).
- **Pagination is now local.** Fetches the full filtered set once, caches it
  60s keyed by department scope, and slices `skip`/`take` from it. The client's
  `skip`/`take` query interface is unchanged.
- Re-authenticates once on a 401 (expected, given fact #6).
- Re-applies company + department filters locally as defence in depth.

**`frontend/src/app/api/fantacy-stock/route.js` — `SELECT_FIELDS` corrected**
- The list is now derived from `requestedColumns` in `data-fetch/page.js`, i.e.
  the columns the grid actually renders, and every name is verified (fact #8).
- It previously used the field list from an unrelated JEWELRY integration
  (`TB200`, `TB202`, `CategoryID`, `MetalID`, `ComponentsTotalQtyDiamond`...),
  almost none of which this UI reads — live rows would have arrived with nearly
  every visible column blank.

**`frontend/.env.local`** — `ENABLE_FANTACY_MOCK_DATA` `true` → **`false`**.
This was the direct cause of synthetic rows appearing in the grid. Next.js reads
env at startup, so the dev server MUST be restarted for this to take effect.

**`frontend/src/app/fantacy/data-fetch/page.js` — render fallbacks corrected**
- Removed `CompanyID -> "2139"` and `CompanyName -> "Skylab Diamond"` defaults.
  These FABRICATED provenance: the live API returns `CompanyID: 1` and there is
  no `CompanyName` column at all. Missing values now render `-`.

**`frontend/src/app/fantacy/data-fetch/page.js`** and
**`frontend/src/app/historical-data/page.js`**
- `CACHE_VERSION` `v19_live_only` → **`v20_dept_1_17`**, `CACHE_META_KEY`
  `cache_meta_v19` → `cache_meta_v20`.
- **Both files share `DB_NAME = "FantacyStockStoreDB"` / `STORE_NAME =
  "stock_data"` and MUST be bumped together.** If they disagree, each page
  treats the other's cache as stale and wipes it, thrashing on every navigation.

**`frontend/package.json`** — `build` script `next build` → `next build --webpack`.
Next 16 defaults to Turbopack; the custom `webpack` key in `next.config.mjs` made
it fail with `WorkerError: Call retries were exceeded`. `dev` already had the flag.

**New files** (not required by the app; diagnostics only)
- `frontend/scripts/skylab-probe.mjs` — end-to-end connectivity/contract check.
- `frontend/scripts/skylab-fields.mjs` — column-name discovery via the error oracle.
- `frontend/.env.local.example` — documented template, no secrets.

## 4. Your task

### A. Verify the stale-data complaint is resolved
The user reported "some other data still fetching" after the fix. The cause was
almost certainly IndexedDB: caches written under the OLD 15-department scope
were being restored on page load. The `v20` bump should evict them automatically.

Confirm by:
1. `cd frontend && npm run dev`
2. Open `/fantacy/data-fetch` in a browser with DevTools open.
3. Application → IndexedDB → `FantacyStockStoreDB` → confirm the stored meta key
   is `cache_meta_v20` and no `cache_meta_v19` remains.
4. Confirm the on-screen total settles near **16,674** (or ~5,900 if SF-2 is
   later excluded), NOT hundreds of thousands.
5. Confirm Polish 16 and Polish 17 rows are present and rendered.
6. If stale rows persist, clear the DB manually once:
   `indexedDB.deleteDatabase("FantacyStockStoreDB")` in the console, then reload.

### B. Audit the client for old-assumption code
`data-fetch/page.js` was written when upstream paging was believed to work. The
route now returns `totalCount` = the full filtered set and paginates locally.
Check that the client's accumulation loop, `hasMore`/`nextSkip` handling and
`PAGE_SIZE = 1000` still behave correctly, and that it does not loop forever or
re-request pages it already has.

### C. Report, do not fix silently
List anything you find that contradicts section 1. Those facts were measured; a
contradiction means something changed upstream and the user must know.

## 5. Constraints

- **Do not deploy.** The user is not ready.
- **Do not put credentials in code.** They live in `frontend/.env.local`
  (gitignored). `SKYLAB_ALLOW_INSECURE_TLS=true` is currently set — that is a
  local-only escape hatch for a self-signed cert and is refused when
  `NODE_ENV=production`.
- **Do not run two scripts against the API at once** (fact #6).
- Verify with `cd frontend && npm test` (expect **44 passed**) and
  `npm run build` (expect exit 0). Both pass right now — if either breaks, it is
  from your change.

## 6. Known open items — decisions belong to the user, do not choose

1. **SF-2 is 10,762 of 16,674 records (65%).** Excluding it would cut the fetch
   to ~5,900 rows and well under the current ~38s. Ask before changing.
2. **Polish 16 and 17 have no payroll counterpart.** The backend models only
   `POLISH_1..15` (`employees.department`, `POLISH_n_MANAGER` roles). Their stock
   now displays but nothing downstream can be assigned to them. Extending the
   backend is a schema + RBAC change — do not start it unprompted.
3. **The credential is still the original `Pricing` account** (3-character
   password) hardcoded in the pre-existing code. The user intends to move to a
   dedicated user. This matters because of fact #6 — if another system shares
   this credential, the two will log each other out.
4. A ~38s cold fetch is fine on self-hosted `next start` but would exceed the
   timeout on most serverless platforms.
