import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareApp } from '../dist/index.js';
import { email, setEmailTransport } from '../dist/email/index.js';
import { startSmtpServer } from './support/smtp.js';

const KEYS = ['NODE_ENV', 'EMAIL_URL', 'EMAIL_FROM', 'WEBSTIR_WORKSPACE_ROOT'];

async function withApp(values, run) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-email-'));
  prepareApp(root);
  try {
    await run(root);
  } finally {
    setEmailTransport(undefined);
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('in development, with no EMAIL_URL, email is printed and kept in .webstir/email.log', async () => {
  await withApp({}, async (root) => {
    await email.send({ to: 'ada@example.com', subject: 'Hi', text: 'Hello, Ada.' });
    const [line] = (await fs.readFile(path.join(root, '.webstir', 'email.log'), 'utf8'))
      .trim()
      .split('\n');
    const logged = JSON.parse(line);
    assert.equal(logged.to, 'ada@example.com');
    assert.equal(logged.subject, 'Hi');
    assert.equal(logged.text, 'Hello, Ada.');
    assert.equal(logged.from, 'Webstir <webstir@localhost>');
  });
});

test('EMAIL_URL sends over SMTP, from EMAIL_FROM', async () => {
  const smtp = startSmtpServer();
  try {
    await withApp({ EMAIL_URL: smtp.url, EMAIL_FROM: 'App <app@example.com>' }, async () => {
      await email.send({
        to: ['ada@example.com', 'grace@example.com'],
        subject: 'Hi',
        text: 'Hello.',
      });
      assert.equal(smtp.messages.length, 1);
      assert.equal(smtp.messages[0].from, 'app@example.com');
      assert.deepEqual(smtp.messages[0].to, ['ada@example.com', 'grace@example.com']);
      assert.match(smtp.messages[0].data, /Subject: Hi/);
      assert.match(smtp.messages[0].data, /Hello\./);
    });
  } finally {
    smtp.stop();
  }
});

test('an app transport takes over; production refuses to drop email silently', async () => {
  await withApp({}, async () => {
    const sent = [];
    setEmailTransport(async (message) => {
      sent.push(message);
    });
    await email.send({ to: 'ada@example.com', subject: 'Hi', html: '<p>Hi</p>' });
    assert.equal(sent[0].html, '<p>Hi</p>');
  });
  await withApp({ NODE_ENV: 'production', EMAIL_FROM: 'app@example.com' }, async () => {
    await assert.rejects(
      email.send({ to: 'ada@example.com', subject: 'Hi', text: 'x' }),
      /EMAIL_URL is not set/,
    );
  });
  await withApp({ NODE_ENV: 'production', EMAIL_URL: 'smtp://127.0.0.1:1' }, async () => {
    await assert.rejects(
      email.send({ to: 'ada@example.com', subject: 'Hi', text: 'x' }),
      /EMAIL_FROM is not set/,
    );
  });
  await withApp({}, async () => {
    for (const [message, error] of [
      [{ to: 'nobody', subject: 'Hi', text: 'x' }, /no valid address/],
      [{ to: 'ada@example.com', subject: 'Hi' }, /has no text or html/],
    ]) {
      await assert.rejects(email.send(message), error);
    }
  });
});
