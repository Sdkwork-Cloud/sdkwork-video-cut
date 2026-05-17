import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  LayoutGrid,
  FolderOpen,
  Folder,
  CheckSquare,
  MessageSquare,
  Settings,
  Scissors,
  Check,
  User,
  Crown,
} from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  getActiveAutoCutLocale,
  getAutoCutI18nText,
  getMessages,
  listenAutoCutEvent,
  listenAutoCutI18nLanguageChanged,
} from '@sdkwork/autocut-services';

type SidebarIconProps = LucideProps & { size: number };

type SidebarItem = {
  label: string;
  path: string;
  icon: LucideIcon;
  activeIcon: ComponentType<SidebarIconProps>;
  badge?: number | null;
};

export function AppLayout() {
  const [, setActiveLocale] = useState(getActiveAutoCutLocale());
  const [unreadMessages, setUnreadMessages] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUnread = () => {
      getMessages().then((msgs) => {
        setUnreadMessages(msgs.filter((message) => !message.read).length);
      });
    };
    fetchUnread();
    const stopMessageAdded = listenAutoCutEvent('messageAdded', fetchUnread);
    const stopMessagesUpdated = listenAutoCutEvent('messagesUpdated', fetchUnread);
    return () => {
      stopMessageAdded();
      stopMessagesUpdated();
    };
  }, []);

  useEffect(() => listenAutoCutI18nLanguageChanged(() => {
    setActiveLocale(getActiveAutoCutLocale());
  }), []);

  const t = getAutoCutI18nText;

  const sidebarItems: SidebarItem[] = [
    {
      label: t('layout.sidebar.home'),
      path: '/',
      icon: Home,
      activeIcon: (props: SidebarIconProps) => (
        <Home {...props} fill="currentColor" stroke="none" />
      ),
    },
    {
      label: t('layout.sidebar.tools'),
      path: '/tools',
      icon: LayoutGrid,
      activeIcon: (props: SidebarIconProps) => (
        <LayoutGrid {...props} fill="currentColor" stroke="none" />
      ),
    },
    {
      label: t('layout.sidebar.assets'),
      path: '/assets',
      icon: FolderOpen,
      activeIcon: (props: SidebarIconProps) => (
        <Folder {...props} fill="currentColor" stroke="none" />
      ),
    },
    {
      label: t('layout.sidebar.tasks'),
      path: '/tasks',
      icon: CheckSquare,
      activeIcon: (props: SidebarIconProps) => (
        <div
          className="relative flex items-center justify-center"
          style={{
            width: props.size,
            height: props.size,
            marginBottom: props.className?.includes('mb-1') ? '0.25rem' : '0',
          }}
        >
          <div className="absolute inset-[3px] rounded-md bg-blue-500" />
          <Check
            size={props.size * 0.6}
            strokeWidth={4}
            className="relative z-10 mt-[1px] text-[#050505]"
          />
        </div>
      ),
    },
    {
      label: t('layout.sidebar.messages'),
      path: '/messages',
      icon: MessageSquare,
      activeIcon: (props: SidebarIconProps) => (
        <MessageSquare {...props} fill="currentColor" stroke="none" />
      ),
      badge: unreadMessages > 0 ? unreadMessages : null,
    },
  ];

  return (
    <div className="flex h-screen w-full select-none overflow-hidden bg-[#0A0A0A] font-sans text-gray-200">
      <aside className="z-20 flex h-full w-16 shrink-0 flex-col items-center border-r border-[#151515] bg-[#050505] py-5 shadow-2xl">
        <div className="flex w-full flex-1 flex-col items-center gap-8">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/20 bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-[0_4px_15px_rgba(59,130,246,0.3)]">
            <Scissors size={22} />
          </div>

          <nav className="flex w-full flex-col items-center gap-5">
            {sidebarItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                title={item.label}
                className="flex w-full justify-center py-2"
              >
                {({ isActive }) => {
                  let actuallyActive = isActive;
                  if (item.path === '/tools') {
                    if (
                      location.pathname !== '/' &&
                      !['/assets', '/tasks', '/messages'].some((path) => location.pathname.startsWith(path))
                    ) {
                      actuallyActive = true;
                    }
                  }
                  const IconComponent = actuallyActive ? item.activeIcon : item.icon;
                  return (
                    <div
                      className={`group relative flex cursor-pointer flex-col items-center gap-1.5 transition-all ${
                        actuallyActive
                          ? 'scale-105 text-blue-500 opacity-100'
                          : 'text-gray-400 opacity-70 hover:scale-105 hover:text-gray-200'
                      }`}
                    >
                      <div className="relative">
                        <IconComponent
                          size={24}
                          className="mb-0.5 drop-shadow-sm transition-all"
                          strokeWidth={actuallyActive ? 2.5 : 2}
                        />
                        {item.badge !== null && item.badge !== undefined && (
                          <div className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[#050505] bg-red-500 text-[9px] font-bold text-white shadow-sm">
                            {item.badge}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] font-medium tracking-wide">{item.label}</span>

                      {actuallyActive && (
                        <div className="absolute -left-[14px] top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                      )}
                    </div>
                  );
                }}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="mt-auto flex flex-col items-center gap-6">
          <button
            onClick={() => navigate('/settings?tab=billing')}
            className={`group relative flex cursor-pointer flex-col items-center gap-1.5 transition-all ${
              location.pathname === '/settings' && location.search.includes('tab=billing')
                ? 'scale-105 text-yellow-500 opacity-100'
                : 'text-yellow-500/60 opacity-70 hover:scale-105 hover:text-yellow-400 hover:opacity-100'
            }`}
            title={t('layout.sidebar.billingPro')}
          >
            <Crown
              size={22}
              className="drop-shadow-[0_0_8px_rgba(234,179,8,0.5)] transition-transform duration-300 group-hover:-translate-y-1"
            />
            <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-500/80 shadow-sm group-hover:text-yellow-400">
              VIP
            </span>
          </button>

          <button
            onClick={() => navigate('/settings')}
            className={`group flex cursor-pointer flex-col items-center gap-1.5 transition-all ${
              location.pathname === '/settings'
                ? 'text-blue-500 opacity-100'
                : 'text-gray-400 opacity-60 hover:text-white hover:opacity-100'
            }`}
            title={t('layout.sidebar.settings')}
          >
            <Settings size={22} className="transition-transform duration-300 group-hover:rotate-45" />
          </button>

          <button
            onClick={() => navigate('/settings')}
            title={t('layout.sidebar.account')}
            className="group flex h-9 w-9 items-center justify-center rounded-full border border-[#444] bg-gradient-to-tr from-[#222] to-[#333] text-gray-300 shadow-md transition-all hover:border-blue-500 hover:text-white"
          >
            <User size={18} className="transition-transform group-hover:scale-110" />
          </button>
        </div>
      </aside>

      <main className="flex h-full min-w-0 flex-1 flex-col bg-[#111]">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-[#1A1A1A] bg-[#080808]/80 px-6 backdrop-blur-md">
          <h1 className="flex items-center gap-3 text-[13px] font-semibold uppercase tracking-wider text-gray-100">
            <div className="relative flex items-center justify-center">
              <span className="absolute h-2 w-2 animate-ping rounded-full bg-blue-500 opacity-60" />
              <span className="relative z-10 h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
            </div>
            SDKWork Autocut Pro
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 rounded border border-green-500/20 bg-green-500/10 px-2 py-1 font-mono text-[10px] font-bold tracking-wider text-green-400 shadow-inner">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              {t('layout.status.ready')}
            </div>
            <div className="font-mono text-[11px] tracking-wider text-gray-500">v1.2.4</div>
          </div>
        </header>

        <div className="relative flex flex-1 flex-col overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
