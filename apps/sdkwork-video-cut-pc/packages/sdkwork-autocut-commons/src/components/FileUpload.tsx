import React, { useEffect, useRef, useState } from 'react';
import { Upload, FileVideo, X, File, Music, Image as ImageIcon } from 'lucide-react';
import {
  createAutoCutTrustedLocalFile,
  listenAutoCutTrustedFileSourceDrop,
  resolveAutoCutTrustedSourcePath,
  validateAutoCutTrustedFileRequiredStreams,
  type AutoCutRequiredMediaStreams,
  type AutoCutTrustedFileSourceDescriptor,
} from '../service/trusted-file-source.service';

interface FileUploadLabels {
  dropReady?: string;
  dropActive?: string;
  unknownFormat?: string;
  trustedSourceRequired?: string;
  maxSizePrefix?: string;
  sizeTooLarge?: (maxSizeMB: number) => string;
  typeMismatch?: (accept: string) => string;
}

interface FileUploadProps {
  file: File | null;
  onChange: (file: File | null) => void;
  onValidationError?: (message: string) => void;
  trustedFileSourceSelector?: () => Promise<AutoCutTrustedFileSourceDescriptor | null>;
  requiredStreams?: AutoCutRequiredMediaStreams;
  accept?: string;
  maxSizeMB?: number;
  labels?: FileUploadLabels;
}

export function FileUpload({
  file,
  onChange,
  onValidationError,
  trustedFileSourceSelector,
  requiredStreams,
  accept = 'video/*,audio/*',
  maxSizeMB = 2000,
  labels,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const requiresTrustedLocalSource = Boolean(trustedFileSourceSelector);

  const isTrustedAutoCutAudioVideoFile = (nextFile: File, acceptFileTypes: string[]) => {
    if (!resolveAutoCutTrustedSourcePath(nextFile)) {
      return false;
    }

    const mediaType = (nextFile as File & { mediaType?: unknown }).mediaType;
    if (mediaType !== 'audio' && mediaType !== 'video') {
      return false;
    }

    if (acceptFileTypes.length === 0) {
      return true;
    }

    if (acceptFileTypes.some((acceptedType) => acceptedType === `${mediaType}/*` || acceptedType === nextFile.type)) {
      return true;
    }

    return false;
  };

  const getValidatedFile = (nextFile: File) => {
    const trustedSourcePath = resolveAutoCutTrustedSourcePath(nextFile);

    if (requiresTrustedLocalSource && !trustedSourcePath) {
      onValidationError?.(
        labels?.trustedSourceRequired ??
          'AutoCut desktop processing requires a trusted local media file selected by the native host.',
      );
      return null;
    }

    if (nextFile.size > maxSizeMB * 1024 * 1024) {
      onValidationError?.(labels?.sizeTooLarge?.(maxSizeMB) ?? `File size must be less than ${maxSizeMB}MB`);
      return null;
    }

    const acceptFileTypes = accept.split(',').map((type) => type.trim()).filter(Boolean);
    const isAccepted = isTrustedAutoCutAudioVideoFile(nextFile, acceptFileTypes) || acceptFileTypes.length === 0 || acceptFileTypes.some((acceptedType) => {
      if (acceptedType.endsWith('/*')) {
        return nextFile.type.startsWith(acceptedType.replace('/*', '/'));
      }
      if (acceptedType.startsWith('.')) {
        return nextFile.name.toLowerCase().endsWith(acceptedType.toLowerCase());
      }
      return nextFile.type === acceptedType;
    });

    if (!isAccepted) {
      onValidationError?.(labels?.typeMismatch?.(accept) ?? `File type must match ${accept}`);
      return null;
    }

    if (trustedSourcePath) {
      const streamEvidenceError = validateAutoCutTrustedFileRequiredStreams(nextFile, requiredStreams);
      if (streamEvidenceError) {
        onValidationError?.(streamEvidenceError);
        return null;
      }
      return nextFile;
    }

    return nextFile;
  };

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

  useEffect(() => listenAutoCutTrustedFileSourceDrop((detail) => {
    const nextFile = resolveAcceptedTrustedFile(detail.files);
    if (nextFile) {
      setIsDragging(false);
      onChange(nextFile);
    }
  }), [accept, labels, maxSizeMB, onChange, onValidationError, requiredStreams]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      const nextFile = getValidatedFile(selectedFile);
      if (nextFile) {
        onChange(nextFile);
      } else if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) {
      const nextFile = getValidatedFile(droppedFile);
      if (nextFile) {
        onChange(nextFile);
      }
    }
  };

  const handleBrowseClick = () => {
    if (!trustedFileSourceSelector) {
      inputRef.current?.click();
      return;
    }

    void trustedFileSourceSelector()
      .then((descriptor) => {
        if (!descriptor) {
          return;
        }
        const trustedFile = createAutoCutTrustedLocalFile(descriptor);
        const nextFile = getValidatedFile(trustedFile);
        if (nextFile) {
          onChange(nextFile);
        }
      })
      .catch((error) => {
        onValidationError?.(
          error instanceof Error && error.message.trim()
            ? error.message
            : labels?.trustedSourceRequired ??
              'AutoCut desktop processing requires a trusted local media file selected by the native host.',
        );
      });
  };

  const clearFile = (event: React.MouseEvent) => {
    event.stopPropagation();
    onChange(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
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
              <span className="bg-[#222] px-1.5 rounded">{file.type || labels?.unknownFormat || 'unknown format'}</span>
              {Boolean((file as File & { hasAudioStream?: boolean }).hasAudioStream) && (
                <span className="bg-[#222] px-1.5 rounded">audio stream</span>
              )}
              {Boolean((file as File & { hasVideoStream?: boolean }).hasVideoStream) && (
                <span className="bg-[#222] px-1.5 rounded">video stream</span>
              )}
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
      onClick={handleBrowseClick}
      className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center transition-all cursor-pointer relative overflow-hidden group ${
        isDragging
          ? 'border-blue-500 bg-blue-500/10 scale-[1.02] shadow-[0_0_30px_rgba(59,130,246,0.15)]'
          : 'border-[#333] hover:border-blue-500/50 bg-[#111] hover:bg-[#141414]'
      }`}
    >
      {isDragging && <div className="absolute inset-0 bg-blue-500/5 blur-3xl rounded-full scale-150 animate-pulse" />}

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
        {isDragging ? labels?.dropActive ?? 'Drop to upload file' : labels?.dropReady ?? 'Click or drag a file here'}
      </p>

      <div className="flex items-center gap-3 mt-3 opacity-60">
        <span className="text-[11px] font-mono bg-[#222] px-2 py-0.5 rounded text-gray-400">{labels?.maxSizePrefix ?? 'MAX'} {maxSizeMB}MB</span>
        <span className="w-1 h-1 rounded-full bg-gray-600" />
        <span className="text-[11px] text-gray-500 uppercase tracking-widest">{accept.replace(/,?\w+\/\*/g, '').replace(/\./g, '  ')}</span>
      </div>
    </div>
  );
}
