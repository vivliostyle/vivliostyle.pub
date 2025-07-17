import path from 'node:path';
import MagicString from 'magic-string';
import type * as vite from 'vite';

export function vsCustomHmrPlugin({
  sendHotPayload,
}: {
  sendHotPayload: (payload: vite.HotPayload) => void;
}): vite.Plugin {
  let config: vite.ResolvedConfig;
  return {
    name: 'vivliostyle:custom-hmr',
    enforce: 'post',
    configureServer(server) {
      return () => {
        server.environments.client.hot.send = sendHotPayload;
      };
    },
    configResolved(_config) {
      config = _config;
    },
    resolveId(id) {
      if (id.startsWith('/@cli/')) {
        return { id, external: true };
      }
    },
    load(id) {
      if (id.startsWith('/@cli/')) {
        // The string returned here is not used since it is proxied by the service worker before being referenced.
        return '';
      }
    },
    transform(code, id) {
      if (id !== '/@vivliostyle:viewer:client') {
        return null;
      }
      const { base } = config;
      const importer = (
        this.environment as vite.DevEnvironment
      ).moduleGraph.getModuleById(id);
      if (!importer) {
        return null;
      }

      const s = new MagicString(code);
      // Replace normal HMR to customize code injection by vite:import-analysis.
      // We need to import custom-hmr.js before the Vite client.
      s.replace(/import\.meta\.hot/g, 'import.meta.__hot');
      s.prepend(
        `import "${path.posix.join(base, '/@cli/client/custom-hmr.js')}";` +
          `import { createHotContext as __vite__createHotContext } from "${path.posix.join(base, '/@vite/client')}";` +
          `import.meta.__hot = __vite__createHotContext(${JSON.stringify(importer.url)});`,
      );
      return {
        code: s.toString(),
        map: null,
      };
    },
  };
}
