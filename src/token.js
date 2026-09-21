import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * The setup token: everything a fresh install needs (.env secrets + the
 * local contacts file), AES-256-GCM encrypted under a passphrase that is
 * shared separately from the token file. Format (base64, wrapped):
 *   FUTK1 . salt(16) | iv(12) | tag(16) | ciphertext
 */

const MAGIC = 'FUTK1';

function keyFor(passphrase, salt) {
  return scryptSync(String(passphrase), salt, 32);
}

/** @param {object} payload e.g. { env: {...}, coordinatorsLocal: {...} } */
export function createToken(payload, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const blob = Buffer.concat([salt, iv, cipher.getAuthTag(), ct]).toString('base64');
  // 64-char lines so the file survives email/WhatsApp copy-paste intact
  return `${MAGIC}.${blob}`.replace(/(.{64})/g, '$1\n').trim();
}

export function readToken(text, passphrase) {
  const compact = String(text).replace(/\s+/g, '');
  if (!compact.startsWith(`${MAGIC}.`)) throw new Error('Not a FollowUp token (missing FUTK1 header).');
  const blob = Buffer.from(compact.slice(MAGIC.length + 1), 'base64');
  if (blob.length < 16 + 12 + 16 + 2) throw new Error('Token is truncated.');
  const salt = blob.subarray(0, 16);
  const iv = blob.subarray(16, 28);
  const tag = blob.subarray(28, 44);
  const ct = blob.subarray(44);
  const decipher = createDecipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  let pt;
  try {
    pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Wrong passphrase (or the token was corrupted in transit).');
  }
  const payload = JSON.parse(pt);
  if (!payload?.env?.JOTFORM_API_KEY) throw new Error('Token decrypted but has no JOTFORM_API_KEY.');
  return payload;
}
