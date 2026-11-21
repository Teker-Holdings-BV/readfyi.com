/**
 * Picks random recent articles from a newsletter's sources.
 *
 * Usage:
 *   npm run scrape:items -w packages/api -- [--newsletter marketer] [--count 10] [--days 2]
 *
 * See `pickArticles` for how articles are sampled. The scheduled newsletter
 * uses the same logic.
 *
 * Saves the picked articles to `data/items.csv` at the repo root, replacing
 * the previous run's file.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { Article, pickArticles } from '../sources/article-picker';
import { NewsletterEnum } from '@readfyi/shared';
import { SOURCES_BY_NEWSLETTER } from '../sources/sources';

// Same depth from src/scripts and dist/scripts: <repo>/packages/api/{src,dist}/scripts
const OUTPUT_PATH = resolve(__dirname, '../../../../data/items.csv');

const CSV_COLUMNS: (keyof Article)[] = [
  'source',
  'author',
  'title',
  'url',
  'publishedAt',
  'snippet',
  'paywall',
];

function parseArgs(argv: string[]) {
  const get = (flag: string, fallback: number) => {
    const i = argv.indexOf(flag);
    const value = i >= 0 ? Number(argv[i + 1]) : fallback;
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${flag} must be a positive integer`);
    }
    return value;
  };
  const i = argv.indexOf('--newsletter');
  const newsletter = i >= 0 ? argv[i + 1] : NewsletterEnum.Marketer;
  const newsletters = Object.values(NewsletterEnum) as string[];
  if (!newsletters.includes(newsletter)) {
    throw new Error(`--newsletter must be one of: ${newsletters.join(', ')}`);
  }
  return {
    newsletter: newsletter as NewsletterEnum,
    count: get('--count', 10),
    days: get('--days', 2),
  };
}

/** RFC 4180: quote every field and double any quotes inside it. */
function toCsv(items: Article[]): string {
  const escape = (value: string | undefined) =>
    `"${(value ?? '').replace(/"/g, '""')}"`;
  const rows = [
    CSV_COLUMNS.join(','),
    ...items.map((item) => CSV_COLUMNS.map((c) => escape(item[c])).join(',')),
  ];
  return rows.join('\n') + '\n';
}

async function main() {
  const { newsletter, count, days } = parseArgs(process.argv.slice(2));
  console.error(`Fetching feeds for "${newsletter}"…`);

  const picked = await pickArticles(SOURCES_BY_NEWSLETTER[newsletter], {
    count,
    days,
    onFeedResult: (r) =>
      console.error(
        r.ok
          ? `  ✓ ${r.source}: ${r.total} items, ${r.recent} from the last ${days} days`
          : `  ✗ ${r.source}: ${r.error}`,
      ),
    onDeadLink: (a) => console.error(`  ✗ broken link (${a.source}): ${a.url}`),
  });

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
