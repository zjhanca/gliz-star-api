const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function migrate() {
  const rutaSql = path.join(__dirname, '..', '..', '..', 'database', 'migration_002_compras.sql');
  const sql = fs.readFileSync(rutaSql, 'utf8');
  console.log('Ejecutando migration_002_compras.sql...');
  try {
    await pool.query(sql);
    console.log('Migración de "Mis compras" completada con éxito.');
  } catch (err) {
    console.error('Error ejecutando la migración:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();