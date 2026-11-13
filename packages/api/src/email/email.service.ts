import { Injectable, Logger } from '@nestjs/common';
import { isValidEmail } from '@readfyi/shared';
import { isProdLike } from '@readfyi/shared';
import { MailProvider, SendEmailParams } from './mail-provider';

export type { SendEmailParams } from './mail-provider';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly mailProvider: MailProvider) {}

  send(params: SendEmailParams) {
    if (!isProdLike()) {
      this.logger.log(
        'Current environment is not production-like. Email will not be sent but only logged.',
      );
      this.logger.log(params);
      return;
    }

    this.logger.log('Sending email...');
    this.logger.log(params);

    return this.mailProvider.send(params);
  }

  async isValid(email: string) {
    return isValidEmail(email);
  }
}
