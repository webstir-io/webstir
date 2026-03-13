import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';

import { addSubresourceIntegrity } from '../dist/html/htmlSecurity.js';

test('addSubresourceIntegrity skips external fetches by default', async () => {
    const document = load(`
        <html>
            <head>
                <script src="https://cdn.example.com/app.js"></script>
                <link rel="stylesheet" href="https://cdn.example.com/app.css" />
            </head>
        </html>
    `);

    let calls = 0;
    const result = await addSubresourceIntegrity(document, {
        fetcher: async () => {
            calls += 1;
            throw new Error('fetch should not be called when external fetch is disabled');
        }
    });

    assert.equal(calls, 0);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(
        result.skippedExternalResources,
        ['https://cdn.example.com/app.js', 'https://cdn.example.com/app.css']
    );
    assert.equal(document('script').attr('integrity'), undefined);
    assert.equal(document('link').attr('integrity'), undefined);
});

test('addSubresourceIntegrity can opt in to fetching external resources', async () => {
    const document = load(`
        <html>
            <head>
                <script src="https://cdn.example.com/app.js"></script>
                <link rel="stylesheet" href="https://cdn.example.com/app.css" />
            </head>
        </html>
    `);

    let calls = 0;
    const result = await addSubresourceIntegrity(document, {
        allowExternalFetch: true,
        fetcher: async () => {
            calls += 1;
            return {
                ok: true,
                async arrayBuffer() {
                    return Buffer.from('console.log("webstir");');
                }
            };
        }
    });

    assert.equal(calls, 2);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.skippedExternalResources, []);
    assert.match(String(document('script').attr('integrity')), /^sha384-/);
    assert.match(String(document('link').attr('integrity')), /^sha384-/);
    assert.equal(document('script').attr('crossorigin'), 'anonymous');
    assert.equal(document('link').attr('crossorigin'), 'anonymous');
});
