const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { ROLES, MANAGER_ROLES, generateToken, normalizeRole, requireAuth, requireRole, requirePermission, managementRoles } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');

const router = express.Router();

// MPS 16: no public self-registration is specified for this system --
// accounts are provisioned by Root Admin/Accounts, matching the closed-role,
// salary-sensitive nature of the product (MPS 1: Security is priority #2).
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = await db('users').where({ email: String(email).toLowerCase().trim() }).first();
  if (!user || !user.active) {
    await logAudit(db, { action: 'LOGIN_FAILED', entityType: 'user', metadata: { email }, ipAddress: req.ip });
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    await logAudit(db, { actorUserId: user.id, action: 'LOGIN_FAILED', entityType: 'user', entityId: user.id, ipAddress: req.ip });
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = generateToken(user);
  await logAudit(db, { actorUserId: user.id, action: 'LOGIN_SUCCESS', entityType: 'user', entityId: user.id, ipAddress: req.ip });

  const role = normalizeRole(user.role);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role, employee_id: user.employee_id },
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await db('users').where({ id: req.user.id }).first();
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ id: user.id, email: user.email, name: user.name, role: normalizeRole(user.role), employee_id: user.employee_id });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

  const user = await db('users').where({ id: req.user.id }).first();
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  const password_hash = await bcrypt.hash(newPassword, 12);
  await db('users').where({ id: user.id }).update({ password_hash });
  await logAudit(db, { actorUserId: user.id, action: 'PASSWORD_CHANGED', entityType: 'user', entityId: user.id, ipAddress: req.ip });
  res.json({ ok: true });
});

// Root Admin / Accounts provision Manager, Accounts, and Employee accounts.
// MPS 16: "Exactly one permanent [Root Admin] account" -- the DB partial
// unique index blocks a second one even if this check is ever bypassed.
router.get('/users', requireAuth, requireRole(...managementRoles()), requirePermission('manage_users'), async (req, res) => {
  const users = await db('users').select('id', 'email', 'name', 'role', 'active', 'employee_id').orderBy('id');
  res.json(users.map((user) => ({ ...user, role: normalizeRole(user.role) })));
});
router.post('/users', requireAuth, requireRole(...managementRoles()), requirePermission('manage_users'), async (req, res) => {
  const { email, password, name, role, employee_id } = req.body || {};
  const normalizedRole = normalizeRole(role);
  const allowedRoles = [ROLES.ADMIN, ROLES.ACCOUNTANT, ROLES.EMPLOYEE, ...MANAGER_ROLES];
  if (!email || !password || !name || !role) return res.status(400).json({ error: 'email, password, name, and role are required.' });
  if (normalizedRole === ROLES.SUPER_ADMIN) return res.status(403).json({ error: 'Super Admin is a single permanent account and cannot be created via this endpoint.' });
  if (!allowedRoles.includes(normalizedRole)) return res.status(400).json({ error: 'Invalid role.' });
  if (normalizedRole === ROLES.EMPLOYEE && !employee_id) return res.status(400).json({ error: 'employee_id is required for EMPLOYEE role accounts.' });

  const password_hash = await bcrypt.hash(password, 12);
  const [user] = await db('users')
    .insert({ email: String(email).toLowerCase().trim(), password_hash, name, role: normalizedRole, employee_id: employee_id || null, active: true })
    .returning(['id', 'email', 'name', 'role', 'employee_id']);

  await logAudit(db, { actorUserId: req.user.id, action: 'USER_CREATED', entityType: 'user', entityId: user.id, after: user, ipAddress: req.ip });
  res.status(201).json(user);
});

