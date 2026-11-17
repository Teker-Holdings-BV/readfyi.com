import { Injectable, Logger } from '@nestjs/common';
import { NewsletterEnum } from '@readfyi/shared';
import { Article, pickArticles } from './article-picker';
import { SOURCES_BY_NEWSLETTER } from './sources.config';

@Injectable()
export class ArticlesService {
  private readonly logger = new Logger(ArticlesService.name);

  /**
   * Picks `count` random recent articles from the newsletter's sources.
   * Returns fewer (or none) when the feeds don't have enough articles.
   */
  async pickForNewsletter(
    newsletter: NewsletterEnum,
    count: number,
    days = 2,
  ): Promise<Article[]> {
    const sources = SOURCES_BY_NEWSLETTER[newsletter] ?? [];
    const articles = await pickArticles(sources, {
      count,
      days,
      onFeedResult: (result) => {
        if (!result.ok) {
          this.logger.warn(`Feed "${result.source}" failed: ${result.error}`);
        }
      },
    });
    this.logger.log(
      `Picked ${articles.length} of ${count} articles for "${newsletter}".`,
    );
    return articles;
  }
}
