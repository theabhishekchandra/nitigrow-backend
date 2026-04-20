// Meta WhatsApp Cloud API error codes with actionable messages
const WA_ERRORS = {
  // Auth
  190:  { msg: 'Access token expired or invalid', retry: false, action: 'reconnect' },
  // Permission
  200:  { msg: 'Permission denied — check WABA permissions', retry: false, action: 'check_permissions' },
  // Rate limits
  4:    { msg: 'API call rate limit hit', retry: true, retryAfter: 60 },
  80007: { msg: 'Messaging limit reached for the day', retry: false, action: 'daily_limit' },
  131049: { msg: 'Sending not allowed — business initiated limit exceeded', retry: false, action: 'tier_limit' },
  // Contact issues
  131026: { msg: 'Contact does not have a WhatsApp account', retry: false, action: 'remove_contact' },
  131030: { msg: 'Recipient opted out — unsubscribe them', retry: false, action: 'opt_out' },
  // Template issues
  132000: { msg: 'Template not found or not approved', retry: false, action: 'check_template' },
  132001: { msg: 'Template parameter count mismatch', retry: false, action: 'fix_template' },
  132005: { msg: 'Template text too long', retry: false, action: 'fix_template' },
  132007: { msg: 'Template header format invalid', retry: false, action: 'fix_template' },
  132012: { msg: 'Template button URL invalid', retry: false, action: 'fix_template' },
  // Message window
  131047: { msg: 'Message failed — 24h window closed. Use template instead', retry: false, action: 'use_template' },
  // Media
  131051: { msg: 'Media upload failed — check URL or file format', retry: true, retryAfter: 5 },
  131052: { msg: 'Media file too large', retry: false, action: 'reduce_media_size' },
  // General
  1:     { msg: 'Unknown error from Meta API', retry: true, retryAfter: 30 },
  2:     { msg: 'Service temporarily unavailable', retry: true, retryAfter: 60 },
  100:   { msg: 'Invalid parameter — check request body', retry: false, action: 'fix_params' },
  131000: { msg: 'Message failed to send', retry: true, retryAfter: 10 },
};

/**
 * Parse a Meta API error response and return a structured error object
 */
const parseWhatsAppError = (axiosError) => {
  const data = axiosError?.response?.data?.error;
  if (!data) return { code: 0, msg: axiosError.message, retry: false };

  const code = data.code || data.error_subcode || 0;
  const known = WA_ERRORS[code] || WA_ERRORS[1];

  return {
    code,
    msg: data.message || known.msg,
    retry: known.retry,
    retryAfter: known.retryAfter,
    action: known.action,
    raw: data,
  };
};

/**
 * Should this contact be auto-opted-out based on error code?
 */
const isOptOutError = (code) => code === 131030;

/**
 * Should this contact be marked invalid (no WA account)?
 */
const isInvalidContactError = (code) => code === 131026;

module.exports = { parseWhatsAppError, isOptOutError, isInvalidContactError, WA_ERRORS };
