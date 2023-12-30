import { sleep } from 'decky-frontend-lib';

import Logger from './logger';

declare global {
  interface Window {
    DeckyBackend: WSRouter;
  }
}

enum MessageType {
  ERROR = -1,
  // Call-reply, Frontend -> Backend
  CALL = 0,
  REPLY = 1,
  // Pub/Sub, Backend -> Frontend
  EVENT = 3,
}

interface CallMessage {
  type: MessageType.CALL;
  args: any[];
  route: string;
  id: number;
  // TODO implement this
  // skipResponse?: boolean;
}

interface ReplyMessage {
  type: MessageType.REPLY;
  result: any;
  id: number;
}

interface ErrorMessage {
  type: MessageType.ERROR;
  error: any;
  id: number;
}

type Message = CallMessage | ReplyMessage | ErrorMessage;

// Helper to resolve a promise from the outside
interface PromiseResolver<T> {
  resolve: (res: T) => void;
  reject: (error: string) => void;
  promise: Promise<T>;
}

export class WSRouter extends Logger {
  routes: Map<string, (...args: any) => any> = new Map();
  runningCalls: Map<number, PromiseResolver<any>> = new Map();
  ws?: WebSocket;
  connectPromise?: Promise<void>;
  // Used to map results and errors to calls
  reqId: number = 0;
  constructor() {
    super('WSRouter');
  }

  connect() {
    return (this.connectPromise = new Promise<void>((resolve) => {
      // Auth is a query param as JS WebSocket doesn't support headers
      this.ws = new WebSocket(`ws://127.0.0.1:1337/ws?auth=${window.deckyAuthToken}`);

      this.ws.addEventListener('open', () => {
        this.debug('WS Connected');
        resolve();
        delete this.connectPromise;
      });
      this.ws.addEventListener('message', this.onMessage.bind(this));
      this.ws.addEventListener('close', this.onError.bind(this));
      // this.ws.addEventListener('error', this.onError.bind(this));
    }));
  }

  createPromiseResolver<T>(): PromiseResolver<T> {
    let resolver: Partial<PromiseResolver<T>> = {};
    const promise = new Promise<T>((resolve, reject) => {
      resolver.resolve = resolve;
      resolver.reject = reject;
    });
    resolver.promise = promise;
    // The promise will always run first
    // @ts-expect-error 2454
    return resolver;
  }

  async write(data: Message) {
    if (this.connectPromise) await this.connectPromise;
    this.ws?.send(JSON.stringify(data));
  }

  addRoute(name: string, route: (args: any) => any) {
    this.routes.set(name, route);
  }

  removeRoute(name: string) {
    this.routes.delete(name);
  }

  async onMessage(msg: MessageEvent) {
    try {
      const data = JSON.parse(msg.data) as Message;
      switch (data.type) {
        case MessageType.CALL:
          if (this.routes.has(data.route)) {
            try {
              const res = await this.routes.get(data.route)!(...data.args);
              this.write({ type: MessageType.REPLY, id: data.id, result: res });
              this.debug(`Started JS call ${data.route} ID ${data.id}`);
            } catch (e) {
              await this.write({ type: MessageType.ERROR, id: data.id, error: (e as Error)?.stack || e });
            }
          } else {
            await this.write({ type: MessageType.ERROR, id: data.id, error: `Route ${data.route} does not exist.` });
          }
          break;

        case MessageType.REPLY:
          if (this.runningCalls.has(data.id)) {
            this.runningCalls.get(data.id)!.resolve(data.result);
            this.runningCalls.delete(data.id);
            this.debug(`Resolved PY call ${data.id} with value`, data.result);
          }
          break;

        case MessageType.ERROR:
          if (this.runningCalls.has(data.id)) {
            this.runningCalls.get(data.id)!.reject(data.error);
            this.runningCalls.delete(data.id);
            this.debug(`Errored PY call ${data.id} with error`, data.error);
          }
          break;

        default:
          this.error('Unknown message type', data);
          break;
      }
    } catch (e) {
      this.error('Error parsing WebSocket message', e);
    }
  }

  // this.call<[number, number], string>('methodName', 1, 2);
  call<Args extends any[] = any[], Return = void>(route: string, ...args: Args): Promise<Return> {
    const resolver = this.createPromiseResolver<Return>();

    const id = ++this.reqId;

    this.runningCalls.set(id, resolver);

    this.debug(`Calling PY method ${route} with args`, args);

    this.write({ type: MessageType.CALL, route, args, id });

    return resolver.promise;
  }

  callable<Args extends any[] = any[], Return = void>(route: string): (...args: Args) => Promise<Return> {
    return (...args) => this.call<Args, Return>(route, ...args);
  }

  async onError(error: any) {
    this.error('WS DISCONNECTED', error);
    // TODO queue up lost messages and send them once we connect again
    await sleep(5000);
    await this.connect();
  }
}