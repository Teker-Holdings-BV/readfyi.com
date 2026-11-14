import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { MailProvider } from './mail-provider';
import { SesMailProvider } from './providers/ses-mail.provider';

@Module({
  imports: [],
  providers: [
    EmailService,
    { provide: MailProvider, useClass: SesMailProvider },
  ],
  controllers: [EmailController],
  exports: [EmailService],
})
export class EmailModule {}
