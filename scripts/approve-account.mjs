import { parseArgs } from 'node:util';
import { accountRoot, issueTicket, registrationKey, workEmail } from './account-ticket.mjs';

const { values } = parseArgs({ options: {
  email: { type: 'string' }, root: { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help || !values.email) {
  console.log('node scripts/approve-account.mjs --email <work email> [--root <instance data directory>]');
  process.exit(values.help ? 0 : 2);
}
const email = workEmail(values.email);
if (!email) throw new Error('Use a Schaeffler or Vitesco work email.');
const key = await registrationKey(accountRoot(values.root));
const expiry = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
console.log(issueTicket(key, email, expiry));
