require('dotenv').config();

// pg's default DATE parser builds a JS Date at local-midnight and then
// JSON.stringify always renders it back out in UTC -- on any server whose
// timezone isn't UTC that silently shifts issue_date/received_date/etc by a
// day. Since a DATE column has no time-of-day meaning, return it as the
// plain 'YYYY-MM-DD' string Postgres already gives us instead of parsing it
// into a Date at all. This matters a lot here: MPS 3.2-3.4 hinge on exact
// calendar-day comparisons for rate versioning and payable-period
// assignment, so an off-by-one date bug would be a real payroll bug, not
// just a display glitch.
const { types } = require('pg');
types.setTypeParser(1082 /* date */, (val) => val);

function buildConnection(url) {
  // Supabase / hosted Postgres require an SSL connection.
  if (url && (url.includes('supabase') || process.env.DB_SSL === 'true')) {
    return { connectionString: url, ssl: { rejectUnauthorized: false } };
  }
  return url;
}

const localUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_DATABASE_URL;

const knex = require('knex')({
  client: 'pg',
  connection: buildConnection(localUrl),
  useNullAsDefault: true,
});

// Optional mirror connection. When SUPABASE_DATABASE_URL is set, writes to the
// local DB are replicated to Supabase so other PCs can read from it.
if (supabaseUrl) {
  knex.supabaseDb = require('knex')({
    client: 'pg',
    connection: buildConnection(supabaseUrl),
    useNullAsDefault: true,
  });
}

module.exports = knex;
