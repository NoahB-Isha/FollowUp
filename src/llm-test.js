import { q } from './db.js';
import { normalizeSubmission } from './normalize.js';
import { extractIssuesLLM, llmAvailable, llmModel } from './extract-llm.js';
import { extractIssues } from './extract.js';
import { scrub } from './anonymize.js';
import { scrubNameList } from './config.js';

/**
 * Dry-run the Gemini extractor against one already-synced walkthrough and
 * compare with the rule-based output. Nothing is written to the database.
 * Usage: npm run llm:test [-- <walkthrough id>]
 */

const id = process.argv[2];
const row = id
  ? q('SELECT raw_json FROM walkthroughs WHERE id = ?').get(id)
  : q('SELECT raw_json FROM walkthroughs ORDER BY walk_date DESC LIMIT 1').get();
if (!row) { console.error('No walkthroughs in the DB — run npm run sync first.'); process.exit(1); }

const walk = normalizeSubmission(JSON.parse(row.raw_json));
console.log(`Walkthrough: ${walk.lodge} ${walk.floor} floor, ${walk.walkDate}\n`);

// Show what anonymization would send (proof nothing personal leaves).
const names = scrubNameList();
const map = new Map();
console.log('--- Anonymization preview (what Gemini would see) ---');
for (const a of walk.areas.filter((x) => x.note)) {
  console.log(`  [${a.area}] ${scrub(a.note, names, map)}`);
}
if (walk.comments) console.log(`  [Comments] ${scrub(walk.comments, names, map)}`);
console.log(map.size ? `  (scrubbed: ${[...map.keys()].join(', ')})` : '  (nothing needed scrubbing)');

console.log('\n--- Rule-based extraction ---');
for (const i of extractIssues(walk)) console.log(`  [${i.area}] (${i.category}${i.severity === 'high' ? ', HIGH' : ''}) ${i.description}`);

if (!llmAvailable()) {
  console.log('\nGEMINI_API_KEY not set — add it to .env to test the LLM path.');
  process.exit(0);
}
console.log(`\n--- ${llmModel()} extraction ---`);
try {
  for (const i of await extractIssuesLLM(walk)) {
    console.log(`  [${i.area}] (${i.category}${i.severity === 'high' ? ', HIGH' : ''}) ${i.description}`);
  }
} catch (err) {
  console.error('LLM extraction failed:', err.message);
  process.exit(1);
}
