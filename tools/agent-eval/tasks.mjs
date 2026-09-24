// Freeze these consumer requirements and the evaluator together before measuring a baseline.
export const PROTOCOL_VERSION = 2;
export const TASKS = ['build', 'extend', 'repair', 'holdout'];
export const ACCEPTANCE = {
  build: [
    'framework-build',
    'framework-test',
    'browser-crud',
    'server-validation',
    'restart-persistence',
  ],
  extend: [
    'framework-build',
    'framework-test',
    'browser-crud',
    'server-validation',
    'authorization',
    'status-filter',
    'restart-persistence',
  ],
  repair: [
    'framework-build',
    'framework-test',
    'browser-crud',
    'server-validation',
    'authorization',
    'customization',
    'managed-file',
    'restart-persistence',
  ],
  holdout: [
    'framework-build',
    'framework-test',
    'browser-crud',
    'server-validation',
    'authorization',
    'customization',
    'managed-file',
    'restart-persistence',
  ],
};
const common = `Use the installed Webstir CLI and its distributed documentation. Work only in this app and installed dependencies; do not consult a framework checkout, evaluation files, other runs, or external solution sources. Do not modify installed package code. Keep this a Webstir full app using the generated backend bootstrap and module route handlers. HTML forms must work with JavaScript disabled. Store application data on disk under DATA_DIR (default ./data), persist edits and deletion across server restarts, and escape user content. Keep normal Webstir build and test commands working. Check your work, then stop; do not leave a development server running. The evaluator will build with webstir build --workspace . and start bun build/backend/index.js with PORT and DATA_DIR set.`;
export function taskPrompt(task, cli) {
  if (!TASKS.includes(task)) throw new Error(`Unknown task: ${task}`);
  const request = {
    build: `Starting in this empty directory, initialize a Webstir full app and create a persistent notes app at /api/notes. Each note has a required nonblank title. Provide native HTML forms: POST /api/notes/create with title; POST /api/notes/update with id and title; POST /api/notes/delete with id. Render each note inside an article with data-note-id matching its id, a heading containing its title, a labeled Title input, and Save and Delete buttons. The create form has a labeled Title input and Create button. Reject blank or whitespace-only titles on the server without altering existing notes; return a 4xx response. No sign-in is needed.`,
    extend: `This existing authenticated notes app needs a status field and filter. Keep the existing credentials (alice/alice-password and bob/bob-password), opaque sessions, CSRF checks, owner isolation, CRUD actions and form behavior. Add status values open and done, defaulting old and new notes to open. Add a labeled Status select named status to create/update forms. Add a native GET filter form to /api/notes with a labeled Filter select named status: all, open, done, and a Filter button. Filter only the signed-in user's notes; reflect the selected filter. Reject invalid submitted status with 4xx without changing data. Persist status across restart. Preserve the existing article/data-note-id markup.`,
    repair: `Editing a note at /api/notes currently fails even though creation works. Diagnose and fix that application bug. A generated development-support file is also missing; restore it using Webstir's supported inspection/repair workflow. Preserve authentication, CSRF, owner isolation, existing CRUD behavior, and the Cedar team's custom stylesheet and footer. Credentials are alice/alice-password and bob/bob-password. Preserve existing routes, field names, and article/data-note-id markup.`,
    holdout: `Deleting a note at /api/notes currently fails even though creation and editing work. Diagnose and fix that application bug. A generated development-support file is also missing; restore it using Webstir's supported inspection/repair workflow. Preserve authentication, CSRF, owner isolation, existing CRUD behavior, and the Cedar team's custom stylesheet and footer. Credentials are alice/alice-password and bob/bob-password. Preserve existing routes, field names, and article/data-note-id markup.`,
  }[task];
  return `${request}\n\n${common}\n\nInstalled CLI: ${cli}\nUse that executable for Webstir commands; bun is available.\n`;
}
