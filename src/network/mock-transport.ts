import type { Transport, NetworkRequest, NetworkResponse } from "./types.js";

export interface MockTransportHandler {
  (request: NetworkRequest): Promise<NetworkResponse> | NetworkResponse;
}

export class MockTransport implements Transport {
  private readonly _handler: MockTransportHandler;
  private readonly _requests: Array<NetworkRequest> = [];

  constructor(handler?: MockTransportHandler) {
    this._handler =
      handler ??
      (() => ({
        status: 200,
        statusText: "OK",
        headers: {},
        body: "",
        fromCache: false,
        duration: 0,
      }));
  }

  async fetch(request: NetworkRequest): Promise<NetworkResponse> {
    this._requests.push(request);
    return this._handler(request);
  }

  get requests(): ReadonlyArray<NetworkRequest> {
    return this._requests;
  }

  get requestCount(): number {
    return this._requests.length;
  }

  clearRequests(): void {
    this._requests.length = 0;
  }
}

export function createSuccessHandler(
  body: string,
  status = 200,
): MockTransportHandler {
  return () => ({
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {},
    body,
    fromCache: false,
    duration: 0,
  });
}

export function createJsonHandler<T>(
  data: T,
  status = 200,
): MockTransportHandler {
  return () => ({
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    fromCache: false,
    duration: 0,
  });
}

export function createErrorHandler(
  status: number,
  message: string,
): MockTransportHandler {
  return () => ({
    status,
    statusText: message,
    headers: {},
    body: message,
    fromCache: false,
    duration: 0,
  });
}

function createTimeoutHandler(): MockTransportHandler {
  return () => {
    throw new Error("Timeout");
  };
}

function createDelayedHandler(
  body: string,
  delayMs: number,
): MockTransportHandler {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      status: 200,
      statusText: "OK",
      headers: {},
      body,
      fromCache: false,
      duration: delayMs,
    };
  };
}
