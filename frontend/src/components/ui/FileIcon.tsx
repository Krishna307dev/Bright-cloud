import React from 'react';
import {
  FileText,
  FileCode,
  Image as ImageIcon,
  Video as VideoIcon,
  Music,
  Archive,
  Table,
  Presentation,
  File,
} from 'lucide-react';
import { getFileCategory, type FileCategory } from '../../utils/fileType';
import { cn } from '../../utils/format';

interface FileIconProps {
  fileName: string;
  mimeType?: string;
  className?: string;
}

export const FileIcon: React.FC<FileIconProps> = ({ fileName, mimeType, className }) => {
  const category: FileCategory = getFileCategory(fileName, mimeType);

  switch (category) {
    case 'pdf':
      return <FileText className={cn('text-rose-500', className)} />;
    case 'image':
      return <ImageIcon className={cn('text-indigo-500', className)} />;
    case 'video':
      return <VideoIcon className={cn('text-purple-500', className)} />;
    case 'audio':
      return <Music className={cn('text-amber-500', className)} />;
    case 'code':
      return <FileCode className={cn('text-emerald-500', className)} />;
    case 'document':
      return <FileText className={cn('text-blue-500', className)} />;
    case 'spreadsheet':
      return <Table className={cn('text-teal-500', className)} />;
    case 'presentation':
      return <Presentation className={cn('text-orange-500', className)} />;
    case 'archive':
      return <Archive className={cn('text-amber-600', className)} />;
    case 'other':
    default:
      return <File className={cn('text-slate-400', className)} />;
  }
};
