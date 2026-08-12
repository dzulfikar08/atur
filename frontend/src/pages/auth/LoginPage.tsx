import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from '@/lib/icons';

import { useAuthStore } from "@/stores/auth";
import { ApiError } from "@/lib/api";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function readErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.message);
      return parsed.message ?? parsed.error ?? parsed.detail ?? fallback;
    } catch {
      return err.message || fallback;
    }
  }
  return err instanceof Error ? err.message : fallback;
}

function redirectAfterLogin(): string {
  const redirect = sessionStorage.getItem("redirect_after_login") ?? "/";
  sessionStorage.removeItem("redirect_after_login");
  return redirect;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (isAuthenticated) {
    return null;
  }

  async function onSubmit(values: LoginFormValues) {
    setError(null);
    try {
      await login(values.email, values.password);
      navigate(redirectAfterLogin(), { replace: true });
    } catch (err) {
      const message = readErrorMessage(err, "Invalid email or password");
      setError(message);
      toast.error(message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mb-2 flex items-center justify-center gap-2">
            <img src="/logo-128.png" alt="" className="h-9 w-9 rounded-lg bg-primary" />
            <span className="text-xl font-bold tracking-tight">
              Atur
            </span>
          </div>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>
            Sign in to your account to continue
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Tabs defaultValue="password" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="password">Password</TabsTrigger>
              <TabsTrigger value="otp">Email code</TabsTrigger>
            </TabsList>

            <TabsContent value="password" className="mt-4">
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                >
                  {error && (
                    <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="you@example.com"
                            autoComplete="email"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <div className="relative">
                          <FormControl>
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="Enter your password"
                              autoComplete="current-password"
                              className="pr-10"
                              {...field}
                            />
                          </FormControl>
                          <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loading}
                  >
                    {loading && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Sign in
                  </Button>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="otp" className="mt-4">
              <OtpLogin />
            </TabsContent>
          </Tabs>
        </CardContent>

        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              to="/auth/register"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Register
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

// Passwordless email-code login. Two steps: enter email → we send a 6-digit
// code → enter code → session established. Mirrors the support portal flow; a
// new account is auto-created on verify if the email is unknown.
function OtpLogin() {
  const navigate = useNavigate();
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setDevCode(null);
    try {
      const res = await requestOtp(trimmed);
      if (res.dev_code) setDevCode(res.dev_code);
      setStep("code");
      toast.success("Verification code sent to your email.");
    } catch (err) {
      const message = readErrorMessage(err, "Failed to send code");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    const trimmedEmail = email.trim();
    const trimmedCode = code.trim();
    if (trimmedCode.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      await verifyOtp(trimmedEmail, trimmedCode);
      navigate(redirectAfterLogin(), { replace: true });
    } catch (err) {
      const message = readErrorMessage(err, "Invalid or expired code");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {step === "email" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="otp-email">Email</Label>
            <Input
              id="otp-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendCode()}
            />
          </div>
          <Button className="w-full" onClick={sendCode} disabled={loading || !email.trim()}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {loading ? "Sending…" : "Send verification code"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="otp-code">Verification code</Label>
            <Input
              id="otp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Sent to {email}.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => { setStep("email"); setCode(""); setError(null); }}
              >
                Change email
              </button>
            </p>
          </div>

          {devCode && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Dev mode (no email provider configured). Your code: <strong>{devCode}</strong>
            </p>
          )}

          <Button className="w-full" onClick={verify} disabled={loading || code.length !== 6}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {loading ? "Verifying…" : "Sign in"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground underline"
            onClick={sendCode}
            disabled={loading}
          >
            Resend code
          </button>
        </div>
      )}
    </div>
  );
}
