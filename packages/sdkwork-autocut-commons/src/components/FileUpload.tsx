import React, { useEffect, useRef, useState } from 'react';
import { Upload, FileVideo, X, File, Music, Image as ImageIcon } from 'lucide-react';
import {
  createAutoCutTrustedLocalFile,
  listenAutoCutTrustedFileSourceDrop,
  resolveAutoCutTrustedSourcePath,
  type AutoCutTrustedFileSourceDescriptor,
} from '../service/trusted-file-source.service';

interface FileUploadProps {
  file: File | null;
  onChange: (file: File | null) => void;
  onValidationError?: (message: string) => void;
  accept?: string;
  maxSizeMB?: number;
}

export function FileUpload({ file, onChange, onValidationError, accept = "video/*,audio/*", maxSizeMB = 2000 }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const resolveAcceptedTrustedFile = (descriptors: AutoCutTrustedFileSourceDescriptor[]) => {
    for (const descriptor of descriptors) {
      const trustedFile = createAutoCutTrustedLocalFile(descriptor);
      const nextFile = getValidatedFile(trustedFile);
      if (nextFile) {
        return nextFile;
      }
    }

    return null;
  };

  const getValidatedFile = (nextFile: File) => {
    if (nextFile.size > maxSizeMB * 1024 * 1024) {
      onValidationError?.(`File size must be less than ${maxSizeMB}MB`);
      return null;
    }

    const acceptFileTypes = accept.split(',').map((type) => type.trim()).filter(Boolean);
    const isAccepted = acceptFileTypes.length === 0 || acceptFileTypes.some((acceptedType) => {
      if (acceptedType.endsWith('/*')) {
        return nextFile.type.startsWith(acceptedType.replace('/*', '/'));
      }
      if (acceptedType.startsWith('.')) {
        return nextFile.name.toLowerCase().endsWith(acceptedType.toLowerCase());
      }
      return nextFile.type === acceptedType;
    });

    if (!isAccepted) {
      onValidationError?.(`File type must match ${accept}`);
      return null;
    }

    const trustedSourcePath = resolveAutoCutTrustedSourcePath(nextFile);
    if (trustedSourcePath) {
      Object.defineProperty(nextFile, 'sourcePath', {
        configurable: true,
        value: trustedSourcePath,
      });
    }

    return nextFile;
  };

  useEffect(() => listenAutoCutTrustedFileSourceDrop((detail) => {
    const nextFile = resolveAcceptedTrustedFile(detail.files);
    if (nextFile) {
      setIsDragging(false);
      onChange(nextFile);
    }
  }), [accept, maxSizeMB, onChange, onValidationError]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const nextFile = getValidatedFile(selectedFile);
      if (nextFile) {
        onChange(nextFile);
      } else if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      const nextFile = getValidatedFile(droppedFile);
      if (nextFile) {
        onChange(nextFile);
      }
    }
  };

  const clearFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const getFileIcon = (fileOrAcceptType: string) => {
    if (fileOrAcceptType.includes('video')) return <FileVideo size={20} />;
    if (fileOrAcceptType.includes('audio')) return <Music size={20} />;
    if (fileOrAcceptType.includes('image')) return <ImageIcon size={20} />;
    return <File size={20} />;
  };

  if (file) {
    return (
      <div className="border border-[#333] hover:border-[#444] bg-[#111] hover:bg-[#151515] rounded-xl p-4 flex items-center justify-between transition-all group shadow-md shadow-black/20">
        <div className="flex items-center gap-4 overflow-hidden">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center shrink-0 shadow-inner">
            {getFileIcon(file.type)}
          </div>
          <div className="min-w-0 pr-4">
            <p className="text-sm font-bold text-gray-200 truncate group-hover:text-blue-400 transition-colors">{file.name}</p>
            <div className="flex gap-2 items-center mt-1 text-[11px] text-gray-500 font-mono">
              <span className="bg-[#222] px-1.5 rounded">{file.type || 'unknown format'}</span>
              <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
          </div>
        </div>
        <button onClick={clearFile} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-[#222] text-gray-400 hover:text-white hover:bg-red-500/20 hover:border hover:border-red-500/50 transition-all border border-transparent">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center transition-all cursor-pointer relative overflow-hidden group ${
        isDragging
          ? 'border-blue-500 bg-blue-500/10 scale-[1.02] shadow-[0_0_30px_rgba(59,130,246,0.15)]'
          : 'border-[#333] hover:border-blue-500/50 bg-[#111] hover:bg-[#141414]'
      }`}
    >
      {isDragging && <div className="absolute inset-0 bg-blue-500/5 blur-3xl rounded-full scale-150 animate-pulse"></div>}

      <input
        type="file"
        ref={inputRef}
        className="hidden"
        accept={accept}
        onChange={handleFileChange}
      />

      <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-all duration-300 ${isDragging ? 'bg-blue-500 text-white scale-110 shadow-lg shadow-blue-500/30' : 'bg-[#222] text-gray-500 group-hover:bg-[#2a2a2a] group-hover:text-blue-400 group-hover:-translate-y-1'}`}>
         <Upload size={32} />
      </div>

      <p className={`text-[15px] font-bold tracking-wide transition-colors ${isDragging ? 'text-blue-400' : 'text-gray-200 group-hover:text-white'}`}>
        {isDragging ? '松开以上传文件' : '点击或拖拽文件到这里'}
      </p>

      <div className="flex items-center gap-3 mt-3 opacity-60">
        <span className="text-[11px] font-mono bg-[#222] px-2 py-0.5 rounded text-gray-400">MAX {maxSizeMB}MB</span>
        <span className="w-1 h-1 rounded-full bg-gray-600"></span>
        <span className="text-[11px] text-gray-500 uppercase tracking-widest">{accept.replace(/,?\w+\/\*/g, '').replace(/\./g, '  ')}</span>
      </div>
    </div>
  );
}
