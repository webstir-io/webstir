import { expect, test } from 'bun:test';

import {
  buildEnhancedFormRequest,
  isHtmlDocumentContentType,
  resolveEnhancedFormResponse,
  resolveFragmentInsertionBehavior,
  resolveFragmentResponseMetadata,
  readFragmentResponseMetadata,
  shouldReplaceFragmentTarget,
} from '../resources/features/client_nav/form_enhancement.ts';

test('buildEnhancedFormRequest serializes form-urlencoded POST bodies', () => {
  const formData = new FormData();
  formData.append('name', 'Webstir');
  formData.append('mode', 'replace');

  const request = buildEnhancedFormRequest({
    action: 'https://example.com/actions/fragment',
    method: 'post',
    enctype: 'application/x-www-form-urlencoded',
    formData,
  });

  expect(request).not.toBeNull();
  expect(request?.url).toBe('https://example.com/actions/fragment');
  expect(request?.init.method).toBe('POST');
  expect((request?.init.headers as Headers).get('content-type')).toBe(
    'application/x-www-form-urlencoded',
  );
  expect(String(request?.init.body)).toBe('name=Webstir&mode=replace');
});

test('buildEnhancedFormRequest preserves multipart form bodies', () => {
  const formData = new FormData();
  formData.append('name', 'Webstir');

  const request = buildEnhancedFormRequest({
    action: 'https://example.com/actions/upload',
    method: 'POST',
    enctype: 'multipart/form-data',
    formData,
  });

  expect(request).not.toBeNull();
  expect(request?.init.body).toBe(formData);
  expect((request?.init.headers as Headers).get('content-type')).toBeNull();
});

test('buildEnhancedFormRequest rejects unsupported text/plain submissions', () => {
  const formData = new FormData();
  formData.append('name', 'Webstir');

  const request = buildEnhancedFormRequest({
    action: 'https://example.com/actions/plain',
    method: 'POST',
    enctype: 'text/plain',
    formData,
  });

  expect(request).toBeNull();
});

test('readFragmentResponseMetadata reads fragment headers and defaults replace mode', () => {
  const headers = new Headers({
    'x-webstir-fragment-target': 'greeting',
    'x-webstir-fragment-selector': '#greeting',
  });

  expect(readFragmentResponseMetadata(headers)).toEqual({
    target: 'greeting',
    selector: '#greeting',
    mode: 'replace',
  });
});

test('resolveFragmentResponseMetadata rejects incomplete fragment headers', () => {
  expect(
    resolveFragmentResponseMetadata(
      new Headers({
        'x-webstir-fragment-target': '   ',
      }),
    ),
  ).toEqual({
    kind: 'invalid',
    issues: ['target'],
  });

  expect(
    resolveFragmentResponseMetadata(
      new Headers({
        'x-webstir-fragment-target': 'greeting',
        'x-webstir-fragment-selector': '   ',
      }),
    ),
  ).toEqual({
    kind: 'invalid',
    issues: ['selector'],
  });

  expect(
    resolveFragmentResponseMetadata(
      new Headers({
        'x-webstir-fragment-target': 'greeting',
        'x-webstir-fragment-mode': 'swap',
      }),
    ),
  ).toEqual({
    kind: 'invalid',
    issues: ['mode'],
  });
});

test('isHtmlDocumentContentType recognizes html responses', () => {
  expect(isHtmlDocumentContentType('text/html; charset=utf-8')).toBe(true);
  expect(isHtmlDocumentContentType('application/xhtml+xml')).toBe(true);
  expect(isHtmlDocumentContentType('application/json')).toBe(false);
});

test('resolveEnhancedFormResponse falls back to document navigation when fragment application is skipped', () => {
  const metadata = resolveFragmentResponseMetadata(
    new Headers({
      'x-webstir-fragment-target': 'greeting-preview',
      'x-webstir-fragment-selector': '#greeting-preview',
    }),
  );

  expect(
    resolveEnhancedFormResponse({
      metadata,
      hasFragmentTarget: false,
      contentType: 'text/html; charset=utf-8',
      redirected: false,
      responseUrl: 'https://example.com/account',
      requestUrl: 'https://example.com/actions/fragment',
    }),
  ).toEqual({
    kind: 'document',
  });

  expect(
    resolveEnhancedFormResponse({
      metadata,
      hasFragmentTarget: false,
      contentType: 'application/json',
      redirected: false,
      responseUrl: 'https://example.com/account',
      requestUrl: 'https://example.com/actions/fragment',
    }),
  ).toEqual({
    kind: 'navigate',
    location: 'https://example.com/account',
    reason: 'missing-target',
  });

  expect(
    resolveEnhancedFormResponse({
      metadata: resolveFragmentResponseMetadata(
        new Headers({
          'x-webstir-fragment-target': 'greeting-preview',
          'x-webstir-fragment-mode': 'swap',
        }),
      ),
      hasFragmentTarget: false,
      contentType: 'text/html; charset=utf-8',
      redirected: false,
      responseUrl: 'https://example.com/account',
      requestUrl: 'https://example.com/actions/fragment',
    }),
  ).toEqual({
    kind: 'document',
  });

  expect(
    resolveEnhancedFormResponse({
      metadata: resolveFragmentResponseMetadata(
        new Headers({
          'x-webstir-fragment-target': 'greeting-preview',
          'x-webstir-fragment-mode': 'swap',
        }),
      ),
      hasFragmentTarget: false,
      contentType: 'text/html; charset=utf-8',
      redirected: false,
      responseUrl: 'https://example.com/account',
      requestUrl: 'https://example.com/actions/fragment',
    }),
  ).toEqual({
    kind: 'document',
  });

  expect(
    resolveEnhancedFormResponse({
      metadata: resolveFragmentResponseMetadata(
        new Headers({
          'x-webstir-fragment-target': 'greeting-preview',
          'x-webstir-fragment-mode': 'swap',
        }),
      ),
      hasFragmentTarget: false,
      contentType: 'application/json',
      redirected: false,
      responseUrl: 'https://example.com/account',
      requestUrl: 'https://example.com/actions/fragment',
    }),
  ).toEqual({
    kind: 'navigate',
    location: 'https://example.com/account',
    reason: 'invalid-fragment',
  });
});

