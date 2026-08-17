const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { registrarSync } = require('../utils/sync');

const router = express.Router();
router.use(requireAuth);

// GET /api/finanzas/resumen?desde=&hasta=  (sección 15)
router.get('/resumen', async (req, res, next) => {
  try {
    const usuarioId = req.query.usuario_id || req.usuario.id;
    const desde = req.query.desde || '1970-01-01';
    const hasta = req.query.hasta || '2999-12-31';

    const ingresos = await pool.query(
      `SELECT COALESCE(SUM(total),0)::float AS total, COUNT(*)::int AS servicios
       FROM citas WHERE usuario_id = $1 AND estado = 'realizada' AND fecha BETWEEN $2 AND $3`,
      [usuarioId, desde, hasta]
    );
    const gastos = await pool.query(
      `SELECT COALESCE(SUM(monto),0)::float AS total FROM gastos
       WHERE usuario_id = $1 AND eliminado = FALSE AND fecha BETWEEN $2 AND $3`,
      [usuarioId, desde, hasta]
    );

    const totalIngresos = ingresos.rows[0].total;
    const totalServicios = ingresos.rows[0].servicios;
    const totalGastos = gastos.rows[0].total;

    res.json({
      ingresos: totalIngresos,
      gastos: totalGastos,
      resultado_neto: Math.round((totalIngresos - totalGastos) * 100) / 100,
      numero_servicios: totalServicios,
      promedio_por_cita: totalServicios ? Math.round((totalIngresos / totalServicios) * 100) / 100 : 0,
    });
  } catch (err) { next(err); }
});

// GET /api/gastos
router.get('/gastos', async (req, res, next) => {
  try {
    const usuarioId = req.query.usuario_id || req.usuario.id;
    const { rows } = await pool.query(
      'SELECT * FROM gastos WHERE usuario_id = $1 AND eliminado = FALSE ORDER BY fecha DESC',
      [usuarioId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/gastos
router.post('/gastos', async (req, res, next) => {
  try {
    const { concepto, categoria, monto, fecha, notas, client_uuid, dispositivo_id } = req.body;
    if (!concepto || monto === undefined || !fecha) {
      return res.status(400).json({ error: 'concepto, monto y fecha son requeridos' });
    }
    const { rows } = await pool.query(
      `INSERT INTO gastos (usuario_id, concepto, categoria, monto, fecha, notas, client_uuid)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.usuario.id, concepto, categoria || null, monto, fecha, notas || null, client_uuid || null]
    );

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'gastos',
      clientUuid: client_uuid, operacion: 'insert',
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/finanzas/gastos/:id — borrado lógico (no borra el histórico)
router.delete('/gastos/:id', async (req, res, next) => {
  try {
    const { dispositivo_id } = req.body || {};
    const { rows } = await pool.query(
      'UPDATE gastos SET eliminado = TRUE WHERE id = $1 AND usuario_id = $2 RETURNING id, client_uuid',
      [req.params.id, req.usuario.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Gasto no encontrado' });

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'gastos',
      clientUuid: rows[0].client_uuid, operacion: 'delete',
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;