import { Platform } from "react-native";

// Ring buffers behind the report sheet's automatic context: the last JS errors
// and the last failed API calls, plus the route the user is on. Nothing leaves
// the device until the user submits a report.

const LIMIT = 20;
const MESSAGE_MAX = 500;
const STACK_MAX = 2000;

export type CapturedError = { message: string; stack?: string; at: string };
export type FailedRequest = { method: string; url: string; status: number; at: string };

const errors: CapturedError[] = [];
const failedRequests: FailedRequest[] = [];
let route = "";
let installed = false;

function push<T>(buffer: T[], entry: T) {
  buffer.push(entry);
  if (buffer.length > LIMIT) buffer.shift();
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function recordError(value: unknown) {
  const stack = value instanceof Error ? value.stack : undefined;
  push(errors, {
    message: describe(value).slice(0, MESSAGE_MAX),
    ...(stack ? { stack: stack.slice(0, STACK_MAX) } : {}),
    at: new Date().toISOString(),
  });
}

/** Hooks uncaught JS errors and console.error. Idempotent; call once at startup. */
export function installDiagnostics() {
  if (installed) return;
  installed = true;

  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    const first = args.find((a) => a instanceof Error);
    recordError(first ?? args.map(describe).join(" "));
    consoleError.apply(console, args);
  };

  if (Platform.OS === "web") {
    window.addEventListener("error", (e) => recordError(e.error ?? e.message));
    window.addEventListener("unhandledrejection", (e) => recordError(e.reason));
  } else if (typeof ErrorUtils !== "undefined") {
    const previous = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      recordError(error);
      previous(error, isFatal);
    });
  }
}

/** Called from lib/api.ts when a request fails. The query string is dropped (it can carry secrets). */
export function recordFailedRequest(method: string, path: string, status: number) {
  push(failedRequests, {
    method,
    url: path.split("?")[0] ?? path,
    status,
    at: new Date().toISOString(),
  });
}

export function setCurrentRoute(next: string) {
  route = next;
}

export const getCurrentRoute = () => route;
export const getRecentErrors = (): CapturedError[] => errors.slice();
export const getFailedRequests = (): FailedRequest[] => failedRequests.slice();
