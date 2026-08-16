const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Tablas sincronizables y su columna de "última actualización"
const TABLAS_SYNC = {
  clientes: 'actualizado_en',
  servicios: 'actualizado_en',
  citas: 'actualizado_en',
  metodos_pago: 'actualizado_en',
  resenas: 'actualizado_en',
  metas: 'actualizado_en',
  fidelidad: 'actualizado_en',
};

// GET /api/sync/cambios?desde=ISO_TIMESTAMP
// El dispositivo pide todo lo que cambió desde su último "pull" exitoso.
// Devuelve 🟢/🟠/🔴 lo resuelve el cliente según si esta llamada tuvo éxito.
router.get('/cambios', async (req, res, next) => {
  try {
    const desde = req.query.desde || '1970-01-01T00:00:00Z';
    const usuarioId = req.usuario.id;
    const resultado = {};

    for (const [tabla, columna] of Object.entries(TABLAS_SYNC)) {
      const tieneUsuarioId = tabla !== 'fidelidad' ? true : true; // todas tienen usuario_id o cliente asociado
      const query = tabla === 'fidelidad'
        ? `SELECT f.* FROM fidelidad f
           JOIN clientes c ON c.id = f.cliente_id
           WHERE f.${columna} > $1 ORDER BY f.${columna} ASC LIMIT 500`
        : `SELECT * FROM ${tabla} WHERE usuario_id = $2 AND ${columna} > $1 ORDER BY ${columna} ASC LIMIT 500`;

      const params = tabla === 'fidelidad' ? [desde] : [desde, usuarioId];
      const { rows } = await pool.query(query, params);
      resultado[tabla] = rows;
    }

    resultado.servidor_timestamp = new Date().toISOString();
    res.json(resultado);
  } catch (err) { next(err); }
});

// GET /api/sync/estado — últimos registros de sincronización (para mostrar 🟢🟠🔴 en la UI)
router.get('/estado', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT tabla, estado, COUNT(*)::int AS cantidad, MAX(creado_en) AS ultima
       FROM registros_sincronizacion WHERE usuario_id = $1
       GROUP BY tabla, estado ORDER BY tabla`,
      [req.usuario.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
