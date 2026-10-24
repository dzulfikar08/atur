import pkg from "../package.json";

/** Single source of truth: package.json (the release workflow requires the `bridge-v*` tag to match). */
export const BRIDGE_VERSION: string = pkg.version;
