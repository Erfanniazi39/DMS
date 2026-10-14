"use client";

import { useParams } from "next/navigation";
import { LetterForm } from "../../LetterForm";

export default function EditLetterPage() {
  const params = useParams<{ id: string }>();
  const letterId = Number(params.id);
  if (!Number.isInteger(letterId)) return <p className="p-8 text-center text-sm text-muted-foreground">شناسهٔ نامه نامعتبر است.</p>;
  return <LetterForm mode="edit" letterId={letterId} />;
}
