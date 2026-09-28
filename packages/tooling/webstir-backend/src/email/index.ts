import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { appRoot, isProduction } from '../app/app-root.js';

export interface EmailMessage {
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  /** Defaults to EMAIL_FROM. */
  readonly from?: string;
  readonly replyTo?: string;
}

/** Sends a message; an app can supply one for a provider with its own API. */
export type EmailTransport = (message: EmailMessage & { readonly from: string }) => Promise<void>;

let customTransport: EmailTransport | undefined;
let smtp: { url: string; transport: Promise<EmailTransport> } | undefined;

/** Sends email with this function instead of EMAIL_URL. */
export function setEmailTransport(transport: EmailTransport | undefined): void {
  customTransport = transport;
}

/** Whether email can go anywhere but the development log: a transport, or EMAIL_URL. */
export function hasEmailDelivery(): boolean {
  return Boolean(customTransport || process.env.EMAIL_URL?.trim());
}

export interface Email {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Email over SMTP: `EMAIL_URL=smtp://user:password@host:587` (or `smtps://` on 465) reaches SES,
 * Postmark, Resend, Mailgun or any mail server. In development, with no EMAIL_URL, messages are
 * printed and written to `.webstir/email.log` instead.
 */
export const email: Email = {
  async send(message) {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    if (to.length === 0 || to.some((address) => !String(address).includes('@'))) {
      throw new Error(`email to "${to.join(', ')}" has no valid address.`);
    }
    if (!message.text && !message.html) {
      throw new Error(`email "${message.subject}" has no text or html.`);
    }
    const complete = { ...message, from: message.from ?? defaultFrom() };
    if (customTransport) {
      await customTransport(complete);
      return;
    }
    const url = process.env.EMAIL_URL?.trim();
    if (url) {
      await (await smtpTransport(url))(complete);
      return;
    }
    if (isProduction()) {
      throw new Error(
        "EMAIL_URL is not set, so email cannot be sent; set it to your provider's SMTP URL.",
      );
    }
    await logEmail(complete);
  },
};

function defaultFrom(): string {
  const from = process.env.EMAIL_FROM?.trim();
  if (from) return from;
  if (isProduction()) {
    throw new Error('EMAIL_FROM is not set; set it to the address email comes from.');
  }
  return 'Webstir <webstir@localhost>';
}

function smtpTransport(url: string): Promise<EmailTransport> {
  if (smtp?.url !== url) {
    smtp = {
      url,
      transport: import('nodemailer').then(({ createTransport }) => {
        const transporter = createTransport(url);
        return async (message) => {
          await transporter.sendMail({
            from: message.from,
            to: [...(Array.isArray(message.to) ? message.to : [message.to])],
            subject: message.subject,
            text: message.text,
            html: message.html,
            replyTo: message.replyTo,
          });
        };
      }),
    };
  }
  return smtp.transport;
}

/** Development email: printed, and appended to `.webstir/email.log` as one JSON line each. */
async function logEmail(message: EmailMessage & { from: string }): Promise<void> {
  const file = path.join(appRoot(), '.webstir', 'email.log');
  await mkdir(path.dirname(file), { recursive: true });
  const sentAt = new Date().toISOString();
  await appendFile(file, `${JSON.stringify({ sentAt, ...message })}\n`);
  const to = Array.isArray(message.to) ? message.to.join(', ') : message.to;
  console.info(
    `[email] to ${to}: ${message.subject}\n${message.text ?? message.html ?? ''}\n(not sent: set EMAIL_URL to send; kept in .webstir/email.log)`,
  );
}
