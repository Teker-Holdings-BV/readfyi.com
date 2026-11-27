import { BadRequestException } from '@nestjs/common';
import { NewsletterEnum } from '@readfyi/shared';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscribersService } from 'src/subscribers/subscribers.service';
import { EmailService } from 'src/email/email.service';

describe('SubscriptionsController.subscribe', () => {
  let isValid: jest.Mock;
  let findOneOrCreate: jest.Mock;
  let updateOne: jest.Mock;
  let createSubscription: jest.Mock;
  let controller: SubscriptionsController;

  beforeEach(() => {
    isValid = jest.fn().mockResolvedValue(true);
    findOneOrCreate = jest.fn().mockResolvedValue({ uuid: 'sub-1' });
    updateOne = jest.fn().mockResolvedValue(undefined);
    createSubscription = jest.fn().mockResolvedValue(undefined);
    controller = new SubscriptionsController(
      { findOneOrCreate, updateOne } as unknown as SubscribersService,
      {
        findOneOrCreate: createSubscription,
      } as unknown as SubscriptionsService,
      { isValid } as unknown as EmailService,
    );
  });

  it('normalizes the email and subscribes valid addresses', async () => {
    await controller.subscribe({
      email: '  Reader@Gmail.com ',
      newsletters: [NewsletterEnum.Marketer],
    });

    expect(isValid).toHaveBeenCalledWith('reader@gmail.com');
    expect(findOneOrCreate).toHaveBeenCalledWith('reader@gmail.com');
    expect(createSubscription).toHaveBeenCalledWith({
      subscriberUuid: 'sub-1',
      newsletter: NewsletterEnum.Marketer,
    });
  });

  it('stores the Meta click IDs until the double opt-in', async () => {
    await controller.subscribe({
      email: 'reader@gmail.com',
      newsletters: [NewsletterEnum.Marketer],
      fbc: 'fb.1.1700000000000.abc',
      fbp: 'fb.1.1700000000000.123',
    });

    expect(updateOne).toHaveBeenCalledWith('sub-1', {
      fbc: 'fb.1.1700000000000.abc',
      fbp: 'fb.1.1700000000000.123',
    });
  });

  it('keeps the click IDs of verified subscribers', async () => {
    findOneOrCreate.mockResolvedValue({
      uuid: 'sub-1',
      verifiedAt: new Date(),
    });

    await controller.subscribe({
      email: 'reader@gmail.com',
      newsletters: [NewsletterEnum.Marketer],
      fbc: 'fb.1.1700000000000.abc',
    });

    expect(updateOne).not.toHaveBeenCalled();
  });

  it('rejects invalid addresses before creating a subscriber', async () => {
    isValid.mockResolvedValue(false);

    await expect(
      controller.subscribe({
        email: 'x@mailinator.com',
        newsletters: [NewsletterEnum.Marketer],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findOneOrCreate).not.toHaveBeenCalled();
  });

  it('rejects a missing email', async () => {
    await expect(
      controller.subscribe({
        email: undefined as unknown as string,
        newsletters: [NewsletterEnum.Marketer],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(isValid).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsController.unsubscribe', () => {
  const uuid = '3f2b8a52-5d0e-4b8e-9a43-1c2d3e4f5a6b';
  let deleteSubscription: jest.Mock;
  let controller: SubscriptionsController;

  beforeEach(() => {
    deleteSubscription = jest.fn().mockResolvedValue(undefined);
    controller = new SubscriptionsController(
      {} as SubscribersService,
      { delete: deleteSubscription } as unknown as SubscriptionsService,
      {} as EmailService,
    );
  });

  it('removes only that newsletter subscription', async () => {
    await expect(controller.unsubscribe(uuid, 'marketer')).resolves.toEqual({
      unsubscribed: true,
    });
    expect(deleteSubscription).toHaveBeenCalledWith({
      subscriberUuid: uuid,
      newsletter: NewsletterEnum.Marketer,
    });
  });

  it.each([
    ['not-a-uuid', 'marketer'],
    [uuid, 'unknown'],
    [undefined, 'marketer'],
    [uuid, undefined],
  ])('rejects token=%s newsletter=%s', async (token, newsletter) => {
    await expect(
      controller.unsubscribe(token as string, newsletter as string),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deleteSubscription).not.toHaveBeenCalled();
  });
});
