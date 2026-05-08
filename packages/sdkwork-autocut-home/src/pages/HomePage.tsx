import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  UploadCloud,
  Link as LinkIcon,
  FileText,
  Music,
  Image as ImageIcon,
  Minimize,
  RefreshCcw,
  Monitor,
  Languages,
  Mic,
  Scissors,
  Sparkles
} from "lucide-react";
import { Card, Button } from "@sdkwork/autocut-commons";
import {
  getTools,
  reportAutoCutDiagnostic,
  selectAutoCutTrustedLocalVideoFile,
} from "@sdkwork/autocut-services";
import { AppTool } from "@sdkwork/autocut-types";

const ICON_MAP: Record<string, React.ReactNode> = {
  "file-text": <FileText size={20} />,
  music: <Music size={20} />,
  image: <ImageIcon size={20} />,
  minimize: <Minimize size={20} />,
  "refresh-ccw": <RefreshCcw size={20} />,
  monitor: <Monitor size={20} />,
  languages: <Languages size={20} />,
  mic: <Mic size={20} />,
  scissors: <Scissors size={20} />
};

export function HomePage() {
  const navigate = useNavigate();
  const startSmartSliceInputRef = useRef<HTMLInputElement>(null);
  const [tools, setTools] = useState<AppTool[]>([]);
  const [sourceUrlInput, setSourceUrlInput] = useState('');

  useEffect(() => {
    getTools().then(setTools);
  }, []);

  const handleSubmitSourceUrl = () => {
    if (sourceUrlInput.trim()) {
      navigate(`/slicer?url=${encodeURIComponent(sourceUrlInput.trim())}`);
      return;
    }

    navigate('/slicer');
  };

  const fallbackSmartSliceFileChooser = () => {
    startSmartSliceInputRef.current?.click();
  };

  const handleStartSmartSlice = async () => {
    try {
      const selectedVideo = await selectAutoCutTrustedLocalVideoFile();
      if (!selectedVideo) {
        return;
      }

      navigate('/slicer', {
        state: {
          initialTrustedFileSource: selectedVideo,
        },
      });
      return;
    } catch (error) {
      reportAutoCutDiagnostic('warning', 'home', 'Desktop trusted video selection failed, using browser fallback', error);
    }

    fallbackSmartSliceFileChooser();
  };

  const handleSmartSliceFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const selectedFile = event.target.files?.[0] ?? null;
    if (!selectedFile) {
      return;
    }

    navigate('/slicer', {
      state: {
        initialFile: selectedFile,
      },
    });
    event.target.value = '';
  };

  return (
    <div className="w-full h-full p-6 md:p-10 overflow-y-auto">
      <div className="w-full space-y-8">
        <div className="flex flex-col gap-6">
          {/* Main Upload Banner */}
          <div
            className="w-full relative overflow-hidden flex flex-col items-center justify-center p-14 lg:p-24 border border-[#333] hover:border-blue-500/50 transition-all cursor-pointer group bg-gradient-to-b from-[#0f1115] to-[#0A0A0A] rounded-3xl"
            onClick={handleStartSmartSlice}
          >
            <input
              ref={startSmartSliceInputRef}
              type="file"
              className="hidden"
              accept="video/*"
              onClick={(event) => event.stopPropagation()}
              onChange={handleSmartSliceFileSelected}
            />
            {/* Background Effects */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none group-hover:bg-blue-600/20 transition-all duration-700" />
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />

            <div className="w-24 h-24 mb-8 rounded-3xl bg-[#111] border border-[#222] group-hover:border-blue-500/40 flex items-center justify-center relative shadow-2xl group-hover:shadow-[0_0_40px_rgba(59,130,246,0.3)] transition-all duration-300 transform group-hover:-translate-y-2">
              <div className="absolute inset-0 bg-blue-500/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <UploadCloud size={44} className="text-gray-400 group-hover:text-blue-400 transition-colors duration-300 relative z-10" />
            </div>

            <h2 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-400 mb-4 tracking-tight drop-shadow-sm text-center">
              智能分析与处理您的视频
            </h2>
            <p className="text-base text-gray-500 font-medium max-w-xl text-center leading-relaxed">
              支持 MP4、MOV、WEBM 等主流视频格式。基于最新的大模型与机器学习能力，自动完成场景切分、文案提取、画质超分与声音处理。
            </p>

            <Button className="mt-10 px-10 py-6 text-base font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-[0_0_30px_rgba(37,99,235,0.25)] hover:shadow-[0_0_40px_rgba(37,99,235,0.4)] transition-all hover:scale-105 duration-300 border-none">
              <Sparkles size={18} className="mr-2" /> 开始智能切分
            </Button>
          </div>

          {/* Link Download Card */}
          <div className="w-full flex flex-col lg:flex-row items-center gap-6 p-6 lg:p-8 rounded-3xl border border-[#222] bg-[#0A0A0A] hover:border-[#333] transition-colors relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

            <div className="hidden lg:flex w-14 h-14 bg-[#111] border border-[#222] rounded-2xl items-center justify-center shrink-0 shadow-lg group-hover:border-emerald-500/30 transition-colors">
               <LinkIcon size={24} className="text-emerald-500" />
            </div>

            <div className="flex-1 w-full flex flex-col gap-1.5 items-start justify-center relative z-10">
              <h3 className="text-lg font-bold text-gray-100 flex items-center justify-between w-full">
                <span>云端直拉解析</span>
              </h3>
              <p className="text-sm text-gray-500 hidden lg:block max-w-md">粘贴来自任意主流视频平台的公开链接，即可直接在云端拉取、解析并处理视频内容，无需本地下载。</p>
            </div>

            <div className="flex w-full lg:w-[600px] gap-3 shrink-0 relative mt-2 lg:mt-0 z-10">
              <input
                type="text"
                placeholder="https://..."
                value={sourceUrlInput}
                onChange={(event) => setSourceUrlInput(event.target.value)}
                className="flex-1 h-14 px-5 rounded-2xl text-sm border border-[#333] bg-[#111] focus:outline-none focus:border-emerald-500 focus:bg-[#151515] text-white placeholder-gray-600 transition-all shadow-inner"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmitSourceUrl();
                }}
              />
              <Button onClick={handleSubmitSourceUrl} className="h-14 px-8 rounded-2xl bg-[#222] hover:bg-[#333] hover:text-white text-gray-300 border border-[#333] hover:border-[#444] transition-all whitespace-nowrap font-semibold">
                一键云推演
              </Button>
            </div>
          </div>
        </div>

        {/* Recommended Tools */}
        <div className="pt-4">
          <h2 className="text-xs uppercase tracking-widest text-gray-500 mb-6 font-bold flex items-center gap-2">
            <span className="w-1 h-3 bg-blue-500 rounded-full"></span>
            更多辅助处理工具
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-5">
            {tools.map((tool, index) => {
              const colors = [
                "bg-blue-500/10 text-blue-500 border-blue-500/20",
                "bg-purple-500/10 text-purple-400 border-purple-500/20",
                "bg-green-500/10 text-green-500 border-green-500/20",
                "bg-orange-500/10 text-orange-500 border-orange-500/20",
                "bg-pink-500/10 text-pink-500 border-pink-500/20",
                "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
                "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
                "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
              ];
              const colorClass = colors[index % colors.length];

              return (
                <Card
                  key={tool.id}
                  onClick={() => {
                      if (tool.route) {
                          navigate(tool.route);
                      } else {
                          navigate('/tools');
                      }
                  }}
                  className="p-5 flex flex-col gap-4 bg-[#0A0A0A] hover:bg-[#111] hover:border-[#444] transition-all cursor-pointer shadow-none group"
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${colorClass} group-hover:scale-110 transition-transform duration-300`}>
                    {ICON_MAP[tool.icon] || <Scissors size={20} />}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold text-gray-200 group-hover:text-white transition-colors">
                      {tool.name}
                    </span>
                    <span className="text-[11px] text-gray-500 line-clamp-1">{tool.description || '智能处理分析'}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
