require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const clientesRoutes = require('./routes/clientes.routes');
const serviciosRoutes = require('./routes/servicios.routes');
const citasRoutes = require('./routes/citas.routes');
const resenasRoutes = require('./routes/resenas.routes');
const fotosRoutes = require('./routes/fotos.routes');
const metodosPagoRoutes = require('./routes/metodosPago.routes');
const fidelidadRoutes = require('./routes/fidelidad.routes');
const finanzasRoutes = require('./routes/finanzas.routes');
const metasRoutes = require('./routes/metas.routes');
const syncRoutes = require('./routes/sync.routes');
const publicoRoutes = require('./routes/publico.routes');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Archivos servidos localmente (fotos/QR) cuando STORAGE_DRIVER=local
app.use('/uploads', express.static(path.join(__dirname, '..', process.env.STORAGE_LOCAL_PATH || 'uploads')));

// --- Rutas privadas (requieren token, usadas por la app Flutter) ---
app.use('/api/auth', authRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/servicios', serviciosRoutes);
app.use('/api/citas', citasRoutes);
app.use('/api/resenas', resenasRoutes);
app.use('/api/fotos', fotosRoutes);
app.use('/api/metodos-pago', metodosPagoRoutes);
app.use('/api/fidelidad', fidelidadRoutes);
app.use('/api/finanzas', finanzasRoutes);
app.use('/api/metas', metasRoutes);
app.use('/api/sync', syncRoutes);

// --- Rutas públicas (usadas por la web informativa, sin login) ---
app.use('/api/publico', publicoRoutes);

app.get('/api/salud', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Manejador de errores centralizado
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API Gliz Star escuchando en el puerto ${PORT}`);
});

module.exports = app;
