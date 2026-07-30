exports.up = async function (knex) {
  // MPS 15: Employee Code is a reusable business identifier, independent of
  // the permanent internal employee identity. Only one employee may hold a
  // given code at a time (enforced by the partial unique index below); prior
  // holders remain in history via released_at.
  await knex.schema.createTable('employee_codes', (t) => {
    t.increments('id').primary();
    t.string('code').notNullable();
    t.integer('employee_id').notNullable().references('id').inTable('employees');
    t.timestamp('assigned_at').notNullable().defaultTo(knex.fn.now());
    t.integer('assigned_by').unsigned();
    t.timestamp('released_at');
    t.integer('released_by').unsigned();
  });

  // Only one row per code may have released_at IS NULL at a time, i.e. only
  // one active holder of a given code at any moment.
  await knex.raw(`
    CREATE UNIQUE INDEX employee_codes_active_code_unique
    ON employee_codes (code)
    WHERE released_at IS NULL
  `);

  await knex.raw('CREATE INDEX employee_codes_employee_id_idx ON employee_codes (employee_id)');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('employee_codes');
};
