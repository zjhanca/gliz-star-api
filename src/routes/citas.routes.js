const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { registrarSync } = require('../utils/sync');
const fidelidadService = require('../services/fidelidad.service');

const router = express.Router();
router.use(requireAuth);

// GET /api/citas?fecha=&estado=&usuario_id=  (sección 7: agenda día/semana/mes)
router.get('/', async (req, res, next) => {
  try {
    const { fecha_inicio, fecha_fin, estado, usuario_id } = req.query;
    const usuarioId = usuario_id || req.usuario.id;
    const params = [usuarioId];
    let where = 'WHERE c.usuario_id = $1 AND c.eliminado = FALSE';

    if (fecha_inicio) { params.push(fecha_inicio); where += ` AND c.fecha >= $${params.length}`; }
    if (fecha_fin) { params.push(fecha_fin); where += ` AND c.fecha <= $${params.length}`; }
    if (estado) { params.push(estado); where += ` AND c.estado = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT c.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono
       FROM citas c JOIN clientes cl ON cl.id = c.cliente_id
       ${where} ORDER BY c.fecha ASC, c.hora ASC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/citas/:id — detalle con servicios, fotos y reseña
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono
       FROM citas c JOIN clientes cl ON cl.id = c.cliente_id WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cita no encontrada' });

    const servicios = await pool.query('SELECT * FROM cita_servicios WHERE cita_id = $1', [req.params.id]);
    const fotos = await pool.query('SELECT * FROM fotos WHERE cita_id = $1 ORDER BY orden', [req.params.id]);
    const resena = await pool.query('SELECT * FROM resenas WHERE cita_id = $1', [req.params.id]);

    res.json({ ...rows[0], servicios: servicios.rows, fotos: fotos.rows, resena: resena.rows[0] || null });
  } catch (err) { next(err); }
});

// POST /api/citas — crear cita con uno o varios servicios (sección 7, 10, 24)
router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      cliente_id, fecha, hora, direccion, servicios, notas,
      client_uuid, dispositivo_id,
    } = req.body;

    if (!cliente_id || !fecha || !hora || !direccion || !Array.isArray(servicios) || servicios.length === 0) {
      return res.status(400).json({ error: 'cliente_id, fecha, hora, direccion y al menos un servicio son requeridos' });
    }

    await client.query('BEGIN');

    const total = servicios.reduce((sum, s) => sum + Number(s.precio_aplicado), 0);

    const { rows } = await client.query(
      `INSERT INTO citas (usuario_id, cliente_id, fecha, hora, direccion, estado, total, notas, client_uuid)
       VALUES ($1,$2,$3,$4,$5,'pendiente',$6,$7,$8)
       ON CONFLICT (client_uuid) DO UPDATE SET
         fecha=EXCLUDED.fecha, hora=EXCLUDED.hora, direccion=EXCLUDED.direccion,
         total=EXCLUDED.total, notas=EXCLUDED.notas, actualizado_en=now()
       RETURNING *`,
      [req.usuario.id, cliente_id, fecha, hora, direccion, total, notas || null, client_uuid || null]
    );
    const cita = rows[0];

    for (const s of servicios) {
      await client.query(
        `INSERT INTO cita_servicios (cita_id, servicio_id, usuario_id, nombre_servicio, precio_aplicado, client_uuid)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (client_uuid) DO NOTHING`,
        [cita.id, s.servicio_id, req.usuario.id, s.nombre_servicio, s.precio_aplicado, s.client_uuid || null]
      );
    }

    await client.query('COMMIT');

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'citas',
      clientUuid: client_uuid, operacion: 'insert',
    });

    res.status(201).json(cita);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// PUT /api/citas/:id/estado — confirmar/cancelar/editar estado (sección 7)
router.put('/:id/estado', async (req, res, next) => {
  try {
    const { estado, dispositivo_id } = req.body;
    if (!['pendiente', 'confirmada', 'realizada', 'cancelada'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    const { rows } = await pool.query(
      'UPDATE citas SET estado = $1, actualizado_en = now() WHERE id = $2 RETURNING *',
      [estado, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cita no encontrada' });

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'citas',
      clientUuid: rows[0].client_uuid, operacion: 'update',
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/citas/:id/finalizar
// Sección 12, 24, 39: marca la cita como realizada, aplica beneficio de
// fidelidad si el admin lo confirma, y registra el corte en la tarjeta.
router.post('/:id/finalizar', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { metodo_pago_id, metodo_pago_nombre, aplicar_beneficio_fidelidad, dispositivo_id } = req.body;

    await client.query('BEGIN');

    const { rows: citaRows } = await client.query(
      'SELECT * FROM citas WHERE id = $1 FOR UPDATE', [req.params.id]
    );
    const cita = citaRows[0];
    if (!cita) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Cita no encontrada' }); }
    if (cita.estado === 'realizada') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La cita ya fue finalizada' });
    }

    // Registrar el corte en fidelidad (sección 38: solo al finalizar)
    const resultadoFidelidad = await fidelidadService.registrarCorte({
      clienteId: cita.cliente_id,
      citaId: cita.id,
      usuarioId: cita.usuario_id,
      usuarioResponsableId: req.usuario.id,
    }, client);

    let precioOriginal = Number(cita.total);
    let descuento = 0;
    let beneficioAplicado = null;

    if (aplicar_beneficio_fidelidad && resultadoFidelidad.beneficio === 'descuento_25') {
      descuento = Math.round(precioOriginal * 0.25 * 100) / 100;
      beneficioAplicado = 'descuento_7';
    } else if (aplicar_beneficio_fidelidad && resultadoFidelidad.beneficio === 'gratis') {
      descuento = precioOriginal;
      beneficioAplicado = 'gratis_8';
    }
    const totalFinal = Math.round((precioOriginal - descuento) * 100) / 100;

    const { rows: actualizada } = await client.query(
      `UPDATE citas SET estado = 'realizada', metodo_pago_id = $1,
        metodo_pago_nombre_historico = $2, precio_original = $3,
        descuento_aplicado = $4, total = $5,
        beneficio_fidelidad_aplicado = $6, actualizado_en = now()
       WHERE id = $7 RETURNING *`,
      [metodo_pago_id || null, metodo_pago_nombre || null, precioOriginal, descuento,
        totalFinal, beneficioAplicado, cita.id]
    );

    // Comprobante (sección 14)
    const identificador = `MB-${new Date().getFullYear()}-${cita.id.slice(0, 8).toUpperCase()}`;
    const { rows: comprobante } = await client.query(
      `INSERT INTO comprobantes (cita_id, usuario_id, cliente_id, identificador, subtotal, descuento, total, metodo_pago_nombre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (cita_id) DO NOTHING RETURNING *`,
      [cita.id, cita.usuario_id, cita.cliente_id, identificador, precioOriginal, descuento, totalFinal, metodo_pago_nombre || null]
    );

    await client.query('COMMIT');

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'citas',
      clientUuid: actualizada[0].client_uuid, operacion: 'update',
    });

    res.json({
      cita: actualizada[0],
      fidelidad: resultadoFidelidad,
      comprobante: comprobante[0] || null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
