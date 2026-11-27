import { Injectable, Logger } from '@nestjs/common';
import { NewsletterEnum, SubscriptionProps } from '@readfyi/shared';
import { SubscribersService } from 'src/subscribers/subscribers.service';
import { SubscriptionsEntity } from './subscriptions.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  subscriptions: SubscriptionProps[] = [];

  constructor(
    @InjectRepository(SubscriptionsEntity)
    private subscriptionsRepository: Repository<SubscriptionsEntity>,
    private readonly subscribersService: SubscribersService,
  ) {}

  async findOne(
    subscription: Pick<SubscriptionProps, 'subscriberUuid' | 'newsletter'>,
  ): Promise<SubscriptionsEntity | null> {
    return this.subscriptionsRepository.findOne({
      where: {
        subscriber: { uuid: subscription.subscriberUuid },
        newsletter: subscription.newsletter,
      },
    });
  }

  /**
   * Recipients for a newsletter send: subscriptions that are not deleted, of
   * subscribers that are not deleted and confirmed their email (double opt-in).
   */
  async findActiveRecipients(
    newsletter: NewsletterEnum,
  ): Promise<{ subscriberUuid: string; email: string }[]> {
    const subscriptions = await this.subscriptionsRepository
      .createQueryBuilder('subscription')
      .innerJoin('subscription.subscriber', 'subscriber')
      .select(['subscription.uuid', 'subscriber.uuid', 'subscriber.email'])
      .where('subscription.newsletter = :newsletter', { newsletter })
      .andWhere('subscriber.verifiedAt IS NOT NULL')
      .andWhere('subscriber.deletedAt IS NULL')
      .orderBy('subscriber.createdAt', 'ASC')
      .getMany();

    return subscriptions.map((s) => ({
      subscriberUuid: s.subscriber.uuid,
      email: s.subscriber.email,
    }));
  }

  /** Every subscription row ever created, soft-deleted ones included. */
  async countAll(): Promise<number> {
    return this.subscriptionsRepository.count({ withDeleted: true });
  }

  async findBySubscriberUuid(
    subscriberUuid: string,
  ): Promise<SubscriptionsEntity[]> {
    return this.subscriptionsRepository.find({
      where: {
        subscriber: {
          uuid: subscriberUuid,
        },
      },
      loadEagerRelations: false,
    });
  }

  async create(
    subscription: Pick<SubscriptionProps, 'subscriberUuid' | 'newsletter'>,
  ): Promise<SubscriptionsEntity> {
    this.logger.log(`Creating subscription: ${JSON.stringify(subscription)}`);

    const subscriber = await this.subscribersService.findOne(
      subscription.subscriberUuid,
    );

    if (!subscriber) {
      throw new Error(
        `There is not subscriber with uuid: ${subscription.subscriberUuid}`,
      );
    }

    return this.subscriptionsRepository.save({
      subscriber: { uuid: subscriber.uuid },
      newsletter: subscription.newsletter,
    });
  }

  async findOneOrCreate(
    subscription: Pick<SubscriptionProps, 'subscriberUuid' | 'newsletter'>,
  ): Promise<SubscriptionsEntity> {
    let _subscription = await this.findOne(subscription);

    if (!_subscription) {
      _subscription = await this.create(subscription);
    }

    return _subscription;
  }

  async delete(
    subscription: Pick<SubscriptionProps, 'subscriberUuid' | 'newsletter'>,
  ) {
    return this.subscriptionsRepository.softDelete({
      subscriber: { uuid: subscription.subscriberUuid },
      newsletter: subscription.newsletter,
    });
  }
}
