exports.up = async function (knex) {
  // Convert existing MANAGER to POLISH_MANAGER
  await knex('users')
    .where('role', 'MANAGER')
    .update({ role: 'POLISH_MANAGER' });
};

exports.down = async function (knex) {
  // We cannot reliably determine which were originally MANAGER,
  // but if rolling back, we can convert POLISH_MANAGER and DHAR_MANAGER back to MANAGER.
  await knex('users')
    .whereIn('role', ['POLISH_MANAGER', 'DHAR_MANAGER'])
    .update({ role: 'MANAGER' });
};
