import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function money(cents: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${cents}`;
  }
}

export default function ContactDetailPage() {
  const { slug, id } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["contact", slug, id],
    queryFn: () => api.getContact(slug!, id!),
    enabled: !!slug && !!id,
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data) return <p>Not found.</p>;
  const c = data.contact;

  return (
    <div className="space-y-4">
      <Link to={`/${slug}/crm/contacts`} className="text-sm text-muted-foreground hover:underline">
        ← Contacts
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{c.name || c.email || "Contact"}</h1>
        <p className="text-muted-foreground text-sm">{c.email || "—"}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="secondary">{c.status}</Badge>
          {c.company && <Badge variant="outline">{c.company}</Badge>}
          {c.phone && <Badge variant="outline">{c.phone}</Badge>}
          {c.source && <Badge variant="outline">src: {c.source}</Badge>}
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium">Deals</p>
          {data.deals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals.</p>
          ) : (
            <ul className="space-y-1">
              {data.deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">{d.name}</span>
                  <span className="text-muted-foreground ml-2">
                    {money(d.amount_cents, d.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium">Support tickets</p>
          {data.tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tickets.</p>
          ) : (
            <ul className="space-y-1">
              {data.tickets.map((t) => (
                <li key={t.id} className="text-sm">
                  #{t.sequence_id} {t.name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
