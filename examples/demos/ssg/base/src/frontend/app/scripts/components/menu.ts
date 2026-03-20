import { createDrawer } from './drawer.js';
import { listen, type CleanupScope } from '../../boundary.js';

type BackdropResolution = {
  element: HTMLElement | null;
  created: boolean;
};

type MountMenuOptions = {
  open?: boolean;
};

function resolveBackdrop(root: HTMLElement | null): BackdropResolution {
  if (!root) {
    return { element: null, created: false };
  }

  const existing = root.querySelector<HTMLElement>('.ws-drawer-backdrop')
    ?? document.querySelector<HTMLElement>('[data-drawer="menu"]');
  if (existing) {
    return { element: existing, created: false };
  }

  const created = document.createElement('div');
  created.className = 'ws-drawer-backdrop';
  created.setAttribute('data-drawer', 'menu');
  created.setAttribute('data-drawer-close', '');
  created.setAttribute('aria-hidden', 'true');
  document.body.appendChild(created);
  return { element: created, created: true };
}

export function mountMenu(scope: CleanupScope, options: MountMenuOptions = {}): void {
  const menu = document.querySelector<HTMLElement>('[data-app-menu]');
  const toggle = menu?.querySelector<HTMLButtonElement>('.app-menu__toggle');
  if (!menu || !toggle) {
    return;
  }

  const backdropResolution = resolveBackdrop(menu);
  const mobileQuery = window.matchMedia('(max-width: 40rem)');

  const drawer = createDrawer({
    root: menu,
    openAttribute: null,
    openClass: 'is-open',
    bodyClass: 'webstir-menu-open',
    overlay: {
      headerSelector: '.app-header',
      target: backdropResolution.element ?? document.body,
      varName: '--ws-drawer-top'
    },
    isActive: () => mobileQuery.matches,
    closeOnEscape: true,
    closeOnOutside: true,
    closeSelectors: ['.app-nav a', '.app-nav button:not([data-docs-folder])', '[data-drawer-close]'],
    onOpen: () => toggle.setAttribute('aria-expanded', 'true'),
    onClose: () => toggle.setAttribute('aria-expanded', 'false')
  });

  const syncMode = () => {
    if (!mobileQuery.matches) {
      drawer.close();
      return;
    }

    drawer.close();
    drawer.syncOverlayOffset();
  };

  const handleToggleClick = () => {
    if (!mobileQuery.matches) {
      return;
    }

    drawer.toggle();
  };

  const handleResize = () => {
    if (drawer.isOpen() && mobileQuery.matches) {
      drawer.syncOverlayOffset();
    }
  };

  syncMode();
  listen(scope, mobileQuery, 'change', syncMode);
  listen(scope, toggle, 'click', handleToggleClick);
  listen(scope, window, 'resize', handleResize);

  if (options.open) {
    drawer.open();
  }

  scope.add(() => {
    drawer.close();
    drawer.destroy();
  });
  if (backdropResolution.created && backdropResolution.element) {
    scope.add(() => {
      backdropResolution.element?.remove();
    });
  }
}
