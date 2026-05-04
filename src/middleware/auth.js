const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // tenantId is embedded in JWT — avoid DB round-trip for most requests
    if (decoded.tenantId) {
      req.tenantId = decoded.tenantId;
      req.user = { _id: decoded.id, role: decoded.role, tenantId: decoded.tenantId };
      return next();
    }

    // Fallback: look up user if token doesn't have tenantId (old tokens)
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    req.tenantId = req.user.tenantId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Role-based access control
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user?.role || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

module.exports = { protect, requireRole };
