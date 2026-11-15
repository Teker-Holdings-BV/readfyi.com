import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CreateSubscriptionsRequest,
  UpdateSubscriptionsRequest,
} from '@readfyi/shared';
import { SubscriptionsService } from './subscriptions.service';
import { SubscribersService } from 'src/subscribers/subscribers.service';
import { NewsletterEnum } from '@readfyi/shared';
import { EmailService } from 'src/email/email.service';
import { normalizeEmail } from 'src/email/normalize-email';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscribersService: SubscribersService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly emailService: EmailService,
  ) {}

  @Get()
  async getSubscriptions(@Query('subscriberUuid') subscriberUuid: string) {
    if (!subscriberUuid) return;
    return this.subscriptionsService.findBySubscriberUuid(subscriberUuid);
  }

  @Put()
  async updateSubscriptions(
    // @Query('subscriberUuid') subscriberUuid: string,
    @Body() body: UpdateSubscriptionsRequest,
  ) {
    const missingNewsletters = Object.values(NewsletterEnum).filter(
      (n) => !body.newsletters.includes(n),
    );

    for (const newsletter of missingNewsletters) {
      await this.subscriptionsService.delete({
        subscriberUuid: body.subscriberUuid,
        newsletter,
      });
    }

    console.log(missingNewsletters);

    for (const newsletter of body.newsletters) {
      await this.subscriptionsService.findOneOrCreate({
        subscriberUuid: body.subscriberUuid,
        newsletter,
      });
    }
  }

  @Post()
  async subscribe(@Body() body: CreateSubscriptionsRequest) {
    const email =
      typeof body?.email === 'string' ? normalizeEmail(body.email) : '';

    // Validate before the subscriber is created: creating it sends the
    // confirmation email, and bad addresses bounce and hurt the SES reputation.
    if (!email || !(await this.emailService.isValid(email))) {
      throw new BadRequestException('Please enter a valid email address.');
    }

    const subscriber = await this.subscribersService.findOneOrCreate(email);

    for (const newsletter of body.newsletters) {
      await this.subscriptionsService.findOneOrCreate({
        subscriberUuid: subscriber.uuid,
        newsletter,
      });
    }
  }
}
