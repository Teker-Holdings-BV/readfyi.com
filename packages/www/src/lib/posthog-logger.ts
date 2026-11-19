import posthog from "posthog-js";

export const posthogLogger = {
  newsletterSubscriptionRequested(newsletterCount: number) {
    posthog.logger.info("newsletter subscription requested", {
      newsletter_count: newsletterCount,
    });
  },
  verificationEmailResent() {
    posthog.logger.info("verification email resent");
  },
  subscriptionPreferencesUpdated(newsletterCount: number) {
    posthog.logger.info("subscription preferences updated", {
      newsletter_count: newsletterCount,
    });
  },
};
