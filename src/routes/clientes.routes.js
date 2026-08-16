const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { registrarSync } = require('../utils/sync');

const router = express.Router();
router.use(requireAuth);

// GET /api/clientes  — lista (sección 8)
router.get('/', async (req, res, next) => {
  try {
    const { q } = req.query;
    const params = [];
    let where = 'WHERE eliminado = FALSE';
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (nombre ILIKE $${params.length} OR telefono ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT * FROM clientes ${where} ORDER BY nombre ASC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/clientes/:id  — con historial, última y próxima cita
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Cliente no encontrado' });

    const historial = await pool.query(
      `SELECT c.*, u.nombre AS barbero_nombre
       FROM citas c JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.cliente_id = $1 AND c.eliminado = FALSE
       ORDER BY c.fecha DESC, c.hora DESC`,
      [req.params.id]
    );

    res.json({ ...rows[0], historial: historial.rows });
  } catch (err) { next(err); }
});

// POST /api/clientes — crear (o sincronizar creación offline)
router.post('/', async (req, res, next) => {
  try {
    const { nombre, telefono, direccion, referencia, notas, client_uuid, dispositivo_id } = req.body;
    if (!nombre || !telefono) {
      return res.status(400).json({ error: 'nombre y telefono son requeridos' });
    }

    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, telefono, direccion, referencia, notas, creado_por, client_uuid)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (client_uuid) DO UPDATE SET
         nombre = EXCLUDED.nombre, telefono = EXCLUDED.telefono,
         direccion = EXCLUDED.direccion, referencia = EXCLUDED.referencia,
         notas = EXCLUDED.notas, actualizado_en = now()
       RETURNING *`,
      [nombre, telefono, direccion, referencia, notas, req.usuario.id, client_uuid || null]
    );

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'clientes',
      clientUuid: client_uuid, operacion: 'insert',
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/clientes/:id — editar
router.put('/:id', async (req, res, next) => {
  try {
    const { nombre, telefono, direccion, referencia, notas, dispositivo_id } = req.body;
    const { rows } = await pool.query(
      `UPDATE clientes SET nombre = COALESCE($1,nombre), telefono = COALESCE($2,telefono),
        direccion = COALESCE($3,direccion), referencia = COALESCE($4,referencia),
        notas = COALESCE($5,notas), actualizado_en = now()
       WHERE id = $6 RETURNING *`,
      [nombre, telefono, direccion, referencia, notas, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cliente no encontrado' });

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'clientes',
      clientUuid: rows[0].client_uuid, operacion: 'update',
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/clientes/:id — borrado lógico
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE clientes SET eliminado = TRUE, actualizado_en = now() WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
