const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function migrate() {
  const schemaPath = path.join(__dirname, '..', '..', '..', 'database', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  console.log('Ejecutando schema.sql contra la base de datos...');
  try {
    await pool.query(sql);
    console.log('Migración completada con éxito.');
  } catch (err) {
    console.error('Error ejecutando la migración:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
