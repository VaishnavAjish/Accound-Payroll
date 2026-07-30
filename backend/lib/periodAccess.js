const { hasPermission } = require('../middleware/auth');

async function requireVisiblePeriod(db, user, periodId) {
  if (!periodId) return null;

  const period = await db('periods').where({ id: periodId }).first();
  if (!period) {
    const err = new Error('Period not found.');
    err.status = 404;
    throw err;
  }

  if (period.status === 'CLOSED' && !(await hasPermission(user, 'view_closed_periods'))) {
    const err = new Error('You do not have permission to view closed periods.');
    err.status = 403;
    throw err;
  }

  return period;
}

module.exports = { requireVisiblePeriod };
