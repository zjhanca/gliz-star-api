const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { registrarSync } = require('../utils/sync');

const router = express.Router();
router.use(requireAuth);

// GET /api/compras — pendientes primero, luego comprados más recientes
router.get('/', async (req, res, next) => {
  try {
    const usuarioId = req.query.usuario_id || req.usuario.id;
    const { rows } = await pool.query(
      `SELECT * FROM compras WHERE usuario_id = $1 AND eliminado = FALSE
       ORDER BY comprado ASC, creado_en DESC`,
      [usuarioId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/compras — agregar un producto a la lista
router.post('/', async (req, res, next) => {
  try {
    const { nombre, precio_estimado, link, notas, client_uuid, dispositivo_id } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });

    const { rows } = await pool.query(
      `INSERT INTO compras (usuario_id, nombre, precio_estimado, link, notas, client_uuid)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (client_uuid) DO UPDATE SET
         nombre = EXCLUDED.nombre, precio_estimado = EXCLUDED.precio_estimado,
         link = EXCLUDED.link, notas = EXCLUDED.notas, actualizado_en = now()
       RETURNING *`,
      [req.usuario.id, nombre, precio_estimado || null, link || null, notas || null, client_uuid || null]
    );

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'compras',
      clientUuid: client_uuid, operacion: 'insert',
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/compras/:id/comprar — marcar como comprado: si origen_dinero es
// 'meta', también descuenta de esa meta aquí en el servidor, para que quede
// consistente aunque sincronicen varios dispositivos. Es seguro llamarla más
// de una vez sobre el mismo producto (ej. reintentos de sincronización): si
// ya estaba comprado con cargo a una meta, primero se le devuelve ese monto
// antes de aplicar el nuevo, y se valida que la meta tenga fondos.
router.put('/:id/comprar', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { origen_dinero, meta_id, monto_real } = req.body;
    if (!origen_dinero || monto_real === undefined) {
      return res.status(400).json({ error: 'origen_dinero y monto_real son requeridos' });
    }

    await client.query('BEGIN');

    const { rows: actualRows } = await client.query(
      'SELECT * FROM compras WHERE id = $1 AND usuario_id = $2 FOR UPDATE',
      [req.params.id, req.usuario.id]
    );
    if (!actualRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    const actual = actualRows[0];

    // Si ya estaba comprado con cargo a una meta, se le devuelve el monto
    // anterior antes de aplicar el nuevo (evita doble descuento).
    if (actual.comprado && actual.origen_dinero === 'meta' && actual.meta_id && actual.monto_real) {
      await client.query(
        `UPDATE metas SET monto_actual = monto_actual + $1, actualizado_en = now()
         WHERE id = $2 AND usuario_id = $3`,
        [actual.monto_real, actual.meta_id, req.usuario.id]
      );
    }

    if (origen_dinero === 'meta' && meta_id) {
      const { rows: metaRows } = await client.query(
        'SELECT monto_actual FROM metas WHERE id = $1 AND usuario_id = $2 FOR UPDATE',
        [meta_id, req.usuario.id]
      );
      const disponible = metaRows[0] ? Number(metaRows[0].monto_actual) : 0;
      if (disponible < Number(monto_real)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Esa meta no tiene ${monto_real} disponibles (tiene ${disponible}).` });
      }
    }

    const { rows } = await client.query(
      `UPDATE compras SET comprado = TRUE, fecha_compra = now(),
        origen_dinero = $1, meta_id = $2, monto_real = $3, actualizado_en = now()
       WHERE id = $4 AND usuario_id = $5 RETURNING *`,
      [origen_dinero, origen_dinero === 'meta' ? (meta_id || null) : null, monto_real, req.params.id, req.usuario.id]
    );

    if (origen_dinero === 'meta' && meta_id) {
      await client.query(
        `UPDATE metas SET monto_actual = GREATEST(0, monto_actual - $1), actualizado_en = now()
         WHERE id = $2 AND usuario_id = $3`,
        [monto_real, meta_id, req.usuario.id]
      );
    }

    await client.query('COMMIT');

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: req.body.dispositivo_id, tabla: 'compras',
      clientUuid: rows[0].client_uuid, operacion: 'update',
    });

    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/compras/:id — quitar de la lista (borrado lógico)
router.delete('/:id', async (req, res, next) => {
  try {
    const { dispositivo_id } = req.body || {};
    const { rows } = await pool.query(
      'UPDATE compras SET eliminado = TRUE WHERE id = $1 AND usuario_id = $2 RETURNING id, client_uuid',
      [req.params.id, req.usuario.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'compras',
      clientUuid: rows[0].client_uuid, operacion: 'delete',
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;