import { FolderOpen } from 'lucide-react';

export function HomePage({ onImport }: { onImport: () => void }) {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Projects</span>
          <h2>项目与最近任务</h2>
        </div>
        <button type="button" className="primary-button" onClick={onImport}>
          <FolderOpen size={18} aria-hidden="true" />
          导入示例视频
        </button>
      </div>
      <div className="empty-panel">
        <h3>开始一个本地剪辑项目</h3>
        <p>导入口播、访谈或长访谈视频后，可以进入工作台分析、审阅、渲染和导出。</p>
      </div>
    </section>
  );
}
