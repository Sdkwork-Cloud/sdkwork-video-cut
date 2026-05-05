import type { AppAsset, AssetStorageInfo, AssetType } from '@sdkwork/autocut-types';
import { INITIAL_ASSETS } from './assets.mock';
import { createAutoCutObjectUrl, revokeAutoCutObjectUrl } from './download.service';
import { dispatchAutoCutEvent } from './events.service';
import { createAutoCutId, createAutoCutTimestamp } from './identity.service';
import { randomDelay } from './timing';
import { readAutoCutStorage, writeAutoCutStorage } from './storage.service';

function inferAssetTypeFromFile(file: File): AssetType {
  if (file.type.startsWith('video/')) {
    return 'video';
  }

  if (file.type.startsWith('audio/')) {
    return 'audio';
  }

  if (file.type.startsWith('image/')) {
    return 'image';
  }

  return 'doc';
}

export async function getAssets(): Promise<AppAsset[]> {
  await randomDelay(50, 100);
  return readAutoCutStorage<AppAsset[]>('assets', INITIAL_ASSETS);
}

export async function addAsset(asset: AppAsset): Promise<void> {
  await randomDelay();
  const assets = readAutoCutStorage<AppAsset[]>('assets', INITIAL_ASSETS);
  writeAutoCutStorage('assets', [asset, ...assets]);
  dispatchAutoCutEvent('assetAdded', asset);
}

export async function importAssetFile(file: File): Promise<AppAsset> {
  const now = createAutoCutTimestamp();
  const asset: AppAsset = {
    id: createAutoCutId('asset'),
    name: file.name,
    type: inferAssetTypeFromFile(file),
    size: file.size,
    createdAt: now,
    updatedAt: now,
    url: createAutoCutObjectUrl(file),
  };

  await addAsset(asset);
  return asset;
}

export async function createAssetFolder(name: string): Promise<AppAsset> {
  const now = createAutoCutTimestamp();
  const folder: AppAsset = {
    id: createAutoCutId('folder'),
    name,
    type: 'folder',
    size: 0,
    createdAt: now,
    updatedAt: now,
  };

  await addAsset(folder);
  return folder;
}

export async function deleteAsset(assetId: string): Promise<void> {
  const assets = readAutoCutStorage<AppAsset[]>('assets', INITIAL_ASSETS);
  const deletedAsset = assets.find((asset) => asset.id === assetId);
  if (deletedAsset?.url?.startsWith('blob:')) {
    revokeAutoCutObjectUrl(deletedAsset.url);
  }

  writeAutoCutStorage('assets', assets.filter((asset) => asset.id !== assetId));
  dispatchAutoCutEvent('assetDeleted', { id: assetId });
}

export async function getStorageInfo(): Promise<AssetStorageInfo> {
  await randomDelay(20, 50);
  const assets = readAutoCutStorage<AppAsset[]>('assets', INITIAL_ASSETS);
  return {
    used: assets.reduce((total, asset) => total + asset.size, 0),
    total: 100 * 1024 * 1024 * 1024,
  };
}
