import Parser from 'rss-parser';
import { SourceConfig } from './sources';

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
  /** Called for each candidate dropped because its link doesn't work. */
  onDeadLink?: (article: Article) => void;
}

export type FeedResult =
  | { source: string; ok: true; total: number; recent: number }
  | { source: string; ok: false; error: string };

const FETCH_TIMEOUT_MS = 15_000;
const LINK_CHECK_TIMEOUT_MS = 10_000;
const LINK_CHECK_CONCURRENCY = 10;
const SNIPPET_LENGTH = 500;

// Some sites reject requests without a browser-like user agent.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    'User-Agent': USER_AGENT,
    Accept:
      'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  },
});

// Statuses that bot protection (Cloudflare etc.) returns for pages that do
// exist in a browser, so they don't mean the link is broken.
const BOT_BLOCK_STATUSES = new Set([401, 403, 429]);

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

async function requestStatus(url: string, method: 'HEAD' | 'GET') {
  const res = await fetch(url, {
    method,
    redirect: 'follow',
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
    signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS),
  });
  // Only the status is needed; don't download the page.
  await res.body?.cancel();
  return res.status;
}

/**
 * Whether the URL loads (after redirects). 404s, 5xx errors, timeouts and
 * network errors count as broken. Bot-protection responses (401/403/429)
 * count as working, because the page exists for a human reader.
 */
export async function isLinkWorking(url: string): Promise<boolean> {
  let status: number | undefined;
  try {
    status = await requestStatus(url, 'HEAD');
  } catch {
    // Some servers drop HEAD requests; retry with GET below.
  }
  // Some servers don't support HEAD or answer it wrongly; confirm with GET.
  if (status === undefined || status >= 400) {
    try {
      status = await requestStatus(url, 'GET');
    } catch {
      return false;
    }
  }
  return status < 400 || BOT_BLOCK_STATUSES.has(status);
}

/**
 * Removes articles whose links don't work from each pool, checking links in
 * parallel (at most `LINK_CHECK_CONCURRENCY` at a time).
 */
async function keepWorkingLinks(
  pools: Article[][],
  onDeadLink?: (article: Article) => void,
): Promise<Article[][]> {
  const urls = [...new Set(pools.flat().map((a) => a.url))];
  const working = new Set<string>();
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      if (await isLinkWorking(url)) working.add(url);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(LINK_CHECK_CONCURRENCY, urls.length) },
      worker,
    ),
  );

  return pools.map((pool) =>
    pool.filter((article) => {
      if (working.has(article.url)) return true;
      onDeadLink?.(article);
      return false;
    }),
  );
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
 *
 * Every candidate's link is checked before picking, and broken ones (404 etc.)
 * are dropped. Older candidates are only checked when the recent ones aren't
 * enough.
 */
export async function pickArticles(
  allSources: SourceConfig[],
  { count, days, onFeedResult, onDeadLink }: PickArticlesOptions,
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
  pickRoundRobin(
    await keepWorkingLinks(recentPools, onDeadLink),
    count,
    picked,
  );
  if (picked.length < count) {
    pickRoundRobin(
      await keepWorkingLinks(olderPools, onDeadLink),
      count,
      picked,
    );
  }
  return picked;
}
