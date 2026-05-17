import { VideoDedupWorkbench, useAutoCutTranslation } from '@sdkwork/autocut-commons';

export function VideoDedupPage() {
  useAutoCutTranslation();

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto p-6 md:p-10">
      <VideoDedupWorkbench title="Video deduplication workbench" />
    </div>
  );
}
