import { expect, test } from 'bun:test';

import {
  PACKAGED_FEATURES,
  usePackagedScriptImport,
  usePackagedStyleImport,
} from '../src/feature-imports.ts';

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
  test(`usePackagedScriptImport ${name}`, () => {
    expect(usePackagedScriptImport(source, PACKAGED_FEATURES['client-nav'])).toBe(expected);
  });
}

const PACKAGED_CSS = '@import "@webstir-io/webstir-frontend/features/search.css"';
const search = PACKAGED_FEATURES.search.style!;

// Stylesheet imports follow the same rules, keep their layer or media qualifiers, and a new one
// goes after the last existing @import, where CSS requires it.
const styleCases: Array<{ name: string; source: string; expected: string }> = [
  {
    name: 'swaps the local import in place, keeping its qualifiers',
    source:
      '@layer base, features;\n@import "./styles/base.css";\n@import "./styles/features/search.css" layer(features);\n',
    expected: `@layer base, features;\n@import "./styles/base.css";\n${PACKAGED_CSS} layer(features);\n`,
  },
  {
    name: 'drops the local import when the packaged one is already there',
    source: `${PACKAGED_CSS};\n@import './styles/features/search.css';\nbody {}\n`,
    expected: `${PACKAGED_CSS};\nbody {}\n`,
  },
  {
    name: 'leaves a commented-out local import alone',
    source:
      '/* @import "./styles/features/search.css"; */\n@import "./styles/base.css";\nbody {}\n',
    expected: `/* @import "./styles/features/search.css"; */\n@import "./styles/base.css";\n${PACKAGED_CSS};\nbody {}\n`,
  },
  {
    name: 'adds the import after the last one when there is none',
    source: '@layer base, features;\n@import "./styles/base.css";\n\nbody {}\n',
    expected: `@layer base, features;\n@import "./styles/base.css";\n${PACKAGED_CSS};\n\nbody {}\n`,
  },
  {
    name: 'adds the import after a statement that spans lines',
    source: '@import url(\n  "./styles/base.css"\n) layer(base);\nbody {}\n',
    expected: `@import url(\n  "./styles/base.css"\n) layer(base);\n${PACKAGED_CSS};\nbody {}\n`,
  },
  {
    name: 'adds the import after real imports, not a commented-out one after them',
    source: '@import "./styles/base.css";\n/* @import "./styles/old.css"; */\nbody {}\n',
    expected: `@import "./styles/base.css";\n${PACKAGED_CSS};\n/* @import "./styles/old.css"; */\nbody {}\n`,
  },
  {
    name: 'adds the import after the layer order and before a layer block',
    source: '@charset "utf-8";\n@layer base, features;\n@layer base { body {} }\n',
    expected: `@charset "utf-8";\n@layer base, features;\n${PACKAGED_CSS};\n@layer base { body {} }\n`,
  },
  {
    name: 'adds the import first when the stylesheet starts with a rule',
    source: 'body {}\n',
    expected: `${PACKAGED_CSS};\nbody {}\n`,
  },
];

for (const { name, source, expected } of styleCases) {
  test(`usePackagedStyleImport ${name}`, () => {
    expect(usePackagedStyleImport(source, search)).toBe(expected);
  });
}
