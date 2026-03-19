// TypeScript file for index page

import { loadErrorHandler } from '../../app/app';

void loadErrorHandler();

const main = document.querySelector('main');
if (main) {
  main.dataset.hmrRendered = String(Date.now());
}

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    console.info('[webstir-hmr] Preparing to update home page module');
  });
}
