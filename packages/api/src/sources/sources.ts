import { NewsletterEnum } from '@readfyi/shared';
import { AI_SOURCES } from './ai.sources';
import { FOUNDER_SOURCES } from './founder.sources';
import { MARKETER_SOURCES } from './marketer.sources';

/**
 * Hand-picked content sources, one list per newsletter.
 *
 * v1 curation is random, so quality comes from these lists. Sample in two
 * steps so high-volume feeds (news sites, PPC Land) don't crowd out
 * individual authors:
 *   1. pick sources at random, then a recent item from each
 *   2. fetch the full article before summarizing (see `paywall`)
 */

export interface SourceConfig {
  name: string;
  /** Person or publication behind the source, for attribution. */
  author?: string;
  feedUrl: string;
  homepageUrl: string;
  /**
   * 'none': full article is freely readable.
   * 'partial': some posts are paywalled or the feed only carries a teaser;
   * skip the item or use it as a quick link when no full text is available.
   */
  paywall: 'none' | 'partial';
  /** Rough posting frequency, used to sanity-check the "recent items" window. */
  cadence: 'daily' | 'weekly' | 'monthly' | 'irregular';
  enabled: boolean;
  notes?: string;
}

/**
 * Sources per newsletter. Every newsletter needs an entry, so adding one to
 * NewsletterEnum fails to compile until it has a source list.
 */
export const SOURCES_BY_NEWSLETTER: Record<NewsletterEnum, SourceConfig[]> = {
  [NewsletterEnum.AI]: AI_SOURCES,
  [NewsletterEnum.Founder]: FOUNDER_SOURCES,
  [NewsletterEnum.Marketer]: MARKETER_SOURCES,
};
