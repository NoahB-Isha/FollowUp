import { scrubNameList } from './config.js';
import { scrub, unscrub } from './anonymize.js';

/**
 * LLM issue extraction via Google Gemini Flash (free tier). Replaces the
 * rule-based splitter when GEMINI_API_KEY is set; sync falls back to the
 * rules on any failure, so the app never depends on the network to ingest.
 *
 * Privacy: every note is anonymized before it leaves the machine — known
 * names (coordinators, departments, and the gitignored scrubNames list)
 * become Person1/Person2…, emails and phone numbers become placeholders —
 * and the placeholders are swapped back in the returned issues. Only lodge/
 * floor/area labels and the scrubbed note text are sent; never who walked,
 * never contact info, never photos.
 */

const AREAS = [
  'Wing A', 'Wing B', 'Wing C', 'Wing D', 'Wing E', 'Wing F', 'Wing G', 'Wing H',
  'Restrooms', 'Cleaning supplies', 'Cleaning solutions', 'Paper products',
  'Water dispenser', 'Maintenance', 'General',
];
const CATEGORIES = ['housekeeping', 'maintenance', 'supplies', 'other'];

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      area: { type: 'STRING', enum: AREAS },
      description: { type: 'STRING' },
      category: { type: 'STRING', enum: CATEGORIES },
      severity: { type: 'STRING', enum: ['normal', 'high'] },
    },
    required: ['area', 'description', 'category', 'severity'],
  },
};

const INSTRUCTIONS = `You convert dorm walkthrough notes into a list of discrete, actionable issues.

Rules:
- One entry per distinct problem. Split run-on lists; if a note names several cubes with the same problem, emit one entry per cube and keep the cube number in the description.
- Skip non-issues: rooms marked N/A / locked / not in use / sadhana room / film room / office, positive observations ("all working", "clean and in order", "no leaks"), and meta-comments about the form itself.
- Keep each description concise (under 120 characters), faithful to the original wording, with light spelling cleanup. Keep Person1/Person2-style placeholders exactly as written.
- area: use the area the note belongs to; floor-level comments go under "General".
- category: housekeeping (cleaning, tidying, linens, trash, smells), maintenance (repairs, lights, leaks, mold, paint, fixtures, appliances), supplies (restocking, missing items/equipment), other.
- severity: "high" only for mold, leaks, damage, safety hazards, or anything marked urgent/immediate; otherwise "normal".

Return ONLY the JSON array.`;

export function llmAvailable() {
  return !!process.env.GEMINI_API_KEY;
}

export function llmModel() {
  return process.env.GEMINI_MODEL || 'gemini-flash-latest';
}

/** Configured model first, then known-good alternates — model ids churn on the free tier. */
function modelCandidates() {
  return [...new Set([llmModel(), 'gemini-flash-latest', 'gemini-3-flash-preview'])];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(body) {
  let lastErr = 'no model attempted';
  for (const model of modelCandidates()) {
    const send = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let res = await send();
    if (res.status === 429 || res.status === 503) { // rate limit / overload — wait once, retry once
      await sleep(15000);
      res = await send();
    }
    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error(`Gemini returned no text (finishReason: ${data.candidates?.[0]?.finishReason ?? 'unknown'})`);
      return text;
    }
    lastErr = `${model} → HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`;
    // 404 (model retired) or persistent 429/503: fall through to the next candidate.
  }
  throw new Error(lastErr);
}

/** @returns {Promise<Array<{area, description, category, severity}>>} */
export async function extractIssuesLLM(walk) {
  const names = scrubNameList();
  const map = new Map();
  const payload = {
    lodge: walk.lodge,
    floor: `${walk.floor} floor`,
    areas: walk.areas
      .filter((a) => a.note || a.statuses.length)
      .map((a) => ({
        area: a.area,
        checked: a.statuses,
        note: a.note ? scrub(a.note, names, map) : undefined,
      })),
    floorComments: walk.comments ? scrub(walk.comments, names, map) : undefined,
  };

  const text = await callGemini({
    contents: [{ role: 'user', parts: [{ text: `${INSTRUCTIONS}\n\nWalkthrough notes:\n${JSON.stringify(payload, null, 1)}` }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.1,
    },
  });

  let items;
  try { items = JSON.parse(text); } catch { throw new Error('Gemini returned unparseable JSON'); }
  if (!Array.isArray(items)) throw new Error('Gemini result is not an array');

  return items
    .filter((i) => i && typeof i.description === 'string' && i.description.trim().length >= 4)
    .map((i) => ({
      area: AREAS.includes(i.area) ? i.area : 'General',
      description: unscrub(i.description.trim().slice(0, 200), map),
      category: CATEGORIES.includes(i.category) ? i.category : 'other',
      severity: i.severity === 'high' ? 'high' : 'normal',
    }));
}
