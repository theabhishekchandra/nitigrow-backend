/**
 * Template Validation Engine — Meta WhatsApp Template Policy Rules
 * Checks all known Meta rejection reasons before submission.
 * Returns an array of { rule, field, severity, message } violations.
 */

// --- Prohibited words / patterns (common Meta rejection triggers) ---
const PROHIBITED_PATTERNS = [
  { pattern: /free\s*(money|cash|rewards?)/i, reason: 'Contains "free money/cash" — likely to be rejected as spam' },
  { pattern: /100%\s*(guarantee|free|off)/i, reason: 'Contains "100% guarantee/free" — spam trigger' },
  { pattern: /\b(win|winner|won)\b.*\b(prize|lottery|jackpot)\b/i, reason: 'Lottery/prize language violates Meta policy' },
  { pattern: /\b(password|pin|otp|cvv)\b/i, reason: 'Sensitive credential request — use AUTHENTICATION category only' },
  { pattern: /\b(aadhaar|pan\s*card|passport\s*number)\b/i, reason: 'Requesting government ID — violates Meta privacy policy' },
  { pattern: /\b(gambling|betting|casino)\b/i, reason: 'Gambling content — prohibited by Meta' },
  { pattern: /\b(alcohol|liquor|beer|wine|whiskey)\b/i, reason: 'Alcohol-related content — may be rejected in India' },
  { pattern: /\b(nude|sex|porn|xxx)\b/i, reason: 'Adult content — strictly prohibited' },
  { pattern: /\b(click\s*here|tap\s*here)\b/i, reason: '"Click here" / "Tap here" without context may be rejected' },
];

// --- Variable rules ---
const VARIABLE_REGEX = /\{\{(\d+)\}\}/g;

