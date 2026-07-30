exports.up = async function (knex) {
  // Needed for the EXCLUDE constraints on the rate tables (overlap prevention).
  await knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gist');

  await knex.schema.createTable('master_data', (t) => {
    t.increments('id').primary();
    t.string('category').notNullable();
    t.string('value').notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    // Only meaningful for category = 'SHAPE'. MPS 5.5: Round-rate shapes are
    // exactly Round and Old European Brilliant (OEB); all others are Fancy.
    t.boolean('is_round_classification').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['category', 'value']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('master_data');
};
