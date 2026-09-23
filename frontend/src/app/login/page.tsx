"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiFetch, type ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      router.push("/");
      router.refresh();
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message ?? "ورود ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">ورود به سامانه</CardTitle>
          <CardDescription>
            سامانه مدیریت کسب‌وکار — لطفاً اطلاعات کاربری خود را وارد کنید
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" autoComplete="off">
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">نام کاربری</Label>
              <Input
                id="username"
                name="username"
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">رمز عبور</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={loading} className="mt-2">
              {loading ? "در حال ورود..." : "ورود"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
