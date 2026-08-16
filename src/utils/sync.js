const pool = require('../db/pool');

/**
 * Registra un movimiento en la bitácora de sincronización.
 * Sección 3 y 22: cada cambio offline se guarda con ID único, timestamp,
 * y se resuelve por cola + estrategia de "el más reciente gana"
 * salvo los casos con reglas de negocio propias (ej. fidelidad).
 */
async function registrarSync({ usuarioId, dispositivoId, tabla, clientUuid, operacion, payload }) {
  await pool.query(
    `INSERT INTO registros_sincronizacion
      (usuario_id, dispositivo_id, tabla, registro_client_uuid, operacion, estado, payload)
     VALUES ($1,$2,$3,$4,$5,'aplicado',$6)`,
    [usuarioId, dispositivoId || 'desconocido', tabla, clientUuid, operacion, payload || null]
  );
}

module.exports = { registrarSync };
