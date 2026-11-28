import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NewsletterEnum } from '@readfyi/shared';
import { EmailService, SendEmailParams } from 'src/email/email.service';
import { Article } from 'src/sources/article-picker';
import { ArticlesService } from 'src/sources/articles.service';
import { SubscriptionsService } from 'src/subscriptions/subscriptions.service';
import { NewsletterSenderService } from './newsletter-sender.service';

const recipientsByNewsletter: Record<
  NewsletterEnum,
  { subscriberUuid: string; email: string }[]
> = {
  [NewsletterEnum.AI]: [{ subscriberUuid: 'uuid-1', email: 'one@example.com' }],
  [NewsletterEnum.Founder]: [
    { subscriberUuid: 'uuid-3', email: 'three@example.com' },
  ],
  [NewsletterEnum.Marketer]: [
    { subscriberUuid: 'uuid-1', email: 'one@example.com' },
    { subscriberUuid: 'uuid-2', email: 'two@example.com' },
  ],
};

const article = (n: number, title = `Article ${n}`): Article => ({
  source: 'Source',
  title,
  url: `https://example.com/${n}`,
  paywall: 'none',
});

const articles = Array.from({ length: 10 }, (_, i) => article(i + 1));

const baseConfig: Record<string, string | undefined> = {
  API_HOST: 'https://api.readfyi.com',
  WWW_HOST: 'https://readfyi.com',
  NEWSLETTER_SEND_RATE: '1000', // keep tests fast
};

