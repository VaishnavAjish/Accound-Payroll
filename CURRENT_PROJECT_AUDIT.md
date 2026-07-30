# Account Payroll — Comprehensive System Audit & Reference Document

**Date of Audit:** July 29, 2026  
**Auditor:** Automated System Audit Agent (Read-Only Code & Schema Analysis)  
**Workspace:** `Account Payroll` (`z:/Account Payroll`)  
**Scope:** Complete Codebase (Frontend, Backend, Database Migrations, Master Specifications, Environment Configuration)

---

# 1. Executive Summary

The **Account Payroll** system is a specialized diamond-polishing production tracking and salary calculation application built against the Master Product Specification (MPS v1.3). The system transitioned from a legacy single-stage, spreadsheet-based workflow to an enterprise web application structured around a multi-stage operational pipeline:

$$\text{Work Entry (Draft / Lot in Hand)} \longrightarrow \text{Completion} \longrightarrow \text{Salary Calculation} \longrightarrow \text{Manager Verification} \longrightarrow \text{Accounts Verification} \longrightarrow \text{Final Payable Snapshot}$$

### Current System Maturity & Operational Readiness
- **Backend Infrastructure:** Fully functional Node.js/Express REST API supporting 15 distinct Polish production departments (`POLISH_1` through `POLISH_15`), fine-grained Role-Based Access Control (RBAC), multi-stage verification guards, and snapshot freezing.
- **Database Architecture:** PostgreSQL managed via 19 Knex migrations. Includes physical DB-level rate non-overlap guarantees via PostgreSQL `EXCLUDE USING gist` constraints, partial unique indices enforcing single Super Admin constraints, and an immutable append-only audit log.
- **Frontend Architecture:** Next.js 16 (App Router) client-side application with a token-based Vanilla CSS design system, dark mode pre-hydration, dynamic live status updates via context hooks, and modal/toast feedback systems.
- **Overall Assessment:** The core engine, rate lookups, multi-stage approval workflow, department isolation, and snapshot freezing are implemented and functional. However, the system contains critical security vulnerabilities (hardcoded API credentials and disabled TLS verification in an external proxy), calculation precision debt (native JS floating-point arithmetic used for final payable snapshot aggregates), an incomplete password-reset token lifecycle, and a broken migration rollback script.

---

# 2. Current Architecture

```
                                  +---------------------------------------+
                                  |           Next.js 16 Client           |
                                  | (React 19, Vanilla CSS, Token Theme)  |
                                  +-------------------+-------------------+
                                                      |
                                          HTTP REST API (Bearer JWT)
                                                      |
                                                      v
                                  +-------------------+-------------------+
                                  |         Express 5 Backend             |
                                  |  (Auth, Department Scope, RBAC)       |
                                  +---------+-------------------+---------+
                                            |                   |
                     +----------------------+                   +-----------------------+
                     |                                                                  |
                     v                                                                  v
+--------------------+--------------------+                           +-----------------+-----------------+
|       PostgreSQL Database (Knex 3)      |                           |   Skylab / Fantacy External API     |
| - 19 Migrations (Schema & Constraints)  |                           | (Stock & Production Feed Proxy) |
| - EXCLUDE USING gist (Rate non-overlap) |                           +-----------------------------------+
| - Append-only Audit Log                 |
+-----------------------------------------+
```

### Component Details
1. **Frontend Framework:** Next.js 16.2.9 (App Router) using React 19. Data fetching is purely client-side via custom `api.js` wrappers. Theme state (light/dark) is controlled via `ThemeContext.js` and a blocking inline pre-hydration script in `layout.js`.
2. **Backend Framework:** Node.js CommonJS module structure with Express 5.2.1. Routers are segmented by domain (`polish.js`, `dhar.js`, `maxi.js`, `verification.js`, `employees.js`, `rates.js`, `periods.js`, `admin.js`, `rbac.js`, `auth.js`, `dashboard.js`, `notifications.js`, `masterData.js`, `employeePortal.js`).
3. **Database & ORM:** PostgreSQL accessed via Knex 3.3.0 query builder. Configured with a custom `pg` OID 1082 date-parser in `backend/db.js` to ensure UTC date immutability across different server timezone settings.
4. **Calculations & Math:** Core single-entry salary lookups utilize `decimal.js` v10.6.0. However, period-level snapshot totals and summary metrics fallback to native JavaScript floating-point arithmetic (`Number()` and `parseFloat()`).
5. **External Integrations:** Next.js API Route proxy at `/api/fantacy-stock/route.js` connects to an external Skylab stock system (`https://skylab.fantasy.mn:7600`) with high-performance local fallback batch generation.

---

# 3. Current Role and Permission Matrix

The application implements a multi-tier RBAC system (`backend/middleware/auth.js` and `backend/routes/rbac.js`). Roles are defined across 4 main tiers: **Super Admin**, **Management (Admin, Accountant)**, **Department Managers (POLISH_1_MANAGER to POLISH_15_MANAGER)**, and **Employees**.

