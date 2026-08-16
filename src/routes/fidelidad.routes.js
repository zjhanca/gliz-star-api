const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { registrarSync } = require('../utils/sync');
const fidelidadService = require('../services/fidelidad.service');

const router = express.Router();
router.use(requireAuth);

// GET /api/fidelidad/cliente/:clienteId — tarjeta virtual actual (sección 37)
router.get('/cliente/:clienteId', async (req, res, next) => {
  try {
    const ciclo = await fidelidadService.obtenerOCrearCicloActivo(req.params.clienteId, null);
    const movimientos = await pool.query(
      'SELECT * FROM fidelidad_movimientos WHERE fidelidad_id = $1 ORDER BY numero_corte ASC',
      [ciclo.id]
    );

    const proximoBeneficio = ciclo.progreso_actual >= 8
      ? null
      : ciclo.progreso_actual === 6 ? '7º corte: 25% de descuento'
      : ciclo.progreso_actual === 7 ? '8º corte: gratis'
      : `Faltan ${7 - ciclo.progreso_actual} cortes para el 25% de descuento`;

    res.json({
      progreso: ciclo.progreso_actual,
      total_espacios: 8,
      ciclo_numero: ciclo.ciclo_numero,
      estado: ciclo.estado,
      proximo_beneficio: proximoBeneficio,
      movimientos: movimientos.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/fidelidad/cliente/:clienteId/historial — ciclos anteriores (sección 44)
router.get('/cliente/:clienteId/historial', async (req, res, next) => {
  try {
    const ciclos = await pool.query(
      'SELECT * FROM fidelidad WHERE cliente_id = $1 ORDER BY ciclo_numero DESC',
      [req.params.clienteId]
    );
    const restablecimientos = await pool.query(
      'SELECT * FROM fidelidad_restablecimientos WHERE cliente_id = $1 ORDER BY fecha DESC',
      [req.params.clienteId]
    );
    res.json({ ciclos: ciclos.rows, restablecimientos: restablecimientos.rows });
  } catch (err) { next(err); }
});

// POST /api/fidelidad/cliente/:clienteId/restablecer
// Sección 40: el frontend ya debe haber pedido doble confirmación antes de llamar esto.
router.post('/cliente/:clienteId/restablecer', async (req, res, next) => {
  try {
    const { motivo, dispositivo_id } = req.body;
    const nuevo = await fidelidadService.restablecerFidelidad({
      clienteId: req.params.clienteId,
      usuarioQueRestablecio: req.usuario.id,
      motivo,
    });

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'fidelidad',
      clientUuid: nuevo.client_uuid, operacion: 'update',
    });

    res.json(nuevo);
  } catch (err) { next(err); }
});

module.exports = router;
