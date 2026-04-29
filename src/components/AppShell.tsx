import { Activity, CheckCircle2, Download, Film, Home, Scissors, Settings } from 'lucide-react';

import type { PageId } from '../domain/navigationTypes';
import type { CapabilityReport } from '../domain/videoCutTypes';
import { StatusBadge } from './StatusBadge';

const navItems: Array<{ id: PageId; label: string; icon: typeof Home }> = [
  { id: 'home', label: '项目', icon: Home },
  { id: 'workbench', label: '工作台', icon: Scissors },
  { id: 'queue', label: '队列', icon: Activity },
  { id: 'results', label: '结果', icon: Download },
  { id: 'diagnostics', label: '诊断', icon: CheckCircle2 },
  { id: 'settings', label: '设置', icon: Settings },
];

export function AppShell({
  activePage,
  capability,
  onNavigate,
  children,
}: {
  activePage: PageId;
  capability?: CapabilityReport;
  onNavigate: (page: PageId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="left-rail">
        <div className="brand-lockup">
          <Film size={24} aria-hidden="true" />
          <div>
            <strong>Video Cut</strong>
            <span>AI 剪辑工作台</span>
          </div>
        </div>
        <nav aria-label="Primary" className="primary-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                data-page-id={item.id}
                className={`nav-button${active ? ' nav-button--active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="app-main">
        <header className="top-bar">
          <div>
            <span className="eyebrow">desktop-local</span>
            <h1>SDKWork Video Cut</h1>
          </div>
          <div className="capability-strip" aria-label="Capability summary">
            <StatusBadge label={capability?.ai.label ?? 'LLM checking'} tone={capability?.ai.status === 'ok' ? 'ok' : 'warn'} />
            <StatusBadge
              label={capability?.speechToText.label ?? 'STT checking'}
              tone={capability?.speechToText.status === 'ok' ? 'ok' : 'warn'}
            />
            <StatusBadge label={capability?.media.label ?? 'Media checking'} tone="ok" />
          </div>
        </header>
        <main className="page-surface">{children}</main>
      </div>
    </div>
  );
}
