import { randomUUID } from 'crypto';
import { EmailAddress, EmailAttachment } from '../mail-provider';

const CRLF = '\r\n';
const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
  html: 'text/html',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ics: 'text/calendar',
  zip: 'application/zip',
};

/** Rejects CR/LF so user-controlled values can't inject extra headers. */
function assertNoLineBreaks(value: string, field: string) {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Invalid ${field}: must not contain line breaks`);
  }
}

/** RFC 2047 encoded-word for non-ASCII header values. */
export function encodeHeaderValue(value: string): string {
  if (PRINTABLE_ASCII.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function formatAddress({ email, name }: EmailAddress): string {
  assertNoLineBreaks(email, 'email address');
  if (!name) return email;
  assertNoLineBreaks(name, 'display name');

  const displayName = PRINTABLE_ASCII.test(name)
    ? `"${name.replace(/(["\\])/g, '\\$1')}"`
    : encodeHeaderValue(name);
  return `${displayName} <${email}>`;
}

function wrapBase64(base64: string): string {
  return (base64.replace(/\s+/g, '').match(/.{1,76}/g) ?? []).join(CRLF);
}

function textPart(contentType: string, body: string): string {
  return [
    `Content-Type: ${contentType}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(body, 'utf8').toString('base64')),
  ].join(CRLF);
}

function attachmentPart(attachment: EmailAttachment): string {
  assertNoLineBreaks(attachment.name, 'attachment name');
  const extension = attachment.name.split('.').pop()?.toLowerCase() ?? '';
  const contentType =
    attachment.contentType ??
    CONTENT_TYPES[extension] ??
    'application/octet-stream';
  assertNoLineBreaks(contentType, 'attachment content type');

  const filename = PRINTABLE_ASCII.test(attachment.name)
    ? `filename="${attachment.name.replace(/(["\\])/g, '\\$1')}"`
    : `filename*=UTF-8''${encodeURIComponent(attachment.name)}`;

  return [
    `Content-Type: ${contentType}`,
    `Content-Disposition: attachment; ${filename}`,
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(attachment.content),
  ].join(CRLF);
}

function multipart(subtype: string, parts: string[]): string {
  const boundary = `----=_Part_${randomUUID()}`;
  return [
    `Content-Type: multipart/${subtype}; boundary="${boundary}"`,
    '',
    ...parts.map((part) => `--${boundary}${CRLF}${part}`),
    `--${boundary}--`,
    '',
  ].join(CRLF);
}

export interface RawMessageParams {
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  replyTo?: EmailAddress[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  attachments: EmailAttachment[];
}

/**
 * Builds a multipart/mixed MIME message for SES `Content.Raw`.
 * Bcc is intentionally not written as a header; SES delivers to Bcc
 * recipients from the request's Destination instead.
 */
export function buildRawMessage(params: RawMessageParams): string {
  assertNoLineBreaks(params.subject, 'subject');

  const headers = [
    `From: ${formatAddress(params.from)}`,
    `To: ${params.to.map(formatAddress).join(', ')}`,
  ];
  if (params.cc?.length) {
    headers.push(`Cc: ${params.cc.map(formatAddress).join(', ')}`);
  }
  if (params.replyTo?.length) {
    headers.push(`Reply-To: ${params.replyTo.map(formatAddress).join(', ')}`);
  }
  headers.push(
    `Subject: ${encodeHeaderValue(params.subject)}`,
    'MIME-Version: 1.0',
  );

  const htmlPart = textPart('text/html', params.htmlBody);
  const bodyPart = params.textBody
    ? multipart('alternative', [
        textPart('text/plain', params.textBody),
        htmlPart,
      ])
    : htmlPart;

  const body = multipart('mixed', [
    bodyPart,
    ...params.attachments.map(attachmentPart),
  ]);

  return headers.join(CRLF) + CRLF + body;
}
