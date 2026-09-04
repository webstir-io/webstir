import { expect, test } from 'bun:test';

import { isAuditTransportFailure } from '../audit-dependencies.mjs';

test('dependency audit retries registry transport failures', () => {
  expect(isAuditTransportFailure('ConnectionClosed: audit request failed')).toBe(true);
  expect(isAuditTransportFailure('Timeout: audit request failed')).toBe(true);
  expect(isAuditTransportFailure('fetch failed: ECONNRESET')).toBe(true);
});

test('dependency audit does not retry vulnerability findings', () => {
  expect(
    isAuditTransportFailure('3 vulnerabilities (1 moderate, 2 high)\nerror: audit failed'),
  ).toBe(false);
});
