import { FormSection } from "../../../sales-orders/_form/FormSection";
import { formatQuantity } from "../../../sales-orders/shared";
import type { DeliveryDetail } from "../../shared";

// «اقلام حواله» — the delivery lines. Item code/name/unit are the order
// line's snapshots. For a DRAFT, the order line's current remaining
// quantity is shown too, so a line that no longer fits (another delivery
// was posted meanwhile) is visible before «ثبت حواله» refuses it.
export function ItemsSection({ delivery }: { delivery: DeliveryDetail }) {
  const isDraft = delivery.status === "DRAFT";
  const totalQuantity = delivery.items.reduce((sum, item) => sum + Number(item.quantity), 0);

  return (
    <FormSection title="اقلام حواله" description={`${delivery.items.length.toLocaleString("fa-IR")} ردیف — انبار: ${delivery.location.name}`}>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[40rem] text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">کالا</th>
              <th className="px-2 py-2 font-medium">واحد</th>
              <th className="px-2 py-2 font-medium">مقدار سفارش</th>
              {isDraft ? <th className="px-2 py-2 font-medium">باقی‌ماندهٔ فعلی سفارش</th> : null}
              <th className="px-2 py-2 font-medium">مقدار این حواله</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {delivery.items.map((item) => {
              const line = item.salesOrderItem;
              const open = Number(line.quantity) - Number(line.deliveredQty);
              const exceeds = isDraft && Number(item.quantity) > open;
              return (
                <tr key={item.id} className={exceeds ? "bg-destructive/10" : undefined}>
                  <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">{line.lineNo.toLocaleString("fa-IR")}</td>
                  <td className="px-2 py-2">
                    {line.itemName} <span className="font-mono text-[11px] text-muted-foreground">{line.itemCode}</span>
                    {exceeds ? <div className="mt-0.5 text-xs text-destructive">مقدار این ردیف از باقی‌ماندهٔ فعلی سفارش بیشتر است؛ حواله را اصلاح کنید.</div> : null}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{line.unitName}</td>
                  <td className="px-2 py-2 tabular-nums text-muted-foreground">{formatQuantity(line.quantity)}</td>
                  {isDraft ? <td className="px-2 py-2 tabular-nums text-muted-foreground">{formatQuantity(open)}</td> : null}
                  <td className="px-2 py-2 font-medium tabular-nums">{formatQuantity(item.quantity)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-border bg-muted/20 text-sm">
            <tr>
              <td className="px-2 py-2" colSpan={isDraft ? 5 : 4}>جمع مقدار</td>
              <td className="px-2 py-2 font-semibold tabular-nums">{formatQuantity(totalQuantity)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </FormSection>
  );
}
