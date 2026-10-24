import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'browser-click',
    description: "Ask Claude about any part of the page you're looking at, without leaving it.",
    // activeTab: access to a tab only after the user clicks the toolbar icon.
    // scripting: inject the page code on that click (no always-on content scripts).
    // storage: settings, kept in local extension storage.
    // nativeMessaging: the Claude Code backend's local host (native-host/).
    permissions: ['activeTab', 'scripting', 'storage', 'nativeMessaging'],
    host_permissions: ['https://api.anthropic.com/*'],
    action: {
      default_title: 'Ask about part of this page',
    },
  },
});
