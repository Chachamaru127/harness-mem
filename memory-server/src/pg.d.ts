declare module "pg" {
  export const Pool: new (options?: Record<string, unknown>) => unknown;
}
