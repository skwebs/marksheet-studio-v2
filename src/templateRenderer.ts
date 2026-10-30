import QRCode from 'qrcode';
import type { AppData, Student, ExamKey } from './types';
import { examKeys } from './data';

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const fmt = (value: number, precision: number = 1) => { if (!Number.isFinite(value)) return '0'; if (precision === 0) return String(Math.round(value)); const factor=10**precision; return (Math.round((value+Number.EPSILON)*factor)/factor).toFixed(precision); };
function getMarks(data: AppData, student: Student, key: ExamKey) {
  return data.results[key]?.find(m => m.studentId === student.studentId || (!!student.roll && m.roll === student.roll));
}
function gradeFor(data: AppData, percentage: number) {
  const rules = data.grading.grades;
  return rules.find(g => { const op = g.operator || '>='; if (op === '>') return percentage > g.minPercentage; if (op === '<=') return percentage <= g.minPercentage; if (op === '<') return percentage < g.minPercentage; return percentage >= g.minPercentage; })?.grade ?? '';
}
function getPerformance(data: AppData, student: Student, keys: ExamKey[] = examKeys) {
  let obtained = 0;
  let maximum = 0;
  const subjectRows = data.subjects.map(subject => {
    const combined = keys.length > 1;
    const subjectObtained = keys.reduce((sum, key) => { const raw=num(getMarks(data, student, key)?.[subject.id]); const exam=data.exams[key]; return sum + (combined && exam.maxMarks ? raw * num(exam.weightage) / num(exam.maxMarks) : raw); }, 0);
    const subjectMaximum = keys.reduce((sum, key) => sum + (combined ? num(data.exams[key]?.weightage) : num(data.exams[key]?.maxMarks)), 0);
    obtained += subjectObtained;
    maximum += subjectMaximum;
    return { subject, obtained: subjectObtained, maximum: subjectMaximum, percentage: subjectMaximum ? subjectObtained / subjectMaximum * 100 : 0 };
  });
  return { obtained, maximum, percentage: maximum ? obtained / maximum * 100 : 0, subjectRows };
}
function automaticRemarks(data: AppData, student: Student, percentage: number, keys: ExamKey[] = examKeys) {
  const rules = data.remarkRules;
  const overallGrade = gradeFor(data, percentage);
  const overall = (rules.overall || []).find(r => r.grade === overallGrade)?.text;
  const parts: string[] = [];
  if (overall?.trim()) parts.push(overall.trim());
  const performance = getPerformance(data, student, keys);
  for (const item of performance.subjectRows) {
    if (item.percentage < rules.weakSubjectBelowPercentage) {
      parts.push(rules.weakSubjectTemplate.replaceAll('{subject}', item.subject.name).replaceAll('{percentage}', fmt(item.percentage)));
    }
  }
  const totalDays = Math.max(0, num(data.classInfo.totalWorkingDays));
  const present = Math.max(0, Math.min(totalDays, num(student.attendance.daysPresent)));
  const attendancePercentage = totalDays ? present / totalDays * 100 : 100;
  if (totalDays > 0 && attendancePercentage < rules.attendanceBelowPercentage) {
    parts.push(rules.attendanceTemplate.replaceAll('{percentage}', fmt(attendancePercentage)));
  }
  return parts.join(' ');
}

