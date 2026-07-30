exports.up = async function (knex) {
  // MPS 16: Root Admin (exactly one, permanent), Manager, Accounts, Employee.
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('email').notNullable().unique();
    t.string('password_hash').notNullable();
    t.string('name').notNullable();
    t.string('role').notNullable(); // ROOT_ADMIN | MANAGER | ACCOUNTS | EMPLOYEE
    t.integer('employee_id').references('id').inTable('employees'); // set when role = EMPLOYEE
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // MPS 16: "Exactly one permanent [Root Admin] account". Enforced at the DB
  // level with a partial unique index so it can never be bypassed by a bug
  // in application code.
  await knex.raw(`
    CREATE UNIQUE INDEX users_single_root_admin
    ON users ((role))
    WHERE role = 'ROOT_ADMIN'
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('users');
};
