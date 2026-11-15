import { isDisposableEmail } from './disposable-email';
import { normalizeEmail } from './normalize-email';

describe('isDisposableEmail', () => {
  it.each([
    'someone@mailinator.com',
    'Someone@MAILINATOR.com',
    'x@10minutemail.com',
    'x@guerrillamail.com',
  ])('flags %s', (email) => {
    expect(isDisposableEmail(email)).toBe(true);
  });

  it('flags subdomains of disposable domains', () => {
    expect(isDisposableEmail('x@inbox.mailinator.com')).toBe(true);
  });

  it.each([
    'reader@gmail.com',
    'reader@outlook.com',
    'reader@readfyi.com',
    'reader@mail.google.com',
    'not-an-email',
    '',
  ])('allows %s', (email) => {
    expect(isDisposableEmail(email)).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Reader@Example.COM ')).toBe('reader@example.com');
  });
});
