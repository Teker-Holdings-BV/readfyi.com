import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NewsletterEnum } from '@readfyi/shared';
import { EmailService, SendEmailParams } from 'src/email/email.service';
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

const baseConfig: Record<string, string | undefined> = {
  API_HOST: 'https://api.readfyi.com',
  WWW_HOST: 'https://readfyi.com',
  NEWSLETTER_SEND_RATE: '1000', // keep tests fast
};

describe('NewsletterSenderService', () => {
  const originalEnv = process.env.NODE_ENV;
  let send: jest.Mock;
  let findActiveRecipients: jest.Mock;
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
    service = new NewsletterSenderService(
      { get: (key: string) => config[key] } as unknown as ConfigService,
      { findActiveRecipients } as unknown as SubscriptionsService,
      { send } as unknown as EmailService,
    );
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  it('runs daily at 09:00, Amsterdam time', () => {
    // Metadata key @nestjs/schedule stores the @Cron options under.
    const handler = Object.getOwnPropertyDescriptor(
      NewsletterSenderService.prototype,
      'sendNewsletters',
    )?.value as object;
    const options = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', handler) as {
      cronTime: string;
      timeZone: string;
    };
    expect(options.cronTime).toBe('0 * * * *');
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

  it('sends one email per active subscription of the marketer newsletter', async () => {
    const summaries = await service.sendNewsletters();

    expect(findActiveRecipients).toHaveBeenCalledTimes(1);
    expect(findActiveRecipients).toHaveBeenCalledWith(NewsletterEnum.Marketer);
    expect(sentEmails().map((e) => [e.fromName, e.to[0].email])).toEqual([
      ['FYI Marketer', 'one@example.com'],
      ['FYI Marketer', 'two@example.com'],
    ]);
    expect(summaries).toEqual([
      {
        newsletter: 'marketer',
        recipients: 2,
        sent: 2,
        failed: 0,
        stopped: false,
      },
    ]);
  });

  it('does not send the AI or founder newsletters', async () => {
    await service.sendNewsletters();

    expect(findActiveRecipients).not.toHaveBeenCalledWith(NewsletterEnum.AI);
    expect(findActiveRecipients).not.toHaveBeenCalledWith(
      NewsletterEnum.Founder,
    );
    expect(sentEmails().map((e) => e.to[0].email)).not.toContain(
      'three@example.com',
    );
  });

  it('never puts more than one recipient on an email', async () => {
    await service.sendNewsletters();
    for (const email of sentEmails()) {
      expect(email.to).toHaveLength(1);
      expect(email.cc).toBeUndefined();
      expect(email.bcc).toBeUndefined();
    }
  });

  it('sends "test" with a personal unsubscribe link and one-click headers', async () => {
    await service.sendNewsletters();
    const email = sentEmails()[1];

    expect(email.htmlBody).toContain('<p>test</p>');
    expect(email.plainTextContent).toMatch(/^test\n/);
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

    expect(send).toHaveBeenCalledTimes(2);
    expect(summaries[0]).toMatchObject({ sent: 1, failed: 1, stopped: false });
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
    expect(send).toHaveBeenCalledTimes(2);
  });
});
