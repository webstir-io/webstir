import { cssEscape, executeScripts, type NavigationDomRuntime } from './document-navigation.js';
import { resolveFragmentInsertionBehavior } from './form-enhancement.js';

/**
 * Applies a fragment response from an enhanced form: the server names a target element (and
 * optionally a selector inside the response), and the HTML replaces, appends to or prepends to it.
 * Inserted scripts run, autofocus moves into the new content, and `webstir:fragment-update` fires.
 */
export async function handleFragmentResponse(
  response: Response,
  fragment: {
    readonly target: string;
    readonly selector?: string;
    readonly mode: 'replace' | 'append' | 'prepend';
  },
  target: Element | null,
  isCurrent: () => boolean,
  runtime: NavigationDomRuntime,
): Promise<void> {
  if (!target) {
    return;
  }

  const html = await response.text();
  if (!isCurrent()) {
    return;
  }

  const appliedFragment = applyFragmentHtml(target, html, fragment, runtime);
  focusInsertedAutofocus(appliedFragment.focusRoots);
  window.dispatchEvent(
    new CustomEvent('webstir:fragment-update', {
      detail: {
        target: fragment.target,
        selector: fragment.selector,
        mode: fragment.mode,
      },
    }),
  );
}

export function resolveFragmentTarget(target: string, selector?: string): Element | null {
  if (selector) {
    return document.querySelector(selector);
  }

  const byId = document.getElementById(target);
  if (byId) {
    return byId;
  }

  return document.querySelector(`[data-webstir-fragment-target="${cssEscape(target)}"]`);
}

function applyFragmentHtml(
  target: Element,
  html: string,
  fragment: {
    readonly target: string;
    readonly selector?: string;
    readonly mode: 'replace' | 'append' | 'prepend';
  },
  runtime: NavigationDomRuntime,
): { readonly focusRoots: readonly Element[] } {
  const template = document.createElement('template');
  template.innerHTML = html;
  const insertedRoots = Array.from(template.content.children);
  const insertionBehavior = resolveFragmentInsertionBehavior({
    mode: fragment.mode,
    target: fragment.target,
    hasMeaningfulSiblingContent: hasMeaningfulSiblingContent(
      template.content,
      insertedRoots[0] ?? null,
    ),
    roots: insertedRoots.map((root) => ({
      id: root.id,
      fragmentTarget: root.getAttribute('data-webstir-fragment-target'),
      matchesSelector: elementMatchesSelector(root, fragment.selector),
    })),
  });

  if (insertionBehavior === 'replace-target') {
    target.replaceWith(template.content);
    executeInsertedScripts(insertedRoots, runtime);
    return { focusRoots: insertedRoots };
  }

  if (
    insertionBehavior === 'append-matching-root-children' ||
    insertionBehavior === 'prepend-matching-root-children'
  ) {
    const { content, roots } = extractMatchingRootChildren(template.content);
    if (insertionBehavior === 'append-matching-root-children') {
      target.append(content);
    } else {
      target.prepend(content);
    }
    executeInsertedScripts(roots, runtime);
    return { focusRoots: roots };
  }

  if (insertionBehavior === 'append-payload') {
    target.append(template.content);
  } else if (insertionBehavior === 'prepend-payload') {
    target.prepend(template.content);
  } else {
    target.replaceChildren(template.content);
  }

  executeInsertedScripts(insertedRoots, runtime);
  return { focusRoots: insertedRoots };
}

function elementMatchesSelector(element: Element, selector: string | undefined): boolean {
  if (!selector) {
    return false;
  }

  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function hasMeaningfulSiblingContent(content: DocumentFragment, root: Element | null): boolean {
  for (const node of Array.from(content.childNodes)) {
    if (node === root || node instanceof Comment) {
      continue;
    }
    if (node instanceof Text && !node.textContent?.trim()) {
      continue;
    }
    return true;
  }
  return false;
}

function extractMatchingRootChildren(content: DocumentFragment): {
  readonly content: DocumentFragment;
  readonly roots: readonly Element[];
} {
  const fragment = document.createDocumentFragment();
  const roots: Element[] = [];
  const root = content.firstElementChild;
  if (!root) {
    return { content: fragment, roots };
  }

  while (root.firstChild) {
    const node = root.firstChild;
    fragment.append(node);
    if (node instanceof Element) {
      roots.push(node);
    }
  }

  return { content: fragment, roots };
}

function executeInsertedScripts(roots: readonly Element[], runtime: NavigationDomRuntime): void {
  for (const root of roots) {
    if (root.tagName.toLowerCase() === 'script') {
      executeTopLevelScriptRoot(root as HTMLScriptElement, runtime);
      continue;
    }
    void executeScripts(root, runtime).catch(console.error);
  }
}

function executeTopLevelScriptRoot(script: HTMLScriptElement, runtime: NavigationDomRuntime): void {
  const wrapper = document.createElement('div');
  wrapper.append(script.cloneNode(true));
  void executeScripts(wrapper, runtime).catch(console.error);

  const replacement = wrapper.querySelector('script');
  if (replacement) {
    script.replaceWith(replacement);
    return;
  }

  script.remove();
}

function focusInsertedAutofocus(roots: readonly Element[]): void {
  for (const root of roots) {
    if (root instanceof HTMLElement && root.hasAttribute('autofocus')) {
      root.focus();
      return;
    }

    const descendant = root.querySelector('[autofocus]');
    if (descendant instanceof HTMLElement) {
      descendant.focus();
      return;
    }
  }
}
