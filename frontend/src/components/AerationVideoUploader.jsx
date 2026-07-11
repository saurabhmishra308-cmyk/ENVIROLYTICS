import React, { useRef, useState } from 'react';
import { Upload, Loader2, Trash2, Film } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import api, { formatApiError, backendAssetUrl } from '../lib/api';

/**
 * Small admin control shown next to each aeration tank. Uploads a real MP4
 * of the tank captured on-site, or removes the uploaded video and reverts to
 * the built-in demo clip.
 */
export const AerationVideoUploader = ({ hardwareId, tankNumber, currentUrl, canManage, onChange }) => {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!canManage) return null;

  const trigger = () => inputRef.current?.click();

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';   // reset so the same file can be re-picked
    if (!file) return;
    if (file.size > 60 * 1024 * 1024) {
      toast.error('File too large — max 60 MB');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(
        `/api/water-quality/${encodeURIComponent(hardwareId)}/aeration-video/${tankNumber}`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      toast.success(`Tank ${tankNumber} video uploaded (${(data.bytes / (1024*1024)).toFixed(1)} MB)`);
      onChange?.(backendAssetUrl(data.url));
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove uploaded video for Tank ${tankNumber} and revert to demo footage?`)) return;
    setRemoving(true);
    try {
      await api.delete(`/api/water-quality/${encodeURIComponent(hardwareId)}/aeration-video/${tankNumber}`);
      toast.success(`Tank ${tankNumber} video removed`);
      onChange?.(null);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || 'Remove failed');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex items-center justify-center gap-2 mt-2" data-testid={`aeration-uploader-${tankNumber}`}>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-m4v"
        className="hidden"
        onChange={pickFile}
        data-testid={`aeration-uploader-input-${tankNumber}`}
      />
      <Button size="sm" variant="outline" onClick={trigger} disabled={uploading || removing}
              data-testid={`aeration-upload-btn-${tankNumber}`}>
        {uploading
          ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          : (currentUrl ? <Film className="h-3.5 w-3.5 mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />)}
        {currentUrl ? 'Replace video' : 'Upload real tank video'}
      </Button>
      {currentUrl && (
        <Button size="sm" variant="ghost" onClick={remove} disabled={uploading || removing}
                className="text-red-600 hover:bg-red-50" data-testid={`aeration-remove-btn-${tankNumber}`}>
          {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      )}
    </div>
  );
};

export default AerationVideoUploader;
