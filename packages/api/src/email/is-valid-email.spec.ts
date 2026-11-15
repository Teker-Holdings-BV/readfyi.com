// Tests the shared validator (@readfyi/shared has no test runner of its own).
// DNS is mocked, so nothing here touches the network.
import { promises as dns } from 'dns';
import { isValidEmail } from '@readfyi/shared';

jest.mock('dns', () => ({
  promises: {
    resolveMx: jest.fn(),
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
}));

const resolveMx = jest.mocked(dns.resolveMx);
const resolve4 = jest.mocked(dns.resolve4);
const resolve6 = jest.mocked(dns.resolve6);

const noRecords = () => Promise.reject(new Error('ENODATA'));

describe('isValidEmail (shared)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    resolveMx.mockResolvedValue([
      { exchange: 'mx.example-mail.net', priority: 10 },
    ]);
    resolve4.mockResolvedValue(['203.0.113.10'] as never);
    resolve6.mockImplementation(noRecords as never);
  });

  it.each(['reader@gmail.com', 'Reader.Name+fyi@outlook.com', 'a@company.io'])(
    'accepts %s',
    async (email) => {
      await expect(isValidEmail(email)).resolves.toBe(true);
    },
  );

  it.each(['not-an-email', 'a@b', 'user@127.0.0.1'])(
    'rejects malformed address %s',
    async (email) => {
      await expect(isValidEmail(email)).resolves.toBe(false);
    },
  );

  it.each([
    'someone@mailinator.com',
    'Someone@MAILINATOR.com',
    'x@inbox.mailinator.com',
    'x@10minutemail.com',
  ])('rejects disposable address %s', async (email) => {
    await expect(isValidEmail(email)).resolves.toBe(false);
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it.each([
    'reader@gmial.com',
    'reader@gmail.con',
    'reader@GMAIL.CO',
    'reader@hotmial.com',
    'reader@yahooo.com',
    'reader@outlok.com',
    'reader@icloud.co',
  ])('rejects provider typo %s', async (email) => {
    await expect(isValidEmail(email)).resolves.toBe(false);
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it.each([
    'reader@example.com',
    'reader@company.test',
    'reader@company.example',
    'reader@host.localhost',
    'reader@printer.local',
    '123+reader@users.noreply.github.com',
  ])('rejects undeliverable domain %s', async (email) => {
    await expect(isValidEmail(email)).resolves.toBe(false);
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it.each([
    'noreply@company.io',
    'No-Reply@company.io',
    'donotreply@company.io',
    'mailer-daemon@company.io',
    'postmaster@company.io',
    'noreply+news@company.io',
  ])('rejects machine mailbox %s', async (email) => {
    await expect(isValidEmail(email)).resolves.toBe(false);
  });

  it('accepts local parts that only contain a blocked word', async () => {
    await expect(isValidEmail('noreplyfan@company.io')).resolves.toBe(true);
  });

  describe('MX check', () => {
    it('rejects a domain without MX records', async () => {
      resolveMx.mockImplementation(noRecords as never);
      await expect(isValidEmail('a@company.io')).resolves.toBe(false);
    });

    it('rejects a null MX (RFC 7505)', async () => {
      resolveMx.mockResolvedValue([{ exchange: '.', priority: 0 }]);
      await expect(isValidEmail('a@company.io')).resolves.toBe(false);
    });

    it('rejects MX hosts that do not resolve', async () => {
      resolve4.mockImplementation(noRecords as never);
      await expect(isValidEmail('a@company.io')).resolves.toBe(false);
    });

    it.each(['127.0.0.1', '0.0.0.0', '10.1.2.3', '192.168.1.1', '172.16.0.1'])(
      'rejects MX hosts that only resolve to %s',
      async (ip) => {
        resolve4.mockResolvedValue([ip] as never);
        await expect(isValidEmail('a@company.io')).resolves.toBe(false);
      },
    );

    it('rejects MX hosts that only resolve to IPv6 loopback', async () => {
      resolve4.mockImplementation(noRecords as never);
      resolve6.mockResolvedValue(['::1'] as never);
      await expect(isValidEmail('a@company.io')).resolves.toBe(false);
    });

    it('accepts an IPv6-only MX host', async () => {
      resolve4.mockImplementation(noRecords as never);
      resolve6.mockResolvedValue(['2001:4860:4860::8888'] as never);
      await expect(isValidEmail('a@company.io')).resolves.toBe(true);
    });

    it('accepts when one of several MX hosts is public', async () => {
      resolveMx.mockResolvedValue([
        { exchange: 'dead.example-mail.net', priority: 5 },
        { exchange: 'mx.example-mail.net', priority: 10 },
      ]);
      resolve4.mockImplementation(((host: string) =>
        host.startsWith('dead')
          ? Promise.resolve(['127.0.0.1'])
          : Promise.resolve(['203.0.113.10'])) as never);
      await expect(isValidEmail('a@company.io')).resolves.toBe(true);
    });
  });
});
