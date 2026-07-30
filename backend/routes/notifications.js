const express = require('express');
const db = require('../db');
const { ROLES, requireAuth, requireRole, staffRoles, applyEmployeeScope, isManagerRole } = require('../middleware/auth');
const { requireVisiblePeriod } = require('../lib/periodAccess');

const router = express.Router();

// A live "Action Center" rather than a stored event log: every item here is
// derived from data that already exists (verification status, rate_missing
// flags) instead of a separate notifications table that would need writing
// to from every mutating route. Counts only -- never salary amounts, so this
// is safe to show a Manager (MPS 16: no salary visibility).
router.get('/', requireAuth, requireRole(...staffRoles()), async (req, res) => {
  const { period_id } = req.query;
  let period;
  if (period_id) {
    period = await db('periods').where({ id: period_id }).first();
    try {
      await requireVisiblePeriod(db, req.user, period_id);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }
  }
  if (!period) {
    period = await db('periods').where('status', 'OPEN').orderBy('start_date', 'desc').first();
  }

  const items = [];

  if (period) {
    if (isManagerRole(req.user.role) || req.user.role === ROLES.SUPER_ADMIN) {
      const [{ count: awaitingManager }] = await applyEmployeeScope(db('employee_period_status'), req.user)
        .where({ period_id: period.id, status: 'CALCULATED' })
        .count('id as count');
      if (Number(awaitingManager) > 0) {
        items.push({
          id: 'awaiting-manager-verify',
          severity: 'amber',
          message: `${awaitingManager} employee${awaitingManager == 1 ? '' : 's'} awaiting Manager Verification in ${period.name}`,
          href: '/verification',
        });
      }

      const [{ count: draftPolish }] = await applyEmployeeScope(db('polish_entries'), req.user)
        .where({ payable_period_id: period.id, status: 'DRAFT' })
        .count('id as count');
      if (Number(draftPolish) > 0) {
        items.push({
          id: 'draft-polish-entries',
          severity: 'amber',
          message: `${draftPolish} Polish lot${draftPolish == 1 ? '' : 's'} in Draft in ${period.name}`,
          href: '/polish',
        });
      }

      const [{ count: polishInHand }] = await applyEmployeeScope(db('polish_entries'), req.user)
        .where({ status: 'LOT_IN_HAND' })
        .count('id as count');
      if (Number(polishInHand) > 0) {
        items.push({
          id: 'polish-in-hand',
          severity: 'amber',
          message: `${polishInHand} Polish lot${polishInHand == 1 ? '' : 's'} in Hand awaiting completion`,
          href: '/polish',
        });
      }
    }

    if (req.user.role === ROLES.ACCOUNTANT || req.user.role === ROLES.SUPER_ADMIN || req.user.role === ROLES.ADMIN) {
      const [{ count: awaitingAccounts }] = await db('employee_period_status')
        .where({ period_id: period.id, status: 'MANAGER_VERIFIED' })
        .count('id as count');
      if (Number(awaitingAccounts) > 0) {
        items.push({
          id: 'awaiting-accounts-verify',
          severity: 'blue',
          message: `${awaitingAccounts} employee${awaitingAccounts == 1 ? '' : 's'} awaiting Accounts Verification in ${period.name}`,
          href: '/verification',
        });
      }

      const [{ count: missingPolish }] = await db('polish_entries').where({ payable_period_id: period.id, rate_missing: true }).count('id as count');
      const [{ count: missingDhar }] = await db('dhar_entries').where({ payable_period_id: period.id, rate_missing: true }).count('id as count');
      const missingTotal = Number(missingPolish) + Number(missingDhar);
      if (missingTotal > 0) {
        items.push({
          id: 'rate-missing',
          severity: 'rose',
          message: `${missingTotal} entr${missingTotal === 1 ? 'y has' : 'ies have'} Rate Missing in ${period.name}`,
          href: '/rates',
        });
      }

      // Check if period is 100% verified and ready to close
      if (period.status === 'OPEN') {
        const [{ count: totalEp }] = await db('employee_period_status').where({ period_id: period.id }).count('id as count');
        const [{ count: verifiedEp }] = await db('employee_period_status').where({ period_id: period.id, status: 'ACCOUNTS_VERIFIED' }).count('id as count');
        if (Number(totalEp) > 0 && Number(totalEp) === Number(verifiedEp)) {
          items.push({
            id: 'period-ready-close',
            severity: 'emerald',
            message: `Period ${period.name} is 100% verified and ready to be closed!`,
            href: '/periods',
          });
        }
      }

      // Uncoded employees alert
      const [uncoded] = await db('employees as e')
        .leftJoin('employee_codes as ec', function() {
          this.on('ec.employee_id', '=', 'e.id').andOnNull('ec.released_at');
        })
        .whereNull('ec.id')
        .count('e.id as count');
      if (Number(uncoded.count) > 0) {
        items.push({
          id: 'uncoded-employees',
          severity: 'amber',
          message: `${uncoded.count} employee${uncoded.count == 1 ? '' : 's'} missing active Employee Code`,
          href: '/employees',
        });
      }
    }
  }

    // Live reopen request alerts for current open period or any period
    const pendingReopens = await db('employee_period_status as eps')
      .join('employees as e', 'e.id', 'eps.employee_id')
      .leftJoin('employee_codes as ec', function() {
        this.on('ec.employee_id', '=', 'e.id').andOnNull('ec.released_at');
      })
      .whereNotNull('eps.reopen_requested_by')
      .select('eps.id', 'e.name as employee_name', 'ec.code as employee_code', 'eps.reopen_request_reason');

    if (pendingReopens.length > 0) {
      pendingReopens.forEach((reqObj) => {
        const identifier = reqObj.employee_code || reqObj.employee_name;
        const reasonSuffix = reqObj.reopen_request_reason ? `: "${reqObj.reopen_request_reason}"` : "";
        items.push({
          id: `reopen-request-${reqObj.id}`,
          severity: 'rose',
          message: `Reopen requested for (${reqObj.employee_code || 'No Code'}) ${reqObj.employee_name}${reasonSuffix}`,
          href: `/verification?search=${encodeURIComponent(identifier)}`,
        });
      });
    }

  res.json({ count: items.length, items });
});

module.exports = router;
