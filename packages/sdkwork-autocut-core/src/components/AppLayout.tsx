import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
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
  Crown
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import { getMessages, listenAutoCutEvent } from "@sdkwork/autocut-services";

type SidebarIconProps = LucideProps & { size: number };

export function AppLayout() {
  const [unreadMessages, setUnreadMessages] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUnread = () => {
      getMessages().then(msgs => {
        setUnreadMessages(msgs.filter(m => !m.read).length);
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

  const SIDEBAR_ITEMS = [
    {
      label: "首页",
      path: "/",
      icon: Home,
      activeIcon: (props: SidebarIconProps) => (
        <Home {...props} fill="currentColor" stroke="none" />
      )
    },
    {
      label: "工具",
      path: "/tools",
      icon: LayoutGrid,
      activeIcon: (props: SidebarIconProps) => (
        <LayoutGrid {...props} fill="currentColor" stroke="none" />
      )
    },
    {
      label: "资产",
      path: "/assets",
      icon: FolderOpen,
      activeIcon: (props: SidebarIconProps) => (
        <Folder {...props} fill="currentColor" stroke="none" />
      )
    },
    {
      label: "任务",
      path: "/tasks",
      icon: CheckSquare,
      activeIcon: (props: SidebarIconProps) => (
        <div className="relative flex items-center justify-center" style={{ width: props.size, height: props.size, marginBottom: props.className?.includes('mb-1') ? '0.25rem' : '0' }}>
          <div className="absolute inset-[3px] bg-blue-500 rounded-md" />
          <Check size={props.size * 0.6} strokeWidth={4} className="text-[#050505] relative z-10 mt-[1px]" />
        </div>
      )
    },
    {
      label: "消息",
      path: "/messages",
      icon: MessageSquare,
      activeIcon: (props: SidebarIconProps) => (
        <MessageSquare {...props} fill="currentColor" stroke="none" />
      ),
      badge: unreadMessages > 0 ? unreadMessages : null
    },
  ];

  return (
    <div className="flex w-full h-screen bg-[#0A0A0A] text-gray-200 font-sans overflow-hidden select-none">
      {/* Sidebar */}
      <aside className="w-16 h-full flex flex-col items-center py-5 bg-[#050505] border-r border-[#151515] shrink-0 z-20 shadow-2xl">
        <div className="flex flex-col gap-8 flex-1 w-full items-center">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white mb-2 shadow-[0_4px_15px_rgba(59,130,246,0.3)] border border-blue-400/20">
            <Scissors size={22} />
          </div>

          <nav className="flex flex-col gap-5 items-center w-full">
            {SIDEBAR_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                title={item.label}
                className="w-full flex justify-center py-2"
              >
                {({ isActive }) => {
                  let actuallyActive = isActive;
                  if (item.path === '/tools') {
                    if (location.pathname !== '/' && !['/assets', '/tasks', '/messages'].some(p => location.pathname.startsWith(p))) {
                      actuallyActive = true;
                    }
                  }
                  const IconComponent = actuallyActive ? item.activeIcon : item.icon;
                  return (
                    <div
                      className={`flex flex-col items-center gap-1.5 cursor-pointer transition-all group relative ${
                        actuallyActive ? "text-blue-500 opacity-100 scale-105" : "text-gray-400 opacity-70 hover:text-gray-200 hover:scale-105"
                      }`}
                    >
                      <div className="relative">
                        <IconComponent
                          size={24}
                          className="mb-0.5 drop-shadow-sm transition-all"
                          strokeWidth={actuallyActive ? 2.5 : 2}
                        />
                        {item.badge !== null && item.badge !== undefined && (
                          <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold flex items-center justify-center rounded-full border-2 border-[#050505] shadow-sm">
                            {item.badge}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] font-medium tracking-wide">{item.label}</span>

                      {actuallyActive && (
                        <div className="absolute -left-[14px] top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500 rounded-r-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                      )}
                    </div>
                  );
                }}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Settings and Profile at bottom */}
        <div className="flex flex-col items-center gap-6 mt-auto">
          <button
            onClick={() => navigate('/settings?tab=billing')}
            className={`cursor-pointer flex flex-col items-center gap-1.5 transition-all group relative ${location.pathname === '/settings' && location.search.includes('tab=billing') ? 'text-yellow-500 opacity-100 scale-105' : 'text-yellow-500/60 hover:text-yellow-400 opacity-70 hover:opacity-100 hover:scale-105'}`}
            title="订阅 Pro"
          >
            <Crown size={22} className="group-hover:-translate-y-1 transition-transform duration-300 drop-shadow-[0_0_8px_rgba(234,179,8,0.5)]" />
            <span className="text-[10px] font-bold tracking-wider text-yellow-500/80 group-hover:text-yellow-400 uppercase mt-0.5 shadow-sm">VIP</span>
          </button>

          <button
            onClick={() => navigate('/settings')}
            className={`cursor-pointer flex flex-col items-center gap-1.5 transition-all group ${location.pathname === '/settings' ? 'text-blue-500 opacity-100' : 'opacity-60 hover:opacity-100 text-gray-400 hover:text-white'}`}
          >
            <Settings size={22} className="group-hover:rotate-45 transition-transform duration-300" />
          </button>

          <button
             onClick={() => navigate('/settings')}
             className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#222] to-[#333] border border-[#444] flex items-center justify-center text-gray-300 hover:text-white hover:border-blue-500 transition-all shadow-md group">
             <User size={18} className="group-hover:scale-110 transition-transform" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 flex flex-col h-full bg-[#111]">
        <header className="h-14 border-b border-[#1A1A1A] flex items-center justify-between px-6 bg-[#080808]/80 backdrop-blur-md shrink-0 sticky top-0 z-10">
          <h1 className="text-[13px] font-semibold tracking-wider flex items-center gap-3 text-gray-100 uppercase">
            <div className="relative flex items-center justify-center">
              <span className="absolute w-2 h-2 rounded-full bg-blue-500 animate-ping opacity-60"></span>
              <span className="bg-blue-500 w-1.5 h-1.5 rounded-full relative z-10 shadow-[0_0_8px_rgba(59,130,246,0.8)]"></span>
            </div>
            SDKWork Autocut Pro
          </h1>
          <div className="flex items-center gap-4">
             <div className="px-2 py-1 rounded bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] font-bold font-mono tracking-wider shadow-inner flex items-center gap-1.5">
               <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> 系统就绪
             </div>
             <div className="text-[11px] text-gray-500 font-mono tracking-wider">v1.2.4</div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto relative flex flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
