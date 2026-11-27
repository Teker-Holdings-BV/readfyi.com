import { Module } from '@nestjs/common';
import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [SubscriptionsModule],
  controllers: [MetricsController],
})
export class MetricsModule {}
