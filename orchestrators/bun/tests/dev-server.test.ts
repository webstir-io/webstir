import { expect, test } from 'bun:test';

import { getApiProxyPath, getStaticCandidatePaths } from '../src/dev-server.ts';

test('getStaticCandidatePaths rewrites root assets and page routes for SPA development', () => {
  expect(getStaticCandidatePaths('/')).toEqual(['pages/home/index.html']);
  expect(getStaticCandidatePaths('/index.css')).toEqual(['index.css', 'pages/home/index.css']);
  expect(getStaticCandidatePaths('/home')).toEqual(['home', 'home.html', 'home/index.html', 'pages/home/index.html']);
  expect(getStaticCandidatePaths('/home/index.js')).toEqual(['home/index.js', 'pages/home/index.js']);
  expect(getStaticCandidatePaths('/refresh.js')).toEqual(['refresh.js']);
});

test('getApiProxyPath strips the /api prefix for backend proxying', () => {
  expect(getApiProxyPath('/api')).toBe('/');
  expect(getApiProxyPath('/api/health')).toBe('/health');
  expect(getApiProxyPath('/api//health')).toBe('/health');
  expect(getApiProxyPath('/api/../health')).toBe('/health');
  expect(getApiProxyPath('/api/v1/items')).toBe('/v1/items');
  expect(getApiProxyPath('/home')).toBeNull();
});
