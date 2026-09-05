import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

@Injectable()
export class FileStorageService implements OnModuleInit {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('FILE_STORAGE_DIR', './storage'));
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  /**
   * Files are stored under a per-company folder with a generated name. The
   * caller's suggested file name is only ever used as the download name, never
   * as a path, so a company called "../../etc" cannot escape the store.
   */
  async save(companyId: string, fileName: string, contents: Buffer): Promise<string> {
    const folder = join(this.root, safeSegment(companyId));
    await mkdir(folder, { recursive: true });

    const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    const storedName = `${randomUUID()}${safeSegment(extension)}`;
    const fullPath = join(folder, storedName);

    await writeFile(fullPath, contents);

    // Relative to the store, so the root can move without rewriting records.
    return join(safeSegment(companyId), storedName).split(sep).join('/');
  }

  async open(relativePath: string): Promise<{ stream: ReadStream; size: number }> {
    const fullPath = this.resolveInsideRoot(relativePath);

    let size: number;
    try {
      const info = await stat(fullPath);
      size = info.size;
    } catch {
      throw new NotFoundException('That file is no longer available.');
    }

    return { stream: createReadStream(fullPath), size };
  }

  async remove(relativePath: string): Promise<void> {
    try {
      await unlink(this.resolveInsideRoot(relativePath));
    } catch {
      // Already gone is the outcome we wanted.
    }
  }

  /** Refuses any path that would land outside the storage root. */
  private resolveInsideRoot(relativePath: string): string {
    const candidate = resolve(this.root, normalize(relativePath));
    if (candidate !== this.root && !candidate.startsWith(this.root + sep)) {
      throw new NotFoundException('That file is no longer available.');
    }
    return candidate;
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '');
}
