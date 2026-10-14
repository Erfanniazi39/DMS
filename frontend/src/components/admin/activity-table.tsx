"use client";

import Link from "next/link";
import { actionDetails, actionLabel, entityLabel, formatDateTime } from "@/lib/audit-labels";

export type ActivityRow = {
  id: number;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: string | null;
  createdAt: string;
  user: { id: number; username: string } | null;
};

// Read-only activity rows; `showUser` adds the actor column (the global feed).
export function ActivityTable({ rows, showUser }: { rows: ActivityRow[]; showUser: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[40rem] text-right text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">زمان</th>
            {showUser ? <th className="px-3 py-2 font-medium">کاربر</th> : null}
            <th className="px-3 py-2 font-medium">فعالیت</th>
            <th className="px-3 py-2 font-medium">مورد</th>
            <th className="px-3 py-2 font-medium">توضیح</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/30">
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDateTime(row.createdAt)}</td>
              {showUser ? <td className="px-3 py-2" dir="ltr">{row.user?.username ?? "—"}</td> : null}
              <td className="px-3 py-2">{actionLabel(row.action)}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.entityType ? `${entityLabel(row.entityType)}${row.entityId ? ` #${row.entityId}` : ""}` : "—"}
                {row.action.endsWith("_DELETED") && row.entityType && row.entityId ? <Link className="ms-2 text-xs text-primary hover:underline" href={`/admin/deleted-records?entityType=${row.entityType}&entityId=${row.entityId}`}>نسخهٔ ذخیره‌شده</Link> : null}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{actionDetails(row.action, row.details) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
