const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { registrarSync } = require('../utils/sync');
const { guardarArchivo } = require('../utils/storage');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// POST /api/fotos — subir foto de un corte (sección 13: máximo 3 por cita)
router.post('/', upload.single('foto'), async (req, res, next) => {
  try {
    const { cita_id, tipo, publica, client_uuid, dispositivo_id } = req.body;
    if (!cita_id || !req.file) {
      return res.status(400).json({ error: 'cita_id y el archivo "foto" son requeridos' });
    }

    const { rows: existentes } = await pool.query(
      'SELECT COUNT(*)::int AS total FROM fotos WHERE cita_id = $1', [cita_id]
    );
    if (existentes[0].total >= 3) {
      return res.status(409).json({ error: 'Esta cita ya tiene el máximo de 3 fotos' });
    }

    const ext = path.extname(req.file.originalname) || '.jpg';
    const url = await guardarArchivo(req.file.buffer, ext, 'fotos-cortes');

    const { rows } = await pool.query(
      `INSERT INTO fotos (cita_id, usuario_id, url, tipo, publica, orden, client_uuid)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [cita_id, req.usuario.id, url, tipo || null, publica === 'true', existentes[0].total, client_uuid || null]
    );

    await registrarSync({
      usuarioId: req.usuario.id, dispositivoId: dispositivo_id, tabla: 'fotos',
      clientUuid: client_uuid, operacion: 'insert',
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/fotos/:id/publicar — el administrador decide qué se publica
router.put('/:id/publicar', async (req, res, next) => {
  try {
    const { publica } = req.body;
    const { rows } = await pool.query(
      'UPDATE fotos SET publica = $1 WHERE id = $2 RETURNING *',
      [!!publica, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Foto no encontrada' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/fotos/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM fotos WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Foto no encontrada' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
