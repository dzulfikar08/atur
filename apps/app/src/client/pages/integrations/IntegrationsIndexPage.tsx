import { Link, useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { GitBranch, Clock, Zap, Bot, ArrowUpRight, MessageSquare } from "@/lib/icons";

const integrations = [
  {
    to: "integrations/github",
    icon: GitBranch,
    name: "GitHub",
    description: "Connect repositories to sync issues between GitHub and Atur projects.",
  },
  {
    to: "integrations/clockify",
    icon: Clock,
    name: "Clockify",
    description: "Import time entries into the timesheet.",
  },
  {
    to: "integrations/polar",
    icon: Zap,
    name: "Polar",
    description:
      "Sync Polar customers, subscriptions, and orders into the CRM as contacts and deals.",
  },
  {
    to: "crm/threads",
    icon: MessageSquare,
    name: "Threads",
    description:
      "Pull replies and mentions into a CRM inbox, answer them, and turn their authors into leads.",
  },
  {
    to: "integrations/mcp",
    icon: Bot,
    name: "AI / MCP",
    description: "Connect AI agents to your workspace over the Model Context Protocol.",
  },
];

export default function IntegrationsIndexPage() {
  const { slug } = useParams<{ slug: string }>();
  const base = `/${slug ?? ""}`;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect Atur with the tools your team already uses.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {integrations.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.to} to={`${base}/${item.to}`}>
              <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/50">
                <CardContent className="flex items-start gap-4 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{item.name}</span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
