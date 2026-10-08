import { FormSection } from "../../../sales-orders/_form/FormSection";
import { formatMoney } from "@/lib/format";
import { formatQuantity } from "../../shared";
import type { SalesReturnDetail } from "../../shared";

// «اقلام مرجوعی» — the return's lines with their full progress: requested
// (what was asked for) → received (what physically came back) → disposition
// (restock / write-off) → credited (what the credit note actually covered).
export function ItemsSection({ salesReturn }: { salesReturn: SalesReturnDetail }) {
  const showReceived = salesReturn.status !== "REQUESTED" && salesReturn.status !== "REJECTED";
  const showDisposition = salesReturn.status === "INSPECTED" || salesReturn.status === "COMPLETED";

  return (
    <FormSection title="اقلام مرجوعی" description={`${salesReturn.items.length.toLocaleString("fa-IR")} ردیف`}>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[48rem] text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">کالا</th>
              <th className="px-2 py-2 font-medium">واحد</th>
              <th className="px-2 py-2 font-medium">قیمت واحد</th>
              <th className="px-2 py-2 font-medium">مقدار درخواستی</th>
              {showReceived ? <th className="px-2 py-2 font-medium">دریافت‌شده</th> : null}
              {showDisposition ? (
                <>
                  <th className="px-2 py-2 font-medium">بازگشت به انبار</th>
                  <th className="px-2 py-2 font-medium">ضایعات</th>
                </>
              ) : null}
              <th className="px-2 py-2 font-medium">اعتباردهی‌شده</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {salesReturn.items.map((line) => (
              <tr key={line.id}>
                <td className="px-2 py-2">{line.itemName}</td>
                <td className="px-2 py-2 text-muted-foreground">{line.unitName}</td>
                <td className="px-2 py-2 tabular-nums text-muted-foreground">{formatMoney(line.unitPrice)}</td>
                <td className="px-2 py-2 tabular-nums">{formatQuantity(line.requestedQty)}</td>
                {showReceived ? <td className="px-2 py-2 tabular-nums">{formatQuantity(line.receivedQty)}</td> : null}
                {showDisposition ? (
                  <>
                    <td className="px-2 py-2 tabular-nums text-success">{formatQuantity(line.restockQty)}</td>
                    <td className="px-2 py-2 tabular-nums text-destructive">{formatQuantity(line.writeOffQty)}</td>
                  </>
                ) : null}
                <td className="px-2 py-2 font-medium tabular-nums">{formatQuantity(line.creditedQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FormSection>
  );
}
