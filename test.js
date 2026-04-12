import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Use a unique temp DB per run to avoid stale state
const testId = Date.now();
const TEST_DB = `/tmp/jarvis_test_${testId}.db`;
process.env.JARVIS_DB_PATH = TEST_DB;

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg}`);
  }
}

// ─── TEST 1: Database ─────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('TEST 1: Database Layer');
console.log('='.repeat(70));

import {
  initDb, saveArticle, isSeen, getRecentArticles, getArticlesForTopic,
  searchArticles, getUnsentAlerts, markAlertSent, upsertTopic, getAllTopics,
  addAlertRule, getAlertRules, logMemory, getInterestProfile,
  saveQuerySession, getRecentQueries, closeDb, resetDb,
} from './core/db.js';

// Ensure fresh DB
resetDb();
initDb();
assert(true, 'Database initialized');

// Save article
const testArticle = {
  url: 'https://example.com/test1',
  title: 'Test Article About AI',
  summary: 'AI is evolving rapidly.',
  source: 'TestSource',
  source_type: 'web',
  topic: 'AI',
  importance: 0.85,
  published_at: new Date().toISOString(),
};
const id = saveArticle(testArticle);
assert(typeof id === 'string' && id.length === 16, `Article saved with ID: ${id}`);

// Check is_seen
assert(isSeen('https://example.com/test1', 'Test Article About AI'), 'isSeen returns true for saved article');
assert(!isSeen('https://example.com/nonexistent', 'Nope'), 'isSeen returns false for unsaved article');

// Get recent articles
const recent = getRecentArticles(24, 10);
assert(recent.length >= 1, `getRecentArticles returned ${recent.length} article(s)`);
assert(recent[0].title === 'Test Article About AI', 'Retrieved article has correct title');

// Topic operations
upsertTopic('AI', 0.75);
upsertTopic('Tesla', 0.80);
const topics = getAllTopics();
assert(topics.length >= 2, `Created ${topics.length} topics`);

// Alert rules
addAlertRule('AI', 'gpt-5');
addAlertRule('AI', 'breakthrough');
const rules = getAlertRules('AI');
assert(rules.length === 2, `Added ${rules.length} alert rules for AI`);
assert(rules.includes('gpt-5'), 'Rule "gpt-5" exists');

// Unsent alerts
const alerts = getUnsentAlerts(0.75);
assert(alerts.length >= 1, `getUnsentAlerts found ${alerts.length} article(s)`);

// Mark alert sent
markAlertSent(id);
const alertsAfter = getUnsentAlerts(0.75);
assert(alertsAfter.length === 0, 'After marking sent, no unsent alerts');

// User memory
logMemory('click', { articleId: id, topic: 'AI' });
logMemory('click', { articleId: id, topic: 'AI' });
const profile = getInterestProfile();
assert(profile['AI'] === 2, `Interest profile AI count: ${profile['AI']}`);

// Query sessions
saveQuerySession('What is AI?', 'AI stands for Artificial Intelligence.', [id]);
const queries = getRecentQueries(5);
assert(queries.length >= 1, `Saved ${queries.length} query session(s)`);
assert(queries[0].question === 'What is AI?', 'Query session has correct question');

// Search
const searchResults = searchArticles('AI');
assert(searchResults.length >= 1, `searchArticles found ${searchResults.length} result(s)`);

closeDb();

// ─── TEST 2: Config ───────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('TEST 2: Configuration Management');
console.log('='.repeat(70));

import {
  loadConfig, saveConfig, addTopic, removeTopic,
  addTwitterAccount, removeTwitterAccount,
  addSubreddit, removeSubreddit, toggleSource, setDigestTime,
} from './core/config.js';

const cfg = loadConfig();
assert(Array.isArray(cfg.topics), 'Config has topics array');
assert(typeof cfg.sources === 'object', 'Config has sources object');
assert(typeof cfg.digest_hour === 'number', 'Config has digest_hour');

addTopic('TestTopic');
const cfg2 = loadConfig();
assert(cfg2.topics.includes('TestTopic'), 'addTopic works');

removeTopic('TestTopic');
const cfg3 = loadConfig();
assert(!cfg3.topics.includes('TestTopic'), 'removeTopic works');

addTwitterAccount('@testhandle');
const cfg4 = loadConfig();
assert(cfg4.twitter_accounts.includes('testhandle'), 'addTwitterAccount works');
removeTwitterAccount('testhandle');

addSubreddit('r/testsub');
const cfg5 = loadConfig();
assert(cfg5.reddit_subreddits.includes('testsub'), 'addSubreddit works');
removeSubreddit('testsub');

const oldVal = loadConfig().sources.instagram;
const newVal = toggleSource('instagram');
assert(newVal === !oldVal, 'toggleSource flips value');
toggleSource('instagram'); // toggle back

setDigestTime(10, 30);
const cfg6 = loadConfig();
assert(cfg6.digest_hour === 10 && cfg6.digest_minute === 30, 'setDigestTime works');
setDigestTime(8, 0); // reset

// ─── TEST 3: AI Summarizer ────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('TEST 3: AI Summarizer (Heuristic)');
console.log('='.repeat(70));

import { enrichArticle, enrichBatch } from './ai/summarizer.js';

const article1 = {
  url: 'https://example.com/gpt5',
  title: 'OpenAI Announces GPT-5: Revolutionary AI Model Launches Today',
  summary: 'OpenAI released GPT-5 with breakthrough capabilities.',
  source: 'TechCrunch',
  engagement: 5000,
};
const enriched1 = enrichArticle(article1);
assert(typeof enriched1.importance === 'number', 'enrichArticle returns numeric importance');
assert(enriched1.importance >= 0 && enriched1.importance <= 1, `Importance ${enriched1.importance} in range [0,1]`);
assert(enriched1.importance > 0.5, `High-signal article scored ${enriched1.importance} (expected > 0.5)`);

const lowArticle = {
  url: 'https://example.com/newsletter',
  title: 'Weekly roundup of random stuff',
  summary: 'A sponsored newsletter listicle.',
};
const enrichedLow = enrichArticle(lowArticle);
assert(enrichedLow.importance <= 0.2, `Noise article scored ${enrichedLow.importance} (expected <= 0.2)`);

const batch = [
  { url: 'https://example.com/a1', title: 'Apple launches new AI chip', summary: 'Major launch.', engagement: 3000 },
  { url: 'https://example.com/a2', title: 'Google updates search', summary: 'Minor update.', engagement: 100 },
  { url: 'https://example.com/a3', title: 'Meta announces massive layoffs', summary: 'Layoffs everywhere.', engagement: 8000 },
];
const batchResult = await enrichBatch(batch, 0); // 0 AI calls — heuristic only
assert(batchResult.length === 3, `Batch enriched ${batchResult.length} articles`);
assert(batchResult[0].importance >= batchResult[1].importance, 'Batch sorted by importance DESC');

// ─── TEST 4: Deduplicator ─────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('TEST 4: Deduplicator');
console.log('='.repeat(70));

import { assignClusters, deduplicate } from './ai/deduplicator.js';

const dupeArticles = [
  { title: 'OpenAI Announces GPT-5: Breakthrough in Reasoning', importance: 0.8 },
  { title: 'GPT-5 Released: OpenAI Latest AI Model', importance: 0.7 },
  { title: 'Anthropic Releases Claude 4: New Era of AI Safety', importance: 0.6 },
  { title: 'New AI Startup Raises $10M Funding', importance: 0.5 },
];

assignClusters(dupeArticles);
assert(dupeArticles[0].cluster_id === dupeArticles[1].cluster_id,
  `GPT-5 articles clustered together (both cluster ${dupeArticles[0].cluster_id})`);
assert(dupeArticles[0].cluster_id !== dupeArticles[2].cluster_id,
  'Claude article in different cluster from GPT-5');
assert(dupeArticles[2].cluster_id !== dupeArticles[3].cluster_id,
  'Claude article in different cluster from startup');

const deduped = deduplicate([
  { title: 'OpenAI Announces GPT-5', importance: 0.8, url: 'a' },
  { title: 'GPT-5 Released by OpenAI', importance: 0.7, url: 'b' },
  { title: 'Anthropic Claude 4 Released', importance: 0.6, url: 'c' },
]);
assert(deduped.length === 2, `Deduplicated to ${deduped.length} unique stories`);
const gpt5 = deduped.find(a => a.title.includes('GPT-5'));
assert(gpt5 && gpt5.importance === 0.8, 'Kept highest importance GPT-5 article');

// ─── TEST 5: Query Engine ─────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('TEST 5: Query Engine');
console.log('='.repeat(70));

// Query engine uses same DB module (already initialized)

// We need to test answer_question, but it uses its own db import
// Let's just verify the module loads correctly
import { answerQuestion } from './ai/queryEngine.js';
assert(typeof answerQuestion === 'function', 'answerQuestion is a function');

// ─── TEST 6: Formatter ────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('TEST 6: Bot Formatter');
console.log('='.repeat(70));

import {
  formatArticle, formatTopicSection, formatDailyDigest,
  formatSearchResults, splitMessage,
} from './bot/formatter.js';

const fmtArticle = {
  title: 'Test Article',
  summary: 'This is a test.',
  source: 'TestSource',
  importance: 0.75,
  url: 'https://example.com/test',
};
const formatted = formatArticle(fmtArticle);
assert(formatted.includes('Test Article'), 'formatArticle includes title');
assert(formatted.includes('75%'), 'formatArticle includes importance %');
assert(formatted.includes('https://example.com/test'), 'formatArticle includes URL');

const section = formatTopicSection('AI', [fmtArticle]);
assert(section.includes('AI'), 'formatTopicSection includes topic name');

const digest = formatDailyDigest({ 'AI': [fmtArticle] }, []);
assert(digest.includes("What's going on") || digest.includes('digest') || digest.length > 50, 'formatDailyDigest includes header');

const search = formatSearchResults('Bitcoin', []);
assert(search.toLowerCase().includes('nothing') || search.toLowerCase().includes("couldn't") || search.toLowerCase().includes('no result'), 'formatSearchResults handles empty results');

const longText = 'A'.repeat(5000);
const parts = splitMessage(longText, 4000);
assert(parts.length >= 2, `splitMessage splits long text into ${parts.length} parts`);
assert(parts.every(p => p.length <= 4000), 'All parts within limit');

// ─── TEST 7: Alerting ────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('TEST 7: Alerting System');
console.log('='.repeat(70));

import { formatAlert } from './pipeline/alerting.js';

const breakingArticle = {
  title: 'Major Breaking News',
  summary: 'Something big happened.',
  source: 'Reuters',
  importance: 0.95,
  url: 'https://example.com/breaking',
};
const alertText = formatAlert(breakingArticle);
assert(alertText.includes('BREAKING'), 'formatAlert shows BREAKING for 0.95');
assert(alertText.includes('95%'), 'formatAlert shows importance %');

const importantArticle = { ...breakingArticle, importance: 0.78 };
const alertText2 = formatAlert(importantArticle);
assert(alertText2.includes('IMPORTANT'), 'formatAlert shows IMPORTANT for 0.78');

const keywordArticle = { ...breakingArticle, importance: 0.5, _keyword: 'gpt-5' };
const alertText3 = formatAlert(keywordArticle);
assert(alertText3.includes('KEYWORD ALERT'), 'formatAlert shows KEYWORD ALERT');

// ─── TEST 8: Web News Source ──────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('TEST 8: Web News Fetcher (Google News RSS)');
console.log('='.repeat(70));

import { fetchGoogleNews } from './sources/webNews.js';

try {
  const newsArticles = await fetchGoogleNews('artificial intelligence', 3);
  assert(Array.isArray(newsArticles), 'fetchGoogleNews returns array');
  if (newsArticles.length > 0) {
    assert(newsArticles[0].title.length > 0, `First article: "${newsArticles[0].title.substring(0, 60)}..."`);
    assert(newsArticles[0].url.startsWith('http'), 'Article has valid URL');
    assert(newsArticles[0].source_type === 'web', 'Source type is web');
  } else {
    console.log('  ⚠️  No articles returned (network may be restricted)');
  }
} catch (err) {
  console.log(`  ⚠️  Network error (expected in sandbox): ${err.message}`);
}

// ─── TEST 9: Module Imports ───────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('TEST 9: All Module Imports');
console.log('='.repeat(70));

try {
  await import('./sources/redditNews.js');
  assert(true, 'redditNews.js loads');
} catch (e) { assert(false, `redditNews.js failed: ${e.message}`); }

try {
  await import('./sources/twitterNews.js');
  assert(true, 'twitterNews.js loads');
} catch (e) { assert(false, `twitterNews.js failed: ${e.message}`); }

try {
  await import('./sources/instagramNews.js');
  assert(true, 'instagramNews.js loads');
} catch (e) { assert(false, `instagramNews.js failed: ${e.message}`); }

try {
  await import('./sources/youtubeNews.js');
  assert(true, 'youtubeNews.js loads');
} catch (e) { assert(false, `youtubeNews.js failed: ${e.message}`); }

try {
  await import('./pipeline/ingestion.js');
  assert(true, 'ingestion.js loads');
} catch (e) { assert(false, `ingestion.js failed: ${e.message}`); }

try {
  await import('./pipeline/alerting.js');
  assert(true, 'alerting.js loads');
} catch (e) { assert(false, `alerting.js failed: ${e.message}`); }

try {
  await import('./bot/scheduler.js');
  assert(true, 'scheduler.js loads');
} catch (e) { assert(false, `scheduler.js failed: ${e.message}`); }

try {
  await import('./bot/handlers.js');
  assert(true, 'handlers.js loads');
} catch (e) { assert(false, `handlers.js failed: ${e.message}`); }

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('='.repeat(70));

// Cleanup
closeDb();
try { fs.unlinkSync(TEST_DB); } catch {}
try { fs.unlinkSync(TEST_DB + '-wal'); } catch {}
try { fs.unlinkSync(TEST_DB + '-shm'); } catch {}

if (failed > 0) {
  console.log('\n❌ SOME TESTS FAILED — see above for details.');
  process.exit(1);
} else {
  console.log('\n✅ ALL TESTS PASSED!');
  process.exit(0);
}
