import { app, scrubNameList } from './config.js';
import { scrub, unscrub } from './anonymize.js';
import { localAvailable, localModelName, ensureLocalServer } from './local-llm.js';

/**
 * LLM issue extraction with two providers, chosen by config
 * ("llmExtraction" in config/app.json):
 *   "ollama" — a local model via Ollama (http://localhost:11434). Nothing
 *              leaves the machine at all. Model: OLLAMA_MODEL (qwen3:4b).
 *   "gemini" — Google Gemini free tier. Notes are anonymized before they
 *              leave the machine (names → Person1/2, emails/phones masked)
 *              and restored in the results; who walked, contacts, and
 *              photos are never sent.
 *   false    — disabled; the rule-based splitter in extract.js is used.
 * Sync falls back to the rules on any failure either way, so ingest never
 * depends on an LLM being reachable.
 */

export function llmProvider() {
  const v = app.llmExtraction;
  if (v === 'auto') return localAvailable() ? 'local' : 'ollama';
  if (v === 'local') return 'local';
  if (v === 'ollama') return 'ollama';
  if (v === 'gemini' || v === true) return 'gemini';
  return null;
}

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

// Same schema in standard JSON Schema (Ollama structured outputs).
const JSON_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      area: { type: 'string', enum: AREAS },
      description: { type: 'string' },
      category: { type: 'string', enum: CATEGORIES },
      severity: { type: 'string', enum: ['normal', 'high'] },
    },
    required: ['area', 'description', 'category', 'severity'],
  },
};

const INSTRUCTIONS = `You convert dorm walkthrough notes into a list of discrete, actionable PROBLEMS. Only problems — things someone must fix, clean, restock, or repair.

Rules:
- One entry per distinct problem. Split run-on lists; if a note names several cubes with the same problem, emit one entry per cube and keep the cube number in the description.
- Emit NOTHING for: areas that are fine, positive observations ("clean", "working", "organized", "no leaks"), rooms marked N/A / locked / not in use / sadhana room / film room / office, statements about future plans, and meta-comments about the form itself. An empty array is a correct answer when nothing needs action.
- A "flagged" value on an area means an inspector checked that problem box — include it as a problem even without a note.
- Keep each description concise (under 120 characters), faithful to the original wording, with light spelling cleanup. Keep Person1/Person2-style placeholders exactly as written.
- area: use the area the note belongs to; floor-level comments go under "General".
- category: housekeeping (cleaning, tidying, linens, trash, smells), maintenance (repairs, lights, leaks, mold, paint, fixtures, appliances), supplies (restocking, missing items/equipment), other.
- severity: "high" only for mold, leaks, damage, safety hazards, or anything marked urgent/immediate; otherwise "normal". Fire risks are always high: anything burning (incense, candles), scorched/blackened walls or heaters, blocked doorways/exits.
- NEVER combine several problems into one entry. Each description states exactly ONE problem. A comma-list in a note means several entries.

Example — {"area": "Wing B", "note": "old linens on beds, cube 3- no bulb cube 5- no bulb, smells like mildew"} becomes:
[{"area":"Wing B","description":"Old linens left on beds","category":"housekeeping","severity":"normal"},
 {"area":"Wing B","description":"Cube 3: light bulb missing","category":"maintenance","severity":"normal"},
 {"area":"Wing B","description":"Cube 5: light bulb missing","category":"maintenance","severity":"normal"},
 {"area":"Wing B","description":"Mildew smell","category":"housekeeping","severity":"high"}]

Return ONLY the JSON array of problems.`;

// Checkbox states that themselves signal a problem — the only ones worth
// sending. Positive checks ("Beds neat", "Toilet clean") stay home so the
// model can't echo them back as issues.
const ACTIONABLE_FLAGS = new Set([
  'Needs attention', 'Needs cleaning/restocking', 'Needs restocking/organization', 'Needs service',
]);

export function llmAvailable() {
  const p = llmProvider();
  if (p === 'gemini') return !!process.env.GEMINI_API_KEY;
  if (p === 'local') return localAvailable();
  return p === 'ollama'; // reachability is proven per-call; failures fall back to rules
}

