# Account Payroll — Project Status & Reference

**Purpose of this document:** this is the living source of truth for what has
been built, how it works, and what's left. It's meant to be re-read and
updated at the start of every future session on this project — before
resuming work, check the "Implementation Status by Module" and "Known Gaps"
sections below; after making changes, update them.

**Last updated:** 2026-07-22
**Status:** Core payroll engine + operational UI complete and verified working. Several MPS §18 modules not yet built (see status table).

---

## 1. What this project is

A payroll system for a diamond-polishing operation, rebuilt from scratch
against `MPS_v1.3_Complete_TechStack_and_Implementation_Roadmap.docx` (the
Master Product Specification — referred to as "the MPS doc" or "MPS §N"
throughout this file; §N always refers to a section number in that document).
It replaces a spreadsheet-based workflow with:

**Work Entry → Lot in Hand / Completion → Salary Calculation → Manager
Verification → Accounts Verification → Final Payable.**

Three production types are tracked:
- **Polish** — individual diamond work, piece-rate priced by rough weight slab, Shape+LAB classified (MPS §5)
- **DHAR** — a separate classification/rate workflow, weight-slab priced (MPS §8)
- **MAXI** — operational extra-work records, strictly non-payable (MPS §9)

Core priority order per the MPS doc: **Accuracy → Security → Data Integrity →
User Experience → Performance → Maintainability → Extensibility.** Every
design decision below should be read against that ordering — e.g. money math
uses `decimal.js` instead of native floats even though it's slightly more
verbose, because Accuracy outranks convenience.

### Why this is a rebuild, not the original codebase

The previous implementation's salary engine used **cumulative, tax-bracket
-style weight-slab splitting** across an employee's entries (an employee's
*total* weight across all their lots got split across rate slabs like a tax
bracket). This contradicts the MPS doc's actual rule: *"Entry-level salary =
eligible rough Weight × applicable Issue-Date rate"* (MPS §5.3) — a simple,
independent per-entry lookup. The engine here implements the documented rule,
and `backend/tests/calcEngine.test.js` asserts this explicitly (see test
"Round 0.5ct @ 1100 slab, entry-level only (no bracket split)").

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend framework | Next.js 16 (App Router), React 19 | Client components throughout; no server-side data fetching |
| Frontend styling | Plain CSS (`globals.css`), no UI framework | Design tokens as CSS custom properties; light + dark themes via `[data-theme="dark"]` override block, same token names — components never branch on theme |
| Backend framework | Node.js + Express 5 | |
| Database | PostgreSQL, via Knex 3 (query builder, not an ORM) | Uses raw SQL for constructs Knex's schema builder can't express (generated columns, `EXCLUDE` constraints) |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` | 12h token TTL |
| Money/weight arithmetic | `decimal.js` | MPS §12: never use native float math for payroll |
| Postgres driver quirk fix | Custom `pg` type parser for `DATE` (OID 1082) in `backend/db.js` | Without this, dates silently shift by a day on non-UTC servers — see §8 "Known Gaps" for the story |

Neither the tech stack nor a UI design system were specified in the MPS doc
(§23 lists "Final technology stack" as an explicitly undecided item) — the
choices above were made pragmatically during the rebuild, reusing what the
prior codebase already had proven to work in this environment (Next.js +
Express/Knex/Postgres), rather than re-litigating framework choice.

---

## 3. Repository structure

```
Account Payroll/
├── README.md                    ← this file
├── MPS_v1.3_...docx              ← the governing spec; read this, not memory of it, for business-rule questions
├── Demo P3.xlsx                  ← original source workbook (kept for future reconciliation; not yet used — see Known Gaps)
├── package.json                  ← npm workspaces root (frontend + backend)
│
├── backend/
│   ├── db.js                     Knex connection + the DATE type-parser fix
│   ├── knexfile.js               Knex CLI config (migrations directory)
│   ├── seed.js                   Master data + rate baselines + Root Admin (run once per fresh DB)
│   ├── server.js                 Express app, mounts all routes
│   ├── .env                      DATABASE_URL, SECRET_KEY, PORT, optional SUPABASE_DATABASE_URL
│   ├── migrations/                12 files, run in order — see §4 for the schema they produce
│   ├── lib/
│   │   ├── calcEngine.js          Rate lookup + salary calculation (Polish + DHAR)
│   │   ├── verificationGuard.js   MPS §14 edit/reopen rules, shared by polish.js + dhar.js
│   │   └── audit.js               audit_log writer, called from every mutating route
│   ├── middleware/
│   │   └── auth.js                JWT verify, role guards, Manager salary-field redaction
│   ├── routes/                    one file per resource — full endpoint list in §5
│   └── tests/
│       ├── calcEngine.test.js     11 unit tests, no server needed — `npm test`
│       └── e2e.test.js            19-check live-server test — `node tests/e2e.test.js <root-admin-password>`
│
└── frontend/
    ├── .env                       NEXT_PUBLIC_API_BASE
    └── src/
        ├── app/                    one folder per route — full page list in §6
        ├── components/
        │   ├── AppShell.js          gates rendering behind auth, wraps Sidebar+TopHeader+content
        │   ├── Sidebar.js            role-filtered nav
        │   ├── TopHeader.js          page title, theme toggle, notification bell, profile menu
        │   └── RoleGate.js           in-page role gate for pages Sidebar wouldn't even link to
        └── lib/
            ├── api.js                fetch wrapper (auth header injection, 401 → redirect to /login)
            ├── AuthContext.js        login/logout, current user, route-guard redirect
            ├── ThemeContext.js       light/dark toggle; layout.js has a blocking inline script that sets data-theme before paint to avoid a flash of the wrong theme
            └── Feedback.js           toast notifications + Promise-based confirm modal -- replaces native alert()/confirm() everywhere (useFeedback() -> { showToast, confirmAction })
