import type { Request, Response, NextFunction } from "express";
import { auditLog } from "../../shared/goldSchema.js";
import { db } from "../config/database.js";
import { logger } from "../config/logger.js";
import { isUuid } from "./auditUuid.js";

export async function auditLogEntry(
  actorUserId: string,
  action: string,
  targetTable: string,
  targetId: string,
  before?: any,
  after?: any,
  reason?: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  try {
    if (!isUuid(targetId)) {
      return;
    }

    const oldValues = before ?? null;
    const newValues = after || reason ? { after: after ?? null, reason: reason ?? null } : null;

    await db.insert(auditLog).values({
      tableName: targetTable,
      recordId: targetId,
      action,
      oldValues,
      newValues,
      changedBy: isUuid(actorUserId) ? actorUserId : null,
      changedAt: new Date(),
      ipAddress: ip,
      userAgent: userAgent ?? null,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to write audit log");
  }
}

export function auditedRoute(targetTable: string, handler: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let before: any = null;
    let after: any = null;

    try {
      const result = await handler(req, res, next);

      if (["POST", "PUT", "PATCH"].includes(req.method)) {
        after = result;
      }

      if (req.user) {
        await auditLogEntry(
          req.user.userId,
          `${req.method.toLowerCase()}_${req.route?.path || req.path}`,
          targetTable,
          req.params.id || "",
          before,
          after,
          req.body?.reason,
          req.ip,
          req.headers["user-agent"] as string | undefined
        );
      }

      return result;
    } catch (error) {
      next(error);
    }
  };
}
