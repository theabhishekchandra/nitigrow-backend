const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name:     { type: String, required: true },
  email:    { type: String, required: true },
  password: { type: String },
  phone:    { type: String },
  role:     {
    type: String,
    enum: ['owner', 'manager', 'sales_agent', 'support_agent', 'campaign_manager', 'analyst', 'accountant'],
    default: 'sales_agent',
  },
  isActive:    { type: Boolean, default: true },
  lastLoginAt: { type: Date },
}, { timestamps: true });

userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password);
};

module.exports = mongoose.model('User', userSchema);
