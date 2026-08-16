const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Sección 2, 13, 21, 27: la app/web nunca acceden directamente a PostgreSQL
// ni guardan las imágenes ahí; PostgreSQL solo guarda metadatos y URLs.
// Este módulo abstrae el almacenamiento para poder cambiar de proveedor
// (local -> S3 / Cloudinary / Supabase Storage) sin tocar las rutas.

const driver = process.env.STORAGE_DRIVER || 'local';
const localPath = process.env.STORAGE_LOCAL_PATH || './uploads';
const publicBaseUrl = process.env.STORAGE_PUBLIC_BASE_URL || 'http://localhost:3000/uploads';

if (driver === 'local' && !fs.existsSync(localPath)) {
  fs.mkdirSync(localPath, { recursive: true });
}

async function guardarArchivo(buffer, extensionOriginal, carpeta = 'general') {
  if (driver !== 'local') {
    throw new Error(`Driver de almacenamiento '${driver}' no implementado en este ejemplo. `
      + 'Agregar aquí la integración con el proveedor elegido (S3/Cloudinary/Supabase).');
  }

  const carpetaDestino = path.join(localPath, carpeta);
  if (!fs.existsSync(carpetaDestino)) fs.mkdirSync(carpetaDestino, { recursive: true });

  const nombreArchivo = `${uuidv4()}${extensionOriginal}`;
  const rutaCompleta = path.join(carpetaDestino, nombreArchivo);
  fs.writeFileSync(rutaCompleta, buffer);

  return `${publicBaseUrl}/${carpeta}/${nombreArchivo}`;
}

module.exports = { guardarArchivo };
