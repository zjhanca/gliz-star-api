/**
 * Uso: node src/scripts/crear_usuario.js "Nombre" email@correo.com contraseña [admin]
 * Crea un usuario/barbero directamente en la base de datos (hasta 2, sección 31).
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

async function main() {
  const [nombre, email, password, rol] = process.argv.slice(2);
  if (!nombre || !email || !password) {
    console.log('Uso: node crear_usuario.js "Nombre" email@correo.com contraseña [admin]');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, nombre_publico, rol)
     VALUES ($1,$2,$3,$1,$4) RETURNING id, nombre, email, rol`,
    [nombre, email.toLowerCase(), passwordHash, rol === 'admin' ? 'admin' : 'barbero']
  );
  console.log('Usuario creado:', rows[0]);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
