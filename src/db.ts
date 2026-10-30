import Dexie, { type Table } from 'dexie';
import type { AppData } from './types';

class MarksheetDB extends Dexie {
  snapshots!: Table<{ id: string; data: AppData; updatedAt: string }, string>;
  constructor() {
    super('marksheet-studio-v2');
    this.version(1).stores({ snapshots: '&id, updatedAt' });
  }
}
export const db = new MarksheetDB();
export const SNAPSHOT_ID = 'current-class';
export async function loadData(): Promise<AppData | undefined> {
  return (await db.snapshots.get(SNAPSHOT_ID))?.data;
}
export async function saveData(data: AppData): Promise<void> {
  await db.snapshots.put({ id: SNAPSHOT_ID, data, updatedAt: new Date().toISOString() });
}
