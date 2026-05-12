
const { encrypt, decrypt } = require('../src/services/encryption');

describe('services/encryption (AES-256-GCM)', () => {
  it('round-trips a plaintext string', () => {
    const plain = 'super-secret-meta-system-user-token-EAAG...';
    const blob = encrypt(plain);
    expect(blob).not.toContain(plain);
    expect(decrypt(blob)).toBe(plain);
  });

  it('produces different ciphertexts for the same plaintext (IV is random)', () => {
    const plain = 'identical input';
    const a = encrypt(plain);
    const b = encrypt(plain);
    expect(a).not.toBe(b);
    // Both must still decrypt back to the same plaintext.
    expect(decrypt(a)).toBe(plain);
    expect(decrypt(b)).toBe(plain);
  });

  it('throws when decrypting garbage', () => {
    expect(() => decrypt('not-a-valid-blob')).toThrow();
  });

  it('throws when the auth tag has been tampered with', () => {
    const blob = encrypt('hello world');
    // Flip the last hex char of the auth tag region (chars 24..56).
    const tampered = blob.slice(0, 30) + (blob[30] === '0' ? '1' : '0') + blob.slice(31);
    expect(() => decrypt(tampered)).toThrow();
  });
});
