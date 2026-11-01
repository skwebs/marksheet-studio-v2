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

/** Persist a single-student class transfer across two same-session workspaces atomically. */
export async function moveStudentBetweenWorkspaces(sourceData: AppData, destinationData: AppData, movedStudentId: string, expectedDestinationUpdatedAt: string | null): Promise<boolean> {
  const sourceId = workspaceId(sourceData);
  const destinationId = workspaceId(destinationData);
  if (sourceId === destinationId) return false;
  const updatedAt = new Date().toISOString();
  return db.transaction('rw', db.snapshots, async () => {
    const existingDestination = await db.snapshots.get(destinationId);
    if ((expectedDestinationUpdatedAt === null && existingDestination) || (expectedDestinationUpdatedAt !== null && existingDestination?.updatedAt !== expectedDestinationUpdatedAt)) return false;
    const existingData = existingDestination?.data;
    const movedStudent = destinationData.students.find(student => student.studentId === movedStudentId);
    const duplicateStudent = existingData?.students?.some(student => student.studentId === movedStudentId);
    const duplicateRoll = movedStudent && existingData?.students?.some(student => student.roll.trim().toLowerCase() === movedStudent.roll.trim().toLowerCase());
    if (duplicateStudent || duplicateRoll) return false;
    await db.snapshots.put({ id: sourceId, data: sourceData, updatedAt });
    await db.snapshots.put({ id: destinationId, data: destinationData, updatedAt });
    await db.snapshots.put({ id: SNAPSHOT_ID, data: sourceData, updatedAt });
    return true;
  });
}

export async function saveWorkspace(data: AppData): Promise<void> {
  await db.snapshots.put({ id: workspaceId(data), data, updatedAt: new Date().toISOString() });
}
export async function loadWorkspace(id: string): Promise<AppData | undefined> {
  return (await db.snapshots.get(id))?.data;
}
export async function loadWorkspaceSnapshot(id: string): Promise<{ data: AppData; updatedAt: string } | undefined> {
  const snapshot = await db.snapshots.get(id);
  return snapshot ? { data: snapshot.data, updatedAt: snapshot.updatedAt } : undefined;
}
export async function listWorkspaces(): Promise<Array<{ id: string; data: AppData; updatedAt: string }>> {
  return db.snapshots.filter(item => item.id.startsWith('workspace:')).toArray();
}

/** Rename the active class workspace without overwriting an existing workspace. */
export async function renameClassWorkspace(previousData: AppData, nextData: AppData): Promise<'renamed' | 'same' | 'exists' | 'missing'> {
  const previousId = workspaceId(previousData);
  const nextId = workspaceId(nextData);
  if (previousId === nextId) return 'same';
  const updatedAt = new Date().toISOString();
  return db.transaction('rw', db.snapshots, async () => {
    const source = await db.snapshots.get(previousId);
    if (!source) return 'missing' as const;
    const destination = await db.snapshots.get(nextId);
    if (destination) return 'exists' as const;
    await db.snapshots.put({ id: nextId, data: nextData, updatedAt });
    await db.snapshots.put({ id: SNAPSHOT_ID, data: nextData, updatedAt });
    await db.snapshots.delete(previousId);
    return 'renamed' as const;
  });
}
