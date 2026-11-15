import { Logger } from '@nestjs/common';
import { isValidEmail } from '@readfyi/shared';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EmailService } from './email.service';
import { EmailModule } from './email.module';
import { MailProvider, SendEmailParams } from './mail-provider';
import { SesMailProvider } from './providers/ses-mail.provider';

jest.mock('@readfyi/shared', () => ({
  ...jest.requireActual<object>('@readfyi/shared'),
  isValidEmail: jest.fn(),
}));

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

  describe('isValid', () => {
    const mxCheck = jest.mocked(isValidEmail);

    beforeEach(() => {
      mxCheck.mockReset().mockResolvedValue(true);
    });

    it('rejects disposable addresses without a DNS lookup', async () => {
      await expect(service.isValid('x@mailinator.com')).resolves.toBe(false);
      expect(mxCheck).not.toHaveBeenCalled();
    });

    it('checks normalized addresses with the shared validator', async () => {
      await expect(service.isValid(' Reader@Gmail.com ')).resolves.toBe(true);
      expect(mxCheck).toHaveBeenCalledWith('reader@gmail.com');
    });

    it('returns the shared validator result', async () => {
      mxCheck.mockResolvedValue(false);
      await expect(service.isValid('x@no-mx.example')).resolves.toBe(false);
    });
  });

  it('only logs outside production-like environments', () => {
    process.env.NODE_ENV = 'development';
    expect(service.send(params)).toBeUndefined();
    expect(providerSend).not.toHaveBeenCalled();
  });
});

describe('EmailModule', () => {
  const sesValues = {
    AWS_REGION: 'eu-north-1',
    AWS_ACCESS_KEY_ID: 'AKIATEST',
    AWS_SECRET_ACCESS_KEY: 'secret',
    SES_FROM_ADDRESS: 'newsletter@marketer.readfyi.com',
  };

  const compile = (values: Record<string, string>) =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => values],
        }),
        EmailModule,
      ],
    }).compile();

  it('uses SES as the mail provider', async () => {
    const moduleRef = await compile(sesValues);
    expect(moduleRef.get(MailProvider)).toBeInstanceOf(SesMailProvider);
    expect(moduleRef.get(EmailService)).toBeInstanceOf(EmailService);
  });

  it('fails at startup when SES config is missing', async () => {
    await expect(
      compile({ ...sesValues, SES_FROM_ADDRESS: '' }),
    ).rejects.toThrow('SES mail provider is missing required config');
  });
});
