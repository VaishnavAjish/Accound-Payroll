exports.up = async function(knex) {
  await knex.schema.alterTable('employee_period_status', (t) => {
    t.integer('reopen_requested_by').references('id').inTable('users');
    t.timestamp('reopen_requested_at');
    t.text('reopen_request_reason');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('employee_period_status', (t) => {
    t.dropColumn('reopen_requested_by');
    t.dropColumn('reopen_requested_at');
    t.dropColumn('reopen_request_reason');
  });
};
