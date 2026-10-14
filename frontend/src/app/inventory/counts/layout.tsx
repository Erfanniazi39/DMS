"use client";

import type { ReactNode } from "react";
import { RequireFeature } from "@/components/require-feature";

export default function Layout({ children }: { children: ReactNode }) {
  return <RequireFeature feature="inventoryStockCounts">{children}</RequireFeature>;
}
