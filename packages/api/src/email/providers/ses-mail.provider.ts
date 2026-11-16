import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SESv2Client,
  SendEmailCommand,
  SendEmailCommandInput,
} from '@aws-sdk/client-sesv2';
import {
  EmailAddress,
  MailProvider,
  SendEmailParams,
  SendEmailResult,
} from '../mail-provider';
import {
  assertValidHeaders,
  buildRawMessage,
  encodeHeaderValue,
  formatAddress,
} from './mime';

const REQUIRED_CONFIG = [
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'SES_FROM_ADDRESS',
] as const;

@Injectable()
export class SesMailProvider extends MailProvider {
  private readonly logger = new Logger(SesMailProvider.name);
  private readonly client: SESv2Client;
  private readonly from: EmailAddress;

  constructor(config: ConfigService) {
    super();

    const missing = REQUIRED_CONFIG.filter((key) => !config.get<string>(key));
    if (missing.length) {
      throw new Error(
        `SES mail provider is missing required config: ${missing.join(', ')}`,
      );
    }

    this.client = new SESv2Client({
      region: config.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY')!,
      },
    });
    this.from = {
      email: config.get<string>('SES_FROM_ADDRESS')!,
      name: config.get<string>('SES_FROM_NAME') ?? '',
    };
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    try {
      const output = await this.client.send(
        new SendEmailCommand(this.buildInput(params)),
      );
      return { messageId: output.MessageId };
    } catch (error) {
      this.logger.error(this.describeError(error, params));
      throw error;
    }
  }

  private sender(params: SendEmailParams): EmailAddress {
    return params.fromName
      ? { email: this.from.email, name: params.fromName }
      : this.from;
  }

  private buildInput(params: SendEmailParams): SendEmailCommandInput {
    return {
      FromEmailAddress: formatAddress(this.sender(params)),
      Destination: {
        ToAddresses: params.to.map(formatAddress),
        CcAddresses: params.cc?.map(formatAddress),
        BccAddresses: params.bcc?.map(formatAddress),
      },
      ReplyToAddresses: params.replyTo?.map(formatAddress),
      Content: this.buildContent(params),
    };
  }

  private buildContent(
    params: SendEmailParams,
  ): SendEmailCommandInput['Content'] {
    if (params.attachments?.length) {
      // Attachments require a hand-built MIME message.
      const raw = buildRawMessage({
        from: this.sender(params),
        to: params.to,
        cc: params.cc,
        replyTo: params.replyTo,
        subject: params.subject,
        htmlBody: params.htmlBody,
        textBody: params.plainTextContent,
        attachments: params.attachments,
        headers: params.headers,
      });
      return { Raw: { Data: Buffer.from(raw, 'utf8') } };
    }

    if (params.headers) assertValidHeaders(params.headers);

    return {
      Simple: {
        ...(params.headers && {
          Headers: Object.entries(params.headers).map(([Name, Value]) => ({
            Name,
            Value,
          })),
        }),
        Subject: { Data: params.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: params.htmlBody, Charset: 'UTF-8' },
          ...(params.plainTextContent && {
            Text: { Data: params.plainTextContent, Charset: 'UTF-8' },
          }),
        },
      },
    };
  }

  private describeError(error: unknown, params: SendEmailParams): string {
    const name = (error as { name?: string })?.name ?? 'UnknownError';
    const message = (error as { message?: string })?.message ?? String(error);
    const recipients = [
      ...params.to,
      ...(params.cc ?? []),
      ...(params.bcc ?? []),
    ]
      .map((r) => r.email)
      .join(', ');
    const prefix = `SES send failed (${name}) for "${encodeHeaderValue(params.subject)}" to [${recipients}]`;

    if (name === 'MessageRejected' && /not verified/i.test(message)) {
      const senderRejected = message
        .toLowerCase()
        .includes(this.from.email.toLowerCase());
      return senderRejected
        ? `${prefix}: sender ${this.from.email} is not a verified SES identity in this region. ${message}`
        : `${prefix}: recipient is not verified. The SES account is in the sandbox and can only send to verified addresses. ${message}`;
    }
    if (/daily message quota|max24hoursend/i.test(message)) {
      return `${prefix}: the 24-hour SES sending quota is used up. ${message}`;
    }
    if (
      name === 'TooManyRequestsException' ||
      name === 'Throttling' ||
      name === 'ThrottlingException' ||
      /maximum sending rate|rate exceeded/i.test(message)
    ) {
      return `${prefix}: SES is throttling requests because the maximum send rate was exceeded. Retry with backoff. ${message}`;
    }
    if (name === 'LimitExceededException') {
      return `${prefix}: an SES sending limit was exceeded. ${message}`;
    }
    if (name === 'AccessDeniedException' || name === 'AccessDenied') {
      if (/configuration-set\//.test(message)) {
        return `${prefix}: the IAM policy does not allow ses:SendEmail on the configuration set applied to this email (likely the sending identity's default configuration set). Add the configuration set ARN to the policy's resources. ${message}`;
      }
      return `${prefix}: the IAM credentials are not allowed to send for one of the identities in this request. In the SES sandbox, the IAM policy must allow ses:SendEmail on both the sender identity and each recipient identity. ${message}`;
    }
    if (name === 'MessageRejected') {
      return `${prefix}: SES rejected the message. ${message}`;
    }
    if (name === 'MailFromDomainNotVerifiedException') {
      return `${prefix}: the custom MAIL FROM domain is not verified. ${message}`;
    }
    if (name === 'SendingPausedException') {
      return `${prefix}: sending is paused for this account or configuration set. ${message}`;
    }
    if (name === 'AccountSuspendedException') {
      return `${prefix}: the SES account is suspended from sending. ${message}`;
    }
    if (name === 'NotFoundException') {
      return `${prefix}: an SES resource (identity or configuration set) was not found. ${message}`;
    }
    return `${prefix}: ${message}`;
  }
}
