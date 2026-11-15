import disposableDomains from 'disposable-email-domains';
import wildcardDomains from 'disposable-email-domains/wildcard';

const exact = new Set(disposableDomains.map((d) => d.toLowerCase()));
const wildcard = new Set(wildcardDomains.map((d) => d.toLowerCase()));

/**
 * True when the email's domain is a known disposable/temporary email provider.
 * Subdomains count too: `x.mailinator.com` is treated like `mailinator.com`.
 */
export const isDisposableEmail = (email: string): boolean => {
  const domain = email.trim().toLowerCase().split('@').pop();
  if (!domain) return false;

  if (exact.has(domain)) return true;

  const labels = domain.split('.');
  for (let i = 1; i < labels.length - 1; i++) {
    const parent = labels.slice(i).join('.');
    if (wildcard.has(parent) || exact.has(parent)) return true;
  }
  return false;
};
