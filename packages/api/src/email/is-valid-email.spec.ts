// Tests the shared validator (@readfyi/shared has no test runner of its own).
import { isValidEmail } from '@readfyi/shared';

describe('isValidEmail (shared)', () => {
  it.each([
    'someone@mailinator.com',
    'Someone@MAILINATOR.com',
    'x@inbox.mailinator.com',
    'x@10minutemail.com',
    'x@guerrillamail.com',
  ])('rejects disposable address %s', async (email) => {
    // Rejected before the MX lookup, so this needs no network.
    await expect(isValidEmail(email)).resolves.toBe(false);
  });

  it.each(['not-an-email', 'a@b', 'user@127.0.0.1'])(
    'rejects malformed address %s',
    async (email) => {
      await expect(isValidEmail(email)).resolves.toBe(false);
    },
  );
});