export function ollamaModel() {
  return process.env.OLLAMA_MODEL || 'qwen3:4b';
}

function ollamaUrl() {
  return (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
}

export function llmLabel() {
  const p = llmProvider();
  if (p === 'local') return `local:${localModelName()}`;
  if (p === 'ollama') return `ollama:${ollamaModel()}`;
  return llmModel();
}

/** Bundled llama-server: OpenAI-compatible endpoint with schema-constrained decoding. */
async function callLocal(prompt) {
  const base = await ensureLocalServer();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'issues', strict: true, schema: JSON_SCHEMA },
      },
      temperature: 0.1,
      max_tokens: 2000, // cap runaway generation; truncation → parse fail → rules
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new Error(`local llm HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`local llm returned no content (finish: ${data.choices?.[0]?.finish_reason ?? 'unknown'})`);
  return text;
}

async function callOllama(prompt) {
  const res = await fetch(`${ollamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel(),
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      think: false, // qwen3 & friends: skip the reasoning preamble
      format: JSON_SCHEMA,
      // num_predict caps runaway generation — small models can loop forever
      // inside a schema-valid array; a truncated reply fails parsing and
      // falls back to rules instead of hanging the sync.
      options: { temperature: 0.1, num_ctx: 8192, num_predict: 2000 },
    }),
    // Generous: the first call after boot also loads the model into memory.
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  const text = data.message?.content;
  if (!text) throw new Error('Ollama returned no content');
  return text;
}

export function llmModel() {
  return process.env.GEMINI_MODEL || 'gemini-flash-latest';
}

/** Configured model first, then known-good alternates — model ids churn on the free tier. */
function modelCandidates() {
  return [...new Set([llmModel(), 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3-flash-preview'])];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(body) {
  let lastErr = 'no model attempted';
  for (const model of modelCandidates()) {
    // Any failure on this model — timeout, network, HTTP error, empty reply —
    // falls through to the next candidate rather than aborting extraction.
    try {
      const send = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000), // a hung connection must not stall sync
      });
      let res = await send();
      if (res.status === 429 || res.status === 503) { // rate limit / overload — wait once, retry once
        await sleep(15000);
        res = await send();
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error(`no text (finishReason: ${data.candidates?.[0]?.finishReason ?? 'unknown'})`);
      return text;
    } catch (err) {
      lastErr = `${model} → ${err.message}`;
    }
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
      .map((a) => ({
        area: a.area,
        flagged: a.statuses.filter((s) => ACTIONABLE_FLAGS.has(s)),
        note: a.note ? scrub(a.note, names, map) : undefined,
      }))
      .filter((a) => a.flagged.length || a.note)
      .map((a) => ({ ...a, flagged: a.flagged.length ? a.flagged : undefined })),
    floorComments: walk.comments ? scrub(walk.comments, names, map) : undefined,
  };

  const prompt = `${INSTRUCTIONS}\n\nWalkthrough notes:\n${JSON.stringify(payload, null, 1)}`;
  const provider = llmProvider();
  const text = provider === 'local'
    ? await callLocal(prompt)
    : provider === 'ollama'
    ? await callOllama(prompt)
    : await callGemini({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    });

  let items;
  try { items = JSON.parse(text); } catch { throw new Error('Gemini returned unparseable JSON'); }
  if (!Array.isArray(items)) throw new Error('Gemini result is not an array');

  // Deterministic safety net: some things are high-severity no matter what
  // the model judged (small local models get lazy about severity).
  const ALWAYS_HIGH = /\b(incense|candle|burning|scorch\w*|blacken\w*|mold|mould|leak\w*|smoke alarm|blocked (exit|door))\b/i;

  return items
    .filter((i) => i && typeof i.description === 'string' && i.description.trim().length >= 4)
    .map((i) => {
      const description = unscrub(i.description.trim().slice(0, 200), map);
      return {
        area: AREAS.includes(i.area) ? i.area : 'General',
        description,
        category: CATEGORIES.includes(i.category) ? i.category : 'other',
        severity: i.severity === 'high' || ALWAYS_HIGH.test(description) ? 'high' : 'normal',
      };
    });
}
