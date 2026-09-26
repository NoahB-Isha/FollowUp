import { wingInfo } from './config.js';

/**
 * Turns walkthrough free text + checkbox state into discrete issue candidates.
 * Deliberately rule-based: everything runs on-campus with no external calls.
 * A smarter extractor (e.g. a local LLM via Ollama) can replace extractIssues()
 * without touching the rest of the pipeline.
 */

// Notes that mean "this area isn't a dorm / wasn't inspectable" — not issues.
const NOT_APPLICABLE = /\b(n\/?a|not in use|no access|don'?t have access|locked|sadhana room|film room|wellness office|resident area|out of order right now|bathroom demo|under renovation|being renovated|renovation in progress)\b/i;

// First match wins.
const CATEGORY_RULES = [
  ['maintenance', /\b(light ?bulbs?|bulbs?|lights? (not|now|no[tn]?) working|no light|overhead light|fixture|leak(y|ing|s)?|mold|heater|paint(ing)?|blinds?|smoke alarm|exhaust|handle|drywall|brackets?|damage|exit sign|spindles?|handrail(ing)?|wires?|ropes?|melted|electrical|needs service|water machine|filter)\b/i],
  ['supplies', /\b(restock(ing)?|stock(ed|ing)?|supplies|supply|paper towels?|soaps?|gloves|caddy|mop n bucket|broom|dustpan|laundry basket|toilet paper|tissue|night ?stands?|hooks? (needed|need|in each)|cube numbers?|missing linens|linens? (missing|needed|need)|bedsheets|pillows?)\b/i],
  ['housekeeping', /\b(clean(ing|ed)?|dirty|dust(y|ing)?|vacuum|mop(ped|ping)?|messy|organiz\w*|trash|mildew|soiled|filthy|linens?|beds?|blankets?|towels?|mats?|cobwebs?|soot|smells?|sweep(ing)?|shoes|clutter|personal (items?|belongings?|things?|stuff)|stuff)\b/i],
];

const HIGH_SEVERITY = /\b(immediate(ly)?|urgent|asap|really bad|mold|leak(ing)?|damage|out of order|broken|filthy|melted|smoke alarm|should not be used)\b/i;

// Statements that report the ABSENCE of a problem are never issues, even
// though they contain negation words ("no water leaks noted", "not missing
// any half walls"). Checked first, immune to the negation veto below.
const ALL_CLEAR = /\b(no (water |signs? of )?(leaks?|leaking|issues?|problems?|damage|mold|concerns?)( noted| seen| found| observed)?|not missing( any)?|nothing (missing|needed|wrong|to report)|all (good|set|fine|clear|ok(ay)?|accounted for)|in (good|great|working) (shape|condition|order))\b/i;

// References to evidence, not problems ("see photos", "yes see attached").
const PHOTO_REF = /^(yes[,.:\s]+)?(see|per|refer to)\s+(the\s+)?(photos?|pics?|pictures?|attached)\b[^a-z]*$/i;

// Positive/audit observations ("all toilets working no leaking") are not issues —
// unless a negation word signals the sentence actually reports a problem.
const POSITIVE_NOTE = /\b(working( well| fine)?|functional|functioning( well)?|no leak\w*|no issues?|looks? good|all good|clean and in order|saw improvements?|very hot)\b/i;
const NEGATION = /\b(not|isn'?t|aren'?t|don'?t|doesn'?t|won'?t|stopped|barely|only|missing|except|but|n)\b/i;

function isPositiveObservation(text) {
  if (ALL_CLEAR.test(text)) return true;
  if (PHOTO_REF.test(text.trim())) return true;
  return POSITIVE_NOTE.test(text) && !NEGATION.test(text);
}

// Default category by section when a fragment doesn't match any rule.
const SECTION_DEFAULT = {
  'Restrooms': 'housekeeping',
  'Cleaning supplies': 'supplies',
  'Cleaning solutions': 'supplies',
  'Paper products': 'supplies',
  'Water dispenser': 'maintenance',
  'Maintenance': 'maintenance',
};

// Checkbox states that are themselves actionable.
const STATUS_ISSUES = {
  'Needs attention': null, // only meaningful with a note; alone it becomes a generic issue
  'Needs cleaning/restocking': 'housekeeping',
  'Needs restocking/organization': 'supplies',
  'Needs service': 'maintenance',
};

export function categorize(text, fallback = 'other') {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return fallback;
}

export function severity(text) {
  return HIGH_SEVERITY.test(text) ? 'high' : 'normal';
}

export function isNotApplicable(note) {
  return !!note && note.length < 70 && NOT_APPLICABLE.test(note);
}

/** Split a run-on walkthrough note into individual actionable fragments. */
export function splitNote(text) {
  if (!text) return [];
  let t = text.replace(/\s+/g, ' ').trim();
  // Run-on cube lists ("cube 7- needs bulb cube 1- needs bulb") → break before each cube.
  t = t.replace(/\s+(?=cubes?\s*#?\d)/gi, '\n');
  let parts = t.split(/[\n.;]+/);
  // Comma-joined lists → split further (run-ons like "signs of mold, see
  // photos, need new caulking, need filter for ac" must become one entry each).
  parts = parts.flatMap((p) => (p.length > 80 ? p.split(/,\s*/) : [p]));
  return parts
    .map((p) => p.trim().replace(/^[-–,:]+\s*/, ''))
    .filter((p) => p.length >= 4 && /[a-z]/i.test(p));
}

/**
 * @param {object} walk normalized walkthrough
 * @returns {Array<{area, description, category, severity}>}
 */
export function extractIssues(walk) {
  const out = [];
  const push = (area, description, fallbackCat) => {
    // Strip question-form filler ("Yes signs of mold" → "signs of mold").
    const desc = description.trim().replace(/^(yes|yeah|yep)[,.:\s]+(?=\S)/i, '');
    if (!desc || isPositiveObservation(desc)) return;
    out.push({
      area,
      description: desc,
      category: categorize(desc, fallbackCat ?? 'other'),
      severity: severity(desc),
    });
  };

  for (const a of walk.areas) {
    if (a.kind === 'wing') {
      const wing = a.area.replace('Wing ', '');
      if (!wingInfo(walk.lodge, wing).inspect) continue;
      if (isNotApplicable(a.note)) continue;
      const fragments = splitNote(a.note);
      for (const f of fragments) push(a.area, f, 'housekeeping');
      if (!fragments.length && a.statuses.includes('Needs attention')) {
        push(a.area, 'Marked "needs attention" (no detail given)', 'housekeeping');
      }
    } else {
      if (isNotApplicable(a.note)) continue;
      const fallback = SECTION_DEFAULT[a.area];
      for (const s of a.statuses) {
        const cat = STATUS_ISSUES[s];
        if (cat) push(a.area, `Marked "${s.toLowerCase()}"`, cat);
      }
      for (const f of splitNote(a.note)) push(a.area, f, fallback);
    }
  }

  // Floor-level comments often carry the most important follow-ups.
  for (const f of splitNote(walk.comments)) {
    // Skip meta-comments about the form itself and status notes like "bathroom demo".
    if (/\b(form|option|field|category)\b/i.test(f) && /\bneed(ed|s)?\b/i.test(f)) continue;
    if (/^test$/i.test(f)) continue;
    if (NOT_APPLICABLE.test(f) && f.length < 40) continue;
    push('General', f);
  }

  return out;
}
