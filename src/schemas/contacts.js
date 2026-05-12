/**
 * Zod schemas for /api/contacts endpoints.
 *
 * Mirrors the existing Joi `createContactSchema` / `updateContactSchema` in
 * `src/middleware/validate.js`, and adds a `bulkImportSchema` for the CSV /
 * JSON upload path. NEW — not yet wired in.
 */

const { z } = require('zod');

const phoneRegex = /^\+?[1-9]\d{7,14}$/;
const objectIdRegex = /^[a-f\d]{24}$/i;

const phoneSchema = z.string().trim().regex(phoneRegex, 'Invalid phone number (use E.164 format)');

const statusSchema = z.enum(['hot', 'warm', 'cold', 'customer']);

const tagsSchema = z.array(z.string().max(50)).max(20);

// `customFields` is a flat string→string map in the current model.
const customFieldsSchema = z.record(z.string(), z.string());

const createContactSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email().optional(),
  tags: tagsSchema.optional(),
  status: statusSchema.optional(),
  customFields: customFieldsSchema.optional(),
  optedIn: z.boolean().optional(),
  optInSource: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

// Update: same shape but every field optional (including phone). Use
// `.partial()` for clarity rather than re-listing fields.
const updateContactSchema = createContactSchema.partial();

// Bulk import: array of contact rows. `phone` remains required per row.
// Accepts either `{ contacts: [...] }` or a bare array — most clients send
// the wrapped form, but the controller may receive either.
const bulkImportRowSchema = createContactSchema;

const bulkImportSchema = z.union([
  z.object({
    contacts: z.array(bulkImportRowSchema).min(1).max(10000),
    // Optional flag: when true, existing contacts with the same phone are
    // updated rather than skipped.
    upsert: z.boolean().optional(),
  }),
  z.array(bulkImportRowSchema).min(1).max(10000),
]);

// Common params / query helpers (useful for future route migration).
const contactIdParamsSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid contact id'),
});

const listContactsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().max(200).optional(),
  status: statusSchema.optional(),
  tag: z.string().max(50).optional(),
});

module.exports = {
  createContactSchema,
  updateContactSchema,
  bulkImportSchema,
  bulkImportRowSchema,
  contactIdParamsSchema,
  listContactsQuerySchema,
};
