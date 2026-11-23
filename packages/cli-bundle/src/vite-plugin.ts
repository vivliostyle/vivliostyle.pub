import type * as vite from 'vite';

export function vsCustomHmrPlugin({
  sendHotPayload,
}: {
  sendHotPayload: (payload: vite.HotPayload) => void;
}): vite.Plugin {
  return {
    name: 'vivliostyle:custom-hmr',
    enforce: 'post',
    configureServer(server) {
      return () => {
        server.environments.client.hot.send = sendHotPayload;
      };
    },
  };
}
