import { browser } from 'wxt/browser';
import { startPage } from '@/page/controller';

interface LoadedCopy {
  /** False once the extension was reloaded or updated under this copy. */
  isAlive(): boolean;
  dispose(): void;
}

const KEY = '__browserClick';

// Injected into the active tab on toolbar click (never declared as an always-on
// content script). Re-injection on later clicks is a no-op while the first copy
// keeps listening for the Background. A copy orphaned by an extension reload is
// cleaned up and replaced.
export default defineUnlistedScript(() => {
  const scope = globalThis as unknown as Record<string, LoadedCopy | undefined>;
  const existing = scope[KEY];
  if (existing?.isAlive()) return;
  existing?.dispose();

  const page = startPage();
  scope[KEY] = {
    isAlive: () => {
      try {
        return Boolean(browser.runtime.id);
      } catch {
        return false;
      }
    },
    dispose: page.dispose,
  };
});
