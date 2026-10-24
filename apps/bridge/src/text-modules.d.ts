/** Shell hook scripts are embedded in the compiled binary as text (see hooks.ts). */
declare module "*.sh" {
  const text: string;
  export default text;
}
