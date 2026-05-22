import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Zap,
  LayoutDashboard,
  FileText,
  PenTool,
  Smartphone,
  Bot,
  ArrowRight,
  Check,
  X,
  Menu,
  Star,
} from 'lucide-react';
import { useState } from 'react';

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Pages', href: '#pages' },
  { label: 'Open Source', href: '#opensource' },
];

const features = [
  {
    icon: Zap,
    title: 'Lightning Fast',
    description: 'Built with Rust and SQLite. Runs on 50MB RAM.',
  },
  {
    icon: LayoutDashboard,
    title: 'Kanban Board',
    description: 'Drag-and-drop issue management with custom states.',
  },
  {
    icon: FileText,
    title: 'Obsidian-like Pages',
    description:
      'Rich text pages with wikilinks, backlinks, and knowledge graph.',
  },
  {
    icon: PenTool,
    title: 'Drawing Canvas',
    description: 'Embed tldraw whiteboards directly in your pages.',
  },
  {
    icon: Smartphone,
    title: 'Mobile First',
    description: 'Native iOS/Android apps built with Capacitor.',
  },
  {
    icon: Bot,
    title: 'AI-Powered',
    description: 'MCP server for AI agent integration.',
  },
];

const comparisonData = [
  { metric: 'RAM Usage', pmo: '50 MB', traditional: '3 GB+', pmoGood: true },
  {
    metric: 'Deployment',
    pmo: '1 Binary',
    traditional: '10+ Containers',
    pmoGood: true,
  },
  {
    metric: 'Tech Stack',
    pmo: 'Rust + SQLite',
    traditional: 'Python + PostgreSQL + Redis',
    pmoGood: true,
  },
  {
    metric: 'Startup Time',
    pmo: '< 1 second',
    traditional: '30+ seconds',
    pmoGood: true,
  },
  {
    metric: 'Self-Hosted',
    pmo: 'Yes',
    traditional: 'Complicated',
    pmoGood: true,
  },
  {
    metric: 'Open Source',
    pmo: 'MIT License',
    traditional: 'Source-Available',
    pmoGood: true,
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Ensure dark class is on html for the landing page
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('dark');
    // Also update the title
    document.title = 'Plane PMO — Self-Hosted Project Management';
    return () => {
      html.classList.remove('dark');
    };
  }, []);

  const handleSmoothScroll = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    const el = document.querySelector(href);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* ── Navbar ── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          {/* Logo */}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="flex items-center gap-2.5 text-foreground"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500">
              <span className="text-sm font-bold text-white">P</span>
            </div>
            <span className="text-lg font-semibold tracking-tight">
              Plane PMO
            </span>
          </a>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => handleSmoothScroll(e, link.href)}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              asChild
            >
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                <GithubIcon className="h-4 w-4" />
                GitHub
              </a>
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/auth/login')}
              className="bg-gradient-to-r from-violet-500 to-blue-500 text-white hover:opacity-90"
            >
              Get Started
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 text-muted-foreground hover:text-foreground"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-background px-4 pb-4 pt-2">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => handleSmoothScroll(e, link.href)}
                className="block py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-3 flex flex-col gap-2">
              <Button
                size="sm"
                variant="outline"
                asChild
              >
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GithubIcon className="h-4 w-4" />
                  GitHub
                </a>
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate('/auth/login');
                }}
                className="bg-gradient-to-r from-violet-500 to-blue-500 text-white hover:opacity-90"
              >
                Get Started
              </Button>
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28">
        {/* Background gradient orbs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-gradient-to-br from-violet-600/20 to-blue-600/20 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-xs text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
              Open Source &middot; Self-Hosted
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
              Project Management,{' '}
              <span className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
                Self-Hosted
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground sm:text-xl">
              Rust-powered speed meets modern project management. Issues, sprints, pages, and
              whiteboards -- all in one lightweight binary.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                onClick={() => navigate('/auth/login')}
                className="w-full bg-gradient-to-r from-violet-500 to-blue-500 text-white hover:opacity-90 sm:w-auto"
              >
                Start Free
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                asChild
                className="w-full sm:w-auto"
              >
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GithubIcon className="h-4 w-4" />
                  View on GitHub
                </a>
              </Button>
            </div>
          </div>

          {/* Mockup / screenshot placeholder */}
          <div className="relative mx-auto mt-16 max-w-4xl">
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-violet-500/5">
              {/* Window chrome */}
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-500/70" />
                  <div className="h-3 w-3 rounded-full bg-yellow-500/70" />
                  <div className="h-3 w-3 rounded-full bg-green-500/70" />
                </div>
                <div className="mx-auto flex h-6 w-64 items-center justify-center rounded-md bg-muted/50 text-[11px] text-muted-foreground">
                  app.plane-pmo.dev
                </div>
              </div>

              {/* Wireframe content */}
              <div className="flex h-72 sm:h-96">
                {/* Sidebar */}
                <div className="hidden w-48 flex-col border-r border-border bg-muted/20 p-4 sm:flex">
                  <div className="mb-4 h-4 w-24 rounded bg-violet-500/20" />
                  <div className="space-y-2.5">
                    <div className="h-3 w-28 rounded bg-muted-foreground/15" />
                    <div className="h-3 w-20 rounded bg-violet-500/30" />
                    <div className="h-3 w-24 rounded bg-muted-foreground/15" />
                    <div className="h-3 w-16 rounded bg-muted-foreground/15" />
                    <div className="h-3 w-28 rounded bg-muted-foreground/15" />
                  </div>
                  <div className="mt-auto space-y-2.5">
                    <div className="h-3 w-20 rounded bg-muted-foreground/10" />
                    <div className="h-3 w-16 rounded bg-muted-foreground/10" />
                  </div>
                </div>
                {/* Main area */}
                <div className="flex-1 p-4 sm:p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="h-5 w-32 rounded bg-foreground/20" />
                    <div className="h-8 w-24 rounded-md bg-gradient-to-r from-violet-500/30 to-blue-500/30" />
                  </div>
                  {/* Kanban columns */}
                  <div className="grid grid-cols-3 gap-3 sm:gap-4">
                    {['Backlog', 'In Progress', 'Done'].map((col, i) => (
                      <div key={col}>
                        <div className="mb-2 text-[10px] font-medium text-muted-foreground/60 sm:text-xs">
                          {col}
                        </div>
                        <div className="space-y-2">
                          {[1, 2].map((card) => (
                            <div
                              key={card}
                              className="rounded-lg border border-border bg-background p-2.5 sm:p-3"
                            >
                              <div className="mb-1.5 h-2.5 w-3/4 rounded bg-foreground/15" />
                              <div className="h-2 w-1/2 rounded bg-muted-foreground/10" />
                              {i === 1 && card === 1 && (
                                <div className="mt-2 h-1.5 w-2/3 rounded-full bg-gradient-to-r from-violet-500/40 to-blue-500/40" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Glow effect under mockup */}
            <div className="pointer-events-none absolute -bottom-8 left-1/2 h-32 w-3/4 -translate-x-1/2 bg-gradient-to-r from-violet-600/10 to-blue-600/10 blur-2xl" />
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-violet-400">
              Features
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need, nothing you don&apos;t
            </h2>
            <p className="mt-4 text-muted-foreground">
              A full project management toolkit in a single lightweight binary.
            </p>
          </div>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="group rounded-xl border border-border bg-card p-6 transition-all hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/5"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/10 to-blue-500/10 text-violet-400 transition-colors group-hover:from-violet-500/20 group-hover:to-blue-500/20">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pages / Knowledge Graph section ── */}
      <section id="pages" className="py-20 sm:py-28 border-t border-border">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-blue-400">
                Knowledge Base
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                Pages that connect your thinking
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Write documentation, meeting notes, and specs with an Obsidian-inspired editor.
                Use <code className="rounded bg-muted px-1.5 py-0.5 text-sm">[[wikilinks]]</code> to
                connect pages, then explore everything through an interactive knowledge graph.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  'Rich text with slash commands and callouts',
                  'Wikilinks with backlink references',
                  'Interactive knowledge graph visualization',
                  'Embedded tldraw whiteboards',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Pages mockup */}
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <div className="h-2.5 w-20 rounded bg-muted-foreground/20" />
                <div className="ml-auto h-2.5 w-16 rounded bg-violet-500/20" />
              </div>
              <div className="p-5 sm:p-6 space-y-3">
                <div className="h-6 w-2/3 rounded bg-foreground/20" />
                <div className="h-3 w-full rounded bg-muted-foreground/10" />
                <div className="h-3 w-5/6 rounded bg-muted-foreground/10" />
                <div className="h-3 w-4/6 rounded bg-muted-foreground/10" />
                <div className="my-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                  <div className="h-3 w-24 rounded bg-violet-400/30" />
                  <div className="mt-2 h-2.5 w-full rounded bg-muted-foreground/8" />
                </div>
                <div className="h-3 w-full rounded bg-muted-foreground/10" />
                <div className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-xs text-blue-400">
                  <FileText className="h-3 w-3" />
                  linked-page
                </div>
                <div className="h-3 w-3/4 rounded bg-muted-foreground/10" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Resource Comparison ── */}
      <section className="py-20 sm:py-28 border-t border-border">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-green-400">
              Lightweight
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Plane PMO vs Traditional PM Tools
            </h2>
          </div>

          <div className="mx-auto mt-14 max-w-3xl overflow-hidden rounded-xl border border-border">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                    Metric
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-violet-400">
                    Plane PMO
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                    Traditional Tools
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.map(({ metric, pmo, traditional }) => (
                  <tr
                    key={metric}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3 text-sm font-medium">{metric}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-400">
                        <Check className="h-3.5 w-3.5" />
                        {pmo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <X className="h-3.5 w-3.5 text-red-400/60" />
                        {traditional}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Open Source ── */}
      <section id="opensource" className="py-20 sm:py-28 border-t border-border">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <GithubIcon className="h-7 w-7" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Open Source &amp; Community Driven
            </h2>
            <p className="mt-4 text-muted-foreground">
              Plane PMO is MIT licensed and built in the open. Contribute, fork,
              or self-host with complete freedom.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-4 py-2 text-sm">
                <Star className="h-4 w-4 text-yellow-500" />
                <span>Star us on GitHub</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-4 py-2 text-sm">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                MIT License
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-4 py-2 text-sm">
                <span className="font-mono text-xs">Rust + React</span>
              </div>
            </div>

            <div className="mt-10">
              <Button
                size="lg"
                variant="outline"
                asChild
              >
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GithubIcon className="h-4 w-4" />
                  Fork on GitHub
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative py-20 sm:py-28 border-t border-border">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute bottom-0 left-1/2 h-96 w-[600px] -translate-x-1/2 bg-gradient-to-t from-violet-600/10 to-transparent blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Start managing projects{' '}
              <span className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
                the simple way
              </span>
            </h2>
            <p className="mt-4 text-muted-foreground">
              Deploy in minutes. Manage with confidence. Ship faster.
            </p>
            <div className="mt-8">
              <Button
                size="lg"
                onClick={() => navigate('/auth/login')}
                className="bg-gradient-to-r from-violet-500 to-blue-500 text-white hover:opacity-90"
              >
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-blue-500">
                <span className="text-xs font-bold text-white">P</span>
              </div>
              <span className="text-sm font-medium">Plane PMO</span>
            </div>

            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a
                href="#features"
                onClick={(e) => handleSmoothScroll(e, '#features')}
                className="hover:text-foreground transition-colors"
              >
                Features
              </a>
              <a
                href="#pages"
                onClick={(e) => handleSmoothScroll(e, '#pages')}
                className="hover:text-foreground transition-colors"
              >
                Pages
              </a>
              <a
                href="#opensource"
                onClick={(e) => handleSmoothScroll(e, '#opensource')}
                className="hover:text-foreground transition-colors"
              >
                Open Source
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                GitHub
              </a>
            </div>

            <p className="text-sm text-muted-foreground">
              &copy; 2025 Plane PMO. Built with Rust + React.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
