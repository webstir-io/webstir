// TypeScript file for index page

const main = document.querySelector('main');
if (main) {
  main.dataset.hmrRendered = String(Date.now());
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