| Capability / Resource | Super Admin | Admin | Accountant | Polish Manager (1–15) | Employee |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **System Admin Panel & Audit Log Viewer** | ✅ Read/Write | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied |
| **RBAC Matrix Configuration** | ✅ Read/Write | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied |
| **User Provisioning & Deactivation** | ✅ Read/Write | ✅ Read/Write | ✅ Read/Write | ❌ Denied | ❌ Denied |
| **Salary Rate Management (Polish & DHAR)** | ✅ Read/Write | ✅ Read/Write | ❌ Denied | ❌ Denied | ❌ Denied |
| **Operational Period Control (Open/Close)** | ✅ Read/Write | ✅ Read/Write | ✅ Read/Write | ❌ Denied | ❌ Denied |
| **Reopen Closed Operational Period** | ✅ Read/Write | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied |
| **Employee Master & Code Assignment** | ✅ Read/Write | ✅ Read/Write | ✅ Read/Write | ❌ Denied (Read Only) | ❌ Denied |
| **Production Entry (Polish, DHAR, MAXI)** | ✅ Read/Write | ✅ Read/Write | ✅ Read/Write | ✅ Dept Scoped | ❌ Denied |
| **Manager Verification** | ✅ Read/Write | ✅ Read/Write | ❌ Denied | ✅ Dept Scoped | ❌ Denied |
| **Accounts Verification & Snapshot Freeze**| ✅ Read/Write | ❌ Denied | ✅ Read/Write | ❌ Denied | ❌ Denied |
| **Reopen Final Payable Record** | ✅ Read/Write | ❌ Denied | ✅ Read/Write | ❌ Denied (Request Only)| ❌ Denied |
| **Salary Amounts & Rate Visibility** | ✅ Full | ✅ Full | ✅ Full | 🚫 **Redacted (Server-side)** | 🔒 Finalized Only |
| **Department Scoping Restrictions** | 🌐 Global | 🌐 Global | 🌐 Global | 🔒 **Assigned Dept Only** | 🔒 Self Only |

*Note: In `backend/middleware/auth.js`, legacy role identifiers (`ROOT_ADMIN`, `ACCOUNTS`, `MANAGER`, `POLISH_MANAGER`, `DHAR_MANAGER`) are automatically mapped to their modern equivalents via `normalizeRole()`.*

---

# 4. Implemented Modules

### 1. Authentication & Security
- **Status:** Complete (with security findings)
- **Implemented:** JWT authentication (12h TTL), `bcryptjs` password hashing, self-service password change, admin user provisioning, role normalization, and OTP email dispatch.
- **Frontend Files:** `frontend/src/app/login/page.js`, `frontend/src/app/account/page.js`, `frontend/src/lib/AuthContext.js`
- **Backend Files:** `backend/routes/auth.js`, `backend/middleware/auth.js`, `backend/lib/mailer.js`
- **Database Tables:** `users`, `password_resets`
- **Limitations:** Password reset OTP token reset workflow does not enforce an expiration TTL on `resetToken`.

### 2. Department-Scoped Production Entries (Polish, DHAR, MAXI)
- **Status:** Complete
- **Implemented:** 
  - **Polish:** Multi-stage lifecycle (`DRAFT` $\rightarrow$ `LOT_IN_HAND` $\rightarrow$ `COMPLETED` / `TRANSFERRED`), automatic shape/lab validation, issue/received dates & times (`issue_time`, `received_time`), lot uniqueness assertions, lot return, and lot reassignment.
  - **DHAR:** 2-stage lifecycle (`LOT_IN_HAND` $\rightarrow$ `COMPLETED`), automatic weight slab derivation (`LT_2` / `GTE_2`).
  - **MAXI:** Non-payable operational log entries.
- **Frontend Files:** `frontend/src/app/polish/page.js`, `frontend/src/app/dhar/page.js`, `frontend/src/app/maxi/page.js`, `frontend/src/app/lot-status/page.js`
- **Backend Files:** `backend/routes/polish.js`, `backend/routes/dhar.js`, `backend/routes/maxi.js`, `backend/lib/lotUniqueness.js`
- **Database Tables:** `polish_entries`, `dhar_entries`, `maxi_entries`
- **Limitations:** Manager department scoping relies on `employees.department` matching `user.department`.

### 3. Salary Rate Engine & Rate Master
- **Status:** Complete
- **Implemented:** Effective-dated rate matrix for Polish (Category $\times$ Weight Slab) and DHAR (Classification $\times$ Weight Slab). DB-level physical non-overlap enforcement. Single-entry lookup via `decimal.js`. Non-payable labour head zeroing. Missing rate detection flags.
- **Frontend Files:** `frontend/src/app/rates/page.js`
- **Backend Files:** `backend/routes/rates.js`, `backend/lib/calcEngine.js`
- **Database Tables:** `rates_polish`, `rates_dhar`
- **Limitations:** Rates cannot be edited historically; new versions must be appended.

### 4. Verification & Final Payable Snapshot
- **Status:** Complete
- **Implemented:** 2-step verification pipeline (Manager Verify $\rightarrow$ Accounts Verify). Snapshot calculation freezes `final_snapshot_total` and `final_snapshot_breakdown` in JSON. Reopen workflow resets verification status to `CALCULATED`. Manager reopen request/rejection workflow.
- **Frontend Files:** `frontend/src/app/verification/page.js`
- **Backend Files:** `backend/routes/verification.js`, `backend/lib/verificationGuard.js`
- **Database Tables:** `employee_period_status`
- **Limitations:** Snapshot total aggregation in `computeFinalSnapshot()` uses native JavaScript float math.

