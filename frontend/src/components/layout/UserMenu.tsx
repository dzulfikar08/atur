import { useNavigate, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useAuthStore } from '@/stores/auth';
import { Sun, Moon, Monitor } from '@/lib/icons';
import { useThemeStore } from '@/stores/theme';

interface UserMenuProps {
  showThemeOptions?: boolean;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Custom trigger node. Defaults to a round avatar button. */
  trigger?: ReactNode;
}

export default function UserMenu({ showThemeOptions = false, side = 'bottom', align = 'end', trigger }: UserMenuProps) {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { setTheme } = useThemeStore();

  const initials = user?.display_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? 'U';

  const goToProfile = () => {
    if (slug) navigate(`/${slug}/me`);
  };

  const defaultTrigger = (
    <Button variant="ghost" aria-label="Account menu" className="h-8 w-8 rounded-full p-0">
      <Avatar className="h-8 w-8">
        {user?.avatar ? <AvatarImage src={user.avatar} alt={user.display_name ?? 'User'} /> : null}
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
    </Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger ?? defaultTrigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-48">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{user?.display_name ?? 'User'}</p>
          <p className="text-xs text-muted-foreground">{user?.email ?? ''}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={goToProfile}>Profile & Settings</DropdownMenuItem>
        {showThemeOptions && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <p className="text-xs text-muted-foreground mb-1">Theme</p>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-xs flex-1" onClick={() => setTheme('light')}>
                  <Sun className="h-3 w-3 mr-1" /> Light
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs flex-1" onClick={() => setTheme('dark')}>
                  <Moon className="h-3 w-3 mr-1" /> Dark
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs flex-1" onClick={() => setTheme('system')}>
                  <Monitor className="h-3 w-3 mr-1" /> System
                </Button>
              </div>
            </div>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
