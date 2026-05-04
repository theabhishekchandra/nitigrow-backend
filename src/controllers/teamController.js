const User = require('../models/User');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const ROLES = ['owner', 'manager', 'sales_agent', 'support_agent', 'campaign_manager', 'analyst', 'accountant'];

const getTeam = async (req, res) => {
  try {
    const users = await User.find({ tenantId: req.tenantId }).select('-password').sort({ createdAt: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const inviteMember = async (req, res) => {
  try {
    const { name, email, role } = req.body;
    if (!name || !email || !role) return res.status(400).json({ error: 'name, email and role are required' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: `Invalid role. Must be one of: ${ROLES.join(', ')}` });
    if (role === 'owner') return res.status(403).json({ error: 'Cannot assign owner role via invite' });

    const exists = await User.findOne({ tenantId: req.tenantId, email });
    if (exists) return res.status(409).json({ error: 'User with this email already exists in your team' });

    // Generate temporary password — user should change on first login
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const user = await User.create({ tenantId: req.tenantId, name, email, password: tempPassword, role });

    res.status(201).json({
      user: { _id: user._id, name: user.name, email: user.email, role: user.role },
      tempPassword, // In production, send via email instead
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updateRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (role === 'owner') return res.status(403).json({ error: 'Cannot assign owner role' });

    // Prevent changing own role
    if (req.params.userId === req.user._id.toString()) {
      return res.status(403).json({ error: 'Cannot change your own role' });
    }

    const user = await User.findOneAndUpdate(
      { _id: req.params.userId, tenantId: req.tenantId },
      { role },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const removeMember = async (req, res) => {
  try {
    // Cannot remove yourself
    if (req.params.userId === req.user._id.toString()) {
      return res.status(403).json({ error: 'Cannot remove yourself' });
    }

    const user = await User.findOneAndDelete({
      _id: req.params.userId,
      tenantId: req.tenantId,
      role: { $ne: 'owner' }, // Cannot remove the owner
    });

    if (!user) return res.status(404).json({ error: 'User not found or cannot be removed' });
    res.json({ message: 'Member removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getTeam, inviteMember, updateRole, removeMember };
