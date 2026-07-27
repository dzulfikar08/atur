import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { ApiError, portalApi } from '@/lib/portalApi';
import { usePortalAuthStore } from '@/stores/portalAuth';

export default function PortalLoginPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const setCustomer = usePortalAuthStore((s) => s.setCustomer);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = 'Sign in — Support Portal';
  }, []);

  const sendCode = async () => {
    if (!slug) return;
    setLoading(true);
    setDevCode(null);
    try {
      const res = await portalApi.requestOtp(slug, email.trim(), name.trim() || undefined);
      if (res.dev_code) setDevCode(res.dev_code);
      setStep('code');
      toast.success('Verification code sent to your email.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to send code');
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const { customer } = await portalApi.verifyOtp(slug, email.trim(), code.trim());
      setCustomer(customer);
      navigate(`/portal/${slug}`, { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Invalid or expired code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background">
            <img src="/logo-128.png" alt="" className="h-6 w-6 rounded" />
          </div>
          <CardTitle>Support Portal</CardTitle>
          <CardDescription>
            {slug ? `Workspace: ${slug}` : 'Sign in to continue'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {step === 'email' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  onKeyDown={(e) => e.key === 'Enter' && sendCode()}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name">Name (optional)</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <Button className="w-full" onClick={sendCode} disabled={!email.trim() || loading}>
                {loading ? 'Sending…' : 'Send verification code'}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  onKeyDown={(e) => e.key === 'Enter' && verify()}
                />
                <p className="text-xs text-muted-foreground">
                  Sent to {email}.{' '}
                  <button className="underline" onClick={() => setStep('email')}>
                    Change email
                  </button>
                </p>
              </div>
              {devCode && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  Dev mode (no email provider configured). Your code: <strong>{devCode}</strong>
                </p>
              )}
              <Button className="w-full" onClick={verify} disabled={code.length !== 6 || loading}>
                {loading ? 'Verifying…' : 'Sign in'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
