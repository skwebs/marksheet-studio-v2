import JSZip from 'jszip';
import type { AppData, Student } from './types';
import { normalizeData } from './data';

const dataUrlToBlob = async (url: string) => (await fetch(url)).blob();
const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});
export async function exportZip(data: AppData, template: string) {
  const zip = new JSZip();
  const manifest: any = structuredClone(data);
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
  zip.file('README.txt', 'Marksheet Studio backup. Import this ZIP in Marksheet Studio to restore the class data and images.\n');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `marksheet-${data.classInfo.className}-${data.classInfo.section}-${data.academicSession}.zip`; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function importZip(file: File): Promise<AppData> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('ZIP does not contain manifest.json.');
  const raw = JSON.parse(await manifestFile.async('text'));
  const data = normalizeData(raw);
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
