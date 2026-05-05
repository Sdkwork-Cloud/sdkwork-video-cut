import { useState, useEffect } from 'react';
import { Search, LayoutGrid, Sparkles, Video, Music, FileText, Image as ImageIcon, Minimize, RefreshCcw, Monitor, Languages, Mic, ChevronRight, Scissors } from 'lucide-react';
import { Card } from '@sdkwork/autocut-commons';
import { getTools } from '@sdkwork/autocut-services';
import { AppTool } from '@sdkwork/autocut-types';
import { useNavigate } from 'react-router-dom';

const CATEGORIES = [
  { id: 'all', label: '全部工具', icon: LayoutGrid },
  { id: 'video', label: '视频处理', icon: Video },
  { id: 'audio', label: '音频工具', icon: Music },
  { id: 'ai', label: 'AI 能力', icon: Sparkles },
];

export function ToolsPage() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [toolsList, setToolsList] = useState<AppTool[]>([]);

  useEffect(() => {
    getTools().then(setToolsList);
  }, []);

  const filteredTools = toolsList.filter(t =>
    (activeCategory === 'all' || t.category === activeCategory) &&
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-full h-full p-6 md:p-10 flex flex-col items-center overflow-y-auto">
      <div className="w-full flex flex-col h-full space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#222] pb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-100 flex items-center gap-3">
              <span className="w-2 h-6 bg-blue-500 rounded-full"></span>
              工具百宝箱
            </h1>
            <p className="text-sm text-gray-500 mt-2 ml-5">发现并使用高效的视频与音频处理工具</p>
          </div>

          <div className="relative w-full md:w-64 shrink-0">
             <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
             <input
               type="text"
               placeholder="搜索工具..."
               value={searchQuery}
               onChange={e => setSearchQuery(e.target.value)}
               className="w-full bg-[#111] border border-[#333] focus:border-blue-500 text-sm rounded-xl py-2.5 pl-9 pr-4 outline-none text-white transition-colors"
             />
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-8 flex-1">
          {/* Sidebar Categories */}
          <div className="w-full md:w-56 shrink-0 flex flex-row md:flex-col gap-2 overflow-x-auto no-scrollbar">
            {CATEGORIES.map(cat => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all whitespace-nowrap md:whitespace-normal ${
                    activeCategory === cat.id
                      ? 'bg-blue-600/10 text-blue-500 border border-blue-500/20 shadow-sm'
                      : 'text-gray-400 border border-transparent hover:bg-[#111] hover:text-gray-200'
                  }`}
                >
                  <Icon size={18} />
                  <span className="font-semibold text-sm">{cat.label}</span>
                  {activeCategory === cat.id && <ChevronRight size={16} className="ml-auto hidden md:block opacity-50" />}
                </button>
              )
            })}
          </div>

          {/* Tools Grid */}
          <div className="flex-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredTools.map((tool, index) => {
                const colors = [
                  "bg-blue-500/10 text-blue-400 border-blue-500/20",
                  "bg-purple-500/10 text-purple-400 border-purple-500/20",
                  "bg-green-500/10 text-green-400 border-green-500/20",
                  "bg-orange-500/10 text-orange-400 border-orange-500/20",
                  "bg-pink-500/10 text-pink-400 border-pink-500/20",
                  "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
                ];
                const colorClass = colors[index % colors.length];

                return (
                  <Card key={tool.id} onClick={() => {
                      if (tool.route) {
                           navigate(tool.route);
                      }
                  }} className="p-5 flex flex-col items-start gap-4 hover:-translate-y-1 transition-transform cursor-pointer group bg-[#0A0A0A] border-[#222] hover:border-[#444] hover:shadow-lg">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-all group-hover:scale-110 ${colorClass}`}>
                      {tool.icon === "file-text" && <FileText size={22} />}
                      {tool.icon === "music" && <Music size={22} />}
                      {tool.icon === "image" && <ImageIcon size={22} />}
                      {tool.icon === "minimize" && <Minimize size={22} />}
                      {tool.icon === "refresh-ccw" && <RefreshCcw size={22} />}
                      {tool.icon === "monitor" && <Monitor size={22} />}
                      {tool.icon === "languages" && <Languages size={22} />}
                      {tool.icon === "mic" && <Mic size={22} />}
                      {tool.icon === "scissors" && <Scissors size={22} />}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-200 group-hover:text-white transition-colors">{tool.name}</h3>
                      <p className="text-xs text-gray-500 mt-1.5 leading-relaxed line-clamp-2">
                        {tool.description}
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
