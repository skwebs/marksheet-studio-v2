import type { AppData, ExamKey, Student } from './types';
import { getExamKeys } from './data';

export const hasMark = (value: unknown): boolean => value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '') && Number.isFinite(Number(value));
export const numericMark = (value: unknown): number => hasMark(value) ? Number(value) : 0;
export const roundMarks = (data: AppData, value: number): number => {
  const precision = Math.max(0, Math.min(2, Number(data.marksheetSettings.marksPrecision ?? 1)));
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
export const weightageMaximum = (data: AppData, key: ExamKey): number => Math.max(0, roundMarks(data, Number(data.exams[key]?.weightage) || 0));
export const convertedWeightage = (data: AppData, key: ExamKey, actualMarks: unknown): number => {
  const actualMaximum = Number(data.exams[key]?.maxMarks) || 0;
  const contribution = Number(data.exams[key]?.weightage) || 0;
  if (!hasMark(actualMarks) || actualMaximum <= 0 || contribution < 0) return 0;
  return roundMarks(data, (Number(actualMarks) / actualMaximum) * contribution);
};
export function calculateStudentPerformance(data: AppData, student: Student, keys: ExamKey[] = getExamKeys(data)) {
  const subjects = data.subjects.filter(subject => subject.enabled !== false);
  let obtained = 0;
  let maximum = 0;
  const subjectRows = subjects.map(subject => {
    let subjectObtained = 0;
    let subjectMaximum = 0;
    for (const key of keys) {
      const markRow = data.results[key]?.find(mark => mark.studentId === student.studentId || (!!student.roll && mark.roll === student.roll));
      const raw = markRow?.[subject.id];
      if (!hasMark(raw)) continue;
      subjectObtained += convertedWeightage(data, key, raw);
      subjectMaximum += weightageMaximum(data, key);
    }
    obtained += subjectObtained;
    maximum += subjectMaximum;
    return { subject, obtained: subjectObtained, maximum: subjectMaximum, percentage: subjectMaximum ? subjectObtained / subjectMaximum * 100 : 0 };
  });
  return { obtained, maximum, percentage: maximum ? obtained / maximum * 100 : 0, subjectRows };
}
export function calculatePromotionScore(data: AppData, student: Student, keys: ExamKey[] = data.settings.promotionExams?.length ? data.settings.promotionExams : getExamKeys(data)) {
  const performance = calculateStudentPerformance(data, student, keys);
  return { obtained: performance.obtained, maximum: performance.maximum, percentage: performance.percentage };
}
export function getDataReadiness(data: AppData, studentIds?: string[]) {
  const students = studentIds ? data.students.filter(student => studentIds.includes(student.studentId)) : data.students;
  const missingRequiredStudents = students.filter(student => data.settings.requiredStudentFields.some(field => !String((student as any)[field] ?? '').trim()));
  const missingRecommendedStudents = students.flatMap(student => data.settings.recommendedStudentFields.filter(field => !String((student as any)[field] ?? '').trim()).map(field => ({ student, field })));
  const requiredMarksMissing: Array<{ student: Student; exam: string; subject: string }> = [];
  const recommendedMarksMissing: Array<{ student: Student; exam: string; subject: string }> = [];
  const activeExams = getExamKeys(data);
  const reportExams = (data.marksheetSettings.reportExams?.length ? data.marksheetSettings.reportExams : activeExams).filter(key => activeExams.includes(key));
  for (const student of students) for (const exam of reportExams) for (const subject of data.subjects.filter(item => item.enabled !== false)) {
    const mark = data.results[exam]?.find(row => row.studentId === student.studentId)?.[subject.id];
    if (!hasMark(mark)) {
      if (data.settings.requiredExamMarks.includes(exam)) requiredMarksMissing.push({ student, exam, subject: subject.name });
      else if (data.settings.recommendedExamMarks.includes(exam)) recommendedMarksMissing.push({ student, exam, subject: subject.name });
    }
  }
  return { missingRequiredStudents, missingRecommendedStudents, requiredMarksMissing, recommendedMarksMissing, totalStudents: students.length };
}
