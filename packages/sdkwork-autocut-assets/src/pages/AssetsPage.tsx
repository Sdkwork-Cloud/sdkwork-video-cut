import React, { useState, useEffect } from 'react';
import { Search, Folder, Video, Music, FileText, Image as ImageIcon, Download, UploadCloud, Calendar, HardDrive, Trash2 } from 'lucide-react';
import { Button, useToast } from '@sdkwork/autocut-commons';
import { AppAsset, AssetStorageInfo } from '@sdkwork/autocut-types';
import { confirmAutoCutAction, createAssetFolder, downloadAutoCutUrl, getAssets, getStorageInfo, deleteAsset, importAssetFile, listenAutoCutEvent, openAutoCutPreviewUrl } from '@sdkwork/autocut-services';

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function AssetsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [assets, setAssets] = useState<AppAsset[]>([]);
  const [storageInfo, setStorageInfo] = useState<AssetStorageInfo | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const refreshAssetsWorkspace = () => {
    getAssets().then(setAssets);
    getStorageInfo().then(setStorageInfo);
  };

  useEffect(() => {
    refreshAssetsWorkspace();

    const stopAssetDeleted = listenAutoCutEvent('assetDeleted', refreshAssetsWorkspace);
    const stopAssetAdded = listenAutoCutEvent('assetAdded', refreshAssetsWorkspace);
    return () => {
      stopAssetDeleted();
      stopAssetAdded();
    }
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmAutoCutAction('确定要删除这个文件吗？')) {
      await deleteAsset(id);
      toast('资源已删除', 'success');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      toast('正在上传文件...', 'info');
      await importAssetFile(file);
      toast('文件上传成功', 'success');

      if (fileInputRef.current) {
        fileInputRef.current.value = ''; // Reset
      }
    }
  };

  const handleCreateFolder = async () => {
    const nextIndex = assets.filter((asset) => asset.type === 'folder').length + 1;
    await createAssetFolder(`新建文件夹 ${nextIndex}`);
    toast('文件夹已创建', 'success');
  };

  const handleOpenAsset = (asset: AppAsset) => {
    if (asset.type === 'folder') {
      setActiveTab('all');
      return;
    }

    openAutoCutPreviewUrl(asset.url);
  };

  const handleDownloadAsset = (asset: AppAsset, e: React.MouseEvent) => {
    e.stopPropagation();
    downloadAutoCutUrl(asset.url, asset.name);
  };

  const filteredAssets = assets.filter((asset) => {
    const tabMatch = activeTab === 'all' || asset.type === activeTab;
    const queryMatch = asset.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
    return tabMatch && queryMatch;
  });

  return (
    <div className="w-full h-full p-6 md:p-10 flex flex-col items-center overflow-y-auto">
      <div className="w-full flex flex-col h-full space-y-8">

        {/* Header Options */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#222] pb-6">
          <div>
             <h1 className="text-2xl font-bold tracking-tight text-gray-100 flex items-center gap-3">
               <span className="w-2 h-6 bg-blue-500 rounded-full"></span>
               我的资产
             </h1>
             <div className="flex items-center gap-4 text-sm text-gray-500 mt-2 ml-5">
               <span className="flex items-center gap-1.5">
                 <HardDrive size={14} />
                 剩余空间: {storageInfo ? formatBytes(storageInfo.total - storageInfo.used) : '...'} / {storageInfo ? formatBytes(storageInfo.total) : '...'}
               </span>
             </div>
          </div>

          <div className="flex items-center gap-3">
             <div className="relative w-48 shrink-0">
               <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
               <input
                 type="text"
                 placeholder="搜索资产..."
                 value={searchQuery}
                 onChange={(event) => setSearchQuery(event.target.value)}
                 className="w-full bg-[#111] border border-[#333] focus:border-blue-500 text-sm rounded-lg py-2 pl-9 pr-3 outline-none text-white transition-colors"
               />
            </div>
            <div className="relative">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 font-medium" variant="primary">
                <UploadCloud size={16} /> 上传文件
              </Button>
            </div>
            <Button onClick={handleCreateFolder} className="flex items-center gap-2 font-medium" variant="outline">
              <Folder size={16} /> 新建文件夹
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 border-b border-[#222] pb-4 overflow-x-auto no-scrollbar">
          {[
            { id: 'all', label: '全部文件' },
            { id: 'video', label: '视频' },
            { id: 'audio', label: '音频' },
            { id: 'doc', label: '文档' },
            { id: 'image', label: '图片/GIF' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2 text-sm font-semibold rounded-full transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'text-gray-400 hover:text-gray-200 bg-[#111] border border-[#222] hover:border-[#444]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Directory/Files List */}
        <div className="flex-1 bg-[#0A0A0A] border border-[#222] rounded-xl overflow-hidden flex flex-col">
          <div className="grid grid-cols-[3fr_1fr_1fr_auto] gap-4 p-4 border-b border-[#222] bg-[#111] text-xs font-bold text-gray-500 uppercase tracking-wider">
            <div>文件名</div>
            <div>大小</div>
            <div>修改日期</div>
            <div className="w-8"></div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredAssets.map(asset => (
              <div key={asset.id} className="grid grid-cols-[3fr_1fr_1fr_auto] gap-4 p-4 border-b border-[#1A1A1A] hover:bg-[#151515] items-center transition-colors group cursor-pointer" onClick={() => handleOpenAsset(asset)}>
                <div className="flex items-center gap-3 overflow-hidden">
                   <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${
                     asset.type === 'video' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                     asset.type === 'audio' ? 'bg-purple-500/10 border-purple-500/20 text-purple-400' :
                     asset.type === 'image' ? 'bg-orange-500/10 border-orange-500/20 text-orange-400' :
                     'bg-green-500/10 border-green-500/20 text-green-400'
                   }`}>
                     {asset.type === 'video' && <Video size={18} />}
                     {asset.type === 'audio' && <Music size={18} />}
                     {asset.type === 'doc' && <FileText size={18} />}
                     {asset.type === 'image' && <ImageIcon size={18} />}
                     {asset.type === 'folder' && <Folder size={18} />}
                   </div>
                   <span className="text-sm font-semibold text-gray-200 group-hover:text-blue-400 transition-colors truncate">{asset.name}</span>
                </div>
                <div className="text-xs text-gray-400 font-mono">{formatBytes(asset.size)}</div>
                <div className="text-xs text-gray-400 flex items-center gap-2"><Calendar size={12} className="opacity-50" /> {asset.updatedAt}</div>
                <div className="flex items-center">
                  <button onClick={(e) => handleDelete(asset.id, e)} className="text-red-500 opacity-0 group-hover:opacity-100 p-2 rounded hover:bg-red-500/10 transition-all" title="删除">
                    <Trash2 size={16} />
                  </button>
                  <button onClick={(e) => handleDownloadAsset(asset, e)} className="text-gray-500 hover:text-white p-1 rounded hover:bg-[#222] transition-colors ml-1" title="下载">
                    <Download size={16} />
                  </button>
                </div>
              </div>
            ))}

            {filteredAssets.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                <Folder size={48} className="mb-4 opacity-30" />
                <p className="text-sm">没有找到相关的文件</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
