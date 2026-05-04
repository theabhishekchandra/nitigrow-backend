const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { redisClient } = require('../config/redis');

const isProd = process.env.NODE_ENV === 'production';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'strict' : 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

const REFRESH_TTL = 30 * 24 * 60 * 60; // seconds

const generateTokens = (user) => {
  const payload = { id: user._id, tenantId: user.tenantId, role: user.role };
  const access  = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refresh = jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
  return { access, refresh };
};

// Store refresh token in Redis so we can invalidate it on logout
// Gracefully degrades when Redis is unavailable
const storeRefreshToken = async (userId, token) => {
  try {
    if (redisClient?.isOpen) await redisClient.setEx(`refresh:${userId}`, REFRESH_TTL, token);
  } catch { /* Redis unavailable — continue without token storage */ }
};

const isRefreshTokenValid = async (userId, token) => {
  try {
    if (!redisClient?.isOpen) return true; // No Redis = skip revocation check
    const stored = await redisClient.get(`refresh:${userId}`);
    return stored === token;
  } catch { return true; /* Redis down — allow refresh */ }
};

const revokeRefreshToken = async (userId) => {
  try {
    if (redisClient?.isOpen) await redisClient.del(`refresh:${userId}`);
  } catch { /* ignore */ }
};

const register = async (req, res) => {
  try {
    const { businessName, email, password, phone, industry } = req.body;

    const existing = await Tenant.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const tenant = await Tenant.create({ businessName, email, phone, industry });
    const user = await User.create({
      tenantId: tenant._id,
      name: businessName,
      email,
      password,
      role: 'owner',
    });

    const { access, refresh } = generateTokens(user);
    await storeRefreshToken(user._id, refresh);

    res.cookie('refreshToken', refresh, COOKIE_OPTS);
    res.status(201).json({
      accessToken: access,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, tenantId: tenant._id },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.isActive) return res.status(403).json({ error: 'Account is deactivated' });

    user.lastLoginAt = new Date();
    await user.save();

    const { access, refresh } = generateTokens(user);
    await storeRefreshToken(user._id, refresh);

    res.cookie('refreshToken', refresh, COOKIE_OPTS);
    res.json({
      accessToken: access,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const refreshToken = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) return res.status(401).json({ error: 'No refresh token' });

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    // Verify token is still valid in Redis (not revoked)
    const valid = await isRefreshTokenValid(decoded.id, token);
    if (!valid) return res.status(401).json({ error: 'Refresh token revoked' });

    const user = await User.findById(decoded.id).select('_id tenantId role isActive');
    if (!user || !user.isActive) return res.status(401).json({ error: 'User not found' });

    const access = jwt.sign(
      { id: user._id, tenantId: user.tenantId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Rotate refresh token for security
    const newRefresh = jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
    await storeRefreshToken(user._id, newRefresh);
    res.cookie('refreshToken', newRefresh, COOKIE_OPTS);

    res.json({ accessToken: access });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};

const logout = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
      await revokeRefreshToken(decoded.id);
    }
  } catch {
    // ignore verification errors on logout
  }
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out' });
};

module.exports = { register, login, refreshToken, logout };
