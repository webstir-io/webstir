import { loadErrorHandler } from '../../app/app';

type HomeState = {
  root: HTMLElement;
  previousRendered: string | null;
  previousText: string;
  mountSequence: number;
};

type HomeBoundary = {
  mount(root: Element): Promise<void>;
  unmount(): Promise<void>;
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

export const homeBoundary: HomeBoundary = createHomeBoundary();

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

function createHomeBoundary(): HomeBoundary {
  let currentState: HomeState | null = null;

  return {
    async mount(root: Element) {
      if (currentState) {
        throw new Error('Home boundary is already mounted.');
      }

      await loadErrorHandler();

      const element = root instanceof HTMLElement ? root : document.querySelector<HTMLElement>('main');
      if (!element) {
        throw new Error('Missing home root.');
      }

      const state: HomeState = {
        root: element,
        previousRendered: element.dataset.hmrRendered ?? null,
        previousText: element.textContent ?? '',
        mountSequence: ++homeMountSequence
      };

      element.dataset.hmrRendered = String(state.mountSequence);
      element.textContent = homeMessage;
      currentState = state;
    },
    async unmount() {
      const state = currentState;
      if (!state) {
        return;
      }

      if (state.previousRendered === null) {
        delete state.root.dataset.hmrRendered;
      } else {
        state.root.dataset.hmrRendered = state.previousRendered;
      }

      state.root.textContent = state.previousText;
      currentState = null;
    }
  };
}