export async function renderMarksheet(sourceHtml: string, data: AppData, student: Student): Promise<string> {
  const doc = new DOMParser().parseFromString(sourceHtml, 'text/html');
  if (doc.getElementById('examTitle')) return renderModernTemplate(doc, data, student);
  const setExactText = (oldText: string, newText: string) => {
    const el = [...doc.querySelectorAll('body *')].find(node => node.children.length === 0 && node.textContent?.trim() === oldText);
    if (el) el.textContent = newText;
  };
  const classLabel = `${data.classInfo.className}${data.settings?.sectionEnabled && data.classInfo.section ? `-${data.classInfo.section}` : ''}`;

  setExactText('Estd. : 2017', `Estd. : ${data.school.established || ''}`);
  setExactText('Reg. No. 054631', `Reg. No. ${data.school.registrationNumber || ''}`);
  setExactText('NATIONAL PUBLIC SCHOOL', data.school.name || '');
  setExactText('SINHPUR, KANHAULI, VAISHALI', data.school.address || '');

  // The supplied template's actual student table has three cells per row: label, colon, value.
  for (const row of doc.querySelectorAll<HTMLTableRowElement>('.student-details tr')) {
    const label = row.querySelector('th')?.textContent?.trim();
    const valueCell = row.cells[2];
    if (!valueCell) continue;
    if (label === 'Name') valueCell.textContent = student.name || '';
    else if (label === 'Class') valueCell.textContent = classLabel;
    else if (label === 'Roll No.') valueCell.textContent = student.roll || '';
    else if (label === "Mother's Name") valueCell.textContent = student.mother || '';
    else if (label === "Father's Name") valueCell.textContent = student.father || '';
  }

  const selectedKeys = (data.marksheetSettings.reportExams?.length ? data.marksheetSettings.reportExams : examKeys).filter(k => examKeys.includes(k));
  const reportKeys = selectedKeys.length ? selectedKeys : [examKeys[2]];
  const titleKey: ExamKey = reportKeys.includes('final') ? 'final' : reportKeys.includes('hy') ? 'hy' : reportKeys.includes('pa4') ? 'pa4' : reportKeys.includes('pa3') ? 'pa3' : reportKeys.includes('pa2') ? 'pa2' : 'pa1';
  const reportTitle = data.exams[titleKey].name.toUpperCase();
  const titleRows = doc.querySelectorAll('.w-full.text-center.border-t > div');
  if (titleRows[0]) titleRows[0].textContent = `REPORT CARD [${reportTitle || data.examType || data.exams.hy.name.toUpperCase()}]`;
  if (titleRows[1]) titleRows[1].innerHTML = `SESSION <strong>${esc(data.academicSession)}</strong>`;

  // Resolve uploaded assets as data URLs so they also work in a new preview/print window.
  const leftLogo = data.school.logoLeft || data.school.logo || '';
  const rightLogo = data.school.rightLogoUseLeftLogo !== false ? leftLogo : (data.school.logoRight || '');
  const logoImages = [...doc.querySelectorAll<HTMLImageElement>('img[alt="logo"], img[alt="beti bachao beti padhao"]')];
  if (logoImages[0]) { if (data.school.showLeftLogo === false || !leftLogo) logoImages[0].remove(); else logoImages[0].src = leftLogo; }
  if (logoImages[1]) { if (data.school.showRightLogo === false || !rightLogo) logoImages[1].remove(); else logoImages[1].src = rightLogo; }
  const watermark = data.school.watermarkUseLeftLogo !== false ? leftLogo : (data.school.watermark || '');
  const watermarkStyle = doc.createElement('style');
  const mode = data.marksheetSettings.watermarkMode || 'repeat';
  const opacity = Math.max(0, Math.min(100, Number(data.marksheetSettings.watermarkOpacity ?? 10))) / 100;
  const size = mode === 'single' ? Number(data.marksheetSettings.watermarkCenterSize ?? 420) : Number(data.marksheetSettings.watermarkRepeatSize ?? 60);
  watermarkStyle.textContent = data.school.showWatermark !== false && watermark ? `.main-content::before{content:"";background-image:url("${watermark}")!important;background-repeat:${mode==='single'?'no-repeat':'repeat'}!important;background-position:center!important;background-size:${mode==='single'?`min(${size}px,90%) auto`:`${size}px ${size}px`}!important;opacity:${opacity}!important;}` : `.main-content::before{content:none!important;background-image:none!important;}`;
  doc.head.append(watermarkStyle);
  const photo = doc.querySelector<HTMLImageElement>('img[alt="student image"]');
  if (photo) {
    if (student.photo) photo.src = student.photo;
    else photo.removeAttribute('src');
  }

  const combinedReport = reportKeys.length > 1;
  const precision = data.marksheetSettings.marksPrecision ?? 1;
  const fmtMarks = (value: number) => fmt(value, precision);
  const examMax = (key: ExamKey) => combinedReport ? num(data.exams[key]?.weightage) : num(data.exams[key]?.maxMarks);
  const convertMark = (key: ExamKey, value: number) => combinedReport && num(data.exams[key]?.maxMarks) ? value * num(data.exams[key]?.weightage) / num(data.exams[key]?.maxMarks) : value;
  const reportExams = reportKeys;
  const orientation = data.marksheetSettings.tableOrientation === 'auto'
    ? (reportExams.length === 1 ? 'subjects-columns' : 'subjects-rows')
    : data.marksheetSettings.tableOrientation;
  const table = doc.querySelector<HTMLTableElement>('table.table');
  if (table) {
    const head = doc.createElement('thead');
    const body = doc.createElement('tbody');
    const foot = doc.createElement('tfoot');
    table.replaceChildren(head, body, foot);
    table.classList.add('result-table-dynamic');
    const th = (label: string) => { const el = doc.createElement('th'); el.textContent = label; el.className = 'px-3 py-2'; return el; };
    const td = (label: string) => { const el = doc.createElement('td'); el.textContent = label; el.className = 'px-3 py-2'; return el; };
    const tr = () => { const el = doc.createElement('tr'); el.className = 'border-b border-gray-300'; return el; };
    const totals = Object.fromEntries(examKeys.map(k=>[k,0])) as Record<ExamKey, number>;
    let allObtained = 0;
    let allMaximum = 0;
    const perSubject = data.subjects.map(subject => {
      const examValues = Object.fromEntries(reportExams.map(key => {
        const raw = getMarks(data, student, key)?.[subject.id];
        const value = raw === null || raw === undefined || raw === '' ? null : num(raw);
        return [key, value];
      })) as Record<ExamKey, number | null>;
      const convertedValues = Object.fromEntries(reportExams.map(key=>[key, examValues[key] === null ? null : convertMark(key, examValues[key] ?? 0)])) as Record<ExamKey, number|null>;
      const obtained = reportExams.reduce((sum, key) => sum + (convertedValues[key] ?? 0), 0);
      const maximum = reportExams.reduce((sum, key) => sum + examMax(key), 0);
      reportExams.forEach(key => { totals[key] += convertedValues[key] ?? 0; });
      allObtained += obtained;
      allMaximum += maximum;
      return { subject, examValues, convertedValues, obtained, maximum, grade: gradeFor(data, maximum ? obtained / maximum * 100 : 0) };
    });

    if (orientation === 'subjects-columns') {
      const header = tr();
      header.append(th('#'));
      data.subjects.forEach(subject => header.append(th(subject.name)));
      head.append(header);
      const fullMarksRow = tr(); fullMarksRow.append(th('Full Marks'));
      perSubject.forEach(() => fullMarksRow.append(td(fmtMarks(examMax(reportExams[0])))));
      body.append(fullMarksRow);
      if (data.marksheetSettings.showMarksRow !== false) {
        const row = tr(); row.append(th('Obtained Marks'));
        perSubject.forEach(item => row.append(td(item.examValues[reportExams[0]] === null ? '—' : fmtMarks(item.examValues[reportExams[0]]!))));
        body.append(row);
      }
      if (data.marksheetSettings.showGradeRow !== false && data.marksheetSettings.showSubjectGrade !== false) {
        const row = tr(); row.append(th('Grade'));
        perSubject.forEach(item => {
          const value = item.examValues[reportExams[0]];
          const pct = value === null ? null : (examMax(reportExams[0]) ? (item.convertedValues[reportExams[0]] ?? 0) / examMax(reportExams[0]) * 100 : 0);
          row.append(td(pct === null ? '—' : gradeFor(data, pct)));
        });
        body.append(row);
      }
    } else {
      const header = tr();
      header.append(th('Subject'));
      reportExams.forEach(key => header.append(th(`${data.exams[key].shortName} (${fmtMarks(examMax(key))})`)));
      if (reportExams.length > 1 && data.marksheetSettings.showTotalColumn !== false) header.append(th(`Total (${fmtMarks(reportExams.reduce((sum,key)=>sum+examMax(key),0))})`));
      if (data.marksheetSettings.showSubjectGrade !== false) header.append(th('Grade'));
      head.append(header);
      perSubject.forEach(item => {
        const row = tr(); row.append(th(item.subject.name));
        reportExams.forEach(key => row.append(td(item.examValues[key] === null ? '—' : fmtMarks(item.convertedValues[key] ?? 0))));
        if (reportExams.length > 1 && data.marksheetSettings.showTotalColumn !== false) row.append(td(fmtMarks(item.obtained)));
        if (data.marksheetSettings.showSubjectGrade !== false) row.append(td(item.maximum ? item.grade : '—'));
        body.append(row);
      });
      const footer = tr(); footer.append(th('Total'));
      reportExams.forEach(key => footer.append(th(fmtMarks(totals[key]))));
      if (reportExams.length > 1 && data.marksheetSettings.showTotalColumn !== false) footer.append(th(fmtMarks(allObtained)));
      if (data.marksheetSettings.showSubjectGrade !== false) footer.append(th(gradeFor(data, allMaximum ? allObtained / allMaximum * 100 : 0)));
      foot.append(footer);
    }
    if (orientation === 'subjects-columns') {
      foot.remove();
    }
  }
  const reportPerformance = (() => {
    const rows = data.subjects.map(subject => {
      const obtained = reportExams.reduce((sum,key) => { const raw=num(getMarks(data, student, key)?.[subject.id]); return sum + convertMark(key, raw); }, 0);
      const maximum = reportExams.reduce((sum,key) => sum + examMax(key), 0);
      return { subject, obtained, maximum, percentage: maximum ? obtained / maximum * 100 : 0 };
    });
    const obtained = rows.reduce((sum,row)=>sum+row.obtained,0);
    const maximum = rows.reduce((sum,row)=>sum+row.maximum,0);
    return { subjectRows: rows, obtained, maximum, percentage: maximum ? obtained/maximum*100 : 0 };
  })();
  const allObtained = reportPerformance.obtained;
  const allMaximum = reportPerformance.maximum;
  const performance = reportPerformance;

  // Target the summary table directly. The previous broad selector accidentally matched the student table and overwrote Class.
  const summaryTable = doc.querySelector<HTMLTableElement>('.px-4.py-2 > table');
  const summaryCells = summaryTable?.rows[1]?.cells;
  if (data.marksheetSettings.showOverallSummary === false && summaryTable?.parentElement) summaryTable.parentElement.setAttribute('hidden', 'hidden');
  const totalDays = Math.max(0, num(data.classInfo.totalWorkingDays));
  const present = Math.max(0, Math.min(totalDays, num(student.attendance.daysPresent)));
  const absent = Math.max(0, totalDays - present);
  if (summaryCells) {
    if (summaryCells[0]) summaryCells[0].textContent = `${fmtMarks(allObtained)}/${fmtMarks(allMaximum)}`;
    if (summaryCells[1]) summaryCells[1].textContent = `${allMaximum ? (allObtained / allMaximum * 100).toFixed(1) : '0.0'} %`;
    if (summaryCells[2]) summaryCells[2].textContent = `${fmt(present)}/${fmt(totalDays)}`;
    if (summaryCells[3]) summaryCells[3].textContent = gradeFor(data, allMaximum ? allObtained / allMaximum * 100 : 0);
  }

  const remarksContainer = [...doc.querySelectorAll('body div')].find(el => el.children.length === 2 && el.children[0].textContent?.trim() === 'Remarks :');
  if (remarksContainer?.children[1]) remarksContainer.children[1].textContent = ` ${automaticRemarks(data, student, performance.percentage, reportExams)}`;

  // Render configured grade rules as a compact reference table.
  const gradingTable = [...doc.querySelectorAll('table')].find(t => t.textContent?.includes('Grading System'));
  if (gradingTable) {
    const sorted = data.grading.grades;
    gradingTable.replaceChildren();
    const headRow = doc.createElement('tr');
    const headCell = doc.createElement('th'); headCell.colSpan = 2; headCell.textContent = 'Grading System'; headCell.className = 'border border-black px-1 text-center'; headRow.append(headCell); gradingTable.append(headRow);
    sorted.forEach(rule => {
      const row = doc.createElement('tr'); const gradeCell = doc.createElement('th'); const descCell = doc.createElement('td');
      gradeCell.textContent = rule.grade; gradeCell.className = 'border border-black px-1';
      const op = rule.operator || '>='; descCell.textContent = `${op} ${rule.minPercentage}%`;
      descCell.className = 'border border-black px-1'; row.append(gradeCell,descCell); gradingTable.append(row);
    });
  }

  const signatureFooter = doc.querySelector('.signature-footer');
  if (signatureFooter) {
    signatureFooter.replaceChildren();
    const blocks = (data.marksheetSettings.signatures || []).filter(sig => sig.enabled).slice(0, 4);
    (signatureFooter as HTMLElement).style.gridTemplateColumns = `repeat(${Math.max(1, blocks.length)}, minmax(0, 1fr))`;
    blocks.forEach((sig, index) => {
      const block = doc.createElement('div'); block.className = 'signature-block';
      const top = doc.createElement('div'); top.className = 'signature-top';
      if (sig.signatureImage) {
        const img = doc.createElement('img'); img.src = sig.signatureImage; img.alt = `${sig.label} signature`; img.className = 'signature-image';
        img.style.background = 'transparent'; top.append(img);
      } else {
        const blank = doc.createElement('div'); blank.className = 'signature-image-placeholder'; top.append(blank);
      }
      const name = doc.createElement('div'); name.className = 'signature-name';
      const nameText = sig.name || '';
      name.textContent = nameText;
      top.append(name);
      const line = doc.createElement('div'); line.className = 'signature-divider';
      const label = doc.createElement('div'); label.className = 'signature-label'; label.textContent = sig.label;
      block.append(top, line, label); signatureFooter.append(block);
    });
    if (!blocks.length) signatureFooter.setAttribute('hidden', 'hidden'); else signatureFooter.removeAttribute('hidden');
  }

  // Generate a compact, self-contained per-student QR payload. Avoid duplicating
  // marks in both subject and exam objects: QR codes have a strict capacity limit.
  const qrImage = doc.querySelector<HTMLImageElement>('img[src*="sample-qr-code.png"]');
  if (qrImage) {
    const finalPercentage = allMaximum ? allObtained / allMaximum * 100 : 0;
    const compactText = (value: unknown, max = 160) => String(value ?? '').trim().slice(0, max);
    const sessionLabel = data.academicSession.replace(/^(\d{4})-(\d{4})$/, (_match, first, second) => `${first}-${second.slice(-2)}`);
    const qrPayload = [
      compactText(data.school.name, 80),
      `${compactText(data.examType?.trim() || reportTitle || 'EXAMINATION', 90)} | ${compactText(sessionLabel, 20)}`,
      '',
      compactText(student.name, 100),
      `Father: ${compactText(student.father, 100)}`,
      `Mother: ${compactText(student.mother, 100)}`,
      '',
      `Class: ${compactText(data.classInfo.className, 12)}${data.settings?.sectionEnabled && data.classInfo.section ? `-${compactText(data.classInfo.section, 8)}` : ''}`,
      `Roll No.: ${compactText(student.roll, 20)}`,
      '',
      ...performance.subjectRows.map((item: any) => `${compactText(item.subject.name, 28)}: ${fmtMarks(item.obtained)}/${fmtMarks(item.maximum)}`),
      `Total: ${fmtMarks(allObtained)}/${fmtMarks(allMaximum)}`,
      `Percentage: ${finalPercentage.toFixed(2)}%`,
      `Grade: ${gradeFor(data, finalPercentage)}`,
      `Remarks: ${compactText(automaticRemarks(data, student, finalPercentage, reportExams), 220) || '—'}`,
      '',
      `ATTENDANCE: ${fmt(present)}/${fmt(totalDays)} days (${totalDays ? (present / totalDays * 100).toFixed(1) : '0.0'}%)`
    ].join('\n');
    try {
      qrImage.src = await QRCode.toDataURL(qrPayload, {
        width: 800,
        margin: 2,
        errorCorrectionLevel: 'H'
      });
      qrImage.alt = `QR code for ${student.name}`;
      qrImage.style.width = '100%';
      qrImage.style.height = '100%';
      qrImage.style.objectFit = 'contain';
    } catch (error) {
      console.error('Could not generate the student QR code. Readable payload length:', qrPayload.length, error);
      throw new Error('Could not generate the student QR code. Shorten the school name or automatic remark text.');
    }
  }

  // Return an actual newline, never the visible two-character sequence "\\n".
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

async function renderModernTemplate(doc: Document, data: AppData, student: Student): Promise<string> {
  const modernSettings = data.marksheetSettings as AppData['marksheetSettings'] & { showIssueDate?: boolean; issueDateFormat?: string; issueDateLabel?: string };
  // The supplied HTML is a visual template only. Its embedded demo controller is
  // deliberately removed so sample values can never overwrite application data.
  doc.querySelectorAll('script:not([src])').forEach(script => script.remove());
  const setText = (id: string, value: unknown) => {
    const el = doc.getElementById(id);
    if (el) el.textContent = String(value ?? '');
  };
  const hide = (el: Element | null | undefined, hidden = true) => {
    if (!el) return;
    if (hidden) el.setAttribute('hidden', 'hidden');
    else el.removeAttribute('hidden');
  };
  const precision = Math.max(0, Math.min(3, Number(data.marksheetSettings.marksPrecision ?? 1)));
  const fmtMarks = (value: number) => { if (!Number.isFinite(value)) return '0'; const factor = 10 ** precision; const rounded = Math.round((value + Number.EPSILON) * factor) / factor; return precision === 0 ? String(rounded) : rounded.toFixed(precision); };
  const classLabel = `${data.classInfo.className}${data.settings?.sectionEnabled && data.classInfo.section ? `-${data.classInfo.section}` : ''}`;
  const reportKeys = (data.marksheetSettings.reportExams?.length ? data.marksheetSettings.reportExams : ['hy'])
    .filter((key): key is ExamKey => examKeys.includes(key as ExamKey));
  const keys: ExamKey[] = reportKeys.length ? reportKeys : ['hy'];
  const isMulti = doc.getElementById('marksTableFoot') !== null;
  const enabledSubjects = data.subjects.filter(subject => subject.enabled !== false);
  const maxFor = (key: ExamKey) => Math.max(0, keys.length > 1 ? Number(data.exams[key]?.weightage ?? data.exams[key]?.maxMarks) || 0 : Number(data.exams[key]?.maxMarks) || 0);
  const getExamMarks = (key: ExamKey, subjectId: string): number | null => {
    const record = data.results[key]?.find(item => item.studentId === student.studentId || (!item.studentId && item.roll === student.roll));
    const raw = record?.[subjectId];
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return keys.length > 1 && maxFor(key) ? value * maxFor(key) / Math.max(1, Number(data.exams[key]?.maxMarks) || 1) : value;
  };
  const gradeForPercentage = (percentage: number) => data.grading.grades.find(rule => {
    const op = rule.operator || '>=';
    if (op === '>') return percentage > rule.minPercentage;
    if (op === '<=') return percentage <= rule.minPercentage;
    if (op === '<') return percentage < rule.minPercentage;
    return percentage >= rule.minPercentage;
  })?.grade || '';
  const rows = enabledSubjects.map(subject => {
    const examMarks = keys.map(key => getExamMarks(key, subject.id));
    const obtained = examMarks.reduce<number>((sum, mark) => sum + (mark ?? 0), 0);
    const maximum = keys.reduce((sum, key) => sum + maxFor(key), 0);
    return { subject, examMarks, obtained, maximum, percentage: maximum ? obtained / maximum * 100 : 0 };
  });
  const grandObtained = rows.reduce((sum, row) => sum + row.obtained, 0);
  const grandMaximum = rows.reduce((sum, row) => sum + row.maximum, 0);
  const percentage = grandMaximum ? grandObtained / grandMaximum * 100 : 0;
  const overallGrade = gradeForPercentage(percentage);
  const workingDays = Math.max(0, Number(student.attendance.workingDays || data.classInfo.totalWorkingDays) || 0);
  const presentDays = Math.max(0, Math.min(workingDays, Number(student.attendance.daysPresent) || 0));
  const attendancePercentage = workingDays ? presentDays / workingDays * 100 : 0;
  const automaticRemarkParts: string[] = [];
  const gradeRemark = data.remarkRules.overall.find(rule => rule.grade === overallGrade)?.text;
  if (gradeRemark) automaticRemarkParts.push(gradeRemark);
  if (student.remarks.attendance?.trim()) automaticRemarkParts.push(student.remarks.attendance.trim());
  rows.forEach(row => {
    const subjectRemark = student.remarks.subjects?.[row.subject.id]?.trim();
    if (subjectRemark) automaticRemarkParts.push(subjectRemark);
    if (row.maximum && row.percentage < data.remarkRules.weakSubjectBelowPercentage) {
      automaticRemarkParts.push(data.remarkRules.weakSubjectTemplate.replaceAll('{subject}', row.subject.name).replaceAll('{percentage}', fmtMarks(row.percentage)));
    }
  });
  if (workingDays && attendancePercentage < data.remarkRules.attendanceBelowPercentage) {
    automaticRemarkParts.push(data.remarkRules.attendanceTemplate.replaceAll('{percentage}', fmtMarks(attendancePercentage)));
  }
  const remarks = student.remarks.overall?.trim() || automaticRemarkParts.join(' ');

  // School identity: both emblems use the configured school logo, never a demo asset.
  const leftLogo = data.school.logoLeft || data.school.logo || '';
  const rightLogo = data.school.rightLogoUseLeftLogo !== false ? leftLogo : (data.school.logoRight || '');
  const logoImages = [...doc.querySelectorAll<HTMLImageElement>('img[alt="National Public School Logo"], img[alt="School Emblem"], img[alt="Beti Bachao Beti Padhao"]')];
  logoImages.forEach((image, index) => {
    const logo = index === 0 ? leftLogo : rightLogo;
    if (logo) { image.src = logo; image.removeAttribute('hidden'); }
    else { image.removeAttribute('src'); image.setAttribute('hidden', 'hidden'); }
    hide(image.parentElement, !logo);
    image.alt = `${data.school.name || 'School'} logo`;
  });
  const schoolName = doc.querySelector('.school-name');
  const schoolAddress = doc.querySelector('.school-address');
  if (schoolName) schoolName.textContent = data.school.name || '';
  if (schoolAddress) { schoolAddress.textContent = data.school.address || ''; hide(schoolAddress, !data.school.address); }
  const established = doc.getElementById('schoolEstablished');
  const registration = doc.getElementById('schoolRegistration');
  if (established) { established.textContent = data.school.established ? `Estd. : ${data.school.established}` : ''; hide(established, !data.school.established); }
  if (registration) { registration.textContent = data.school.registrationNumber ? `Reg. No. : ${data.school.registrationNumber}` : ''; hide(registration, !data.school.registrationNumber); }
  if (established?.parentElement) hide(established.parentElement, !data.school.established && !data.school.registrationNumber);

  setText('examTitle', data.examType || 'REPORT CARD');
  setText('academicSession', data.academicSession);
  setText('stuName', student.name);
  setText('stuClass', classLabel);
  setText('stuRoll', student.roll);
  setText('stuMother', student.mother);
  setText('stuFather', student.father);
  doc.title = `Marksheet - ${data.school.name} - ${student.name}`;

  // Photo and watermark are optional configured assets.
  const photo = doc.getElementById('studentPhoto') as HTMLImageElement | null;
  if (photo) {
    if (student.photo && data.marksheetSettings.showPhoto !== false) photo.src = student.photo;
    else photo.removeAttribute('src');
    hide(photo.closest('.shrink-0'), !student.photo || data.marksheetSettings.showPhoto === false);
  }
  const watermark = data.school.watermarkUseLeftLogo !== false ? leftLogo : (data.school.watermark || '');
  const watermarkMode = data.marksheetSettings.watermarkMode || 'repeat';
  const watermarkOpacity = Math.max(0, Math.min(100, Number(data.marksheetSettings.watermarkOpacity ?? 8))) / 100;
  const watermarkSize = watermarkMode === 'single'
    ? Math.max(120, Number(data.marksheetSettings.watermarkCenterSize ?? 360))
    : Math.max(24, Number(data.marksheetSettings.watermarkRepeatSize ?? 60));
  const watermarkStyle = doc.createElement('style');
  watermarkStyle.textContent = watermark
    ? `.main-content::before{content:"";background-image:url("${watermark}")!important;background-repeat:${watermarkMode === 'repeat' ? 'repeat' : 'no-repeat'}!important;background-position:center!important;background-size:${watermarkMode === 'repeat' ? `${watermarkSize}px ${watermarkSize}px` : `min(${watermarkSize}px,90%) auto`}!important;opacity:${watermarkOpacity}!important;}`
    : `.main-content::before{content:none!important;background-image:none!important;}`;
  doc.head.append(watermarkStyle);

  // Result table: every cell, maximum, total and grade comes from selected exams.
  const table = doc.querySelector<HTMLTableElement>('table.w-full.table-fixed');
  const head = doc.getElementById('marksTableHead') || table?.querySelector('thead');
  const body = doc.getElementById('marksTableBody');
  const foot = doc.getElementById('marksTableFoot');
  const makeCell = (tag: 'th' | 'td', value: string, className = '') => {
    const cell = doc.createElement(tag); cell.textContent = value; if (className) cell.className = className; return cell;
  };
  if (head && body) {
    head.replaceChildren(); body.replaceChildren(); foot?.replaceChildren();
    if (isMulti) {
      const header = doc.createElement('tr');
      header.append(makeCell('th', 'Subjects', 'w-44 py-2 px-3 text-left'));
      keys.forEach(key => header.append(makeCell('th', `${data.exams[key].shortName} (${fmtMarks(maxFor(key))})`, 'py-2 px-2')));
      if (keys.length > 1 && data.marksheetSettings.showTotalColumn !== false) header.append(makeCell('th', `Total (${fmtMarks(keys.reduce((sum, key) => sum + maxFor(key), 0))})`));
      if (data.marksheetSettings.showSubjectGrade !== false) header.append(makeCell('th', 'Grade'));
      head.append(header);
      const totals = Object.fromEntries(keys.map(key => [key, 0])) as Record<ExamKey, number>;
      rows.forEach(row => {
        const tr = doc.createElement('tr'); tr.append(makeCell('td', row.subject.name, 'py-1.5 px-3 text-left'));
        row.examMarks.forEach((mark, index) => { totals[keys[index]] += mark ?? 0; tr.append(makeCell('td', mark === null ? '—' : fmtMarks(mark), 'py-1.5 px-2')); });
        if (keys.length > 1 && data.marksheetSettings.showTotalColumn !== false) tr.append(makeCell('td', fmtMarks(row.obtained)));
        if (data.marksheetSettings.showSubjectGrade !== false) tr.append(makeCell('td', row.maximum ? gradeForPercentage(row.percentage) : '—'));
        body.append(tr);
      });
      if (foot) {
        const totalRow = doc.createElement('tr'); totalRow.append(makeCell('th', 'Grand Total', 'py-1.5 px-3 text-left'));
        keys.forEach(key => totalRow.append(makeCell('th', fmtMarks(totals[key]))));
        if (keys.length > 1 && data.marksheetSettings.showTotalColumn !== false) totalRow.append(makeCell('th', fmtMarks(grandObtained)));
        if (data.marksheetSettings.showSubjectGrade !== false) totalRow.append(makeCell('th', overallGrade));
        foot.append(totalRow);
      }
    } else {
      const header = doc.createElement('tr'); header.append(makeCell('th', '#', 'py-2 px-2'));
      rows.forEach(row => header.append(makeCell('th', row.subject.name, 'py-2 px-1')));
      head.append(header);
      const fullMarksRow = doc.createElement('tr'); fullMarksRow.append(makeCell('th', 'Full Marks', 'py-2 px-2'));
      rows.forEach(row => fullMarksRow.append(makeCell('td', fmtMarks(maxFor(keys[0])), 'py-2 px-1')));
      const marksRow = doc.createElement('tr'); marksRow.append(makeCell('th', 'Obtained Marks', 'py-2 px-2'));
      rows.forEach(row => marksRow.append(makeCell('td', row.examMarks[0] === null ? '—' : fmtMarks(row.examMarks[0]!), 'py-2 px-1')));
      body.append(fullMarksRow);
      if (data.marksheetSettings.showMarksRow !== false) body.append(marksRow);
      if (data.marksheetSettings.showGradeRow !== false && data.marksheetSettings.showSubjectGrade !== false) {
        const gradeRow = doc.createElement('tr'); gradeRow.append(makeCell('th', 'Grade', 'py-2 px-2'));
        rows.forEach(row => gradeRow.append(makeCell('td', row.examMarks[0] === null ? '—' : gradeForPercentage(row.percentage), 'py-2 px-1')));
        body.append(gradeRow);
      }
    }
  }

  // Grading scale must reflect configured rules, in their configured priority order.
  const gradingScale = [...doc.querySelectorAll('div')].find(el => el.children.length >= 3 && el.textContent?.trim().startsWith('Grading Scale'));
  if (gradingScale) {
    gradingScale.replaceChildren();
    const label = doc.createElement('span'); label.className = 'font-bold text-slate-900 uppercase'; label.textContent = 'Grading Scale :'; gradingScale.append(label);
    data.grading.grades.forEach(rule => {
      const item = doc.createElement('span');
      const strong = doc.createElement('strong'); strong.textContent = rule.grade;
      item.append(strong, doc.createTextNode(` (${rule.operator || '>='}${fmtMarks(rule.minPercentage)}%)`)); gradingScale.append(item);
    });
  }

  // Summary cards and visibility follow the marksheet configuration.
  setText('summaryMarks', `${fmtMarks(grandObtained)} / ${fmtMarks(grandMaximum)}`);
  setText('summaryPercentage', `${percentage.toFixed(1)}%`);
  setText('summaryAttendance', `${fmtMarks(presentDays)} / ${fmtMarks(workingDays)}`);
  setText('summaryGrade', overallGrade);
  setText('teacherRemarks', remarks);
  const summary = doc.getElementById('summaryMarks')?.closest('.grid.grid-cols-2');
  hide(summary, data.marksheetSettings.showOverallSummary === false);
  hide(doc.getElementById('summaryAttendance')?.parentElement, data.marksheetSettings.showAttendance === false);
  hide(doc.getElementById('summaryGrade')?.parentElement, data.marksheetSettings.showGrade === false);
  hide(doc.getElementById('teacherRemarks')?.parentElement, data.marksheetSettings.showRemarks === false);

  // Subject performance chart uses the same selected-exam values as the table.
  setText('marksChartScale', keys.length === 1 ? `Marks obtained / ${fmtMarks(maxFor(keys[0]))}` : `Total marks / ${fmtMarks(keys.reduce((sum, key) => sum + maxFor(key), 0))}`);
  setText('marksChartAverage', `${percentage.toFixed(1)}%`);
  setText('marksChartCaption', `${rows.length} subjects · performance across selected exams`);
  const chart = doc.getElementById('marksChart');
  if (chart) {
    chart.replaceChildren();
    rows.forEach(row => {
      const item = doc.createElement('div'); item.className = 'marks-chart__item';
      const value = doc.createElement('div'); value.className = 'marks-chart__value'; value.textContent = `${fmtMarks(row.obtained)}/${fmtMarks(row.maximum)}`;
      const track = doc.createElement('div'); track.className = 'marks-chart__track'; track.setAttribute('role', 'img');
      track.setAttribute('aria-label', `${row.subject.name}: ${fmtMarks(row.obtained)} out of ${fmtMarks(row.maximum)} (${row.percentage.toFixed(1)}%)`);
      const bar = doc.createElement('div'); bar.className = 'marks-chart__bar'; bar.style.setProperty('--bar-height', `${Math.max(0, Math.min(100, row.percentage))}%`); track.append(bar);
      const subject = doc.createElement('div'); subject.className = 'marks-chart__subject'; subject.textContent = row.subject.name;
      item.append(value, track, subject); chart.append(item);
    });
  }

  // Compact, readable QR payload. Keep it aligned with the selected exams and
  // the same marks precision used throughout the marksheet.
  const qr = doc.querySelector<HTMLImageElement>('img[alt="Verification QR Code"]');
  if (qr) {
    const sessionLabel = data.academicSession.replace(/^(\d{4})-(\d{4})$/, (_m, a, b) => `${a}-${b.slice(-2)}`);
    const schoolInitials = (data.school.name || 'NATIONAL PUBLIC SCHOOL')
      .trim().split(/\s+/).filter(Boolean).map(word => word[0]).join('').toUpperCase() || 'NPS';
    const examLabels: Record<ExamKey, string> = {
      pa1: 'PA1', pa2: 'PA2', hy: 'HY', pa3: 'PA3', pa4: 'PA4', final: 'Final'
    };
    const examLabel = keys.map(key => examLabels[key] || data.exams[key]?.shortName || key.toUpperCase()).join('+');
    const subjectAbbreviations: Record<string, string> = {
      hindi: 'Hi', english: 'En', math: 'Ma', maths: 'Ma', mathematics: 'Ma',
      science: 'Sc', 'social science': 'SS', 'social studies': 'SS',
      computer: 'Co', 'computer science': 'Co'
    };
    const abbreviateSubject = (name: string) => {
      const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
      return subjectAbbreviations[normalized] || name.trim().split(/\s+/).map(word => word.slice(0, 1)).join('').slice(0, 3).toUpperCase() || 'Sub';
    };
    const subjectTokens = rows.map(row => `${abbreviateSubject(row.subject.name)}:${fmtMarks(row.obtained)}`);
    const subjectLines: string[] = [];
    for (let i = 0; i < subjectTokens.length; i += 3) subjectLines.push(subjectTokens.slice(i, i + 3).join(' '));
    const maxPerSubject = rows.length ? rows[0].maximum : grandMaximum;
    const qrPayload = [
      `${schoolInitials} | ${examLabel} | ${sessionLabel}`,
      student.name || '—',
      `Class:${classLabel} | Roll:${student.roll || '—'}`,
      `Max:${fmtMarks(maxPerSubject)}`,
      ...subjectLines,
      `Total:${fmtMarks(grandObtained)}/${fmtMarks(grandMaximum)} (${percentage.toFixed(2)}%)`,
      `Grade:${overallGrade || '—'}`,
      `Att:${fmtMarks(presentDays)}/${fmtMarks(workingDays)}d (${attendancePercentage.toFixed(2)}%)`
    ].join('\n');
    qr.src = await QRCode.toDataURL(qrPayload, { width: 800, margin: 2, errorCorrectionLevel: 'M', type: 'image/png' });
    qr.alt = `Readable result QR code for ${student.name}`;
    qr.style.imageRendering = 'pixelated';
  }

  // Signature row: only configured/enabled School Profile blocks are rendered.
  // Names and transparent PNGs sit above each divider; labels share one baseline.
  const issueDate = doc.getElementById('issueDate');
  const signatureRow = issueDate?.parentElement?.parentElement;
  if (signatureRow) {
    signatureRow.replaceChildren();
    signatureRow.className = 'w-full flex justify-around items-end flex-wrap px-4 pt-6 pb-4 gap-y-3';
    const dateBlock = doc.createElement('div'); dateBlock.className = 'flex flex-col items-center'; dateBlock.style.width = '18%';
    if (modernSettings.showIssueDate !== false) {
      const dateValue = doc.createElement('div'); dateValue.className = 'font-bold text-base data pb-1'; const now = new Date(); const dd = String(now.getDate()).padStart(2,'0'); const mm = String(now.getMonth()+1).padStart(2,'0'); const yyyy = String(now.getFullYear()); const dateFormat = modernSettings.issueDateFormat || 'DD-MM-YYYY'; dateValue.textContent = dateFormat === 'YYYY-MM-DD' ? `${yyyy}-${mm}-${dd}` : dateFormat === 'DD/MM/YYYY' ? `${dd}/${mm}/${yyyy}` : `${dd}-${mm}-${yyyy}`;
      const dateLine = doc.createElement('div'); dateLine.className = 'w-full font-bold text-xs uppercase tracking-wider border-t-2 border-dashed border-slate-700 pt-1 text-center'; dateLine.textContent = modernSettings.issueDateLabel?.trim() || 'Date';
      dateBlock.append(dateValue, dateLine); signatureRow.append(dateBlock);
    }
    const signatures = (data.marksheetSettings.signatures || []).filter(signature => signature.enabled && signature.label.trim()).slice(0, 4);
    signatures.forEach(signature => {
      const block = doc.createElement('div'); block.className = 'flex flex-col items-center'; block.style.width = `${Math.min(24, 92 / (signatures.length + (modernSettings.showIssueDate !== false ? 1 : 0))) }%`; 
      const signatureWidthMm = Math.min(60, Math.max(15, Number(signature.widthMm) || 32));
      const signatureHeightMm = Math.min(20, Math.max(5, Number(signature.heightMm) || 10));
      const signatureHeightPx = signatureHeightMm * 3.7795;
      const content = doc.createElement('div'); content.className = 'w-full flex flex-col items-center justify-end'; content.style.minHeight = `${Math.max(46, signatureHeightPx + 16)}px`;
      if (signature.signatureImage) {
        const image = doc.createElement('img'); image.src = signature.signatureImage; image.alt = `${signature.label} signature`; image.className = 'object-contain mb-0.5'; image.style.width = `${signatureWidthMm}mm`; image.style.height = `${signatureHeightMm}mm`; image.style.maxWidth = '100%'; image.style.objectFit = 'contain'; image.style.background = 'transparent'; content.append(image);
      } else {
        const spacer = doc.createElement('div'); spacer.style.width = `${signatureWidthMm}mm`; spacer.style.height = `${signatureHeightMm}mm`; content.append(spacer);
      }
      if (signature.name.trim()) {
        const name = doc.createElement('div'); name.className = 'font-semibold text-[10px] text-center leading-tight'; name.textContent = signature.name; content.append(name);
      }
      const divider = doc.createElement('div'); divider.className = 'w-full border-t-2 border-dashed border-slate-700 mt-0.5';
      const label = doc.createElement('div'); label.className = 'w-full font-bold text-xs uppercase tracking-wider pt-1 text-center'; label.textContent = signature.label;
      block.append(content, divider, label); signatureRow.append(block);
    });
    hide(signatureRow, modernSettings.showIssueDate === false && signatures.length === 0);
  }

  // The supplied contact strip contains hard-coded phone numbers not stored in
  // School Profile. Do not print those demo contacts on real student records.
  const contactStrip = [...doc.querySelectorAll('body > section .bg-slate-800')].find(el => el.textContent?.includes('9128289100') || el.textContent?.includes('9973757920'));
  if (contactStrip) contactStrip.remove();

  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
