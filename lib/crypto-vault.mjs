import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function decodeKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('AXOBOARD_OAUTH_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

export function createVault(encodedKey) {
  const key = decodeKey(encodedKey);
  return {
    ready: Boolean(key),
    encryptJson(value, aad) {
      if (!key) throw new Error('oauth_encryption_not_configured');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(String(aad), 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return { ciphertext, iv, authTag: cipher.getAuthTag() };
    },
    decryptJson(envelope, aad) {
      if (!key) throw new Error('oauth_encryption_not_configured');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv));
      decipher.setAAD(Buffer.from(String(aad), 'utf8'));
      decipher.setAuthTag(Buffer.from(envelope.authTag));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext)), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8'));
    }
  };
}
