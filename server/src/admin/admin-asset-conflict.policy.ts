import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { types } from 'util';

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value : undefined;
}

function isAssetStorageConflict(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || types.isProxy(error) ||
      !types.isNativeError(error) ||
      Object.getPrototypeOf(error) !== Prisma.PrismaClientKnownRequestError.prototype ||
      ownData(error, 'code') !== 'P2002') return false;

  // The SDK adds the model name; an unscoped target must not classify an audit failure.
  const meta = ownData(error, 'meta');
  if (meta === null || typeof meta !== 'object' || types.isProxy(meta) ||
      Object.getPrototypeOf(meta) !== Object.prototype ||
      ownData(meta, 'modelName') !== 'Asset') return false;
  const target = ownData(meta, 'target');
  if (target === null || typeof target !== 'object' || types.isProxy(target) ||
      !Array.isArray(target) || Object.getPrototypeOf(target) !== Array.prototype ||
      ownData(target, 'length') !== 2) return false;
  const first = ownData(target, '0'), second = ownData(target, '1');
  return (first === 'storage_provider' && second === 'storage_key') ||
    (first === 'storage_key' && second === 'storage_provider');
}

export function rethrowAdminAssetConflict(error: unknown): never {
  if (isAssetStorageConflict(error)) {
    throw new ConflictException({ code: 'ADMIN_ASSET_STORAGE_CONFLICT' });
  }
  throw error;
}
