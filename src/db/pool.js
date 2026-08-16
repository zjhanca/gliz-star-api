const { Pool } = require('pg');
require('dotenv').config();

// La API es el ÚNICO componente que se conecta a PostgreSQL.
// Ni la app Flutter ni la web pública deben tener credenciales de PostgreSQL.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Error inesperado en el pool de PostgreSQL', err);
});

module.exports = pool;
