exports.up = async function (knex) {
  // MPS 9: MAXI is strictly non-payable -- notice there is deliberately no
  // rate, no calculated_salary, and no payable_period_id on this table.
  await knex.schema.createTable('maxi_entries', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').notNullable().references('id').inTable('employees');
    t.date('issue_date').notNullable();
    t.string('lot_id');
    t.string('lot_name');
    t.decimal('weight', 10, 2).notNullable();

    t.integer('created_by').references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.index(['employee_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('maxi_entries');
};
