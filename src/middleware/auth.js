const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Graceful jti enforcement: only enforce when the token carries a jti.
    // Older tokens (issued before sessions[] was added to User) continue to work.
    if (decoded.jti) {
      // Lazy require — User doesn't have a sessions[] field until the User-side
      // session list migration ships, so we treat missing/empty sessions[] as
      // "no session tracking on this account" and pass through. Only when the
      // doc *does* have sessions but the jti is missing do we reject.
      const userDoc = await User.findById(decoded.id).select('sessions');
      if (userDoc && Array.isArray(userDoc.sessions) && userDoc.sessions.length > 0) {
        const session = userDoc.sessions.find((s) => s.jti === decoded.jti);
        if (!session) return res.status(401).json({ error: 'Session revoked' });

        User.updateOne(
          { _id: decoded.id },
          { $set: { 'sessions.$[el].lastSeenAt': new Date() } },
          { arrayFilters: [{ 'el.jti': decoded.jti }] },
        ).catch((err) => console.error('[auth] lastSeenAt update failed:', err.message));
      }
    }

    // tenantId is embedded in JWT — avoid DB round-trip for most requests
    if (decoded.tenantId) {
      req.tenantId = decoded.tenantId;
      req.user = {
        _id: decoded.id,
        role: decoded.role,
        tenantId: decoded.tenantId,
        jti: decoded.jti,
      };
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
const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user?.role || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };

module.exports = { protect, requireRole };
