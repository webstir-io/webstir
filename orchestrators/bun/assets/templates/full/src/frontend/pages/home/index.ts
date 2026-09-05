import type { PageContext } from '@webstir-io/webstir-frontend/runtime';

// With client-nav enabled, Webstir calls setup for every visit to this page.
// Keep page behavior here; the shared app entry is loaded independently.
export function setup({ root, scope }: PageContext): void {
  root.dataset.pageReady = 'true';
  scope.add(() => { delete root.dataset.pageReady; });
}
