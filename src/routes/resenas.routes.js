const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { registrarSync } = require('../utils/sync');

const router = express.Router();
router.use(requireAuth);

// POST /api/resenas — el cliente califica al finalizar (pantalla temporal en el teléfono)
router.post('/', async (req, res, next) => {
  try {
    const { cita_id, cliente_id, usuario_id, puntuacion, comentario, client_uuid, dispositivo_id } = req.body;
    if (!cita_id || !cliente_id || !usuario_id || !puntuacion) {
      return res.status(400).json({ error: 'cita_id, cliente_id, usuario_id y puntuacion son requeridos' });
    }
    if (puntuacion < 1 || puntuacion > 5) {
      return res.status(400).json({ error: 'La puntuación debe estar entre 1 y 5' });
    }

    const { rows } = await pool.query(
      `INSERT INTO resenas (cita_id, cliente_id, usuario_id, puntuacion, comentario, publicada, client_uuid)
       VALUES ($1,$2,$3,$4,$5,FALSE,$6)
       ON CONFLICT (client_uuid) DO UPDATE SET
         puntuacion=EXCLUDED.puntuacion, comentario=EXCLUDED.comentario, actualizado_en=now()
       RETURNING *`,
      [cita_id, cliente_id, usuario_id, puntuacion, comentario || null, client_uuid || null]
    );

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'resenas',
      clientUuid: client_uuid, operacion: 'insert',
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/resenas — pendientes/publicadas del usuario (para el perfil, sección 16)
router.get('/', async (req, res, next) => {
  try {
    const usuarioId = req.query.usuario_id || req.usuario.id;
    const { publicada } = req.query;
    const params = [usuarioId];
    let where = 'WHERE r.usuario_id = $1';
    if (publicada !== undefined) { params.push(publicada === 'true'); where += ` AND r.publicada = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT r.*, cl.nombre AS cliente_nombre FROM resenas r
       JOIN clientes cl ON cl.id = r.cliente_id ${where} ORDER BY r.creado_en DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// PUT /api/resenas/:id/publicar — el administrador decide publicar u ocultar
router.put('/:id/publicar', async (req, res, next) => {
  try {
    const { publicada } = req.body;
    const { rows } = await pool.query(
      'UPDATE resenas SET publicada = $1, actualizado_en = now() WHERE id = $2 RETURNING *',
      [!!publicada, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Reseña no encontrada' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
