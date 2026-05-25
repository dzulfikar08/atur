import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Zap,
  LayoutDashboard,
  FileText,
  PenTool,
  Smartphone,
  Bot,
  ArrowRight,
  Check,
  Menu,
  X,
  ChevronRight,
  Gauge,
  Shield,
  Blocks,
  Cpu,
  Network,
  Sparkles,
} from 'lucide-react';

const features = [
  {
    icon: LayoutDashboard,
    title: 'Kanban Boards',
    description: 'Drag-and-drop issue management with custom workflows and states.',
  },
  {
    icon: FileText,
    title: 'Connected Pages',
    description: 'Rich text with [[wikilinks]], backlinks, and a knowledge graph to connect your thinking.',
  },
  {
    icon: PenTool,
    title: 'Drawing Canvas',
    description: 'Embed whiteboards directly inside any page for visual thinking.',
  },
  {
    icon: Gauge,
    title: 'Rust-Powered',
    description: 'Runs on 50MB RAM. Starts in under a second. A single binary you deploy anywhere.',
  },
  {
    icon: Smartphone,
    title: 'Mobile Ready',
    description: 'Native iOS and Android via Capacitor. Manage projects on the move.',
  },
  {
    icon: Bot,
    title: 'AI Integration',
    description: 'Built-in MCP server for AI agents. Let Claude, Cursor, and Copilot manage your projects.',
  },
];

