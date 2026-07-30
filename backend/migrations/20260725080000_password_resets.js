exports.up = async function (knex) {
  await knex.schema.createTable('password_resets', (t) => {
    t.increments('id').primary();
    t.string('email').notNullable();
    t.string('otp_hash').notNullable();
    t.timestamp('expires_at').notNullable();
    t.boolean('used').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX idx_password_resets_email ON password_resets (email);
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('password_resets');
};