### 5. Employee & Code Lifecycle Management
- **Status:** Complete
- **Implemented:** Employee master registration, code assignment, historical tracking, code release with safety guards blocking releases if unresolved lots in hand or unfinalized payables exist.
- **Frontend Files:** `frontend/src/app/employees/page.js`, `frontend/src/app/employees/[id]/page.js`
- **Backend Files:** `backend/routes/employees.js`
- **Database Tables:** `employees`, `employee_codes`
- **Limitations:** Code assignment history is maintained via `released_at IS NULL` partial unique index.

### 6. Operational Period Control
- **Status:** Complete
- **Implemented:** Period opening, closing, and Super-Admin-only reopening. Global period selection state.
- **Frontend Files:** `frontend/src/app/periods/page.js`, `frontend/src/lib/PeriodContext.js`
- **Backend Files:** `backend/routes/periods.js`, `backend/lib/periodAccess.js`
- **Database Tables:** `periods`
- **Limitations:** Reopening a closed period requires explicit audit-logged reason.

### 7. Audit Logging & System Admin
- **Status:** Complete
- **Implemented:** Append-only audit logger capturing actor, action, entity type/ID, before/after JSON payloads, IP address. Super Admin stats dashboard and paginated/filterable audit log viewer.
- **Frontend Files:** `frontend/src/app/admin/page.js`
- **Backend Files:** `backend/routes/admin.js`, `backend/lib/audit.js`
- **Database Tables:** `audit_log`
- **Limitations:** Only Super Admin can view audit logs.

### 8. Employee Portal
- **Status:** Complete
- **Implemented:** Dedicated employee view displaying profile and finalized (Accounts-verified) payable history only.
- **Frontend Files:** `frontend/src/app/portal/page.js`
- **Backend Files:** `backend/routes/employeePortal.js`
- **Database Tables:** Read access to `employee_period_status` (filtered by `status = 'ACCOUNTS_VERIFIED'`).

### 9. External Stock Integration (Fantacy / Skylab)
- **Status:** Incomplete / Demo Mode (High Risk)
- **Implemented:** Proxy API endpoint connecting to external Skylab diamond stock system, local fallback mock batch generator (1,000,000 lots), client-side IndexedDB caching, and auto-refresh timer.
- **Frontend Files:** `frontend/src/app/fantacy/data-fetch/page.js`, `frontend/src/app/fantacy/stock/page.js`, `frontend/src/app/api/fantacy-stock/route.js`
- **Backend Files:** Next.js Route Handler (`frontend/src/app/api/fantacy-stock/route.js`)
- **Database Tables:** Browser IndexedDB (`FantacyStockStoreDB`)
- **Limitations:** Contains hardcoded plaintext API credentials and disables TLS certificate validation. Page `/fantacy/stock` is an empty container shell.

---

# 5. End-to-End Business Workflows

### 1. Polish Production & Salary Calculation Workflow
```
[1. Issue Lot] ──> Status: DRAFT / LOT_IN_HAND (Issue Date, Time, Weight, Shape, Est Wt)
      │
      v
[2. Complete Lot] ──> Input: Received Date, Time, Polished Wt, Labour Head, LAB, Color, Clarity
      │
      v
[3. Calc Engine] ──> Classifies Category (ROUND_OEB / FANCY_IGI / FANCY_GIA)
      │               Looks up rates_polish (effective_from <= issue_date <= effective_to)
      │               Calculates: send_weight * rate via decimal.js
      │               If missing: sets rate_missing = true, calculation_error = msg
      v
[4. Manager Verify] ──> Checks: No rate_missing entries. Status: CALCULATED ──> MANAGER_VERIFIED
      │                 (Salary fields redacted from Manager API view)
      v
[5. Accounts Verify] ──> Status: MANAGER_VERIFIED ──> ACCOUNTS_VERIFIED
      │                  Freezes final_snapshot_total & breakdown in employee_period_status
      v
[6. Employee Portal] ──> Payable visible to Employee on /portal
```

### 2. Final Payable Reopen Workflow
```
[Final Payable (ACCOUNTS_VERIFIED)]
      │
      ├──> Option A: Accountant / Super Admin direct Reopen
      │       │
      │       v
      │   Resets status to CALCULATED, clears snapshot total/breakdown, logs audit
      │
      └──> Option B: Manager submits Reopen Request
              │
              v
          Populates reopen_requested_by, reopen_requested_at, reopen_request_reason
              │
              ├──> Accountant Approves (Reopen route executed)
              └──> Accountant Rejects (reject-reopen-request clears request fields)
```

---

# 6. Frontend Route Inventory

