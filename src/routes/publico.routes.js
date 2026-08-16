const express = require('express');
const pool = require('../db/pool');

const router = express.Router();
// SIN requireAuth: esta es la única parte de la API que la web pública
// consume. Nunca exponer clientes, direcciones ni finanzas aquí (sección 6, 17).

// GET /api/publico/barberos — perfiles públicos (sección 32, 34)
router.get('/barberos', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre_publico, bio_publica, foto_perfil_url, logo_url
       FROM usuarios WHERE activo = TRUE ORDER BY creado_en ASC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/publico/servicios?usuario_id= — servicios y precios (sección 18, 32)
router.get('/servicios', async (req, res, next) => {
  try {
    const { usuario_id } = req.query;
    const params = [];
    let where = 'WHERE s.activo = TRUE AND s.eliminado = FALSE';
    if (usuario_id) { params.push(usuario_id); where += ` AND s.usuario_id = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT s.id, s.nombre, s.descripcion, s.precio, s.categoria, s.duracion_minutos,
              s.usuario_id, u.nombre_publico AS barbero
       FROM servicios s JOIN usuarios u ON u.id = s.usuario_id
       ${where} ORDER BY s.orden ASC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/publico/galeria?usuario_id= — fotos públicas (sección 13, 18, 32)
router.get('/galeria', async (req, res, next) => {
  try {
    const { usuario_id } = req.query;
    const params = [];
    let where = 'WHERE f.publica = TRUE';
    if (usuario_id) { params.push(usuario_id); where += ` AND f.usuario_id = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT f.id, f.url, f.tipo, f.usuario_id, u.nombre_publico AS barbero
       FROM fotos f JOIN usuarios u ON u.id = f.usuario_id
       ${where} ORDER BY f.creado_en DESC LIMIT 60`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/publico/resenas?usuario_id= — reseñas aprobadas + promedio (sección 18, 32, 42)
router.get('/resenas', async (req, res, next) => {
  try {
    const { usuario_id } = req.query;
    const params = [];
    let where = 'WHERE r.publicada = TRUE';
    if (usuario_id) { params.push(usuario_id); where += ` AND r.usuario_id = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT r.id, r.puntuacion, r.comentario, r.creado_en, r.usuario_id,
              u.nombre_publico AS barbero,
              LEFT(cl.nombre, 1) || '.' AS cliente_inicial
       FROM resenas r
       JOIN usuarios u ON u.id = r.usuario_id
       JOIN clientes cl ON cl.id = r.cliente_id
       ${where} ORDER BY r.creado_en DESC LIMIT 100`,
      params
    );

    const promedio = await pool.query(
      `SELECT usuario_id, ROUND(AVG(puntuacion)::numeric,2)::float AS promedio, COUNT(*)::int AS cantidad
       FROM resenas WHERE publicada = TRUE ${usuario_id ? 'AND usuario_id = $1' : ''}
       GROUP BY usuario_id`,
      usuario_id ? [usuario_id] : []
    );

    res.json({ resenas: rows, promedios: promedio.rows });
  } catch (err) { next(err); }
});

module.exports = router;
