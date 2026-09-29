/**
 * Behavior for controls the server renders, keyed on attributes in the markup and attached once
 * to the document, so it works the moment a page appears, including one client navigation swapped
 * in. Each control still works as plain HTML without it. The build includes this in the app bundle
 * when a page uses one of the attributes:
 *
 * - `<form data-submit-on-change>` submits when one of its fields changes.
 * - `<details data-dismissable>` closes on a click outside it, and on Escape.
 * - `<button data-menu-trigger aria-controls="menu">` opens and closes the element it names: the
 *   button's `aria-expanded` and the menu's `data-open` say which, and closing it makes it inert.
 *   Escape, a click on `[data-menu-dismiss]`, or the page growing past the trigger's breakpoint
 *   (`data-menu-until="760px"`) close it.
 *
 * `<html data-enhanced>` tells CSS the behaviors are running, to hide no-script fallbacks such as
 * a filter form's submit button.
 */

const INSTALLED = '__WEBSTIR_BEHAVIORS_INSTALLED__';

export function installBehaviors(): void {
  const w = window as Window & { [INSTALLED]?: boolean };
  if (w[INSTALLED]) return;
  w[INSTALLED] = true;
  document.documentElement.setAttribute('data-enhanced', '');

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    target.closest<HTMLFormElement>('form[data-submit-on-change]')?.requestSubmit();
  });

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const trigger = target?.closest<HTMLElement>('[data-menu-trigger]');
    if (trigger) {
      setMenuOpen(trigger, trigger.getAttribute('aria-expanded') !== 'true');
    } else if (target?.closest('[data-menu-dismiss]')) {
      closeMenus();
    }
    for (const open of document.querySelectorAll<HTMLDetailsElement>(
      'details[data-dismissable][open]',
    )) {
      if (!target || !open.contains(target)) open.open = false;
    }
  });

  // Escape closes the innermost thing that is open, and marks the event handled so a page's own
  // Escape handling only runs when nothing here was open.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const menu = document.querySelector<HTMLElement>('[data-menu-trigger][aria-expanded="true"]');
    if (menu) {
      setMenuOpen(menu, false);
      menu.focus();
      event.preventDefault();
      return;
    }
    const open = Array.from(
      document.querySelectorAll<HTMLDetailsElement>('details[data-dismissable][open]'),
    ).at(-1);
    if (open) {
      open.open = false;
      open.querySelector('summary')?.focus();
      event.preventDefault();
    }
  });

  window.addEventListener('resize', () => {
    for (const trigger of openMenus()) {
      const until = trigger.dataset.menuUntil;
      if (until && !window.matchMedia(`(max-width: ${until})`).matches) {
        setMenuOpen(trigger, false);
      }
    }
  });
}

function openMenus(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-menu-trigger][aria-expanded="true"]'),
  );
}

function closeMenus(): void {
  for (const trigger of openMenus()) setMenuOpen(trigger, false);
}

function setMenuOpen(trigger: HTMLElement, open: boolean): void {
  trigger.setAttribute('aria-expanded', String(open));
  const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
  if (!menu) return;
  menu.toggleAttribute('data-open', open);
  menu.inert = !open;
}

if (typeof window !== 'undefined') installBehaviors();