| Route URL | Purpose / Feature | Allowed Roles | Backend APIs Used | Status | Notes / Discrepancies |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/login` | User authentication | Public | `POST /auth/login` | Working | Redirects authenticated users |
| `/` | Operational KPI Dashboard | Staff Roles | `GET /dashboard/stats`, `/periods` | Working | Shows trends, top performers |
| `/polish` | Polish production management | Staff Roles | `/polish/*`, `/employees`, `/master-data` | Working | Draft, complete, revert, reassign |
| `/dhar` | DHAR production management | Staff Roles | `/dhar/*`, `/employees` | Working | 2-stage return workflow |
| `/maxi` | Non-payable extra work log | Staff Roles | `/maxi/*`, `/employees` | Working | Non-payable entries |
| `/lot-status` | Cross-module Lot-in-Hand tracker | Staff Roles | `/polish`, `/dhar`, `/employees`, `/master-data` | Working | Live return modal forms |
| `/verification` | Payroll verification & approvals | Super Admin, Accountant, Managers | `/verification/*` | Working | Individual + bulk verification |
| `/periods` | Operational period control | Super Admin, Admin, Accountant | `/periods/*` | Working | Open, close, reopen periods |
| `/rates` | Polish & DHAR rate matrices | Super Admin, Admin | `/rates/*` | Working | Effective-dated versioning |
| `/employees` | Employee list & code management | Staff Roles | `/employees/*` | Working | Code release/assignment |
| `/employees/[id]` | Employee detail & code history | Staff Roles | `/employees/:id` | Working | Historical codes view |
| `/master-data` | System master data categories | Super Admin, Admin, Accountant | `/master-data/*` | Working | Tabbed configuration |
| `/users` | System user provisioning | Super Admin, Admin, Accountant | `/auth/users/*` | Working | Account creation & status toggle |
| `/rbac` | Dynamic permission matrix | Super Admin | `GET/POST /rbac/permissions` | Working | Included in `/users` tab |
| `/admin` | System Admin & Audit Logs | Super Admin | `GET /admin/stats`, `/admin/audit-logs` | Working | System stats & audit search |
| `/portal` | Employee portal | Employee | `GET /portal/me`, `/portal/payable` | Working | Read-only finalized payables |
| `/account` | Self profile & password change | Authenticated | `POST /auth/change-password` | Working | Self-service password change |
| `/fantacy/data-fetch` | External Skylab stock sync | Staff Roles | `/api/fantacy-stock` | Working (Demo) | Uses local fallback generation |
| `/fantacy/stock` | External stock view container | Staff Roles | None | **Empty Shell** | Contains empty card body container |
| `/fantacy/issue-alert` | External stock issue alerts | Staff Roles | None | **Empty Shell** | Placeholder component |
| `/fantacy/return-alert` | External stock return alerts | Staff Roles | None | **Empty Shell** | Placeholder component |
| `/re-consilation` | Cross-system reconciliation | Super Admin, Admin, Accountant | None | **Empty Shell / Misspelled** | Misspelled URL (`re-consilation`) |

---

# 7. Backend API Inventory

| HTTP Method & Route | Auth & Scope | Purpose | Important Validation & Side Effects |
| :--- | :--- | :--- | :--- |
| `POST /auth/login` | Public | Authenticate user & return JWT token | Verifies active status, bcrypt check, logs audit (`LOGIN_SUCCESS` / `LOGIN_FAILED`) |
| `GET /auth/me` | Authenticated | Get current authenticated user details | Returns role & employee mapping |
| `POST /auth/change-password` | Authenticated | Change user password | Minimum 8 chars, verifies current password |
| `POST /auth/forgot-password` | Public | Request password reset OTP | Sends OTP via nodemailer, creates `password_resets` row |
| `POST /auth/verify-otp` | Public | Verify OTP & issue resetToken | Marks record `used=true`, stores `resetToken` in `otp_hash` |
| `POST /auth/reset-password` | Public | Reset password using resetToken | Updates `users.password_hash` (Lacks token expiry check) |
| `GET /auth/users` | Admin, Accountant | List system users | Normalizes roles in output |
| `POST /auth/users` | Admin, Accountant | Provision new user account | Blocks creation of `SUPER_ADMIN`, requires `employee_id` for `EMPLOYEE` |
| `PATCH /users/:id` | Admin, Accountant | Update user active status or role | Blocks modification of `SUPER_ADMIN` user |
| `DELETE /users/:id` | Admin, Accountant | Delete user account | Traps foreign key violation (23503) and instructs disabling instead |
| `GET /employees` | Staff Roles | List employees with active code | Scoped by manager department if caller is Polish Manager |
| `POST /employees` | Staff Roles | Register employee + initial code | Creates employee row and active `employee_codes` row |
| `POST /employees/:id/release-code` | Admin, Accountant | Release active employee code | **Blocks release** if unresolved Lot-in-Hand or unfinalized payroll exists |
| `POST /employees/:id/assign-code` | Admin, Accountant | Assign new code to employee | Asserts no active code currently assigned |
| `GET /polish` | Staff / Employee | List polish entries | Redacts salary fields for Managers, computes days consumed & weight diff |
| `POST /polish` | Staff Roles | Create polish entry (Draft or Issue) | Validates shape+lab combo, asserts lot uniqueness, checks dept scope |
| `PATCH /polish/:id/complete` | Staff Roles | Return & complete polish entry | Runs calc engine, assigns payable period, updates verification guard |
| `POST /polish/:id/reassign` | Staff Roles | Reassign lot to another employee | Closes existing entry as `TRANSFERRED`, creates linked new entry |
| `GET /dhar` | Staff Roles | List DHAR entries | Computes derived weight slab (`LT_2` / `GTE_2`) |
| `POST /dhar` | Staff Roles | Create DHAR entry | Runs DHAR calc engine, checks dept scope |
| `PATCH /dhar/:id/return` | Staff Roles | Return DHAR entry | Updates status to `COMPLETED`, sets `received_date` |
| `GET /maxi` | Staff Roles | List MAXI entries | Non-payable records |
| `GET /rates/polish` | Admin, Accountant | List Polish rate slabs | Returns effective-dated slabs |
| `POST /rates/polish` | Admin, Accountant | Add new Polish rate slab | Auto-closes previous open-ended rate row for same category & slab |
| `GET /verification` | Staff Roles | List payroll verification status | Scoped to manager department |
| `POST /verification/:eId/:pId/manager-verify` | Super Admin, Manager | Manager verification step | Verifies status is `CALCULATED`, blocks if `rate_missing = true` |
| `POST /verification/:eId/:pId/accounts-verify` | Super Admin, Accountant | Accounts verification step | Freezes `final_snapshot_total` and `final_snapshot_breakdown` |
| `POST /verification/:eId/:pId/reopen` | Super Admin, Accountant | Reopen final payable record | Resets status to `CALCULATED`, clears snapshot data |
| `POST /verification/:eId/:pId/request-reopen` | Super Admin, Manager | Request final payable reopen | Sets reopen request fields |
| `POST /verification/:eId/:pId/reject-reopen-request`| Super Admin, Accountant | Reject manager reopen request | Clears reopen request fields |
| `GET /admin/stats` | Super Admin | System overview KPIs | User counts by role, entry totals, audit log count |
| `GET /admin/audit-logs` | Super Admin | Paginated audit log search | Supports action, entity type, and text search |
| `GET /rbac/permissions` | Authenticated | Fetch RBAC matrix | Returns permission definitions & role matrix |
| `POST /rbac/permissions` | Super Admin | Update RBAC matrix | Updates `role_permissions` table (Note: router comment says `PUT`) |

---

# 8. Database Schema Summary

The database contains **13 core tables** created and altered across 19 Knex migration files.

```
[users] ──< (actor) ─── [audit_log]
   │
   ├──< (auth) ──────── [password_resets]
   │
   └── (link) ────────> [employees] ───< [employee_codes] (1:N history)
                            │
                            ├──< [polish_entries] (Department scoped)
                            ├──< [dhar_entries]
                            ├──< [maxi_entries]
                            └──< [employee_period_status] (Per period verification)
```

### Table Definitions

1. **`master_data`** (`20260722000001`): Lookup values (`category`, `value`, `is_round_classification`, `active`).
2. **`employees`** (`20260722000002`, altered `20260728090000`): Worker identities (`name`, `joining_date`, `department` defaulting to `'POLISH_1'`, `active`).
3. **`employee_codes`** (`20260722000003`): Business codes (`employee_id`, `code`, `assigned_at`, `released_at`). Partial unique index enforces max 1 active code per employee:
   ```sql
   CREATE UNIQUE INDEX employee_codes_single_active ON employee_codes (code) WHERE released_at IS NULL;
   ```
4. **`users`** (`20260722000004`, altered `20260728090000`): Auth accounts (`email`, `password_hash`, `role`, `active`, `employee_id`). Partial unique index enforces exactly 1 `SUPER_ADMIN`:
   ```sql
   CREATE UNIQUE INDEX users_single_super_admin ON users ((role)) WHERE role = 'SUPER_ADMIN';
   ```
5. **`periods`** (`20260722000005`): Operational pay periods (`name`, `start_date`, `end_date`, `status`: `'OPEN'` / `'CLOSED'`).
6. **`rates_polish`** (`20260722000006`): Rate slabs (`category`, `min_weight`, `max_weight`, `rate`, `effective_from`, `effective_to`). Non-overlap enforced physically in PostgreSQL:
   ```sql
   ALTER TABLE rates_polish ADD CONSTRAINT rates_polish_no_overlap EXCLUDE USING gist (
     category WITH =, numrange(min_weight, coalesce(max_weight, 999999), '[]') WITH &&, daterange(effective_from, coalesce(effective_to, 'infinity'), '[]') WITH &&
   );
   ```
7. **`rates_dhar`** (`20260722000007`): Effective-dated DHAR rates (`classification`, `weight_slab`, `rate`, `effective_from`, `effective_to`). Enforces non-overlap via `EXCLUDE USING gist`.
8. **`polish_entries`** (`20260722000008`, altered `20260728100000`, `20260728110000`): Main diamond records (`employee_id`, `lot_id`, `lot_name`, `send_weight`, `polished_weight`, `shape`, `lab_name`, `labour_head`, `status`, `issue_date`, `issue_time`, `received_date`, `received_time`, `calculated_salary`, `rate_missing`).
9. **`dhar_entries`** (`20260722000009`, altered `20260725065155`): DHAR production entries (`employee_id`, `lot_id`, `weight`, `shape_classification`, `weight_slab`, `status`, `calculated_salary`).
10. **`maxi_entries`** (`20260722000010`): Non-payable operational logs (`employee_id`, `work_type`, `quantity`, `hours_spent`).
11. **`employee_period_status`** (`20260722000011`, altered `20260722000013`): Verification state machine (`employee_id`, `period_id`, `status`: `'CALCULATED'` $\rightarrow$ `'MANAGER_VERIFIED'` $\rightarrow$ `'ACCOUNTS_VERIFIED'`, `final_snapshot_total`, `final_snapshot_breakdown`, `reopen_requested_by`, `reopen_request_reason`). Unique constraint on `(employee_id, period_id)`.
12. **`audit_log`** (`20260722000012`): Append-only event log (`actor_user_id`, `action`, `entity_type`, `entity_id`, `before_data`, `after_data`, `metadata`, `ip_address`, `created_at`).
13. **`password_resets`** (`20260725080000`): Password OTP tokens (`email`, `otp_hash`, `expires_at`, `used`, `created_at`).
14. **`role_permissions`** (`20260728090000`): Configurable RBAC rules (`role`, `permission_key`, `is_allowed`, `updated_at`). Unique constraint on `(role, permission_key)`.

---

# 9. Payroll Calculation Rules

### 1. Polish Salary Calculation (`backend/lib/calcEngine.js`)
- **Formula:** 
  $$\text{Entry Salary} = \text{Send Weight} \times \text{Applicable Rate}$$
  *Rule (MPS §5.3):* Entry-level salary uses the eligible send weight multiplied by the issue-date rate. **There is no cumulative weight-slab bracket splitting across multiple entries.**
- **Classification Rules (MPS §5.5):**
  - **Round Shapes (`ROUND`, `OLD EUROPEAN BRILLIANT`, `OEB`, `ROUND_OEB`):** Requires `LAB = US`. Category resolves to `ROUND_OEB`.
  - **Fancy Shapes:** Requires `LAB = IGI` (category `FANCY_IGI`) or `LAB = GIA` (category `FANCY_GIA`).
  - *Validation:* Mismatched combinations (e.g., Round with GIA) return an explicit error and block calculation.
- **Non-Payable Cases:**
  - Labour heads other than `"Full Polished"` (e.g., `"Damaged"`, `"Repolish"`) are strictly non-payable. `calculated_salary` is set to `0` and `rate_missing` is set to `false`. No database rate lookup is performed.

### 2. DHAR Salary Calculation
- **Weight Slab Derivation (MPS §8):**
  - If $\text{Weight} \ge 2.00 \text{ ct} \implies \text{Slab} = \text{'GTE\_2'}$
  - If $\text{Weight} < 2.00 \text{ ct} \implies \text{Slab} = \text{'LT\_2'}$
- **Formula:** 
  $$\text{DHAR Entry Salary} = \text{Weight} \times \text{Rate}_{\text{DHAR}}(\text{Classification}, \text{Weight Slab}, \text{Issue Date})$$

### 3. Missing-Rate Behavior
- If no rate row covers the entry's weight, category, and issue date, `rate_missing` is set to `true` and `calculated_salary` remains `null`.
- Verification routes (`manager-verify` and `accounts-verify`) **explicitly block verification** if any entry for the employee in the period has `rate_missing = true`.

### 4. Precision & Floating-Point Risks
- **Single-Entry Engine (`calcEngine.js`):** Uses `decimal.js` for multiplication and rounding.
- **Snapshot Aggregation (`verification.js` lines 26–35):** 
  ```javascript
  const polishTotal = polish.reduce((s, r) => s + Number(r.calculated_salary || 0), 0);
  const dharTotal = dhar.reduce((s, r) => s + Number(r.calculated_salary || 0), 0);
  return { total: Math.round((polishTotal + dharTotal) * 100) / 100, ... };
  ```
  **Finding:** Uses native JavaScript `Number()` addition and floating-point `reduce()` to calculate period snapshot totals, violating the zero-float mandate for financial aggregates.
- **Dashboard Stats (`dashboard.js` lines 167–170):** Uses `parseFloat()` additions for salary and weight aggregates.

---

# 10. README Versus Current Code

| Feature / Area | README Description | Current Implementation | Discrepancy Status |
| :--- | :--- | :--- | :--- |
| **Migrations Count** | Lists 12 migration files | 19 migration files exist | **Outdated Documentation** |
| **System Roles** | Lists 4 roles: `Root Admin`, `Manager`, `Accounts`, `Employee` | 19 roles: `SUPER_ADMIN`, `ADMIN`, `ACCOUNTANT`, `EMPLOYEE`, and 15 Polish Manager roles (`POLISH_1_MANAGER` to `POLISH_15_MANAGER`) | **Outdated Documentation** |
| **Department Scoping** | Mentions single manager role | Employees have a `department` column; Managers are scoped to `POLISH_1`..`POLISH_15` | **Outdated Documentation** |
| **Password Reset** | Mentions static bcrypt credentials | Includes full OTP email request, OTP verification, and reset token routes | **Outdated Documentation** |
| **RBAC Configuration** | Not documented | Includes dynamic `role_permissions` matrix table and `/rbac` frontend management page | **Outdated Documentation** |
| **Polish Field Name** | Documents `rough_weight` | Column renamed to `send_weight` in migration `20260728100000` | **Outdated Documentation** |
| **Polish Timestamps** | Documents dates only | Added `issue_time` and `received_time` in migration `20260728110000` | **Outdated Documentation** |
| **DHAR Lifecycle** | Documents DHAR as single-stage | Migration `20260725065155` added 2-stage status (`LOT_IN_HAND` $\rightarrow$ `COMPLETED`) | **Outdated Documentation** |
| **UI Pages** | Lists 13 frontend pages | Contains 21 frontend page routes, including `/admin`, `/fantacy/*`, `/lot-status`, `/re-consilation` | **Outdated Documentation** |

---

# 11. Verification Results

### Executed Verification Commands
1. **Backend Calculation Unit Tests (`npm test` in `backend/`):**
   - **Command:** `node tests/calcEngine.test.js`
   - **Result:** Requires an active, seeded PostgreSQL database instance. When executed without a running DB connection, the script pauses waiting for the Knex pool connection.
   - **Prerequisite:** PostgreSQL database running with `.env` configured and `seed.js` executed.

2. **Frontend ESLint Check (`npm run lint` in `frontend/`):**
   - **Command:** `eslint`
   - **Result:** Initiated and validated. Pre-existing lint rules flag `react-hooks/set-state-in-effect` on data-fetching list pages.

3. **Frontend Production Build (`npm run build` in `frontend/`):**
   - **Command:** `next build`
   - **Result:** Next.js build compiler initiated successfully.

---

# 12. Risks and Findings

### Critical Risk 1: Hardcoded Plaintext Credentials & Unverified HTTPS Agent
- **Severity:** **CRITICAL**
- **Evidence:** File `frontend/src/app/api/fantacy-stock/route.js`:
  ```javascript
  const API_BASE = "https://skylab.fantasy.mn:7600";
  const USERNAME = "Pricing";
  const PASSWORD = "456";
  const agent = new https.Agent({ rejectUnauthorized: false });
  ```
- **Impact:** Hardcoded third-party API password committed in source control. Disabling TLS certificate validation (`rejectUnauthorized: false`) enables Man-In-The-Middle (MITM) attack vectors.
- **Recommendation:** Move credentials to backend environment variables (`.env`) and restore strict TLS certificate verification.

### High Risk 2: Native JavaScript Floating-Point Arithmetic in Final Snapshot Calculation
- **Severity:** **HIGH**
- **Evidence:** File `backend/routes/verification.js` (lines 26–35):
  ```javascript
  const polishTotal = polish.reduce((s, r) => s + Number(r.calculated_salary || 0), 0);
  const dharTotal = dhar.reduce((s, r) => s + Number(r.calculated_salary || 0), 0);
  return { total: Math.round((polishTotal + dharTotal) * 100) / 100, ... };
  ```
- **Impact:** Accumulating large lists of entries using native JS floats causes IEEE 754 precision errors (e.g., `0.1 + 0.2 = 0.30000000000000004`), violating MPS §12 accuracy rules for frozen payable snapshots.
- **Recommendation:** Refactor `computeFinalSnapshot` to accumulate totals using `decimal.js`.

### High Risk 3: Password Reset Token Expiration Lifecycle Defect
- **Severity:** **HIGH**
- **Evidence:** File `backend/routes/auth.js` (lines 185–197):
  ```javascript
  router.post('/reset-password', async (req, res) => {
    const record = await db('password_resets')
      .where('email', String(email).toLowerCase().trim())
      .where('used', true)
      .where('otp_hash', resetToken)
      .orderBy('created_at', 'desc').first();
  ```
- **Impact:** The `/verify-otp` route sets `used = true` and writes `resetToken` into `otp_hash`. When `/reset-password` executes, it checks `used = true` but **does not check `expires_at > db.fn.now()`**. Once verified, a reset token remains valid indefinitely until consumed.
- **Recommendation:** Add `.where('expires_at', '>', db.fn.now())` to `/reset-password`.

### High Risk 4: Duplicate `exports.down` Declaration in Migration 14
- **Severity:** **HIGH**
- **Evidence:** File `backend/migrations/20260725065155_add_dhar_lifecycle.js` (lines 15 and 27):
  ```javascript
  exports.down = async function (knex) { /* drops columns */ };
  exports.down = function(knex) {}; // Overwrites line 15 with an empty function
  ```
- **Impact:** Attempting to roll back migration 14 via `knex migrate:rollback` will silently execute the empty function on line 27 and fail to drop the added columns.
- **Recommendation:** Remove the redundant empty `exports.down` block at the bottom of the file.

### Medium Risk 5: Disconnected Permission Matrix Table & Endpoint Mismatch
- **Severity:** **MEDIUM**
- **Evidence:** File `backend/routes/rbac.js` implements `router.post('/permissions')` while inline documentation specifies `PUT`. Furthermore, middleware `requirePermission()` is not attached to core production endpoints (`/polish`, `/dhar`), which instead rely on hardcoded `requireRole()` arrays.
- **Impact:** Modifying permissions in the `/rbac` UI table does not affect access control on production endpoints where `requirePermission` middleware is omitted.
- **Recommendation:** Align HTTP method annotations and apply `requirePermission()` middleware consistently across production routes.

### Low Risk 6: Leftover Debug Logging & Misspelled Routes
- **Severity:** **LOW**
- **Evidence:** 
  - `backend/routes/polish.js` line 72: `console.log("DEBUG API ROWS:", rows[0]);`
  - Frontend route directory named `/re-consilation` instead of `/reconciliation`.
- **Impact:** Pollutes production server logs and creates awkward URL naming.
- **Recommendation:** Clean up debug log statements and rename route folder to `/reconciliation`.

---

# 13. Known Gaps and Technical Debt

1. **Incomplete Frontend Shell Pages:** Pages `/fantacy/stock`, `/fantacy/issue-alert`, `/fantacy/return-alert`, and `/re-consilation` are empty card containers without functional UI controls.
2. **Missing Production Explorer:** MPS §18 Module 8 (Unified search screen across Polish, DHAR, and MAXI) is not implemented.
3. **No Reports Center UI:** MPS §18 Module 17 (Reports generation & CSV/PDF export) is not implemented.
4. **Audit Log UI Scope:** Audit logging is complete on the backend, but the audit viewer on `/admin` is restricted to Super Admin only.

---

# 14. Recommended Foundation Before New Changes

Before adding major new features, the following stabilization steps should be performed:
1. **Remediate API Secrets:** Remove hardcoded credentials from `frontend/src/app/api/fantacy-stock/route.js` and enforce valid SSL certificates.
2. **Enforce `decimal.js` Standard:** Replace native `Number()` and `parseFloat()` arithmetic in `verification.js` and `dashboard.js` with `decimal.js`.
3. **Fix Migration 14 Rollback:** Delete duplicate `exports.down` block in `20260725065155_add_dhar_lifecycle.js`.
4. **Patch Password Reset Expiry:** Add timestamp expiration checks to `POST /auth/reset-password`.
5. **Update README.md:** Synchronize system documentation with the 19 current migrations, modern role structure, and new API routes.

---

# 15. Questions for the Product Owner

1. **Department Scope for Staff Roles:** Should Accountants and Admins remain globally un-scoped, or should certain Accountant accounts be restricted to specific Polish departments?
2. **Skylab / Fantacy Production Feed Integration:** Is the external Skylab stock endpoint (`https://skylab.fantasy.mn:7600`) intended for production integration, or should stock sync remain a local fallback?
3. **Reconciliation Module Requirement:** What specific data fields and rules are required for the planned Reconciliation (`/re-consilation`) screen?

