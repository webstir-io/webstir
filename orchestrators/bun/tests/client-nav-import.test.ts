import { expect, test } from 'bun:test';

import { usePackagedImport } from '../src/client-nav-import.ts';

const PACKAGED = "import '@webstir-io/webstir-frontend/features/client-nav';";

// The local import is swapped in place, a trailing comment survives, an existing packaged import
// wins, imports are parsed so comments and strings never count, and line endings are kept.
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
    name: 'leaves a commented-out local import and the code after it alone',
    source: `${PACKAGED}\n// import './scripts/features/client-nav.js';\nstart();\n`,
    expected: `${PACKAGED}\n// import './scripts/features/client-nav.js';\nstart();\n`,
  },
  {
    name: 'is not fooled by comment markers inside strings',
    source: "const pattern = '/api/*';\nimport './scripts/features/client-nav.js';\n/* setup */\n",
    expected: `const pattern = '/api/*';\n${PACKAGED}\n/* setup */\n`,
  },
  {
    name: 'does not count a dynamic import as the one that starts client-nav',
    source:
      "import './scripts/features/client-nav.js';\nexport const later = () => import('@webstir-io/webstir-frontend/features/client-nav');\n",
    expected: `${PACKAGED}\nexport const later = () => import('@webstir-io/webstir-frontend/features/client-nav');\n`,
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
