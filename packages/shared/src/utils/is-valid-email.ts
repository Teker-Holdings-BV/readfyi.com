import isEmail from "validator/lib/isEmail";
import disposableDomains from "disposable-email-domains";
import wildcardDisposableDomains from "disposable-email-domains/wildcard";
import hasMX from "./has-mx";

// Built on first use, so importing this module stays cheap (~120k domains).
let disposable: { exact: Set<string>; wildcard: Set<string> } | undefined;

const isDisposableDomain = (domain: string) => {
  disposable ??= {
    exact: new Set(disposableDomains),
    wildcard: new Set(wildcardDisposableDomains),
  };
  if (disposable.exact.has(domain)) return true;

  // Subdomains count too: x.mailinator.com is treated like mailinator.com.
  const labels = domain.split(".");
  for (let i = 1; i < labels.length - 1; i++) {
    const parent = labels.slice(i).join(".");
    if (disposable.wildcard.has(parent) || disposable.exact.has(parent)) {
      return true;
    }
  }
  return false;
};

const isValidEmail = async (email: string) => {
  if (
    !isEmail(email, {
      allow_utf8_local_part: false,
      require_tld: true,
      allow_ip_domain: false,
    })
  ) {
    return false;
  }

  const [local, domain] = email.split("@");

  if (local.length > 64 || domain.length > 253) return false;

  if (/[​-‏‪-‮]/.test(email)) return false;

  // Before the MX lookup: it's local and avoids a DNS round trip.
  if (isDisposableDomain(domain.toLowerCase())) return false;

  if (!(await hasMX(domain))) return false;

  return true;
};

export default isValidEmail;

// Check A records
// Some domains exist but never allow inbound mail (facebook.com, instagram.com, github.com)
//
