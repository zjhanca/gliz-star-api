const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireOwnershipOrAdmin } = require('../middleware/auth');
const { registrarSync } = require('../utils/sync');

const router = express.Router();
router.use(requireAuth);

// GET /api/servicios — propios del usuario autenticado (o todos si es admin con ?usuario_id=)
router.get('/', async (req, res, next) => {
  try {
    const usuarioId = req.query.usuario_id || req.usuario.id;
    const { rows } = await pool.query(
      `SELECT * FROM servicios WHERE usuario_id = $1 AND eliminado = FALSE
       ORDER BY orden ASC, nombre ASC`,
      [usuarioId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/servicios — crear servicio (sección 9: nada hardcodeado)
router.post('/', async (req, res, next) => {
  try {
    const { nombre, descripcion, precio, categoria, duracion_minutos, client_uuid, dispositivo_id } = req.body;
    if (!nombre || precio === undefined) {
      return res.status(400).json({ error: 'nombre y precio son requeridos' });
    }

    const { rows } = await pool.query(
      `INSERT INTO servicios (usuario_id, nombre, descripcion, precio, categoria, duracion_minutos, client_uuid)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (client_uuid) DO UPDATE SET
         nombre=EXCLUDED.nombre, descripcion=EXCLUDED.descripcion, precio=EXCLUDED.precio,
         categoria=EXCLUDED.categoria, duracion_minutos=EXCLUDED.duracion_minutos, actualizado_en=now()
       RETURNING *`,
      [req.usuario.id, nombre, descripcion, precio, categoria, duracion_minutos, client_uuid || null]
    );

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'servicios',
      clientUuid: client_uuid, operacion: 'insert',
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/servicios/:id — editar (incluye cambiar precio desde el perfil)
router.put('/:id',
  requireOwnershipOrAdmin(async (req) => {
    const { rows } = await pool.query('SELECT usuario_id FROM servicios WHERE id = $1', [req.params.id]);
    return rows[0]?.usuario_id;
  }),
  async (req, res, next) => {
    try {
      const { nombre, descripcion, precio, categoria, duracion_minutos, activo, orden, dispositivo_id } = req.body;
      const { rows } = await pool.query(
        `UPDATE servicios SET
          nombre = COALESCE($1,nombre), descripcion = COALESCE($2,descripcion),
          precio = COALESCE($3,precio), categoria = COALESCE($4,categoria),
          duracion_minutos = COALESCE($5,duracion_minutos),
          activo = COALESCE($6,activo), orden = COALESCE($7,orden), actualizado_en = now()
         WHERE id = $8 RETURNING *`,
        [nombre, descripcion, precio, categoria, duracion_minutos, activo, orden, req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Servicio no encontrado' });

      await registrarSync({
        usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'servicios',
        clientUuid: rows[0].client_uuid, operacion: 'update',
      });

      res.json(rows[0]);
    } catch (err) { next(err); }
  }
);

// DELETE /api/servicios/:id — borrado lógico
router.delete('/:id',
  requireOwnershipOrAdmin(async (req) => {
    const { rows } = await pool.query('SELECT usuario_id FROM servicios WHERE id = $1', [req.params.id]);
    return rows[0]?.usuario_id;
  }),
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        'UPDATE servicios SET eliminado = TRUE, actualizado_en = now() WHERE id = $1 RETURNING id',
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Servicio no encontrado' });
      res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

module.exports = router;
