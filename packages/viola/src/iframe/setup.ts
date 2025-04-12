let cliWorker: Worker | undefined;

const setupWorker = ({
  initWorker,
  initData,
  channelName,
}: {
  initWorker: () => Worker;
  initData: object;
  channelName: string;
}) => {
  const defer = Promise.withResolvers<Worker>();
  const worker = initWorker();
  const cb = (event: MessageEvent) => {
    if (event.data.command !== 'init') {
      return;
    }
    worker.removeEventListener('message', cb);

    const messagePorts = new MessageChannel();
    const channel = new BroadcastChannel(channelName);
    messagePorts.port1.onmessage = (e) => {
      channel.postMessage(e.data);
    };
    channel.onmessage = (e) => {
      messagePorts.port1.postMessage(e.data);
    };
    window.parent.postMessage(
      { command: 'bind', channel: channelName },
      `https://${import.meta.env.VITE_APP_HOSTNAME}${location.port ? `:${location.port}` : ''}`,
      [messagePorts.port2],
    );
    defer.resolve(worker);
  };
  worker.addEventListener('message', cb);
  worker.postMessage({ command: 'init', ...initData });
  return defer.promise;
};

async function init() {
  cliWorker ??= await setupWorker({
    initWorker: () => new Worker('/@worker/cli.js', { name: 'worker:cli' }),
    initData: {},
    channelName: 'worker:cli',
  });
}

init();
