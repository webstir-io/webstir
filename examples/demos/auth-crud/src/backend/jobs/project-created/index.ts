import { email } from '@webstir-io/webstir-backend/email';

/** Queued when a project is created: tells its owner by email. */
export async function run(payload: { to: string; title: string }): Promise<void> {
  await email.send({
    to: payload.to,
    subject: `Project created: ${payload.title}`,
    text: `You created the project "${payload.title}".\n`,
  });
}
