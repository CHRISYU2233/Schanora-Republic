import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const domains = new Set(['mail.schaeffler.com', 'schaeffler.com', 'vitesco.com']);

export function workEmail(input) {
  const email = input.trim().toLowerCase();
  const parts = email.split('@');
  return parts.length === 2 && /^[\w.!#$%&'*+/=?^`{|}~-]+$/.test(parts[0]) && domains.has(parts[1]) ? email : '';
}

export function accountRoot(root) {
  return path.resolve(root || process.env.SCHANORA_WEKNORA_ROOT || path.join(os.homedir(), 'Schanora', 'weknora-0.9.0'));
}

export async function registrationKey(root) {
  const file = path.join(root, '.weknora-secrets.json');
  const secrets = JSON.parse(await readFile(file, 'utf8'));
  const signing = process.env.SYSTEM_SIGNING_KEY || secrets.SYSTEM_SIGNING_KEY;
  if (!/^[0-9a-f]{64}$/i.test(signing || '')) throw new Error('Invalid local signing key.');
  return createHmac('sha256', Buffer.from(signing, 'hex')).update('schanora-registration-v1').digest('hex');
}

export function issueTicket(key, email, expiry) {
  const proof = createHmac('sha256', Buffer.from(key, 'hex')).update(email + '\n' + expiry).digest('base64url');
  return expiry + '.' + proof;
}
