const pool = require('../db/pool');

/**
 * Obtiene (o crea) el ciclo de fidelidad activo de un cliente.
 * La fidelidad está asociada al CLIENTE, no al teléfono (sección 36).
 */
async function obtenerOCrearCicloActivo(clienteId, usuarioId, client) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT * FROM fidelidad WHERE cliente_id = $1 AND estado = 'activo'
     ORDER BY ciclo_numero DESC LIMIT 1`,
    [clienteId]
  );
  if (rows[0]) return rows[0];

  const { rows: nuevo } = await db.query(
    `INSERT INTO fidelidad (cliente_id, usuario_id, ciclo_numero, progreso_actual, estado)
     VALUES ($1,$2,1,0,'activo') RETURNING *`,
    [clienteId, usuarioId || null]
  );
  return nuevo[0];
}

/**
 * Registra un corte válido en la tarjeta de fidelidad al finalizar una cita.
 * Reglas (sección 38-39):
 *  - Solo suma si la cita está 'realizada'.
 *  - No permite duplicar el mismo cita_id (UNIQUE en fidelidad_movimientos.cita_id).
 *  - No supera 8 cortes por ciclo.
 *  - 7º corte -> 25% descuento (se informa; el descuento se aplica en el comprobante).
 *  - 8º corte -> gratis; al completarlo el ciclo pasa a 'completado' y se
 *    puede iniciar uno nuevo automáticamente en 0/8.
 */
async function registrarCorte({ clienteId, citaId, usuarioId, usuarioResponsableId }, client) {
  const db = client || pool;

  const yaRegistrado = await db.query(
    'SELECT id FROM fidelidad_movimientos WHERE cita_id = $1',
    [citaId]
  );
  if (yaRegistrado.rows[0]) {
    throw Object.assign(new Error('Esta cita ya fue registrada en la fidelidad'), { status: 409 });
  }

  const ciclo = await obtenerOCrearCicloActivo(clienteId, usuarioId, db);
  if (ciclo.progreso_actual >= 8) {
    throw Object.assign(new Error('El ciclo ya alcanzó el máximo de 8 cortes'), { status: 409 });
  }

  const numeroCorte = ciclo.progreso_actual + 1;
  let beneficio = null;
  if (numeroCorte === 7) beneficio = 'descuento_25';
  if (numeroCorte === 8) beneficio = 'gratis';

  await db.query(
    `INSERT INTO fidelidad_movimientos
      (fidelidad_id, cliente_id, cita_id, usuario_id, numero_corte, beneficio_aplicado, usuario_responsable)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ciclo.id, clienteId, citaId, usuarioId || null, numeroCorte, beneficio, usuarioResponsableId]
  );

  const nuevoEstado = numeroCorte === 8 ? 'completado' : 'activo';
  const { rows: actualizado } = await db.query(
    `UPDATE fidelidad SET progreso_actual = $1, estado = $2, actualizado_en = now()
     WHERE id = $3 RETURNING *`,
    [numeroCorte, nuevoEstado, ciclo.id]
  );

  return { ciclo: actualizado[0], numeroCorte, beneficio };
}

/**
 * Restablecer fidelidad (sección 40-41): requiere doble confirmación en el
 * cliente/app; aquí se asume que ya fue confirmado dos veces por el frontend.
 */
async function restablecerFidelidad({ clienteId, usuarioQueRestablecio, motivo }, client) {
  const db = client || pool;

  const { rows: activos } = await db.query(
    `SELECT * FROM fidelidad WHERE cliente_id = $1 AND estado = 'activo'
     ORDER BY ciclo_numero DESC LIMIT 1`,
    [clienteId]
  );
  const cicloActual = activos[0];

  const progresoPerdido = cicloActual ? cicloActual.progreso_actual : 0;
  const cicloAnteriorNumero = cicloActual ? cicloActual.ciclo_numero : 0;

  if (cicloActual) {
    await db.query(
      `UPDATE fidelidad SET estado = 'restablecido', actualizado_en = now() WHERE id = $1`,
      [cicloActual.id]
    );
  }

  const nuevoCicloNumero = cicloAnteriorNumero + 1;
  const { rows: nuevo } = await db.query(
    `INSERT INTO fidelidad (cliente_id, usuario_id, ciclo_numero, progreso_actual, estado)
     VALUES ($1,$2,$3,0,'activo') RETURNING *`,
    [clienteId, cicloActual ? cicloActual.usuario_id : null, nuevoCicloNumero]
  );

  await db.query(
    `INSERT INTO fidelidad_restablecimientos
      (cliente_id, fidelidad_id_anterior, ciclo_anterior, progreso_perdido, motivo, usuario_que_restablecio, nuevo_ciclo)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [clienteId, cicloActual ? cicloActual.id : null, cicloAnteriorNumero, progresoPerdido,
      motivo || null, usuarioQueRestablecio, nuevoCicloNumero]
  );

  return nuevo[0];
}

module.exports = { obtenerOCrearCicloActivo, registrarCorte, restablecerFidelidad };
