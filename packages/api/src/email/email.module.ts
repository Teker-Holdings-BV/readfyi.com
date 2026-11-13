import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { MailProvider } from './mail-provider';
import { SesMailProvider } from './providers/ses-mail.provider';
import { ZeptoMailProvider } from './providers/zepto-mail.provider';

export function createMailProvider(config: ConfigService): MailProvider {
  const provider = config.get<string>('MAIL_PROVIDER') ?? 'ses';
  switch (provider) {
    case 'ses':
      return new SesMailProvider(config);
    case 'zepto':
      return new ZeptoMailProvider(config);
    default:
      throw new Error(
        `Unknown MAIL_PROVIDER "${provider}". Expected "ses" or "zepto".`,
      );
  }
}

@Module({
  imports: [],
  providers: [
    EmailService,
    {
      provide: MailProvider,
      inject: [ConfigService],
      useFactory: createMailProvider,
    },
  ],
  controllers: [EmailController],
  exports: [EmailService],
})
export class EmailModule {}
