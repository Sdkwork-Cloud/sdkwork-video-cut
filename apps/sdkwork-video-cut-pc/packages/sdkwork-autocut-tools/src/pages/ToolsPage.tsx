import { useEffect, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutGrid,
  Sparkles,
  Video,
  Music,
  FileText,
  Image as ImageIcon,
  Minimize,
  RefreshCcw,
  Monitor,
  Languages,
  Mic,
  ChevronRight,
  Scissors,
  Copy,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { Card } from '@sdkwork/autocut-commons';
import {
  getActiveAutoCutLocale,
  getAutoCutI18nText,
  getTools,
  listenAutoCutI18nLanguageChanged,
} from '@sdkwork/autocut-services';
import type { AppTool, ToolCategory } from '@sdkwork/autocut-types';

type ToolsCategoryId = ToolCategory | 'all';

type ToolsCategory = {
  id: ToolsCategoryId;
  labelKey: string;
  icon: ComponentType<LucideProps>;
};

const CATEGORIES: ToolsCategory[] = [
  { id: 'all', labelKey: 'tools.category.all', icon: LayoutGrid },
  { id: 'video', labelKey: 'tools.category.video', icon: Video },
  { id: 'audio', labelKey: 'tools.category.audio', icon: Music },
  { id: 'ai', labelKey: 'tools.category.ai', icon: Sparkles },
];

const TOOL_COLOR_CLASSES = [
  'border-blue-500/20 bg-blue-500/10 text-blue-400',
  'border-purple-500/20 bg-purple-500/10 text-purple-400',
  'border-green-500/20 bg-green-500/10 text-green-400',
  'border-orange-500/20 bg-orange-500/10 text-orange-400',
  'border-pink-500/20 bg-pink-500/10 text-pink-400',
  'border-cyan-500/20 bg-cyan-500/10 text-cyan-400',
] as const;

function ToolIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'file-text':
      return <FileText size={22} />;
    case 'music':
      return <Music size={22} />;
    case 'image':
      return <ImageIcon size={22} />;
    case 'minimize':
      return <Minimize size={22} />;
    case 'refresh-ccw':
      return <RefreshCcw size={22} />;
    case 'monitor':
      return <Monitor size={22} />;
    case 'languages':
      return <Languages size={22} />;
    case 'mic':
      return <Mic size={22} />;
    case 'scissors':
      return <Scissors size={22} />;
    case 'copy':
      return <Copy size={22} />;
    default:
      return <Scissors size={22} />;
  }
}

export function ToolsPage() {
  const navigate = useNavigate();
  const [, setActiveLocale] = useState(getActiveAutoCutLocale());
  const [activeCategory, setActiveCategory] = useState<ToolsCategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [toolsList, setToolsList] = useState<AppTool[]>([]);

  useEffect(() => {
    getTools().then(setToolsList);
  }, []);

  useEffect(() => listenAutoCutI18nLanguageChanged(() => {
    setActiveLocale(getActiveAutoCutLocale());
  }), []);

  const t = getAutoCutI18nText;

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredTools = toolsList.filter((tool) => {
    const translatedToolName = t(tool.nameKey ?? tool.name, undefined, tool.name).toLowerCase();
    const translatedToolDescription = t(tool.descriptionKey ?? tool.description, undefined, tool.description).toLowerCase();
    const matchesCategory = activeCategory === 'all' || tool.category === activeCategory;
    const matchesSearch =
      !normalizedSearchQuery ||
      translatedToolName.includes(normalizedSearchQuery) ||
      translatedToolDescription.includes(normalizedSearchQuery);
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto p-6 md:p-10">
      <div className="flex h-full w-full flex-col space-y-8">
        <div className="flex flex-col justify-between gap-4 border-b border-[#222] pb-6 md:flex-row md:items-end">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-gray-100">
              <span className="h-6 w-2 rounded-full bg-blue-500" />
              {t('tools.page.title')}
            </h1>
            <p className="ml-5 mt-2 text-sm text-gray-500">{t('tools.page.description')}</p>
          </div>

          <div className="relative w-full shrink-0 md:w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder={t('tools.search.placeholder')}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-xl border border-[#333] bg-[#111] py-2.5 pl-9 pr-4 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-8 md:flex-row">
          <div className="no-scrollbar flex w-full shrink-0 flex-row gap-2 overflow-x-auto md:w-56 md:flex-col">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 whitespace-nowrap transition-all md:whitespace-normal ${
                    activeCategory === cat.id
                      ? 'border-blue-500/20 bg-blue-600/10 text-blue-500 shadow-sm'
                      : 'border-transparent text-gray-400 hover:bg-[#111] hover:text-gray-200'
                  }`}
                >
                  <Icon size={18} />
                  <span className="text-sm font-semibold">{t(cat.labelKey)}</span>
                  {activeCategory === cat.id && <ChevronRight size={16} className="ml-auto hidden opacity-50 md:block" />}
                </button>
              );
            })}
          </div>

          <div className="flex-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredTools.map((tool, index) => {
                const colorClass = TOOL_COLOR_CLASSES[index % TOOL_COLOR_CLASSES.length];
                const toolName = t(tool.nameKey ?? tool.name, undefined, tool.name);
                const toolDescription = t(tool.descriptionKey ?? tool.description, undefined, tool.description);

                return (
                  <Card
                    key={tool.id}
                    onClick={() => {
                      if (tool.route) {
                        navigate(tool.route);
                      }
                    }}
                    className="group flex cursor-pointer flex-col items-start gap-4 border-[#222] bg-[#0A0A0A] p-5 transition-transform hover:-translate-y-1 hover:border-[#444] hover:shadow-lg"
                  >
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl border transition-all group-hover:scale-110 ${colorClass}`}>
                      <ToolIcon icon={tool.icon} />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-200 transition-colors group-hover:text-white">{toolName}</h3>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
                        {toolDescription}
                      </p>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
