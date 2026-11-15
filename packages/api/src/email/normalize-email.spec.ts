import { normalizeEmail } from './normalize-email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Reader@Example.COM ')).toBe('reader@example.com');
  });
});
