import { Entity, Column, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/base.entity';
import { SubscriberProps } from '@readfyi/shared';
import { SubscriptionsEntity } from 'src/subscriptions/subscriptions.entity';

@Entity('subscribers')
export class SubscribersEntity extends BaseEntity implements SubscriberProps {
  @Index()
  @Column({ unique: true })
  email: string;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt?: Date;

  // Meta IDs from signup, handed back on verify so the Subscribe event can be
  // tracked from the email app's browser, which does not have them.
  @Column({ type: 'varchar', nullable: true })
  fbc?: string;

  @Column({ type: 'varchar', nullable: true })
  fbp?: string;

  @OneToMany(
    () => SubscriptionsEntity,
    (subscription) => subscription.subscriber,
  )
  subscriptions?: SubscriptionsEntity[];
}
