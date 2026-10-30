export type Student = {
  studentId: string;
  roll: string;
  name: string;
  father: string;
  mother: string;
  dob: string;
  gender: string;
  photo?: string;
  attendance: { workingDays: number; daysPresent: number; daysAbsent: number; remarks: string };
  remarks: { overall: string; attendance: string; subjects: Record<string, string> };
};
export type ExamKey = 'pa1' | 'pa2' | 'hy' | 'pa3' | 'pa4' | 'final';
export type Marks = Record<string, string | number | null> & { studentId: string; roll: string };
export type GradeRule = { grade: string; minPercentage: number; operator?: '>=' | '>' | '<=' | '<' };
export type SignatureBlock = { id: string; label: string; name: string; signatureImage?: string; enabled: boolean; widthMm?: number; heightMm?: number };
export type School = {
  name: string; address: string; affiliation: string; registrationNumber: string;
  established: string; logo?: string; logoLeft?: string; logoRight?: string; watermark?: string; watermarkUseLeftLogo?: boolean; rightLogoUseLeftLogo?: boolean; showLeftLogo?: boolean; showRightLogo?: boolean; showWatermark?: boolean; principalName: string;
  examControllerName: string; classTeacherName: string;
};
export type AppData = {
  schemaVersion: string;
  academicSession: string;
  examType: string;
  classInfo: { className: string; section: string; classTeacher: string; totalWorkingDays: number };
  school: School;
  subjects: { id: string; name: string; enabled?: boolean }[];
  classSubjectConfigs: Record<string, { id: string; name: string; enabled?: boolean }[]>;
  exams: Record<ExamKey, { name: string; shortName: string; maxMarks: number; weightage: number }>;
  students: Student[];
  results: Record<ExamKey, Marks[]>;
  grading: { passPercentage: number; grades: GradeRule[] };
  marksheetSettings: {
    showPhoto: boolean; showAttendance: boolean; showRemarks: boolean; showGrade: boolean;
    tableOrientation: 'auto' | 'subjects-rows' | 'subjects-columns';
    reportExams: ExamKey[]; showTotalColumn: boolean; showSubjectGrade: boolean;
    showMarksRow: boolean; showGradeRow: boolean; showOverallSummary: boolean; marksPrecision: 0 | 1 | 2; watermarkMode: 'repeat' | 'single'; watermarkOpacity: number; watermarkRepeatSize: number; watermarkCenterSize: number;
    showIssueDate: boolean; issueDateFormat: 'DD-MM-YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD'; issueDateLabel: string;
    signatures: SignatureBlock[];
  };
  settings: { sectionEnabled: boolean };
  remarkRules: {
    overall: { grade: string; text: string }[];
    weakSubjectBelowPercentage: number;
    weakSubjectTemplate: string;
    attendanceBelowPercentage: number;
    attendanceTemplate: string;
  };
};