describe('NewsletterSenderService', () => {
  const originalEnv = process.env.NODE_ENV;
  let send: jest.Mock;
  let findActiveRecipients: jest.Mock;
  let pickForNewsletter: jest.Mock;
  let config: Record<string, string | undefined>;
  let service: NewsletterSenderService;

  const sentEmails = () => send.mock.calls.map(([p]: [SendEmailParams]) => p);

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    config = { ...baseConfig };
    send = jest.fn().mockResolvedValue({ messageId: 'id' });
    findActiveRecipients = jest.fn((n: NewsletterEnum) =>
      Promise.resolve(recipientsByNewsletter[n]),
    );
    pickForNewsletter = jest.fn().mockResolvedValue(articles);
    service = new NewsletterSenderService(
      { get: (key: string) => config[key] } as unknown as ConfigService,
      { findActiveRecipients } as unknown as SubscriptionsService,
      { send } as unknown as EmailService,
      { pickForNewsletter } as unknown as ArticlesService,
    );
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  it('runs daily at 12:00, Amsterdam time', () => {
    // Metadata key @nestjs/schedule stores the @Cron options under.
    const handler = Object.getOwnPropertyDescriptor(
      NewsletterSenderService.prototype,
      'sendNewsletters',
    )?.value as object;
    const options = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', handler) as {
      cronTime: string;
      timeZone: string;
    };
    expect(options.cronTime).toBe('0 12 * * *');
    expect(options.timeZone).toBe('Europe/Amsterdam');
  });

  it('uses the send date in Amsterdam time as the subject', async () => {
    // 23:30 UTC on Nov 16 is already Nov 17 in Amsterdam.
    jest.useFakeTimers({
      now: new Date('2026-11-16T23:30:00Z'),
      advanceTimers: true,
    });
    try {
      await service.sendNewsletters();
    } finally {
      jest.useRealTimers();
    }

    const subjects = new Set(sentEmails().map((e) => e.subject));
    expect([...subjects]).toEqual(['Tuesday, November 17, 2026']);
  });

  it('sends every newsletter to its own active subscribers', async () => {
    const summaries = await service.sendNewsletters();

    expect(
      findActiveRecipients.mock.calls.map(([n]: [NewsletterEnum]) => n),
    ).toEqual([
      NewsletterEnum.AI,
      NewsletterEnum.Founder,
      NewsletterEnum.Marketer,
    ]);
    expect(sentEmails().map((e) => [e.fromName, e.to[0].email])).toEqual([
      ['FYI: AI', 'one@example.com'],
      ['FYI: Founder', 'three@example.com'],
      ['FYI: Marketer', 'one@example.com'],
      ['FYI: Marketer', 'two@example.com'],
    ]);
    expect(summaries).toEqual([
      { newsletter: 'ai', recipients: 1, sent: 1, failed: 0, stopped: false },
      {
        newsletter: 'founder',
        recipients: 1,
        sent: 1,
        failed: 0,
        stopped: false,
      },
      {
        newsletter: 'marketer',
        recipients: 2,
        sent: 2,
        failed: 0,
        stopped: false,
      },
    ]);
  });

  it("picks each newsletter's articles from its own sources", async () => {
    await service.sendNewsletters();

    for (const newsletter of Object.values(NewsletterEnum)) {
      expect(pickForNewsletter).toHaveBeenCalledWith(newsletter, 10);
    }
  });

  it('never puts more than one recipient on an email', async () => {
    await service.sendNewsletters();
    for (const email of sentEmails()) {
      expect(email.to).toHaveLength(1);
      expect(email.cc).toBeUndefined();
      expect(email.bcc).toBeUndefined();
    }
  });

  it('sends an ordered list of 10 linked articles between the intro and sign-off', async () => {
    await service.sendNewsletters();
    const email = sentEmails()[0];

    expect(pickForNewsletter).toHaveBeenCalledWith(NewsletterEnum.Marketer, 10);
    expect(email.htmlBody).toMatch(
      /^<p>These are worth your read today:<\/p><ol>(<li><a href="[^"]+">[^<]+<\/a><\/li>){10}<\/ol><p>Best,<br>Halil from FYI<\/p>/,
    );
    expect(email.htmlBody).toContain(
      '<li><a href="https://example.com/1">Article 1</a></li>',
    );
    expect(email.plainTextContent).toMatch(
      /^These are worth your read today:\n\n1\. Article 1\n {3}https:\/\/example\.com\/1\n/,
    );
    expect(email.plainTextContent).toContain(
      '10. Article 10\n   https://example.com/10\n\nBest,\nHalil from FYI\n',
    );
  });

  it('picks the articles once per newsletter, so every recipient gets the same issue', async () => {
    await service.sendNewsletters();

    expect(pickForNewsletter).toHaveBeenCalledTimes(3);
    const [first, second] = sentEmails().filter(
      (e) => e.fromName === 'FYI: Marketer',
    );
    expect(first.htmlBody.split('<p style')[0]).toBe(
      second.htmlBody.split('<p style')[0],
    );
  });

  it('escapes HTML in article titles and URLs', async () => {
    pickForNewsletter.mockResolvedValue([
      {
        ...article(1, 'Ads & <script>alert(1)</script>'),
        url: 'https://example.com/?a=1&b="x"',
      },
    ]);
    await service.sendNewsletters();
    const { htmlBody } = sentEmails()[0];

    expect(htmlBody).toContain(
      '<a href="https://example.com/?a=1&amp;b=&quot;x&quot;">Ads &amp; &lt;script&gt;alert(1)&lt;/script&gt;</a>',
    );
    expect(htmlBody).not.toContain('<script>');
  });

  it('does not send when no articles could be found', async () => {
    pickForNewsletter.mockResolvedValue([]);
    const summaries = await service.sendNewsletters();

    expect(send).not.toHaveBeenCalled();
    expect(summaries.map((s) => [s.recipients, s.sent])).toEqual([
      [1, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it('still sends the other newsletters when one has no articles', async () => {
    pickForNewsletter.mockImplementation((n: NewsletterEnum) =>
      Promise.resolve(n === NewsletterEnum.AI ? [] : articles),
    );
    await service.sendNewsletters();

    expect(sentEmails().map((e) => e.fromName)).toEqual([
      'FYI: Founder',
      'FYI: Marketer',
      'FYI: Marketer',
    ]);
  });

  it('does not scrape when there are no subscribers', async () => {
    findActiveRecipients.mockResolvedValue([]);
    await service.sendNewsletters();

    expect(pickForNewsletter).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('adds a personal unsubscribe link and one-click headers', async () => {
    await service.sendNewsletters();
    const email = sentEmails().find(
      (e) => e.to[0].email === 'two@example.com',
    )!;

    expect(email.htmlBody).toContain(
      'https://readfyi.com/manage-subscriptions?token=uuid-2',
    );
    expect(email.plainTextContent).toContain(
      'https://readfyi.com/manage-subscriptions?token=uuid-2',
    );
    expect(email.headers).toEqual({
      'List-Unsubscribe':
        '<https://api.readfyi.com/subscriptions/unsubscribe?token=uuid-2&newsletter=marketer>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('keeps sending after a single recipient fails', async () => {
    send.mockRejectedValueOnce(
      Object.assign(new Error('bad'), { name: 'MessageRejected' }),
    );
    const summaries = await service.sendNewsletters();

    expect(send).toHaveBeenCalledTimes(4);
    expect(summaries[0]).toMatchObject({ sent: 0, failed: 1, stopped: false });
    expect(summaries[2]).toMatchObject({ sent: 2, failed: 0, stopped: false });
  });

  it.each(['SendingPausedException', 'AccountSuspendedException'])(
    'stops the whole run on %s',
    async (name) => {
      send.mockRejectedValueOnce(Object.assign(new Error('x'), { name }));
      const summaries = await service.sendNewsletters();

      expect(send).toHaveBeenCalledTimes(1);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({ sent: 0, failed: 1, stopped: true });
    },
  );

  it.each(['API_HOST', 'WWW_HOST'])(
    'refuses to send in production without %s',
    async (key) => {
      config[key] = undefined;
      await expect(service.sendNewsletters()).resolves.toEqual([]);
      expect(findActiveRecipients).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('skips a run while the previous one is still in progress', async () => {
    let release!: () => void;
    findActiveRecipients.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );

    const first = service.sendNewsletters();
    await expect(service.sendNewsletters()).resolves.toEqual([]);
    release();
    await first;

    // A later run works again.
    send.mockClear();
    await service.sendNewsletters();
    expect(send).toHaveBeenCalledTimes(4);
  });
});