```

---

## 4. Database schema

12 tables, created by `backend/migrations/2026072200000{1..12}_*.js` in
order. This *is* the domain model — read the migration files directly for
exact column types; this table is a summary.

| Table | Purpose | Notable constraints |
|---|---|---|
| `master_data` | Centrally managed value lists: Shape, Color, Clarity, Labour Head, Shade, Stone Level, LAB, Cut/Pol/Sym, Grader, Specialist, Work Status, Verify Status (MPS §10) | `active` flag, never hard-deleted. `is_round_classification` flags Round/OEB shapes for the calc engine. |
| `employees` | Permanent internal employee identity (MPS §15) | Separate from Employee Code on purpose |
| `employee_codes` | Reusable business Employee Code, linked to an employee, with history | Partial unique index: only one row per `code` may have `released_at IS NULL` at a time |
| `users` | Login accounts (Root Admin / Manager / Accounts / Employee) | Partial unique index enforces **exactly one** `ROOT_ADMIN` row, at the DB level |
| `periods` | Operational/payable periods, open → closed → (Root-Admin-only) reopened | |
| `rates_polish` | Effective-dated Polish rates: category × weight slab × rate × date range | `EXCLUDE USING gist` on `(category, weight_range, date_range)` — overlapping rate applicability is **physically impossible to insert**, not just app-validated (MPS §11) |
| `rates_dhar` | Effective-dated DHAR rates: classification × weight_slab × rate × date range | Same `EXCLUDE` pattern as above |
| `polish_entries` | The Polish lifecycle record (MPS §5, §7) | Status: `DRAFT` → `LOT_IN_HAND` → `COMPLETED` (or `TRANSFERRED`); `reassigned_from_entry_id` self-references for MPS §7 reassignment linkage |
| `dhar_entries` | DHAR records (MPS §8) | `weight_slab` always derived, never user-chosen |
| `maxi_entries` | MAXI records (MPS §9) | Deliberately has no rate/salary/payable-period columns at all — non-payable by construction, not by convention |
| `employee_period_status` | The verification state machine, one row per (employee, period) (MPS §13-14) | `status`: `CALCULATED` → `MANAGER_VERIFIED` → `ACCOUNTS_VERIFIED`; `final_snapshot_total`/`final_snapshot_breakdown` frozen at Accounts verification and cleared again on Reopen |
| `audit_log` | Append-only event log (MPS §21) | No route anywhere in the app issues `UPDATE`/`DELETE` against this table |

**Key design decisions worth knowing before changing the schema:**
- Money columns are Postgres `NUMERIC`, which `pg` returns as **strings** (e.g. `"900.00"`), not JS numbers. This is intentional (MPS §12) — always go through `decimal.js` or explicit `Number()` conversion when doing arithmetic on them, never trust implicit coercion.
- `DATE` columns are returned as plain `'YYYY-MM-DD'` strings, not JS `Date` objects, because of the type-parser override in `db.js`. Removing that override reintroduces a real timezone bug — see §8.

---

## 5. Backend API reference

Base URL: `http://192.168.1.95:8000` (configurable via `frontend/.env` →
`NEXT_PUBLIC_API_BASE`). All routes except `/health` and `POST /auth/login`
require `Authorization: Bearer <token>`. Roles shown are enforced by
`requireRole()` in `middleware/auth.js` — this is the actual backend
enforcement, not a UI convention (MPS §16: *"Authorization must be enforced
on the backend... not merely by hiding UI elements"*).

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness check |
| POST | `/auth/login` | none | Returns `{ token, user }` |
| GET | `/auth/me` | any | Current user info |
| POST | `/auth/change-password` | any | Self-service password change |
| POST | `/auth/users` | Root Admin, Accounts | Provision Manager/Accounts/Employee accounts (no public self-registration) |
| PATCH | `/auth/users/:id` | Root Admin, Accounts | Update/deactivate a user (blocked for `ROOT_ADMIN` rows) |
| GET | `/employees` | Manager, Accounts, Root Admin | List active employees + their current code |
| GET | `/employees/:id` | Manager, Accounts, Root Admin | Detail + full code history |
| POST | `/employees` | Manager, Accounts, Root Admin | Create employee + assign initial code |
| PATCH | `/employees/:id` | Manager, Accounts, Root Admin | Update profile fields |
| POST | `/employees/:id/deactivate` `/reactivate` | Accounts, Root Admin | |
| POST | `/employees/:id/release-code` | Accounts, Root Admin | Blocked if unresolved Lot in Hand or unfinalized payroll exists (MPS §15) |
| POST | `/employees/:id/assign-code` | Accounts, Root Admin | |
| GET | `/periods` | Manager, Accounts, Root Admin | |
| GET | `/periods/default` | Manager, Accounts, Root Admin | Latest `OPEN` period. Returns `200` with a `null` body (not 404) when none is open — that's a normal state, not an error |
| POST | `/periods` | Accounts, Root Admin | Opens a new period |
| POST | `/periods/:id/close` | Accounts, Root Admin | |
| POST | `/periods/:id/reopen` | **Root Admin only** | Requires `reason` |
| GET | `/rates/polish` `/dhar` | Accounts, Root Admin | |
| POST | `/rates/polish` `/dhar` | Accounts, Root Admin | Creates a new versioned rate row; auto-closes the prior open-ended row for the same slab (never edits history) |
| GET | `/polish` | Manager, Accounts, Root Admin | Query params: `employee_id`, `period_id`, `status`. Manager responses have salary fields stripped. |
| GET | `/polish/:id` | same | |
| POST | `/polish` | same | `is_draft: true` saves a Draft; otherwise enforces MPS §5.2 required Issue fields |
| PATCH | `/polish/:id/submit` | same | Promotes Draft → Lot in Hand |
| PATCH | `/polish/:id` | same | General field edit; salary-affecting edits after Manager verification reset it (MPS §14) |
| PATCH | `/polish/:id/complete` | same | Runs the calc engine, assigns payable period |
| PATCH | `/polish/:id/revert-to-lot-in-hand` | same | MPS §7 |
| POST | `/polish/:id/reassign` | same | MPS §7 physical reassignment (closes original as Transferred, creates linked new entry) |
| DELETE | `/polish/:id` | same | Blocked if the employee-period is Final Payable |
| GET/POST/PATCH/DELETE | `/dhar/...` | Manager, Accounts, Root Admin | Same shape as Polish but no Draft/Complete staging (MPS §8 is a single-stage record) |
| GET/POST/PATCH/DELETE | `/maxi/...` | Manager, Accounts, Root Admin | No calc engine involvement anywhere in this file |
| GET | `/verification?period_id=` | Manager, Accounts, Root Admin | Manager responses omit `final_snapshot_total`/`breakdown` |
| GET | `/verification/:employeeId/:periodId` | same | |
| POST | `/verification/:employeeId/:periodId/manager-verify` | Manager, Root Admin | |
| POST | `/verification/:employeeId/:periodId/accounts-verify` | Accounts, Root Admin | Freezes `final_snapshot_total`/`breakdown` |
| POST | `/verification/bulk/manager-verify` `/accounts-verify` | same as above | `{ period_id, employee_ids[] }`; per-employee ok/skip result, unresolved-issue employees are skipped not failed |
| POST | `/verification/:employeeId/:periodId/reopen` | Accounts, Root Admin | Requires `reason`; resets to `CALCULATED` |
| GET | `/master-data?category=&includeInactive=` | Manager, Accounts, Root Admin | |
| POST | `/master-data` | Accounts, Root Admin | |
| POST | `/master-data/:id/deactivate` `/reactivate` | Accounts, Root Admin | No delete route exists |
| GET | `/portal/me` | **Employee only** | |
| GET | `/portal/payable` | **Employee only** | Only `ACCOUNTS_VERIFIED` rows, ever |
| GET | `/notifications` | Manager, Accounts, Root Admin | Live counts: pending Manager/Accounts verification, Rate Missing entries. Not a stored log — see §8. |

---

## 6. Frontend routes

| Route | Roles (Sidebar-linked for) | What it does |
|---|---|---|
| `/login` | public | |
| `/` | Root Admin, Manager, Accounts | Dashboard: employee count, verification-stage counts. Employee role is redirected to `/portal`. |
| `/employees`, `/employees/[id]` | Root Admin, Manager, Accounts | List + create + detail + Employee Code lifecycle actions |
| `/polish` | Root Admin, Manager, Accounts | Full lifecycle UI: issue, draft-submit, complete, revert, reassign, delete |
| `/dhar` | Root Admin, Manager, Accounts | Create/edit/delete |
| `/maxi` | Root Admin, Manager, Accounts | Create/edit/delete |
| `/periods` | Root Admin, Accounts (`RoleGate`) | Open/close/reopen |
| `/rates` | Root Admin, Accounts (`RoleGate`) | Tabbed Polish/DHAR rate version history + add-new-version form |
| `/verification` | Root Admin, Manager, Accounts | Period selector, per-employee status, individual + bulk verify (two independent selection sets so Root Admin can bulk-act at either stage), reopen |
| `/master-data` | Root Admin, Accounts (`RoleGate`) | Tabbed by category, add/deactivate/reactivate |
| `/users` | Root Admin, Accounts (`RoleGate`) | Provision accounts |
| `/portal` | Employee (`RoleGate`) | Own profile + finalized payable history with breakdown |
| `/account` | any logged-in user | Profile view + change-password form |

Pages using `RoleGate` are still reachable by URL by any logged-in user, but
render an "Access restricted" message instead of content if the role doesn't
match — the actual data protection is on the backend regardless.

---

## 7. Implementation status by MPS §18 module

This is the section to update every time a module's status changes.
Legend: ✅ Done · 🟡 Partial · ⬜ Not started

| # | Module (MPS §18 name) | Status | Notes |
|---|---|---|---|
| 1 | Authentication & Account Security | ✅ | JWT, bcrypt, RBAC, login audit, self-service password change, admin user provisioning |
| 2 | Role-Specific Dashboard | 🟡 | One dashboard page with KPIs + quick links; not deeply differentiated per role beyond the Employee→`/portal` redirect |
| 3 | Operational Period Management | ✅ | Open/close/reopen, audit-logged |
| 4 | Polish Entry | ✅ | Draft/Issue/Complete/Revert/Reassign, full validation |
| 5 | DHAR Entry | ✅ | |
| 6 | MAXI Entry | ✅ | |
| 7 | Lot in Hand Management | 🟡 | It's a real status on `polish_entries`, filterable in the Polish list — but there's no dedicated Lot-in-Hand dashboard/aging view, and period-close carry-forward isn't visually surfaced anywhere |
| 8 | Production Explorer | ⬜ | No unified cross-Polish/DHAR/MAXI search screen; each has its own page |
| 9 | Employee Management | ✅ | |
| 10 | Employee Code Lifecycle | ✅ | Release/assign/history, blocked-while-unresolved rule enforced |
| 11 | Salary Rate Management | ✅ | Effective-dated, DB-enforced non-overlap |
| 12 | Payroll Calculation | ✅ | Engine + 11 unit tests |
| 13 | Manager Verification | ✅ | |
| 14 | Accounts Verification | ✅ | |
| 15 | Final Payable Records | 🟡 | The data and immutable snapshot exist and are viewable (Verification page for staff, Portal for the employee) — no dedicated cross-period "Final Payable Records" browse/export screen |
| 16 | Employee Portal | ✅ | |
| 17 | Reports Center | ⬜ | Not started |
| 18 | Notifications & Action Center | 🟡 | Live bell showing real pending-action counts (see §5 `/notifications`) — no persistent/historical notification log |
| 19 | Master Data | ✅ | |
| 20 | Organization Settings | ⬜ | Not started |
| 21 | Audit Log Center | 🟡 | Backend logging is complete and fires on every mutating action — there is no UI screen to browse `audit_log` yet |
| 22 | Backup & Recovery | ⬜ | Not started |
| 23 | Future AI Report Assistant | ⬜ | Explicitly deferred by the MPS doc itself until the core system is stable — not a gap |

**Rough read:** 12 of 23 modules fully done, 5 partial, 6 not started (1 of those 6 intentionally deferred by the spec).

---

## 8. Known gaps, technical debt, and things to watch

- **No Demo P3.xlsx reconciliation.** The old `import-demo-p3.js` script (deleted with the rest of the old codebase) parsed the source workbook with a specific layout: Polish sheets are named as plain numbers, data starts at row index 5, columns are `[issue_date, lot_id, lot_name, qty, shape, weight, estimate_weight, labour_head, received_date, polished_weight, color, shade, clarity, cut_pol_sym, grader, stone_level, lab_name, remarks]`. DHAR sheets are named `DHAR-XXX`, data starts at row index 4, with four repeated column blocks at offsets 0/4/8/12 for (ALL SHAPE/2.00 UP), (ALL SHAPE/2.00 DN), (ROUND/2.00 UP), (ROUND/2.00 DN). A `DASHBOARD` sheet maps employee code → name. This layout knowledge is recorded here specifically so a future import script doesn't have to be reverse-engineered from the spreadsheet again.
- **The `pg` DATE timezone bug.** Discovered via the e2e test: Postgres `DATE` columns were coming back shifted by one day on this server's timezone, because `pg`'s default parser builds a JS `Date` at local midnight and then `JSON.stringify` always renders UTC. Fixed with a custom type parser in `db.js` (OID 1082). **If this override is ever removed, the bug comes back silently** — there's a regression assertion for it in `e2e.test.js` ("issue_date round-trips exactly with no timezone shift").
- **`xlsx` package has a known high-severity advisory.** Pre-existing, low real risk here since it's only used in local developer-triggered import scripts, not user-facing upload paths. Worth revisiting if an upload feature is ever built on top of it.
- **ESLint required installing `typescript` as a dev dependency** to work at all in this environment (`eslint-config-next` depends on `@typescript-eslint` packages that require it even for a pure-JS project). Already fixed; mentioned here so it's not a surprise.
- **`react-hooks/set-state-in-effect` lint findings** exist across most list pages (the standard `useEffect(() => { load() }, [deps])` fetch-on-mount pattern). Not a functional bug, just a stricter-than-usual lint rule; left as-is deliberately rather than restructuring every data-fetching effect for a style preference.
- **Root Admin credentials are shown exactly once**, at `seed.js` run time, and are not retrievable afterward (only the bcrypt hash is stored). If they're lost, the only recovery path is direct DB access to update `users.password_hash`, or wiping and reseeding.
- **Dashboard (module #2) and Final Payable Records (module #15) are the two "done-ish" modules most likely to need real work** if the next session is choosing what to build — everything else is either fully done or a clean, well-scoped gap.

---

## 9. Testing

| Suite | Location | Run with | Requires |
|---|---|---|---|
| Calculation engine unit tests (11 cases) | `backend/tests/calcEngine.test.js` | `npm test` (from `backend/`) | A seeded database (reads real rate rows) |
| End-to-end lifecycle test (19 checks) | `backend/tests/e2e.test.js` | `node tests/e2e.test.js <root-admin-password>` | A **freshly migrated + seeded** database and a running `node server.js` — it creates its own users/employee/period and will hit unique-constraint conflicts if run twice against the same data |

The e2e test covers, in order: Root Admin login → provisioning Manager/Accounts
users → employee creation → period open → Polish issue → Manager-role salary
redaction → completion + calculation → Accounts-role real salary visibility →
Manager verify → Accounts verify → Final Payable snapshot → blocked direct
edit → Reopen for Correction → edit allowed again → Employee Portal showing
nothing until re-verified.

There is no frontend test suite and no browser-automation tooling available
in the environment this was built in — frontend changes have been verified by
compile checks (page returns 200), ESLint, and manual cross-checking of every
form's fields against its backend route contract, not by clicking through a
real browser. Treat frontend correctness as "should work, unverified visually"
until someone actually clicks through it.

---

## 10. Running it locally

```bash
# Backend
cd backend
npm install
npx knex migrate:latest   # creates the schema (safe to re-run; only applies new migrations)
node seed.js               # master data, rate baselines, Root Admin account — prints credentials ONCE
node server.js              # listens on :8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                  # listens on :3000
```

To fully reset the database during development:
```js
// from backend/, with DATABASE_URL loaded
require('dotenv').config();
const db = require('./db');
db.raw('DROP SCHEMA public CASCADE').then(() => db.raw('CREATE SCHEMA public')).then(() => process.exit(0));
```
...then re-run `npx knex migrate:latest` and `node seed.js`.

---

## 11. Roles (MPS §16)

| Role | Authority |
|---|---|
| **Root Admin** | Everything. Exactly one account, DB-enforced; cannot be deleted, deactivated, or downgraded. |
| **Manager** | Production/employee operations, Manager Verification. **No salary visibility anywhere** — enforced by stripping salary fields server-side before the response is built, not by hiding them in the UI. |
| **Accounts** | Production operations + full salary visibility, rate management, Accounts Verification, period control, Employee Code release. |
| **Employee** | Read-only. Own identity + own **finalized** (Accounts-verified) salary only. Nothing pre-Final-Payable is ever exposed to this role, at the API level. |

---

## 12. Change log

Append an entry here whenever this document is updated, so it's clear what
changed and when without having to diff the whole file.

- **2026-07-22 (latest)** — Replaced every native `alert()`/`confirm()` in the frontend (18 call sites across 7 pages: Employees, Master Data, DHAR, MAXI, Periods, Verification, Polish) with `lib/Feedback.js` — a toast stack for messages and a Promise-based `confirmAction()` that renders as an in-app modal instead of a blocking browser dialog. Also added success toasts to Verification actions (manager-verify, accounts-verify, bulk verify, reopen) that previously gave no feedback at all on success.
- **2026-07-22** — Fixed `GET /periods/default`: it returned 404 when no period was open, which is a normal state on a fresh install (before Accounts has opened the first period), not an error — this was showing up as a scary red 404 in the browser console even though the frontend already caught it. Now returns `200` + `null`. Dashboard updated to match (dropped the now-unneeded `.catch()`) and now shows an actionable "Open a Period" prompt for Accounts/Root Admin when there's no open period, instead of just a passive message.
- **2026-07-22 (latest)** — Dark mode added: full token-based light/dark theme (`globals.css`), toggle in `TopHeader`, `ThemeContext`, and a blocking pre-hydration script in `layout.js` to avoid a flash of the wrong theme on load. Required splitting several color tokens that were previously doing double duty (e.g. a single `--navy-600` used both as a solid button-fill *and* as active-nav-item text) into separate fill/text roles (`--accent-primary-solid` vs `--accent-primary`, `--{color}-600` vs `--{color}-text`) so brightening text for dark-mode legibility didn't wash out white-text-on-button contrast. Also converted several hardcoded hex values (`#fff` backgrounds, literal pastel badge borders) to tokens since they'd have rendered broken in dark mode otherwise.
- **2026-07-22** — Full rewrite as a deep status/reference document (this version). Reflects: core backend (12 tables, full API), core frontend (13 pages), notification bell + profile menu, Manage Account page. Status table added for all 23 MPS §18 modules.
- **2026-07-22 (earlier)** — Initial README after the from-scratch rebuild: backend core + basic frontend scaffold, "Diamond MPS" branding (later renamed).
