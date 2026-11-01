import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import { Archive, BookOpen, Check, ChevronDown, Download, FileSpreadsheet, FileUp, ImagePlus, Printer, School, Settings, Users, ClipboardList, CalendarCheck, Eye, Save, Trash2, Upload, Plus, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ArrowRightLeft } from 'lucide-react';
import { loadData, saveData, listWorkspaces, loadWorkspace, loadWorkspaceSnapshot, saveWorkspace, moveStudentBetweenWorkspaces, renameClassWorkspace } from './db';
import { blankStudent, createDefaultData, emptyMarks, examPresets, getExamKeys, normalizeData, subjectsForClass } from './data';
import { calculatePromotionScore, getDataReadiness, getValidationLevel } from './calculations';
import { exportZip, exportPromotionZip, importZip, type PromotionRollMode } from './backup';
import { renderMarksheet } from './templateRenderer';
import type { AppData, ExamKey, Student } from './types';
import './style.css';

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file);
});

type CropDraft = { studentId: string; src: string; fileName: string };
function StudentPhotoCropModal({
  draft, onCancel, onApply, onUseOriginal, onSelectNewImage
}: {
  draft: CropDraft;
  onCancel: () => void;
  onApply: (studentId: string, imageDataUrl: string) => void;
  onUseOriginal: (studentId: string, imageDataUrl: string) => void;
  onSelectNewImage: (file: File) => void;
}) {
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const cropperRef = React.useRef<Cropper | null>(null);
  const [scale, setScale] = useState<'1x' | '1.5x' | '2x'>('1x');
  const [error, setError] = useState('');

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    let disposed = false;
    const initialize = () => {
      if (disposed || !image.naturalWidth || !image.naturalHeight) return;
      cropperRef.current?.destroy();
      cropperRef.current = new Cropper(image, {
        aspectRatio: 20 / 23, viewMode: 1, dragMode: 'move', autoCropArea: 0.92,
        cropBoxMovable: false, cropBoxResizable: false, movable: true, zoomable: true,
        zoomOnTouch: true, zoomOnWheel: true, rotatable: true, scalable: false,
        responsive: true, background: false, checkOrientation: true, guides: true,
        center: true, highlight: false, toggleDragModeOnDblclick: false
      });
    };
    if (image.complete && image.naturalWidth > 0) initialize();
    else image.addEventListener('load', initialize, { once: true });
    return () => { disposed = true; image.removeEventListener('load', initialize); cropperRef.current?.destroy(); cropperRef.current = null; };
  }, [draft.src]);

  const apply = () => {
    const cropper = cropperRef.current;
    if (!cropper) return;
    try {
      const multiplier = scale === '2x' ? 2 : scale === '1.5x' ? 1.5 : 1;
      const canvas = cropper.getCroppedCanvas({
        width: Math.round(400 * multiplier),
        height: Math.round(460 * multiplier),
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        fillColor: '#ffffff'
      });
      if (!canvas) throw new Error('Could not create the cropped photo. Try another image.');
      onApply(draft.studentId, canvas.toDataURL('image/jpeg', 0.92));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to crop this image.');
    }
  };

  return <div className="crop-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
    <section className="crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <header className="crop-modal-header">
        <div><h2 id="crop-title">Crop student photo</h2><p>Fixed portrait ratio 20:23 · Matches the marksheet photo frame. Drag and zoom to adjust.</p></div>
        <button className="icon-btn" type="button" aria-label="Close crop dialog" onClick={onCancel}>✕</button>
      </header>
      <div className="cropper-stage"><img ref={imageRef} src={draft.src} alt="Crop preview" /></div>
      <div className="crop-source-actions">
        <div className="crop-source-copy"><strong>Photo source</strong><span>{draft.fileName || 'Current student photo'}</span></div>
        <label className="btn"><ImagePlus size={15}/> Select new image<input hidden type="file" accept="image/*" onChange={async e => { const file = e.currentTarget.files?.[0]; if (file) { try { await file.arrayBuffer(); onSelectNewImage(file); } catch { setError('Could not read this image file.'); } } e.currentTarget.value = ''; }}/></label>
      </div>
      <div className="crop-controls">
        <div className="crop-tool-group">
          <button type="button" className="btn" onClick={() => cropperRef.current?.zoom(0.1)}>Zoom in +</button>
          <button type="button" className="btn" onClick={() => cropperRef.current?.zoom(-0.1)}>Zoom out −</button>
          <button type="button" className="btn" onClick={() => cropperRef.current?.rotate(-90)}>Rotate ↶</button>
          <button type="button" className="btn" onClick={() => cropperRef.current?.rotate(90)}>Rotate ↷</button>
          <button type="button" className="btn" onClick={() => cropperRef.current?.reset()}>Reset</button>
        </div>
        <label className="field crop-resolution"><span>Output resolution</span>
          <select value={scale} onChange={e => setScale(e.target.value as typeof scale)}>
            <option value="1x">300 × 400 px (1×)</option>
            <option value="1.5x">450 × 600 px (1.5×)</option>
            <option value="2x">600 × 800 px (2×)</option>
          </select>
        </label>
      </div>
      <p className="crop-output-note">The crop area stays fixed. Move, zoom, or rotate the image inside it.</p>
      {error && <p className="crop-error" role="alert">{error}</p>}
      <footer className="crop-modal-footer crop-modal-footer-split"><button className="btn" type="button" onClick={() => onUseOriginal(draft.studentId, draft.src)}>Use original image (skip crop)</button><div className="crop-footer-right"><button className="btn" type="button" onClick={onCancel}>Cancel</button><button className="btn btn-primary" type="button" onClick={apply}>Apply cropped photo</button></div></footer>
    </section>
  </div>;
}
function App() {
  const [data, setData] = useState<AppData>(createDefaultData());
  const [classNameDraft, setClassNameDraft] = useState(data.classInfo.className);
  const exams = getExamKeys(data);
  const readiness = getDataReadiness(data);
  const isClassConfigurationLocked = data.students.length > 0 && !data.settings.allowEditExistingClassConfig;
  const [section, setSection] = useState('students');
  const [exam, setExam] = useState<ExamKey>('pa1');
  const [template, setTemplate] = useState('');
  const [singleTemplate, setSingleTemplate] = useState('');
  const [status, setStatus] = useState('Loading local data…');
  const [busy, setBusy] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [importMode, setImportMode] = useState<'students' | ExamKey>('students');
  const [selectedUploadExams, setSelectedUploadExams] = useState<ExamKey[]>(['pa1']);
  const saveSequence = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const [notice, setNotice] = useState('');
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const [workspaces, setWorkspaces] = useState<Array<{id:string;data:AppData;updatedAt:string}>>([]);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [promotionClass, setPromotionClass] = useState('');
  const [promotionSession, setPromotionSession] = useState('');
  const [promotionRollMode, setPromotionRollMode] = useState<PromotionRollMode>('dynamic');
  const [selectedPromotionIds, setSelectedPromotionIds] = useState<string[]>([]);
  const selectAllPromotionRef = useRef<HTMLInputElement | null>(null);
  const promotionGenerationRef = useRef(false);
  const promotionRanked = [...data.students].map(student => ({ student, score: calculatePromotionScore(data, student), attendance: student.attendance.workingDays > 0 ? student.attendance.daysPresent / student.attendance.workingDays * 100 : 0 })).sort((a,b) => b.score.percentage-a.score.percentage || b.score.obtained-a.score.obtained || b.attendance-a.attendance || a.student.roll.localeCompare(b.student.roll, undefined, {numeric:true}));
  const allPromotionSelected = data.students.length > 0 && selectedPromotionIds.length === data.students.length;
  const somePromotionSelected = selectedPromotionIds.length > 0 && !allPromotionSelected;
  useEffect(() => { if (selectAllPromotionRef.current) selectAllPromotionRef.current.indeterminate = somePromotionSelected; }, [somePromotionSelected]);
  useEffect(() => {
    setSelectedUploadExams(current => { const valid = current.filter(key => exams.includes(key)); return valid.length ? valid : [exams[0]]; });
    if (!exams.includes(exam)) setExam(exams[0]);
  }, [data.examOrder.join('|')]);
  useEffect(() => {
    Promise.all([loadData(), fetch('/marksheet-multi-exam.html').then(r => r.text()), fetch('/marksheet-single-exam.html').then(r => r.text())]).then(async ([saved, html, singleHtml]) => {
      const initial = saved ? normalizeData(saved) : createDefaultData();
      setData(initial);
      setWorkspaces(await listWorkspaces());
      setTemplate(html); setSingleTemplate(singleHtml); setStatus(saved ? 'Loaded from this browser' : 'Ready · data saves locally');
    }).catch(() => setStatus('Ready · local data not loaded'));
  }, []);
  useEffect(() => {
    setClassNameDraft(data.classInfo.className);
  }, [data.classInfo.className]);
  useEffect(() => {
    if (!template) return;
    const sequence = ++saveSequence.current;
    setStatus('Editing…');
    const id = window.setTimeout(() => {
      saveTimerRef.current = null;
      setStatus('Saving…');
      saveData(data).then(async () => { setWorkspaces(await listWorkspaces()); if (sequence === saveSequence.current) setStatus('Saved locally'); }).catch(() => { if (sequence === saveSequence.current) setStatus('Save failed — retry by editing or pressing Ctrl+S'); });
    }, 500);
    saveTimerRef.current = id;
    return () => { window.clearTimeout(id); if (saveTimerRef.current === id) saveTimerRef.current = null; };
  }, [data, template]);
  const switchWorkspace = async (id: string) => {
    const workspace = await loadWorkspace(id);
    if (!workspace) { alert('The selected class workspace could not be found.'); return; }
    const normalized = normalizeData(workspace);
    await saveData(normalized);
    setData(normalized); setSelectedStudent(normalized.students[0]?.studentId || '');
    setNotice(`Opened Class ${normalized.classInfo.className}, session ${normalized.academicSession}.`);
  };
  const commitActiveClassChange = async () => {
    const nextClass = classNameDraft.trim();
    const previousClass = data.classInfo.className;
    if (data.students.length > 0 && !data.settings.allowEditActiveClass) { setClassNameDraft(previousClass); return; }
    if (!nextClass || nextClass === previousClass) { setClassNameDraft(previousClass); return; }
    const nextData: AppData = {
      ...data,
      classInfo: { ...data.classInfo, className: nextClass },
      // Preserve the current subject/result structure during a workspace rename.
      classSubjectConfigs: { ...data.classSubjectConfigs, [nextClass]: data.subjects }
    };
    const destinationId = `workspace:${encodeURIComponent(nextData.academicSession)}:${encodeURIComponent(nextClass)}:${encodeURIComponent(nextData.classInfo.section || '')}`;
    const existingDestination = await loadWorkspaceSnapshot(destinationId);
    if (existingDestination) {
      alert(`Class ${nextClass} already has a saved workspace for session ${data.academicSession}. Open it using Saved class workspaces instead of overwriting it.`);
      setClassNameDraft(previousClass);
      return;
    }
    if (!confirm(`Change the active workspace class from ${previousClass} to ${nextClass}? All students, marks, attendance, subjects and settings in this workspace will remain together. Another saved workspace will not be overwritten.`)) {
      setClassNameDraft(previousClass);
      return;
    }
    if (saveTimerRef.current !== null) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    saveSequence.current += 1;
    const result = await renameClassWorkspace(data, nextData);
    if (result === 'exists') {
      alert(`Class ${nextClass} already has a saved workspace. No data was changed.`);
      setClassNameDraft(previousClass);
      return;
    }
    setData(nextData);
    setClassNameDraft(nextClass);
    setWorkspaces(await listWorkspaces());
    setNotice(result === 'renamed' ? `Active workspace renamed to Class ${nextClass}. Student records and results were preserved.` : `Active class changed to ${nextClass}. Review the class subjects before entering new marks.`);
  };
  const moveStudentToClass = async (studentId: string) => {
    if (!data.settings.allowChangeExistingStudentClass) {
      alert('Enable Allow changing class of existing students in School Profile → Class configuration first.');
      return;
    }
    const student = data.students.find(item => item.studentId === studentId);
    if (!student) return;
    const destinationClass = prompt(`Move ${student.name || `Roll ${student.roll}`} to which class?`, '');
    const nextClass = destinationClass?.trim();
    if (!nextClass || nextClass === data.classInfo.className) return;
    if (!confirm(`Move ${student.name || `Roll ${student.roll}`} (Roll ${student.roll}) from Class ${data.classInfo.className} to Class ${nextClass} for session ${data.academicSession}? Their current-session marks, attendance, photo and remarks will move with the student. Previous-session workspaces will remain unchanged.`)) return;
    const destinationInfo = { ...data.classInfo, className: nextClass };
    const destinationId = `workspace:${encodeURIComponent(data.academicSession)}:${encodeURIComponent(nextClass)}:${encodeURIComponent(destinationInfo.section || '')}`;
    const destinationSnapshot = await loadWorkspaceSnapshot(destinationId);
    const existingWorkspace = destinationSnapshot?.data;
    const destinationBase = existingWorkspace ? normalizeData(existingWorkspace) : {
      ...data,
      classInfo: destinationInfo,
      subjects: data.classSubjectConfigs[nextClass] || subjectsForClass(nextClass),
      students: [],
      results: Object.fromEntries(Object.keys(data.results).map(key => [key, []])) as AppData['results'],
      classSubjectConfigs: { ...data.classSubjectConfigs, [nextClass]: data.classSubjectConfigs[nextClass] || subjectsForClass(nextClass) }
    };
    if (destinationBase.students.some(item => item.studentId === studentId)) {
      alert(`This student already exists in Class ${nextClass}, session ${data.academicSession}. No records were changed.`);
      return;
    }
    if (destinationBase.students.some(item => item.roll.trim().toLowerCase() === student.roll.trim().toLowerCase())) {
      alert(`Roll ${student.roll} is already used in Class ${nextClass}, session ${data.academicSession}. Change the roll in one class before moving this student.`);
      return;
    }
    const sourceMarks = Object.fromEntries(Object.keys(data.results).map(key => {
      const row = (data.results[key] || []).find(mark => mark.studentId === studentId || (!mark.studentId && mark.roll === student.roll));
      return [key, row ? { ...row, studentId, roll: student.roll } : null];
    })) as Record<string, (AppData['results'][string][number] | null)>;
    const destinationResults = { ...destinationBase.results };
    Object.entries(sourceMarks).forEach(([key, row]) => {
      if (!row) return;
      const rows = destinationResults[key] || [];
      destinationResults[key] = [...rows.filter(mark => mark.studentId !== studentId && mark.roll !== student.roll), row];
    });
    const destinationData: AppData = { ...destinationBase, students: [...destinationBase.students, student], results: destinationResults };
    const sourceData: AppData = {
      ...data,
      students: data.students.filter(item => item.studentId !== studentId),
      results: Object.fromEntries(Object.keys(data.results).map(key => [key, (data.results[key] || []).filter(mark => mark.studentId !== studentId && mark.roll !== student.roll)])) as AppData['results']
    };
    try {
      await saveData(data);
      const moved = await moveStudentBetweenWorkspaces(sourceData, destinationData, studentId, destinationSnapshot?.updatedAt ?? null);
      if (!moved) { alert('The destination workspace changed or already contains this student. Refresh the workspace list and try again. No records were moved.'); return; }
      setData(sourceData);
      if (selectedStudent === studentId) setSelectedStudent(sourceData.students[0]?.studentId || '');
      setWorkspaces(await listWorkspaces());
      setNotice(`Moved ${student.name || `Roll ${student.roll}`} to Class ${nextClass}. Current-session marks and attendance moved with the student; previous-session records were preserved.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not move the student. The original record was retained.');
    }
  };
  const currentStudent = data.students.find(s => s.studentId === (selectedStudent || data.students[0]?.studentId));
  const activeTemplate = data.marksheetSettings.reportExams?.length === 1 && singleTemplate ? singleTemplate : template;
  const setSchool = (field: 'name' | 'address' | 'established' | 'registrationNumber' | 'affiliation', value: string) => setData(d => ({ ...d, school: { ...d.school, [field]: value } }));
  const updateStudent = (id: string, field: string, value: any) => {
    if (field === 'roll') {
      const duplicate = data.students.some(student => student.studentId !== id && student.roll.trim().toLowerCase() === String(value).trim().toLowerCase());
      if (duplicate) { setNotice(`Roll ${value} is already used in Class ${data.classInfo.className}, session ${data.academicSession}. The composite key is session + class + roll.`); return; }
    }
    setData(d => ({ ...d, students: d.students.map(s => s.studentId === id ? { ...s, [field]: value } : s) }));
  };
  const addStudent = () => {
    let nextRoll = 1; while (data.students.some(student => student.roll.trim() === String(nextRoll))) nextRoll++;
    const s = blankStudent(nextRoll, data.subjects);
    setData(d => ({ ...d, students: [...d.students, s], results: Object.fromEntries(Object.keys(d.results).map(k => [k, [...(d.results[k] || []), emptyMarks(s, d.subjects)]])) as AppData['results'] }));
    setSelectedStudent(s.studentId);
  };
  const deleteStudent = (id: string) => {
    if (!confirm('Delete this student and their marks?')) return;
    setData(d => ({ ...d, students: d.students.filter(s => s.studentId !== id), results: Object.fromEntries(Object.keys(d.results).map(k => [k, (d.results[k] || []).filter(m => m.studentId !== id)])) as AppData['results'] }));
    if (selectedStudent === id) setSelectedStudent('');
  };
  const resetMarks = async () => {
    if (!confirm(`Reset all examination marks for Class ${data.classInfo.className}, session ${data.academicSession}? Student details, photos, roll numbers and attendance will be preserved.`)) return;
    try {
      setBusy(true);
      await exportZip(data, template, '', 'pre-reset', {}, singleTemplate);
      if (!confirm('The verified class backup download has been started. Confirm that you have saved the ZIP file before clearing marks.')) return;
      const cleared = { ...data, results: Object.fromEntries(Object.keys(data.results).map(key => [key, []])) as AppData['results'] };
      await saveData(cleared); setData(cleared); setNotice('All examination marks were reset. Student details and attendance were preserved.');
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not create and verify the backup. Marks were not reset.'); }
    finally { setBusy(false); }
  };
  const resetStudents = async () => {
    if (!confirm(`Reset all student records for Class ${data.classInfo.className}, session ${data.academicSession}? This also removes their marks, attendance and photos. School profile and marksheet settings will remain.`)) return;
    try {
      setBusy(true);
      await exportZip(data, template, '', 'pre-reset', {}, singleTemplate);
      if (!confirm('The verified class backup download has been started. Confirm that you have saved the ZIP file before deleting student records.')) return;
      const phrase = prompt(`Type RESET CLASS ${data.classInfo.className} to permanently remove this class/session student data.`);
      if (phrase !== `RESET CLASS ${data.classInfo.className}`) { setNotice('Student reset cancelled. No records were deleted.'); return; }
      const cleared: AppData = { ...data, students: [], results: Object.fromEntries(Object.keys(data.results).map(key => [key, []])) as AppData['results'], classInfo: { ...data.classInfo, totalWorkingDays: 0 } };
      await saveData(cleared); setData(cleared); setSelectedStudent(''); setNotice('Student records, marks and attendance were reset. School and marksheet settings were preserved.');
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not create and verify the backup. Student data was not reset.'); }
    finally { setBusy(false); }
  };
  const openPromotion = () => {
    if (!data.settings.promotionExams.length) { alert('Select at least one examination in Settings → Promotion result calculation.'); return; }
    const currentClassNumber = Number(String(data.classInfo.className).match(/\d+/)?.[0]);
    const suggestedClass = Number.isFinite(currentClassNumber) && currentClassNumber > 0 ? String(currentClassNumber + 1) : '';
    const years = data.academicSession.match(/(\d{4})\s*[-–/]\s*(\d{2,4})/);
    const suggestedSession = years ? `${Number(years[1]) + 1}-${String(Number(years[2].length === 2 ? `20${years[2]}` : years[2]) + 1).slice(-2)}` : data.academicSession;
    setPromotionClass(suggestedClass);
    setPromotionSession(suggestedSession);
    setSelectedPromotionIds(data.students.map(student => student.studentId));
    setPromotionRollMode('dynamic');
    setPromotionOpen(true);
  };
  const generatePromotion = async () => {
    if (!promotionClass.trim() || !promotionSession.trim()) { alert('Destination class and academic session are required.'); return; }
    if (!selectedPromotionIds.length) { alert('Select at least one student to promote.'); return; }
    // Guard against rapid repeated clicks while ZIP creation is still running.
    if (promotionGenerationRef.current) return;
    promotionGenerationRef.current = true;
    const selectedRanked = promotionRanked.filter(item => selectedPromotionIds.includes(item.student.studentId));
    try {
      setBusy(true);
      await exportPromotionZip(data, template, promotionClass.trim(), promotionSession.trim(), selectedPromotionIds, singleTemplate, promotionRollMode);
      setPromotionOpen(false);
      setNotice(`One promotion ZIP generated for ${selectedRanked.length} selected student(s), Class ${promotionClass}, session ${promotionSession}. ${promotionRollMode === 'static' ? 'Static' : 'Dynamic'} roll assignment was applied. Marks and attendance were excluded.`);
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not generate promotion ZIP.'); }
    finally { promotionGenerationRef.current = false; setBusy(false); }
  };
  const changeExamPreset = (preset: AppData['examPreset']) => {
    const nextOrder = preset === 'custom' ? exams : examPresets[preset];
    if (!nextOrder.length) return;
    setData(d => { const defaults = createDefaultData(); const nextConfigs = { ...d.exams }; const nextResults = { ...d.results }; nextOrder.forEach(key => { if (!nextConfigs[key]) nextConfigs[key] = defaults.exams[key]; if (!nextResults[key]) nextResults[key] = d.students.map(student => emptyMarks(student, d.subjects)); }); return { ...d, examPreset: preset, examOrder: [...nextOrder], exams: nextConfigs, results: nextResults, marksheetSettings: { ...d.marksheetSettings, reportExams: d.marksheetSettings.reportExams.filter(key => nextOrder.includes(key)).length ? d.marksheetSettings.reportExams.filter(key => nextOrder.includes(key)) : [nextOrder[0]], calculationExams: d.marksheetSettings.calculationExams.filter(key => nextOrder.includes(key)).length ? d.marksheetSettings.calculationExams.filter(key => nextOrder.includes(key)) : [nextOrder[0]] }, settings: { ...d.settings, promotionExams: d.settings.promotionExams.filter(key => nextOrder.includes(key)).length ? d.settings.promotionExams.filter(key => nextOrder.includes(key)) : [...nextOrder] } }; });
    if (!nextOrder.includes(exam)) setExam(nextOrder[0]);
  };
  const addCustomExam = () => {
    const key = `custom_${crypto.randomUUID()}`;
    const label = `Custom Exam ${Object.keys(data.exams).filter(item => item.startsWith('custom_')).length + 1}`;
    setData(d => ({ ...d, examPreset: 'custom', examOrder: [...d.examOrder, key], exams: { ...d.exams, [key]: { name: label, shortName: label, maxMarks: 100, weightage: 100 } }, results: { ...d.results, [key]: d.students.map(student => emptyMarks(student, d.subjects)) }, marksheetSettings: { ...d.marksheetSettings, reportExams: [...d.marksheetSettings.reportExams, key], calculationExams: [...d.marksheetSettings.calculationExams, key] }, settings: { ...d.settings, promotionExams: [...d.settings.promotionExams, key], recommendedExamMarks: [...d.settings.recommendedExamMarks, key] } }));
    setExam(key);
  };
  const moveExam = (key: ExamKey, direction: -1 | 1) => setData(d => { const order = [...d.examOrder]; const index = order.indexOf(key); const next = index + direction; if (index < 0 || next < 0 || next >= order.length) return d; [order[index], order[next]] = [order[next], order[index]]; return { ...d, examPreset: 'custom', examOrder: order }; });
  const removeExam = (key: ExamKey) => {
    if (exams.length <= 1) { alert('At least one examination must remain configured.'); return; }
    if (!confirm(`Remove ${data.exams[key].name} and its stored marks from this workspace? This cannot be undone without a backup.`)) return;
    setData(d => { const nextExams = { ...d.exams }; const nextResults = { ...d.results }; delete nextExams[key]; delete nextResults[key]; const order = d.examOrder.filter(item => item !== key); return { ...d, examPreset: 'custom', examOrder: order, exams: nextExams, results: nextResults, marksheetSettings: { ...d.marksheetSettings, reportExams: d.marksheetSettings.reportExams.filter(item => item !== key), calculationExams: d.marksheetSettings.calculationExams.filter(item => item !== key) }, settings: { ...d.settings, promotionExams: d.settings.promotionExams.filter(item => item !== key), requiredExamMarks: d.settings.requiredExamMarks.filter(item => item !== key), recommendedExamMarks: d.settings.recommendedExamMarks.filter(item => item !== key) } }; });
    if (exam === key) setExam(exams.find(item => item !== key) || '');
  };
  const handleStudentGridKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>, row: number, col: number) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      setStatus('Saving…');
      saveData(data).then(() => setStatus('Saved locally')).catch(() => setStatus('Save failed — retry'));
      return;
    }
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.shiftKey || event.key === 'ArrowUp' ? -1 : 1;
      const targetRow = row + direction;
      if (targetRow >= 0 && targetRow < data.students.length) {
        document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-student-row="${targetRow}"][data-student-col="${col}"]`)?.focus();
      } else if (direction > 0 && row === data.students.length - 1 && event.key === 'Enter') {
        addStudent();
        window.setTimeout(() => document.querySelector<HTMLInputElement>(`[data-student-row="${data.students.length}"][data-student-col="0"]`)?.focus(), 0);
      }
    }
  };
  const downloadStudentTemplate = () => {
    const headers = data.settings.sectionEnabled ? ['Session','Class','Section','Roll','Name','Father','Mother','Gender'] : ['Session','Class','Roll','Name','Father','Mother','Gender'];
    const example = data.settings.sectionEnabled
      ? [data.academicSession, data.classInfo.className, data.classInfo.section, '1', 'Aarav Kumar', 'Rajesh Kumar', 'Sunita Devi', 'Male']
      : [data.academicSession, data.classInfo.className, '1', 'Aarav Kumar', 'Rajesh Kumar', 'Sunita Devi', 'Male'];
    const csv = [headers, example].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'students-template.csv'; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const setMark = (studentId: string, subjectId: string, value: string) => {
    const parsed = value === '' ? null : Number(value);
    const max = data.exams[exam].maxMarks;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed > max)) return;
    setData(d => ({ ...d, results: { ...d.results, [exam]: d.results[exam].map(m => m.studentId === studentId ? { ...m, [subjectId]: parsed } : m) } }));
  };
  const downloadCsv = (filename: string, rows: unknown[][]) => { const csv = rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\r\n'); const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); const a=document.createElement('a');a.href=url;a.download=filename;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000); };
  const downloadExamSample = (key: ExamKey) => { const subjects=data.subjects.filter(s=>s.enabled!==false); const header=['Session','Exam','Class',...(data.settings.sectionEnabled?['Section']:[]),'Roll',...subjects.map(s=>s.name)]; const rows=[header,[data.academicSession,data.exams[key].shortName,data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'1',...subjects.map(()=>2)],[data.academicSession,data.exams[key].shortName,data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'2',...subjects.map(()=>3)]]; downloadCsv(`${key}-marks-sample.csv`,rows); };
  const downloadCombinedSample = () => { const subjects=data.subjects.filter(s=>s.enabled!==false); const wb=XLSX.utils.book_new(); const examHeaders=['Session','Exam','Class',...(data.settings.sectionEnabled?['Section']:[]),'Roll',...subjects.map(s=>s.name)]; const examRows:unknown[][]=[examHeaders]; exams.forEach(k=>{examRows.push([data.academicSession,data.exams[k].shortName,data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'1',...subjects.map(()=>Math.min(3,data.exams[k].maxMarks))]);examRows.push([data.academicSession,data.exams[k].shortName,data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'2',...subjects.map(()=>Math.min(4,data.exams[k].maxMarks))]);}); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(examRows),'Exam Marks'); const studentHeaders=['Session','Class',...(data.settings.sectionEnabled?['Section']:[]),'Roll','Name','Father','Mother','Gender']; const studentRows=[studentHeaders,[data.academicSession,data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'1','Aarav Kumar','Rajesh Kumar','Sunita Devi','Male'],[data.academicSession,data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'2','Priya Kumari','Sanjay Kumar','Meena Devi','Female']]; XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(studentRows),'Students'); XLSX.writeFile(wb,'marksheet-studio-combined-sample.xlsx'); };
  const importSpreadsheet = async (file?: File, selectedMode: 'students' | ExamKey = importMode) => {
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const preferredSheet = selectedMode === 'students' ? 'students' : 'exam marks';
      const selectedSheetName = wb.SheetNames.find(name => name.trim().toLowerCase() === preferredSheet) || wb.SheetNames[0];
      const firstSheet = wb.Sheets[selectedSheetName];
      if (!firstSheet) throw new Error('The workbook has no worksheet.');
      const matrix = XLSX.utils.sheet_to_json<any[]>(firstSheet, { header: 1, defval: '', blankrows: true });
      const normalizeHeader = (value: unknown) => String(value ?? '').toLowerCase().trim().replace(/[ _-]/g, '');
      const requiredHeaderSets = selectedMode === 'students'
        ? [['roll','rollno','rollnumber'], ['name','studentname']]
        : [['roll','rollno','rollnumber']];
      const headerIndex = matrix.findIndex(row => {
        const values = row.map(normalizeHeader);
        return requiredHeaderSets.every(aliases => aliases.some(alias => values.includes(alias))) && (selectedMode === 'students' ? values.some(v => ['name','studentname'].includes(v)) : values.some(v => data.subjects.some(subject => normalizeHeader(subject.name) === v || normalizeHeader(subject.id) === v)));
      });
      if (headerIndex < 0) throw new Error('Could not detect the column header row. Required columns include Roll and Name (student import), or Roll and Exam (result import). A Class column is recommended.');
      const headers = (matrix[headerIndex] as unknown[]).map((value, index) => String(value ?? '').trim() || `__column_${index}`);
      const rows = matrix.slice(headerIndex + 1).filter(row => row.some(value => String(value ?? '').trim() !== '')).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) as Record<string, any>);
      if (!rows.length) throw new Error('No data rows found below the detected header row.');
      const normalizeKey = (value: string) => value.toLowerCase().trim().replace(/[ _-]/g, '');
      const key = (obj: Record<string, any>, names: string[]) => {
        const wanted = names.map(normalizeKey);
        const found = Object.keys(obj).find(k => wanted.includes(normalizeKey(k)));
        return found ? obj[found] : '';
      };
      const examFromValue = (value: unknown): ExamKey | undefined => {
        const v = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const configuredMatch = data.examOrder.find(key => {
          const config = data.exams[key];
          return [key, config?.shortName, config?.name].some(label => String(label || '').toLowerCase().replace(/[^a-z0-9]/g, '') === v);
        });
        if (configuredMatch) return configuredMatch;
        const aliases: Record<string, ExamKey> = {
          pa1: 'pa1', pai: 'pa1', periodicassessment1: 'pa1', periodicassessmenti: 'pa1', periodicassessmentone: 'pa1',
          pa2: 'pa2', paii: 'pa2', periodicassessment2: 'pa2', periodicassessmentii: 'pa2', periodicassessmenttwo: 'pa2',
          hy: 'hy', halfyearly: 'hy', halfyearexam: 'hy', halfyearexamination: 'hy',
          pa3: 'pa3', paiii: 'pa3', periodicassessment3: 'pa3', periodicassessmentiii: 'pa3',
          pa4: 'pa4', paiv: 'pa4', periodicassessment4: 'pa4', periodicassessmentiv: 'pa4',
          final: 'final', finalexam: 'final', finalexamination: 'final'
        };
        const alias = aliases[v];
        return alias && data.examOrder.includes(alias) ? alias : undefined;
      };
      if (selectedMode === 'students') {
        const imported = rows.map((r, i) => {
          const s = blankStudent(i + 1, data.subjects);
          s.roll = String(key(r, ['roll','rollno','rollnumber']) ?? '').trim();
          s.name = String(key(r, ['name','studentname']) ?? '').trim();
          s.father = String(key(r, ['father','fathername']) ?? '').trim();
          s.mother = String(key(r, ['mother','mothername']) ?? '').trim();
          s.dob = String(key(r, ['dob','dateofbirth']) ?? '').trim();
          const rawGender = String(key(r, ['gender','sex']) ?? '').trim();
          const genderKey = rawGender.toLowerCase();
          s.gender = !rawGender ? '' : ['m','male','boy'].includes(genderKey) ? 'Male' : ['f','female','girl'].includes(genderKey) ? 'Female' : ['other','others'].includes(genderKey) ? 'Other' : rawGender;
          return { student: s, session: String(key(r, ['session','academicsession']) ?? '').trim(), className: String(key(r, ['class','classname','grade']) ?? '').trim(), section: String(key(r, ['section','sec']) ?? '').trim(), row: headerIndex + i + 2 };
        });
        const errors: string[] = [];
        imported.forEach(item => { if (!item.student.roll) errors.push(`Row ${item.row}: Roll is required.`); if (!item.student.name) errors.push(`Row ${item.row}: Name is required.`); });
        const invalidRows = new Set<number>();
        imported.forEach(item => { if (!item.student.roll || !item.student.name) invalidRows.add(item.row); });
        const valid = imported.filter(item => !invalidRows.has(item.row));
        if (!valid.length) throw new Error(`No valid student rows found.\n${errors.slice(0, 15).join('\n')}`);
        const compositeKeys = new Set<string>();
        valid.forEach(item => {
          const composite = `${item.session || data.academicSession}|${item.className || data.classInfo.className}|${item.student.roll.trim().toLowerCase()}`;
          if (compositeKeys.has(composite)) throw new Error(`Duplicate composite key found: session + class + roll (${composite.replace(/\|/g, ' / ')}).`);
          compositeKeys.add(composite);
        });
        const groupMap = new Map<string, typeof valid>();
        valid.forEach(item => {
          const groupSession = item.session || data.academicSession;
          const groupClass = item.className || data.classInfo.className;
          const groupSection = data.settings.sectionEnabled ? (item.section || '') : '';
          const groupKey = [groupSession, groupClass, groupSection].join('|');
          groupMap.set(groupKey, [...(groupMap.get(groupKey) || []), item]);
        });
        const groups = [...groupMap.entries()];
        const classNames = [...new Set(valid.map(item => item.className || data.classInfo.className))];
        if (classNames.length > 1 && !data.settings.allowMultipleClassImport) {
          throw new Error(`Multiple classes detected in this file: ${classNames.join(', ')}.\n\nThe setting "Allowed multiple class import" is currently unchecked. Enable it in Settings to permit multi-class imports, or split the file into one class per file.`);
        }
        if (classNames.length > 1 && !confirm(`Multiple classes detected.\n\n${classNames.map(name => `Class ${name}: ${valid.filter(item => (item.className || data.classInfo.className) === name).length} student(s)`).join('\n')}\n\nEach class will be saved in a separate workspace. Continue?`)) return;
        const hasDifferentClass = classNames.some(name => name !== data.classInfo.className);
        if (classNames.length === 1 && hasDifferentClass && !confirm(`Class mismatch detected.\n\nSelected in app: Class ${data.classInfo.className}\nFound in file: Class ${classNames[0]}\n\nThe class in the file has priority. Import into Class ${classNames[0]}?`)) return;
        let hasStudentConflicts = false;
        for (const [groupKey, groupRows] of groups) {
          const [session, className, sectionValue] = groupKey.split('|');
          const existingWorkspace = await loadWorkspace(`workspace:${encodeURIComponent(session)}:${encodeURIComponent(className)}:${encodeURIComponent(sectionValue)}`);
          const existingRolls = new Set((existingWorkspace?.students || (className === data.classInfo.className && session === data.academicSession ? data.students : [])).map(st => st.roll.trim().toLowerCase()));
          if (groupRows.some(item => existingRolls.has(item.student.roll.trim().toLowerCase()))) { hasStudentConflicts = true; break; }
        }
        let strategy = '1';
        if (hasStudentConflicts) {
          const strategyRaw = prompt('Existing student conflicts detected. Choose import policy:\n1 = Preserve existing values and add new students (default)\n2 = Update matching student details\n3 = Replace the student list for each imported class (backup required)\n4 = Skip rows matching existing students', '1') || '1';
          strategy = ['1','2','3','4'].includes(strategyRaw) ? strategyRaw : '1';
        }
        const prepared: AppData[] = [];
        let inserted = 0, updated = 0, preserved = 0, skipped = 0;
        for (const [groupKey, groupRows] of groups) {
          const [session, className, sectionValue] = groupKey.split('|');
          const subjects = subjectsForClass(className);
          const groupBase = await loadWorkspace(`workspace:${encodeURIComponent(session)}:${encodeURIComponent(className)}:${encodeURIComponent(sectionValue)}`);
          const base = normalizeData(groupBase || { ...data, academicSession: session, classInfo: { ...data.classInfo, className, section: sectionValue }, subjects, students: [], results: Object.fromEntries(exams.map(k=>[k,[]])) });
          const existingByRoll = new Map<string, Student>(base.students.filter(st => st.roll.trim()).map(st => [st.roll.trim().toLowerCase(), st] as [string, Student]));
          const incoming = groupRows.map(item => item.student);
          const seen = new Set<string>();
          for (const student of incoming) { const k = student.roll.trim().toLowerCase(); if (seen.has(k)) throw new Error(`Duplicate roll ${student.roll} found in Class ${className}, session ${session}.`); seen.add(k); }
          const conflicts = incoming.filter(st => existingByRoll.has(st.roll.trim().toLowerCase()));
          if (strategy === '3' && conflicts.length) {
            await exportZip(base, template, '', 'pre-replace', {}, singleTemplate);
            if (!confirm(`A pre-replacement backup download was started for Class ${className}, session ${session}. Confirm it is saved before replacing this class roster.`)) throw new Error('Replacement cancelled.');
          }
          const importedStudents: Student[] = [];
          for (const student of incoming) {
            const existing = existingByRoll.get(student.roll.trim().toLowerCase());
            if (!existing) { importedStudents.push(student); inserted++; continue; }
            if (strategy === '4') { skipped++; importedStudents.push(existing); continue; }
            if (strategy === '1') { preserved++; importedStudents.push(existing); continue; }
            const updatedStudent = { ...existing, ...student, studentId: existing.studentId, photo: existing.photo, attendance: existing.attendance, remarks: existing.remarks };
            importedStudents.push(updatedStudent); updated++;
          }
          const finalStudents = strategy === '3' ? incoming.map(st => { const old = existingByRoll.get(st.roll.trim().toLowerCase()); return old ? { ...st, studentId: old.studentId, photo: old.photo, attendance: old.attendance, remarks: old.remarks } : st; }) : [...base.students.filter(old => !incoming.some(st => st.roll.trim().toLowerCase() === old.roll.trim().toLowerCase())), ...importedStudents];
          const nextResults = Object.fromEntries(Object.keys(base.results).map(k => [k, finalStudents.map(st => { const old = (base.results[k] || []).find(m => m.studentId === st.studentId); return { ...emptyMarks(st, subjects), ...(old || {}), studentId: st.studentId, roll: st.roll }; })])) as AppData['results'];
          const next = normalizeData({ ...base, academicSession: session, classInfo: { ...base.classInfo, className, section: sectionValue }, subjects, students: finalStudents, results: nextResults });
          await saveWorkspace(next); prepared.push(next);
        }
        const active = prepared.find(item => item.classInfo.className === data.classInfo.className && item.academicSession === data.academicSession) || prepared[0];
        await saveData(active); setData(active); setSelectedStudent(active.students[0]?.studentId || ''); setWorkspaces(await listWorkspaces());
        setNotice(`Student import completed across ${prepared.length} class/session workspace(s). Added ${inserted}, updated ${updated}, preserved ${preserved}, skipped ${skipped}.`);
      } else {
        if (!selectedUploadExams.length) throw new Error('Select at least one exam checkbox before importing results.');
        const selected: ExamKey[] = selectedUploadExams;
        const hasExamColumn = rows.some(r => String(key(r, ['exam','examname','examtype','assessment']) ?? '').trim() !== '');
        if (!hasExamColumn && selected.length !== 1) throw new Error('This file has no Exam column. Select exactly one exam, or add an Exam column with PA1, PA2, HY, PA3, PA4, or FINAL values.');
        const groupMap = new Map<string, Array<{ row: Record<string, any>; rowNumber: number }>>();
        rows.forEach((row, index) => {
          const session = String(key(row, ['session','academicsession']) ?? '').trim() || data.academicSession;
          const className = String(key(row, ['class','classname','grade']) ?? '').trim() || data.classInfo.className;
          const sectionValue = data.settings.sectionEnabled ? (String(key(row, ['section','sec']) ?? '').trim() || data.classInfo.section || '') : '';
          const groupKey = [session, className, sectionValue].join('|');
          groupMap.set(groupKey, [...(groupMap.get(groupKey) || []), { row, rowNumber: headerIndex + index + 2 }]);
        });
        const groups = [...groupMap.entries()];
        const classes = [...new Set(groups.map(([group]) => group.split('|')[1]))];
        if (classes.length === 1 && classes[0] !== data.classInfo.className && !confirm(`Class mismatch detected.\n\nSelected in app: Class ${data.classInfo.className}\nFound in file: Class ${classes[0]}\n\nThe class in the file has priority. The result file will be applied to the saved Class ${classes[0]} workspace.`)) return;
        if (classes.length > 1 && !data.settings.allowMultipleClassImport) throw new Error(`Multiple classes detected: ${classes.join(', ')}. Enable "Allowed multiple class import" in Settings or split the file by class.`);
        if (classes.length > 1 && !confirm(`Multiple classes detected in result file:\n${classes.map(name => `Class ${name}: ${rows.filter(r => String(key(r,['class','classname','grade']) || data.classInfo.className).trim()===name).length} row(s)`).join('\n')}\n\nEach class will be imported into its own saved workspace. Continue?`)) return;
        const strategyRaw = prompt('How should existing examination marks be handled?\n1 = Preserve existing marks (default)\n2 = Update matching marks from this file\n3 = Replace selected exam data for these class/session groups (backup required)\n4 = Skip rows that already have marks', '2') || '2';
        const strategy = ['1','2','3','4'].includes(strategyRaw) ? strategyRaw : '2';
        let totalValid = 0, totalUpdated = 0, totalSkipped = 0, totalIssues = 0;
        const issueLines: string[] = [];
        const prepared: AppData[] = [];
        for (const [groupKey, groupRows] of groups) {
          const [session, className, sectionValue] = groupKey.split('|');
          const workspaceKey = `workspace:${encodeURIComponent(session)}:${encodeURIComponent(className)}:${encodeURIComponent(sectionValue)}`;
          const stored = await loadWorkspace(workspaceKey);
          const target = normalizeData(stored || (className === data.classInfo.className && session === data.academicSession
            ? data
            : { ...data, academicSession: session, classInfo: { ...data.classInfo, className, section: sectionValue }, subjects: subjectsForClass(className), students: [], results: Object.fromEntries(exams.map(k=>[k,[]])) }));
          if (!stored && (className !== data.classInfo.className || session !== data.academicSession)) throw new Error(`Class ${className}, session ${session} has no saved student workspace. Import student details or open that workspace before importing results.`);
          const planned = Object.fromEntries(getExamKeys(target).map(key => [key, []])) as AppData['results'];
          const seenResultRows = new Set<string>();
          const foundExams = new Set<ExamKey>();
          for (const { row, rowNumber } of groupRows) {
            const rowExam: ExamKey | undefined = hasExamColumn ? examFromValue(key(row, ['exam','examname','examtype','assessment'])) : selected[0];
            if (!rowExam) { issueLines.push(`Row ${rowNumber}: Unknown or missing exam name.`); continue; }
            if (!selected.includes(rowExam)) { totalSkipped++; continue; }
            foundExams.add(rowExam);
            const roll = String(key(row, ['roll','rollno','rollnumber']) ?? '').trim();
            const student = target.students.find(st => st.roll.trim().toLowerCase() === roll.toLowerCase());
            if (!student) { issueLines.push(`Row ${rowNumber}: Student roll ${roll || '(blank)'} was not found in Class ${className}.`); continue; }
            const uniqueRowKey = `${rowExam}:${student.studentId}`;
            if (seenResultRows.has(uniqueRowKey)) { issueLines.push(`Row ${rowNumber}: Duplicate result row for ${rowExam.toUpperCase()}, roll ${roll}.`); continue; }
            seenResultRows.add(uniqueRowKey);
            const existing = target.results[rowExam].find(mark => mark.studentId === student.studentId) || emptyMarks(student, target.subjects);
            const next: any = { ...existing, studentId: student.studentId, roll: student.roll };
            let rowValid = true;
            target.subjects.forEach(subject => {
              const rawValue = key(row, [subject.id, subject.name, `${subject.name} marks`, `${subject.name} mark`]);
              if (rawValue === '' || rawValue === null || rawValue === undefined) return;
              const value = Number(rawValue);
              if (!Number.isFinite(value) || value < 0 || value > target.exams[rowExam].maxMarks) { issueLines.push(`Row ${rowNumber} (${rowExam.toUpperCase()}, roll ${roll}): ${subject.name} must be between 0 and ${target.exams[rowExam].maxMarks}.`); rowValid = false; }
              else next[subject.id] = value;
            });
            if (!rowValid) continue;
            if (target.results[rowExam].some(mark => mark.studentId === student.studentId)) totalUpdated++;
            planned[rowExam].push(next); totalValid++;
          }
          if (hasExamColumn) selected.filter(k => !foundExams.has(k)).forEach(k => issueLines.push(`Class ${className}: No rows for selected exam ${target.exams[k].name} were found.`));
          if (strategy === '3') {
            await exportZip(target, template, '', 'pre-replace', {}, singleTemplate);
            if (!confirm(`A verified backup download was started for Class ${className}, session ${session}. Confirm that it is saved before replacing selected exam data.`)) throw new Error('Result replacement cancelled.');
          }
          const nextResults = { ...target.results };
          for (const examKey of selected) {
            const incoming = planned[examKey];
            if (strategy === '3') nextResults[examKey] = [];
            const incomingById = new Map(incoming.map(mark => [mark.studentId, mark] as [string, (typeof incoming)[number]]));
            nextResults[examKey] = nextResults[examKey].map(old => {
              const incomingMark = incomingById.get(old.studentId);
              if (!incomingMark) return old;
              if (strategy === '4') { totalSkipped++; return old; }
              if (strategy === '1') {
                const preserved = { ...old } as typeof old;
                target.subjects.forEach(subject => { if (preserved[subject.id] === null || preserved[subject.id] === undefined || preserved[subject.id] === '') preserved[subject.id] = incomingMark[subject.id] ?? null; });
                totalSkipped++;
                return preserved;
              }
              return { ...old, ...incomingMark };
            });
            incoming.forEach(mark => {
              const exists = nextResults[examKey].some(old => old.studentId === mark.studentId);
              if (!exists) nextResults[examKey].push(mark);
            });
          }
          const next = { ...target, results: nextResults };
          await saveWorkspace(next); prepared.push(next);
        }
        if (!totalValid) throw new Error(`No valid result rows were imported.\n${issueLines.slice(0, 15).join('\n')}`);
        const active = prepared.find(item => item.classInfo.className === data.classInfo.className && item.academicSession === data.academicSession) || prepared[0];
        await saveData(active); setData(active); setWorkspaces(await listWorkspaces());
        totalIssues = issueLines.length;
        setNotice(`Result import completed for ${prepared.length} class/session workspace(s). Valid rows: ${totalValid}; existing rows reviewed: ${totalUpdated}; skipped: ${totalSkipped}; issues: ${totalIssues}.`);
        if (issueLines.length) alert(`Some result rows need attention:\n\n${issueLines.slice(0, 15).join('\n')}${issueLines.length>15?'\n…':''}`);
      }
    } catch (e) { alert(e instanceof Error ? e.message : 'Unable to import file.'); }
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const restored = await importZip(file);
      const incoming = restored.data;
      const existing = await loadWorkspace(`workspace:${encodeURIComponent(incoming.academicSession)}:${encodeURIComponent(incoming.classInfo.className)}:${encodeURIComponent(incoming.classInfo.section || '')}`);
      const previewText = `Backup preview\n\nType: ${restored.backupType}\nClass: ${incoming.classInfo.className}${incoming.classInfo.section ? `-${incoming.classInfo.section}` : ''}\nSession: ${incoming.academicSession}\nStudents: ${incoming.students.length}\nExaminations: ${incoming.examOrder.map(key => incoming.exams[key]?.shortName || key).join(', ')}\nSubjects: ${incoming.subjects.length}\nExisting workspace conflict: ${existing ? `YES (${existing.students.length} current students)` : 'No'}\nTemplate included: ${restored.template ? 'Yes' : 'No'}\nSingle-exam template included: ${restored.singleTemplate ? 'Yes' : 'No'}\n\n${existing ? 'This will replace the matching class/session workspace. Other workspaces will be retained.' : 'This will create/open this class/session workspace.'}`;
      if (!confirm(previewText + '\n\nContinue with restore?')) return;
      if (restored.template) setTemplate(restored.template);
      if (restored.singleTemplate) setSingleTemplate(restored.singleTemplate);
      await saveData(incoming); setData(incoming); setSelectedStudent(incoming.students[0]?.studentId || ''); setWorkspaces(await listWorkspaces()); setNotice(existing ? 'Backup restored. The matching class/session workspace was replaced; other workspaces were retained.' : 'Backup restored as a new class/session workspace.');
    } catch (e) { alert(e instanceof Error ? e.message : 'Unable to restore ZIP.'); }
  };
  const uploadAsset = async (file: File | undefined, kind: 'logoLeft' | 'logoRight' | 'watermark') => {
    if (!file) return;
    const image = await fileToDataUrl(file);
    setData(d => ({ ...d, school: { ...d.school, [kind]: image, ...(kind === 'logoLeft' ? { logo: image } : {}) } }));
  };
  const openCombinedDocument = (pages: string[], mode: 'preview' | 'print') => {
    const parsed = pages.map(html => new DOMParser().parseFromString(html, 'text/html'));
    const first = parsed[0];
    if (!first) throw new Error('No marksheets were generated.');
    const head = first.head.innerHTML;
    const pageMarkup = parsed.map(doc => {
      const sheet = doc.querySelector<HTMLElement>('.sheet');
      if (!sheet) throw new Error('The supplied HTML template does not contain the expected .sheet element.');
      return `<div class="generated-page">${sheet.outerHTML}</div>`;
    }).join('');
    const combined = `<!doctype html><html lang="en"><head>${head}<style>
      @page{size:A4 portrait;margin:0}
      html,body{margin:0!important;padding:0!important;width:210mm!important}
      .generated-page{width:210mm;height:297mm;overflow:hidden;position:relative;break-after:page;page-break-after:always}
      .generated-page:last-child{break-after:auto;page-break-after:auto}
      .generated-page .sheet{width:210mm!important;height:296mm!important;max-height:296mm!important;min-height:296mm!important;margin:0!important;overflow:hidden!important;break-inside:avoid!important;page-break-inside:avoid!important;box-shadow:none!important}
      @media screen{body{width:auto!important;min-width:0!important;background:#e0e0e0!important}.generated-page{margin:10px auto;width:210mm;height:297mm;background:#fff;box-shadow:0 1px 6px #0003}.generated-page .sheet{margin:0!important}}
      @media print{html,body{background:#fff!important}.generated-page{margin:0!important;box-shadow:none!important}.generated-page .sheet{margin:0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body class="A4 ${mode === 'print' ? 'print-document' : 'preview-document'}">${pageMarkup}</body></html>`;
    return combined;
  };
  const waitForDocumentReady = async (win: Window) => {
    await new Promise<void>(resolve => {
      if (win.document.readyState === 'complete') resolve();
      else win.addEventListener('load', () => resolve(), { once: true });
    });
    try { await (win.document as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* fonts are optional */ }
    await Promise.all([...win.document.images].map(img => img.complete ? Promise.resolve() : new Promise<void>(resolve => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
      window.setTimeout(resolve, 4000);
    })));
  };
  const confirmOutputReadiness = (action: string, studentIds?: string[]) => {
    const targetReadiness = studentIds ? getDataReadiness(data, studentIds) : readiness;
    const blocking = targetReadiness.missingRequiredStudents.length + targetReadiness.requiredMarksMissing.length + targetReadiness.missingRequiredItems.length;
    if (blocking) {
      const examples = [
        ...targetReadiness.missingRequiredStudents.slice(0, 5).map(student => `Student ${student.roll} · ${student.name || '(unnamed)'}: required student information missing`),
        ...targetReadiness.requiredMarksMissing.slice(0, 8).map(item => `Roll ${item.student.roll} · ${item.subject}: ${data.exams[item.exam]?.shortName || item.exam} marks missing`),
        ...targetReadiness.missingRequiredItems.slice(0, 8).map(item => `${item.label}${item.detail ? `: ${item.detail}` : ''} missing`)
      ];
      alert(`${action} is blocked because required data is incomplete.\n\n${examples.join('\n')}${blocking > examples.length ? `\n…and ${blocking - examples.length} more issue(s).` : ''}`);
      return false;
    }
    const recommendedCount = targetReadiness.missingRecommendedStudents.length + targetReadiness.recommendedMarksMissing.length + targetReadiness.missingRecommendedItems.length;
    if (recommendedCount && !confirm(`${recommendedCount} recommended item(s) are missing. These do not block output, but some student details or marksheet values may be absent.\n\nContinue to ${action.toLowerCase()}?`)) return false;
    return true;
  };
  const preview = async () => {
    if (!activeTemplate || !currentStudent) { alert('Add or import at least one student first.'); return; }
    if (!confirmOutputReadiness('Preview', [currentStudent.studentId])) return;
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to preview the marksheet.'); return; }
    try {
      const html = await renderMarksheet(activeTemplate, data, currentStudent);
      win.document.open(); win.document.write(html); win.document.close();
    } catch (e) { win.close(); alert(e instanceof Error ? e.message : 'Unable to generate marksheet preview.'); }
  };
  const previewAll = async () => {
    if (!activeTemplate || !data.students.length) { alert('Add or import students first.'); return; }
    if (!confirmOutputReadiness('Preview all')) return;
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to preview marksheets.'); return; }
    try {
      setBusy(true);
      const rendered = await Promise.all(data.students.map(s => renderMarksheet(activeTemplate, data, s)));
      win.document.open(); win.document.write(openCombinedDocument(rendered, 'preview')); win.document.close();
      await waitForDocumentReady(win);
    } catch (e) { win.close(); alert(e instanceof Error ? e.message : 'Unable to generate class preview.'); }
    finally { setBusy(false); }
  };
  const printAll = async () => {
    if (!activeTemplate || !data.students.length) { alert('Add or import students first.'); return; }
    if (!confirmOutputReadiness('Print all')) return;
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to print marksheets.'); return; }
    try {
      setBusy(true);
      const rendered = await Promise.all(data.students.map(s => renderMarksheet(activeTemplate, data, s)));
      win.document.open(); win.document.write(openCombinedDocument(rendered, 'print')); win.document.close();
      await waitForDocumentReady(win);
      win.focus();
      win.print();
    } catch (e) { win.close(); alert(e instanceof Error ? e.message : 'Unable to generate class marksheets.'); }
    finally { setBusy(false); }
  };
  const saveJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `class-${data.classInfo.className}-${data.classInfo.section}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const importJson = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = normalizeData(JSON.parse(await file.text()));
      if (!confirm('Replace current local dataset with this JSON file?')) return;
      setData(parsed); setNotice('JSON data imported.');
    } catch (e) { alert(e instanceof Error ? e.message : 'Invalid JSON file.'); }
  };
  const updateValidationLevel = (key: string, level: 'required' | 'recommended' | 'optional') => setData(d => {
    const validationLevels = { ...d.settings.validationLevels, [key]: level };
    if (key.startsWith('student.')) {
      const field = key.slice('student.'.length);
      return { ...d, settings: {
        ...d.settings, validationLevels,
        requiredStudentFields: level === 'required' ? [...d.settings.requiredStudentFields.filter(item => item !== field), field] : d.settings.requiredStudentFields.filter(item => item !== field),
        recommendedStudentFields: level === 'recommended' ? [...d.settings.recommendedStudentFields.filter(item => item !== field), field] : d.settings.recommendedStudentFields.filter(item => item !== field)
      } };
    }
    return { ...d, settings: { ...d.settings, validationLevels } };
  });
  const toggleReportExam = (key: ExamKey, checked: boolean) => setData(d => {
    const current = d.marksheetSettings.reportExams.filter(item => d.examOrder.includes(item));
    if (!checked && current.length <= 1) { alert('At least one examination must remain selected for the marksheet.'); return d; }
    const next = checked ? (() => { const ordered = [...current]; const keyOrder = d.examOrder.indexOf(key); const insertAt = ordered.findIndex(item => d.examOrder.indexOf(item) > keyOrder); if (insertAt < 0) ordered.push(key); else ordered.splice(insertAt, 0, key); return ordered; })() : current.filter(item => item !== key);
    return { ...d, marksheetSettings: { ...d.marksheetSettings, reportExams: next, calculationExams: checked && !d.marksheetSettings.calculationExams.includes(key) ? [...d.marksheetSettings.calculationExams, key] : d.marksheetSettings.calculationExams } };
  });
  const toggleCalculationExam = (key: ExamKey, checked: boolean) => setData(d => {
    const current = d.marksheetSettings.calculationExams;
    if (!checked && current.length <= 1) { alert('At least one examination must remain included in the marksheet totals.'); return d; }
    return { ...d, marksheetSettings: { ...d.marksheetSettings, calculationExams: checked ? [...current, key] : current.filter(item => item !== key) } };
  });
  const moveReportExam = (key: ExamKey, direction: -1 | 1) => setData(d => {
    const order = [...d.marksheetSettings.reportExams]; const index = order.indexOf(key); const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return d;
    [order[index], order[target]] = [order[target], order[index]];
    return { ...d, marksheetSettings: { ...d.marksheetSettings, reportExams: order } };
  });
  const validationRow = (key: string, label: string) => <label className="student-validation-row" key={key}>
    <span>{label}</span>
    <select value={getValidationLevel(data, key)} onChange={e => updateValidationLevel(key, e.target.value as 'required' | 'recommended' | 'optional')}>
      <option value="required">Required</option><option value="recommended">Recommended</option><option value="optional">Optional</option>
    </select>
  </label>;
  const nav = [
    ['students','Students',Users], ['school','School profile',School], ['marks','Exam marks',ClipboardList],
    ['attendance','Attendance & remarks',CalendarCheck], ['backup','Import / Export',Archive], ['help','Help & Guides',BookOpen]
  ] as const;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><School size={22}/></div><div><strong>Marksheet Studio</strong><small>Class result workspace</small></div></div>
      <div className="session-card"><span>ACADEMIC SESSION</span><input value={data.academicSession} disabled={data.students.length>0} title={data.students.length>0 ? "Create a backup and reset students before changing the session." : "Academic session"} onChange={e=>setData(d=>({...d,academicSession:e.target.value}))}/><div className="class-select"><label>Class</label><input value={classNameDraft} disabled={data.students.length > 0 && !data.settings.allowEditActiveClass} title={data.students.length === 0 ? "No student records exist; you can edit the class directly." : data.settings.allowEditActiveClass ? "Edit the active workspace class. Press Enter or leave the field to save." : "This class contains student records. Enable Allow editing class with existing students in School Profile to unlock this field."} onChange={e=>setClassNameDraft(e.target.value)} onBlur={()=>void commitActiveClassChange()} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/>{data.settings.sectionEnabled && <><label>Section</label><input value={data.classInfo.section} disabled={data.students.length>0} title={data.students.length>0 ? "Reset students before changing the section." : "Section"} onChange={e=>setData(d=>({...d,classInfo:{...d.classInfo,section:e.target.value}}))}/></>}</div><small className="class-lock-note">{data.students.length === 0 ? 'No student records exist in this workspace, so the Class field is editable by default.' : data.settings.allowEditActiveClass ? 'This workspace contains student records. Class editing is enabled; change the class name and press Enter or leave the field to rename this workspace. Existing destination workspaces cannot be overwritten.' : 'This workspace contains student records, so the Class field is locked by default. Enable Allow editing class with existing students in School Profile when you need to change it.'}</small></div>
      <div className="workspace-switcher"><label htmlFor="workspace-select">Saved class workspaces</label><select id="workspace-select" value={workspaces.find(w=>w.data.academicSession===data.academicSession && w.data.classInfo.className===data.classInfo.className && (w.data.classInfo.section||'')===(data.classInfo.section||''))?.id || ''} onChange={e=>{if(e.target.value) switchWorkspace(e.target.value);}}><option value="">Current workspace</option>{workspaces.map(w=><option key={w.id} value={w.id}>Class {w.data.classInfo.className}{w.data.classInfo.section ? `-${w.data.classInfo.section}` : ''} · {w.data.academicSession} · {w.data.students.length} students</option>)}</select></div><nav>{nav.map(([id,label,Icon])=><button key={id} className={section===id?'nav-item active':'nav-item'} onClick={()=>setSection(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot"/><span>{status}</span></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="eyebrow">CLASS DATA MANAGEMENT</div><h1>{nav.find(n=>n[0]===section)?.[1] || 'Dashboard'}</h1></div><div className="top-actions"><span className="save-status"><Check size={15}/>{status}</span><button className="btn btn-primary" onClick={preview}><Eye size={16}/> Preview selected</button></div></header>
      {notice && <div className="notice"><Check size={16}/>{notice}<button onClick={()=>setNotice('')}>Dismiss</button></div>}
      {section==='students' && <section className="panel">
        <div className="panel-heading"><div><h2>Students</h2><p>{data.students.length} student records · Session {data.academicSession} · Class {data.classInfo.className}{data.settings.sectionEnabled && data.classInfo.section ? ` · Section ${data.classInfo.section}` : ''} · Changes auto-save</p></div><div className="row-actions"><button className="btn" onClick={addStudent}>+ Add student</button><button className="btn" onClick={openPromotion} disabled={busy || !data.students.length}>Promote students</button><button className="btn btn-danger" onClick={resetStudents} disabled={busy}>Reset students</button><button className="btn" onClick={downloadStudentTemplate}><Download size={15}/> Template</button><label className="btn"><FileUp size={16}/> Import Excel/CSV<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={e=>{importSpreadsheet(e.target.files?.[0], 'students'); e.currentTarget.value='';}}/></label></div></div>
        <div className="data-readiness"><div><strong>Data readiness</strong><span>{readiness.totalStudents} students · {readiness.missingRequiredStudents.length} missing required student record(s) · {readiness.requiredMarksMissing.length} required mark(s) missing · {readiness.missingRequiredItems.length} other required item(s) missing · {readiness.missingRecommendedStudents.length + readiness.recommendedMarksMissing.length + readiness.missingRecommendedItems.length} recommended item(s) missing</span></div><span className={readiness.missingRequiredStudents.length || readiness.requiredMarksMissing.length || readiness.missingRequiredItems.length ? 'readiness-warning' : 'readiness-ready'}>{readiness.missingRequiredStudents.length || readiness.requiredMarksMissing.length || readiness.missingRequiredItems.length ? 'Needs attention' : 'Required data complete'}</span></div><div className="table-wrap"><table className="data-table student-table"><colgroup><col className="col-roll"/><col className="col-student-name"/><col className="col-parent"/><col className="col-parent"/><col className="col-gender"/><col className="col-photo"/><col className="col-actions"/></colgroup><thead><tr><th>Roll</th><th>Student name</th><th>Father</th><th>Mother</th><th>Gender</th><th>Photo</th><th></th></tr></thead><tbody>{data.students.map((s,rowIndex)=><tr key={s.studentId}><td><input data-student-row={rowIndex} data-student-col={0} onKeyDown={e=>handleStudentGridKeyDown(e,rowIndex,0)} className="cell-input roll" value={s.roll} onChange={e=>updateStudent(s.studentId,'roll',e.target.value)}/></td><td><input data-student-row={rowIndex} data-student-col={1} onKeyDown={e=>handleStudentGridKeyDown(e,rowIndex,1)} className="cell-input name" value={s.name} onChange={e=>updateStudent(s.studentId,'name',e.target.value)}/></td><td><input data-student-row={rowIndex} data-student-col={2} onKeyDown={e=>handleStudentGridKeyDown(e,rowIndex,2)} className="cell-input parent-input" value={s.father} onChange={e=>updateStudent(s.studentId,'father',e.target.value)}/></td><td><input data-student-row={rowIndex} data-student-col={3} onKeyDown={e=>handleStudentGridKeyDown(e,rowIndex,3)} className="cell-input parent-input" value={s.mother} onChange={e=>updateStudent(s.studentId,'mother',e.target.value)}/></td><td><select data-student-row={rowIndex} data-student-col={4} onKeyDown={e=>handleStudentGridKeyDown(e,rowIndex,4)} className="cell-input gender-input" value={s.gender} onChange={e=>updateStudent(s.studentId,'gender',e.target.value)}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></select></td><td><div className="photo-actions"><button type="button" className="photo-button" title={s.photo ? 'Open existing photo in cropper' : 'Upload student photo'} onClick={()=>{if(s.photo){setCropDraft({studentId:s.studentId,src:s.photo,fileName: s.name ? `${s.name} — current photo` : 'Current photo'});}else{document.getElementById(`photo-upload-${s.studentId}`)?.click();}}}>{s.photo ? <img src={s.photo} alt="Student photo" /> : <ImagePlus size={17}/>}</button><label className="photo-new-button" title="Select a new image">New<input id={`photo-upload-${s.studentId}`} hidden type="file" accept="image/*" onChange={async e=>{const f=e.currentTarget.files?.[0];if(f){try{setCropDraft({studentId:s.studentId,src:await fileToDataUrl(f),fileName:f.name});}catch{alert('Could not read this image file.');}}e.currentTarget.value='';}}/></label></div></td><td><div className="row-actions"><button type="button" className="icon-btn" title={data.settings.allowChangeExistingStudentClass ? "Move student to another class" : "Enable Allow changing class of existing students in School Profile first"} disabled={!data.settings.allowChangeExistingStudentClass} onClick={()=>void moveStudentToClass(s.studentId)}><ArrowRightLeft size={15}/></button><button className="icon-btn danger" title="Delete student" onClick={()=>deleteStudent(s.studentId)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table>{!data.students.length&&<div className="empty">No students yet. Add a student or import an Excel/CSV file.</div>}</div>
      </section>}
      {section==='students' && promotionOpen && <section className="panel promotion-panel"><div className="panel-heading"><div><h2>Promotion preview</h2><p>Students are ranked by converted weightage percentage, then obtained weightage, attendance and previous roll. New roll numbers follow this order.</p></div><button className="btn" onClick={()=>setPromotionOpen(false)}>Close</button></div><div className="form-grid"><label className="field"><span>Destination class</span><input value={promotionClass} onChange={e=>setPromotionClass(e.target.value)}/></label><label className="field"><span>New academic session</span><input value={promotionSession} onChange={e=>setPromotionSession(e.target.value)}/></label><label className="field"><span>New roll assignment</span><select value={promotionRollMode} onChange={e=>setPromotionRollMode(e.target.value as PromotionRollMode)}><option value="dynamic">Dynamic — selected students get consecutive rolls</option><option value="static">Static — preserve full-class ranking positions</option></select><small>Static mode keeps gaps for unselected students. Dynamic mode renumbers selected students from 1.</small></label></div><div className="data-readiness"><label><input ref={selectAllPromotionRef} type="checkbox" checked={allPromotionSelected} onChange={e=>setSelectedPromotionIds(e.target.checked?data.students.map(student=>student.studentId):[])}/> <strong>Select all students</strong></label><span>{selectedPromotionIds.length} of {data.students.length} selected</span></div><div className="table-wrap"><table className="data-table promotion-table"><thead><tr><th>Select</th><th>Rank</th><th>Old roll</th><th>New roll</th><th>Student</th><th>Weightage score</th><th>Percentage</th><th>Attendance</th></tr></thead><tbody>{promotionRanked.map((item,index)=><tr key={item.student.studentId}><td><input type="checkbox" checked={selectedPromotionIds.includes(item.student.studentId)} onChange={e=>setSelectedPromotionIds(previous=>e.target.checked?[...previous,item.student.studentId]:previous.filter(id=>id!==item.student.studentId))}/></td><td>{index+1}</td><td>{item.student.roll}</td><td>{selectedPromotionIds.includes(item.student.studentId) ? (promotionRollMode === 'static' ? index + 1 : promotionRanked.filter((rankedItem, rankedIndex) => rankedIndex <= index && selectedPromotionIds.includes(rankedItem.student.studentId)).length) : '—'}</td><td>{item.student.name}</td><td>{item.score.obtained.toFixed(data.marksheetSettings.marksPrecision)} / {item.score.maximum.toFixed(data.marksheetSettings.marksPrecision)}</td><td>{item.score.percentage.toFixed(2)}%</td><td>{item.attendance.toFixed(1)}%</td></tr>)}</tbody></table></div><div className="row-actions"><button className="btn" onClick={()=>setPromotionOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy || !selectedPromotionIds.length || !promotionClass.trim() || !promotionSession.trim()} onClick={generatePromotion}>Generate one promote_ ZIP ({selectedPromotionIds.length})</button></div><small className="muted">The generated ZIP contains selected student details and photos, destination class/session, roll assignment mode and an old-to-new roll mapping. Examination marks and attendance values are excluded.</small></section>}
      {section==='school' && <section className="panel"><div className="panel-heading"><div><h2>School profile</h2><p>These details populate your existing HTML template.</p></div></div>
        <details className="settings-group"><summary><span>School identity & header</span><small>School details, QR exam label and header information</small><button type="button" className="settings-group-close" aria-label="Collapse this settings section" title="Collapse section" onClick={e=>{e.preventDefault();e.stopPropagation();const group=e.currentTarget.closest('details');if(group)group.open=false;}}><X size={14}/><span>Close</span></button></summary>
        <div className="form-grid">
          {([['name','School name'],['address','School address']] as [('name'|'address'),string][]).map(([field,label])=><label className="field" key={field}><span>{label}</span><input value={data.school[field] || ''} onChange={e=>setSchool(field,e.target.value)}/></label>)}
          <label className="field"><span>Exam type (shown in QR code)</span><input value={data.examType} placeholder="HALF-YEAR EXAMINATION" onChange={e=>setData(d=>({...d,examType:e.target.value}))}/><small className="setting-help">This saved value is used as the exam label in both single-exam and multi-exam QR codes. Leave blank to use the selected exam names automatically.</small></label>
        </div>
        <div className="panel-subsection"><h3>Marksheet header information</h3><p>Configure the three optional columns in the existing first row above the school banner. The center column stays aligned to the page center; blank columns do not add fixed row height.</p>
          <div className="form-grid three">
            <label className="field section-toggle"><span>Show left information</span><input type="checkbox" checked={data.school.headerMeta?.showLeft !== false} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,showLeft:e.target.checked}}}))}/></label>
            <label className="field"><span>Left label</span><input value={data.school.headerMeta?.leftLabel ?? ''} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,leftLabel:e.target.value}}}))}/></label>
            <label className="field"><span>Left value · Established</span><input value={data.school.established || ''} onChange={e=>setSchool('established',e.target.value)}/></label>
            <label className="field section-toggle"><span>Show middle information</span><input type="checkbox" checked={data.school.headerMeta?.showMiddle !== false} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,showMiddle:e.target.checked}}}))}/></label>
            <label className="field"><span>Middle label</span><input value={data.school.headerMeta?.middleLabel ?? ''} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,middleLabel:e.target.value}}}))}/></label>
            <label className="field"><span>Middle value · Affiliation</span><input value={data.school.affiliation || ''} onChange={e=>setSchool('affiliation',e.target.value)}/></label>
            <label className="field section-toggle"><span>Show right information</span><input type="checkbox" checked={data.school.headerMeta?.showRight !== false} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,showRight:e.target.checked}}}))}/></label>
            <label className="field"><span>Right label</span><input value={data.school.headerMeta?.rightLabel ?? ''} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,rightLabel:e.target.value}}}))}/></label>
            <label className="field"><span>Right value · Registration number</span><input value={data.school.registrationNumber || ''} onChange={e=>setSchool('registrationNumber',e.target.value)}/></label>
          </div>
          <div className="form-grid">
            <label className="field section-toggle"><span>Show third school-banner line</span><input type="checkbox" checked={data.school.headerMeta?.showManagementLine === true} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,showManagementLine:e.target.checked}}}))}/></label>
            <label className="field"><span>Third school-banner line</span><input value={data.school.headerMeta?.managementLine ?? ''} placeholder="Management / Foundation information" onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,managementLine:e.target.value}}}))}/></label>
          </div>
        </div>
        </details>
        <details className="settings-group"><summary><span>School images & watermark</span><small>Logos, watermark image, mode and appearance</small><button type="button" className="settings-group-close" aria-label="Collapse this settings section" title="Collapse section" onClick={e=>{e.preventDefault();e.stopPropagation();const group=e.currentTarget.closest('details');if(group)group.open=false;}}><X size={14}/><span>Close</span></button></summary>
        <div className="panel-subsection"><h3>School images</h3><div className="form-grid three"><label className="field section-toggle"><span>Show left logo</span><input type="checkbox" checked={data.school.showLeftLogo !== false} onChange={e=>setData(d=>({...d,school:{...d.school,showLeftLogo:e.target.checked}}))}/></label><label className="field upload-field"><span>Top-left logo</span><label className="upload-box"><Upload size={16}/> Upload left logo<input hidden type="file" accept="image/*" onChange={e=>{uploadAsset(e.target.files?.[0],'logoLeft');e.currentTarget.value='';}}/></label>{(data.school.logoLeft||data.school.logo)&&<img className="asset-preview" src={data.school.logoLeft||data.school.logo} alt="Left logo preview"/>}</label><label className="field section-toggle"><span>Show right logo</span><input type="checkbox" checked={data.school.showRightLogo !== false} onChange={e=>setData(d=>({...d,school:{...d.school,showRightLogo:e.target.checked}}))}/></label><label className="field section-toggle"><span>Use left logo on right</span><input type="checkbox" checked={data.school.rightLogoUseLeftLogo !== false} onChange={e=>setData(d=>({...d,school:{...d.school,rightLogoUseLeftLogo:e.target.checked}}))}/></label>{data.school.rightLogoUseLeftLogo === false && <label className="field upload-field"><span>Top-right logo</span><label className="upload-box"><Upload size={16}/> Upload right logo<input hidden type="file" accept="image/*" onChange={e=>{uploadAsset(e.target.files?.[0],'logoRight');e.currentTarget.value='';}}/></label>{data.school.logoRight&&<img className="asset-preview" src={data.school.logoRight} alt="Right logo preview"/>}</label>}<label className="field section-toggle"><span>Show watermark</span><input type="checkbox" checked={data.school.showWatermark !== false} onChange={e=>setData(d=>({...d,school:{...d.school,showWatermark:e.target.checked}}))}/></label><label className="field section-toggle"><span>Use left logo as watermark</span><input type="checkbox" checked={data.school.watermarkUseLeftLogo !== false} onChange={e=>setData(d=>({...d,school:{...d.school,watermarkUseLeftLogo:e.target.checked}}))}/></label>{data.school.watermarkUseLeftLogo === false && <label className="field upload-field"><span>Watermark image</span><label className="upload-box"><Upload size={16}/> Upload watermark<input hidden type="file" accept="image/*" onChange={e=>{uploadAsset(e.target.files?.[0],'watermark');e.currentTarget.value='';}}/></label>{data.school.watermark&&<img className="asset-preview" src={data.school.watermark} alt="Watermark preview"/>}</label>}</div></div>
        <div className="panel-subsection"><h3>Watermark appearance</h3><label className="field"><span>Display mode</span><select value={data.marksheetSettings.watermarkMode} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,watermarkMode:e.target.value as 'repeat'|'single'}}))}><option value="repeat">Repeated pattern</option><option value="single">Single centered image</option></select></label><label className="field"><span>Opacity: {data.marksheetSettings.watermarkOpacity}%</span><input type="range" min="0" max="100" value={data.marksheetSettings.watermarkOpacity} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,watermarkOpacity:Number(e.target.value)}}))}/></label>{data.marksheetSettings.watermarkMode==='repeat'?<label className="field"><span>Repeated tile size: {data.marksheetSettings.watermarkRepeatSize}px</span><input type="range" min="24" max="180" step="4" value={data.marksheetSettings.watermarkRepeatSize} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,watermarkRepeatSize:Number(e.target.value)}}))}/></label>:<label className="field"><span>Centered image size: {data.marksheetSettings.watermarkCenterSize}px</span><input type="range" min="120" max="900" step="20" value={data.marksheetSettings.watermarkCenterSize} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,watermarkCenterSize:Number(e.target.value)}}))}/></label>}</div>
        </details>
        <details className="settings-group"><summary><span>Class permissions & import</span><small>Control class configuration, student transfers, sidebar class editing and multi-class import</small><button type="button" className="settings-group-close" aria-label="Collapse this settings section" title="Collapse section" onClick={e=>{e.preventDefault();e.stopPropagation();const group=e.currentTarget.closest('details');if(group)group.open=false;}}><X size={14}/><span>Close</span></button></summary>
        <div className="class-config-permission"><label className="toggle-label"><input type="checkbox" checked={data.settings.allowEditExistingClassConfig} onChange={e=>setData(d=>({...d,settings:{...d.settings,allowEditExistingClassConfig:e.target.checked}}))}/> <strong>Enable editing for existing classes</strong></label><small>{isClassConfigurationLocked ? 'Configuration is protected. Enable this option to edit validation rules, exam setup, subjects and grading configuration. Student records, marks and attendance remain editable under their existing rules.' : data.students.length ? 'Class configuration editing is enabled.' : 'No student records exist yet; class configuration is editable.'}</small></div>
        <div className="class-config-permission"><label className="toggle-label"><input type="checkbox" checked={data.settings.allowChangeExistingStudentClass} onChange={e=>setData(d=>({...d,settings:{...d.settings,allowChangeExistingStudentClass:e.target.checked}}))}/> <strong>Allow changing class of existing students</strong></label><small>{data.settings.allowChangeExistingStudentClass ? 'Enabled. A Move class action appears in each student row. It moves only that student and their current-session marks, attendance, photo and remarks to the destination class. Previous-session workspaces remain unchanged.' : 'Disabled by default. Student class changes are blocked until this permission is enabled. This permission is separate from class configuration editing.'}</small></div>
        <div className="class-config-permission"><label className="toggle-label"><input type="checkbox" checked={data.settings.allowEditActiveClass} onChange={e=>setData(d=>({...d,settings:{...d.settings,allowEditActiveClass:e.target.checked}}))}/> <strong>Allow editing class when student records exist</strong></label><small>{data.settings.allowEditActiveClass ? 'Enabled. The Class field in the sidebar can be changed even when this workspace contains students. The complete workspace is renamed; its student records, marks, attendance and settings stay together. An existing destination workspace cannot be overwritten.' : 'Disabled by default. Empty workspaces remain editable automatically. When student records exist, the sidebar Class field is locked until this option is enabled.'}</small></div>
        <label className="field section-toggle"><span>Allowed multiple class import</span><span className="setting-help">Unchecked by default. When enabled, a file containing multiple classes is split into separate saved class workspaces after explicit confirmation.</span><input type="checkbox" checked={data.settings.allowMultipleClassImport} onChange={e=>setData(d=>({...d,settings:{...d.settings,allowMultipleClassImport:e.target.checked}}))}/></label>
        </details>
        <fieldset className="class-config-fieldset" disabled={isClassConfigurationLocked}>
        <details className="settings-group"><summary><span>Student data & validation</span><small>Sections and Required / Recommended / Optional rules</small><button type="button" className="settings-group-close" aria-label="Collapse this settings section" title="Collapse section" onClick={e=>{e.preventDefault();e.stopPropagation();const group=e.currentTarget.closest('details');if(group)group.open=false;}}><X size={14}/><span>Close</span></button></summary>
        <div className="panel-subsection"><h3>Student data settings</h3>
          <label className="field section-toggle"><span>Enable Sections</span><span className="setting-help">When disabled, Section is hidden from student entry and templates. Extra Section columns in imported files are ignored.</span><input type="checkbox" checked={data.settings.sectionEnabled} onChange={e=>{const enabled=e.target.checked;if(!enabled && data.classInfo.section.trim() && data.students.length && !confirm('Disable sections? The current section value will be cleared from the active class view. Existing backup data is not deleted.')) return;setData(d=>({...d,settings:{...d.settings,sectionEnabled:enabled},classInfo:{...d.classInfo,section:enabled?d.classInfo.section:''}}));}} /></label>
          <div className="field"><span>Student data validation</span><div className="student-validation-grid">{[['student.roll','Roll'],['student.name','Student name'],['student.father','Father name'],['student.mother','Mother name'],['student.dob','Date of birth'],['student.gender','Gender'],['student.photo','Student photo']].map(([key,label])=>validationRow(key,label))}</div></div>
          <div className="field"><span>School data validation</span><div className="student-validation-grid">{[['school.name','School name'],['school.address','School address'],['school.established','Established year'],['school.affiliation','Affiliation'],['school.registrationNumber','Registration number'],['school.headerLeftLabel','Header left label'],['school.headerMiddleLabel','Header middle label'],['school.headerRightLabel','Header right label'],['school.managementLine','Management line'],['school.logoLeft','Left school logo'],['school.logoRight','Right school logo'],['school.watermark','Watermark image']].map(([key,label])=>validationRow(key,label))}</div></div>
          <div className="field"><span>Examination data validation</span><div className="student-validation-grid">{[['exam.type','Examination type'],['exam.session','Academic session'],['exam.class','Class'],['exam.section','Section'],['exam.names','Examination names'],['exam.maximumMarks','Maximum marks']].map(([key,label])=>validationRow(key,label))}</div></div>
          <div className="field"><span>Academic data validation</span><div className="student-validation-grid">{[['academic.subjects','Subject names'],['academic.gradingScale','Grading scale']].map(([key,label])=>validationRow(key,label))}</div><div className="student-validation-grid">{exams.map(k=><label className="student-validation-row" key={`marks-${k}`}><span>{data.exams[k].shortName} marks</span><select value={data.settings.requiredExamMarks.includes(k)?'required':data.settings.recommendedExamMarks.includes(k)?'recommended':'optional'} onChange={e=>setData(d=>({...d,settings:{...d.settings,requiredExamMarks:e.target.value==='required'?[...d.settings.requiredExamMarks.filter(x=>x!==k),k]:d.settings.requiredExamMarks.filter(x=>x!==k),recommendedExamMarks:e.target.value==='recommended'?[...d.settings.recommendedExamMarks.filter(x=>x!==k),k]:d.settings.recommendedExamMarks.filter(x=>x!==k)}}))}><option value="required">Required</option><option value="recommended">Recommended</option><option value="optional">Optional</option></select></label>)}</div></div>
          <div className="field"><span>Attendance data validation</span><div className="student-validation-grid">{[['attendance.workingDays','Total working days'],['attendance.presentDays','Student present days']].map(([key,label])=>validationRow(key,label))}</div></div>
          <div className="field"><span>Additional information validation</span><div className="student-validation-grid">{[['additional.issueDate','Issue date'],['additional.remarks','Remarks configuration']].map(([key,label])=>validationRow(key,label))}</div></div>
          <div className="field"><span>Signature section validation</span><div className="student-validation-grid">{[['signature.label','Designation label'],['signature.name','Person name'],['signature.image','Signature image']].map(([key,label])=>validationRow(key,label))}</div></div>
          <small>Required information blocks marksheet output. Recommended information shows a warning. Optional information never blocks output. Examination date and achievements are not configurable fields in this project version, so they are not included in validation.</small>
        </div>
        </details>
        <details className="settings-group"><summary><span>Examination configuration</span><small>Exam structure, order, maximum marks, weightage and promotion scoring</small><button type="button" className="settings-group-close" aria-label="Collapse this settings section" title="Collapse section" onClick={e=>{e.preventDefault();e.stopPropagation();const group=e.currentTarget.closest('details');if(group)group.open=false;}}><X size={14}/><span>Close</span></button></summary>
        <div className="panel-subsection"><h3>Exam configuration</h3><p>Choose a six-, four-, two-exam structure, or configure a custom examination list. Reordering changes the display order only; existing marks remain attached to their examination.</p><div className="form-grid"><label className="field"><span>Examination structure</span><select value={data.examPreset} onChange={e=>changeExamPreset(e.target.value as AppData['examPreset'])}><option value="six">Six exams · PA1, PA2, HY, PA3, PA4, Final</option><option value="four">Four exams · PA1, HY, PA3, Final</option><option value="two">Two exams · HY, Final</option><option value="custom">Custom examination list</option></select></label><div className="field"><span>Custom exams</span><button className="btn" type="button" onClick={addCustomExam}>+ Add custom exam</button></div></div><div className="exam-config-list">{exams.map((k,i)=><div className="exam-config-row exam-config-row-expanded" key={k}><div className="exam-config-order"><strong>{i+1}.</strong><div><button type="button" className="icon-btn" title="Move exam up" disabled={i===0} onClick={()=>moveExam(k,-1)}><ArrowUp size={14}/></button><button type="button" className="icon-btn" title="Move exam down" disabled={i===exams.length-1} onClick={()=>moveExam(k,1)}><ArrowDown size={14}/></button></div></div><label className="field"><span>Exam name</span><input value={data.exams[k].name} onChange={e=>setData(d=>({...d,exams:{...d.exams,[k]:{...d.exams[k],name:e.target.value}}}))}/></label><label className="field"><span>Short name</span><input value={data.exams[k].shortName} onChange={e=>setData(d=>({...d,exams:{...d.exams,[k]:{...d.exams[k],shortName:e.target.value}}}))}/></label><label className="field"><span>Maximum marks</span><input type="number" min="0.01" step="0.01" value={data.exams[k].maxMarks} onChange={e=>setData(d=>({...d,exams:{...d.exams,[k]:{...d.exams[k],maxMarks:Math.max(0.01,Number(e.target.value)||0.01)}}}))}/></label><label className="field"><span>Weightage contribution</span><input type="number" min="0" step="0.01" value={data.exams[k].weightage} onChange={e=>setData(d=>({...d,exams:{...d.exams,[k]:{...d.exams[k],weightage:Math.max(0,Number(e.target.value)||0)}}}))}/></label><label className="field"><span>Completeness</span><select value={data.settings.requiredExamMarks.includes(k)?'required':data.settings.recommendedExamMarks.includes(k)?'recommended':'optional'} onChange={e=>setData(d=>({...d,settings:{...d.settings,requiredExamMarks:e.target.value==='required'?[...d.settings.requiredExamMarks.filter(x=>x!==k),k]:d.settings.requiredExamMarks.filter(x=>x!==k),recommendedExamMarks:e.target.value==='recommended'?[...d.settings.recommendedExamMarks.filter(x=>x!==k),k]:d.settings.recommendedExamMarks.filter(x=>x!==k)}}))}><option value="required">Required</option><option value="recommended">Recommended</option><option value="optional">Optional</option></select></label><button type="button" className="icon-btn danger" title="Remove exam" disabled={exams.length<=1} onClick={()=>removeExam(k)}><Trash2 size={15}/></button></div>)}</div><div className="panel-subsection"><h4>Promotion result calculation</h4><p>Promotion ranking uses the selected examinations' converted weightage. Missing marks are excluded from the available maximum, matching marksheet calculation rules.</p><div className="upload-exam-options">{exams.map(k=><label className="upload-exam-option" key={`promotion-${k}`}><input type="checkbox" checked={data.settings.promotionExams.includes(k)} onChange={e=>setData(d=>({...d,settings:{...d.settings,promotionExams:e.target.checked?[...d.settings.promotionExams,k]:d.settings.promotionExams.filter(x=>x!==k)}}))}/><span>{data.exams[k].shortName}</span></label>)}</div>{!data.settings.promotionExams.length&&<small className="setting-warning">Select at least one exam for promotion ranking.</small>}</div><label className="field"><span>Fractional marks precision</span><select value={data.marksheetSettings.marksPrecision} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,marksPrecision:Number(e.target.value) as 0|1|2}}))}><option value="0">Integer (nearest whole number)</option><option value="1">One decimal place</option><option value="2">Two decimal places</option></select><small>Each exam contribution is rounded to this precision before totals are calculated.</small></label></div>
        </details>
        <details className="settings-group"><summary><span>Subjects & grading</span><small>Class subjects, grade thresholds and grade order</small><button type="button" className="settings-group-close" aria-label="Collapse this settings section" title="Collapse section" onClick={e=>{e.preventDefault();e.stopPropagation();const group=e.currentTarget.closest('details');if(group)group.open=false;}}><X size={14}/><span>Close</span></button></summary>
        <div className="panel-subsection"><h3>Subjects for class {data.classInfo.className}</h3><p>Subject IDs stay stable when you rename a subject. Removing a subject can hide its existing marks, so review before removing.</p><div className="subject-editor">{data.subjects.map((s,i)=><div className="subject-edit-row" key={s.id}><span className="subject-index">{i+1}</span><input aria-label={`Subject ${i+1} name`} value={s.name} onChange={e=>setData(d=>({...d,subjects:d.subjects.map(x=>x.id===s.id?{...x,name:e.target.value}:x),classSubjectConfigs:{...d.classSubjectConfigs,[d.classInfo.className]:d.subjects.map(x=>x.id===s.id?{...x,name:e.target.value}:x)}}))}/><button type="button" className="icon-btn danger" title="Remove subject" onClick={()=>{if(confirm(`Remove ${s.name || `Subject ${i+1}`} from the active subject list? Existing marks may remain in the saved data but will not appear in the marksheet.`))setData(d=>({...d,subjects:d.subjects.filter(x=>x.id!==s.id),classSubjectConfigs:{...d.classSubjectConfigs,[d.classInfo.className]:d.subjects.filter(x=>x.id!==s.id)}}));}}><Trash2 size={16}/></button></div>)}<button className="btn" type="button" onClick={()=>setData(d=>{const added={id:`custom-${crypto.randomUUID()}`,name:''};const subjects=[...d.subjects,added];return {...d,subjects,classSubjectConfigs:{...d.classSubjectConfigs,[d.classInfo.className]:subjects}}})}><Plus size={15}/> Add subject</button></div></div>
        <div className="panel-subsection"><h3>Grading scale</h3><p>Rules are evaluated from top to bottom. Use the arrow buttons to set priority; ensure the rules cover every percentage without unintended overlaps.</p><div className="grade-editor">{data.grading.grades.map((g,i)=><div className="grade-edit-row" key={`${g.grade}-${i}`}><input aria-label="Grade label" value={g.grade} onChange={e=>setData(d=>({...d,grading:{...d.grading,grades:d.grading.grades.map((x,j)=>j===i?{...x,grade:e.target.value}:x)},remarkRules:{...d.remarkRules,overall:d.remarkRules.overall.map(r=>r.grade===g.grade?{...r,grade:e.target.value}:r)}}))}/><select aria-label="Grade operator" value={g.operator || '>='} onChange={e=>setData(d=>({...d,grading:{...d.grading,grades:d.grading.grades.map((x,j)=>j===i?{...x,operator:e.target.value as '>='|'>'|'<='|'<' }:x)}}))}><option value=">=">≥</option><option value=">">&gt;</option><option value="<=">≤</option><option value="<">&lt;</option></select><input aria-label="Grade threshold percentage" type="number" min="0" max="100" step="0.01" value={g.minPercentage} onChange={e=>setData(d=>({...d,grading:{...d.grading,grades:d.grading.grades.map((x,j)=>j===i?{...x,minPercentage:Number(e.target.value)}:x)}}))}/><span>%</span><button type="button" className="icon-btn" disabled={i===0} title="Move grade up" onClick={()=>setData(d=>{const a=[...d.grading.grades];[a[i-1],a[i]]=[a[i],a[i-1]];return {...d,grading:{...d.grading,grades:a}}})}><ArrowUp size={14}/></button><button type="button" className="icon-btn" disabled={i===data.grading.grades.length-1} title="Move grade down" onClick={()=>setData(d=>{const a=[...d.grading.grades];[a[i],a[i+1]]=[a[i+1],a[i]];return {...d,grading:{...d.grading,grades:a}}})}><ArrowDown size={14}/></button><button type="button" className="icon-btn danger" disabled={data.grading.grades.length<=1} title="Remove grade" onClick={()=>setData(d=>({...d,grading:{...d.grading,grades:d.grading.grades.filter((_,j)=>j!==i)},remarkRules:{...d.remarkRules,overall:d.remarkRules.overall.filter(r=>r.grade!==g.grade)}}))}><Trash2 size={16}/></button></div>)}<button className="btn" type="button" onClick={()=>setData(d=>({...d,grading:{...d.grading,grades:[...d.grading.grades,{grade:'',operator:'>=',minPercentage:0}]}}))}><Plus size={15}/> Add grade</button></div></div>
        </details>
        <details className="settings-group"><summary><span>Marksheet layout & columns</span><small>Orientation, exam header visibility, calculation inclusion and display rows</small><button type="button" className="settings-group-close" aria-label="Collapse this settings section" title="Collapse section" onClick={e=>{e.preventDefault();e.stopPropagation();const group=e.currentTarget.closest('details');if(group)group.open=false;}}><X size={14}/><span>Close</span></button></summary>
        <div className="panel-subsection"><h3>Marksheet layout</h3><label className="field"><span>Table orientation</span><select value={data.marksheetSettings.tableOrientation} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,tableOrientation:e.target.value as 'auto'|'subjects-rows'|'subjects-columns'}}))}><option value="auto">Automatic (single exam = subjects as columns)</option><option value="subjects-rows">Subjects as rows</option><option value="subjects-columns">Subjects as columns</option></select></label><div className="panel-subsection"><h4>Examinations shown in marksheet headers</h4><p>Tick the examinations to display. Selected examinations receive sequential order numbers; use the arrows to rearrange the printed column order.</p></div><div className="report-exam-order-list">{exams.map(k=>{const orderIndex=data.marksheetSettings.reportExams.indexOf(k);const selected=orderIndex>=0;return <div className="report-exam-order-row" key={k}><label className="upload-exam-option"><input type="checkbox" checked={selected} onChange={e=>toggleReportExam(k,e.target.checked)}/><span>{selected ? `${data.exams[k].shortName} — ${orderIndex+1}` : data.exams[k].shortName}</span></label>{selected?<div className="row-actions"><button type="button" className="icon-btn" title="Move selected exam earlier in marksheet" disabled={orderIndex===0} onClick={()=>moveReportExam(k,-1)}><ArrowUp size={14}/></button><button type="button" className="icon-btn" title="Move selected exam later in marksheet" disabled={orderIndex===data.marksheetSettings.reportExams.length-1} onClick={()=>moveReportExam(k,1)}><ArrowDown size={14}/></button></div>:<span className="report-order-empty">Not included</span>}</div>})}</div><small className="setting-help">Order numbers are assigned only to selected examinations. Reorder selected examinations with the arrow buttons. Hidden examinations retain their marks and remain available to promotion calculations.</small><div className="panel-subsection"><h4>Examinations included in marksheet totals</h4><p>These examinations contribute to subject totals, overall percentage and grades. This setting is independent of header visibility. Hiding a header column does not remove its marks from calculations.</p><div className="upload-exam-options">{exams.map(k=><label className="upload-exam-option" key={`calc-${k}`}><input type="checkbox" checked={data.marksheetSettings.calculationExams.includes(k)} onChange={e=>toggleCalculationExam(k,e.target.checked)}/><span>{data.exams[k].shortName} in totals</span></label>)}</div></div><div className="upload-exam-options">{([{field:'showTotalColumn',label:'Show per-subject Total',checked:data.marksheetSettings.showTotalColumn},{field:'showSubjectGrade',label:'Show subject Grade',checked:data.marksheetSettings.showSubjectGrade},{field:'showMarksRow',label:'Show Marks row',checked:data.marksheetSettings.showMarksRow},{field:'showGradeRow',label:'Show Grade row',checked:data.marksheetSettings.showGradeRow},{field:'showOverallSummary',label:'Show overall summary',checked:data.marksheetSettings.showOverallSummary}] as const).map(({field,label,checked})=><label className="upload-exam-option" key={field}><input type="checkbox" checked={checked} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,[field]:e.target.checked}}))}/><span>{label}</span></label>)}</div></div>
        </details>
        <details className="settings-group"><summary><span>Issue date & signatures</span><small>Printed issue date, designation labels, names and signature images</small><button type="button" className="settings-group-close" aria-label="Collapse this settings section" title="Collapse section" onClick={e=>{e.preventDefault();e.stopPropagation();const group=e.currentTarget.closest('details');if(group)group.open=false;}}><X size={14}/><span>Close</span></button></summary>
        <div className="panel-subsection"><h3>Issue date</h3><p>Configure the date displayed alongside the signature blocks on the marksheet.</p><label className="field section-toggle"><span>Show issue date</span><span className="setting-help">Display or hide the issue date on the printed marksheet.</span><input type="checkbox" checked={data.marksheetSettings.showIssueDate} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,showIssueDate:e.target.checked}}))}/></label><div className="form-grid"><label className="field"><span>Issue date</span><input type="date" value={data.marksheetSettings.issueDate} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,issueDate:e.target.value}}))}/><span className="setting-help">Defaults to today's date. Change it when issuing or reprinting a marksheet.</span></label><label className="field"><span>Date format</span><select value={data.marksheetSettings.issueDateFormat} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,issueDateFormat:e.target.value as AppData['marksheetSettings']['issueDateFormat']}}))}><option value="DD-MM-YYYY">DD-MM-YYYY</option><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option></select></label><label className="field"><span>Date label</span><input value={data.marksheetSettings.issueDateLabel} placeholder="Date" onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,issueDateLabel:e.target.value}}))}/></label></div></div>
        <div className="panel-subsection"><h3>Signature and designation blocks</h3><p>Enabled blocks stay in one row at the bottom. Names and signature images are optional; labels appear below aligned dividers.</p><div className="signature-settings">{data.marksheetSettings.signatures.map((sig,i)=><div className="signature-setting-card" key={sig.id}><div className="signature-setting-top"><label className="toggle-label"><input type="checkbox" checked={sig.enabled} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,enabled:e.target.checked}:x)}}))}/> Show on marksheet</label><div className="row-actions"><button className="icon-btn" disabled={i===0} title="Move left" onClick={()=>setData(d=>{const a=[...d.marksheetSettings.signatures];[a[i-1],a[i]]=[a[i],a[i-1]];return {...d,marksheetSettings:{...d.marksheetSettings,signatures:a}}})}><ArrowLeft size={15}/></button><button className="icon-btn" disabled={i===data.marksheetSettings.signatures.length-1} title="Move right" onClick={()=>setData(d=>{const a=[...d.marksheetSettings.signatures];[a[i],a[i+1]]=[a[i+1],a[i]];return {...d,marksheetSettings:{...d.marksheetSettings,signatures:a}}})}><ArrowRight size={15}/></button><button className="icon-btn danger" disabled={data.marksheetSettings.signatures.length<=1} title="Remove signature block" onClick={()=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.filter(x=>x.id!==sig.id)}}))}><Trash2 size={15}/></button></div></div><label className="field"><span>Designation label</span><input value={sig.label} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,label:e.target.value}:x)}}))}/></label><label className="field"><span>Person name (optional)</span><input value={sig.name} placeholder="Leave blank for handwritten name" onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,name:e.target.value}:x)}}))}/></label><label className="field"><span>Signature image (transparent PNG supported)</span><label className="upload-box"><Upload size={16}/> Upload / replace signature<input hidden type="file" accept="image/png,image/*" onChange={async e=>{const file=e.currentTarget.files?.[0];if(file){try{const image=await fileToDataUrl(file);setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,signatureImage:image}:x)}}));}catch{alert('Could not read signature image.');}}e.currentTarget.value='';}}/></label>{sig.signatureImage&&<div className="signature-asset-preview"><img src={sig.signatureImage} alt={`${sig.label} preview`} style={{width:`${sig.widthMm??32}mm`,height:`${sig.heightMm??10}mm`,maxWidth:'100%',objectFit:'contain'}}/><button className="icon-btn danger" onClick={()=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,signatureImage:''}:x)}}))}>Remove image</button></div>}</label><div className="grid grid-cols-2 gap-3"><label className="field"><span>Signature width (mm)</span><input type="number" min="15" max="60" step="1" value={sig.widthMm??32} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,widthMm:Math.min(60,Math.max(15,Number(e.target.value)||32))}:x)}}))}/></label><label className="field"><span>Signature height (mm)</span><input type="number" min="5" max="20" step="1" value={sig.heightMm??10} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,heightMm:Math.min(20,Math.max(5,Number(e.target.value)||10))}:x)}}))}/></label></div></div>)}</div><button className="btn" type="button" disabled={data.marksheetSettings.signatures.length>=4} onClick={()=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:[...d.marksheetSettings.signatures,{id:crypto.randomUUID(),label:'',name:'',enabled:true,widthMm:32,heightMm:10}]}}))}><Plus size={15}/> Add signature block ({data.marksheetSettings.signatures.length}/4)</button></div>
        </details>
        </fieldset>
      </section>}
      {section==='marks' && <section className="panel"><div className="panel-heading"><div><h2>Exam marks</h2><p>Enter marks in the selected exam. Values above the configured maximum are rejected.</p></div><div className="row-actions"><button className="btn btn-danger" onClick={resetMarks} disabled={busy || !data.students.length}>Reset marks</button><label className="btn"><FileSpreadsheet size={16}/> Import exam Excel/CSV<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={e=>{setImportMode(exam);importSpreadsheet(e.target.files?.[0], exam); e.currentTarget.value='';}}/></label></div></div>
        <div className="upload-exam-selector"><strong>Exams affected by the next upload</strong><div className="upload-exam-options">{exams.map(k=><label key={k} className="upload-exam-option"><input type="checkbox" checked={selectedUploadExams.includes(k)} onChange={e=>setSelectedUploadExams(prev=>e.target.checked?[...prev,k]:prev.filter(x=>x!==k))}/><span>{data.exams[k].shortName}</span></label>)}</div><small>Only checked exams can be changed. If the file includes an Exam column, rows are grouped by that value. Without an Exam column, select exactly one exam.</small></div>
        <div className="exam-tabs">{exams.map(k=><button key={k} className={exam===k?'exam-tab active':'exam-tab'} onClick={()=>{setExam(k);setSelectedUploadExams(prev=>prev.length<=1?[k]:prev);}}>{data.exams[k].shortName}<small>Max {data.exams[k].maxMarks}</small></button>)}</div>
        <div className="table-wrap"><table className="data-table marks-table"><thead><tr><th>Roll</th><th>Student</th>{data.subjects.map(s=><th key={s.id}>{s.name}</th>)}</tr></thead><tbody>{data.students.map(s=><tr key={s.studentId}><td>{s.roll}</td><td>{s.name || 'Unnamed student'}</td>{data.subjects.map(sub=><td key={sub.id}><input aria-label={`${s.name} ${sub.name} ${exam}`} className="mark-input" type="number" min="0" max={data.exams[exam].maxMarks} value={data.results[exam].find(m=>m.studentId===s.studentId)?.[sub.id] ?? ''} onChange={e=>setMark(s.studentId,sub.id,e.target.value)}/></td>)}</tr>)}</tbody></table>{!data.students.length&&<div className="empty">Add students before entering marks.</div>}</div>
      </section>}
      {section==='attendance' && <section className="panel">
        <div className="panel-heading"><div><h2>Attendance & automatic remarks</h2><p>Set working days once for the whole class. Enter present days; absent days and remarks are calculated automatically.</p></div></div>
        <div className="form-grid">
          <label className="field"><span>Total class working days</span><input type="number" min="0" value={data.classInfo.totalWorkingDays} onChange={e=>setData(d=>{const total=Math.max(0,Number(e.target.value)||0);return {...d,classInfo:{...d.classInfo,totalWorkingDays:total},students:d.students.map(st=>({...st,attendance:{...st.attendance,workingDays:total,daysPresent:Math.min(total,Math.max(0,st.attendance.daysPresent||0)),daysAbsent:Math.max(0,total-Math.min(total,Math.max(0,st.attendance.daysPresent||0)))}}))}})}/></label>
          <div className="field"><span>Attendance rule</span><p className="muted">Attendance below {data.remarkRules.attendanceBelowPercentage}% will add an automatic remark. No individual attendance remarks are required.</p></div>
        </div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Roll</th><th>Student</th><th>Present days</th><th>Absent days (auto)</th><th>Attendance %</th></tr></thead><tbody>{data.students.map(s=>{
          const totalDays=Math.max(0,data.classInfo.totalWorkingDays||0);
          const present=Math.min(totalDays,Math.max(0,Number(s.attendance.daysPresent)||0));
          const absent=Math.max(0,totalDays-present);
          const pct=totalDays ? present/totalDays*100 : 0;
          return <tr key={s.studentId}><td>{s.roll}</td><td>{s.name}</td><td><input aria-label={`Present days for ${s.name}`} className="mark-input" type="number" min="0" max={totalDays} value={s.attendance.daysPresent} onChange={e=>{const value=Math.min(totalDays,Math.max(0,Number(e.target.value)||0));setData(d=>({...d,students:d.students.map(st=>st.studentId===s.studentId?{...st,attendance:{...st.attendance,daysPresent:value,workingDays:d.classInfo.totalWorkingDays,daysAbsent:Math.max(0,d.classInfo.totalWorkingDays-value)}}:st)}));}}/></td><td>{absent}</td><td>{totalDays ? `${pct.toFixed(1)}%` : '—'}</td></tr>;
        })}</tbody></table>{!data.students.length&&<div className="empty">Add students before entering attendance.</div>}</div>
        <fieldset className="class-config-fieldset" disabled={isClassConfigurationLocked}><div className="panel-subsection"><h3>Automatic remark rules</h3><p>Remarks are generated during marksheet preview. They are not manually entered for individual students.</p>
          <h4>Overall remarks by grade</h4>
          <p className="muted">The remark matching the student's final overall grade is added automatically.</p>
          <div className="form-grid three">{[...data.grading.grades].sort((a,b)=>b.minPercentage-a.minPercentage).map(gradeRule=>{
            const rule = data.remarkRules.overall.find(r=>r.grade===gradeRule.grade);
            return <div className="remark-card" key={gradeRule.grade}>
              <label className="field"><span>Grade · {gradeRule.grade}</span><input value={`${gradeRule.minPercentage}% and above`} readOnly /></label>
              <label className="field"><span>Remark text</span><input value={rule?.text || ''} placeholder={`Remark for grade ${gradeRule.grade}`} onChange={e=>setData(d=>{
                const existing=d.remarkRules.overall.some(r=>r.grade===gradeRule.grade);
                const overall=existing?d.remarkRules.overall.map(r=>r.grade===gradeRule.grade?{...r,text:e.target.value}:r):[...d.remarkRules.overall,{grade:gradeRule.grade,text:e.target.value}];
                return {...d,remarkRules:{...d.remarkRules,overall}};
              })}/></label>
            </div>;
          })}</div>
          <div className="form-grid three">
            <label className="field"><span>Weak subject threshold (%)</span><input type="number" min="0" max="100" value={data.remarkRules.weakSubjectBelowPercentage} onChange={e=>setData(d=>({...d,remarkRules:{...d.remarkRules,weakSubjectBelowPercentage:Number(e.target.value)}}))}/></label>
            <label className="field"><span>Weak subject remark template</span><input value={data.remarkRules.weakSubjectTemplate} onChange={e=>setData(d=>({...d,remarkRules:{...d.remarkRules,weakSubjectTemplate:e.target.value}}))}/><small className="muted">Use {'{subject}'} for the subject name and {'{percentage}'} for its percentage.</small></label>
            <label className="field"><span>Low attendance threshold (%)</span><input type="number" min="0" max="100" value={data.remarkRules.attendanceBelowPercentage} onChange={e=>setData(d=>({...d,remarkRules:{...d.remarkRules,attendanceBelowPercentage:Number(e.target.value)}}))}/><span>Attendance remark template</span><input value={data.remarkRules.attendanceTemplate} onChange={e=>setData(d=>({...d,remarkRules:{...d.remarkRules,attendanceTemplate:e.target.value}}))}/><small className="muted">Use {'{percentage}'} for attendance percentage.</small></label>
          </div>
        </div></fieldset>
      </section>}
      {section==='backup' && <section className="panel"><div className="panel-heading"><div><h2>Import & export</h2><p>ZIP is the complete backup format. JSON is the manifest inside the ZIP.</p></div></div>
        <div className="backup-grid"><div className="backup-card"><Archive size={26}/><h3>Export complete ZIP</h3><p>Includes all class data, exam setup, settings, student photos, school assets and both marksheet templates.</p><button className="btn btn-primary" onClick={()=>exportZip(data,template,'','backup',{},singleTemplate)}><Download size={16}/> Export ZIP backup</button></div>
        <div className="backup-card"><FileUp size={26}/><h3>Restore ZIP backup</h3><p>Restore a complete class backup or import a promote_ ZIP for the next session. Photos and required assets are included.</p><label className="btn"><Upload size={16}/> Choose ZIP<input hidden type="file" accept=".zip" onChange={e=>importBackup(e.target.files?.[0])}/></label></div>
        <div className="backup-card"><FileSpreadsheet size={26}/><h3>Import student Excel/CSV</h3><p>Imports student details and validates class/session identity before applying changes.</p><label className="btn"><Upload size={16}/> Choose Excel/CSV<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={e=>{setImportMode('students');importSpreadsheet(e.target.files?.[0], 'students'); e.currentTarget.value='';}}/></label></div>
        <div className="backup-card"><FileUp size={26}/><h3>Import JSON manifest</h3><p>For advanced use or recovery from a standalone manifest.</p><label className="btn"><Upload size={16}/> Choose JSON<input hidden type="file" accept=".json" onChange={e=>importJson(e.target.files?.[0])}/></label></div></div>
        <div className="panel-subsection"><h3>Print</h3><p className="muted">Uses the uploaded HTML design unchanged as the source template, with runtime data substitution.</p><div className="row-actions"><label className="field compact"><span>Student to preview</span><select value={selectedStudent} onChange={e=>setSelectedStudent(e.target.value)}><option value="">First student</option>{data.students.map(s=><option key={s.studentId} value={s.studentId}>{s.roll} · {s.name}</option>)}</select></label><button className="btn" onClick={preview} disabled={busy}><Eye size={16}/> Preview selected</button><button className="btn" onClick={previewAll} disabled={busy}><Eye size={16}/> Preview all ({data.students.length})</button><button className="btn btn-primary" onClick={printAll} disabled={busy}><Printer size={16}/> Print all ({data.students.length})</button></div></div>
      </section>}
      {section==='help' && <section className="panel"><div className="panel-heading"><div><h2>Help & Guides</h2><p>Practical instructions and sample files for the complete marksheet workflow.</p></div></div><div className="help-grid">{[['Getting started','Set academic session and class, complete School Profile, add students, configure exams and subjects, enter marks, then preview and print.'],['School profile','Enter school identity and configure the three optional header information columns, school-banner management line, left/right logos, watermark, grading, signatures and marksheet layout.'],['Students','Add students manually or import a CSV/XLSX. Roll and student name are required by the importer; Gender is optional. Existing class changes are separately controlled by Allow changing class of existing students. Changing one student\'s class moves that student\'s current-session enrollment, marks and attendance to the destination class. Previous-session workspaces are preserved.'],['Exam configuration','Choose six, four, two or custom examinations. Each exam has its own raw maximum and weightage contribution. Configure which exams appear on marksheets, review their automatic order numbers, and use arrow controls to reorder selected columns. Hidden columns retain their marks and promotion-calculation availability.'],['Marks entry','Select an exam tab and enter marks. Values above the configured maximum are rejected. Multi-exam uploads are grouped by the Exam column and selected exam checkboxes.'],['Attendance & remarks','Set total working days, enter present days and configure automatic grade, weak-subject and attendance remarks.'],['Data validation & class editing','Configure Required, Recommended or Optional independently for student, school, examination, academic, attendance, additional and signature information. Required gaps block marksheet output; recommended gaps prompt for confirmation. Existing class configuration editing, individual student class transfers, and active workspace class-name editing are three separate permissions. Empty workspaces allow Class editing by default. When student records exist, the sidebar Class field is locked unless Allow editing class when student records exist is enabled; changing it safely renames the active workspace without overwriting another workspace.'] ,['Marksheet generation','Choose report exams, table orientation and display options. Required data blocks output; recommended missing data requires confirmation; optional fields never block output.'],['QR code','Scan the QR code with a phone camera or QR reader to read the student result summary.'],['Backup & restore','ZIP backups include all class data, exam configuration, settings, assets and both marksheet templates. Restore shows a class/session conflict preview before replacing the matching workspace.']].map(([title,body])=><article className="help-card" key={title}><h3>{title}</h3><p>{body}</p></article>)}</div><div className="panel-subsection"><h3>Sample Excel / CSV files</h3><p>Download these CSV templates, open them in Excel or LibreOffice, replace the sample rows, and save as CSV or XLSX.</p><div className="help-downloads"><button className="btn" onClick={downloadStudentTemplate}><Download size={15}/> Student details (Gender optional)</button>{exams.map(k=><button className="btn" key={k} onClick={()=>downloadExamSample(k)}><Download size={15}/> {data.exams[k].shortName} marks</button>)}<button className="btn btn-primary" onClick={downloadCombinedSample}><Download size={15}/> Combined exam sample</button></div><small className="muted">Marks files use Session, Exam, Class, optional Section, Roll and subject columns. Each row represents one student in one examination.</small></div></section>}
      <footer className="app-footer"><span>Local-first · no server database</span><span>{data.students.length} students · {data.subjects.length} subjects · {exams.length} exams</span></footer>
    </main>
    {cropDraft && <StudentPhotoCropModal draft={cropDraft} onCancel={() => setCropDraft(null)} onSelectNewImage={async file => { try { const src = await fileToDataUrl(file); setCropDraft(prev => prev ? { ...prev, src, fileName: file.name } : prev); } catch { alert('Could not read this image file.'); } }} onUseOriginal={(studentId, imageDataUrl) => { updateStudent(studentId, 'photo', imageDataUrl); setCropDraft(null); setNotice('Original photo saved without cropping.'); }} onApply={(studentId, imageDataUrl) => { updateStudent(studentId, 'photo', imageDataUrl); setCropDraft(null); setNotice('Student photo cropped and saved.'); }} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