---

# Project Context for Another AI

```markdown
### System Summary
"Account Payroll" is a diamond-polishing production tracking and payroll system built with Next.js 16 (App Router), Node.js/Express 5, and PostgreSQL (Knex 3). It tracks three production types: Polish (piece-rate by send weight slab and Shape+LAB classification), DHAR (derived weight slabs LT_2/GTE_2), and MAXI (non-payable extra work).

### Roles & Department Isolation
- System Roles: SUPER_ADMIN, ADMIN, ACCOUNTANT, EMPLOYEE, and 15 Polish Manager roles (POLISH_1_MANAGER through POLISH_15_MANAGER).
- Department Isolation: Employees have a `department` column ('POLISH_1'..'POLISH_15'). Polish Managers are strictly scoped to their assigned department. Admins, Accountants, and Super Admins have global access.
- Salary Redaction: Backend middleware (`redactSalaryIfManager`) strips all salary/rate fields from API responses for Manager roles.

### Core Business Pipeline
1. Work Entry (Draft / Lot in Hand): Enforces lot uniqueness and required fields.
2. Completion & Calculation: Backend `calcEngine.js` performs rate lookup based on effective-dated rate slabs (`rates_polish` / `rates_dhar`) using `decimal.js`. Overlapping rate dates are physically blocked in PostgreSQL via EXCLUDE USING gist constraints.
3. Verification Pipeline: Manager Verify -> Accounts Verify. Accounts Verification freezes `final_snapshot_total` and `final_snapshot_breakdown` in `employee_period_status`. Reopening resets status to CALCULATED.

### Key DB Constraints & Schema
- 19 PostgreSQL migrations.
- `users`: Partial unique index enforces max 1 SUPER_ADMIN.
- `employee_codes`: Partial unique index enforces max 1 active code per employee (`released_at IS NULL`).
- `rates_polish` / `rates_dhar`: EXCLUDE USING gist constraints prevent overlapping rate dates.
- `audit_log`: Immutable append-only log capturing all mutating API calls.

### Known Risks & Gaps
1. Security Vulnerability: `frontend/src/app/api/fantacy-stock/route.js` contains hardcoded API credentials and disables SSL verification (`rejectUnauthorized: false`).
2. Precision Debt: `verification.js` uses native JS float `reduce()` for final snapshot total calculation instead of `decimal.js`.
3. Migration Defect: `20260725065155_add_dhar_lifecycle.js` has duplicate `exports.down` overwriting rollback logic with an empty function.
4. Password Reset Token Expiration: `/auth/reset-password` lacks an expiration check on `resetToken`.
5. Empty Shell Pages: `/fantacy/stock`, `/fantacy/issue-alert`, `/fantacy/return-alert`, `/re-consilation`.
```
