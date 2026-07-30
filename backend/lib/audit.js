// MPS 21: audit coverage for authentication, entry lifecycle, employee
// changes, rate changes, verification, reopening, master data, exports, user
// management, and security actions. Records are tamper-resistant -- no
// route in this app ever updates or deletes an audit_log row.

async function logAudit(db, { actorUserId, action, entityType, entityId, before = null, after = null, metadata = null, ipAddress = null }) {
  await db('audit_log').insert({
    actor_user_id: actorUserId || null,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    before_data: before ? JSON.stringify(before) : null,
    after_data: after ? JSON.stringify(after) : null,
    metadata: metadata ? JSON.stringify(metadata) : null,
    ip_address: ipAddress,
  });
}

module.exports = { logAudit };
