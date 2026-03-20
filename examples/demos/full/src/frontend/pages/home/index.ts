type HomeState = {
  root: HTMLElement;
  heading: HTMLElement;
  previousHeadingText: string;
  previousRendered: string | null;
  mountSequence: number;
};

type HomeBoundary = {
  mount(root: Element): Promise<void>;
  unmount(): Promise<void>;
};

declare global {
  interface Window {
    __webstirHomeBoundary?: HomeBoundary;
  }
}

const homeHeading = 'Home';
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

function createHomeBoundary(): HomeBoundary {
  let currentState: HomeState | null = null;

  return {
    async mount(root: Element) {
      if (currentState) {
        throw new Error('Home boundary is already mounted.');
      }

      const main = root instanceof HTMLElement ? root : document.querySelector<HTMLElement>('main');
      if (!main) {
        throw new Error('Missing home root.');
      }

      const heading = main.querySelector<HTMLElement>('h1');
      if (!heading) {
        throw new Error('Missing home heading.');
      }

      const previousHeadingText = heading.textContent ?? '';
      const previousRendered = main.dataset.hmrRendered ?? null;
      const mountSequence = ++homeMountSequence;

      currentState = {
        root: main,
        heading,
        previousHeadingText,
        previousRendered,
        mountSequence
      };

      main.dataset.hmrRendered = String(mountSequence);
      heading.textContent = homeHeading;
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

      state.heading.textContent = state.previousHeadingText;
      currentState = null;
    }
  };
}

export const homeBoundary = createHomeBoundary();

async function bootHomePage(): Promise<void> {
  const main = await waitForMain();
  if (disposed || !main) {
    return;
  }

  window.__webstirHomeBoundary = homeBoundary;

  try {
    await homeBoundary.mount(main);
  } catch (error) {
    if (window.__webstirHomeBoundary === homeBoundary) {
      delete window.__webstirHomeBoundary;
    }
    throw error;
  }
}

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    disposed = true;
    delete window.__webstirHomeBoundary;
    void homeBoundary.unmount();
  });
}

if (!window.__webstirHomeBoundary) {
  window.__webstirHomeBoundary = homeBoundary;
  void bootHomePage();
}
