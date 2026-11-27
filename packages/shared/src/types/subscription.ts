import { BaseEntityProps } from "./base";
import { NewsletterEnum } from "./newsletter";

export interface SubscriptionProps extends BaseEntityProps {
  subscriberUuid: string;
  newsletter: NewsletterEnum;
}

/** Meta click (`_fbc`) and browser (`_fbp`) IDs from the signup browser. */
export interface MetaClickIds {
  fbc?: string;
  fbp?: string;
}

export interface CreateSubscriptionsRequest extends MetaClickIds {
  email: string;
  newsletters: NewsletterEnum[];
}

export interface UpdateSubscriptionsRequest {
  subscriberUuid: string;
  newsletters: NewsletterEnum[];
}
