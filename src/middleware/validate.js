const Joi = require('joi');

// Generic validation middleware factory
const validate = (schema, source = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
  if (error) {
    const details = error.details.map(d => d.message.replace(/"/g, "'"));
    return res.status(400).json({ error: 'Validation failed', details });
  }
  req[source] = value;
  next();
};

// ─── Auth schemas ────────────────────────────────────────────────────────────
const registerSchema = Joi.object({
  businessName: Joi.string().min(2).max(100).required(),
  email:    Joi.string().email().lowercase().required(),
  password: Joi.string().min(8).max(128).required(),
  phone:    Joi.string().pattern(/^\+?[1-9]\d{7,14}$/).optional(),
  industry: Joi.string().max(50).optional(),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

// ─── Contact schemas ─────────────────────────────────────────────────────────
const createContactSchema = Joi.object({
  name:         Joi.string().min(1).max(100).optional(),
  phone:        Joi.string().pattern(/^\+?[1-9]\d{7,14}$/).required(),
  email:        Joi.string().email().optional(),
  tags:         Joi.array().items(Joi.string().max(50)).max(20).optional(),
  status:       Joi.string().valid('hot', 'warm', 'cold', 'customer').optional(),
  customFields: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
  optedIn:      Joi.boolean().optional(),
  optInSource:  Joi.string().max(100).optional(),
  notes:        Joi.string().max(2000).optional(),
});

const updateContactSchema = createContactSchema.fork(
  ['phone'], (s) => s.optional()
);

// ─── Campaign schemas ─────────────────────────────────────────────────────────
const audienceSchema = Joi.object({
  type:       Joi.string().valid('all', 'tag', 'manual').required(),
  tags:       Joi.when('type', { is: 'tag', then: Joi.array().items(Joi.string()).min(1).required() }),
  contactIds: Joi.when('type', { is: 'manual', then: Joi.array().items(Joi.string().hex().length(24)).min(1).required() }),
});

const createCampaignSchema = Joi.object({
  name:        Joi.string().min(1).max(200).required(),
  templateId:  Joi.string().hex().length(24).required(),
  language:    Joi.string().max(10).optional(),
  audience:    audienceSchema.optional(),
  components:  Joi.array().optional(),
  scheduledAt: Joi.date().greater('now').optional(),
});

// ─── Template schemas ─────────────────────────────────────────────────────────
const createTemplateSchema = Joi.object({
  name:       Joi.string().pattern(/^[a-z0-9_]+$/).min(1).max(512).required()
                .messages({ 'string.pattern.base': 'Template name must be lowercase letters, numbers and underscores only' }),
  category:   Joi.string().valid('MARKETING', 'UTILITY', 'AUTHENTICATION').required(),
  language:   Joi.string().max(10).required(),
  components: Joi.array().items(Joi.object()).required(),
});

// ─── Message schemas ──────────────────────────────────────────────────────────
const sendMessageSchema = Joi.object({
  contactId: Joi.string().hex().length(24).required(),
  type:      Joi.string().valid('text', 'image', 'document', 'template', 'interactive').required(),
  content:   Joi.string().max(4096).when('type', { is: 'text', then: Joi.required() }),
  imageUrl:  Joi.string().uri().when('type', { is: 'image', then: Joi.required() }),
  docUrl:    Joi.string().uri().when('type', { is: 'document', then: Joi.required() }),
  filename:  Joi.string().max(256).when('type', { is: 'document', then: Joi.required() }),
  caption:   Joi.string().max(1024).optional(),
  template:  Joi.object().when('type', { is: 'template', then: Joi.required() }),
});

// ─── Team schemas ─────────────────────────────────────────────────────────────
const inviteTeamMemberSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  role:  Joi.string().valid('owner', 'admin', 'agent', 'viewer').required(),
  name:  Joi.string().min(1).max(100).optional(),
});

module.exports = {
  validate,
  schemas: {
    register: registerSchema,
    login: loginSchema,
    createContact: createContactSchema,
    updateContact: updateContactSchema,
    createCampaign: createCampaignSchema,
    createTemplate: createTemplateSchema,
    sendMessage: sendMessageSchema,
    inviteTeamMember: inviteTeamMemberSchema,
  },
};
