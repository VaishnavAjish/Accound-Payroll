exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('fantacy_department_access');
  if (!exists) {
    await knex.schema.createTable('fantacy_department_access', (t) => {
      t.string('role').primary();
      t.specificType('departments', 'text[]').notNullable().defaultTo(knex.raw("'{}'::text[]"));
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable('fantacy_department_access');
  if (exists) await knex.schema.dropTable('fantacy_department_access');
};
