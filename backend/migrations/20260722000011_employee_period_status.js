exports.up = async function (knex) {
  // MPS 13/14: verification happens at employee-month level, not per-entry.
  // Required order: CALCULATED -> MANAGER_VERIFIED -> ACCOUNTS_VERIFIED
  // (= Final Payable, immutable snapshot). Reopen resets this row through
  // the same chain again (MPS 14).
  await knex.schema.createTable('employee_period_status', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').notNullable().references('id').inTable('employees');
    t.integer('period_id').notNullable().references('id').inTable('periods');
    t.string('status').notNullable().defaultTo('CALCULATED');
    // CALCULATED | MANAGER_VERIFIED | ACCOUNTS_VERIFIED

    t.integer('manager_verified_by').references('id').inTable('users');
    t.timestamp('manager_verified_at');
    t.integer('accounts_verified_by').references('id').inTable('users');
    t.timestamp('accounts_verified_at');

    // Frozen at Accounts Final Verification; never recomputed afterward.
    t.decimal('final_snapshot_total', 14, 2);
    t.jsonb('final_snapshot_breakdown');

    t.integer('reopened_by').references('id').inTable('users');
    t.timestamp('reopened_at');
    t.text('reopen_reason');

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['employee_id', 'period_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('employee_period_status');
};
