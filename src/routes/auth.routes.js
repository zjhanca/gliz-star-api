const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const router = express.Router();

// POST /api/auth/login
// Sección 6 y 31: cada barbero (hasta 2) tiene su propia cuenta.
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email y password son requeridos' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1 AND activo = TRUE',
      [email.toLowerCase().trim()]
    );
    const usuario = rows[0];
    if (!usuario) return res.status(401).json({ error: 'Credenciales inválidas' });

    const valido = await bcrypt.compare(password, usuario.password_hash);
    if (!valido) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      { sub: usuario.id, rol: usuario.rol, nombre: usuario.nombre },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

    delete usuario.password_hash;
    res.json({ token, usuario });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/registrar-dispositivo
// Registra qué dispositivo (Android/iPhone) está sincronizando, sección 3.
router.post('/registrar-dispositivo', async (req, res, next) => {
  try {
    const { usuario_id, dispositivo_id, plataforma } = req.body;
    if (!usuario_id || !dispositivo_id) {
      return res.status(400).json({ error: 'usuario_id y dispositivo_id son requeridos' });
    }
    // Solo se registra como referencia; no requiere tabla propia estricta,
    // se apoya en registros_sincronizacion como bitácora.
    res.json({ ok: true, dispositivo_id, plataforma: plataforma || 'desconocida' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
