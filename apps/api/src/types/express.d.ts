import type { AuthContext } from "../lib/auth-context.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