// MPS 16: Root Admin "cannot be deleted, deactivated, or downgraded" -- this
// blocks deactivating/downgrading any ROOT_ADMIN row via this endpoint.
router.patch('/users/:id', requireAuth, requireRole(...managementRoles()), requirePermission('manage_users'), async (req, res) => {
  const target = await db('users').where({ id: req.params.id }).first();
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (normalizeRole(target.role) === ROLES.SUPER_ADMIN) return res.status(403).json({ error: 'Super Admin cannot be modified through this endpoint.' });

  const { active, role, name } = req.body || {};
  const update = {};
  if (active !== undefined) update.active = !!active;
  const normalizedRole = role ? normalizeRole(role) : null;
  const allowedRoles = [ROLES.ADMIN, ROLES.ACCOUNTANT, ROLES.EMPLOYEE, ...MANAGER_ROLES];
  if (normalizedRole && allowedRoles.includes(normalizedRole)) update.role = normalizedRole;
  if (name) update.name = name;

  const [updated] = await db('users').where({ id: target.id }).update(update).returning(['id', 'email', 'name', 'role', 'active']);
  await logAudit(db, { actorUserId: req.user.id, action: 'USER_UPDATED', entityType: 'user', entityId: target.id, before: target, after: updated, ipAddress: req.ip });
  res.json(updated);
});

router.delete('/users/:id', requireAuth, requireRole(...managementRoles()), requirePermission('manage_users'), async (req, res) => {
  const target = await db('users').where({ id: req.params.id }).first();
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (normalizeRole(target.role) === ROLES.SUPER_ADMIN) return res.status(403).json({ error: 'Super Admin cannot be deleted.' });

  try {
    await db('users').where({ id: target.id }).del();
    await logAudit(db, { actorUserId: req.user.id, action: 'USER_DELETED', entityType: 'user', entityId: target.id, before: target, ipAddress: req.ip });
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') { // PostgreSQL foreign_key_violation
      return res.status(409).json({ error: 'This user has recorded data and cannot be deleted. Please Disable their account instead to revoke access.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

const { sendMail } = require('../lib/mailer');
const crypto = require('crypto');

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const user = await db('users').where('email', String(email).toLowerCase().trim()).first();
  if (!user || !user.active) {
    // Return 200 to prevent email enumeration, but do nothing
    return res.json({ message: 'If that email exists, an OTP has been sent.' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otp_hash = await bcrypt.hash(otp, 10);
  
  // Expires in 10 minutes
  const expires_at = new Date(Date.now() + 10 * 60000);

  await db('password_resets').insert({
    email: user.email,
    otp_hash,
    expires_at
  });

  try {
    await sendMail({
      to: user.email,
      subject: 'Account Payroll - Password Reset OTP',
      text: `Your OTP for password reset is: ${otp}. It expires in 10 minutes.`,
      html: `<p>Your OTP for password reset is: <b>${otp}</b></p><p>It expires in 10 minutes.</p>`
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send OTP email.' });
  }

  res.json({ message: 'If that email exists, an OTP has been sent.' });
});

router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

  const record = await db('password_resets')
    .where('email', String(email).toLowerCase().trim())
    .where('used', false)
    .where('expires_at', '>', db.fn.now())
    .orderBy('created_at', 'desc')
    .first();

  if (!record) return res.status(400).json({ error: 'Invalid or expired OTP.' });

  const valid = await bcrypt.compare(String(otp), record.otp_hash);
  if (!valid) return res.status(400).json({ error: 'Invalid or expired OTP.' });

  // Generate a short-lived temporary token for resetting password
  const resetToken = crypto.randomBytes(32).toString('hex');
  await db('password_resets').where({ id: record.id }).update({ used: true, otp_hash: resetToken }); // Store resetToken securely in place of OTP

  res.json({ resetToken });
});

router.post('/reset-password', async (req, res) => {
  const { email, resetToken, newPassword } = req.body || {};
  if (!email || !resetToken || !newPassword) return res.status(400).json({ error: 'Missing required fields' });

  const record = await db('password_resets')
    .where('email', String(email).toLowerCase().trim())
    .where('used', true) // It was marked used by verify-otp
    .where('otp_hash', resetToken) // We temporarily stored the reset token here
    .orderBy('created_at', 'desc')
    .first();

  if (!record) return res.status(400).json({ error: 'Invalid reset token.' });

  const password_hash = await bcrypt.hash(newPassword, 12);
  await db('users').where('email', record.email).update({ password_hash });
  
  // Burn the token
  await db('password_resets').where({ id: record.id }).update({ otp_hash: 'burned' });

  res.json({ message: 'Password has been reset successfully.' });
});

module.exports = router;
