exports.up = async function (knex) {
  // MPS 4, 5, 7: Lot in Hand is one continuous record (status LOT_IN_HAND)
  // that carries forward at period close without duplication -- there is no
  // per-month copy, just this one row whose payable_period_id is only set
  // once the work is officially submitted as payable-complete (MPS 3.4).
  await knex.schema.createTable('polish_entries', (t) => {
    t.increments('id').primary(); // permanent internal Entry ID (MPS 7)
    t.integer('employee_id').notNullable().references('id').inTable('employees');
    t.string('status').notNullable().defaultTo('LOT_IN_HAND');
    // DRAFT | LOT_IN_HAND | COMPLETED | TRANSFERRED

    // Issue-stage fields (MPS 5.1)
    t.date('issue_date').notNullable();
    t.time('issue_time');
    t.string('lot_id'); // MPS 7: not globally unique, Entry ID is the identity
    t.string('lot_name');
    t.integer('qty');
    t.string('shape').notNullable();
    t.decimal('send_weight', 10, 2).notNullable();
    t.decimal('estimate_weight', 10, 2);
    t.string('labour_head').notNullable();

    // Completion-stage fields (MPS 5.1)
    t.date('received_date');
    t.time('received_time');
    t.decimal('polished_weight', 10, 2);
    t.string('color');
    t.string('shade');
    t.string('clarity');
    t.string('cut_pol_sym');
    t.string('grader');
    t.string('stone_level');
    t.string('lab_name');
    t.text('remarks');

    // Calculated fields (MPS 5.1, 5.3)
    t.integer('payable_period_id').references('id').inTable('periods');
    t.string('rate_category'); // ROUND_OEB | FANCY_IGI | FANCY_GIA, snapshot
    t.decimal('rate_snapshot', 12, 2); // the rate actually applied
    t.decimal('calculated_salary', 14, 2);
    t.boolean('rate_missing').notNullable().defaultTo(false);

    // MPS 7: rework / physical reassignment linkage
    t.integer('reassigned_from_entry_id').references('id').inTable('polish_entries');
    t.text('reassignment_reason');

    t.integer('created_by').references('id').inTable('users');
    t.integer('updated_by').references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.index(['employee_id']);
    t.index(['status']);
    t.index(['payable_period_id']);
    t.index(['issue_date']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('polish_entries');
};
