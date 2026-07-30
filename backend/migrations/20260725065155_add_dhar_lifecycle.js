exports.up = async function (knex) {
  await knex.schema.alterTable('dhar_entries', (t) => {
    t.string('status').notNullable().defaultTo('LOT_IN_HAND'); // LOT_IN_HAND | COMPLETED
    t.date('received_date');
    t.string('remarks');
  });

  // Backfill existing records (they were implicitly complete)
  await knex('dhar_entries').update({
    status: 'COMPLETED',
    received_date: knex.raw('issue_date')
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('dhar_entries', (t) => {
    t.dropColumn('status');
    t.dropColumn('received_date');
    t.dropColumn('remarks');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  
};
