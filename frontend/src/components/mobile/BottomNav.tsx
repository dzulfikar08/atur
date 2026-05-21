import { NavLink, useParams } from 'react-router-dom';
import { LayoutDashboard, FolderKanban, CircleDot, Search, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { to: '', icon: LayoutDashboard, label: 'Home' },
  { to: 'projects', icon: FolderKanban, label: 'Projects' },
  { to: 'issues', icon: CircleDot, label: 'Issues' },
  { to: 'search', icon: Search, label: 'Search' },
  { to: 'me', icon: User, label: 'Profile' },
];

export default function BottomNav() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-bottom">
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const targetPath = `/${slug}/${tab.to}`.replace(/\/$/, '');
          return (
            <NavLink
              key={tab.to || 'home'}
              to={targetPath}
              end={tab.to === ''}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground'
                )
              }
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
