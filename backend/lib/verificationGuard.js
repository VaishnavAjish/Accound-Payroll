// MPS 14: Editing and Reopen for Correction.
// "Before Manager verification: authorized edit and automatic recalculation
// where applicable. After Manager verification: salary-affecting edit resets
// Manager verification and requires the verification chain again. After
// Accounts verification / Final Payable: direct editing is blocked."

class EditBlockedError extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
  }
}

/**
 * Call before applying an edit to a Polish/DHAR entry that already has a
 * payable_period_id. Throws EditBlockedError if the employee-period is
 * Final Payable. If the employee-period is Manager-verified and this edit
 * touches a salary-affecting field, resets verification back to CALCULATED
 * inside the same transaction.
 */
async function guardEntryEdit(trx, { employeeId, periodId, isSalaryAffecting, actorUserId }) {
  if (!periodId) return; // not yet payable, nothing to guard

  const period = await trx('periods').where({ id: periodId }).first();
  if (period && period.status === 'CLOSED') {
    throw new EditBlockedError('This period is closed. Data cannot be edited until it is reopened.');
  }

  const status = await trx('employee_period_status').where({ employee_id: employeeId, period_id: periodId }).first();
  if (!status) return;

  if (status.status === 'ACCOUNTS_VERIFIED') {
    throw new EditBlockedError('This employee-period is Final Payable. Use Reopen for Correction before editing.');
  }

  if (status.status === 'MANAGER_VERIFIED' && isSalaryAffecting) {
    await trx('employee_period_status')
      .where({ id: status.id })
      .update({ status: 'CALCULATED', manager_verified_by: null, manager_verified_at: null, updated_at: trx.fn.now() });
  }
}

/**
 * Ensure an employee_period_status row exists (status CALCULATED) once an
 * entry becomes payable for a period, so the verification chain has
 * something to operate on.
 */
async function ensurePeriodStatusRow(trx, { employeeId, periodId }) {
  if (!periodId) return;
  const existing = await trx('employee_period_status').where({ employee_id: employeeId, period_id: periodId }).first();
  if (existing) return existing;
  const [row] = await trx('employee_period_status').insert({ employee_id: employeeId, period_id: periodId, status: 'CALCULATED' }).returning('*');
  return row;
}

async function cleanupOrphanPeriodStatus(trx, { employeeId, periodId }) {
  if (!employeeId || !periodId) return;
  const [{ count: pCount }] = await trx('polish_entries').where({ employee_id: employeeId, payable_period_id: periodId }).count('id as count');
  const [{ count: dCount }] = await trx('dhar_entries').where({ employee_id: employeeId, payable_period_id: periodId }).count('id as count');
  const total = Number(pCount) + Number(dCount);
  if (total === 0) {
    await trx('employee_period_status').where({ employee_id: employeeId, period_id: periodId, status: 'CALCULATED' }).del();
  }
}

module.exports = { EditBlockedError, guardEntryEdit, ensurePeriodStatusRow, cleanupOrphanPeriodStatus };
