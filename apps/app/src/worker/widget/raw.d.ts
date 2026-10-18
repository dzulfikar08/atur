// Vite `?raw` imports resolve to the file's text (used to ship widget.src.js).
declare module "*.js?raw" {
  const source: string;
  export default source;
}
