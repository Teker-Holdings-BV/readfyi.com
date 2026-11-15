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
import { SubscriptionsService } from 'src/subscriptions/subscriptions.service';

/**
 * When the newsletter is sent, in NEWSLETTER_TIME_ZONE.
 * Hourly for now; switch to '0 9 * * *' for daily at 09:00.
 */
export const NEWSLETTER_CRON = '0 * * * *';
export const NEWSLETTER_TIME_ZONE = 'Europe/Amsterdam';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class NewsletterSenderService {
  private readonly logger = new Logger(NewsletterSenderService.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly emailService: EmailService,
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
    const summaries: NewsletterRunSummary[] = [];
    try {
      for (const newsletter of Object.values(NewsletterEnum)) {
        const summary = await this.sendNewsletter(
          newsletter,
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
    this.logger.log(
      `Sending "${newsletter}" newsletter to ${recipients.length} subscribers.`,
    );

    const delayMs = 1000 / this.sendRatePerSecond();

    for (const recipient of recipients) {
      const startedAt = Date.now();
      try {
        await this.emailService.send(
          this.buildEmail(newsletter, recipient, apiHost, wwwHost),
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
      // Stay below the SES max send rate (1/s in the sandbox).
      await sleep(Math.max(0, delayMs - (Date.now() - startedAt)));
    }

    this.logger.log(
      `Finished "${newsletter}" newsletter: ${summary.sent} sent, ${summary.failed} failed${summary.stopped ? ', run stopped' : ''}.`,
    );
    return summary;
  }

  private buildEmail(
    newsletter: NewsletterEnum,
    recipient: { subscriberUuid: string; email: string },
    apiHost: string,
    wwwHost: string,
  ): SendEmailParams {
    const token = encodeURIComponent(recipient.subscriberUuid);
    const manageLink = `${wwwHost}/manage-subscriptions?token=${token}`;
    const oneClickLink = `${apiHost}/subscriptions/unsubscribe?token=${token}&newsletter=${encodeURIComponent(newsletter)}`;
    const label = capitalizeFirst(enUS[newsletter]);

    return {
      to: [{ email: recipient.email, name: '' }],
      subject: `FYI ${label}`,
      htmlBody: [
        '<p>test</p>',
        `<p style="font-size:12px;color:#666">You receive this because you subscribed to FYI ${label}. `,
        `<a href="${manageLink}" style="color:#666">Unsubscribe or manage your subscriptions</a>.</p>`,
      ].join(''),
      plainTextContent: `test\n\n--\nYou receive this because you subscribed to FYI ${label}.\nUnsubscribe or manage your subscriptions: ${manageLink}\n`,
      headers: {
        'List-Unsubscribe': `<${oneClickLink}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
  }

  private sendRatePerSecond(): number {
    const rate = Number(this.config.get<string>('NEWSLETTER_SEND_RATE'));
    return Number.isFinite(rate) && rate > 0 ? rate : 1;
  }
}
