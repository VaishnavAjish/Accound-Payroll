exports.up = async function (knex) {
  const hasRoughWeight = await knex.schema.hasColumn('polish_entries', 'rough_weight');
  const hasSendWeight = await knex.schema.hasColumn('polish_entries', 'send_weight');

  if (hasRoughWeight && !hasSendWeight) {
    await knex.schema.alterTable('polish_entries', (t) => {
      t.renameColumn('rough_weight', 'send_weight');
    });
  }
};

exports.down = async function (knex) {
  const hasSendWeight = await knex.schema.hasColumn('polish_entries', 'send_weight');
  const hasRoughWeight = await knex.schema.hasColumn('polish_entries', 'rough_weight');

  if (hasSendWeight && !hasRoughWeight) {
    await knex.schema.alterTable('polish_entries', (t) => {
      t.renameColumn('send_weight', 'rough_weight');
    });
  }
};
