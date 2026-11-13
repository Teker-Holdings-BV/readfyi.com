import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { MailProvider, SendEmailParams } from './mail-provider';
import { createMailProvider } from './email.module';
import { SesMailProvider } from './providers/ses-mail.provider';
import { ZeptoMailProvider } from './providers/zepto-mail.provider';

const params: SendEmailParams = {
  to: [{ email: 'reader@example.com', name: '' }],
  subject: 'Hi',
  htmlBody: '<p>Hi</p>',
};

describe('EmailService', () => {
  const originalEnv = process.env.NODE_ENV;
  let providerSend: jest.Mock;
  let service: EmailService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    providerSend = jest.fn().mockResolvedValue({ messageId: 'id-1' });
    const provider: MailProvider = { send: providerSend };
    service = new EmailService(provider);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  it('delegates to the mail provider in production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(service.send(params)).resolves.toEqual({ messageId: 'id-1' });
    expect(providerSend).toHaveBeenCalledWith(params);
  });

  it('only logs outside production-like environments', () => {
    process.env.NODE_ENV = 'development';
    expect(service.send(params)).toBeUndefined();
    expect(providerSend).not.toHaveBeenCalled();
  });
});

describe('createMailProvider', () => {
  const config = (values: Record<string, string>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService;

  const sesValues = {
    AWS_REGION: 'eu-north-1',
    AWS_ACCESS_KEY_ID: 'AKIATEST',
    AWS_SECRET_ACCESS_KEY: 'secret',
    SES_FROM_ADDRESS: 'newsletter@marketer.readfyi.com',
  };

  it('defaults to SES', () => {
    expect(createMailProvider(config(sesValues))).toBeInstanceOf(
      SesMailProvider,
    );
  });

  it('can fall back to ZeptoMail', () => {
    expect(
      createMailProvider(
        config({ MAIL_PROVIDER: 'zepto', ZEPTO_API_KEY: 'k' }),
      ),
    ).toBeInstanceOf(ZeptoMailProvider);
  });

  it('rejects unknown providers', () => {
    expect(() => createMailProvider(config({ MAIL_PROVIDER: 'smtp' }))).toThrow(
      'Unknown MAIL_PROVIDER "smtp"',
    );
  });
});
