# Send Email

```ts
await ctx.email.send({
  to: 'ada@example.com',
  subject: 'Your invoice',
  text: 'Your invoice is attached.',
  html: '<p>Your invoice is attached.</p>',
});
```

Outside a handler: `import { email } from '@webstir-io/webstir-backend/email'`. Sending from a [queued job](./add-job.md) keeps a slow mail server out of the request and retries a failure.

## Where it goes

- **`EMAIL_URL`** is an SMTP URL: `smtp://user:password@host:587`, or `smtps://` on port 465. Amazon SES, Postmark, Resend, Mailgun and any mail server offer SMTP.
- **`EMAIL_FROM`** is who it comes from, such as `App <hello@example.com>`. Production requires it.
- **In development, with no `EMAIL_URL`,** email is printed in the terminal and kept in `.webstir/email.log`, one JSON line each. Nothing is sent.
- **In production, with no `EMAIL_URL`,** sending fails with an error instead of dropping the message.

## A provider with its own API

Set a transport in `src/backend/index.ts`, before the server starts:

```ts
import { setEmailTransport } from '@webstir-io/webstir-backend/email';

setEmailTransport(async (message) => {
  await fetch('https://api.example.com/send', { method: 'POST', body: JSON.stringify(message) });
});
```
