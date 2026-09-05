import {
  listen, scheduleInterval, trackObserver, type PageContext,
} from '@webstir-io/webstir-frontend/runtime';

export async function setup({ root, url, signal, scope }: PageContext) {
  const button = root.querySelector<HTMLButtonElement>('#counter')!;
  const activity = root.querySelector<HTMLOutputElement>('#activity')!;
  let count = 0;
  root.dataset.visit = url.search;
  root.dataset.path = url.pathname;
  root.dataset.ticks = '0';
  root.dataset.observations = '0';
  listen(scope, button, 'click', () => { button.textContent = `Count: ${++count}`; });
  // A window listener also demonstrates cleanup beyond the removed DOM tree.
  listen(scope, window, 'online', () => { activity.value = 'Online'; });
  scheduleInterval(scope, () => {
    root.dataset.ticks = String(Number(root.dataset.ticks) + 1);
  }, 100);
  const observer = trackObserver(scope, new MutationObserver(() => {
    root.dataset.observations = String(Number(root.dataset.observations) + 1);
  }));
  observer.observe(button, { childList: true });
  scope.add(() => { root.dataset.disposed = String(signal.aborted); });

  try {
    // Replace this read with application data. Pass the page signal to requests.
    await fetch(url, { signal });
    // Some async operations cannot be cancelled; guard their continuation.
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (signal.aborted) return;
    activity.value = 'Ready';
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}
