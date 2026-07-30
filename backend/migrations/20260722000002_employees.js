exports.up = async function (knex) {
  // MPS 15: every person has a permanent internal identity, separate from
  // the reusable business Employee Code (see employee_codes migration).
  await knex.schema.createTable('employees', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.string('grade');
    t.string('specialist');
    t.string('mobile');
    t.string('hastack');
    t.string('katora');
    t.string('dye');
    t.string('other_item');
    t.string('work_status').notNullable().defaultTo('WORKING');
    t.string('verify_status');
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('employees');
};
