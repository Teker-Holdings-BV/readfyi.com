import { Module } from '@nestjs/common';
import { EmailModule } from 'src/email/email.module';
import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';
import { NewsletterSenderService } from './newsletter-sender.service';

@Module({
  imports: [SubscriptionsModule, EmailModule],
  providers: [NewsletterSenderService],
})
export class NewslettersModule {}
