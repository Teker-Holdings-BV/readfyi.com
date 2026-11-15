import { Injectable, Logger } from '@nestjs/common';
import { isValidEmail } from '@readfyi/shared';
import { isProdLike } from '@readfyi/shared';
import { MailProvider, SendEmailParams } from './mail-provider';
import { isDisposableEmail } from './disposable-email';
import { normalizeEmail } from './normalize-email';

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

  /**
   * Whether we are willing to send to this address: well-formed, not a
   * disposable provider, and the domain accepts mail (MX lookup).
   */
  async isValid(email: string) {
    const normalized = normalizeEmail(email);
    // Cheap local check first; the MX lookup needs a DNS round trip.
    if (isDisposableEmail(normalized)) return false;
    return isValidEmail(normalized);
  }
}
