exports.up = async function (knex) {
  const hasIssueTime = await knex.schema.hasColumn('polish_entries', 'issue_time');
  const hasReceivedTime = await knex.schema.hasColumn('polish_entries', 'received_time');

  if (!hasIssueTime || !hasReceivedTime) {
    await knex.schema.alterTable('polish_entries', (t) => {
      if (!hasIssueTime) t.time('issue_time');
      if (!hasReceivedTime) t.time('received_time');
    });
  }
};

exports.down = async function (knex) {
  const hasIssueTime = await knex.schema.hasColumn('polish_entries', 'issue_time');
  const hasReceivedTime = await knex.schema.hasColumn('polish_entries', 'received_time');

  if (hasIssueTime || hasReceivedTime) {
    await knex.schema.alterTable('polish_entries', (t) => {
      if (hasIssueTime) t.dropColumn('issue_time');
      if (hasReceivedTime) t.dropColumn('received_time');
    });
  }
};
