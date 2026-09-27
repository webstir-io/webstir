import { expect, test } from 'bun:test';

import { usePackagedImport } from '../src/client-nav-import.ts';

const PACKAGED = "import '@webstir-io/webstir-frontend/features/client-nav';";

// The local import is swapped in place, a trailing comment survives, an existing packaged import
// wins, a packaged import that is only commented out does not count, and line endings are kept.
const cases: Array<{ name: string; source: string; expected: string }> = [
  {
    name: 'swaps the local import in place',
    source: "import './app.css';\nimport './scripts/features/client-nav.js';\nstart();\n",
    expected: `import './app.css';\n${PACKAGED}\nstart();\n`,
  },
  {
    name: 'keeps a trailing comment',
    source: 'import "./scripts/features/client-nav.js"; // navigation\n',
    expected: `${PACKAGED} // navigation\n`,
  },
  {
    name: 'drops the local import when the packaged one is already there',
    source: `${PACKAGED}\nimport './scripts/features/client-nav.js';\nstart();\n`,
    expected: `${PACKAGED}\nstart();\n`,
  },
  {
    name: 'ignores a packaged import that is only in a comment',
    source: `/*\n${PACKAGED}\n*/\nimport './scripts/features/client-nav.js';\n`,
    expected: `/*\n${PACKAGED}\n*/\n${PACKAGED}\n`,
  },
  {
    name: 'adds the import when there is none',
    source: "import './app.css';\n",
    expected: `import './app.css';\n${PACKAGED}\n`,
  },
  {
    name: 'keeps Windows line endings',
    source: "import './app.css';\r\nstart();",
    expected: `import './app.css';\r\nstart();\r\n${PACKAGED}\r\n`,
  },
];

for (const { name, source, expected } of cases) {
  test(`usePackagedImport ${name}`, () => {
    expect(usePackagedImport(source)).toBe(expected);
  });
}
