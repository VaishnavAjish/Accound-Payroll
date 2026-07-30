require('dotenv').config();

function buildConnection(url) {
  if (url && (url.includes('supabase') || process.env.DB_SSL === 'true')) {
    return { connectionString: url, ssl: { rejectUnauthorized: false } };
  }
  return url;
}

module.exports = {
  client: 'pg',
  connection: buildConnection(process.env.DATABASE_URL),
  migrations: {
    directory: './migrations',
  },
};
