import { Controller, Get } from '@nestjs/common';
import { MetricsResponse } from '@readfyi/shared';
import { SubscriptionsService } from 'src/subscriptions/subscriptions.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  async getMetrics(): Promise<MetricsResponse> {
    return { subscribers: await this.subscriptionsService.countAll() };
  }
}
