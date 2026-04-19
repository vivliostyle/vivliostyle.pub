import * as Comlink from 'comlink';

// https://github.com/GoogleChromeLabs/comlink/tree/HEAD/src/protocol.ts

interface RawWireValue {
  id?: string;
  type: 'RAW';
  value: unknown;
}

interface HandlerWireValue {
  id?: string;
  type: 'HANDLER';
  name: string;
  value: unknown;
}

type WireValue = RawWireValue | HandlerWireValue;

export interface GetMessage {
  id?: string;
  type: 'GET';
  path: string[];
}

export interface SetMessage {
  id?: string;
  type: 'SET';
  path: string[];
  value: WireValue;
}

export interface ApplyMessage {
  id?: string;
  type: 'APPLY';
  path: string[];
  argumentList: WireValue[];
}

export interface ConstructMessage {
  id?: string;
  type: 'CONSTRUCT';
  path: string[];
  argumentList: WireValue[];
}

export interface EndpointMessage {
  id?: string;
  type: 'ENDPOINT';
}

export interface ReleaseMessage {
  id?: string;
  type: 'RELEASE';
}

export type Message =
  | GetMessage
  | SetMessage
  | ApplyMessage
  | ConstructMessage
  | EndpointMessage
  | ReleaseMessage;

let handleMessageDebug:
  | ((
      channelName: string,
      direction: 'host' | 'worker',
      e: MessageEvent,
    ) => void)
  | undefined;
if (import.meta.env.DEV) {
  const comlinkMessageMap = new Map<
    string,
    { time: number; data: Message; clear: () => void }
  >();
  const mapWireValue = (value: WireValue) => {
    switch (value.type) {
      case 'HANDLER':
        try {
          // biome-ignore lint/style/noNonNullAssertion: safely catch the error
          return Comlink.transferHandlers
            .get(value.name)!
            .deserialize(value.value);
        } catch (e) {
          return e;
        }
      case 'RAW':
        return value.value;
    }
  };

  handleMessageDebug = (channelName, direction, e) => {
    const { type, id } = e.data;
    if (!type || !id) {
      return;
    }
    const message = comlinkMessageMap.get(id);
    if (message) {
      const { time, data } = message;
      message.clear();
      const diff = performance.now() - time;
      const isError = e.data.type === 'HANDLER' && e.data.value.isError;
      console.groupCollapsed(
        [
          isError ? '%c❌' : '%c📦',
          `${direction === 'host' ? '----->' : '<-----'}`,
          `[${channelName}]`,
          `(${diff.toFixed(2)} ms)`,
          data.type,
          ['GET', 'SET', 'APPLY', 'CONSTRUCT'].includes(data.type) &&
            (
              data as Exclude<Message, EndpointMessage | ReleaseMessage>
            ).path.join('.'),
        ]
          .filter(Boolean)
          .join(' '),
        isError ? 'color: red;' : 'color: #888;',
      );
      console.log(
        'request message:',
        data.type === 'SET'
          ? mapWireValue(data.value)
          : data.type === 'APPLY' || data.type === 'CONSTRUCT'
            ? data.argumentList.map(mapWireValue)
            : undefined,
      );
      console.log('response message:', mapWireValue(e.data));
      console.groupEnd();
    } else {
      const timer = setTimeout(() => {
        console.groupCollapsed(
          [
            '%c',
            `${direction === 'worker' ? '--❌️->' : '<-❌️--'}`,
            `[${channelName}]`,
            e.data.type,
            ['GET', 'SET', 'APPLY', 'CONSTRUCT'].includes(e.data.type) &&
              e.data.path.join('.'),
          ]
            .filter(Boolean)
            .join(' '),
          'color: yellow;',
        );
        console.log(
          'request message:',
          e.data.type === 'SET'
            ? mapWireValue(e.data.value)
            : e.data.type === 'APPLY' || e.data.type === 'CONSTRUCT'
              ? e.data.argumentList.map(mapWireValue)
              : undefined,
        );
        console.groupEnd();
      }, 5000);
      comlinkMessageMap.set(id, {
        time: performance.now(),
        data: e.data,
        clear: () => {
          clearTimeout(timer);
          comlinkMessageMap.delete(id);
        },
      });
    }
  };
}

const setupChannel = (channelName: string) => {
  const messagePorts = new MessageChannel();
  const channel = new BroadcastChannel(channelName);

  messagePorts.port1.onmessage = (e) => {
    handleMessageDebug?.(channelName, 'worker', e);
    channel.postMessage(e.data);
  };
  channel.onmessage = (e) => {
    handleMessageDebug?.(channelName, 'host', e);
    messagePorts.port1.postMessage(e.data);
  };

  window.parent.postMessage(
    { command: 'bind', channel: channelName },
    `https://${import.meta.env.VITE_APP_HOSTNAME}${location.port ? `:${location.port}` : ''}`,
    [messagePorts.port2],
  );
  return channel;
};

const setupWorker = ({
  initWorker,
  initCallback = () => {},
}: {
  initWorker: () => Worker;
  initCallback?: () => void;
}) => {
  const defer = Promise.withResolvers<Worker>();
  const worker = initWorker();
  const cb = (event: MessageEvent) => {
    if (event.data.command !== 'init') {
      return;
    }
    worker.removeEventListener('message', cb);

    initCallback();
    defer.resolve(worker);
  };
  worker.addEventListener('message', cb);
  worker.postMessage({ command: 'init' });
  return defer.promise;
};

async function init() {
  await setupWorker({
    initWorker: () =>
      new Worker(new URL('../client/cli-worker.js', import.meta.url), {
        name: 'worker:cli',
        type: 'module',
      }),
    initCallback: () => {
      setupChannel('worker:cli');
    },
  });
  setupChannel('worker:theme-registry');
}

init();
