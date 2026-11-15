export interface EmailAddress {
  email: string;
  name: string;
}

export interface EmailAttachment {
  name: string;
  /** File content, base64-encoded. */
  content: string;
  /** Optional MIME type; inferred from the file extension when omitted. */
  contentType?: string;
}

export interface SendEmailParams {
  to: EmailAddress[];
  subject: string;
  htmlBody: string;
  plainTextContent?: string;
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress[];
  attachments?: EmailAttachment[];
  /** Extra message headers, e.g. List-Unsubscribe. Values must be ASCII. */
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  messageId?: string;
}

/**
 * Transport used by EmailService. Abstract class (not an interface) so it can
 * be used as a Nest injection token.
 */
export abstract class MailProvider {
  abstract send(params: SendEmailParams): Promise<SendEmailResult>;
}
