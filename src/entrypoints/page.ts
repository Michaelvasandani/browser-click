import { startPage } from '@/page/controller';

// Injected into the active tab on toolbar click (never declared as an always-on
// content script). Re-injection on later clicks is a no-op: the first copy keeps
// listening for messages from the Background.
export default defineUnlistedScript(() => {
  const flag = '__browserClickLoaded';
  const scope = globalThis as unknown as Record<string, boolean>;
  if (scope[flag]) return;
  scope[flag] = true;
  startPage();
});
