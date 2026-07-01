import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Sparkles,
  Copy,
} from 'lucide-react';
import { Button, Card } from '@sdkwork/autocut-commons';
import {
  getActiveAutoCutLocale,
  getAutoCutI18nText,
  getTools,
  listenAutoCutI18nLanguageChanged,
  reportAutoCutDiagnostic,
  selectAutoCutTrustedLocalVideoFile,
} from '@sdkwork/autocut-services';
import type { AppTool } from '@sdkwork/autocut-types';

const ICON_MAP: Record<string, React.ReactNode> = {
  'file-text': <FileText size={20} />,
  music: <Music size={20} />,
  image: <ImageIcon size={20} />,
  minimize: <Minimize size={20} />,
  'refresh-ccw': <RefreshCcw size={20} />,
  monitor: <Monitor size={20} />,
  languages: <Languages size={20} />,
  mic: <Mic size={20} />,
  scissors: <Scissors size={20} />,
  copy: <Copy size={20} />,
};

const TOOL_COLOR_CLASSES = [
  'border-blue-500/20 bg-blue-500/10 text-blue-500',
  'border-purple-500/20 bg-purple-500/10 text-purple-400',
  'border-green-500/20 bg-green-500/10 text-green-500',
  'border-orange-500/20 bg-orange-500/10 text-orange-500',
  'border-pink-500/20 bg-pink-500/10 text-pink-500',
  'border-yellow-500/20 bg-yellow-500/10 text-yellow-500',
  'border-cyan-500/20 bg-cyan-500/10 text-cyan-400',
  'border-indigo-500/20 bg-indigo-500/10 text-indigo-400',
] as const;

export function HomePage() {
  const navigate = useNavigate();
  const [, setActiveLocale] = useState(getActiveAutoCutLocale());
  const startSmartSliceInputRef = useRef<HTMLInputElement>(null);
  const [tools, setTools] = useState<AppTool[]>([]);
  const [sourceUrlInput, setSourceUrlInput] = useState('');

  useEffect(() => {
    getTools().then(setTools);
  }, []);

  useEffect(() => listenAutoCutI18nLanguageChanged(() => {
    setActiveLocale(getActiveAutoCutLocale());
  }), []);

  const t = getAutoCutI18nText;

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
      reportAutoCutDiagnostic(
        'warning',
        'home',
        'Desktop trusted video selection failed, using browser fallback',
        error,
      );
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
    <div className="h-full w-full overflow-y-auto p-6 md:p-10">
      <div className="w-full space-y-8">
        <div className="flex flex-col gap-6">
          <div
            className="group relative flex w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border border-[#333] bg-gradient-to-b from-[#0f1115] to-[#0A0A0A] p-14 transition-all hover:border-blue-500/50 lg:p-24"
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
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[400px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/10 blur-[120px] transition-all duration-700 group-hover:bg-blue-600/20" />
            <div className="absolute left-0 top-0 h-[1px] w-full bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />

            <div className="relative mb-8 flex h-24 w-24 -translate-y-0 items-center justify-center rounded-3xl border border-[#222] bg-[#111] shadow-2xl transition-all duration-300 group-hover:-translate-y-2 group-hover:border-blue-500/40 group-hover:shadow-[0_0_40px_rgba(59,130,246,0.3)]">
              <div className="absolute inset-0 rounded-3xl bg-blue-500/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <UploadCloud
                size={44}
                className="relative z-10 text-gray-400 transition-colors duration-300 group-hover:text-blue-400"
              />
            </div>

            <h2 className="mb-4 bg-gradient-to-b from-white to-gray-400 bg-clip-text text-center text-4xl font-extrabold tracking-tight text-transparent drop-shadow-sm md:text-5xl">
              {t('home.hero.title')}
            </h2>
            <p className="max-w-xl text-center text-base font-medium leading-relaxed text-gray-500">
              {t('home.hero.description')}
            </p>

            <Button className="mt-10 rounded-full border-none bg-blue-600 px-10 py-6 text-base font-semibold text-white shadow-[0_0_30px_rgba(37,99,235,0.25)] transition-all duration-300 hover:scale-105 hover:bg-blue-500 hover:shadow-[0_0_40px_rgba(37,99,235,0.4)]">
              <Sparkles size={18} className="mr-2" />
              {t('home.hero.action')}
            </Button>
          </div>

          <div className="group relative flex w-full flex-col items-center gap-6 overflow-hidden rounded-3xl border border-[#222] bg-[#0A0A0A] p-6 transition-colors hover:border-[#333] lg:flex-row lg:p-8">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#222] bg-[#111] shadow-lg transition-colors group-hover:border-emerald-500/30 lg:flex">
              <LinkIcon size={24} className="text-emerald-500" />
            </div>

            <div className="relative z-10 flex w-full flex-1 flex-col items-start justify-center gap-1.5">
              <h3 className="flex w-full items-center justify-between text-lg font-bold text-gray-100">
                <span>{t('home.url.title')}</span>
              </h3>
              <p className="hidden max-w-md text-sm text-gray-500 lg:block">
                {t('home.url.description')}
              </p>
            </div>

            <div className="relative z-10 mt-2 flex w-full shrink-0 gap-3 lg:mt-0 lg:w-[600px]">
              <input
                type="text"
                placeholder={t('home.url.placeholder')}
                value={sourceUrlInput}
                onChange={(event) => setSourceUrlInput(event.target.value)}
                className="h-14 flex-1 rounded-2xl border border-[#333] bg-[#111] px-5 text-sm text-white shadow-inner outline-none transition-all placeholder:text-gray-600 focus:border-emerald-500 focus:bg-[#151515]"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSubmitSourceUrl();
                }}
              />
              <Button
                onClick={handleSubmitSourceUrl}
                className="h-14 whitespace-nowrap rounded-2xl border border-[#333] bg-[#222] px-8 font-semibold text-gray-300 transition-all hover:border-[#444] hover:bg-[#333] hover:text-white"
              >
                {t('home.url.action')}
              </Button>
            </div>
          </div>
        </div>

        <div className="pt-4">
          <h2 className="mb-6 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-500">
            <span className="h-3 w-1 rounded-full bg-blue-500" />
            {t('home.tools.title')}
          </h2>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {tools.map((tool, index) => {
              const colorClass = TOOL_COLOR_CLASSES[index % TOOL_COLOR_CLASSES.length];
              const toolName = t(tool.nameKey ?? tool.name, undefined, tool.name);
              const toolDescription = t(tool.descriptionKey ?? tool.description, undefined, tool.description);

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
                  className="group flex cursor-pointer flex-col gap-4 bg-[#0A0A0A] p-5 shadow-none transition-all hover:border-[#444] hover:bg-[#111]"
                >
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl border transition-transform duration-300 group-hover:scale-110 ${colorClass}`}>
                    {ICON_MAP[tool.icon] || <Scissors size={20} />}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold text-gray-200 transition-colors group-hover:text-white">
                      {toolName}
                    </span>
                    <span className="line-clamp-1 text-[11px] text-gray-500">
                      {toolDescription || t('home.tools.fallbackDescription')}
                    </span>
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
