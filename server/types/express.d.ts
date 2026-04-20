import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    auth?: {
      userId: string;
      email: string;
      vendorId: string;
      role: string;
      permissions: string[];
      isAdmin?: boolean;
      b2cCustomerId?: string;
      effectiveUserId?: string;
      isImpersonating?: boolean;
      profile?: { role: string };
      householdRole?: string;
    };
    /** @deprecated Use req.auth instead */
    user?: {
      userId: string;
      email: string;
      vendorId: string;
      role: string;
      permissions: string[];
      isAdmin?: boolean;
      b2cCustomerId?: string;
    };
  }
}