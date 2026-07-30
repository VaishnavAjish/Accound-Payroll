const express = require('express');
const db = require('../db');
const { ROLES, requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// MPS 16: "Employee: Read-only access to own identity and own finalized
// salary/entry breakdown only." Every route here is scoped to
// req.user.employee_id -- there is no way for an Employee-role token to
// request another employee's data, and nothing before Accounts Final
// Verification is ever exposed here.
router.use(requireAuth, requireRole(ROLES.EMPLOYEE));

router.get('/me', async (req, res) => {
  if (!req.user.employee_id) return res.status(403).json({ error: 'This account is not linked to an employee record.' });
  const employee = await db('employees').where({ id: req.user.employee_id }).first();
  if (!employee) return res.status(404).json({ error: 'Employee record not found.' });
  const { id, current_code, name, grade, specialist, work_status } = employee;
  res.json({ id, current_code, name, grade, specialist, work_status });
});

// MPS 13: "After Accounts Final Verification, the employee-month Final
// Payable becomes an immutable historical snapshot visible to the
// employee." -- only ACCOUNTS_VERIFIED rows are returned, ever.
router.get('/payable', async (req, res) => {
  if (!req.user.employee_id) return res.status(403).json({ error: 'This account is not linked to an employee record.' });

  const rows = await db('employee_period_status as eps')
    .join('periods as p', 'p.id', 'eps.period_id')
    .where('eps.employee_id', req.user.employee_id)
    .andWhere('eps.status', 'ACCOUNTS_VERIFIED')
    .select('p.id as period_id', 'p.name as period_name', 'p.start_date', 'p.end_date', 'eps.final_snapshot_total', 'eps.final_snapshot_breakdown', 'eps.accounts_verified_at')
    .orderBy('p.start_date', 'desc');

  res.json(rows);
});

module.exports = router;
