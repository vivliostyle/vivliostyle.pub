import { WebSocketInterceptor } from '@mswjs/interceptors/WebSocket';
import * as Comlink from 'comlink';

type WorkerInterface = {
  read: (path: string, encoding?: string) => Promise<string>;
  webSocketConnect: () => Promise<void>;
};

const channel = new BroadcastChannel('worker:cli');
const cli = Comlink.wrap<WorkerInterface>(channel);
const webSocketInterceptor = new WebSocketInterceptor();

webSocketInterceptor.on('connection', async ({ client, server, info }) => {
  if (info.protocols !== 'vite-hmr') {
    return;
  }
  const hmrChannel = new BroadcastChannel('worker:vite-hmr');
  hmrChannel.addEventListener('message', (event) => {
    client.send(JSON.stringify(event.data));
  });
  await cli.webSocketConnect();
});
webSocketInterceptor.apply();
