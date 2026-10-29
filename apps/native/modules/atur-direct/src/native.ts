import { requireOptionalNativeModule } from "expo-modules-core";

import type { NativeAturDirect } from "./connection";

/** Null on web and in binaries built before the direct path existed (an OTA update can run on those). */
export const native = requireOptionalNativeModule<NativeAturDirect>("AturDirect");
