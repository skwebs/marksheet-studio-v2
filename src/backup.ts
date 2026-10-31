import JSZip from 'jszip';
import type { AppData, Student } from './types';
import { normalizeData, subjectsForClass } from './data';

const dataUrlToBlob = async (url: string) => (await fetch(url)).blob();
const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});
export async function exportZip(data: AppData, template: string, filenamePrefix = "", backupLabel = 'backup', extraManifest: Record<string, unknown> = {}) {
  const zip = new JSZip();
  const manifest: any = structuredClone(data);
  manifest.backupType = filenamePrefix === 'promote_' ? 'promotion' : backupLabel;
  manifest.createdAt = new Date().toISOString();
  Object.assign(manifest, extraManifest);
  manifest.assets = { photos: {}, schoolLogo: null, logoLeft: null, logoRight: null, watermark: null };
  for (const student of manifest.students as Student[]) {
    if (student.photo?.startsWith('data:')) {
      const blob = await dataUrlToBlob(student.photo);
      const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const path = `photos/${student.studentId}.${extension}`;
      zip.file(path, blob);
      student.photo = path;
      manifest.assets.photos[student.studentId] = path;
    }
  }
  if (manifest.school.logo?.startsWith('data:')) {
    const blob = await dataUrlToBlob(manifest.school.logo);
    zip.file('assets/school-logo', blob);
    manifest.school.logo = 'assets/school-logo';
    manifest.assets.schoolLogo = 'assets/school-logo';
  }
  for (const field of ['logoLeft','logoRight'] as const) { if (manifest.school[field]?.startsWith('data:')) { const blob=await dataUrlToBlob(manifest.school[field]); const path=`assets/${field}`; zip.file(path,blob); manifest.school[field]=path; manifest.assets[field]=path; } }
  if (manifest.school.watermark?.startsWith('data:')) {
    const blob = await dataUrlToBlob(manifest.school.watermark);
    zip.file('assets/watermark', blob);
    manifest.school.watermark = 'assets/watermark';
    manifest.assets.watermark = 'assets/watermark';
  }
  // Include the default school logo referenced by the untouched HTML template.
  // This keeps the template's existing header and watermark working in a standalone backup.
  try {
    const response = await fetch('/nps-logo.webp');
    if (response.ok) zip.file('nps-logo.webp', await response.blob());
  } catch { /* The user-uploaded logo, if any, is already included above. */ }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('marksheet-template.html', template);
  zip.file('README.txt', filenamePrefix === 'promote_' ? 'Marksheet Studio promotion package. Contains promoted student details, new class/session and newly assigned roll numbers. Previous examination marks and attendance values are intentionally excluded. Import this ZIP through Import / Export to start the destination class workspace.\n' : 'Marksheet Studio class backup. Contains the class data, marks, attendance, settings, template and referenced image assets. Import this ZIP in Marksheet Studio to restore the class data.\n');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const verified = await JSZip.loadAsync(blob);
  if (!verified.file('manifest.json') || !verified.file('marksheet-template.html')) throw new Error('Backup verification failed: required files are missing.');
  const verifiedManifest = JSON.parse(await verified.file('manifest.json')!.async('text'));
  if (!Array.isArray(verifiedManifest.students) || verifiedManifest.students.length !== data.students.length) throw new Error('Backup verification failed: student record count mismatch.');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T','_').replace('Z','');
  const promotionMeta = (extraManifest.promotion || {}) as { fromClass?: string; toClass?: string; toSession?: string };
  a.download = filenamePrefix === 'promote_' && promotionMeta.fromClass && promotionMeta.toClass
    ? `promote_class-${safeName(promotionMeta.fromClass)}-to-${safeName(promotionMeta.toClass)}_session-${safeName(promotionMeta.toSession || data.academicSession)}_${timestamp}.zip`
    : `${filenamePrefix}marksheet-studio_class-${safeName(data.classInfo.className)}${data.classInfo.section ? `_${safeName(data.classInfo.section)}` : ''}_session-${safeName(data.academicSession)}_${backupLabel}_${timestamp}.zip`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (value: string) => String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';

export function buildPromotionData(data: AppData, destinationClass: string, destinationSession: string): AppData {
  const sorted = [...data.students].sort((a, b) => {
    const total = (studentId: string) => data.results.final.find(m => m.studentId === studentId)
      ? data.subjects.filter(subject => subject.enabled !== false).reduce((sum, subject) => sum + (Number(data.results.final.find(m => m.studentId === studentId)?.[subject.id]) || 0), 0) : 0;
    const marksDiff = total(b.studentId) - total(a.studentId);
    if (marksDiff) return marksDiff;
    const attendancePct = (student: Student) => student.attendance.workingDays > 0 ? student.attendance.daysPresent / student.attendance.workingDays : 0;
    const attendanceDiff = attendancePct(b) - attendancePct(a);
    if (attendanceDiff) return attendanceDiff;
    const ar = Number(a.roll), br = Number(b.roll);
    if (Number.isFinite(ar) && Number.isFinite(br) && ar !== br) return ar - br;
    return a.roll.localeCompare(b.roll, undefined, { numeric: true });
  });
  const nextSubjects = subjectsForClass(destinationClass);
  const students = sorted.map((student, index) => ({
    ...student, roll: String(index + 1),
    attendance: { workingDays: 0, daysPresent: 0, daysAbsent: 0, remarks: '' },
    remarks: { overall: '', attendance: '', subjects: Object.fromEntries(nextSubjects.map(subject => [subject.id, ''])) }
  }));
  const results: AppData['results'] = { pa1: [], pa2: [], hy: [], pa3: [], pa4: [], final: [] };
  const classSubjectConfigs = { ...structuredClone(data.classSubjectConfigs), [destinationClass]: nextSubjects };
  return { ...structuredClone(data), academicSession: destinationSession, classInfo: { ...data.classInfo, className: destinationClass, totalWorkingDays: 0 }, subjects: nextSubjects, classSubjectConfigs, students, results };
}

export async function exportPromotionZip(data: AppData, template: string, destinationClass: string, destinationSession: string) {
  const promotion = buildPromotionData(data, destinationClass, destinationSession);
  await exportZip(promotion, template, 'promote_', 'promotion', { promotion: { fromClass: data.classInfo.className, fromSession: data.academicSession, toClass: destinationClass, toSession: destinationSession, ranking: 'final-marks-desc,attendance-percentage-desc,previous-roll-asc' } });
}

export async function importZip(file: File): Promise<AppData> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('ZIP does not contain manifest.json.');
  const raw = JSON.parse(await manifestFile.async('text'));
  const { backupType: _backupType, createdAt: _createdAt, promotion: _promotion, ...appData } = raw;
  const data = normalizeData(appData);
  const assets = raw.assets || {};
  for (const student of data.students) {
    const path = assets.photos?.[student.studentId] || (typeof student.photo === 'string' ? student.photo : '');
    if (path && !path.startsWith('data:') && zip.file(path)) {
      const blob = await zip.file(path)!.async('blob');
      student.photo = await blobToDataUrl(blob);
    }
  }
  for (const field of ['logo', 'logoLeft', 'logoRight', 'watermark'] as const) {
    const path = data.school[field];
    if (path && !path.startsWith('data:') && zip.file(path)) {
      data.school[field] = await blobToDataUrl(await zip.file(path)!.async('blob'));
    }
  }
  // If the backup was made before a custom logo was uploaded, restore the default school logo.
  if (!data.school.logo && zip.file('nps-logo.webp')) {
    data.school.logo = await blobToDataUrl(await zip.file('nps-logo.webp')!.async('blob'));
  }
  return data;
}
