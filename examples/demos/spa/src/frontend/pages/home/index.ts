import { defineBoundary } from '@webstir-io/webstir-frontend/runtime';
import { loadErrorHandler } from '../../app/app';

type HomeState = {
  mountSequence: number;
  previousRendered: string | null;
  previousText: string;
};

declare global {
  interface Window {
    __webstirHomeBoundary?: {
      mount(root: Element): Promise<unknown>;
      unmount(): Promise<void>;
    };
  }
}

const homeMessage = 'Home';
let homeMountSequence = 0;
let disposed = false;

function waitForMain(): Promise<HTMLElement | null> {
  const existing = document.querySelector<HTMLElement>('main');
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => {
      resolve(document.querySelector<HTMLElement>('main'));
    }, { once: true });
  });
}

export const homeBoundary = defineBoundary<HomeState>({
  async mount(root, scope) {
    await loadErrorHandler();

    const previousRendered = root.dataset.hmrRendered ?? null;
    const previousText = root.textContent ?? '';
    const mountSequence = ++homeMountSequence;

    root.dataset.hmrRendered = String(mountSequence);
    root.textContent = homeMessage;
    scope.add(() => {
      if (previousRendered === null) {
        delete root.dataset.hmrRendered;
      } else {
        root.dataset.hmrRendered = previousRendered;
      }

      root.textContent = previousText;
    });

    return {
      mountSequence,
      previousRendered,
      previousText
    };
  }
});

window.__webstirHomeBoundary = homeBoundary;

async function bootHomePage(): Promise<void> {
  const main = await waitForMain();
  if (disposed || !main) {
    return;
  }

  await homeBoundary.mount(main);
}

void bootHomePage();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    disposed = true;
    void homeBoundary.unmount();
  });
}
