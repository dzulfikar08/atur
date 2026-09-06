import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "@/lib/icons";

import { useAuthStore } from "@/stores/auth";
import { ApiError } from "@/lib/api";
import { GoogleButton } from "@/components/auth/GoogleButton";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// Ops-console field styling (design: inset surfaces, 13.5px input text).
const fieldLabelClass = "text-[12.5px] font-semibold text-muted-foreground";
const fieldInputClass =
  "h-auto rounded-[9px] border-border bg-(--surface-card) px-[13px] py-[11px] text-[13.5px] md:text-[13.5px]";
const primaryButtonClass = "h-auto rounded-[10px] py-[13px] text-[14.5px] font-extrabold";

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

// Ops-console login: centered 400px card on a near-black field with a soft
// radial glow behind it. All auth paths (password, email code, Google) are
// unchanged — visual refresh only.
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Soft radial glow behind the card (token-based, coherent in light mode) */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[700px] w-[700px] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 50%, color-mix(in srgb, var(--foreground) 7%, transparent) 0%, transparent 100%)",
        }}
      />

      <div className="relative z-[1] flex w-full max-w-[400px] flex-col gap-5 rounded-[18px] border border-border bg-(--surface-elevated) p-9 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.67)]">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <img src="/logo-128.png" alt="" className="h-[34px] w-[34px] rounded-[9px] bg-primary" />
          <span className="text-[18px] font-bold text-foreground">Atur</span>
        </div>

        <div>
          <h1 className="text-[23px] font-extrabold tracking-[-0.5px] text-foreground">
            Welcome back
          </h1>
          <p className="text-[14px] text-muted-foreground">
            Sign in to your workspace to continue.
          </p>
        </div>

        <Tabs defaultValue="password" className="w-full">
          <TabsList className="flex h-auto w-full gap-[2px] rounded-[9px] bg-(--surface-card) p-[3px] ring-0">
            <TabsTrigger
              value="password"
              className="h-auto flex-1 rounded-[7px] px-0 py-[7px] text-[13px] font-medium text-muted-foreground ring-0 data-[state=active]:bg-(--surface-card-hover) data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:ring-0"
            >
              Password
            </TabsTrigger>
            <TabsTrigger
              value="otp"
              className="h-auto flex-1 rounded-[7px] px-0 py-[7px] text-[13px] font-medium text-muted-foreground ring-0 data-[state=active]:bg-(--surface-card-hover) data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:ring-0"
            >
              Email code
            </TabsTrigger>
          </TabsList>

          <TabsContent value="password" className="mt-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                {error && (
                  <div
                    role="alert"
                    className="rounded-[9px] border border-destructive/50 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive"
                  >
                    {error}
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={fieldLabelClass}>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="you@company.com"
                          autoComplete="email"
                          className={fieldInputClass}
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
                      <FormLabel className={fieldLabelClass}>Password</FormLabel>
                      <div className="relative">
                        <FormControl>
                          <Input
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••••"
                            autoComplete="current-password"
                            className={`${fieldInputClass} pr-10`}
                            {...field}
                          />
                        </FormControl>
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className={`w-full ${primaryButtonClass}`} disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign in
                </Button>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="otp" className="mt-4">
            <OtpLogin />
          </TabsContent>
        </Tabs>

        {/* Divider */}
        <div className="flex w-full items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[12px] text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* GoogleButton owns the handler/flow; restyle its inner button to the
            ops-console look from here (component file is shared). */}
        <div className="w-full [&_a]:block [&_button]:h-auto [&_button]:w-full [&_button]:rounded-[10px] [&_button]:border-border [&_button]:bg-(--surface-card) [&_button]:py-[12px] [&_button]:text-[14px] [&_button]:font-semibold [&_button:hover]:bg-(--surface-card-hover) [&_button:hover]:text-foreground">
          <GoogleButton />
        </div>

        <p className="w-full text-center text-[13.5px] text-muted-foreground">
          New to Atur?{" "}
          <Link to="/auth/register" className="font-semibold text-foreground hover:underline">
            Create a workspace
          </Link>
        </p>
      </div>
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
    <div className="space-y-3">
      {error && (
        <div
          role="alert"
          className="rounded-[9px] border border-destructive/50 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive"
        >
          {error}
        </div>
      )}

      {step === "email" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="otp-email" className={fieldLabelClass}>
              Email
            </Label>
            <Input
              id="otp-email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              className={fieldInputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendCode()}
            />
          </div>
          <Button
            className={`w-full ${primaryButtonClass}`}
            onClick={sendCode}
            disabled={loading || !email.trim()}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {loading ? "Sending…" : "Send verification code"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="otp-code" className={fieldLabelClass}>
              Verification code
            </Label>
            <InputOTP
              id="otp-code"
              maxLength={6}
              value={code}
              onChange={setCode}
              onComplete={verify}
              autoFocus
              className="justify-center"
              containerClassName="w-full justify-center"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            <p className="text-xs text-muted-foreground">
              Sent to {email}.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
              >
                Change email
              </button>
            </p>
          </div>

          {devCode && (
            <p className="rounded-[9px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Dev mode (no email provider configured). Your code: <strong>{devCode}</strong>
            </p>
          )}

          <Button
            className={`w-full ${primaryButtonClass}`}
            onClick={verify}
            disabled={loading || code.length !== 6}
          >
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
