const jwt = require('jsonwebtoken');

// Verifica el token JWT y adjunta el usuario autenticado a req.usuario
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = { id: payload.sub, rol: payload.rol, nombre: payload.nombre };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Sección 33: la API debe impedir que un usuario modifique los datos
// privados del otro, salvo permisos administrativos definidos.
// Uso: ownershipParam indica el nombre del parámetro de ruta o campo del
// body que contiene el usuario_id del recurso.
function requireOwnershipOrAdmin(getResourceUserId) {
  return async (req, res, next) => {
    try {
      if (req.usuario.rol === 'admin') return next();
      const resourceUserId = await getResourceUserId(req);
      if (resourceUserId && resourceUserId !== req.usuario.id) {
        return res.status(403).json({ error: 'No autorizado para modificar datos de otro usuario' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireAuth, requireOwnershipOrAdmin };
