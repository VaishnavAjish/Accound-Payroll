exports.up = async function (knex) {
  // MPS 21: tamper-resistant, unavailable for normal editing -- no update or
  // delete route is ever defined against this table in the application.
  await knex.schema.createTable('audit_log', (t) => {
    t.increments('id').primary();
    t.integer('actor_user_id').references('id').inTable('users');
    t.string('action').notNullable();
    t.string('entity_type').notNullable();
    t.integer('entity_id');
    t.jsonb('before_data');
    t.jsonb('after_data');
    t.jsonb('metadata');
    t.string('ip_address');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.index(['entity_type', 'entity_id']);
    t.index(['actor_user_id']);
    t.index(['created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('audit_log');
};
