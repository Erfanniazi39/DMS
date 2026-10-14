"use client";

import { useParams } from "next/navigation";
import { RuleForm } from "../../RuleForm";

export default function EditWorkflowRulePage() {
  const params = useParams<{ id: string }>();
  const ruleId = Number(params.id);
  if (!Number.isInteger(ruleId)) return <p className="p-8 text-center text-sm text-muted-foreground">شناسهٔ قانون نامعتبر است.</p>;
  return <RuleForm mode="edit" ruleId={ruleId} />;
}
