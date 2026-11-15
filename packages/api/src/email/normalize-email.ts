/**
 * Canonical form used for storing and looking up subscriber emails, so
 * `Foo@Example.com ` and `foo@example.com` are the same subscriber.
 */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();