function validateTemplate(template) {
  const violations = [];
  const { name, category, language, components } = template;

  // --- Name rules ---
  if (name) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      violations.push({
        rule: 'NAME_FORMAT',
        field: 'name',
        severity: 'error',
        message: 'Template name must be lowercase, start with a letter, and contain only letters, numbers, underscores.',
      });
    }
    if (name.length > 512) {
      violations.push({ rule: 'NAME_LENGTH', field: 'name', severity: 'error', message: 'Template name must be 512 characters or less.' });
    }
  }

  // --- Category rules ---
  if (category) {
    const validCategories = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
    if (!validCategories.includes(category)) {
      violations.push({ rule: 'INVALID_CATEGORY', field: 'category', severity: 'error', message: `Category must be one of: ${validCategories.join(', ')}` });
    }
  }

  // --- Component rules ---
  if (components && Array.isArray(components)) {
    const header = components.find(c => c.type === 'HEADER');
    const body   = components.find(c => c.type === 'BODY');
    const footer = components.find(c => c.type === 'FOOTER');
    const buttons = components.filter(c => c.type === 'BUTTONS');

    // HEADER validation
    if (header?.text) {
      if (header.text.length > 60) {
        violations.push({ rule: 'HEADER_LENGTH', field: 'header', severity: 'error', message: `Header text is ${header.text.length} chars — max 60.` });
      }
      const headerVars = header.text.match(VARIABLE_REGEX) || [];
      if (headerVars.length > 1) {
        violations.push({ rule: 'HEADER_VARS', field: 'header', severity: 'error', message: 'Header can contain at most 1 variable.' });
      }
    }

    // BODY validation (the main text)
    if (body?.text) {
      const bodyText = body.text;

      // Length
      if (bodyText.length > 1024) {
        violations.push({ rule: 'BODY_LENGTH', field: 'body', severity: 'error', message: `Body text is ${bodyText.length} chars — max 1024.` });
      }

      // Cannot start or end with variable
      if (/^\s*\{\{/.test(bodyText)) {
        violations.push({ rule: 'BODY_START_VAR', field: 'body', severity: 'error', message: 'Body cannot start with a variable {{}}. Add text before the first variable.' });
      }
      if (/\}\}\s*$/.test(bodyText)) {
        violations.push({ rule: 'BODY_END_VAR', field: 'body', severity: 'error', message: 'Body cannot end with a variable {{}}. Add text after the last variable.' });
      }

      // Variables must be sequential: {{1}}, {{2}}, {{3}} ...
      const vars = bodyText.match(VARIABLE_REGEX) || [];
      const varNums = vars.map(v => parseInt(v.replace(/[{}]/g, ''))).sort((a, b) => a - b);
      for (let i = 0; i < varNums.length; i++) {
        if (varNums[i] !== i + 1) {
          violations.push({ rule: 'BODY_VAR_SEQUENCE', field: 'body', severity: 'error', message: `Variables must be sequential starting from {{1}}. Found {{${varNums[i]}}} at position ${i + 1}.` });
          break;
        }
      }

      // No consecutive variables without text between them
      if (/\}\}\s*\{\{/.test(bodyText)) {
        violations.push({ rule: 'BODY_CONSECUTIVE_VARS', field: 'body', severity: 'warning', message: 'Consecutive variables without text between them (e.g., "{{1}}{{2}}") — may be rejected. Add text between variables.' });
      }

      // Too many variables (Meta typically rejects > 10)
      if (varNums.length > 10) {
        violations.push({ rule: 'BODY_TOO_MANY_VARS', field: 'body', severity: 'warning', message: `Too many variables (${varNums.length}) — Meta typically allows up to 10.` });
      }

      // Body too short (likely rejected)
      if (bodyText.replace(VARIABLE_REGEX, '').trim().length < 10) {
        violations.push({ rule: 'BODY_TOO_SHORT', field: 'body', severity: 'warning', message: 'Body has very little actual text — likely to be rejected. Add more context.' });
      }

      // Prohibited content
      for (const { pattern, reason } of PROHIBITED_PATTERNS) {
        if (pattern.test(bodyText)) {
          violations.push({ rule: 'PROHIBITED_CONTENT', field: 'body', severity: 'error', message: reason });
        }
      }

      // URL in body without button (Meta prefers buttons for URLs)
      if (/https?:\/\/\S+/.test(bodyText) && buttons.length === 0) {
        violations.push({ rule: 'URL_WITHOUT_BUTTON', field: 'body', severity: 'warning', message: 'Body contains a URL but no CTA button — Meta prefers URLs in button components.' });
      }

      // Phone number in body
      if (/\+?\d{10,15}/.test(bodyText.replace(VARIABLE_REGEX, ''))) {
        violations.push({ rule: 'PHONE_IN_BODY', field: 'body', severity: 'warning', message: 'Body contains a phone number — use a PHONE_NUMBER button instead.' });
      }

      // All-caps words (3+ consecutive uppercase words = spammy)
      const capsWords = bodyText.match(/\b[A-Z]{3,}\b/g) || [];
      if (capsWords.length >= 3) {
        violations.push({ rule: 'EXCESSIVE_CAPS', field: 'body', severity: 'warning', message: `Excessive uppercase text (${capsWords.join(', ')}) — may trigger spam filter.` });
      }

      // Excessive newlines
      const newlineCount = (bodyText.match(/\n/g) || []).length;
      if (newlineCount > 10) {
        violations.push({ rule: 'EXCESSIVE_NEWLINES', field: 'body', severity: 'warning', message: `Too many line breaks (${newlineCount}) — keep messages concise.` });
      }
    } else {
      violations.push({ rule: 'BODY_REQUIRED', field: 'body', severity: 'error', message: 'Template must have a BODY component with text.' });
    }

    // FOOTER validation
    if (footer?.text) {
      if (footer.text.length > 60) {
        violations.push({ rule: 'FOOTER_LENGTH', field: 'footer', severity: 'error', message: `Footer text is ${footer.text.length} chars — max 60.` });
      }
      // Footer cannot have variables
      if (VARIABLE_REGEX.test(footer.text)) {
        violations.push({ rule: 'FOOTER_VARS', field: 'footer', severity: 'error', message: 'Footer cannot contain variables {{}}.' });
      }
    }

    // BUTTON validation
    for (const btnGroup of buttons) {
      const btns = btnGroup.buttons || [];
      if (btns.length > 3) {
        violations.push({ rule: 'TOO_MANY_BUTTONS', field: 'buttons', severity: 'error', message: 'Maximum 3 buttons allowed per template.' });
      }
      for (const b of btns) {
        if (b.text && b.text.length > 25) {
          violations.push({ rule: 'BUTTON_TEXT_LENGTH', field: 'buttons', severity: 'error', message: `Button text "${b.text}" is ${b.text.length} chars — max 25.` });
        }
      }
    }

    // AUTHENTICATION category special rules
    if (category === 'AUTHENTICATION') {
      if (header) {
        violations.push({ rule: 'AUTH_NO_HEADER', field: 'header', severity: 'error', message: 'AUTHENTICATION templates cannot have a header.' });
      }
      if (footer) {
        violations.push({ rule: 'AUTH_NO_FOOTER', field: 'footer', severity: 'error', message: 'AUTHENTICATION templates cannot have a footer.' });
      }
      // Auth templates should have exactly {{1}} for OTP
      const bodyVars = body?.text?.match(VARIABLE_REGEX) || [];
      if (bodyVars.length !== 1 || bodyVars[0] !== '{{1}}') {
        violations.push({ rule: 'AUTH_SINGLE_VAR', field: 'body', severity: 'warning', message: 'AUTHENTICATION templates should use exactly {{1}} for the OTP/code.' });
      }
    }
  }

  // --- Score: pass / warning / fail ---
  const errors   = violations.filter(v => v.severity === 'error');
  const warnings = violations.filter(v => v.severity === 'warning');

  return {
    valid: errors.length === 0,
    score: errors.length === 0 ? (warnings.length === 0 ? 'PASS' : 'WARNING') : 'FAIL',
    errorCount: errors.length,
    warningCount: warnings.length,
    violations,
  };
}

module.exports = { validateTemplate };
