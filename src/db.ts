import Dexie, { type Table } from 'dexie';
import type { AppData } from './types';

type Snapshot = { id: string; data: AppData; updatedAt: string };
class MarksheetDB extends Dexie {
  snapshots!: Table<Snapshot, string>;
  constructor() {
    super('marksheet-studio-v2');
    this.version(1).stores({ snapshots: '&id, updatedAt' });
    this.version(2).stores({ snapshots: '&id, updatedAt' });
  }
}
export const db = new MarksheetDB();
export const SNAPSHOT_ID = 'current-class';
export const workspaceId = (data: AppData) => `workspace:${encodeURIComponent(data.academicSession)}:${encodeURIComponent(data.classInfo.className)}:${encodeURIComponent(data.classInfo.section || '')}`;
export async function loadData(): Promise<AppData | undefined> {
  return (await db.snapshots.get(SNAPSHOT_ID))?.data;
}
export async function saveData(data: AppData): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db.transaction('rw', db.snapshots, async () => {
    await db.snapshots.put({ id: workspaceId(data), data, updatedAt });
    await db.snapshots.put({ id: SNAPSHOT_ID, data, updatedAt });
  });
}
export async function saveWorkspace(data: AppData): Promise<void> {
  await db.snapshots.put({ id: workspaceId(data), data, updatedAt: new Date().toISOString() });
}
export async function loadWorkspace(id: string): Promise<AppData | undefined> {
  return (await db.snapshots.get(id))?.data;
}
export async function listWorkspaces(): Promise<Array<{ id: string; data: AppData; updatedAt: string }>> {
  return db.snapshots.filter(item => item.id.startsWith('workspace:')).toArray();
}
