/**
 * Counts which sources TLDR newsletters link to, across every issue in their
 * archive, and writes data/{newsletter}-sources.csv ("source,mentions").
 *
 * A source is the RSS/Atom feed an article belongs to, so two sections of one
 * site with their own feeds (e.g. /finance and /tech) are separate sources,
 * while all articles covered by one feed count as one. Sites without a
 * discoverable feed fall back to their root URL (https://host/).
 *
 * Usage: node scripts/scrape-tldr-sources.ts
 *   MAX_DAYS=30 node scripts/scrape-tldr-sources.ts   # only the last 30 days
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const newsletters = ['marketing', 'ai', 'founders']

const urlTemplate = 'https://tldr.tech/{newsletter}/{year}-{month}-{day}'

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/**
 * Days without an issue (weekends, holidays, today before it is published)
 * also redirect to the newsletter root, so only stop once this many days in a
 * row redirect: that means we went past the start of the archive.
 */
const MAX_CONSECUTIVE_REDIRECTS = 14

/** Optional cap on how many days back to go, for test runs. */
const MAX_DAYS = Number(process.env.MAX_DAYS) || Infinity

/** Pause between issue pages, to be polite to tldr.tech. */
const DELAY_MS = 500

/** Parallel requests when resolving an issue's article links. */
const CONCURRENCY = 8

const REQUEST_TIMEOUT_MS = 15_000

// Many sites block non-browser user agents, which would hide their feeds.
const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const FEED_TYPES = ['application/rss+xml', 'application/atom+xml']

/** Paths tried when a site's homepage doesn't advertise a feed. */
const COMMON_FEED_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml']

// ---------------------------------------------------------------------------
// Helpers

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const pad = (n: number) => String(n).padStart(2, '0')
const log = (...args: unknown[]) => console.error(...args)

const decodeEntities = (value: string) =>
    value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')

/** Caches a function's promise per key, so each URL is fetched once per run. */
const memo = <V>(fn: (key: string) => Promise<V>) => {
    const cache = new Map<string, Promise<V>>()
    return (key: string) => {
        let value = cache.get(key)
        if (!value) {
            value = fn(key)
            cache.set(key, value)
        }
        return value
    }
}

