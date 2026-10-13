"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { PrintFields, PrintHeader, PrintSheet, PrintSignatures, PrintToolbar } from "@/components/print/print-document";
import { NoAccess, employeeLabel, productionOutputTitle, type ProductionOutputDetail } from "../../../shared";
import { InboundPrintTable } from "../../../_inbound/InboundPrintTable";
import { useBatchExpiry } from "../../../_inbound/useBatchExpiry";

// رسید تولید (PRD) — browser-print page, same pattern as the GRN print page.
// Reads GET /inventory/production-outputs/:id (inventory.view). A DRAFT prints
// with a "پیش‌نویس — فاقد اعتبار" marker. Costs print only for inventory.cost.
export default function ProductionOutputPrintPage() {
  const params = useParams<{ id: string }>();
  const outputId = Number(params.id);
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canCost = user?.permissions.includes("inventory.cost") ?? false;
  const [output, setOutput] = useState<ProductionOutputDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<ProductionOutputDetail>(`/inventory/production-outputs/${outputId}`)
      .then((data) => {
        if (!ignore) setOutput(data);
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات رسید تولید ناموفق بود.");
      });
    return () => {
      ignore = true;
    };
  }, [outputId, canView]);

  const batchExpiry = useBatchExpiry(output?.items, canView && output?.status === "POSTED");

  if (!canView) return <NoAccess message="اجازه مشاهده رسیدهای تولید را ندارید." />;

  if (!output) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        {loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            <p role="alert">{loadError}</p>
            <Link href="/inventory/production" className="text-primary hover:underline">بازگشت به رسیدهای تولید ←</Link>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
        )}
      </div>
    );
  }

  const producer = output.producedByEmployee ? employeeLabel(output.producedByEmployee) : null;

  return (
    <div className="p-4 sm:p-6 print:p-0">
      <PrintToolbar backHref={`/inventory/production/${output.id}`} backLabel="بازگشت به رسید تولید" />
      <PrintSheet>
        <PrintHeader
          title="رسید تولید"
          draft={output.status === "DRAFT"}
          meta={[
            ["شماره", <span key="n" className="font-mono">{productionOutputTitle(output)}</span>],
            ["تاریخ تولید", formatJalali(output.productionDate)],
            ["انبار", output.location.name],
          ]}
        />

        <PrintFields rows={[["تولیدکننده", producer], ["ثبت‌کننده", output.createdByUser?.username ?? null]]} />

        <InboundPrintTable lines={output.items} showCost={canCost} batchExpiry={batchExpiry} />

        {output.note ? (
          <div className="mt-4 border border-border p-3">
            <span className="text-muted-foreground">توضیحات: </span>
            <span className="whitespace-pre-wrap">{output.note}</span>
          </div>
        ) : null}

        <PrintSignatures
          boxes={[
            { label: "تحویل‌دهنده (تولید)", name: output.producedByEmployee ? `${output.producedByEmployee.firstName} ${output.producedByEmployee.lastName}` : null },
            { label: "تحویل‌گیرنده (انبار)", name: output.postedByUser?.username ?? null },
          ]}
        />
      </PrintSheet>
    </div>
  );
}
