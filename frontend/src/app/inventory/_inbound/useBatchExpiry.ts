"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ItemBatches } from "../shared";

/**
 * batchId → expiry date for the batches a posted inbound document's lines
 * resolved to (GET /inventory/items/:itemId/batches, inventory.view — one call
 * per distinct item; depleted batches are included there too). Failures just
 * leave the map without that item: the table falls back to "-".
 */
export function useBatchExpiry(lines: { itemId: number; batchId: number | null }[] | undefined, enabled: boolean): Map<number, string | null> {
  const itemsKey = useMemo(
    () => (lines ? [...new Set(lines.filter((line) => line.batchId !== null).map((line) => line.itemId))].sort((a, b) => a - b).join(",") : ""),
    [lines],
  );
  const [result, setResult] = useState<{ key: string; map: Map<number, string | null> }>({ key: "", map: new Map() });

  useEffect(() => {
    if (!enabled || !itemsKey) return;
    let ignore = false;
    Promise.all(itemsKey.split(",").map((id) => apiFetch<ItemBatches>(`/inventory/items/${id}/batches`).catch(() => null))).then((responses) => {
      if (ignore) return;
      const map = new Map<number, string | null>();
      for (const response of responses) for (const batch of response?.batches ?? []) map.set(batch.batchId, batch.expiryDate);
      setResult({ key: itemsKey, map });
    });
    return () => {
      ignore = true;
    };
  }, [itemsKey, enabled]);

  return result.key === itemsKey ? result.map : EMPTY;
}

const EMPTY = new Map<number, string | null>();
