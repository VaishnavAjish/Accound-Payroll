exports.up = async function (knex) {
  await knex.schema.createTable('dhar_entries', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').notNullable().references('id').inTable('employees');
    t.date('issue_date').notNullable();
    t.string('lot_id');
    t.string('lot_name');
    t.decimal('weight', 10, 2).notNullable();
    t.string('shape_classification').notNullable(); // ALL_SHAPE | ROUND
    t.string('weight_slab').notNullable(); // LT_2 | GTE_2 (derived, MPS 8)

    t.integer('payable_period_id').references('id').inTable('periods');
    t.decimal('rate_snapshot', 12, 2);
    t.decimal('calculated_salary', 14, 2);
    t.boolean('rate_missing').notNullable().defaultTo(false);

    t.integer('created_by').references('id').inTable('users');
    t.integer('updated_by').references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.index(['employee_id']);
    t.index(['payable_period_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('dhar_entries');
};
