import { createHmac, randomBytes } from 'node:crypto';
import { app } from './config.js';
import { getMeta, setMeta } from './db.js';

/**
 * Magic links: a signed, unguessable URL that lets a coordinator mark an issue
 * done from their phone — no login, the token is the authorization. The secret
 * is auto-generated once and kept in the local DB (override with
 * FOLLOWUP_LINK_SECRET). Links go into WhatsApp messages and digest emails;
 * they resolve against FOLLOWUP_BASE_URL, so once the app moves to a Pi the
 * same links work from anywhere on the campus network.
 */

let SECRET = process.env.FOLLOWUP_LINK_SECRET || getMeta('link_secret');
if (!SECRET) {
  SECRET = randomBytes(24).toString('base64url');
  setMeta('link_secret', SECRET);
}

export function issueToken(id) {
  const sig = createHmac('sha256', SECRET).update(`resolve:${id}`).digest('base64url').slice(0, 16);
  return `${id}-${sig}`;
}

/** Returns the issue id for a valid token, else null. */
export function verifyToken(token) {
  const m = /^(\d{1,12})-[\w-]{16}$/.exec(String(token));
  if (!m) return null;
  const id = Number(m[1]);
  return issueToken(id) === token ? id : null;
}

export function baseUrl() {
  const base = process.env.FOLLOWUP_BASE_URL
    || `http://localhost:${process.env.FOLLOWUP_PORT || app.dashboardPort || 4820}`;
  return base.replace(/\/+$/, '');
}

export function magicUrl(issueId) {
  return `${baseUrl()}/r/${issueToken(issueId)}`;
}
