const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

// Lazy-initialize key to avoid crash at startup when env not loaded yet
let _key = null;
const getKey = () => {
  if (_key) return _key;
  if (!process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY environment variable is not set');
  _key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  if (_key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  return _key;
};

const encrypt = (plaintext) => {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv(24 hex) + authTag(32 hex) + ciphertext(hex)
  return iv.toString('hex') + authTag.toString('hex') + encrypted.toString('hex');
};

const decrypt = (ciphertext) => {
  const key = getKey();
  const iv = Buffer.from(ciphertext.slice(0, 24), 'hex');
  const authTag = Buffer.from(ciphertext.slice(24, 56), 'hex');
  const encrypted = Buffer.from(ciphertext.slice(56), 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
};

module.exports = { encrypt, decrypt };
