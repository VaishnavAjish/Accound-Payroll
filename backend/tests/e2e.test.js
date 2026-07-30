// End-to-end regression test against a *live* server + database.
// Requires: `node server.js` running, and a database that has been freshly
// migrated + seeded (this test creates its own users/employee/period and
// will fail on unique-constraint conflicts if run twice against the same
// data). Run: node tests/e2e.test.js <root-admin-password>
const BASE = 'http://localhost:8000';

async function call(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

let passed = 0, failed = 0;
function assert(cond, msg, extra) {
  if (cond) { console.log(`PASS: ${msg}`); passed++; }
  else { console.error(`FAIL: ${msg}`, extra !== undefined ? JSON.stringify(extra) : ''); failed++; }
}

async function main() {
  // 1. Super Admin login
  const login = await call('POST', '/auth/login', null, { email: 'super@company.local', password: process.argv[2] });
  assert(login.status === 200, 'Super Admin login', login);
  const rootToken = login.data.token;

  // 2. Create Polish Manager + Accountant users
  const mgr = await call('POST', '/auth/users', rootToken, { email: 'manager@company.local', password: 'ManagerPass123', name: 'Test Manager', role: 'POLISH_1_MANAGER' });
  assert(mgr.status === 201, 'Create Manager user', mgr);
  const acc = await call('POST', '/auth/users', rootToken, { email: 'accounts@company.local', password: 'AccountsPass123', name: 'Test Accountant', role: 'ACCOUNTANT' });
  assert(acc.status === 201, 'Create Accountant user', acc);

  const mgrLogin = await call('POST', '/auth/login', null, { email: 'manager@company.local', password: 'ManagerPass123' });
  const mgrToken = mgrLogin.data.token;
  const accLogin = await call('POST', '/auth/login', null, { email: 'accounts@company.local', password: 'AccountsPass123' });
  const accToken = accLogin.data.token;

  // 3. Create employee (as Manager)
  const emp = await call('POST', '/employees', mgrToken, { name: 'Smoke Test Employee', code: 'SMK1' });
  assert(emp.status === 201, 'Create employee with code', emp);
  const employeeId = emp.data.id;

  // 4. Open a period (Accountant)
  const period = await call('POST', '/periods', accToken, { name: 'SmokeTest-Period', start_date: '2026-07-01', end_date: '2026-07-31' });
  assert(period.status === 201, 'Open period', period);
  const periodId = period.data.id;

  // 5. Issue a Polish entry (Manager) -- Round/US, 1.0ct send weight -> expect 900
  const issue = await call('POST', '/polish', mgrToken, {
    employee_id: employeeId, issue_date: '2026-07-05', lot_id: 'LOT1', lot_name: 'Test Lot',
    qty: 1, shape: 'Round', send_weight: 1.0, estimate_weight: 1.1, labour_head: 'Full Polished',
  });
  assert(issue.status === 201, 'Issue Polish entry (Lot in Hand)', issue);
  assert(issue.data.status === 'LOT_IN_HAND', 'Entry starts as LOT_IN_HAND', issue.data);
  const entryId = issue.data.id;

  // Manager should not see salary fields anywhere, even though none set yet
  assert(issue.data.calculated_salary === undefined, 'Manager response has no calculated_salary field', issue.data);

  // 6. Complete it (Manager)
  const complete = await call('PATCH', `/polish/${entryId}/complete`, mgrToken, {
    received_date: '2026-07-10', polished_weight: 0.95, color: 'D', shade: 'White', clarity: 'VS1',
    cut_pol_sym: 'EX EX EX', grader: 'J.J.', stone_level: 'Propper', lab_name: 'US',
  });
  assert(complete.status === 200, 'Complete Polish entry', complete);
  assert(complete.data.status === 'COMPLETED', 'Entry status COMPLETED', complete.data);

  // 7. Accountant view should show the real calculated salary = 900
  // (NUMERIC columns come back as exact-decimal strings by design, MPS 12 --
  // never coerce payroll money through a JS float.)
  const asAccounts = await call('GET', `/polish/${entryId}`, accToken);
  assert(Number(asAccounts.data.calculated_salary) === 900, 'Accountant sees calculated_salary 900 for 1.0ct Round US', asAccounts.data);
  assert(asAccounts.data.issue_date === '2026-07-05', 'issue_date round-trips exactly with no timezone shift', asAccounts.data.issue_date);

  // 8. Manager verification
  const mv = await call('POST', `/verification/${employeeId}/${periodId}/manager-verify`, mgrToken);
  assert(mv.status === 200, 'Manager verify', mv);

  // Accountant cannot verify before manager -- already done, so instead test the reverse block on a fresh case is skipped; test bulk instead.

  // 9. Accountant verification -> Final Payable snapshot
  const av = await call('POST', `/verification/${employeeId}/${periodId}/accounts-verify`, accToken);
  assert(av.status === 200 && av.data.total === 900, 'Accountant verify => Final Payable total 900', av);

  // 10. Direct edit should now be blocked (Final Payable immutable)
  const blockedEdit = await call('PATCH', `/polish/${entryId}`, mgrToken, { send_weight: 2.0 });
  assert(blockedEdit.status === 409, 'Editing after Final Payable is blocked', blockedEdit);

  // 11. Reopen for correction
  const reopen = await call('POST', `/verification/${employeeId}/${periodId}/reopen`, accToken, { reason: 'Smoke test correction' });
  assert(reopen.status === 200 && reopen.data.status === 'CALCULATED', 'Reopen resets to CALCULATED', reopen.data);

  // 12. Edit now allowed again
  const editAfterReopen = await call('PATCH', `/polish/${entryId}`, mgrToken, { send_weight: 1.0 });
  assert(editAfterReopen.status === 200, 'Edit allowed after reopen', editAfterReopen);

  // 13. Employee portal: create employee-linked user, should see nothing until re-verified
  const empUser = await call('POST', '/auth/users', rootToken, { email: 'smoke.employee@company.local', password: 'EmployeePass123', name: 'Smoke Test Employee', role: 'EMPLOYEE', employee_id: employeeId });
  assert(empUser.status === 201, 'Create employee-linked user', empUser);
  const empLogin = await call('POST', '/auth/login', null, { email: 'smoke.employee@company.local', password: 'EmployeePass123' });
  const payableBeforeReverify = await call('GET', '/portal/payable', empLogin.data.token);
  assert(payableBeforeReverify.data.length === 0, 'Employee sees nothing before re-verification', payableBeforeReverify.data);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
