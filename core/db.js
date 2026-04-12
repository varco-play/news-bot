// Uses Node.js built-in SQLite (available since Node 22.5)
// Zero external dependencies — works on every platform with no compilation
import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getDbPath() {
  return process.env.JARVIS_DB_PATH || path.join(__dirname, '..', 'jarvis.db');
}

let _db = null;

function getDb() {
  if (!_db) {
    _db = new DatabaseSync(getDbPath());
    _db.exec('PRAGMA journal_mode = WAL');
    _db.exec('PRAGMA foreign_keys = ON');
  }
  return _db;
}

export function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      full_text TEXT,
      source TEXT DEFAULT '',
      source_type TEXT DEFAULT 'web',
      topic TEXT DEFAULT '',
      importance REAL DEFAULT 0.0,
      published_at TEXT DEFAULT '',
      fetched_at TEXT DEFAULT (datetime('now')),
      sent_digest INTEGER DEFAULT 0,
      sent_alert INTEGER DEFAULT 0,
      cluster_id TEXT DEFAULT '',
      engagement INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_articles_topic ON articles(topic);
    CREATE INDEX IF NOT EXISTS idx_articles_fetched ON articles(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_articles_importance ON articles(importance);

    CREATE TABLE IF NOT EXISTS topics (
      name TEXT PRIMARY KEY,
      alert_threshold REAL DEFAULT 0.75,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      keyword TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(topic, keyword)
    );

    CREATE TABLE IF NOT EXISTS user_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      article_id TEXT,
      topic TEXT,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS query_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT,
      article_ids TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

export function makeId(url, title) {
  const hash = crypto.createHash('sha256').update(`${url}|${title}`).digest('hex');
  return hash.substring(0, 16);
}

export function isSeen(url, title) {
  const db = getDb();
  const id = makeId(url, title);
  const stmt = db.prepare('SELECT id FROM articles WHERE id = ?');
  const row = stmt.get(id);
  return !!row;
}

export function saveArticle(article) {
  const db = getDb();
  const id = makeId(article.url, article.title);
  db.prepare(`
    INSERT OR IGNORE INTO articles (id, url, title, summary, full_text, source, source_type, topic, importance, published_at, cluster_id, engagement)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    article.url || '',
    article.title || '',
    article.summary || '',
    article.full_text || null,
    article.source || '',
    article.source_type || 'web',
    article.topic || '',
    article.importance || 0.0,
    article.published_at || new Date().toISOString(),
    article.cluster_id || '',
    article.engagement || 0
  );
  return id;
}

export function getRecentArticles(hours = 24, limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM articles
    WHERE fetched_at >= datetime('now', ?)
    ORDER BY importance DESC
    LIMIT ?
  `).all(`-${hours} hours`, limit);
}

export function getArticlesForTopic(topic, hours = 48, limit = 10, minImportance = 0.0) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM articles
    WHERE topic = ? AND fetched_at >= datetime('now', ?) AND importance >= ?
    ORDER BY importance DESC
    LIMIT ?
  `).all(topic, `-${hours} hours`, minImportance, limit);
}

export function searchArticles(query, limit = 20) {
  const db = getDb();
  const pattern = `%${query}%`;
  return db.prepare(`
    SELECT * FROM articles
    WHERE title LIKE ? OR summary LIKE ?
    ORDER BY importance DESC
    LIMIT ?
  `).all(pattern, pattern, limit);
}

export function getUnsentAlerts(minImportance = 0.75) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM articles
    WHERE sent_alert = 0 AND importance >= ?
    AND fetched_at >= datetime('now', '-6 hours')
    ORDER BY importance DESC
  `).all(minImportance);
}

export function markAlertSent(articleId) {
  const db = getDb();
  db.prepare('UPDATE articles SET sent_alert = 1 WHERE id = ?').run(articleId);
}

export function markDigestSent(articleId) {
  const db = getDb();
  db.prepare('UPDATE articles SET sent_digest = 1 WHERE id = ?').run(articleId);
}

// --- Topics ---

export function upsertTopic(name, alertThreshold = 0.75) {
  const db = getDb();
  db.prepare(`
    INSERT INTO topics (name, alert_threshold) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET alert_threshold = ?, active = 1
  `).run(name, alertThreshold, alertThreshold);
}

export function deactivateTopic(name) {
  const db = getDb();
  db.prepare('UPDATE topics SET active = 0 WHERE name = ?').run(name);
}

export function getAllTopics() {
  const db = getDb();
  return db.prepare('SELECT * FROM topics WHERE active = 1 ORDER BY name').all();
}

// --- Alert Rules ---

export function addAlertRule(topic, keyword) {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO alert_rules (topic, keyword) VALUES (?, ?)').run(topic, keyword.toLowerCase());
}

export function removeAlertRule(topic, keyword) {
  const db = getDb();
  db.prepare('DELETE FROM alert_rules WHERE topic = ? AND keyword = ?').run(topic, keyword.toLowerCase());
}

export function getAlertRules(topic) {
  const db = getDb();
  const rows = db.prepare('SELECT keyword FROM alert_rules WHERE topic = ?').all(topic);
  return rows.map(r => r.keyword);
}

export function getAllAlertRules() {
  const db = getDb();
  return db.prepare('SELECT * FROM alert_rules ORDER BY topic, keyword').all();
}

// --- User Memory ---

export function logMemory(eventType, { articleId = null, topic = null, detail = null } = {}) {
  const db = getDb();
  db.prepare('INSERT INTO user_memory (event_type, article_id, topic, detail) VALUES (?, ?, ?, ?)').run(eventType, articleId, topic, detail);
}

export function getInterestProfile() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT topic, COUNT(*) as cnt FROM user_memory
    WHERE event_type IN ('click', 'feedback_up') AND topic IS NOT NULL
    GROUP BY topic ORDER BY cnt DESC
  `).all();
  const profile = {};
  for (const r of rows) {
    profile[r.topic] = r.cnt;
  }
  return profile;
}

// --- Query Sessions ---

export function saveQuerySession(question, answer, articleIds = []) {
  const db = getDb();
  db.prepare('INSERT INTO query_sessions (question, answer, article_ids) VALUES (?, ?, ?)').run(
    question, answer, JSON.stringify(articleIds)
  );
}

export function getRecentQueries(limit = 10) {
  const db = getDb();
  return db.prepare('SELECT * FROM query_sessions ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function resetDb() {
  closeDb();
}
