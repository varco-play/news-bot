const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or',
  'nor', 'not', 'so', 'yet', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too',
  'very', 'just', 'about', 'up', 'its', 'it', 'this', 'that', 'these',
  'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him',
  'his', 'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who',
  'whom', 'how', 'all', 'any', 'new', 'also',
]);

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function ngrams(text) {
  const words = normalize(text);
  const grams = new Set(words); // unigrams
  for (let i = 0; i < words.length - 1; i++) {
    grams.add(`${words[i]}_${words[i + 1]}`); // bigrams
  }
  return grams;
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function assignClusters(articles, threshold = 0.10) {
  const ngramSets = articles.map(a => ngrams(a.title || ''));
  let nextCluster = 0;
  const clusterMap = new Array(articles.length).fill(-1);

  for (let i = 0; i < articles.length; i++) {
    if (clusterMap[i] >= 0) continue;
    clusterMap[i] = nextCluster;

    for (let j = i + 1; j < articles.length; j++) {
      if (clusterMap[j] >= 0) continue;
      const sim = jaccard(ngramSets[i], ngramSets[j]);
      if (sim >= threshold) {
        clusterMap[j] = nextCluster;
      }
    }
    nextCluster++;
  }

  for (let i = 0; i < articles.length; i++) {
    articles[i].cluster_id = String(clusterMap[i]);
  }
  return articles;
}

export function deduplicate(articles, keep = 'best') {
  assignClusters(articles);

  const clusters = {};
  for (const a of articles) {
    const cid = a.cluster_id;
    if (!clusters[cid]) clusters[cid] = [];
    clusters[cid].push(a);
  }

  const results = [];
  for (const cid of Object.keys(clusters)) {
    const group = clusters[cid];
    if (keep === 'best') {
      group.sort((a, b) => (b.importance || 0) - (a.importance || 0));
    }
    results.push(group[0]);
  }

  return results;
}