test('resolveEnhancedFormResponse distinguishes document, redirect, and non-html fallbacks', () => {
  expect(
    resolveEnhancedFormResponse({
      metadata: { kind: 'none' },
      hasFragmentTarget: false,
      contentType: 'text/html; charset=utf-8',
      redirected: false,
      responseUrl: 'https://example.com/account',
      requestUrl: 'https://example.com/actions/fragment',
    }),
  ).toEqual({
    kind: 'document',
  });

  expect(
    resolveEnhancedFormResponse({
      metadata: { kind: 'none' },
      hasFragmentTarget: false,
      contentType: 'application/json',
      redirected: true,
      responseUrl: 'https://example.com/account?done=1',
      requestUrl: 'https://example.com/actions/fragment',
    }),
  ).toEqual({
    kind: 'navigate',
    location: 'https://example.com/account?done=1',
    reason: 'redirect',
  });

  expect(
    resolveEnhancedFormResponse({
      metadata: { kind: 'none' },
      hasFragmentTarget: false,
      contentType: 'application/json',
      redirected: false,
      responseUrl: '',
      requestUrl: 'https://example.com/actions/fragment',
    }),
  ).toEqual({
    kind: 'navigate',
    location: 'https://example.com/actions/fragment',
    reason: 'non-html',
  });
});

test('shouldReplaceFragmentTarget prefers replacing the target for matching fragment roots', () => {
  expect(
    shouldReplaceFragmentTarget({
      mode: 'replace',
      target: 'greeting-preview',
      roots: [
        {
          id: 'greeting-preview',
          fragmentTarget: 'greeting-preview',
        },
      ],
    }),
  ).toBe(true);

  expect(
    shouldReplaceFragmentTarget({
      mode: 'replace',
      target: 'greeting-preview',
      roots: [
        {
          matchesSelector: true,
        },
      ],
    }),
  ).toBe(true);
});

test('resolveFragmentInsertionBehavior keeps replace-vs-child replacement explicit', () => {
  expect(
    resolveFragmentInsertionBehavior({
      mode: 'replace',
      target: 'greeting-preview',
      roots: [
        {
          id: 'greeting-preview',
        },
      ],
    }),
  ).toBe('replace-target');

  expect(
    resolveFragmentInsertionBehavior({
      mode: 'replace',
      target: 'greeting-preview',
      roots: [
        {
          id: 'other-preview',
        },
      ],
    }),
  ).toBe('replace-children');

  expect(
    resolveFragmentInsertionBehavior({
      mode: 'replace',
      target: 'greeting-preview',
      roots: [{ id: 'greeting-preview' }, { id: 'secondary' }],
    }),
  ).toBe('replace-children');
});

test('resolveFragmentInsertionBehavior unwraps matching roots for append and prepend', () => {
  expect(
    resolveFragmentInsertionBehavior({
      mode: 'append',
      target: 'greeting-preview',
      roots: [
        {
          fragmentTarget: 'greeting-preview',
        },
      ],
    }),
  ).toBe('append-matching-root-children');

  expect(
    resolveFragmentInsertionBehavior({
      mode: 'prepend',
      target: 'greeting-preview',
      roots: [
        {
          matchesSelector: true,
        },
      ],
    }),
  ).toBe('prepend-matching-root-children');
});

test('resolveFragmentInsertionBehavior keeps full payload insertion when outer content remains', () => {
  expect(
    resolveFragmentInsertionBehavior({
      mode: 'append',
      target: 'greeting-preview',
      hasMeaningfulSiblingContent: true,
      roots: [
        {
          id: 'greeting-preview',
        },
      ],
    }),
  ).toBe('append-payload');

  expect(
    resolveFragmentInsertionBehavior({
      mode: 'prepend',
      target: 'greeting-preview',
      hasMeaningfulSiblingContent: true,
      roots: [
        {
          id: 'greeting-preview',
        },
      ],
    }),
  ).toBe('prepend-payload');

  expect(
    resolveFragmentInsertionBehavior({
      mode: 'append',
      target: 'greeting-preview',
      roots: [
        {
          id: 'other-preview',
        },
      ],
    }),
  ).toBe('append-payload');
});

test('shouldReplaceFragmentTarget keeps child replacement for non-matching or multi-root payloads', () => {
  expect(
    shouldReplaceFragmentTarget({
      mode: 'append',
      target: 'greeting-preview',
      roots: [
        {
          id: 'greeting-preview',
        },
      ],
    }),
  ).toBe(false);

  expect(
    shouldReplaceFragmentTarget({
      mode: 'replace',
      target: 'greeting-preview',
      roots: [
        {
          id: 'other-preview',
        },
      ],
    }),
  ).toBe(false);

  expect(
    shouldReplaceFragmentTarget({
      mode: 'replace',
      target: 'greeting-preview',
      roots: [{ id: 'greeting-preview' }, { id: 'secondary' }],
    }),
  ).toBe(false);
});
