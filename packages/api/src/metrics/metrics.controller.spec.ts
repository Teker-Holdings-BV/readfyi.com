import { MetricsController } from './metrics.controller';
import { SubscriptionsService } from 'src/subscriptions/subscriptions.service';

describe('MetricsController', () => {
  it('returns the subscription row count as subscribers', async () => {
    const countAll = jest.fn().mockResolvedValue(42);
    const controller = new MetricsController({
      countAll,
    } as unknown as SubscriptionsService);

    await expect(controller.getMetrics()).resolves.toEqual({ subscribers: 42 });
    expect(countAll).toHaveBeenCalled();
  });
});
