exports.up = async function (knex) {
  const hasDepartment = await knex.schema.hasColumn('employees', 'department');
  if (!hasDepartment) {
    await knex.schema.alterTable('employees', (t) => {
      t.string('department').notNullable().defaultTo('POLISH_1');
    });
  }

  await knex.raw(`
    UPDATE users SET role = 'SUPER_ADMIN' WHERE role = 'ROOT_ADMIN';
    UPDATE users SET role = 'ACCOUNTANT' WHERE role = 'ACCOUNTS';
    UPDATE users SET role = 'POLISH_1_MANAGER' WHERE role IN ('MANAGER', 'POLISH_MANAGER', 'DHAR_MANAGER');
  `);

  await knex.raw('DROP INDEX IF EXISTS users_single_root_admin');
  await knex.raw(`
    CREATE UNIQUE INDEX users_single_super_admin
    ON users ((role))
    WHERE role = 'SUPER_ADMIN'
  `);

  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasRolePermissions) {
    await knex.schema.createTable('role_permissions', (t) => {
      t.increments('id').primary();
      t.string('role').notNullable();
      t.string('permission_key').notNullable();
      t.boolean('is_allowed').notNullable().defaultTo(false);
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['role', 'permission_key']);
    });
  }
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS users_single_super_admin');
  await knex.raw(`
    CREATE UNIQUE INDEX users_single_root_admin
    ON users ((role))
    WHERE role = 'ROOT_ADMIN'
  `);

  await knex.raw(`
    UPDATE users SET role = 'ROOT_ADMIN' WHERE role = 'SUPER_ADMIN';
    UPDATE users SET role = 'ACCOUNTS' WHERE role = 'ACCOUNTANT';
    UPDATE users SET role = 'POLISH_MANAGER' WHERE role LIKE 'POLISH_%_MANAGER';
  `);

  const hasDepartment = await knex.schema.hasColumn('employees', 'department');
  if (hasDepartment) {
    await knex.schema.alterTable('employees', (t) => {
      t.dropColumn('department');
    });
  }
};
