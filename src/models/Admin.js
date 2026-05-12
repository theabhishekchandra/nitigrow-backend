const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const sessionSchema = new mongoose.Schema({
  jti:        { type: String, required: true },
  ip:         { type: String },
  ua:         { type: String },
  createdAt:  { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
}, { _id: false });

const notificationPrefsSchema = new mongoose.Schema({
  newTicketUrgent: { type: Boolean, default: true },
  paymentFailed:   { type: Boolean, default: true },
  qualityDropped:  { type: Boolean, default: true },
  newSignup:       { type: Boolean, default: false },
  weeklyDigest:    { type: Boolean, default: true },
}, { _id: false });

const adminSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['superadmin', 'support'], default: 'support' },
  isActive: { type: Boolean, default: true },

  // Session / login state
  lastLoginAt:       { type: Date },
  lastLoginIp:       { type: String },
  passwordChangedAt: { type: Date },
  failedLoginCount:  { type: Number, default: 0 },
  lockedUntil:       { type: Date, default: null },

  // 2FA — TOTP secret stored AES-encrypted via services/encryption.js
  totpSecret:        { type: String },
  twoFactorEnabled:  { type: Boolean, default: false },
  // Each recovery code stored as bcrypt hash; plaintext is shown to the user once at generation.
  recoveryCodes:     { type: [String], default: [] },

  preferences: {
    notifications: { type: notificationPrefsSchema, default: () => ({}) },
  },

  // In-doc session list keeps revoke flow simple without an extra collection.
  sessions: { type: [sessionSchema], default: [] },
}, { timestamps: true });

adminSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordChangedAt = new Date();
});

adminSchema.methods.matchPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('Admin', adminSchema);
