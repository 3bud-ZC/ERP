/**
 * Enterprise audit trail — wraps activity log + audit action.
 */

import { logActivity } from '@/lib/activity-log';
import { logAuditAction } from '@/lib/auth';

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'POST'
  | 'REVERSE'
  | 'APPROVE'
  | 'CANCEL'
  | 'CONVERT';

export interface AuditTrailParams {
  userId: string;
  tenantId: string;
  module: string;
  entity: string;
  entityId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAuditTrail(params: AuditTrailParams): Promise<void> {
  const activityAction =
    params.action === 'POST' ||
    params.action === 'REVERSE' ||
    params.action === 'APPROVE' ||
    params.action === 'CANCEL' ||
    params.action === 'CONVERT'
      ? 'UPDATE'
      : params.action;

  await Promise.allSettled([
    logActivity({
      entity: params.entity,
      entityId: params.entityId,
      action: activityAction as 'CREATE' | 'UPDATE' | 'DELETE',
      userId: params.userId,
      before: params.before,
      after: { ...((params.after as object) || {}), auditAction: params.action, ...params.metadata },
    }),
    logAuditAction(
      params.userId,
      params.action,
      params.module,
      params.entity,
      params.entityId,
      { before: params.before, after: params.after, metadata: params.metadata },
      params.ip,
      params.userAgent,
    ),
  ]);
}
