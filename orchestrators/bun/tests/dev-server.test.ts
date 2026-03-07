import { expect, test } from 'bun:test';

import { getStaticCandidatePaths } from '../src/dev-server.ts';

test('getStaticCandidatePaths rewrites root assets and page routes for SPA development', () => {
  expect(getStaticCandidatePaths('/')).toEqual(['pages/home/index.html']);
  expect(getStaticCandidatePaths('/index.css')).toEqual(['index.css', 'pages/home/index.css']);
  expect(getStaticCandidatePaths('/home')).toEqual(['home', 'home.html', 'home/index.html', 'pages/home/index.html']);
  expect(getStaticCandidatePaths('/home/index.js')).toEqual(['home/index.js', 'pages/home/index.js']);
  expect(getStaticCandidatePaths('/refresh.js')).toEqual(['refresh.js']);
});
