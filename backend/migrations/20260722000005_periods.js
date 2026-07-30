exports.up = async function (knex) {
  // MPS 3.6: Accounts open/close periods; Root Admin has override/reopen
  // authority; Managers can only work in already-open periods. Multiple
  // periods may be open at once; "latest open" is derived by start_date,
  // not stored redundantly.
  await knex.schema.createTable('periods', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable().unique(); // e.g. "2026-07"
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.string('status').notNullable().defaultTo('OPEN'); // OPEN | CLOSED
    t.integer('opened_by').references('id').inTable('users');
    t.integer('closed_by').references('id').inTable('users');
    t.timestamp('closed_at');
    t.integer('reopened_by').references('id').inTable('users');
    t.timestamp('reopened_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('periods');
};
