import { createDirect } from "./connection";
import { native } from "./native";

export * from "./types";
export { DirectConnection, createDirect, unwrap, type NativeAturDirect } from "./connection";

/** The direct path, or null where the native module is not in the binary. */
export const AturDirect = native ? createDirect(native) : null;
