import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
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
import { validate as isUuid } from 'uuid';

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

    // Kept until the double opt-in, where Subscribe is tracked.
    if (!subscriber.verifiedAt && (body.fbc || body.fbp)) {
      await this.subscribersService.updateOne(subscriber.uuid, {
        fbc: body.fbc,
        fbp: body.fbp,
      });
    }

    for (const newsletter of body.newsletters) {
      await this.subscriptionsService.findOneOrCreate({
        subscriberUuid: subscriber.uuid,
        newsletter,
      });
    }
  }

  /**
   * One-click unsubscribe (RFC 8058), linked from the List-Unsubscribe header.
   * Mail providers POST here without cookies or confirmation, so it must not
   * require anything but the link's own parameters.
   */
  @Post('/unsubscribe')
  @HttpCode(200)
  async unsubscribe(
    @Query('token') subscriberUuid: string,
    @Query('newsletter') newsletter: string,
  ) {
    const isNewsletter = (Object.values(NewsletterEnum) as string[]).includes(
      newsletter,
    );
    if (!isUuid(subscriberUuid) || !isNewsletter) {
      throw new BadRequestException('Invalid unsubscribe link.');
    }

    await this.subscriptionsService.delete({
      subscriberUuid,
      newsletter: newsletter as NewsletterEnum,
    });
    return { unsubscribed: true };
  }
}