const mapConcurrent = async <T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> => {
    const results: R[] = new Array(items.length)
    let next = 0
    const worker = async () => {
        while (next < items.length) {
            const i = next++
            results[i] = await fn(items[i])
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
    return results
}

const request = (url: string, redirect: RequestRedirect = 'follow') =>
    fetch(url, {
        redirect,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

const stripWww = (host: string) => host.replace(/^www\./, '')

// ---------------------------------------------------------------------------
// TLDR issues

const buildIssueUrl = (newsletter: string, date: Date) =>
    urlTemplate
        .replace('{newsletter}', newsletter)
        .replace('{year}', String(date.getFullYear()))
        .replace('{month}', pad(date.getMonth() + 1))
        .replace('{day}', pad(date.getDate()))

const isRedirectToRoot = (response: Response, newsletter: string) => {
    if (response.status < 300 || response.status >= 400) return false
    const location = response.headers.get('location')
    if (!location) return false
    const target = new URL(location, 'https://tldr.tech')
    return target.pathname.replace(/\/$/, '') === `/${newsletter}`
}

/** Headline article links of an issue, without sponsored placements. */
const extractArticleLinks = (html: string): string[] => {
    const links: string[] = []
    for (const [, attrs, content] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
        if (!/class="[^"]*\bfont-bold\b/.test(attrs)) continue
        const href = attrs.match(/href="([^"]+)"/)?.[1]
        if (!href) continue
        const url = decodeEntities(decodeEntities(href)) // hrefs are sometimes double-encoded
        if (!/^https?:\/\//.test(url)) continue
        if (new URL(url).hostname.endsWith('tldr.tech')) continue
        if (/\(Sponsor\)/i.test(content) || /utm_medium=sponsor/i.test(url)) continue
        links.push(url)
    }
    return links
}

// ---------------------------------------------------------------------------
// Resolving links and finding their feed

/** The URL a link ultimately lands on after redirects. */
const resolveUrl = memo(async (url) => {
    try {
        const response = await request(url)
        await response.body?.cancel()
        return response.url || url
    } catch {
        return url
    }
})

/** Feeds a page advertises with <link rel="alternate">. */
const discoverFeeds = memo(async (pageUrl): Promise<string[]> => {
    try {
        const response = await request(pageUrl)
        if (!response.ok || !response.headers.get('content-type')?.includes('html')) {
            await response.body?.cancel()
            return []
        }
        const html = await response.text()
        const feeds: string[] = []
        for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
            const attr = (name: string) =>
                tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]
            if (!attr('rel')?.toLowerCase().split(/\s+/).includes('alternate')) continue
            if (!FEED_TYPES.includes(attr('type')?.toLowerCase() ?? '')) continue
            const href = attr('href')
            if (!href) continue
            const feed = new URL(decodeEntities(href), response.url).toString()
            if (/comment/i.test(feed)) continue
            if (!feeds.includes(feed)) feeds.push(feed)
        }
        return feeds
    } catch {
        return []
    }
})

/** Fallback for sites that don't advertise a feed: try the usual paths. */
const probeCommonFeed = memo(async (origin): Promise<string | undefined> => {
    for (const path of COMMON_FEED_PATHS) {
        try {
            const response = await request(origin + path)
            if (!response.ok) {
                await response.body?.cancel()
                continue
            }
            const start = (await response.text()).trimStart().slice(0, 500)
            if (/^<\?xml|<rss\b|<feed\b/i.test(start)) return response.url
        } catch {
            // try the next path
        }
    }
    return undefined
})

/**
 * Pages that may advertise the article's feed: the homepage and its section
 * pages (/finance/, /finance/markets/), skipping date segments and the
 * article's own slug.
 */
const candidatePages = (url: URL): string[] => {
    const pages = [`${url.origin}/`]
    const segments = url.pathname.split('/').filter(Boolean).slice(0, -1)
    let path = ''
    for (const segment of segments.slice(0, 2)) {
        if (/^\d+$/.test(segment)) break
        path += `/${segment}`
        pages.push(`${url.origin}${path}/`)
    }
    return pages
}

/**
 * The part of a site a feed covers: its path without the feed file name, so
 * https://site.com/finance/rss.xml covers /finance/. A feed on another host
 * (e.g. Feedburner) covers the whole site.
 */
const feedScope = (feed: string, articleHost: string): string => {
    const url = new URL(feed)
    if (stripWww(url.hostname) !== stripWww(articleHost)) return '/'
    const segments = url.pathname.split('/').filter(Boolean)
    while (
        segments.length > 0 &&
        /^(feeds?|rss|atom|index)(\.(xml|rss|atom))?$|\.(xml|rss|atom)$/i.test(segments.at(-1)!)
    ) {
        segments.pop()
    }
    return segments.length ? `/${segments.join('/')}/` : '/'
}

/** The source of an article: the most specific feed covering it, else the site root. */
const sourceFor = async (articleUrl: string): Promise<string> => {
    const url = new URL(await resolveUrl(articleUrl))
    const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`

    const feeds: string[] = []
    for (const page of candidatePages(url)) {
        for (const feed of await discoverFeeds(page)) {
            if (!feeds.includes(feed)) feeds.push(feed)
        }
    }

    let best: { feed: string; scope: string } | undefined
    for (const feed of feeds) {
        const scope = feedScope(feed, url.hostname)
        if (path.startsWith(scope) && (!best || scope.length > best.scope.length)) {
            best = { feed, scope }
        }
    }
    if (best) return best.feed

    return (await probeCommonFeed(url.origin)) ?? `${url.origin}/`
}

// ---------------------------------------------------------------------------
// Main

const toCsv = (mentions: Map<string, number>) => {
    const escape = (value: string) =>
        /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
    const rows = [...mentions].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    return ['source,mentions', ...rows.map(([source, count]) => `${escape(source)},${count}`)].join('\n') + '\n'
}

await mkdir(OUTPUT_DIR, { recursive: true })

for (const newsletter of newsletters) {
    const mentions = new Map<string, number>()
    const date = new Date()
    let consecutiveRedirects = 0
    let issues = 0

    for (let day = 0; day < MAX_DAYS && consecutiveRedirects < MAX_CONSECUTIVE_REDIRECTS; day++) {
        const issueUrl = buildIssueUrl(newsletter, date)
        date.setDate(date.getDate() - 1)

        let response: Response
        try {
            response = await request(issueUrl, 'manual')
        } catch (error) {
            log(`${issueUrl}: request failed (${(error as Error).message}); skipping`)
            continue
        }

        if (isRedirectToRoot(response, newsletter)) {
            consecutiveRedirects++
            await response.body?.cancel()
        } else {
            consecutiveRedirects = 0
            // Any other redirect: follow it.
            if (response.status >= 300 && response.status < 400) {
                await response.body?.cancel()
                response = await request(issueUrl)
            }
            const links = extractArticleLinks(await response.text())
            const sources = await mapConcurrent(links, CONCURRENCY, sourceFor)
            for (const source of sources) {
                mentions.set(source, (mentions.get(source) ?? 0) + 1)
            }
            issues++
            log(`${issueUrl}: ${links.length} articles`)
        }

        await sleep(DELAY_MS)
    }

    const file = join(OUTPUT_DIR, `${newsletter}-sources.csv`)
    await writeFile(file, toCsv(mentions))
    log(`${newsletter}: ${issues} issues, ${mentions.size} sources → ${file}`)
}
