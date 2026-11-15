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

// Misspellings of the big providers. Many are registered and accept mail
// (some are spam traps), so the MX check alone doesn't catch them.
const TYPO_DOMAINS = new Set([
  // gmail.com
  "gmial.com", "gmai.com", "gmal.com", "gmaill.com", "gamil.com", "gnail.com",
  "gmali.com", "gmaul.com", "gmeil.com", "gimail.com", "gmail.co", "gmail.con",
  "gmail.cm", "gmail.om", "gmail.cmo", "gmail.comm", "gmail.vom", "gmail.xom",
  // hotmail.com
  "hotmial.com", "hotmai.com", "hotmal.com", "hotmil.com", "hotnail.com",
  "hotmaill.com", "hormail.com", "homail.com", "hotmail.co", "hotmail.con",
  "hotmail.cm", "hotmail.cmo",
  // yahoo.com
  "yahooo.com", "yaho.com", "yhoo.com", "yahho.com", "yaoo.com", "tahoo.com",
  "yahoo.co", "yahoo.con", "yahoo.cm", "yahoo.cmo",
  // outlook.com
  "outlok.com", "outllok.com", "otlook.com", "outloo.com", "outlookk.com",
  "outlook.co", "outlook.con", "outlook.cm",
  // icloud.com
  "iclod.com", "icoud.com", "iclould.com", "icluod.com", "icloud.co",
  "icloud.con", "icloud.cm",
  // live.com
  "live.con", "live.cm",
]);

// Reserved for testing and documentation (RFC 2606, RFC 6761): never deliverable.
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local"]);
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

// Domains that exist but have no mailboxes for the public.
const NO_INBOUND_DOMAINS = new Set(["users.noreply.github.com"]);

// Machine mailboxes. No person subscribes to a newsletter with these.
const NO_REPLY_LOCAL_PARTS = new Set([
  "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
  "do_not_reply", "mailer-daemon", "postmaster", "abuse", "bounce", "bounces",
]);

const isUndeliverableDomain = (domain: string) => {
  const tld = domain.split(".").pop() ?? "";
  return (
    TYPO_DOMAINS.has(domain) ||
    RESERVED_TLDS.has(tld) ||
    RESERVED_DOMAINS.has(domain) ||
    NO_INBOUND_DOMAINS.has(domain)
  );
};

const isNoReplyLocalPart = (local: string) =>
  // Ignore "+tag" subaddressing: noreply+x@ is still noreply@.
  NO_REPLY_LOCAL_PARTS.has(local.toLowerCase().split("+")[0]);

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

  // Local checks before the MX lookup, which needs DNS round trips.
  const normalizedDomain = domain.toLowerCase();
  if (isUndeliverableDomain(normalizedDomain)) return false;
  if (isDisposableDomain(normalizedDomain)) return false;
  if (isNoReplyLocalPart(local)) return false;

  if (!(await hasMX(domain))) return false;

  return true;
};

export default isValidEmail;
