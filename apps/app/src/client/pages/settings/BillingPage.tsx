import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiFetch, type Billing } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CHECKOUT_URL = "https://buy.polar.sh/polar_cl_bObfAZXGCAqKpziWXocIz32SyN3crYmadyYq700u26t";
const PORTAL_URL = "https://polar.sh/joyo-digitama-solusi/portal";
const PRODUCTS = {
  solo: "c86b15e8-e91b-464e-a6d0-e5d3f70d7b83",
  team: "ddd252b0-6cf2-4a91-8757-2fd057f8bf51",
} as const;

interface BillingMe {
  id: string;
  email: string;
  billing: Billing;
}

function checkoutHref(plan: keyof typeof PRODUCTS, me: BillingMe) {
  const params = new URLSearchParams({
    product_id: PRODUCTS[plan],
    customer_email: me.email,
    reference_id: me.id,
  });
  return `${CHECKOUT_URL}?${params.toString()}`;
}

const PLANS = [
  {
    key: "solo",
    name: "Solo",
    price: "$9 / month",
    blurb: "For one person. Unlocks the iOS and Android app on your account.",
  },
  {
    key: "team",
    name: "Team",
    price: "$29 / month",
    blurb:
      "Unlocks the iOS and Android app for everyone in the workspaces you own. Members need no plan of their own.",
  },
] as const;

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  canceled: "Canceled",
  revoked: "Ended",
  past_due: "Payment past due",
};

export default function BillingPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const returning = params.has("checkout_id");

  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<BillingMe>("/users/me/"),
    // The Polar webhook can lag the redirect: poll until the plan lands.
    refetchInterval: (q) => (returning && q.state.data?.billing?.entitled === false ? 2500 : false),
  });

  const entitled = me?.billing?.entitled === true;
  useEffect(() => {
    if (returning && entitled) {
      setParams({}, { replace: true });
      qc.invalidateQueries({ queryKey: ["me"] });
    }
  }, [returning, entitled, setParams, qc]);

  // diatur.com plan buttons land here as /billing?plan=solo|team, after sign-in
  // if needed, so the checkout always carries this account's id and email.
  const wanted = params.get("plan");
  const autoPlan = wanted === "solo" || wanted === "team" ? wanted : null;
  const autoCheckout =
    autoPlan !== null && !!me && me.billing.managed && me.billing.checkout_open && !entitled;
  useEffect(() => {
    if (!me || !autoPlan) return;
    if (autoCheckout) window.location.assign(checkoutHref(autoPlan, me));
    else setParams({}, { replace: true });
  }, [me, autoPlan, autoCheckout, setParams]);

  if (autoCheckout) {
    return <div className="p-6 text-sm text-muted-foreground">Opening checkout...</div>;
  }

  if (isLoading || !me) return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  const billing = me.billing;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Atur Cloud on the web is free. A Solo or Team plan unlocks the iOS and Android app.
        </p>
      </div>

      {returning && !entitled && (
        <Card>
          <CardContent className="py-4 text-sm">
            Thanks, activating your plan... This usually takes a few seconds.
          </CardContent>
        </Card>
      )}

      {!billing.managed ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Plans are not enabled on this server. Every account can use the app.
          </CardContent>
        </Card>
      ) : entitled ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {billing.plan ? `Atur ${billing.plan === "team" ? "Team" : "Solo"}` : "App access"}
            </CardTitle>
            <CardDescription>
              {billing.status
                ? `Status: ${STATUS_LABEL[billing.status] ?? billing.status}`
                : "Your account has app access through a workspace plan or admin access."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {billing.status && (
              <Button asChild variant="outline">
                <a href={PORTAL_URL} target="_blank" rel="noreferrer">
                  Manage billing
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {billing.status && (
            <Card>
              <CardContent className="flex items-center justify-between gap-4 py-4 text-sm">
                <span>
                  Your last plan is {STATUS_LABEL[billing.status] ?? billing.status}. Pick a plan to
                  get the app back.
                </span>
                <Button asChild variant="outline" size="sm">
                  <a href={PORTAL_URL} target="_blank" rel="noreferrer">
                    Manage billing
                  </a>
                </Button>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {PLANS.map((p) => (
              <Card key={p.key}>
                <CardHeader>
                  <CardTitle>{p.name}</CardTitle>
                  <CardDescription>{p.price}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">{p.blurb}</p>
                  {billing.checkout_open ? (
                    <Button asChild>
                      <a href={checkoutHref(p.key, me)}>Choose {p.name}</a>
                    </Button>
                  ) : (
                    <WaitlistButton plan={p.key} email={me.email} />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Paid checkout is closed until customers can connect their own machine: the
// plan buttons put the signed-in email on the waitlist instead.
function WaitlistButton({ plan, email }: { plan: keyof typeof PRODUCTS; email: string }) {
  const join = useMutation({
    mutationFn: async () => {
      const res = await fetch("/public/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, plan, source: "billing" }),
      });
      if (!res.ok) throw new Error("Could not join the waitlist. Try again in a minute.");
    },
  });
  if (join.isSuccess) {
    return <p className="text-sm">You're on the list. We'll email {email} when it opens.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <Button onClick={() => join.mutate()} disabled={join.isPending}>
        {join.isPending ? "Joining..." : "Join the waitlist"}
      </Button>
      {join.isError && <p className="text-sm text-destructive">{join.error.message}</p>}
    </div>
  );
}
