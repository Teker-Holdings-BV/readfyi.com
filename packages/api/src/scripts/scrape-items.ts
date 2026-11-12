/**
 * Picks random recent articles from the Marketer newsletter sources.
 *
 * Usage:
 *   npm run scrape:items -w packages/api -- [--count 10] [--days 2]
 *
 * Sampling is source-first: each source contributes at most one article per
 * round, so high-volume feeds (news sites) don't crowd out individual authors.
 * Articles from the last `--days` days are preferred; if that doesn't yield
 * `--count` articles, older ones fill the gap.
 *
 * Saves the picked articles to `data/items.csv` at the repo root, replacing
 * the previous run's file.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import Parser from 'rss-parser';
import { MARKETER_SOURCES, SourceConfig } from '../sources/sources.config';

interface ScrapedItem {
  source: string;
  author?: string;
  title: string;
  url: string;
  publishedAt?: string;
  snippet?: string;
  paywall: SourceConfig['paywall'];
}

const FETCH_TIMEOUT_MS = 15_000;
const SNIPPET_LENGTH = 500;

// Same depth from src/scripts and dist/scripts: <repo>/packages/api/{src,dist}/scripts
const OUTPUT_PATH = resolve(__dirname, '../../../../data/items.csv');

const CSV_COLUMNS: (keyof ScrapedItem)[] = [
  'source',
  'author',
  'title',
  'url',
  'publishedAt',
  'snippet',
  'paywall',
];

// Some sites reject requests without a browser-like user agent.
const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    Accept:
      'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  },
});

function parseArgs(argv: string[]) {
  const get = (flag: string, fallback: number) => {
    const i = argv.indexOf(flag);
    const value = i >= 0 ? Number(argv[i + 1]) : fallback;
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${flag} must be a positive integer`);
    }
    return value;
  };
  return { count: get('--count', 10), days: get('--days', 2) };
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function toSnippet(text?: string): string | undefined {
  const clean = text?.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > SNIPPET_LENGTH
    ? `${clean.slice(0, SNIPPET_LENGTH)}…`
    : clean;
}

/** RFC 4180: quote every field and double any quotes inside it. */
function toCsv(items: ScrapedItem[]): string {
  const escape = (value: string | undefined) =>
    `"${(value ?? '').replace(/"/g, '""')}"`;
  const rows = [
    CSV_COLUMNS.join(','),
    ...items.map((item) => CSV_COLUMNS.map((c) => escape(item[c])).join(',')),
  ];
  return rows.join('\n') + '\n';
}

async function fetchSource(source: SourceConfig): Promise<ScrapedItem[]> {
  const feed = await parser.parseURL(source.feedUrl);

  return feed.items
    .filter((item) => item.title && item.link)
    .map((item) => {
      const date = item.isoDate ?? item.pubDate;
      const parsed = date ? new Date(date) : undefined;
      return {
        source: source.name,
        // Some feeds give the author as an object (e.g. Atom <author><name>),
        // so only use it when it is plain text.
        author: typeof item.creator === 'string' ? item.creator : source.author,
        title: item.title!.trim(),
        url: item.link!,
        publishedAt:
          parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : undefined,
        snippet: toSnippet(item.contentSnippet ?? item.summary),
        paywall: source.paywall,
      };
    });
}

/**
 * Round-robin over shuffled sources: each round takes one random article from
 * every source that still has articles left, until `count` is reached.
 */
function pickRoundRobin(
  pools: ScrapedItem[][],
  count: number,
  picked: ScrapedItem[],
): void {
  const remaining = shuffle(pools.map((pool) => shuffle(pool)));
  while (picked.length < count && remaining.some((pool) => pool.length)) {
    for (const pool of remaining) {
      if (picked.length >= count) return;
      const item = pool.pop();
      if (item) picked.push(item);
    }
  }
}

async function main() {
  const { count, days } = parseArgs(process.argv.slice(2));
  // Only free-to-read sources: paywalled articles can't be summarized.
  const sources = MARKETER_SOURCES.filter(
    (s) => s.enabled && s.paywall === 'none',
  );
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  console.error(`Fetching ${sources.length} feeds…`);

  const results = await Promise.allSettled(sources.map(fetchSource));

  const recentPools: ScrapedItem[][] = [];
  const olderPools: ScrapedItem[][] = [];

  results.forEach((result, i) => {
    const source = sources[i];
    if (result.status === 'rejected') {
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.error(`  ✗ ${source.name}: ${reason}`);
      return;
    }

    const isRecent = (item: ScrapedItem) =>
      item.publishedAt !== undefined &&
      new Date(item.publishedAt).getTime() >= cutoff;

    const recent = result.value.filter(isRecent);
    const older = result.value.filter((item) => !isRecent(item));
    recentPools.push(recent);
    olderPools.push(older);
    console.error(
      `  ✓ ${source.name}: ${result.value.length} items, ${recent.length} from the last ${days} days`,
    );
  });

  const picked: ScrapedItem[] = [];
  pickRoundRobin(recentPools, count, picked);

  if (picked.length < count) {
    console.error(
      `Only ${picked.length} recent articles; filling with older ones.`,
    );
    pickRoundRobin(olderPools, count, picked);
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, toCsv(picked), 'utf-8');
  console.error(
    `Picked ${picked.length} of ${count} articles. Saved to ${OUTPUT_PATH}`,
  );
}

// rss-parser can leave timers or sockets open, which would keep the process
// alive after the output is printed, so exit explicitly.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
