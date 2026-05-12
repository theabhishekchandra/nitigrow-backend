/**
 * Zod schemas for /api/auth endpoints.
 *
 * Mirrors the existing Joi schemas in `src/middleware/validate.js`. These
 * are NEW and not yet wired in — a future migration will switch the auth
 * routes from Joi to Zod via `src/middleware/zodValidate.js`.
 */

const { z } = require('zod');

// E.164-ish — same pattern as the Joi version: optional `+`, leading 1-9,
// total 8-15 digits.
const phoneRegex = /^\+?[1-9]\d{7,14}$/;

const emailSchema = z.string().trim().toLowerCase().email('Invalid email address');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

const registerSchema = z.object({
  businessName: z.string().trim().min(2).max(100),
  email: emailSchema,
  password: passwordSchema,
  phone: z.string().regex(phoneRegex, 'Invalid phone number').optional(),
  industry: z.string().max(50).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  // Refresh token may also arrive via cookie; treat body field as optional.
  refreshToken: z.string().min(1).optional(),
});

// /me — currently no body; export an empty object schema for symmetry.
const meSchema = z.object({}).strict();

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  meSchema,
};
