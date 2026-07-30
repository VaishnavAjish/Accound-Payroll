const express = require('express');
const db = require('../db');
const { ROLES, requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All routes in this module are restricted strictly to SUPER_ADMIN
router.use(requireAuth, requireRole(ROLES.SUPER_ADMIN));

/**
 * GET /admin/stats
 * Overview KPIs for system administration
 */
router.get('/stats', async (req, res) => {
  try {
    const userRoleCounts = await db('users')
      .select('role')
      .count('id as count')
      .groupBy('role');

    const [{ count: totalUsers }] = await db('users').count('id as count');
    const [{ count: totalEmployees }] = await db('employees').count('id as count');
    const [{ count: activeEmployees }] = await db('employees').where('active', true).count('id as count');
    
    const [{ count: activeCodes }] = await db('employee_codes')
      .whereNull('released_at')
      .count('id as count');

    const [{ count: polishCount }] = await db('polish_entries').count('id as count');
    const [{ count: dharCount }] = await db('dhar_entries').count('id as count');
    const [{ count: maxiCount }] = await db('maxi_entries').count('id as count');

    const [{ count: auditLogCount }] = await db('audit_log').count('id as count');

    const periodCounts = await db('periods')
      .select('status')
      .count('id as count')
      .groupBy('status');

    res.json({
      users: {
        total: Number(totalUsers),
        byRole: userRoleCounts.reduce((acc, row) => ({ ...acc, [row.role]: Number(row.count) }), {})
      },
      employees: {
        total: Number(totalEmployees),
        active: Number(activeEmployees),
        activeCodes: Number(activeCodes)
      },
      entries: {
        polish: Number(polishCount),
        dhar: Number(dharCount),
        maxi: Number(maxiCount),
        total: Number(polishCount) + Number(dharCount) + Number(maxiCount)
      },
      periods: periodCounts.reduce((acc, row) => ({ ...acc, [row.status]: Number(row.count) }), {}),
      auditLogsCount: Number(auditLogCount)
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to fetch admin stats.' });
  }
});

/**
 * GET /admin/audit-logs
 * Paginated and filterable audit log viewer
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const { action, entity_type: entityType, search } = req.query;

    let baseQuery = db('audit_log as al')
      .leftJoin('users as u', 'u.id', 'al.actor_user_id')
      .select(
        'al.id',
        'al.actor_user_id',
        'u.name as actor_name',
        'u.email as actor_email',
        'u.role as actor_role',
        'al.action',
        'al.entity_type',
        'al.entity_id',
        'al.before_data',
        'al.after_data',
        'al.metadata',
        'al.ip_address',
        'al.created_at'
      );

    if (action) {
      baseQuery = baseQuery.where('al.action', action);
    }

    if (entityType) {
      baseQuery = baseQuery.where('al.entity_type', entityType);
    }

    if (search) {
      baseQuery = baseQuery.andWhere((builder) => {
        builder
          .whereILike('al.action', `%${search}%`)
          .orWhereILike('al.entity_type', `%${search}%`)
          .orWhereILike('u.name', `%${search}%`)
          .orWhereILike('u.email', `%${search}%`);
      });
    }

    const countQuery = db('audit_log as al')
      .leftJoin('users as u', 'u.id', 'al.actor_user_id');

    if (action) countQuery.where('al.action', action);
    if (entityType) countQuery.where('al.entity_type', entityType);
    if (search) {
      countQuery.andWhere((builder) => {
        builder
          .whereILike('al.action', `%${search}%`)
          .orWhereILike('al.entity_type', `%${search}%`)
          .orWhereILike('u.name', `%${search}%`)
          .orWhereILike('u.email', `%${search}%`);
      });
    }

    const [{ count: totalCount }] = await countQuery.count('al.id as count');

    const logs = await baseQuery
      .orderBy('al.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // Get distinct action types and entity types for filter dropdowns
    const actions = await db('audit_log').distinct('action').orderBy('action');
    const entityTypes = await db('audit_log').distinct('entity_type').orderBy('entity_type');

    res.json({
      total: Number(totalCount),
      page,
      limit,
      logs,
      filterOptions: {
        actions: actions.map((a) => a.action),
        entityTypes: entityTypes.map((e) => e.entity_type)
      }
    });
  } catch (err) {
    console.error('Audit logs fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

module.exports = router;
