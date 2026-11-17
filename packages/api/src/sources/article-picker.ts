import Parser from 'rss-parser';
import { SourceConfig } from './sources.config';

export interface Article {
  source: string;
  author?: string;
  title: string;
  url: string;
  publishedAt?: string;
  snippet?: string;
  paywall: SourceConfig['paywall'];
}

export interface PickArticlesOptions {
  /** How many articles to pick. */
  count: number;
  /** Articles from the last `days` days are preferred. */
  days: number;
  /** Called once per feed with the fetch result, for progress logging. */
  onFeedResult?: (result: FeedResult) => void;
}

export type FeedResult =
  | { source: string; ok: true; total: number; recent: number }
  | { source: string; ok: false; error: string };

const FETCH_TIMEOUT_MS = 15_000;
const SNIPPET_LENGTH = 500;

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

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchSource(source: SourceConfig): Promise<Article[]> {
  const feed = await parser.parseURL(source.feedUrl);

  return feed.items
    .filter((item) => item.title?.trim() && item.link && isHttpUrl(item.link))
    .map((item) => {
      const date = item.isoDate ?? item.pubDate;
      const parsed = date ? new Date(date) : undefined;
      return {
        source: source.name,
        // Some feeds give the author as an object (e.g. Atom <author><name>),
        // so only use it when it is plain text.
        author: typeof item.creator === 'string' ? item.creator : source.author,
        title: item.title!.replace(/\s+/g, ' ').trim(),
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
 * Skips URLs that were already picked.
 */
function pickRoundRobin(
  pools: Article[][],
  count: number,
  picked: Article[],
): void {
  const seen = new Set(picked.map((a) => a.url));
  const remaining = shuffle(pools.map((pool) => shuffle(pool)));
  while (picked.length < count && remaining.some((pool) => pool.length)) {
    for (const pool of remaining) {
      if (picked.length >= count) return;
      const item = pool.pop();
      if (item && !seen.has(item.url)) {
        seen.add(item.url);
        picked.push(item);
      }
    }
  }
}

/**
 * Picks random recent articles from the given sources.
 *
 * Only enabled, free-to-read sources are used. Sampling is source-first: each
 * source contributes at most one article per round, so high-volume feeds
 * (news sites) don't crowd out individual authors. Articles from the last
 * `days` days are preferred; if that doesn't yield `count` articles, older
 * ones fill the gap. Feeds that fail to load are skipped.
 */
export async function pickArticles(
  allSources: SourceConfig[],
  { count, days, onFeedResult }: PickArticlesOptions,
): Promise<Article[]> {
  const sources = allSources.filter((s) => s.enabled && s.paywall === 'none');
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const isRecent = (item: Article) =>
    item.publishedAt !== undefined &&
    new Date(item.publishedAt).getTime() >= cutoff;

  const results = await Promise.allSettled(sources.map(fetchSource));

  const recentPools: Article[][] = [];
  const olderPools: Article[][] = [];

  results.forEach((result, i) => {
    const source = sources[i];
    if (result.status === 'rejected') {
      const error =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      onFeedResult?.({ source: source.name, ok: false, error });
      return;
    }

    const recent = result.value.filter(isRecent);
    recentPools.push(recent);
    olderPools.push(result.value.filter((item) => !isRecent(item)));
    onFeedResult?.({
      source: source.name,
      ok: true,
      total: result.value.length,
      recent: recent.length,
    });
  });

  const picked: Article[] = [];
  pickRoundRobin(recentPools, count, picked);
  if (picked.length < count) pickRoundRobin(olderPools, count, picked);
  return picked;
}
