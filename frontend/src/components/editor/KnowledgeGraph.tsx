import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type XYPosition,
} from '@xyflow/react';
import type { NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, type Page } from '@/lib/api';
import { useThemeStore } from '@/stores/theme';
import { FileText, PenTool, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageGraphData {
  label: string;
  pageId: string;
  isDrawing: boolean;
  linkCount: number;
}

function getPageData(node: Node): PageGraphData {
  return node.data as unknown as PageGraphData;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

function fetchPages(slug: string) {
  return apiFetch<{ results: Page[] }>(`/workspaces/${slug}/pages/`).then(
    (r) => r.results
  );
}

/**
 * Scan page descriptions for [[page-name]] wikilinks.
 * Returns a map of pageId -> array of linked page names.
 */
function extractWikilinks(pages: Page[]): Map<string, string[]> {
  const linkMap = new Map<string, string[]>();
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g;

  for (const page of pages) {
    const links: string[] = [];
    const text = page.description_html || '';
    let match: RegExpExecArray | null;
    const regex = new RegExp(wikilinkRegex.source, wikilinkRegex.flags);
    while ((match = regex.exec(text)) !== null) {
      links.push(match[1]);
    }
    if (links.length > 0) {
      linkMap.set(page.id, links);
    }
  }

  return linkMap;
}

// ---------------------------------------------------------------------------
// Force-directed layout (simple simulation)
// ---------------------------------------------------------------------------

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function computeForceLayout(
  nodeIds: string[],
  edges: Array<{ source: string; target: string }>,
  width: number,
  height: number
): Map<string, XYPosition> {
  const centerX = width / 2;
  const centerY = height / 2;
  const linkCount = new Map<string, number>();

  for (const id of nodeIds) linkCount.set(id, 0);
  for (const e of edges) {
    linkCount.set(e.source, (linkCount.get(e.source) || 0) + 1);
    linkCount.set(e.target, (linkCount.get(e.target) || 0) + 1);
  }

  // Initialize positions: most-linked nodes near center
  const simNodes: SimNode[] = nodeIds.map((id, i) => {
    const links = linkCount.get(id) || 0;
    const angle = (2 * Math.PI * i) / nodeIds.length;
    const radius = links === 0 ? 300 : Math.max(80, 250 - links * 30);
    return {
      id,
      x: centerX + radius * Math.cos(angle) + (Math.random() - 0.5) * 40,
      y: centerY + radius * Math.sin(angle) + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
    };
  });

  const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

  // Run simulation iterations
  const iterations = 120;
  const repulsionStrength = 8000;
  const attractionStrength = 0.005;
  const centerGravity = 0.01;
  const damping = 0.85;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;

    // Repulsion between all nodes
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i];
        const b = simNodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (repulsionStrength * alpha) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = dist * attractionStrength * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    // Center gravity
    for (const node of simNodes) {
      node.vx += (centerX - node.x) * centerGravity * alpha;
      node.vy += (centerY - node.y) * centerGravity * alpha;
    }

    // Apply velocities
    for (const node of simNodes) {
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  const positions = new Map<string, XYPosition>();
  for (const node of simNodes) {
    positions.set(node.id, { x: node.x, y: node.y });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Custom Node Component
// ---------------------------------------------------------------------------

function PageNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PageGraphData;
  const isDrawing = d.isDrawing;
  const truncated =
    d.label.length > 22 ? d.label.slice(0, 20) + '...' : d.label;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background shadow-sm cursor-pointer hover:shadow-md hover:border-primary/40 transition-all"
      style={{ width: 180, height: 40 }}
      title={d.label}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: 'transparent', border: 'none', width: 0, height: 0 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: 'transparent', border: 'none', width: 0, height: 0 }}
      />
      {isDrawing ? (
        <PenTool className="h-3.5 w-3.5 shrink-0 text-orange-500" />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="text-xs font-medium truncate text-foreground">
        {truncated}
      </span>
      {d.linkCount > 0 && (
        <span className="ml-auto text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 shrink-0">
          {d.linkCount}
        </span>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  page: PageNodeComponent,
};

// ---------------------------------------------------------------------------
// Main KnowledgeGraph Component
// ---------------------------------------------------------------------------

interface KnowledgeGraphProps {
  slug: string;
}

export default function KnowledgeGraph({ slug }: KnowledgeGraphProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 });
  const { theme } = useThemeStore();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const { data: pages = [], isLoading } = useQuery({
    queryKey: ['pages', slug],
    queryFn: () => fetchPages(slug),
    enabled: !!slug,
  });

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width || 900,
          height: entry.contentRect.height || 600,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Build graph data
  const { nodes: initialNodes, edges: initialEdges, layoutKey } = useMemo(() => {
    if (pages.length === 0) return { nodes: [], edges: [], layoutKey: '' };

    const linkMap = extractWikilinks(pages);
    const nameToId = new Map<string, string>();
    for (const p of pages) {
      nameToId.set(p.name.toLowerCase(), p.id);
    }

    // Count links per page
    const pageLinkCount = new Map<string, number>();
    for (const p of pages) pageLinkCount.set(p.id, 0);

    // Build edges
    const edgesList: Edge[] = [];
    const edgeSourceTargets: Array<{ source: string; target: string }> = [];
    const edgeSet = new Set<string>();

    for (const [pageId, links] of linkMap.entries()) {
      for (const linkName of links) {
        const targetId = nameToId.get(linkName.toLowerCase());
        if (targetId && targetId !== pageId) {
          const edgeKey = `${pageId}->${targetId}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edgesList.push({
              id: edgeKey,
              source: pageId,
              target: targetId,
              type: 'smoothstep',
              animated: true,
              style: {
                stroke: isDark ? '#475569' : '#94a3b8',
                strokeWidth: 1.5,
              },
            });
            edgeSourceTargets.push({
              source: pageId,
              target: targetId,
            });
            pageLinkCount.set(
              pageId,
              (pageLinkCount.get(pageId) || 0) + 1
            );
            pageLinkCount.set(
              targetId,
              (pageLinkCount.get(targetId) || 0) + 1
            );
          }
        }
      }
    }

    // Compute layout
    const nodeIds = pages.map((p) => p.id);
    const positions = computeForceLayout(
      nodeIds,
      edgeSourceTargets,
      dimensions.width,
      dimensions.height
    );

    const nodesList: Node[] = pages.map((p) => {
      const pos = positions.get(p.id) || { x: 0, y: 0 };
      const isDrawing = p.is_drawing ?? false;
      const descJson = p.description_json as Record<string, unknown> | null;
      const hasTldraw =
        isDrawing ||
        (descJson != null &&
          typeof descJson === 'object' &&
          ('tldraw' in descJson || 'shapes' in descJson));

      return {
        id: p.id,
        type: 'page',
        position: pos,
        data: {
          label: p.name || 'Untitled',
          pageId: p.id,
          isDrawing: hasTldraw,
          linkCount: pageLinkCount.get(p.id) || 0,
        },
      };
    });

    return {
      nodes: nodesList,
      edges: edgesList,
      layoutKey: pages.map((p) => p.id).join(','),
    };
  }, [pages, dimensions.width, dimensions.height, isDark]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const d = getPageData(node);
      navigate(`/${slug}/pages/${d.pageId}`);
    },
    [navigate, slug]
  );

  // MiniMap node color
  const miniMapNodeColor = useCallback(
    (node: Node) => {
      const d = getPageData(node);
      if (d.isDrawing) return '#f97316';
      return isDark ? '#64748b' : '#cbd5e1';
    },
    [isDark]
  );

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const hasLinks = initialEdges.length > 0;

  return (
    <div className="flex flex-col flex-1 overflow-hidden" ref={containerRef}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/${slug}/pages`)}
        >
          Back to Pages
        </Button>
        <div className="h-4 w-px bg-border" />
        <Network className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Knowledge Graph</h1>
        <span className="text-xs text-muted-foreground">
          {pages.length} pages, {initialEdges.length} links
        </span>
      </div>

      {/* Graph area */}
      {!hasLinks && pages.length > 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-sm text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Network className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">No Links Found</h2>
              <p className="text-sm text-muted-foreground">
                Add wikilinks using [[page-name]] syntax in your page
                descriptions to build the knowledge graph.
              </p>
            </div>
          </div>
        </div>
      ) : pages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-sm text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">No Pages Yet</h2>
              <p className="text-sm text-muted-foreground">
                Create some pages first to visualize their connections.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex-1"
          style={{ background: isDark ? '#0f172a' : '#f8fafc' }}
        >
          <ReactFlow
            key={layoutKey}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.1}
            maxZoom={2}
            style={{ background: 'transparent' }}
          >
            <Controls
              showInteractive={false}
              style={{
                background: isDark ? '#1e293b' : '#ffffff',
                borderColor: isDark ? '#334155' : '#e2e8f0',
                borderRadius: 8,
              }}
            />
            <MiniMap
              nodeColor={miniMapNodeColor}
              maskColor={isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.1)'}
              style={{
                background: isDark ? '#1e293b' : '#ffffff',
                borderColor: isDark ? '#334155' : '#e2e8f0',
                borderRadius: 8,
              }}
            />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}
