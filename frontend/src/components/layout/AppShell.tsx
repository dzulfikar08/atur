import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import BottomNav from '@/components/mobile/BottomNav';
import CommandPalette from './CommandPalette';
import { api } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspace';

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);

  // Ensure workspaces are loaded for sidebar/bottom-nav switchers
  useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => {
      const ws = await api.listWorkspaces();
      useWorkspaceStore.getState().setWorkspaces(ws);
      return ws;
    },
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <div className="hidden md:block shrink-0">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </div>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />

        {/* Page content - with bottom padding on mobile for bottom nav */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8 pb-20 md:pb-6 lg:pb-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <BottomNav />

      {/* Command palette (Cmd+K) */}
      <CommandPalette />
    </div>
  );
}
