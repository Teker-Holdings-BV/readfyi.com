import { NewsletterEnum } from "@readfyi/shared";

/**
 * Marketing landing pages that reuse an existing newsletter's signup page
 * with a different header. They are not separate newsletters: signups go to
 * the mapped newsletter.
 */
export const ROLE_PAGES: Record<
  string,
  { newsletter: NewsletterEnum; title: string }
> = {
  "digital-advertiser": {
    newsletter: NewsletterEnum.Marketer,
    title: "Digital Advertiser",
  },
  "growth-marketer": {
    newsletter: NewsletterEnum.Marketer,
    title: "Growth Marketer",
  },
  "media-buyer": { newsletter: NewsletterEnum.Marketer, title: "Media Buyer" },
  "online-advertiser": {
    newsletter: NewsletterEnum.Marketer,
    title: "Online Advertiser",
  },
  "online-marketer": {
    newsletter: NewsletterEnum.Marketer,
    title: "Online Marketer",
  },
  "ppc-specialist": {
    newsletter: NewsletterEnum.Marketer,
    title: "PPC Specialist",
  },
};
