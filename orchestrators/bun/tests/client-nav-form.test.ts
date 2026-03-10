import { expect, test } from 'bun:test';

import {
  buildEnhancedFormRequest,
  isHtmlDocumentContentType,
  readFragmentResponseMetadata,
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
  expect((request?.init.headers as Headers).get('content-type')).toBe('application/x-www-form-urlencoded');
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
    'x-webstir-fragment-selector': '#greeting'
  });

  expect(readFragmentResponseMetadata(headers)).toEqual({
    target: 'greeting',
    selector: '#greeting',
    mode: 'replace'
  });
});

test('isHtmlDocumentContentType recognizes html responses', () => {
  expect(isHtmlDocumentContentType('text/html; charset=utf-8')).toBe(true);
  expect(isHtmlDocumentContentType('application/xhtml+xml')).toBe(true);
  expect(isHtmlDocumentContentType('application/json')).toBe(false);
});
