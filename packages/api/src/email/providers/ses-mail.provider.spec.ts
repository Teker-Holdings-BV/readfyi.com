import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SesMailProvider } from './ses-mail.provider';
import { SendEmailParams } from '../mail-provider';

const baseConfig: Record<string, string | undefined> = {
  AWS_REGION: 'eu-north-1',
  AWS_ACCESS_KEY_ID: 'AKIATEST',
  AWS_SECRET_ACCESS_KEY: 'secret',
  SES_FROM_ADDRESS: 'newsletter@marketer.readfyi.com',
  SES_FROM_NAME: 'FYI',
};

const makeConfig = (overrides: Record<string, string | undefined> = {}) =>
  ({
    get: (key: string) => ({ ...baseConfig, ...overrides })[key],
  }) as unknown as ConfigService;

const awsError = (name: string, message: string) =>
  Object.assign(new Error(message), { name });

const params: SendEmailParams = {
  to: [{ email: 'reader@example.com', name: '' }],
  subject: 'Confirm your FYI subscription',
  htmlBody: '<p>Hello</p>',
};

describe('SesMailProvider', () => {
  let sendSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    sendSpy = jest
      .spyOn(SESv2Client.prototype, 'send')
      .mockResolvedValue({ MessageId: 'msg-123' } as never);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const sentCommand = () => {
    const [command] = sendSpy.mock.calls[0] as [SendEmailCommand];
    return command;
  };
  const sentInput = () => sentCommand().input;

  describe('configuration', () => {
    it('throws when required config is missing', () => {
      expect(
        () =>
          new SesMailProvider(
            makeConfig({
              AWS_SECRET_ACCESS_KEY: undefined,
              SES_FROM_ADDRESS: '',
            }),
          ),
      ).toThrow(
        'SES mail provider is missing required config: AWS_SECRET_ACCESS_KEY, SES_FROM_ADDRESS',
      );
    });

    it('uses the configured region', async () => {
      const provider = new SesMailProvider(makeConfig());
      await provider.send(params);
      const client = sendSpy.mock.contexts[0] as SESv2Client;
      await expect(client.config.region()).resolves.toBe('eu-north-1');
    });
  });

  describe('simple content', () => {
    it('sends HTML with the configured sender and returns the message id', async () => {
      const result = await new SesMailProvider(makeConfig()).send(params);

      expect(result).toEqual({ messageId: 'msg-123' });
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sentCommand()).toBeInstanceOf(SendEmailCommand);
      expect(sentInput()).toEqual({
        FromEmailAddress: '"FYI" <newsletter@marketer.readfyi.com>',
        Destination: {
          ToAddresses: ['reader@example.com'],
          CcAddresses: undefined,
          BccAddresses: undefined,
        },
        ReplyToAddresses: undefined,
        Content: {
          Simple: {
            Subject: { Data: params.subject, Charset: 'UTF-8' },
            Body: { Html: { Data: '<p>Hello</p>', Charset: 'UTF-8' } },
          },
        },
      });
    });

    it('uses a bare from address when SES_FROM_NAME is not set', async () => {
      await new SesMailProvider(makeConfig({ SES_FROM_NAME: undefined })).send(
        params,
      );
      expect(sentInput().FromEmailAddress).toBe(
        'newsletter@marketer.readfyi.com',
      );
    });

    it('uses fromName as the sender name when given', async () => {
      await new SesMailProvider(makeConfig()).send({
        ...params,
        fromName: 'FYI Marketer',
      });
      expect(sentInput().FromEmailAddress).toBe(
        '"FYI Marketer" <newsletter@marketer.readfyi.com>',
      );
    });

    it('includes the plain text body, cc, bcc and reply-to', async () => {
      await new SesMailProvider(makeConfig()).send({
        ...params,
        to: [{ email: 'a@example.com', name: 'Ada Lovelace' }],
        plainTextContent: 'Hello',
        cc: [{ email: 'c@example.com', name: '' }],
        bcc: [{ email: 'b@example.com', name: '' }],
        replyTo: [{ email: 'reply@readfyi.com', name: 'Support' }],
      });

      const input = sentInput();
      expect(input.Destination).toEqual({
        ToAddresses: ['"Ada Lovelace" <a@example.com>'],
        CcAddresses: ['c@example.com'],
        BccAddresses: ['b@example.com'],
      });
      expect(input.ReplyToAddresses).toEqual(['"Support" <reply@readfyi.com>']);
      expect(input.Content?.Simple?.Body?.Text).toEqual({
        Data: 'Hello',
        Charset: 'UTF-8',
      });
    });

    it('encodes non-ASCII display names', async () => {
      await new SesMailProvider(makeConfig()).send({
        ...params,
        to: [{ email: 'a@example.com', name: 'Zoë' }],
      });
      const encoded = Buffer.from('Zoë', 'utf8').toString('base64');
      expect(sentInput().Destination?.ToAddresses).toEqual([
        `=?UTF-8?B?${encoded}?= <a@example.com>`,
      ]);
    });

    it('rejects header injection in display names', async () => {
      await expect(
        new SesMailProvider(makeConfig()).send({
          ...params,
          to: [{ email: 'a@example.com', name: 'x\r\nBcc: evil@example.com' }],
        }),
      ).rejects.toThrow('must not contain line breaks');
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('raw content (attachments)', () => {
    const attachmentContent = Buffer.from('a,b\n1,2').toString('base64');
    const withAttachment: SendEmailParams = {
      ...params,
      subject: 'Your report ✅',
      plainTextContent: 'See attached',
      cc: [{ email: 'c@example.com', name: '' }],
      bcc: [{ email: 'hidden@example.com', name: '' }],
      replyTo: [{ email: 'reply@readfyi.com', name: '' }],
      attachments: [{ name: 'report.csv', content: attachmentContent }],
    };

    const rawMessage = () =>
      Buffer.from(sentInput().Content!.Raw!.Data!).toString('utf8');

    it('sends a MIME message via Content.Raw', async () => {
      await new SesMailProvider(makeConfig()).send(withAttachment);

      const input = sentInput();
      expect(input.Content?.Simple).toBeUndefined();
      expect(input.Destination?.BccAddresses).toEqual(['hidden@example.com']);

      const raw = rawMessage();
      expect(raw).toContain(
        'From: "FYI" <newsletter@marketer.readfyi.com>\r\n',
      );
      expect(raw).toContain('To: reader@example.com\r\n');
      expect(raw).toContain('Cc: c@example.com\r\n');
      expect(raw).toContain('Reply-To: reply@readfyi.com\r\n');
      expect(raw).toContain(
        `Subject: =?UTF-8?B?${Buffer.from('Your report ✅').toString('base64')}?=\r\n`,
      );
      expect(raw).toContain('MIME-Version: 1.0\r\n');
      expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="/);
      expect(raw).toMatch(/Content-Type: multipart\/alternative; boundary="/);
      expect(raw).toContain('Content-Type: text/plain; charset=UTF-8');
      expect(raw).toContain('Content-Type: text/html; charset=UTF-8');
      expect(raw).toContain(Buffer.from('See attached').toString('base64'));
      expect(raw).toContain(Buffer.from('<p>Hello</p>').toString('base64'));
      expect(raw).toContain('Content-Type: text/csv');
      expect(raw).toContain(
        'Content-Disposition: attachment; filename="report.csv"',
      );
      expect(raw).toContain(attachmentContent);
    });

    it('never writes Bcc recipients into the MIME headers', async () => {
      await new SesMailProvider(makeConfig()).send(withAttachment);
      expect(rawMessage()).not.toContain('hidden@example.com');
      expect(rawMessage()).not.toMatch(/^Bcc:/m);
    });

    it('uses only an HTML part when there is no plain text body', async () => {
      await new SesMailProvider(makeConfig()).send({
        ...withAttachment,
        plainTextContent: undefined,
      });
      expect(rawMessage()).not.toContain('multipart/alternative');
      expect(rawMessage()).toContain('Content-Type: text/html; charset=UTF-8');
    });
  });

  describe('custom headers', () => {
    const headers = {
      'List-Unsubscribe':
        '<https://api.readfyi.com/subscriptions/unsubscribe?token=t>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };

    it('passes headers to Content.Simple', async () => {
      await new SesMailProvider(makeConfig()).send({ ...params, headers });
      expect(sentInput().Content?.Simple?.Headers).toEqual([
        { Name: 'List-Unsubscribe', Value: headers['List-Unsubscribe'] },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ]);
    });

    it('omits Headers when none are given', async () => {
      await new SesMailProvider(makeConfig()).send(params);
      expect(sentInput().Content?.Simple?.Headers).toBeUndefined();
    });

    it('writes headers into raw MIME messages', async () => {
      await new SesMailProvider(makeConfig()).send({
        ...params,
        headers,
        attachments: [{ name: 'a.txt', content: 'YQ==' }],
      });
      const raw = Buffer.from(sentInput().Content!.Raw!.Data!).toString('utf8');
      expect(raw).toContain(
        `List-Unsubscribe: ${headers['List-Unsubscribe']}\r\n`,
      );
      expect(raw).toContain(
        'List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n',
      );
    });

    it('rejects header injection in values', async () => {
      await expect(
        new SesMailProvider(makeConfig()).send({
          ...params,
          headers: { 'X-Test': 'a\r\nBcc: victim@example.com' },
        }),
      ).rejects.toThrow('must not contain line breaks');
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it.each(['Bad Name', 'Bad:Name', ''])(
      'rejects invalid header name "%s"',
      async (name) => {
        await expect(
          new SesMailProvider(makeConfig()).send({
            ...params,
            headers: { [name]: 'x' },
          }),
        ).rejects.toThrow('Invalid header name');
      },
    );

    it.each(['From', 'subject', 'Bcc'])(
      'refuses to override the %s header',
      async (name) => {
        await expect(
          new SesMailProvider(makeConfig()).send({
            ...params,
            headers: { [name]: 'x' },
          }),
        ).rejects.toThrow('cannot be set as a custom header');
      },
    );
  });

  describe('error mapping', () => {
    const expectLoggedAndRethrown = async (error: Error, expected: string) => {
      sendSpy.mockRejectedValueOnce(error);
      await expect(new SesMailProvider(makeConfig()).send(params)).rejects.toBe(
        error,
      );
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [logged] = errorSpy.mock.calls[0] as [string];
      expect(logged).toContain(expected);
    };

    it('explains sandbox recipient rejections', () =>
      expectLoggedAndRethrown(
        awsError(
          'MessageRejected',
          'Email address is not verified. The following identities failed the check in region EU-NORTH-1: reader@example.com',
        ),
        'recipient is not verified. The SES account is in the sandbox',
      ));

    it('explains an unverified sender', () =>
      expectLoggedAndRethrown(
        awsError(
          'MessageRejected',
          'Email address is not verified. The following identities failed the check in region EU-NORTH-1: newsletter@marketer.readfyi.com',
        ),
        'sender newsletter@marketer.readfyi.com is not a verified SES identity',
      ));

    it('explains other message rejections', () =>
      expectLoggedAndRethrown(
        awsError('MessageRejected', 'Illegal address'),
        'SES rejected the message. Illegal address',
      ));

    it('explains throttling', () =>
      expectLoggedAndRethrown(
        awsError('TooManyRequestsException', 'Maximum sending rate exceeded.'),
        'SES is throttling requests',
      ));

    it('explains an exhausted daily quota', () =>
      expectLoggedAndRethrown(
        awsError('LimitExceededException', 'Daily message quota exceeded.'),
        'the 24-hour SES sending quota is used up',
      ));

    it('explains IAM access denied errors', () =>
      expectLoggedAndRethrown(
        awsError(
          'AccessDeniedException',
          "User 'arn:aws:iam::123:user/ses-api-sender' is not authorized to perform 'ses:SendEmail'",
        ),
        'the IAM credentials are not allowed to send',
      ));

    it('explains access denied on a configuration set', () =>
      expectLoggedAndRethrown(
        awsError(
          'AccessDeniedException',
          "User 'arn:aws:iam::123:user/ses-api-sender' is not authorized to perform 'ses:SendEmail' on resource 'arn:aws:ses:eu-north-1:123:configuration-set/my-first-configuration-set'",
        ),
        'does not allow ses:SendEmail on the configuration set',
      ));

    it('explains paused sending', () =>
      expectLoggedAndRethrown(
        awsError('SendingPausedException', 'Sending paused'),
        'sending is paused',
      ));

    it('logs unknown errors with the original message', () =>
      expectLoggedAndRethrown(
        new Error('socket hang up'),
        'SES send failed (Error) for "Confirm your FYI subscription" to [reader@example.com]: socket hang up',
      ));
  });
});
