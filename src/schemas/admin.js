/**
 * Zod schemas for /api/admin endpoints.
 *
 * NEW — not yet wired into routes. Mirrors the fields read in
 * `src/controllers/adminController.js` and `src/controllers/admin2faController.js`.
 */

const { z } = require('zod');

const emailSchema = z.string().trim().toLowerCase().email('Invalid email address');

// 6-digit TOTP code (also accept short alphanumerics for recovery codes
// where the same field is reused).
const totpCodeSchema = z.string().trim().min(6, 'Code is required').max(20);

// ─── Login ────────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  code: totpCodeSchema.optional(), // present when 2FA is enabled
});

// ─── Password change ──────────────────────────────────────────────────────
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from current password',
    path: ['newPassword'],
  });

// ─── Profile update ───────────────────────────────────────────────────────
const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

// ─── 2FA ──────────────────────────────────────────────────────────────────
const twoFaSetupSchema = z.object({}).strict(); // no body
const twoFaVerifySchema = z.object({ code: totpCodeSchema });
const twoFaDisableSchema = z.object({ password: z.string().min(1) });
const twoFaRecoveryUseSchema = z.object({ code: totpCodeSchema });

// ─── Preferences (PUT) ────────────────────────────────────────────────────
const ALLOWED_NOTIF_KEYS = [
  'newTicketUrgent',
  'paymentFailed',
  'qualityDropped',
  'newSignup',
  'weeklyDigest',
];

const updatePreferencesSchema = z.object({
  notifications: z
    .object(
      ALLOWED_NOTIF_KEYS.reduce((acc, k) => {
        acc[k] = z.boolean().optional();
        return acc;
      }, {}),
    )
    .strict(),
});

// ─── Sessions ─────────────────────────────────────────────────────────────
const revokeSessionParamsSchema = z.object({
  jti: z.string().min(1, 'jti is required'),
});

const revokeOtherSessionsSchema = z.object({}).strict();

// ─── Tenant management (subset, useful for admin migration) ───────────────
const updateTenantStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'trial', 'churned']),
});

const updateTenantLimitsSchema = z.object({
  messages: z.number().int().nonnegative().optional(),
  ai: z.number().int().nonnegative().optional(),
  contacts: z.number().int().nonnegative().optional(),
});

const seedAdminSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: z.string().min(8).max(128),
});

module.exports = {
  loginSchema,
  changePasswordSchema,
  updateProfileSchema,
  twoFaSetupSchema,
  twoFaVerifySchema,
  twoFaDisableSchema,
  twoFaRecoveryUseSchema,
  updatePreferencesSchema,
  revokeSessionParamsSchema,
  revokeOtherSessionsSchema,
  updateTenantStatusSchema,
  updateTenantLimitsSchema,
  seedAdminSchema,
};
