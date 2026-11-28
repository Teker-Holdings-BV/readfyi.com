import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  capitalizeFirst,
  enUS,
  isProdLike,
  NewsletterEnum,
} from '@readfyi/shared';
import { EmailService, SendEmailParams } from 'src/email/email.service';
import { Article } from 'src/sources/article-picker';
import { ArticlesService } from 'src/sources/articles.service';
import { SubscriptionsService } from 'src/subscriptions/subscriptions.service';

/**
 * When the newsletter is sent, in NEWSLETTER_TIME_ZONE.
 * Daily at 12:00.
 */
export const NEWSLETTER_CRON = '0 12 * * *';
export const NEWSLETTER_TIME_ZONE = 'Europe/Amsterdam';

/** Number of articles in each newsletter issue. */
export const ARTICLES_PER_ISSUE = 10;

const INTRO = 'These are worth your read today:';
const SIGN_OFF = 'Halil from FYI';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** SES errors that affect every send: stop the run instead of retrying. */
const ACCOUNT_LEVEL_ERRORS = new Set([
  'AccountSuspendedException',
  'SendingPausedException',
]);

export interface NewsletterRunSummary {
  newsletter: NewsletterEnum;
  recipients: number;
  sent: number;
  failed: number;
  /** True when an account-level SES error stopped the run. */
  stopped: boolean;
}

const newsletterDateFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: NEWSLETTER_TIME_ZONE,
});

/** Subject line: the send date in NEWSLETTER_TIME_ZONE, e.g. "Monday, November 16, 2026". */
export const formatNewsletterDate = (date: Date) =>
  newsletterDateFormat.format(date);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class NewsletterSenderService {
  private readonly logger = new Logger(NewsletterSenderService.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly emailService: EmailService,
    private readonly articlesService: ArticlesService,
  ) {}

  @Cron(NEWSLETTER_CRON, { name: 'newsletter', timeZone: NEWSLETTER_TIME_ZONE })
  async sendNewsletters(): Promise<NewsletterRunSummary[]> {
    if (this.running) {
      this.logger.warn(
        'Previous newsletter run is still in progress; skipping.',
      );
      return [];
    }

    const apiHost = this.config.get<string>('API_HOST');
    const wwwHost = this.config.get<string>('WWW_HOST');
    if (isProdLike() && (!apiHost || !wwwHost)) {
      // Bulk mail without working unsubscribe links breaks Gmail/Yahoo sender
      // rules and invites spam complaints, so don't send at all.
      this.logger.error(
        'Newsletter run aborted: API_HOST and WWW_HOST must be set for unsubscribe links.',
      );
      return [];
    }

    this.running = true;
    // Fixed once per run so every recipient gets the same subject.
    const subject = formatNewsletterDate(new Date());
    const summaries: NewsletterRunSummary[] = [];
    try {
      for (const newsletter of Object.values(NewsletterEnum)) {
        const summary = await this.sendNewsletter(
          newsletter,
          subject,
          apiHost ?? 'http://localhost:3000',
          wwwHost ?? 'http://localhost:3001',
        );
        summaries.push(summary);
        if (summary.stopped) break;
      }
    } finally {
      this.running = false;
    }
    return summaries;
  }

  private async sendNewsletter(
    newsletter: NewsletterEnum,
    subject: string,
    apiHost: string,
    wwwHost: string,
  ): Promise<NewsletterRunSummary> {
    const recipients =
      await this.subscriptionsService.findActiveRecipients(newsletter);
    const summary: NewsletterRunSummary = {
      newsletter,
      recipients: recipients.length,
      sent: 0,
      failed: 0,
      stopped: false,
    };
    if (recipients.length === 0) {
      this.logger.log(`No subscribers for "${newsletter}"; skipping.`);
      return summary;
    }

    // Picked once per run, so every recipient gets the same issue.
    const articles = await this.articlesService.pickForNewsletter(
      newsletter,
      ARTICLES_PER_ISSUE,
    );
    if (articles.length === 0) {
      this.logger.error(
        `No articles found for "${newsletter}"; not sending this newsletter.`,
      );
      return summary;
    }

    this.logger.log(
      `Sending "${newsletter}" newsletter to ${recipients.length} subscribers.`,
    );

    const delayMs = 1000 / this.sendRatePerSecond();

    for (const recipient of recipients) {
      const startedAt = Date.now();
      try {
        await this.emailService.send(
          this.buildEmail(
            newsletter,
            subject,
            articles,
            recipient,
            apiHost,
            wwwHost,
          ),
        );
        summary.sent++;
      } catch (error) {
        summary.failed++;
        const name = (error as { name?: string })?.name ?? '';
        // SesMailProvider already logged the details for this recipient.
        if (ACCOUNT_LEVEL_ERRORS.has(name)) {
          this.logger.error(
            `Newsletter run stopped: SES returned ${name}, so no further emails are sent.`,
          );
          summary.stopped = true;
          break;
        }
      }
      // Stay below the SES max send rate (14/s on this account).
      await sleep(Math.max(0, delayMs - (Date.now() - startedAt)));
    }

    this.logger.log(
      `Finished "${newsletter}" newsletter: ${summary.sent} sent, ${summary.failed} failed${summary.stopped ? ', run stopped' : ''}.`,
    );
    return summary;
  }

  private buildEmail(
    newsletter: NewsletterEnum,
    subject: string,
    articles: Article[],
    recipient: { subscriberUuid: string; email: string },
    apiHost: string,
    wwwHost: string,
  ): SendEmailParams {
    const token = encodeURIComponent(recipient.subscriberUuid);
    const manageLink = `${wwwHost}/manage-subscriptions?token=${token}`;
    const oneClickLink = `${apiHost}/subscriptions/unsubscribe?token=${token}&newsletter=${encodeURIComponent(newsletter)}`;
    const label = capitalizeFirst(enUS[newsletter]);

    return {
      fromName: `FYI: ${label}`,
      to: [{ email: recipient.email, name: '' }],
      subject,
      htmlBody: [
        `<p>${INTRO}</p>`,
        '<ol>',
        ...articles.map(
          (a) =>
            `<li><a href="${escapeHtml(a.url)}">${escapeHtml(a.title)}</a></li>`,
        ),
        '</ol>',
        `<p>${SIGN_OFF}</p>`,
        `<p style="font-size:12px;color:#666">You receive this because you subscribed to FYI: ${label}. `,
        `<a href="${manageLink}" style="color:#666">Unsubscribe or manage your subscriptions</a>.</p>`,
      ].join(''),
      plainTextContent: [
        INTRO,
        '',
        ...articles.map((a, i) => `${i + 1}. ${a.title}\n   ${a.url}`),
        '',
        SIGN_OFF,
        '',
        '--',
        `You receive this because you subscribed to FYI: ${label}.`,
        `Unsubscribe or manage your subscriptions: ${manageLink}`,
        '',
      ].join('\n'),
      headers: {
        'List-Unsubscribe': `<${oneClickLink}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
  }

  private sendRatePerSecond(): number {
    const rate = Number(this.config.get<string>('NEWSLETTER_SEND_RATE'));
    return Number.isFinite(rate) && rate > 0 ? rate : 14;
  }
}