const metrics = [
  { value: '50MB', label: 'RAM Usage' },
  { value: '<1s', label: 'Start Time' },
  { value: '1', label: 'Binary' },
  { value: '35+', label: 'MCP Tools' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('dark');
    document.title = 'Atur — Organize Everything';
    return () => {
      html.classList.remove('dark');
    };
  }, []);

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <style>{`
        .font-display {
          font-family: 'Instrument Serif', Georgia, 'Times New Roman', serif;
        }
        .font-display-italic {
          font-family: 'Instrument Serif', Georgia, 'Times New Roman', serif;
          font-style: italic;
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .anim-1 { animation: fadeUp 0.6s ease-out both; }
        .anim-2 { animation: fadeUp 0.6s ease-out 0.08s both; }
        .anim-3 { animation: fadeUp 0.6s ease-out 0.16s both; }
        .anim-4 { animation: fadeUp 0.6s ease-out 0.24s both; }
        .anim-5 { animation: fadeUp 0.6s ease-out 0.32s both; }
        .grid-lines {
          background-image:
            linear-gradient(var(--border) 1px, transparent 1px),
            linear-gradient(90deg, var(--border) 1px, transparent 1px);
          background-size: 72px 72px;
          opacity: 0.4;
        }
        .noise {
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E");
        }
      `}</style>

      {/* ── Navbar ── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center gap-2.5"
          >
            <img src="/logo-128.png" alt="" className="h-8 w-8 rounded-md border border-border" />
            <span className="text-base font-semibold tracking-tight">
              Atur
            </span>
          </button>

          <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <button onClick={() => scrollTo('features')} className="hover:text-foreground transition-colors">Features</button>
            <button onClick={() => scrollTo('pages')} className="hover:text-foreground transition-colors">Pages</button>
            <button onClick={() => scrollTo('pricing')} className="hover:text-foreground transition-colors">Pricing</button>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/auth/login')}
            >
              Sign In
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/auth/login')}
            >
              Get Started
            </Button>
          </div>

          <button
            className="md:hidden p-2 text-muted-foreground"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-background px-5 pb-5 pt-3 space-y-1">
            {['features', 'pages', 'pricing'].map((id) => (
              <button
                key={id}
                onClick={() => scrollTo(id)}
                className="block w-full text-left py-2.5 text-sm text-muted-foreground hover:text-foreground capitalize"
              >
                {id}
              </button>
            ))}
            <div className="pt-3 flex flex-col gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate('/auth/login')}>
                Sign In
              </Button>
              <Button size="sm" onClick={() => navigate('/auth/login')}>
                Get Started
              </Button>
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <section className="relative pt-28 pb-20 sm:pt-40 sm:pb-28">
        <div className="grid-lines pointer-events-none absolute inset-0" />
        <div className="noise pointer-events-none absolute inset-0" />

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <Badge variant="outline" className="anim-1 mb-8 gap-2 rounded-full px-4 py-1.5 font-normal">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
              Project management for teams that ship
            </Badge>

            <h1 className="anim-2 text-5xl font-bold tracking-tight sm:text-7xl lg:text-8xl leading-[0.95]">
              Manage projects
              <br />
              <span className="font-display-italic font-normal text-muted-foreground">without the bloat</span>
            </h1>

            <p className="anim-3 mx-auto mt-7 max-w-lg text-lg text-muted-foreground leading-relaxed sm:text-xl">
              Issues, sprints, pages, and whiteboards — in one lightweight binary.
              Rust-powered. Self-hosted. AI-ready.
            </p>

            <div className="anim-4 mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                onClick={() => navigate('/auth/login')}
                className="px-8 h-12 text-base"
              >
                Start Free Trial
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate('/auth/login')}
                className="h-12"
              >
                View Demo
                <ChevronRight className="ml-0.5 h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* App mockup */}
          <div className="anim-5 relative mx-auto mt-16 max-w-5xl">
            <Card className="overflow-hidden rounded-2xl">
              {/* Window chrome */}
              <div className="flex items-center gap-2 border-b border-border px-4 py-3 bg-card">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />
                  <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />
                  <div className="h-3 w-3 rounded-full bg-muted-foreground/30" />
                </div>
                <div className="mx-auto flex h-6 w-72 items-center justify-center rounded-md bg-muted text-[11px] text-muted-foreground">
                  atur.dev
                </div>
              </div>

              {/* Wireframe */}
              <div className="flex h-72 sm:h-[420px]">
                {/* Sidebar */}
                <div className="hidden w-52 flex-col border-r border-border bg-card p-4 sm:flex">
                  <div className="mb-5 h-4 w-20 rounded bg-foreground/15" />
                  <div className="space-y-3">
                    {[80, 60, 72, 48, 64, 56, 68].map((w, i) => (
                      <div
                        key={i}
                        className="h-2.5 rounded"
                        style={{
                          width: `${w}%`,
                          background: i === 1 ? 'var(--foreground)' : 'var(--muted)',
                          opacity: i === 1 ? 0.15 : 0.4,
                        }}
                      />
                    ))}
                  </div>
                  <div className="mt-auto space-y-3">
                    <div className="h-2 w-16 rounded bg-muted" />
                    <div className="h-2 w-20 rounded bg-muted" />
                  </div>
                </div>

                {/* Main content */}
                <div className="flex-1 p-4 sm:p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="h-5 w-28 rounded bg-foreground/10" />
                    <div className="h-8 w-24 rounded-md bg-primary/20" />
                  </div>
                  <div className="grid grid-cols-3 gap-3 sm:gap-4">
                    {['Backlog', 'In Progress', 'Done'].map((col, ci) => (
                      <div key={col}>
                        <div className="mb-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider sm:text-[11px]">
                          {col}
                        </div>
                        <div className="space-y-2.5">
                          {[0, 1].map((card) => (
                            <Card key={card} className="p-3">
                              <div className="mb-2 h-2.5 w-3/4 rounded bg-foreground/[0.07]" />
                              <div className="h-2 w-1/2 rounded bg-muted" />
                              {ci === 1 && card === 0 && (
                                <div className="mt-3 h-1.5 w-2/3 rounded-full bg-primary/30" />
                              )}
                              {ci === 2 && card === 0 && (
                                <div className="mt-2 flex items-center gap-1.5">
                                  <div className="h-4 w-4 rounded-full bg-primary/20 border border-primary/30" />
                                  <div className="h-2 w-8 rounded bg-muted" />
                                </div>
                              )}
                            </Card>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Metrics strip */}
          <div className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border sm:grid-cols-4">
            {metrics.map(({ value, label }) => (
              <div
                key={label}
                className="flex flex-col items-center justify-center bg-card px-4 py-6"
              >
                <span className="text-3xl font-bold sm:text-4xl">
                  {value}
                </span>
                <span className="mt-1 text-xs text-muted-foreground uppercase tracking-wider">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Separator />

      {/* ── Features ── */}
      <section id="features" className="relative py-24 sm:py-32">
        <div className="noise pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Capabilities
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
              Everything you need,<br />
              <span className="text-muted-foreground">nothing you don&apos;t</span>
            </h2>
          </div>

          <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <Card key={title} className="group transition-colors hover:bg-accent">
                <CardContent className="p-7">
                  <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted">
                    <Icon className="h-5 w-5 text-foreground" />
                  </div>
                  <h3 className="text-base font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <Separator />

      {/* ── Pages / Knowledge Graph ── */}
      <section id="pages" className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-20">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Knowledge Base
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl leading-tight">
                Pages that connect<br />
                <span className="font-display-italic font-normal text-muted-foreground">your thinking</span>
              </h2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Write documentation, meeting notes, and specs with an Obsidian-inspired editor.
                Use <code className="rounded bg-muted px-1.5 py-0.5 text-sm text-foreground">[[wikilinks]]</code> to
                connect pages, then explore everything through an interactive knowledge graph.
              </p>
              <ul className="mt-8 space-y-4">
                {[
                  { icon: Blocks, text: 'Rich text with slash commands and callouts' },
                  { icon: Network, text: 'Wikilinks with backlink references' },
                  { icon: Sparkles, text: 'Interactive knowledge graph visualization' },
                  { icon: PenTool, text: 'Embedded drawing whiteboards' },
                ].map(({ icon: ItemIcon, text }) => (
                  <li key={text} className="flex items-start gap-3 text-sm">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted">
                      <ItemIcon className="h-3 w-3 text-foreground" />
                    </div>
                    <span className="text-muted-foreground">{text}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Pages mockup */}
            <Card className="overflow-hidden rounded-2xl">
              <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                <div className="h-2.5 w-16 rounded bg-foreground/[0.08]" />
                <div className="mx-auto h-2.5 w-40 rounded bg-primary/20" />
                <div className="h-2.5 w-12 rounded bg-muted" />
              </div>
              <div className="p-6 sm:p-8 space-y-3.5">
                <div className="h-7 w-2/3 rounded bg-foreground/[0.08]" />
                <div className="h-3 w-full rounded bg-muted" />
                <div className="h-3 w-5/6 rounded bg-muted" />
                <div className="h-3 w-4/6 rounded bg-muted" />
                <div className="my-4 rounded-xl border border-border bg-muted/50 p-4">
                  <div className="h-3 w-20 rounded bg-foreground/[0.1]" />
                  <div className="mt-2.5 h-2.5 w-full rounded bg-muted" />
                  <div className="mt-2 h-2.5 w-4/5 rounded bg-muted" />
                </div>
                <div className="h-3 w-full rounded bg-muted" />
                <div className="h-3 w-3/4 rounded bg-muted" />
                <Badge variant="outline" className="gap-1.5 text-xs">
                  <FileText className="h-3 w-3" />
                  linked-page
                </Badge>
                <div className="h-3 w-5/6 rounded bg-muted" />
              </div>
            </Card>
          </div>
        </div>
      </section>

      <Separator />

      {/* ── Why Atur ── */}
      <section className="relative py-24 sm:py-32">
        <div className="grid-lines pointer-events-none absolute inset-0" />
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Why Atur
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
              Built different
            </h2>
            <p className="mt-4 text-muted-foreground">
              Most PM tools need a DevOps team to deploy. We don&apos;t.
            </p>
          </div>

          <div className="mx-auto mt-16 grid max-w-4xl gap-6 sm:grid-cols-2">
            {[
              {
                icon: Cpu,
                title: 'Single Binary',
                desc: 'No containers, no orchestration. Download, run, done. Runs on a Raspberry Pi.',
              },
              {
                icon: Shield,
                title: 'Self-Hosted',
                desc: 'Your data stays on your infrastructure. No third-party servers, no surprises.',
              },
              {
                icon: Zap,
                title: 'Blazing Fast',
                desc: 'Rust + SQLite means sub-millisecond responses. Your team never waits.',
              },
              {
                icon: Bot,
                title: 'AI-Native',
                desc: '35+ MCP tools let AI agents create issues, manage sprints, and update pages.',
              },
            ].map(({ icon: CardIcon, title, desc }) => (
              <Card key={title} className="transition-colors hover:border-foreground/20">
                <CardContent className="p-7">
                  <CardIcon className="h-5 w-5 text-foreground" />
                  <h3 className="mt-4 text-base font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <Separator />

      {/* ── Pricing ── */}
      <section id="pricing" className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Pricing
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
              Simple, affordable pricing
            </h2>
            <p className="mt-4 text-muted-foreground">
              No per-seat charges. No feature gates. One price, everything included.
            </p>
          </div>

          <div className="mx-auto mt-14 grid max-w-3xl gap-6 sm:grid-cols-2">
            {/* Self-Hosted */}
            <Card className="flex flex-col p-8">
              <h3 className="text-base font-semibold">Self-Hosted</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-5xl font-extrabold">$9</span>
                <span className="text-sm text-muted-foreground">/month</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Host it yourself. Full control, your infrastructure.
              </p>
              <ul className="mt-6 space-y-3 flex-1">
                {[
                  'Unlimited projects & issues',
                  'All 35+ MCP tools',
                  'Pages & knowledge graph',
                  'Drawing whiteboards',
                  'Mobile apps (iOS & Android)',
                  'Email support',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <Check className="h-4 w-4 shrink-0 text-foreground" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate('/auth/login')}
                className="mt-8 w-full"
              >
                Start Free Trial
              </Button>
            </Card>

            {/* Managed */}
            <Card className="relative flex flex-col p-8 border-foreground/20">
              <Badge className="absolute -top-3 right-6 rounded-full">
                Popular
              </Badge>
              <h3 className="text-base font-semibold">Managed Cloud</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-5xl font-extrabold">$29</span>
                <span className="text-sm text-muted-foreground">/month</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                We handle hosting. You handle projects.
              </p>
              <ul className="mt-6 space-y-3 flex-1">
                {[
                  'Everything in Self-Hosted',
                  'Managed infrastructure',
                  'Automatic backups',
                  'Custom domain support',
                  'Priority support',
                  'Team onboarding assistance',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <Check className="h-4 w-4 shrink-0 text-foreground" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button
                size="lg"
                onClick={() => navigate('/auth/login')}
                className="mt-8 w-full"
              >
                Start Free Trial
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Card>
          </div>

          <p className="mt-8 text-center text-sm text-muted-foreground/50">
            14-day free trial on all plans. No credit card required.
          </p>
        </div>
      </section>

      <Separator />

      {/* ── Final CTA ── */}
      <section className="relative py-24 sm:py-32 overflow-hidden">
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">
              Ready to ship faster?
            </h2>
            <p className="mt-5 text-lg text-muted-foreground">
              Deploy in minutes. Manage with confidence. Scale without surprises.
            </p>
            <div className="mt-10">
              <Button
                size="lg"
                onClick={() => navigate('/auth/login')}
                className="px-8 h-12 text-base"
              >
                Get Started Now
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* ── Footer ── */}
      <footer className="py-10">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-2.5">
              <img src="/logo-128.png" alt="" className="h-7 w-7 rounded-md border border-border" />
              <span className="text-sm font-medium">Atur</span>
            </div>

            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <button onClick={() => scrollTo('features')} className="hover:text-foreground transition-colors">Features</button>
              <button onClick={() => scrollTo('pages')} className="hover:text-foreground transition-colors">Pages</button>
              <button onClick={() => scrollTo('pricing')} className="hover:text-foreground transition-colors">Pricing</button>
            </div>

            <p className="text-sm text-muted-foreground/50">
              &copy; 2026 Atur
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
