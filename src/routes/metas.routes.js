const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { registrarSync } = require('../utils/sync');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const usuarioId = req.query.usuario_id || req.usuario.id;
    const { rows } = await pool.query(
      'SELECT * FROM metas WHERE usuario_id = $1 AND eliminado = FALSE ORDER BY creado_en DESC',
      [usuarioId]
    );
    // Mostrar monto faltante (sección 15)
    const conFaltante = rows.map((m) => ({
      ...m,
      monto_faltante: Math.max(0, Number(m.monto_objetivo) - Number(m.monto_actual)),
    }));
    res.json(conFaltante);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { nombre, monto_objetivo, fecha_limite, client_uuid, dispositivo_id } = req.body;
    if (!nombre || monto_objetivo === undefined) {
      return res.status(400).json({ error: 'nombre y monto_objetivo son requeridos' });
    }
    const { rows } = await pool.query(
      `INSERT INTO metas (usuario_id, nombre, monto_objetivo, fecha_limite, client_uuid)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.usuario.id, nombre, monto_objetivo, fecha_limite || null, client_uuid || null]
    );

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'metas',
      clientUuid: client_uuid, operacion: 'insert',
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { nombre, monto_objetivo, monto_actual, fecha_limite, activa, dispositivo_id } = req.body;
    const { rows } = await pool.query(
      `UPDATE metas SET nombre=COALESCE($1,nombre), monto_objetivo=COALESCE($2,monto_objetivo),
        monto_actual=COALESCE($3,monto_actual), fecha_limite=COALESCE($4,fecha_limite),
        activa=COALESCE($5,activa), actualizado_en=now()
       WHERE id=$6 RETURNING *`,
      [nombre, monto_objetivo, monto_actual, fecha_limite, activa, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Meta no encontrada' });

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'metas',
      clientUuid: rows[0].client_uuid, operacion: 'update',
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
