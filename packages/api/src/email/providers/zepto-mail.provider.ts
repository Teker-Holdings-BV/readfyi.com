import { ConfigService } from '@nestjs/config';
import { SendMailClient } from 'zeptomail';
import {
  MailProvider,
  SendEmailParams,
  SendEmailResult,
} from '../mail-provider';

/**
 * Legacy ZeptoMail transport, kept as a fallback (MAIL_PROVIDER=zepto)
 * until the switch to SES is confirmed.
 */
export class ZeptoMailProvider extends MailProvider {
  private readonly client: SendMailClient;

  constructor(config: ConfigService) {
    super();
    this.client = new SendMailClient({
      url: 'api.zeptomail.eu/',
      token: config.get<string>('ZEPTO_API_KEY'),
    });
  }

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    await this.client.sendMail({
      from: {
        address: 'newsletter@readfyi.com',
        name: 'FYI Newsletter',
      },
      to: params.to.map((to) => ({
        email_address: { address: to.email, name: to.name },
      })),
      subject: params.subject,
      htmlBody: params.htmlBody,
      cc: params.cc?.map((cc) => ({
        email_address: { address: cc.email, name: cc.name },
      })),
      bcc: params.bcc?.map((bcc) => ({
        email_address: { address: bcc.email, name: bcc.name },
      })),
      attachments: params.attachments?.map((att) => ({
        name: att.name,
        content: att.content,
      })),
    });
    return {};
  }
}
