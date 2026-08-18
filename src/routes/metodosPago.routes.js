const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { registrarSync } = require('../utils/sync');
const { guardarArchivo } = require('../utils/storage');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/metodos-pago — lista ordenada, activos primero (sección 27)
router.get('/', async (req, res, next) => {
  try {
    const usuarioId = req.query.usuario_id || req.usuario.id;
    const { rows } = await pool.query(
      `SELECT * FROM metodos_pago WHERE eliminado = FALSE AND (usuario_id = $1 OR usuario_id IS NULL)
       ORDER BY orden ASC, creado_en ASC`,
      [usuarioId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/metodos-pago — crear método con imagen QR (sección 27-28)
// Nada de nombres/imágenes hardcodeados: todo viene del body/archivo.
// Usa ON CONFLICT (upsert) para que sea seguro reintentar: si la app ya
// había logrado crearlo antes pero el teléfono no se enteró (ej. se cortó
// la conexión justo después), reintentar ya no choca contra la base de
// datos con "duplicate key" — simplemente actualiza el mismo registro.
router.post('/', upload.single('qr'), async (req, res, next) => {
  try {
    const { nombre, descripcion, orden, client_uuid, dispositivo_id } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });

    let qrUrl = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname) || '.png';
      qrUrl = await guardarArchivo(req.file.buffer, ext, 'metodos-pago');
    }

    const { rows } = await pool.query(
      `INSERT INTO metodos_pago (usuario_id, nombre, descripcion, qr_imagen_url, orden, client_uuid)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (client_uuid) DO UPDATE SET
         nombre = EXCLUDED.nombre,
         descripcion = EXCLUDED.descripcion,
         qr_imagen_url = COALESCE(EXCLUDED.qr_imagen_url, metodos_pago.qr_imagen_url),
         orden = EXCLUDED.orden,
         actualizado_en = now()
       RETURNING *`,
      [req.usuario.id, nombre, descripcion || null, qrUrl, orden || 0, client_uuid || null]
    );

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'metodos_pago',
      clientUuid: client_uuid, operacion: 'insert',
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/metodos-pago/:id — editar nombre/descripción, reemplazar QR, reordenar
router.put('/:id', upload.single('qr'), async (req, res, next) => {
  try {
    const { nombre, descripcion, orden, activo, dispositivo_id } = req.body;

    let qrUrl = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname) || '.png';
      qrUrl = await guardarArchivo(req.file.buffer, ext, 'metodos-pago');
    }

    const { rows } = await pool.query(
      `UPDATE metodos_pago SET
        nombre = COALESCE($1, nombre),
        descripcion = COALESCE($2, descripcion),
        qr_imagen_url = COALESCE($3, qr_imagen_url),
        orden = COALESCE($4, orden),
        activo = COALESCE($5, activo),
        actualizado_en = now()
       WHERE id = $6 RETURNING *`,
      [nombre, descripcion, qrUrl, orden, activo === undefined ? undefined : activo === 'true' || activo === true, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Método de pago no encontrado' });

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'metodos_pago',
      clientUuid: rows[0].client_uuid, operacion: 'update',
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/metodos-pago/:id — no borra el histórico de citas que lo usaron (sección 29)
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE metodos_pago SET eliminado = TRUE, activo = FALSE, actualizado_en = now() WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Método de pago no encontrado' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /api/metodos-pago/reordenar — body: [{id, orden}, ...]
router.put('/reordenar/todos', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { orden } = req.body; // [{id, orden}]
    await client.query('BEGIN');
    for (const item of orden) {
      await client.query('UPDATE metodos_pago SET orden = $1 WHERE id = $2', [item.orden, item.id]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;