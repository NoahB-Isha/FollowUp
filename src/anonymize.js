/**
 * Scrub personal identifiers from text before it leaves the machine, and
 * restore them in the LLM's output afterwards. The scrub list is the known
 * set: coordinator/department names from config plus any extra names
 * (residents mentioned in notes) listed in gitignored
 * config/coordinators.local.json → "scrubNames".
 */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} text
 * @param {string[]} names known names to replace
 * @param {Map<string,string>} map placeholder → real name (shared across one request)
 */
export function scrub(text, names, map) {
  let out = text;
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const re = new RegExp(`\\b${escapeRe(name)}\\b`, 'gi');
    if (!re.test(out)) continue;
    let placeholder = null;
    for (const [ph, real] of map) if (real.toLowerCase() === name.toLowerCase()) placeholder = ph;
    if (!placeholder) {
      placeholder = `Person${map.size + 1}`;
      map.set(placeholder, name);
    }
    out = out.replace(re, placeholder);
  }
  return out.replace(EMAIL_RE, 'EmailAddress').replace(PHONE_RE, 'PhoneNumber');
}

/** Put real names back into LLM output (longest placeholders first, so Person12 ≠ Person1 + "2"). */
export function unscrub(text, map) {
  let out = text;
  for (const [ph, real] of [...map.entries()].sort((a, b) => b[0].length - a[0].length)) {
    out = out.replaceAll(ph, real);
  }
  return out;
}
