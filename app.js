// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Application State
const state = {
  students: [],       // Array of parsed student records
  subjects: {},       // Map of subject code -> name
  departments: {},    // Map of branch code -> statistics
  nameMap: {},        // Map of roll number -> student name
  scheme: '2019',     // KTU scheme ('2019' or '2015')
  gradePoints: {},    // Grade -> point value map
  customCredits: {},  // Subject code -> credit override map (legacy, replaced by globalCreditsMap)
  charts: {},         // Active Chart.js instances (to destroy before re-rendering)
  activeTab: 'dashboard', // Track active tab
  sortState: {
    dept: { column: 'passPercentage', direction: 'desc' },
    subject: { column: 'failed', direction: 'desc' },
    student: { column: 'classRank', direction: 'asc' }
  }
};

const globalCreditsMap = {};

function getActiveStudents() {
  const mainFilter = document.getElementById('dept-operation-filter');
  const selectedBranch = mainFilter ? mainFilter.value : 'ALL';
  if (!selectedBranch || selectedBranch === 'ALL') {
    return state.students;
  }
  // Check if selectedBranch is a valid branch in the loaded students list
  const hasBranch = state.students.some(s => s.branch === selectedBranch);
  if (!hasBranch) {
    return state.students;
  }
  return state.students.filter(s => s.branch === selectedBranch);
}

function getActiveDepartments() {
  const mainFilter = document.getElementById('dept-operation-filter');
  const selectedBranch = mainFilter ? mainFilter.value : 'ALL';
  if (!selectedBranch || selectedBranch === 'ALL') {
    return state.departments;
  }
  // Check if selectedBranch exists in state.departments
  if (!state.departments[selectedBranch]) {
    return state.departments;
  }
  const filtered = {};
  filtered[selectedBranch] = state.departments[selectedBranch];
  return filtered;
}

function getInitialDefaultCredits(courseCode, scheme) {
  if (!courseCode) return 3;
  const code = courseCode.toUpperCase().trim();
  
  // Assign 1 credit for 404-series comprehensive courses
  if (code.endsWith('404')) return 1;
  
  if (scheme === '2019') {
    if (code.startsWith('MAT')) return 4;
    if (code.startsWith('HUN')) return 2;
    if (code.startsWith('MCN')) return 0;
    
    // Assign 4 credits for 416-series project courses
    if (code.endsWith('416') || ['MED416', 'CED416', 'EED416', 'ECD416', 'CSD416', 'CAD416', 'CGD416'].includes(code)) {
      return 4;
    }
    
    if (code.length >= 3) {
      const third = code[2];
      if (third === 'L' || third === 'P') return 1;
      if (third === 'T') return 3;
    }
    return 3;
  }
  
  if (scheme === '2024') {
    // Step 0: Wellness / Health & Activity Courses (HWT or UCH prefix)
    if (code.includes('HWT') || code.startsWith('UCH')) return 1;

    // Step 1: Lab Detection (Highest Priority)
    if (code.length >= 5 && code[4] === 'L') {
      const numStr = code.substring(5, 8);
      if (numStr.length === 3) {
        const firstChar = numStr[0];
        if (firstChar === '1' || firstChar === '2') return 1;
        if (firstChar >= '3') return 2;
      }
    }
    
    // Step 2: Category Prefix Rules (First 2 characters)
    const prefix2 = code.substring(0, 2);
    if (prefix2 === 'PC' || prefix2 === 'PB') return 4;
    if (prefix2 === 'PE') return 3;
    
    // Step 3: Keyword Track Matching
    if (code.includes('MAT')) return 3;
    if (code.includes('PHT') || code.includes('CYT')) return 4;
    if (code.includes('HUT')) return 2;
    if (code.includes('EST')) return 3;
    
    // Step 4: Default Fallback
    return 3;
  }
  
  return 3;
}

// Branch Code to Human-readable Name Map
const branchNames = {
  'CS': 'Computer Science & Engineering',
  'DS': 'Computer Science & Engineering (Data Science)',
  'AD': 'Artificial Intelligence & Data Science',
  'CY': 'Computer Science & Engineering (Cyber Security)',
  'AM': 'Artificial Intelligence & Machine Learning',
  'CSOT': 'Computer Science & Engineering (IoT)',
  'EC': 'Electronics & Communication Engineering',
  'EE': 'Electrical & Electronics Engineering',
  'ME': 'Mechanical Engineering',
  'CE': 'Civil Engineering',
  'IT': 'Information Technology',
  'CH': 'Chemical Engineering',
  'AE': 'Applied Electronics & Instrumentation',
  'BT': 'Biotechnology',
  'MR': 'Marine Engineering',
  'PE': 'Production Engineering',
  'AU': 'Automobile Engineering',
  'MT': 'Metallurgical & Materials Engineering'
};

// Default Grade Points Configuration
const defaultGrades = {
  '2015': { 'O': 10, 'A+': 9, 'A': 8.5, 'B+': 8, 'B': 7, 'C': 6, 'D': 5.5, 'P': 5, 'PASS': 5, 'FAIL': 0, 'F': 0, 'FE': 0, 'I': 0 },
  '2019': { 'S': 10, 'A+': 9.0, 'A': 8.5, 'B+': 8.0, 'B': 7.5, 'C+': 7.0, 'C': 6.5, 'D': 6.0, 'P': 5.5, 'PASS': 5.5, 'FAIL': 0, 'F': 0, 'FE': 0, 'I': 0 },
  '2024': { 'S': 10, 'A+': 9.0, 'A': 8.5, 'B+': 8.0, 'B': 7.5, 'C+': 7.0, 'C': 6.5, 'D': 6.0, 'P': 5.5, 'PASS': 5.5, 'FAIL': 0, 'F': 0, 'FE': 0, 'I': 0 }
};

function getGradePoints(grade, scheme) {
  let g = (grade || '').toUpperCase().trim();
  if (g === 'PASS') {
    g = 'P';
  }
  const s = scheme || state.scheme || '2019';
  const pointsMap = defaultGrades[s] || defaultGrades['2019'];
  return pointsMap[g] !== undefined ? pointsMap[g] : 0.0;
}

function getCompletedCredits(student) {
  let completed = 0;
  Object.keys(student.grades).forEach(subCode => {
    const grade = student.grades[subCode];
    if (!['F', 'FE', 'I', 'FAIL'].includes(grade)) {
      const credit = globalCreditsMap[subCode] !== undefined ? globalCreditsMap[subCode] : getInitialDefaultCredits(subCode, state.scheme);
      completed += credit;
    }
  });
  return completed;
}

// Initialize the Application
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initSchemeConfig();
    setupEventListeners();
    setupTableSorting();
  });
} else {
  initSchemeConfig();
  setupEventListeners();
  setupTableSorting();
}

// Initialize Scheme configurations from dropdown selection
function initSchemeConfig() {
  const selectScheme = document.getElementById('select-scheme');
  if (selectScheme) {
    state.scheme = selectScheme.value;
    state.gradePoints = { ...defaultGrades[state.scheme] };
  }
}

// Recalculate everything and refresh views when configuration updates
function recalculateAndRefresh() {
  processParsedData();
  populateDeptFilterOptions();
  populateUnivMaxerStudentList();
  renderActiveTab();
  updateKPIs();
}

function recalculateEverything() {
  recalculateAndRefresh();
}

function switchTab(tabId) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    const content = document.getElementById(`tab-${tabId}`);
    if (content) {
      content.classList.remove('hidden');
    }
    state.activeTab = tabId;
    renderActiveTab();
  }
}

// Setup Drag & Drop and interactive listeners
function setupEventListeners() {
  // Scheme Change
  document.getElementById('select-scheme').addEventListener('change', (e) => {
    initSchemeConfig();
    if (state.students.length > 0) {
      recalculateAndRefresh();
    }
  });

  // File Dropzones & Browsing
  setupDropzone('dropzone-result', 'file-input-result', handleResultFiles);
  setupDropzone('dropzone-names', 'file-input-names', handleNameMappingFile);

  // Tab Buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabId = e.target.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Direct Export Triggers
  document.getElementById('btn-export-excel').addEventListener('click', exportToExcelDirect);

  // Modal Close
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('details-modal').addEventListener('click', (e) => {
    if (e.target.id === 'details-modal') closeModal();
  });

  // SGPA Maxer Modal Close
  const btnCloseMaxer = document.getElementById('btn-sgpa-maxer-close');
  if (btnCloseMaxer) {
    btnCloseMaxer.addEventListener('click', closeSgpaMaxer);
  }
  const maxerModal = document.getElementById('sgpa-maxer-modal');
  if (maxerModal) {
    maxerModal.addEventListener('click', (e) => {
      if (e.target.id === 'sgpa-maxer-modal') closeSgpaMaxer();
    });
  }

  // Search & Filter listeners
  document.getElementById('search-student').addEventListener('input', renderStudentsTable);
  document.getElementById('filter-student-dept').addEventListener('change', renderStudentsTable);
  document.getElementById('filter-student-status').addEventListener('change', renderStudentsTable);
  document.getElementById('sort-student').addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'ROLL_ASC') {
      state.sortState.student = { column: 'id', direction: 'asc' };
    } else if (val === 'SGPA_DESC') {
      state.sortState.student = { column: 'sgpa', direction: 'desc' };
    } else if (val === 'SGPA_ASC') {
      state.sortState.student = { column: 'sgpa', direction: 'asc' };
    } else if (val === 'BACK_DESC') {
      state.sortState.student = { column: 'backlogs', direction: 'desc' };
    }
    updateHeaderArrows('table-body-student');
    renderStudentsTable();
  });
  document.getElementById('search-subject').addEventListener('input', renderSubjectsTable);
  const backlogFilter = document.getElementById('backlogBranchFilter');
  if (backlogFilter) {
    backlogFilter.addEventListener('change', renderBacklogsView);
  }
  const deptOpFilter = document.getElementById('dept-operation-filter');
  if (deptOpFilter) {
    deptOpFilter.addEventListener('change', () => {
      renderActiveTab();
      updateKPIs();
    });
  }

  // Universal SGPA Maxer Load Student
  const btnUnivLoad = document.getElementById('btn-univ-maxer-load');
  if (btnUnivLoad) {
    btnUnivLoad.addEventListener('click', loadUnivMaxerStudent);
  }
  const univSelect = document.getElementById('univ-maxer-student-select');
  if (univSelect) {
    univSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val) {
        document.getElementById('univ-maxer-search-input').value = val;
        loadUnivMaxerStudent();
      }
    });
  }

  // Global Credit Input listener
  document.addEventListener('input', function(e) {
    if (e.target.classList.contains('credit-slider')) {
      const subjectCode = e.target.dataset.subject;
      const newValue = parseInt(e.target.value) || 0;
      globalCreditsMap[subjectCode] = newValue;
      if (e.target.nextElementSibling && e.target.nextElementSibling.classList.contains('credit-value-badge')) {
        e.target.nextElementSibling.textContent = newValue;
      }
      recalculateEverything();
    }
  });
}

// Parses "MAT416:3, MED416:4" -> globalCreditsMap map
function parseCustomCredits(str) {
  if (!str) return;
  const parts = str.split(',');
  parts.forEach(part => {
    const [sub, cred] = part.split(':');
    if (sub && cred) {
      globalCreditsMap[sub.trim().toUpperCase()] = parseInt(cred.trim()) || 3;
    }
  });
}

// Helper to setup drag and drop
function setupDropzone(zoneId, inputId, fileHandler) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);

  zone.addEventListener('click', () => input.click());
  
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      fileHandler(e.dataTransfer.files);
    }
  });

  input.addEventListener('change', () => {
    if (input.files.length > 0) {
      fileHandler(input.files);
    }
  });
}

// ----------------------------------------------------
// FILE HANDLERS
// ----------------------------------------------------

// Handle official KTU result files (PDFs, text list)
async function handleResultFiles(files) {
  showLoading();
  const file = files[0];
  document.getElementById('badge-result').textContent = 'Processing...';
  document.getElementById('badge-result').className = 'status-badge pending';

  try {
    if (file.type === "application/pdf" || file.name.endsWith('.pdf')) {
      const reader = new FileReader();
      reader.onload = async function() {
        try {
          const typedarray = new Uint8Array(this.result);
          const pdf = await pdfjsLib.getDocument(typedarray).promise;
          let fullText = "";
          
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(" ");
            fullText += pageText + "\n";
          }
          
          parseKTUResultText(fullText);
          
          document.getElementById('badge-result').textContent = file.name.substring(0, 15) + '...';
          document.getElementById('badge-result').className = 'status-badge success';
          document.getElementById('status-result').classList.add('active');
          hideLoading();
        } catch (err) {
          alert("Error parsing PDF text: " + err.message);
          resetBadge('result');
          hideLoading();
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Direct text parsing (e.g. .txt or .csv files)
      const reader = new FileReader();
      reader.onload = function() {
        parseKTUResultText(this.result);
        document.getElementById('badge-result').textContent = file.name.substring(0, 15) + '...';
        document.getElementById('badge-result').className = 'status-badge success';
        document.getElementById('status-result').classList.add('active');
        hideLoading();
      };
      reader.readAsText(file);
    }
  } catch (err) {
    alert("Failed to load file: " + err.message);
    resetBadge('result');
    hideLoading();
  }
}

// Parse Student Name Mappings (CSV or Excel)
function handleNameMappingFile(files) {
  const file = files[0];
  document.getElementById('badge-names').textContent = 'Loading...';
  document.getElementById('badge-names').className = 'status-badge pending';

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet);
      
      state.nameMap = {};
      json.forEach(row => {
        // Look for columns representing Roll/Register No and Name
        const rollKeys = ['rollno', 'register_no', 'regno', 'roll_number', 'roll_no', 'student_id', 'id'];
        const nameKeys = ['name', 'student_name', 'fullname', 'full_name'];
        
        let rollVal = "";
        let nameVal = "";
        
        Object.keys(row).forEach(k => {
          const keyNormalized = k.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (rollKeys.includes(keyNormalized)) rollVal = String(row[k]).trim().toUpperCase();
          if (nameKeys.includes(keyNormalized)) nameVal = String(row[k]).trim();
        });
        
        // Fallback: use first and second column if headers didn't match
        if (!rollVal || !nameVal) {
          const keys = Object.keys(row);
          if (keys.length >= 2) {
            rollVal = String(row[keys[0]]).trim().toUpperCase();
            nameVal = String(row[keys[1]]).trim();
          }
        }
        
        if (rollVal && nameVal) {
          state.nameMap[rollVal] = nameVal;
        }
      });
      
      const count = Object.keys(state.nameMap).length;
      document.getElementById('badge-names').textContent = `${count} Names Loaded`;
      document.getElementById('badge-names').className = 'status-badge success';
      document.getElementById('status-names').classList.add('active');
      
      // Update existing student structures with new names
      if (state.students.length > 0) {
        state.students.forEach(stud => {
          stud.name = state.nameMap[stud.id] || "Student " + stud.roll;
        });
        recalculateAndRefresh();
      }
    } catch (err) {
      alert("Error loading name mappings: " + err.message);
      resetBadge('names');
    }
  };
  reader.readAsArrayBuffer(file);
}

function resetBadge(type) {
  const badge = document.getElementById(`badge-${type}`);
  const status = document.getElementById(`status-${type}`);
  badge.textContent = type === 'result' ? 'No File' : 'None';
  badge.className = 'status-badge pending';
  status.classList.remove('active');
}

function cleanAndExtractSubjects(rawSubjectCode, rawSubjectName) {
    let cleanedName = rawSubjectName.trim();
    let extractedVivaCode = null;

    // Truncate at the first newline if any to prevent cross-line bleeding of student records
    const newlineIndex = cleanedName.indexOf('\n');
    if (newlineIndex !== -1) {
        cleanedName = cleanedName.substring(0, newlineIndex).trim();
    }

    // 1. Identify embedded 416 projects
    const vivaMatch = cleanedName.match(/\b(MED416|CED416|EED416|ECD416|CSD416|CAD416|CGD416)\b/i);
    if (vivaMatch) {
        extractedVivaCode = vivaMatch[1].toUpperCase();
    }

    // 2. Heavy-Duty Bleed Separation Layer
    const codeBleedMatch = cleanedName.match(/\b([A-Z]{3,4}\d{3})\b/i);
    if (codeBleedMatch && codeBleedMatch[1].toUpperCase() !== rawSubjectCode.toUpperCase()) {
        const bleedingCode = codeBleedMatch[1].toUpperCase();
        const bleedIndex = cleanedName.indexOf(codeBleedMatch[0]);
        
        let bleedingCourseName = cleanedName.substring(bleedIndex + codeBleedMatch[0].length).trim();
        const nextBleed = bleedingCourseName.match(/\b([A-Z]{3,4}\d{3})\b/i);
        if (nextBleed) {
            bleedingCourseName = bleedingCourseName.substring(0, bleedingCourseName.indexOf(nextBleed[0])).trim();
        }
        
        cleanedName = cleanedName.substring(0, bleedIndex).trim();
        
        if (bleedingCode && bleedingCourseName && !bleedingCourseName.match(/^[A-Z]{3,4}\d{3}$/)) {
            if (typeof state !== 'undefined' && state.subjects) {
                state.subjects[bleedingCode] = bleedingCourseName;
            }
        }
    }

    // 3. Vaporize layout structural headers, student registration formats, and code mirrors
    cleanedName = cleanedName
        .replace(/(R|r)?egister\s+No\.?\s+Course\s+Code\s*\(Grade\)/gi, '') // Wipes out "Register No Course Code (Grade)"
        .replace(/\b[A-Z]{3,4}\d{2}[A-Z]{2,4}\d{2,4}\b/gi, '')             // Wipes out student roll numbers (e.g. LPRC22ME019)
        .replace(new RegExp(`\\b${rawSubjectCode}\\b`, 'gi'), '')          // Wipes out duplicates of itself
        .replace(/COMPREHENSIVE\s+VIVA\s+VOCE/gi, '')
        .replace(/COMPREHENSIVE\s+COURSE\s+VIVA/gi, '')
        .replace(/PROJECT\s+PHASE\s+II\s+R/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    // 4. Uniform Fallback System
    if (!cleanedName) {
        if (rawSubjectCode.endsWith('404')) {
            cleanedName = "COMPREHENSIVE VIVA VOCE";
        } else if (rawSubjectCode.endsWith('415')) {
            cleanedName = "COMPREHENSIVE COURSE VIVA";
        } else if (rawSubjectCode.endsWith('416') || ['MED416', 'CED416', 'EED416', 'ECD416', 'CSD416', 'CAD416', 'CGD416'].includes(rawSubjectCode)) {
            cleanedName = "PROJECT PHASE II";
        } else {
            const dept = rawSubjectCode.substring(0, 3).toUpperCase();
            cleanedName = `${dept} Course / Elective`;
        }
    }

    return { cleanedName, extractedVivaCode };
}

// ----------------------------------------------------
// KTU RESULT SHEET TEXT PARSER
// ----------------------------------------------------

function parseKTUResultText(text) {
  state.customBranchNames = {};
  
  const segments = text.split(/Branch\s*:/i);
  segments.forEach((segment, idx) => {
    if (idx === 0) return;
    
    const headerMatch = segment.match(/^\s*([A-Z\s&,\(\)-]+?)(?=\s*(?:Semester|Course|Register|College|$|\r?\n))/i);
    let deptName = headerMatch ? headerMatch[1].trim() : segment.split('\n')[0].trim();
    deptName = deptName.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
    
    const studentRegexSegment = /\b(L?)([A-Z]{3})(\d{2})([A-Z]{2,4})(\d{3})\b/g;
    let match;
    while ((match = studentRegexSegment.exec(segment)) !== null) {
      const branchCode = match[4].toUpperCase();
      if (deptName && branchCode) {
        state.customBranchNames[branchCode] = deptName;
      }
    }
  });

  // 1. Scan for Course Code -> Name Mappings
  // Example lines from PDF text:
  // "MET416 COMPOSITE MATERIALS"
  // "MET468 ADDITIVE MANUFACTURING"
  state.subjects = {};
  // CRITICAL: Move regex here to avoid global state accumulation across document runs
  const courseMappingRegex = /\b([A-Z]{3,4}\d{3})\b([\s\S]+?)(?=\b[A-Z]{3,4}\d{3}\b|$)/g;
  courseMappingRegex.lastIndex = 0; // Clear execution pointer completely

  let subMatch;
  while ((subMatch = courseMappingRegex.exec(text)) !== null) {
    const code = subMatch[1].toUpperCase();
    const name = subMatch[2].trim();
    
    if (!code.match(/^[A-Z]{5,}/) && !name.match(/^(GENERATED|APJ ABDUL|REG NO|COURSE CODE)/i) && !name.startsWith('(')) {
      const { cleanedName, extractedVivaCode } = cleanAndExtractSubjects(code, name);
      
      if (typeof state !== 'undefined' && state.subjects) {
        state.subjects[code] = cleanedName;
        
        if (extractedVivaCode) {
          state.subjects[extractedVivaCode] = "PROJECT PHASE II";
        }
      }
    }
  }

  // 2. Scan for Student Roll Numbers
  // E.g., LPRC22ME019 or PRC20ME011
  // Group 1: L prefix (lateral)
  // Group 2: College code (3 uppercase letters)
  // Group 3: Admission year (2 digits)
  // Group 4: Department/Branch (2 uppercase letters)
  // Group 5: Roll index (3 digits)
  const studentRegex = /\b(L?)([A-Z]{3})(\d{2})([A-Z]{2,4})(\d{3})\b/g;
  let match;
  const rawStudents = [];
  while ((match = studentRegex.exec(text)) !== null) {
    rawStudents.push({
      id: match[0],
      prefix: match[1],
      college: match[2],
      year: match[3],
      branch: match[4],
      roll: match[5],
      index: match.index
    });
  }

  if (rawStudents.length === 0) {
    alert("No student register numbers found in the uploaded document. Please check the file formatting.");
    return;
  }

  // Detect scheme dynamically from the parsed students' registration year
  let detectedScheme = state.scheme; // default to active UI scheme
  if (rawStudents.length > 0) {
    const years = rawStudents.map(s => parseInt(s.year) || 0);
    const has24 = years.some(y => y >= 24);
    const has15to18 = years.some(y => y >= 15 && y <= 18);
    if (has24) {
      detectedScheme = '2024';
    } else if (has15to18) {
      detectedScheme = '2015';
    } else if (years.some(y => y >= 19 && y <= 23)) {
      detectedScheme = '2019';
    }
  }

  // Update state and UI scheme select to match the detected scheme
  state.scheme = detectedScheme;
  const selectScheme = document.getElementById('select-scheme');
  if (selectScheme) {
    selectScheme.value = detectedScheme;
  }
  initSchemeConfig();

  // 3. Match Grades for each Student
  state.students = [];
  for (let i = 0; i < rawStudents.length; i++) {
    const student = rawStudents[i];
    const nextStudent = rawStudents[i + 1];
    
    // Extract text block between this student ID and next student ID
    const startIndex = student.index + student.id.length;
    const endIndex = nextStudent ? nextStudent.index : text.length;
    const blockText = text.substring(startIndex, endIndex);
    
    // Find all subject grade patterns: e.g., MET416(C) or MAT201(A+)
    const gradeRegex = /\b([A-Z0-9_\-/]+)\(([A-Za-z0-9+-]+)\)/g;
    let gradeMatch;
    const studentGrades = {};
    while ((gradeMatch = gradeRegex.exec(blockText)) !== null) {
      const subCode = gradeMatch[1].toUpperCase();
      let grade = gradeMatch[2].toUpperCase();
      if (grade === 'AB' || grade === 'ABSENT' || grade === 'FE') {
        grade = 'F';
      }
      studentGrades[subCode] = grade;
      
      // If subject was not mapped to a name yet, initialize with code as placeholder name
      if (!state.subjects[subCode]) {
        state.subjects[subCode] = subCode;
      }
    }
    
    // Skip students who have no grades parsed at all (noise matching roll number syntax)
    if (Object.keys(studentGrades).length > 0) {
      student.grades = studentGrades;
      student.name = state.nameMap[student.id] || "Student " + student.id.slice(-6);
      state.students.push(student);
    }
  }

  // Switch to analysis layout
  document.getElementById('empty-state-section').classList.add('hidden');
  document.getElementById('analysis-section').classList.remove('hidden');
  document.getElementById('btn-export-excel').classList.remove('hidden');

  // Run stats calculations
  recalculateAndRefresh();
}

// ----------------------------------------------------
// STATS GENERATOR / DATA PROCESSOR
// ----------------------------------------------------

function processParsedData() {
  // Reset aggregates
  state.departments = {};
  
  // Initialize default credits in globalCreditsMap for any new parsed subjects
  state.students.forEach(student => {
    Object.keys(student.grades).forEach(subCode => {
      if (globalCreditsMap[subCode] === undefined) {
        globalCreditsMap[subCode] = getInitialDefaultCredits(subCode, state.scheme);
      }
    });
  });
  
  // Determine regular batch year dynamically from state.students
  let regularBatchYear = "22"; // default fallback
  if (state.students.length > 0) {
    const yearCounts = {};
    state.students.forEach(s => {
      const match = s.id.match(/^(?:L)?PRC(\d{2})/i);
      const yr = match ? match[1] : (s.year || "22");
      yearCounts[yr] = (yearCounts[yr] || 0) + 1;
    });
    
    let dominantYear = null;
    let maxCount = 0;
    Object.keys(yearCounts).forEach(yr => {
      if (yearCounts[yr] > maxCount) {
        maxCount = yearCounts[yr];
        dominantYear = yr;
      }
    });
    if (dominantYear) {
      regularBatchYear = dominantYear;
    }
  }
  state.regularBatchYear = regularBatchYear;

  // 1. Calculate individual SGPA and Backlog info, assign isRegular & isSupply
  state.students.forEach(student => {
    const match = student.id.match(/^(?:L)?PRC(\d{2})/i);
    const studentBatchYear = match ? match[1] : (student.year || "22");
    
    student.isRegular = (studentBatchYear === regularBatchYear);
    student.isSupply = (studentBatchYear < regularBatchYear);

    let totalCredits = 0;
    let earnedGradePoints = 0;
    let backlogs = 0;
    let passedSubjects = 0;
    let totalSubjects = 0;
    
    Object.keys(student.grades).forEach(subCode => {
      const grade = student.grades[subCode];
      const credit = globalCreditsMap[subCode] !== undefined ? globalCreditsMap[subCode] : getInitialDefaultCredits(subCode, state.scheme);
      
      totalSubjects++;
      if (['F', 'FE', 'I', 'FAIL'].includes(grade)) {
        backlogs++;
      } else {
        passedSubjects++;
      }
      
      // Calculate grade points (failed courses count as 0, but credits count in SGPA denominator)
      // Non-standard grades like "PASS" or "FAIL" are treated as neutral (credits not added to totalCredits)
      if (grade !== 'FAIL') {
        let points = getGradePoints(grade, state.scheme);
        earnedGradePoints += points * credit;
        totalCredits += credit;
      }
    });
    
    student.backlogs = backlogs;
    student.passedCount = passedSubjects;
    student.totalCount = totalSubjects;
    student.status = backlogs === 0 ? 'PASS' : 'SUPPLY';
    student.sgpa = (totalCredits > 0) ? (earnedGradePoints / totalCredits) : 0.0;
  });

  // Sort students by SGPA descending to assign class rank
  state.students.sort((a, b) => b.sgpa - a.sgpa);
  state.students.forEach((stud, index) => {
    stud.classRank = index + 1;
  });

  // Assign department-specific ranks
  const deptsTemp = {};
  state.students.forEach(stud => {
    if (!deptsTemp[stud.branch]) deptsTemp[stud.branch] = [];
    deptsTemp[stud.branch].push(stud);
  });
  
  Object.keys(deptsTemp).forEach(branch => {
    // Sort department students by SGPA descending
    deptsTemp[branch].sort((a, b) => b.sgpa - a.sgpa);
    deptsTemp[branch].forEach((stud, index) => {
      stud.deptRank = index + 1;
    });
  });

  // 2. Generate Department-wise stats (ONLY for regular students to prevent contamination)
  state.students.forEach(student => {
    if (!student.isRegular) return;

    const branch = student.branch;
    if (!state.departments[branch]) {
      state.departments[branch] = {
        code: branch,
        name: branchNames[branch] || branch + " Department",
        appeared: 0,
        passed: 0,
        failed: 0,
        fullPass: 0,
        supply: 0,
        totalSgpa: 0,
        sgpaCount: 0,
        passPercentage: 0,
        averageSgpa: 0
      };
    }
    
    const d = state.departments[branch];
    d.appeared++;
    if (student.status === 'PASS' && student.sgpa > 0) {
      d.totalSgpa += student.sgpa;
      d.sgpaCount++;
    }
    
    if (student.status === 'PASS') {
      d.passed++;
      d.fullPass++;
    } else {
      d.failed++;
      d.supply++;
    }
  });

  // Compute final percentages & standings
  Object.keys(state.departments).forEach(branch => {
    const d = state.departments[branch];
    d.passPercentage = d.appeared > 0 ? (d.passed / d.appeared) * 100 : 0;
    d.averageSgpa = d.sgpaCount > 0 ? (d.totalSgpa / d.sgpaCount) : 0;
  });
}

// ----------------------------------------------------
// UI RENDERERS
// ----------------------------------------------------

function updateKPIs() {
  const activeStudents = getActiveStudents();
  const regularStudents = activeStudents.filter(s => s.isRegular);
  const totalStudents = regularStudents.length;
  if (totalStudents === 0) {
    document.getElementById('kpi-appeared').textContent = 0;
    document.getElementById('kpi-pass-rate').textContent = '0.0%';
    document.getElementById('kpi-failed').textContent = 0;
    document.getElementById('kpi-top-branch').textContent = 'N/A';
    document.getElementById('kpi-top-branch-sub').textContent = '';
    return;
  }

  const passedCount = regularStudents.filter(s => s.status === 'PASS').length;
  const failedCount = totalStudents - passedCount;
  const passRate = (passedCount / totalStudents) * 100;

  document.getElementById('kpi-appeared').textContent = totalStudents;
  document.getElementById('kpi-pass-rate').textContent = passRate.toFixed(1) + '%';
  document.getElementById('kpi-failed').textContent = failedCount;
  
  // Find top branch by pass percentage
  let topBranch = "N/A";
  let maxPassPct = -1;
  const activeDepts = getActiveDepartments();
  Object.keys(activeDepts).forEach(branch => {
    const d = activeDepts[branch];
    if (d.passPercentage > maxPassPct) {
      maxPassPct = d.passPercentage;
      topBranch = d.code;
    }
  });
  
  if (topBranch !== "N/A") {
    const bName = branchNames[topBranch] || topBranch;
    document.getElementById('kpi-top-branch').textContent = topBranch;
    document.getElementById('kpi-top-branch-sub').textContent = `${bName} (${maxPassPct.toFixed(1)}% Pass)`;
  } else {
    document.getElementById('kpi-top-branch').textContent = 'N/A';
    document.getElementById('kpi-top-branch-sub').textContent = '';
  }
}

function populateDeptFilterOptions() {
  const filterSelect = document.getElementById('backlogBranchFilter');
  const studentSelect = document.getElementById('filter-student-dept');
  const mainFilterSelect = document.getElementById('dept-operation-filter');
  const mainFilterWrapper = document.getElementById('dept-filter-wrapper');

  const prevFilterVal = filterSelect ? filterSelect.value : 'ALL';
  const prevStudentVal = studentSelect ? studentSelect.value : 'ALL';
  const prevMainVal = mainFilterSelect ? mainFilterSelect.value : 'ALL';

  if (filterSelect) {
    filterSelect.innerHTML = '<option value="ALL">Available Departments</option>';
  }
  if (studentSelect) {
    studentSelect.innerHTML = '<option value="ALL">All Departments</option>';
  }
  if (mainFilterSelect) {
    mainFilterSelect.innerHTML = '<option value="ALL">All Departments</option>';
  }

  // Extract departments directly from the keys used by the Department-wise analytics
  let departmentsList = [];
  if (typeof state !== 'undefined' && state.departments) {
    departmentsList = Object.keys(state.departments);
  } else if (typeof state !== 'undefined' && state.students) {
    // Fallback: Group directly from processed student branch fields
    departmentsList = [...new Set(state.students.map(s => s.branch).filter(Boolean))];
  }

  // Sort alphabetically (CS, EC, EE, ME)
  departmentsList.sort();

  // Dynamically append the options to the selection menus
  departmentsList.forEach(dept => {
    const value = dept.toUpperCase().trim();
    const displayName = branchNames[value] ? `${value} - ${branchNames[value]}` : value;
    
    if (filterSelect) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = displayName;
      filterSelect.appendChild(option);
    }
    if (studentSelect) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = displayName;
      studentSelect.appendChild(option);
    }
    if (mainFilterSelect) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = displayName;
      mainFilterSelect.appendChild(option);
    }
  });

  // Restore selection if option still exists
  if (filterSelect && filterSelect.querySelector(`option[value="${prevFilterVal}"]`)) {
    filterSelect.value = prevFilterVal;
  }
  if (studentSelect && studentSelect.querySelector(`option[value="${prevStudentVal}"]`)) {
    studentSelect.value = prevStudentVal;
  }
  if (mainFilterSelect && mainFilterSelect.querySelector(`option[value="${prevMainVal}"]`)) {
    mainFilterSelect.value = prevMainVal;
  }

  // Unhide the main filter wrapper
  if (mainFilterWrapper) {
    mainFilterWrapper.classList.remove('hidden');
  }
}

// Switch render views depending on current active tab
function renderActiveTab() {
  const activeTab = document.querySelector('.tab-btn.active').getAttribute('data-tab');
  
  if (activeTab === 'dashboard') {
    renderDashboardCharts();
  } else if (activeTab === 'department') {
    renderDepartmentsTable();
  } else if (activeTab === 'subject') {
    renderSubjectsTable();
  } else if (activeTab === 'student') {
    renderStudentsTable();
  } else if (activeTab === 'backlog') {
    renderBacklogsView();
  } else if (activeTab === 'sgpa-maxer') {
    renderUnivMaxerView();
  }
}

// --- TAB RENDER: DASHBOARD CHARTS ---
function renderDashboardCharts() {
  // Clear any existing chart objects to avoid memory leaks/glitches
  Object.keys(state.charts).forEach(key => {
    if (state.charts[key]) {
      state.charts[key].destroy();
    }
  });

  const activeDepts = getActiveDepartments();
  const depts = Object.keys(activeDepts).sort();
  const passPercentages = depts.map(d => activeDepts[d].passPercentage);
  const averageSgpas = depts.map(d => activeDepts[d].averageSgpa);

  const activeStudents = getActiveStudents();

  // 1. Chart: Dept Pass % (Bar Chart)
  const ctxDeptPass = document.getElementById('chart-dept-pass').getContext('2d');
  state.charts.deptPass = new Chart(ctxDeptPass, {
    type: 'bar',
    data: {
      labels: depts,
      datasets: [{
        label: 'Pass Percentage (%)',
        data: passPercentages,
        backgroundColor: 'rgba(42, 157, 143, 0.85)', // Vibrant Teal
        borderColor: '#2a9d8f',
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `Pass Percentage: ${context.parsed.y.toFixed(1)}%`
          }
        }
      },
      scales: {
        y: { beginAtZero: true, max: 100, grid: { color: '#E2DDD5' }, ticks: { color: '#2A2A2A', font: { family: 'Inter', weight: '600' } } },
        x: { grid: { display: false }, ticks: { color: '#2A2A2A', font: { family: 'Inter', weight: '600' } } }
      }
    }
  });

  // 2. Chart: Consolidated Grade Distribution (Doughnut Chart)
  const gradeCounts = {};
  // Initialize counts
  Object.keys(state.gradePoints).forEach(g => gradeCounts[g] = 0);
  
  activeStudents.forEach(student => {
    Object.values(student.grades).forEach(grade => {
      if (gradeCounts[grade] !== undefined) gradeCounts[grade]++;
    });
  });

  const gradeLabels = Object.keys(gradeCounts);
  const gradeValues = Object.values(gradeCounts);

  const gradeColorsMap = {
    'S': '#1d3557',
    'O': '#1d3557',
    'A+': '#2a9d8f',
    'A': '#457b9d',
    'B+': '#e9c46a',
    'B': '#f4a261',
    'C+': '#e76f51',
    'C': '#f8ad9d',
    'D': '#d3ab9e',
    'P': '#a8dadc',
    'F': '#e63946',
    'FE': '#d62828',
    'I': '#780000'
  };
  const chartColors = gradeLabels.map(label => gradeColorsMap[label] || '#cccccc');

  const ctxGradeDist = document.getElementById('chart-grade-dist').getContext('2d');
  state.charts.gradeDist = new Chart(ctxGradeDist, {
    type: 'doughnut',
    data: {
      labels: gradeLabels,
      datasets: [{
        data: gradeValues,
        backgroundColor: chartColors,
        borderWidth: 1.5,
        borderColor: '#FAF8F5'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#2A2A2A', font: { family: 'Inter', weight: '500' } } }
      }
    }
  });

  // 3. Subject-wise Failure Rate Chart (Bar Chart for difficult subjects)
  const subjectStats = {};
  activeStudents.forEach(student => {
    Object.keys(student.grades).forEach(subCode => {
      if (!subjectStats[subCode]) {
        subjectStats[subCode] = { registered: 0, failed: 0 };
      }
      subjectStats[subCode].registered++;
      if (['F', 'FE', 'I', 'FAIL'].includes(student.grades[subCode])) {
        subjectStats[subCode].failed++;
      }
    });
  });

  const subjectCodes = Object.keys(subjectStats);
  const failureRates = subjectCodes.map(code => {
    const s = subjectStats[code];
    return {
      code: code,
      failRate: s.registered > 0 ? (s.failed / s.registered) * 100 : 0
    };
  });

  // Sort and take top 8 highest failure rates
  failureRates.sort((a, b) => b.failRate - a.failRate);
  const topFailureRates = failureRates.slice(0, 8);

  const ctxSubjectFail = document.getElementById('chart-subject-fail').getContext('2d');
  state.charts.subjectFail = new Chart(ctxSubjectFail, {
    type: 'bar',
    data: {
      labels: topFailureRates.map(x => x.code),
      datasets: [{
        label: 'Failure Rate (%)',
        data: topFailureRates.map(x => x.failRate),
        backgroundColor: 'rgba(230, 57, 70, 0.85)', // Vibrant Crimson
        borderColor: '#e63946',
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, max: 100, grid: { color: '#E2DDD5' }, ticks: { color: '#2A2A2A', font: { family: 'Inter', weight: '600' } } },
        x: { grid: { display: false }, ticks: { color: '#2A2A2A', font: { family: 'Inter', weight: '600' } } }
      }
    }
  });

  // 4. Department Backlog Counts (Average backlogs per student in that branch)
  const deptBacklogs = {};
  depts.forEach(d => deptBacklogs[d] = { totalBacklogs: 0, count: 0 });

  activeStudents.forEach(student => {
    if (deptBacklogs[student.branch]) {
      deptBacklogs[student.branch].totalBacklogs += student.backlogs;
      deptBacklogs[student.branch].count++;
    }
  });

  const avgBacklogs = depts.map(d => {
    const stats = deptBacklogs[d];
    return stats.count > 0 ? (stats.totalBacklogs / stats.count) : 0;
  });

  const ctxDeptBacklogs = document.getElementById('chart-dept-backlogs').getContext('2d');
  state.charts.deptBacklogs = new Chart(ctxDeptBacklogs, {
    type: 'bar',
    data: {
      labels: depts,
      datasets: [{
        label: 'Average Backlogs per Student',
        data: avgBacklogs,
        backgroundColor: 'rgba(244, 162, 97, 0.85)', // Vibrant Amber-Orange
        borderColor: '#f4a261',
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#E2DDD5' }, ticks: { color: '#2A2A2A', font: { family: 'Inter', weight: '600' } } },
        x: { grid: { display: false }, ticks: { color: '#2A2A2A', font: { family: 'Inter', weight: '600' } } }
      }
    }
  });
}

// --- TAB RENDER: DEPARTMENT STANDINGS TABLE ---
function renderDepartmentsTable() {
  const tbody = document.getElementById('table-body-dept');
  tbody.innerHTML = '';

  const activeDepts = getActiveDepartments();
  const activeStudents = getActiveStudents();

  const col = state.sortState.dept.column;
  const dir = state.sortState.dept.direction === 'asc' ? 1 : -1;

  // Compute overall ranks based on passPercentage descending
  const rankMap = {};
  Object.values(activeDepts)
    .sort((a, b) => b.passPercentage - a.passPercentage)
    .forEach((dept, idx) => {
      rankMap[dept.code] = idx + 1;
    });

  const sortedDepts = Object.values(activeDepts).sort((a, b) => {
    let valA = a[col];
    let valB = b[col];
    
    if (col === 'rank') {
      valA = rankMap[a.code];
      valB = rankMap[b.code];
    }
    
    if (typeof valA === 'string') {
      return valA.localeCompare(valB) * dir;
    }
    return (valA - valB) * dir;
  });
  
  sortedDepts.forEach((dept) => {
    const rank = rankMap[dept.code];
    let badgeClass = "rank-other";
    if (rank === 1) badgeClass = "rank-1";
    else if (rank === 2) badgeClass = "rank-2";
    else if (rank === 3) badgeClass = "rank-3";

    const deptName = (state.customBranchNames && state.customBranchNames[dept.code]) || dept.name;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align: center;"><span class="rank-badge ${badgeClass}">${rank}</span></td>
      <td><strong>${dept.code}</strong></td>
      <td>${deptName}</td>
      <td style="text-align: center;">${dept.appeared}</td>
      <td style="text-align: center; color: var(--success); font-weight: 600;">${dept.fullPass}</td>
      <td style="text-align: center; color: ${dept.supply > 0 ? 'var(--danger)' : 'var(--text-muted)'};">${dept.supply}</td>
      <td style="text-align: center; font-weight: 700;">${dept.passPercentage.toFixed(1)}%</td>
      <td style="text-align: center; color: var(--accent-terracotta); font-weight: 600;">${dept.averageSgpa.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Calculate and populate Supplementary Clearances (Supply Pass Summary)
  const supplyStats = {};
  activeStudents.forEach(student => {
    if (!student.isSupply) return;
    const branch = student.branch;
    if (!supplyStats[branch]) {
      supplyStats[branch] = { appeared: 0, cleared: 0 };
    }
    supplyStats[branch].appeared++;
    if (student.status === 'PASS') {
      supplyStats[branch].cleared++;
    }
  });

  const metricsContainer = document.getElementById('supply-clearance-metrics');
  if (metricsContainer) {
    metricsContainer.innerHTML = '';
    
    const branches = Object.keys(supplyStats).sort();
    
    if (branches.length === 0) {
      metricsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; grid-column: 1 / -1; text-align: center; padding: 1rem 0;">No supplementary/supply candidates found in this result dataset.</div>';
    } else {
      branches.forEach(branch => {
        const stat = supplyStats[branch];
        const name = (state.customBranchNames && state.customBranchNames[branch]) || branchNames[branch] || branch;
        
        const card = document.createElement('div');
        card.className = 'glass-panel';
        card.style.padding = '1.25rem';
        card.style.borderTop = '3px solid var(--accent-olive)';
        card.style.background = 'var(--panel-bg)';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '0.35rem';
        card.style.borderRadius = '6px';
        card.style.boxShadow = '0 2px 6px rgba(0,0,0,0.01)';
        card.innerHTML = `
          <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; letter-spacing: 0.05em;">
            ${branch} - ${name}
          </div>
          <div style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 700; color: var(--text-primary);">
            ${stat.cleared} <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-secondary);">/ ${stat.appeared} Cleared</span>
          </div>
          <div style="font-size: 0.75rem; color: var(--success); font-weight: 600;">
            Pass Rate: ${((stat.cleared / stat.appeared) * 100).toFixed(1)}%
          </div>
        `;
        metricsContainer.appendChild(card);
      });
    }
  }
}

// --- TAB RENDER: SUBJECTS ANALYSIS TABLE ---
function renderSubjectsTable() {
  const thSpread = document.getElementById('th-grade-spread');
  if (thSpread) {
    const topGrade = state.scheme === '2015' ? 'O' : 'S';
    thSpread.textContent = `Grade Spread (${topGrade} - F)`;
  }

  const tbody = document.getElementById('table-body-subject');
  tbody.innerHTML = '';

  const searchQuery = document.getElementById('search-subject').value.toUpperCase();

  // Aggregate stats per subject code
  const subjectAgg = {};
  const activeStudents = getActiveStudents();
  activeStudents.forEach(student => {
    Object.keys(student.grades).forEach(subCode => {
      if (!subjectAgg[subCode]) {
        subjectAgg[subCode] = {
          code: subCode,
          name: state.subjects[subCode] || subCode,
          registered: 0,
          passed: 0,
          failed: 0,
          gradeDistribution: {}
        };
        // Initialize distribution
        Object.keys(state.gradePoints).forEach(g => subjectAgg[subCode].gradeDistribution[g] = 0);
      }
      
      const grade = student.grades[subCode];
      subjectAgg[subCode].registered++;
      if (['F', 'FE', 'I', 'FAIL'].includes(grade)) {
        subjectAgg[subCode].failed++;
      } else {
        subjectAgg[subCode].passed++;
      }
      
      if (subjectAgg[subCode].gradeDistribution[grade] === undefined) {
        subjectAgg[subCode].gradeDistribution[grade] = 0;
      }
      subjectAgg[subCode].gradeDistribution[grade]++;
    });
  });

  const list = Object.values(subjectAgg).filter(sub => {
    return sub.code.includes(searchQuery) || sub.name.toUpperCase().includes(searchQuery);
  });

  const col = state.sortState.subject.column;
  const dir = state.sortState.subject.direction === 'asc' ? 1 : -1;

  list.sort((a, b) => {
    let valA = a[col];
    let valB = b[col];
    
    if (col === 'credits') {
      valA = globalCreditsMap[a.code] !== undefined ? globalCreditsMap[a.code] : getInitialDefaultCredits(a.code, state.scheme);
      valB = globalCreditsMap[b.code] !== undefined ? globalCreditsMap[b.code] : getInitialDefaultCredits(b.code, state.scheme);
    } else if (col === 'passRate') {
      valA = a.registered > 0 ? (a.passed / a.registered) * 100 : 0;
      valB = b.registered > 0 ? (b.passed / b.registered) * 100 : 0;
    }
    
    if (typeof valA === 'string') {
      return valA.localeCompare(valB) * dir;
    }
    return (valA - valB) * dir;
  });

  list.forEach(sub => {
    const passRate = sub.registered > 0 ? (sub.passed / sub.registered) * 100 : 0;
    
    // Build small visual display of grade counts
    let gradeSpreadHtml = "";
    Object.keys(sub.gradeDistribution).forEach(g => {
      const count = sub.gradeDistribution[g];
      if (count > 0) {
        const keyClass = g.toLowerCase().replace('+', 'plus');
        gradeSpreadHtml += `<span class="grade-badge ${keyClass}" title="${g}: ${count}">${g}:${count}</span>`;
      }
    });

    const currentCredits = globalCreditsMap[sub.code] !== undefined ? globalCreditsMap[sub.code] : getInitialDefaultCredits(sub.code, state.scheme);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="subject-badge">${sub.code}</span></td>
      <td><strong>${sub.name}</strong></td>
      <td style="text-align: center;">
        <div class="credit-slider-container">
          <input 
            type="range" 
            min="0" 
            max="6" 
            step="1" 
            class="credit-slider" 
            data-subject="${sub.code}" 
            value="${currentCredits}"
          >
          <span class="credit-value-badge">${currentCredits}</span>
        </div>
      </td>
      <td style="text-align: center;">${sub.registered}</td>
      <td style="text-align: center; color: var(--success); font-weight: 500;">${sub.passed}</td>
      <td style="text-align: center; color: ${sub.failed > 0 ? 'var(--danger)' : 'var(--text-muted)'};">${sub.failed}</td>
      <td style="text-align: center; font-weight: 700; color: ${passRate < 50 ? 'var(--danger)' : 'var(--text-primary)'}">${passRate.toFixed(1)}%</td>
      <td><div style="display: flex; flex-wrap: wrap; gap: 0.15rem;">${gradeSpreadHtml}</div></td>
    `;
    tbody.appendChild(tr);
  });
}

// --- TAB RENDER: STUDENT PERFORMANCE TABLE ---
function renderStudentsTable() {
  const tbody = document.getElementById('table-body-student');
  tbody.innerHTML = '';

  const search = document.getElementById('search-student').value.toUpperCase();
  const deptFilter = document.getElementById('filter-student-dept').value;
  const statusFilter = document.getElementById('filter-student-status').value;

  const activeStudents = getActiveStudents();
  let filtered = activeStudents.filter(student => {
    const matchSearch = student.id.includes(search) || (student.name || '').toUpperCase().includes(search);
    const matchDept = deptFilter === 'ALL' || student.branch === deptFilter;
    const matchStatus = statusFilter === 'ALL' || student.status === statusFilter;
    return matchSearch && matchDept && matchStatus;
  });

  const col = state.sortState.student.column;
  const dir = state.sortState.student.direction === 'asc' ? 1 : -1;

  filtered.sort((a, b) => {
    let valA = a[col];
    let valB = b[col];
    
    if (col === 'passedCount') {
      valA = a.passedCount / (a.totalCount || 1);
      valB = b.passedCount / (b.totalCount || 1);
    }
    
    if (typeof valA === 'string') {
      return valA.localeCompare(valB) * dir;
    }
    return (valA - valB) * dir;
  });

  const hasNames = Object.keys(state.nameMap).length > 0;
  const thName = document.getElementById('th-student-name');
  if (thName) {
    if (hasNames) {
      thName.classList.remove('hidden');
    } else {
      thName.classList.add('hidden');
    }
  }

  filtered.forEach((stud) => {
    let badgeClass = "rank-other";
    if (stud.classRank === 1) badgeClass = "rank-1";
    else if (stud.classRank === 2) badgeClass = "rank-2";
    else if (stud.classRank === 3) badgeClass = "rank-3";

    let actionsHtml = "";
    if (stud.backlogs > 0) {
      const failedSubs = Object.keys(stud.grades)
        .filter(code => ['F', 'FE', 'I', 'FAIL'].includes(stud.grades[code]))
        .map(code => `<span class="backlog-badge" style="background-color: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-border); padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.75rem; font-family: monospace; font-weight: 600; margin-right: 0.25rem;">[${code}]</span>`)
        .join('');
      actionsHtml = `<div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; flex-wrap: wrap;">${failedSubs} <button class="btn btn-accent" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; height: fit-content;" onclick="viewStudentDetails('${stud.id}')">View Details</button></div>`;
    } else {
      actionsHtml = `<div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem;"><span class="backlog-badge" style="background-color: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">✓ Clear</span> <button class="btn btn-accent" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; height: fit-content;" onclick="viewStudentDetails('${stud.id}')">View Details</button></div>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align: center;"><span class="rank-badge ${badgeClass}">${stud.classRank}</span></td>
      <td><strong>${stud.id}</strong></td>
      ${hasNames ? `<td>${stud.name}</td>` : ''}
      <td style="text-align: center;"><span class="subject-badge">${stud.branch}</span></td>
      <td style="text-align: center;">${stud.passedCount} / ${stud.totalCount}</td>
      <td style="text-align: center; color: ${stud.backlogs > 0 ? 'var(--danger)' : 'var(--text-muted)'}; font-weight: 600;">${stud.backlogs}</td>
      <td style="text-align: center; font-weight: 700; color: var(--accent-terracotta);">${stud.sgpa.toFixed(2)}</td>
      <td style="text-align: center;">
        <span class="status-pill ${stud.status === 'PASS' ? 'pass' : 'fail'}">
          ${stud.status === 'PASS' ? 'Full Pass' : 'Supply'}
        </span>
      </td>
      <td style="text-align: center;">
        ${actionsHtml}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// --- TAB RENDER: BACKLOG / SUPPLY VIEW ---
function renderBacklogsView() {
  const filterVal = document.getElementById('backlogBranchFilter') ? document.getElementById('backlogBranchFilter').value : 'ALL';

  const activeStudents = getActiveStudents();
  const activeDepts = getActiveDepartments();

  // 1. Fill Student Backlog Leaders Table
  const tbodyMax = document.getElementById('table-body-backlogs-max');
  tbodyMax.innerHTML = '';

  const filteredStudents = filterVal === 'ALL' 
    ? activeStudents 
    : activeStudents.filter(s => s.branch === filterVal);

  const studentsWithBacklogs = filteredStudents.filter(s => s.backlogs > 0);
  studentsWithBacklogs.sort((a, b) => b.backlogs - a.backlogs);

  const hasNames = Object.keys(state.nameMap).length > 0;
  const thBacklogName = document.getElementById('th-backlog-name');
  if (thBacklogName) {
    if (hasNames) {
      thBacklogName.classList.remove('hidden');
    } else {
      thBacklogName.classList.add('hidden');
    }
  }

  const topBacklogStudents = studentsWithBacklogs;
  if (topBacklogStudents.length === 0) {
    tbodyMax.innerHTML = `<tr><td colspan="${hasNames ? 6 : 5}" style="text-align:center; color:var(--text-muted);">No backlogs recorded! Outstanding campus performance.</td></tr>`;
  } else {
    topBacklogStudents.forEach(stud => {
      const failedSubs = Object.keys(stud.grades).filter(code => ['F', 'FE', 'I', 'FAIL'].includes(stud.grades[code])).join(', ');
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${stud.id}</strong></td>
        ${hasNames ? `<td>${stud.name}</td>` : ''}
        <td style="text-align: center;"><span class="subject-badge">${stud.branch}</span></td>
        <td style="text-align: center; color: var(--danger); font-weight: 700;">${stud.backlogs}</td>
        <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${failedSubs}">
          <span style="color: var(--danger); font-size: 0.85rem;">${failedSubs}</span>
        </td>
        <td style="text-align: center;">
          <button class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; height: fit-content;" onclick="openSgpaMaxer('${stud.id}')">
            📊 Optimize
          </button>
        </td>
      `;
      tbodyMax.appendChild(tr);
    });
  }

  // 2. Fill top difficult subjects table
  const tbodySubs = document.getElementById('table-body-backlogs-subjects');
  tbodySubs.innerHTML = '';

  const subjectAgg = {};
  activeStudents.forEach(student => {
    if (filterVal !== 'ALL' && student.branch !== filterVal) return;
    
    Object.keys(student.grades).forEach(subCode => {
      if (!subjectAgg[subCode]) {
        subjectAgg[subCode] = { code: subCode, name: state.subjects[subCode] || subCode, registered: 0, failed: 0 };
      }
      subjectAgg[subCode].registered++;
      if (['F', 'FE', 'I', 'FAIL'].includes(student.grades[subCode])) {
        subjectAgg[subCode].failed++;
      }
    });
  });

  const diffList = Object.values(subjectAgg).filter(sub => sub.failed > 0);
  diffList.sort((a, b) => b.failed - a.failed);
  
  const topDiffList = diffList.slice(0, 15);
  if (topDiffList.length === 0) {
    tbodySubs.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No subject failures recorded.</td></tr>`;
  } else {
    topDiffList.forEach(sub => {
      const failRate = (sub.failed / sub.registered) * 100;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="subject-badge">${sub.code}</span></td>
        <td><strong>${sub.name}</strong></td>
        <td style="text-align: center; color: var(--danger); font-weight: 700;">${sub.failed}</td>
        <td style="text-align: center; font-weight: 700; color: var(--danger);">${failRate.toFixed(1)}%</td>
      `;
      tbodySubs.appendChild(tr);
    });
  }

  // 3. Fill Department Backlog Statistics Table
  const tbodyDept = document.getElementById('table-body-backlogs-dept');
  tbodyDept.innerHTML = '';

  const depts = Object.keys(activeDepts).sort().filter(branch => {
    return filterVal === 'ALL' || branch === filterVal;
  });
  
  depts.forEach(branch => {
    let totalBacklogs = 0;
    let studentsWithSupply = 0;
    let count = 0;
    
    activeStudents.forEach(student => {
      if (student.branch === branch) {
        count++;
        totalBacklogs += student.backlogs;
        if (student.backlogs > 0) {
          studentsWithSupply++;
        }
      }
    });

    const avgBacklogs = count > 0 ? (totalBacklogs / count) : 0;
    const name = (state.customBranchNames && state.customBranchNames[branch]) || branchNames[branch] || branch + " Department";

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${branch}</strong></td>
      <td>${name}</td>
      <td style="text-align: center; color: var(--danger); font-weight: 600;">${totalBacklogs}</td>
      <td style="text-align: center; color: var(--danger); font-weight: 600;">${studentsWithSupply}</td>
      <td style="text-align: center; font-weight: 700; color: var(--accent-terracotta);">${avgBacklogs.toFixed(2)}</td>
    `;
    tbodyDept.appendChild(tr);
  });
}

// ----------------------------------------------------
// DETAILS MODAL CONTROL
// ----------------------------------------------------

window.viewStudentDetails = function(studentId) {
  const student = state.students.find(s => s.id === studentId);
  if (!student) return;

  document.getElementById('modal-title').textContent = `${student.name} - Performance Profile`;
  
  const summaryGrid = document.getElementById('modal-summary-grid');
  summaryGrid.innerHTML = `
    <div class="detail-item">
      <span>Register Number</span>
      <span>${student.id}</span>
    </div>
    <div class="detail-item">
      <span>Branch</span>
      <span>${student.branch} - ${branchNames[student.branch] || 'Engineering'}</span>
    </div>
    <div class="detail-item">
      <span>SGPA</span>
      <span style="color: var(--accent-terracotta);">${student.sgpa.toFixed(2)}</span>
    </div>
    <div class="detail-item">
      <span>Class Standing</span>
      <span>Rank #${student.classRank} / ${state.students.length}</span>
    </div>
    <div class="detail-item">
      <span>Department Rank</span>
      <span>Rank #${student.deptRank} / ${state.students.filter(s => s.branch === student.branch).length}</span>
    </div>
    <div class="detail-item">
      <span>Backlogs</span>
      <span style="color: ${student.backlogs > 0 ? 'var(--danger)' : 'var(--success)'};">${student.backlogs > 0 ? student.backlogs + ' Supplies' : 'Clear Pass'}</span>
    </div>
  `;

  const tbody = document.getElementById('modal-table-body');
  tbody.innerHTML = '';

  Object.keys(student.grades).forEach(subCode => {
    const grade = student.grades[subCode];
    const name = state.subjects[subCode] || 'Subject Course';
    const credits = globalCreditsMap[subCode] !== undefined ? globalCreditsMap[subCode] : getInitialDefaultCredits(subCode, state.scheme);
    const points = getGradePoints(grade, state.scheme);

    const gClass = grade.toLowerCase().replace('+', 'plus');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="subject-badge">${subCode}</span></td>
      <td><strong>${name}</strong></td>
      <td style="text-align: center;">${credits}</td>
      <td style="text-align: center;"><span class="grade-badge ${gClass}">${grade}</span></td>
      <td style="text-align: center;">${points.toFixed(1)}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('details-modal').classList.add('active');
};

function closeModal() {
  document.getElementById('details-modal').classList.remove('active');
}

// ----------------------------------------------------
// SGPA MAXER REVALUATION & SUPPLEMENTARY PREDICTOR
// ----------------------------------------------------

const maxerGradePoints = {
  'S': 10.0,
  'A+': 9.0,
  'A': 8.5,
  'B+': 8.0,
  'B': 7.5,
  'C+': 7.0,
  'C': 6.5,
  'D': 6.0,
  'P': 5.5,
  'PASS': 5.5,
  'FAIL': 0.0,
  'F': 0.0,
  'FE': 0.0,
  'I': 0.0
};

const maxerGradesList = ['F', 'FE', 'I', 'P', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S'];

function openSgpaMaxer(studentId) {
  const student = state.students.find(s => s.id === studentId);
  if (!student) return;

  const infoGrid = document.getElementById('sgpa-maxer-student-info');
  if (infoGrid) {
    let totalCredits = 0;
    Object.keys(student.grades).forEach(subCode => {
      const credits = globalCreditsMap[subCode] !== undefined ? globalCreditsMap[subCode] : getInitialDefaultCredits(subCode, state.scheme);
      totalCredits += credits;
    });

    infoGrid.innerHTML = `
      <div class="detail-item">
        <span>Student Name</span>
        <span>${student.name}</span>
      </div>
      <div class="detail-item">
        <span>Register Number</span>
        <span>${student.id}</span>
      </div>
      <div class="detail-item">
        <span>Total Semester Credits</span>
        <span>${totalCredits}</span>
      </div>
      <div class="detail-item">
        <span>Baseline SGPA</span>
        <span style="color: var(--accent-terracotta);">${student.sgpa.toFixed(2)}</span>
      </div>
    `;
  }

  const tbody = document.getElementById('sgpa-maxer-table-body');
  if (tbody) {
    tbody.innerHTML = '';
    
    Object.keys(student.grades).forEach(subCode => {
      const currentGrade = student.grades[subCode];
      const credits = globalCreditsMap[subCode] !== undefined ? globalCreditsMap[subCode] : getInitialDefaultCredits(subCode, state.scheme);
      const subName = state.subjects[subCode] || 'Subject Course';
      
      const tr = document.createElement('tr');
      const currentPts = maxerGradePoints[currentGrade] || 0.0;
      
      let allowedGrades = maxerGradesList.filter(g => {
        if (['F', 'FE', 'I'].includes(currentGrade)) {
          return true;
        }
        return maxerGradePoints[g] >= currentPts;
      });

      allowedGrades.sort((a, b) => maxerGradePoints[b] - maxerGradePoints[a]);

      let optionsHtml = '';
      allowedGrades.forEach(g => {
        const selectedAttr = g === currentGrade ? 'selected' : '';
        optionsHtml += `<option value="${g}" ${selectedAttr}>${g} (${maxerGradePoints[g].toFixed(1)})</option>`;
      });

      if (!allowedGrades.includes(currentGrade)) {
        optionsHtml = `<option value="${currentGrade}" selected>${currentGrade} (${currentPts.toFixed(1)})</option>` + optionsHtml;
      }

      tr.innerHTML = `
        <td><span class="subject-badge">${subCode}</span> <strong>${subName}</strong></td>
        <td style="text-align: center;">${credits}</td>
        <td style="text-align: center;"><span class="grade-badge ${currentGrade.toLowerCase().replace('+', 'plus')}">${currentGrade}</span></td>
        <td style="text-align: center;">
          <select class="select-filter maxer-grade-select" data-subject="${subCode}" data-credits="${credits}" style="width: 100%; padding: 0.35rem 0.5rem; font-size: 0.85rem;">
            ${optionsHtml}
          </select>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  const dropdowns = document.querySelectorAll('.maxer-grade-select');
  dropdowns.forEach(select => {
    select.addEventListener('change', () => calculateMaxedSgpa(student));
  });

  calculateMaxedSgpa(student);

  const maxerModal = document.getElementById('sgpa-maxer-modal');
  if (maxerModal) {
    maxerModal.classList.add('active');
  }
}
window.openSgpaMaxer = openSgpaMaxer;

function closeSgpaMaxer() {
  const maxerModal = document.getElementById('sgpa-maxer-modal');
  if (maxerModal) {
    maxerModal.classList.remove('active');
  }
}
window.closeSgpaMaxer = closeSgpaMaxer;

function calculateMaxedSgpa(student) {
  let totalCredits = 0;
  let baselineWeightedPoints = 0;
  let simulatedWeightedPoints = 0;

  const dropdowns = document.querySelectorAll('.maxer-grade-select');
  dropdowns.forEach(select => {
    const subCode = select.dataset.subject;
    const credits = parseFloat(select.dataset.credits) || 0;
    const originalGrade = student.grades[subCode];
    const simulatedGrade = select.value;
    const origGrade = originalGrade === 'PASS' ? 'P' : originalGrade;
    const simGrade = simulatedGrade === 'PASS' ? 'P' : simulatedGrade;

    if (origGrade === 'FAIL' || simGrade === 'FAIL') {
      return;
    }

    const originalPts = maxerGradePoints[origGrade] !== undefined ? maxerGradePoints[origGrade] : 0.0;
    const simulatedPts = maxerGradePoints[simGrade] !== undefined ? maxerGradePoints[simGrade] : 0.0;

    baselineWeightedPoints += originalPts * credits;
    simulatedWeightedPoints += simulatedPts * credits;
    totalCredits += credits;
  });

  const baselineSgpa = totalCredits > 0 ? (baselineWeightedPoints / totalCredits) : 0.0;
  const simulatedSgpa = totalCredits > 0 ? (simulatedWeightedPoints / totalCredits) : 0.0;
  const delta = simulatedSgpa - baselineSgpa;

  const summary = document.getElementById('sgpa-maxer-summary');
  if (summary) {
    const deltaBadgeHtml = delta > 0 
      ? `<span class="maxer-delta-badge">+${delta.toFixed(2)}</span>` 
      : `<span style="font-size: 1.1rem; font-weight: 700; color: var(--text-muted);">+0.00</span>`;

    summary.innerHTML = `
      <div class="maxer-summary-item">
        <span>Current SGPA</span>
        <span>${baselineSgpa.toFixed(2)}</span>
      </div>
      <div class="maxer-summary-item">
        <span>Maximized SGPA</span>
        <span style="color: var(--accent-terracotta);">${simulatedSgpa.toFixed(2)}</span>
      </div>
      <div class="maxer-summary-item">
        <span>Potential Increase</span>
        <span>${deltaBadgeHtml}</span>
      </div>
    `;
  }
}

// ----------------------------------------------------
// SHEETJS EXCEL & PDF EXPORT SYSTEM
// ----------------------------------------------------

function exportToExcelDirect() {
  if (state.students.length === 0) return;
  showLoading();
  
  setTimeout(() => {
    try {
      const activeStudents = getActiveStudents();
      const activeDepts = getActiveDepartments();

      // Calculate overall metrics
      const totalRegistered = activeStudents.length;
      const totalPassed = activeStudents.filter(s => s.status === 'PASS').length;
      const totalFailed = totalRegistered - totalPassed;
      const overallPassPct = totalRegistered > 0 ? ((totalPassed / totalRegistered) * 100).toFixed(2) : "0.00";
      
      // Calculate total institutional average SGPA as a true weighted average of valid SGPAs (excluding 0.00)
      const validSgpas = activeStudents.filter(s => s.sgpa > 0).map(s => s.sgpa);
      const totalValidSgpasSum = validSgpas.reduce((sum, val) => sum + val, 0);
      const averageSgpaInstitutional = validSgpas.length > 0 ? (totalValidSgpasSum / validSgpas.length).toFixed(2) : "0.00";
      
      // Academic Standing Tiers (Passed Students Only)
      const passingStudents = activeStudents.filter(s => s.status === 'PASS');
      const distinctionCount = passingStudents.filter(s => s.sgpa >= 8.5).length;
      const firstClassCount = passingStudents.filter(s => s.sgpa >= 7.0 && s.sgpa < 8.5).length;
      const secondClassCount = passingStudents.filter(s => s.sgpa < 7.0).length;

      // Calculate departments standings
      const sortedDepts = Object.values(activeDepts).sort((a, b) => b.passPercentage - a.passPercentage);
      let deptRows = "";
      sortedDepts.forEach((d, idx) => {
        const deptName = (state.customBranchNames && state.customBranchNames[d.code]) || d.name;
        deptRows += `
          <tr class="${idx % 2 === 0 ? 'zebra' : 'white-row'}">
            <td style="border: 1px solid #BDC3C7; padding: 8px;">${deptName}</td>
            <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right;">${d.appeared}</td>
            <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right; color: #608066; font-weight: bold;">${d.fullPass}</td>
            <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right; color: #B56559;">${d.supply}</td>
            <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right; font-weight: bold;">${d.passPercentage.toFixed(2)}%</td>
            <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right; color: #CB997E; font-weight: bold;">${d.averageSgpa.toFixed(2)}</td>
          </tr>
        `;
      });
      
      // Calculate subject analytics
      const subjectAgg = {};
      activeStudents.forEach(student => {
        Object.keys(student.grades).forEach(subCode => {
          if (!subjectAgg[subCode]) {
            subjectAgg[subCode] = {
              code: subCode,
              name: (state.courseCatalog && state.courseCatalog[subCode]) || state.subjects[subCode] || subCode,
              registered: 0,
              passed: 0,
              failed: 0
            };
          }
          subjectAgg[subCode].registered++;
          if (['F', 'FE', 'I', 'FAIL'].includes(student.grades[subCode])) {
            subjectAgg[subCode].failed++;
          } else {
            subjectAgg[subCode].passed++;
          }
        });
      });
      
      const subjectsList = Object.values(subjectAgg).map(s => {
        s.passPct = s.registered > 0 ? (s.passed / s.registered) * 100 : 0;
        return s;
      });
      
      // Sort subjects by pass percentage descending, then take top 5
      subjectsList.sort((a, b) => {
        if (b.passPct !== a.passPct) return b.passPct - a.passPct;
        return b.registered - a.registered; // Secondary sort by student count
      });
      const topSubjects = subjectsList.slice(0, 5);
      
      let subjectRows = "";
      topSubjects.forEach((s, idx) => {
        // Resolve dominant branch to get dynamic department name
        const subjectStudents = activeStudents.filter(stud => stud.grades[s.code] !== undefined);
        const branchCounts = {};
        subjectStudents.forEach(stud => {
          branchCounts[stud.branch] = (branchCounts[stud.branch] || 0) + 1;
        });
        let dominantBranch = "";
        let maxBranchCount = 0;
        Object.keys(branchCounts).forEach(br => {
          if (branchCounts[br] > maxBranchCount) {
            maxBranchCount = branchCounts[br];
            dominantBranch = br;
          }
        });
        const deptName = (state.customBranchNames && state.customBranchNames[dominantBranch])
                          || branchNames[dominantBranch]
                          || dominantBranch
                          || "General Subject";

        const subjectNameMapped = (state.courseCatalog && state.courseCatalog[s.code]) || state.subjects[s.code] || s.code;

        subjectRows += `
          <tr class="${idx % 2 === 0 ? 'zebra' : 'white-row'}">
            <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: center; font-weight: bold;">${idx + 1}</td>
            <td style="border: 1px solid #BDC3C7; padding: 8px;">${s.code} - ${subjectNameMapped}</td>
            <td style="border: 1px solid #BDC3C7; padding: 8px;">${deptName}</td>
            <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right; font-weight: bold;">${s.passPct.toFixed(2)}%</td>
            <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right;">${s.registered}</td>
            <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right; color: #608066;">${s.passed}</td>
            <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right; color: #B56559;">${s.failed}</td>
          </tr>
        `;
      });

      // Calculate Subject Risk Matrix (Critical Subject Risk Directory)
      const riskSubjects = subjectsList.filter(s => s.failed > 0).map(s => {
        s.failPct = (s.failed / s.registered) * 100;
        return s;
      });
      riskSubjects.sort((a, b) => b.failPct - a.failPct || b.failed - a.failed);

      let riskRows = "";
      if (riskSubjects.length === 0) {
        riskRows = `
          <tr>
            <td colspan="6" style="border: 1px solid #BDC3C7; padding: 8px; text-align: center; font-style: italic;">No critical subject risks identified.</td>
          </tr>
        `;
      } else {
        riskSubjects.forEach((s, idx) => {
          const subjectStudents = activeStudents.filter(stud => stud.grades[s.code] !== undefined);
          const branchCounts = {};
          subjectStudents.forEach(stud => {
            branchCounts[stud.branch] = (branchCounts[stud.branch] || 0) + 1;
          });
          let dominantBranch = "";
          let maxBranchCount = 0;
          Object.keys(branchCounts).forEach(br => {
            if (branchCounts[br] > maxBranchCount) {
              maxBranchCount = branchCounts[br];
              dominantBranch = br;
            }
          });
          const deptName = (state.customBranchNames && state.customBranchNames[dominantBranch])
                            || branchNames[dominantBranch]
                            || dominantBranch
                            || "General Subject";

          const subjectNameMapped = (state.courseCatalog && state.courseCatalog[s.code]) || state.subjects[s.code] || s.code;

          riskRows += `
            <tr class="${idx % 2 === 0 ? 'zebra' : 'white-row'}">
              <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: center; font-weight: bold;">${idx + 1}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px;">${s.code}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px;">${subjectNameMapped}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px;">${deptName}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right; color: #B56559; font-weight: bold;">${s.failed}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right; font-weight: bold; color: #C62828;">${s.failPct.toFixed(2)}%</td>
            </tr>
          `;
        });
      }

      // Generate "Top Performers" Section
      const regularStudents = activeStudents.filter(s => s.isRegular);
      // Sort regular students by SGPA descending
      const sortedRegularStudents = [...regularStudents].sort((a, b) => b.sgpa - a.sgpa);
      const topStudentsList = sortedRegularStudents.slice(0, 15);

      let topPerformersRows = "";
      if (topStudentsList.length === 0) {
        topPerformersRows = `
          <tr>
            <td colspan="6" style="border: 1px solid #BDC3C7; padding: 8px; text-align: center; font-style: italic;">No regular students registered.</td>
          </tr>
        `;
      } else {
        topStudentsList.forEach((stud, idx) => {
          const deptName = (state.customBranchNames && state.customBranchNames[stud.branch]) 
                            || branchNames[stud.branch] 
                            || stud.branch;
          const completedCredits = getCompletedCredits(stud);
          topPerformersRows += `
            <tr class="${idx % 2 === 0 ? 'zebra' : 'white-row'}">
              <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: center; font-weight: bold;">${idx + 1}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px;">${stud.id}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px;">${deptName}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right;">${completedCredits}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right; color: #CB997E; font-weight: bold;">${stud.sgpa.toFixed(2)}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: center;">
                <span style="color: ${stud.status === 'PASS' ? '#608066' : '#B56559'}; font-weight: bold;">
                  ${stud.status === 'PASS' ? 'Full Pass' : 'Supply'}
                </span>
              </td>
            </tr>
          `;
        });
      }

      // Generate "Backlog Tracker" Section
      const backlogStudents = activeStudents.filter(s => s.backlogs > 0 || s.isSupply === true);
      // Sort backlog students by backlog count descending
      const sortedBacklogStudents = [...backlogStudents].sort((a, b) => b.backlogs - a.backlogs);

      let backlogTrackerRows = "";
      if (sortedBacklogStudents.length === 0) {
        backlogTrackerRows = `
          <tr>
            <td colspan="5" style="border: 1px solid #BDC3C7; padding: 8px; text-align: center; font-style: italic;">No backlog or supplementary students found.</td>
          </tr>
        `;
      } else {
        sortedBacklogStudents.forEach((stud, idx) => {
          const deptName = (state.customBranchNames && state.customBranchNames[stud.branch]) 
                            || branchNames[stud.branch] 
                            || stud.branch;
          const failedCodes = Object.keys(stud.grades)
            .filter(code => ['F', 'FE', 'I', 'FAIL'].includes(stud.grades[code]))
            .join(', ') || 'None';
          const academicStatus = stud.isSupply ? 'Supplementary Candidate' : 'Regular Supply';
          backlogTrackerRows += `
            <tr class="${idx % 2 === 0 ? 'zebra' : 'white-row'}">
              <td style="border: 1px solid #BDC3C7; padding: 8px;">${stud.id}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px;">${deptName}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: right; color: #B56559; font-weight: bold;">${stud.backlogs}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px; color: #B56559;">${failedCodes}</td>
              <td style="border: 1px solid #BDC3C7; padding: 8px; text-align: center; font-weight: 500;">${academicStatus}</td>
            </tr>
          `;
        });
      }
      
      const excelTemplate = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="utf-8">
          <!--[if gte mso 9]>
          <xml>
            <x:ExcelWorkbook>
              <x:ExcelWorksheets>
                <x:ExcelWorksheet>
                  <x:Name>Result Analysis Report</x:Name>
                  <x:WorksheetOptions>
                    <x:DisplayGridlines/>
                  </x:WorksheetOptions>
                </x:ExcelWorksheet>
              </x:ExcelWorksheets>
            </x:ExcelWorkbook>
          </xml>
          <![endif]-->
          <style>
            body { font-family: 'Calibri', sans-serif; }
            table { border-collapse: collapse; margin-bottom: 20px; }
            td, th { border: 1px solid #BDC3C7; padding: 8px; font-size: 11pt; vertical-align: middle; }
            .header-banner-1 { background-color: #34495E; color: #FFFFFF; font-weight: bold; text-align: center; font-size: 16pt; height: 35px; border: 1px solid #BDC3C7; }
            .header-banner-2 { background-color: #34495E; color: #FFFFFF; font-weight: bold; text-align: center; font-size: 13pt; height: 30px; border: 1px solid #BDC3C7; }
            .header-banner-3 { background-color: #34495E; color: #FFFFFF; font-weight: bold; text-align: center; font-size: 11pt; height: 25px; border: 1px solid #BDC3C7; }
            .section-header-stat { background-color: #34495E; color: #FFFFFF; font-weight: bold; font-size: 12pt; height: 25px; text-align: left; border: 1px solid #BDC3C7; }
            .section-header-dept { background-color: #34495E; color: #FFFFFF; font-weight: bold; font-size: 12pt; height: 25px; text-align: left; border: 1px solid #BDC3C7; }
            .section-header-risk { background-color: #34495E; color: #FFFFFF; font-weight: bold; font-size: 12pt; height: 25px; text-align: left; border: 1px solid #BDC3C7; }
            .table-header { background-color: #34495E; color: #FFFFFF; font-weight: bold; text-align: center; font-size: 11pt; height: 25px; border: 1px solid #BDC3C7; }
            .table-header-risk { background-color: #34495E; color: #FFFFFF; font-weight: bold; text-align: center; font-size: 11pt; height: 25px; border: 1px solid #BDC3C7; }
            .bold-text { font-weight: bold; background-color: #F8F9FA; border: 1px solid #BDC3C7; }
            .number-cell { text-align: right; border: 1px solid #BDC3C7; }
            .percent-cell { text-align: right; font-weight: bold; border: 1px solid #BDC3C7; }
            .zebra { background-color: #F8F9FA; }
            .white-row { background-color: #FFFFFF; }
          </style>
        </head>
        <body>
          <table>
            <!-- Header Banners -->
            <tr>
              <td colspan="7" class="header-banner-1">KTU RESULT ANALYSER - OVERALL SUMMARY REPORT</td>
            </tr>
            <tr>
              <td colspan="7" class="header-banner-2">PROVIDENCE COLLEGE OF ENGINEERING</td>
            </tr>
            <tr>
              <td colspan="7" class="header-banner-3">KTU Result Analysis</td>
            </tr>
            
            <!-- Empty Spacer -->
            <tr><td colspan="7" style="border:none; height: 15px;"></td></tr>
            
            <!-- Overall Statistics Header -->
            <tr>
              <td colspan="4" class="section-header-stat">OVERALL STATISTICS - REGULAR STUDENTS ONLY</td>
              <td colspan="3" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text">Total Registered</td>
              <td class="number-cell">${totalRegistered}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text">Total Passed</td>
              <td class="number-cell">${totalPassed}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text">Total Failed</td>
              <td class="number-cell">${totalFailed}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text">Overall Pass %</td>
              <td class="percent-cell">${overallPassPct}%</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text">Average SGPA (Passed)</td>
              <td class="number-cell" style="font-weight: bold; color: #34495E;">${averageSgpaInstitutional}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
 
            <!-- Empty Spacer -->
            <tr><td colspan="7" style="border:none; height: 10px;"></td></tr>
 
            <!-- Academic Standing Tiers -->
            <tr>
              <td colspan="4" class="section-header-stat">ACADEMIC STANDING TIERS (PASSED STUDENTS ONLY)</td>
              <td colspan="3" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text">Distinction Tiers (SGPA >= 8.5)</td>
              <td class="number-cell">${distinctionCount}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text">First Class Tiers (7.0 to 8.49)</td>
              <td class="number-cell">${firstClassCount}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text">Second Class Tiers (SGPA < 7.0)</td>
              <td class="number-cell">${secondClassCount}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            
            <!-- Empty Spacer -->
            <tr><td colspan="7" style="border:none; height: 15px;"></td></tr>
            
            <!-- Department Table Header -->
            <tr>
              <td colspan="6" class="section-header-dept">DEPARTMENT-WISE PERFORMANCE ANALYSIS</td>
              <td style="border:none;"></td>
            </tr>
            <tr class="table-header">
              <td>Department Name</td>
              <td>Total Regular Students</td>
              <td>Total Pass</td>
              <td>Total Fail</td>
              <td>Pass Percentage</td>
              <td>Average SGPA</td>
              <td style="border:none;"></td>
            </tr>
            ${deptRows}
            
            <!-- Empty Spacer -->
            <tr><td colspan="7" style="border:none; height: 15px;"></td></tr>
            
            <!-- Top 5 Subjects Header -->
            <tr>
              <td colspan="7" class="section-header-dept">TOP 5 PERFORMING SUBJECTS</td>
            </tr>
            <tr class="table-header">
              <td>Rank</td>
              <td>Subject Code / Name</td>
              <td>Department</td>
              <td>Pass %</td>
              <td>Total Students</td>
              <td>Pass</td>
              <td>Fail</td>
            </tr>
            ${subjectRows}
 
            <!-- Empty Spacer -->
            <tr><td colspan="7" style="border:none; height: 15px;"></td></tr>
 
            <!-- Subject Risk Matrix Header -->
            <tr>
              <td colspan="6" class="section-header-risk">CRITICAL SUBJECT RISK DIRECTORY (HIGHEST FAILURE RATES)</td>
              <td style="border:none;"></td>
            </tr>
            <tr class="table-header-risk">
              <td>Rank</td>
              <td>Subject Code</td>
              <td>Subject Name</td>
              <td>Department</td>
              <td>Fail Count</td>
              <td>Failure Rate %</td>
              <td style="border:none;"></td>
            </tr>
            ${riskRows}

            <!-- Empty Spacer -->
            <tr><td colspan="7" style="border:none; height: 15px;"></td></tr>

            <!-- Top Performers Header -->
            <tr>
              <td colspan="6" class="section-header-dept">TOP PERFORMERS DIRECTORY (REGULAR COHORT ONLY)</td>
              <td style="border:none;"></td>
            </tr>
            <tr class="table-header">
              <td>Rank</td>
              <td>Roll Number</td>
              <td>Department</td>
              <td>Completed Credits</td>
              <td>Estimated SGPA</td>
              <td>Status</td>
              <td style="border:none;"></td>
            </tr>
            ${topPerformersRows}

            <!-- Empty Spacer -->
            <tr><td colspan="7" style="border:none; height: 15px;"></td></tr>

            <!-- Backlog Tracker Header -->
            <tr>
              <td colspan="5" class="section-header-risk">ACTIVE BACKLOG & SUPPLEMENTARY TRACKER</td>
              <td colspan="2" style="border:none;"></td>
            </tr>
            <tr class="table-header-risk">
              <td>Roll Number</td>
              <td>Department</td>
              <td>Supply Count</td>
              <td>Failed Course Codes</td>
              <td>Current Academic Status</td>
              <td colspan="2" style="border:none;"></td>
            </tr>
            ${backlogTrackerRows}
          </table>
        </body>
        </html>
      `;
      
      const blob = new Blob([excelTemplate], { type: "application/vnd.ms-excel" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "KTU_Result_Analysis_Report.xls";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      hideLoading();
    } catch (err) {
      alert("Failed to export Excel report: " + err.message);
      hideLoading();
    }
  }, 100);
}


// Loading Spinner Helpers
function showLoading() {
  const loading = document.createElement('div');
  loading.id = 'page-loading';
  loading.style.position = 'fixed';
  loading.style.top = '0';
  loading.style.left = '0';
  loading.style.width = '100vw';
  loading.style.height = '100vh';
  loading.style.background = 'rgba(2, 6, 23, 0.7)';
  loading.style.backdropFilter = 'blur(10px)';
  loading.style.display = 'flex';
  loading.style.flexDirection = 'column';
  loading.style.alignItems = 'center';
  loading.style.justifyContent = 'center';
  loading.style.zIndex = '9999';
  loading.style.color = '#06b6d4';
  loading.style.fontFamily = 'Outfit';
  loading.style.fontSize = '1.5rem';
  loading.innerHTML = `
    <div style="width: 50px; height: 50px; border: 5px solid rgba(6, 182, 212, 0.2); border-top-color: #06b6d4; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 1rem;"></div>
    <div>Processing Result Sheets...</div>
    <style>
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  `;
  document.body.appendChild(loading);
}

function hideLoading() {
  const loading = document.getElementById('page-loading');
  if (loading) loading.remove();
}

function setupTableSorting() {
  document.querySelectorAll('table th[data-sort]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const table = th.closest ? th.closest('table') : (th.parentElement && th.parentElement.parentElement && th.parentElement.parentElement.parentElement ? th.parentElement.parentElement.parentElement : null);
      if (!table) return;
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const tbodyId = tbody.id;
      const sortBy = th.dataset.sort;
      
      let sortKey = '';
      if (tbodyId === 'table-body-dept') sortKey = 'dept';
      else if (tbodyId === 'table-body-subject') sortKey = 'subject';
      else if (tbodyId === 'table-body-student') sortKey = 'student';
      else return;
      
      const current = state.sortState[sortKey];
      if (current.column === sortBy) {
        current.direction = current.direction === 'asc' ? 'desc' : 'asc';
      } else {
        current.column = sortBy;
        current.direction = 'desc';
      }
      
      // Update drop-down for students if clicked column matches
      if (sortKey === 'student') {
        const select = document.getElementById('sort-student');
        if (select) {
          if (sortBy === 'id' && current.direction === 'asc') {
            select.value = 'ROLL_ASC';
          } else if (sortBy === 'sgpa' && current.direction === 'desc') {
            select.value = 'SGPA_DESC';
          } else if (sortBy === 'sgpa' && current.direction === 'asc') {
            select.value = 'SGPA_ASC';
          } else if (sortBy === 'backlogs' && current.direction === 'desc') {
            select.value = 'BACK_DESC';
          } else {
            select.selectedIndex = -1;
          }
        }
      }
      
      updateHeaderArrows(tbodyId);
      
      if (sortKey === 'dept') renderDepartmentsTable();
      else if (sortKey === 'subject') renderSubjectsTable();
      else if (sortKey === 'student') renderStudentsTable();
    });
  });
  
  // Set initial arrows
  updateHeaderArrows('table-body-dept');
  updateHeaderArrows('table-body-subject');
  updateHeaderArrows('table-body-student');
}

function updateHeaderArrows(tbodyId) {
  let sortKey = '';
  if (tbodyId === 'table-body-dept') sortKey = 'dept';
  else if (tbodyId === 'table-body-subject') sortKey = 'subject';
  else if (tbodyId === 'table-body-student') sortKey = 'student';
  else return;
  
  const current = state.sortState[sortKey];
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const table = tbody.closest ? tbody.closest('table') : (tbody.parentElement ? tbody.parentElement : null);
  if (!table) return;
  
  table.querySelectorAll('th[data-sort]').forEach(th => {
    th.querySelectorAll('.sort-arrow').forEach(el => el.remove());
    th.classList.remove('sort-asc', 'sort-desc');
    
    if (th.dataset.sort === current.column) {
      th.classList.add(current.direction === 'asc' ? 'sort-asc' : 'sort-desc');
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.style.marginLeft = '5px';
      arrow.style.fontSize = '0.7rem';
      arrow.style.color = 'var(--accent-terracotta)';
      arrow.textContent = current.direction === 'asc' ? '▲' : '▼';
      th.appendChild(arrow);
    }
  });
}

// ----------------------------------------------------
// UNIVERSAL SGPA MAXER & SIMULATOR VIEW
// ----------------------------------------------------

function populateUnivMaxerStudentList() {
  const select = document.getElementById('univ-maxer-student-select');
  const datalist = document.getElementById('student-roll-nos');
  if (!select && !datalist) return;

  if (select) {
    select.innerHTML = '<option value="">-- Select Student --</option>';
  }
  if (datalist) {
    datalist.innerHTML = '';
  }

  if (typeof state === 'undefined' || !state.students) return;

  const activeStudents = getActiveStudents();
  const sortedStudents = [...activeStudents].sort((a, b) => a.id.localeCompare(b.id));

  sortedStudents.forEach(student => {
    const displayName = student.name ? `${student.id} - ${student.name}` : student.id;
    
    if (select) {
      const opt = document.createElement('option');
      opt.value = student.id;
      opt.textContent = displayName;
      select.appendChild(opt);
    }
    
    if (datalist) {
      const opt = document.createElement('option');
      opt.value = student.id;
      opt.textContent = student.name ? student.name : '';
      datalist.appendChild(opt);
    }
  });
}

function loadUnivMaxerStudent() {
  const input = document.getElementById('univ-maxer-search-input');
  if (!input) return;
  const studentId = input.value.trim().toUpperCase();
  if (!studentId) {
    alert('Please enter or select a valid Student Roll Number.');
    return;
  }

  const student = state.students.find(s => s.id.toUpperCase() === studentId || (s.name && s.name.toUpperCase() === studentId));
  if (!student) {
    alert(`Student with Roll Number or Name "${studentId}" not found.`);
    return;
  }

  state.loadedMaxerStudentId = student.id;
  
  // Sync the select dropdown value if matching option exists
  const select = document.getElementById('univ-maxer-student-select');
  if (select) {
    select.value = student.id;
  }
  // Sync search input to match correct roll number
  input.value = student.id;

  renderUnivMaxerStudentData();
}

function renderUnivMaxerStudentData() {
  const studentId = state.loadedMaxerStudentId;
  const student = state.students.find(s => s.id === studentId);
  
  const emptyDiv = document.getElementById('univ-maxer-empty');
  const contentDiv = document.getElementById('univ-maxer-content');
  
  if (!student) {
    if (emptyDiv) emptyDiv.classList.remove('hidden');
    if (contentDiv) contentDiv.classList.add('hidden');
    return;
  }

  if (emptyDiv) emptyDiv.classList.add('hidden');
  if (contentDiv) contentDiv.classList.remove('hidden');

  // Populate Profile Card
  const infoGrid = document.getElementById('univ-maxer-student-info');
  if (infoGrid) {
    let totalCredits = 0;
    Object.keys(student.grades).forEach(subCode => {
      const credits = globalCreditsMap[subCode] !== undefined ? globalCreditsMap[subCode] : getInitialDefaultCredits(subCode, state.scheme);
      totalCredits += credits;
    });

    infoGrid.innerHTML = `
      <div class="detail-item">
        <span>Student Name</span>
        <span>${student.name || 'N/A'}</span>
      </div>
      <div class="detail-item">
        <span>Register Number</span>
        <span>${student.id}</span>
      </div>
      <div class="detail-item">
        <span>Branch / Department</span>
        <span>${student.branch} - ${branchNames[student.branch] || 'Engineering'}</span>
      </div>
      <div class="detail-item">
        <span>Total Semester Credits</span>
        <span>${totalCredits}</span>
      </div>
      <div class="detail-item">
        <span>Baseline SGPA</span>
        <span style="color: var(--accent-terracotta);">${student.sgpa.toFixed(2)}</span>
      </div>
      <div class="detail-item">
        <span>Academic Status</span>
        <span style="color: ${student.status === 'PASS' ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">
          ${student.status === 'PASS' ? 'Full Pass' : 'Supply (' + student.backlogs + ' Backlogs)'}
        </span>
      </div>
    `;
  }

  // Populate Table Body
  const tbody = document.getElementById('univ-maxer-table-body');
  if (tbody) {
    tbody.innerHTML = '';
    
    // Sort courses alphabetically
    const courseCodes = Object.keys(student.grades).sort();

    courseCodes.forEach(subCode => {
      const currentGrade = student.grades[subCode];
      const credits = globalCreditsMap[subCode] !== undefined ? globalCreditsMap[subCode] : getInitialDefaultCredits(subCode, state.scheme);
      const subName = state.subjects[subCode] || 'Subject Course';
      
      const tr = document.createElement('tr');
      const currentPts = maxerGradePoints[currentGrade] || 0.0;
      
      // KTU full mapping sequence (ascending order: I, FE, F, P, D, C, C+, B, B+, A, A+, S)
      const fullGradesSequence = ['I', 'FE', 'F', 'P', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S'];
      
      // Sort in descending order for the dropdown choices representation
      const sortedGrades = [...fullGradesSequence].sort((a, b) => maxerGradePoints[b] - maxerGradePoints[a]);

      let optionsHtml = '';
      sortedGrades.forEach(g => {
        const selectedAttr = g === currentGrade ? 'selected' : '';
        optionsHtml += `<option value="${g}" ${selectedAttr}>${g} (${maxerGradePoints[g].toFixed(1)})</option>`;
      });

      tr.innerHTML = `
        <td><span class="subject-badge">${subCode}</span> <strong>${subName}</strong></td>
        <td style="text-align: center;">${credits}</td>
        <td style="text-align: center;"><span class="grade-badge ${currentGrade.toLowerCase().replace('+', 'plus')}">${currentGrade}</span></td>
        <td style="text-align: center;">
          <select class="select-filter univ-maxer-grade-select" data-subject="${subCode}" data-credits="${credits}" style="width: 100%; padding: 0.35rem 0.5rem; font-size: 0.85rem;">
            ${optionsHtml}
          </select>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Add event listeners to dropdown changes
    const dropdowns = document.querySelectorAll('.univ-maxer-grade-select');
    dropdowns.forEach(select => {
      select.addEventListener('change', () => calculateUnivMaxedSgpa(student));
    });

    calculateUnivMaxedSgpa(student);
  }
}

function calculateUnivMaxedSgpa(student) {
  let totalCredits = 0;
  let baselineWeightedPoints = 0;
  let simulatedWeightedPoints = 0;

  const dropdowns = document.querySelectorAll('.univ-maxer-grade-select');
  dropdowns.forEach(select => {
    const subCode = select.dataset.subject;
    const credits = parseFloat(select.dataset.credits) || 0;
    const originalGrade = student.grades[subCode];
    const simulatedGrade = select.value;
    const origGrade = originalGrade === 'PASS' ? 'P' : originalGrade;
    const simGrade = simulatedGrade === 'PASS' ? 'P' : simulatedGrade;

    if (origGrade === 'FAIL' || simGrade === 'FAIL') {
      return;
    }

    const originalPts = maxerGradePoints[origGrade] !== undefined ? maxerGradePoints[origGrade] : 0.0;
    const simulatedPts = maxerGradePoints[simGrade] !== undefined ? maxerGradePoints[simGrade] : 0.0;

    baselineWeightedPoints += originalPts * credits;
    simulatedWeightedPoints += simulatedPts * credits;
    totalCredits += credits;
  });

  const baselineSgpa = totalCredits > 0 ? (baselineWeightedPoints / totalCredits) : 0.0;
  const simulatedSgpa = totalCredits > 0 ? (simulatedWeightedPoints / totalCredits) : 0.0;
  const delta = simulatedSgpa - baselineSgpa;

  const summary = document.getElementById('univ-maxer-summary');
  if (summary) {
    const deltaBadgeHtml = delta > 0 
      ? `<span class="maxer-delta-badge">+${delta.toFixed(2)}</span>` 
      : `<span style="font-size: 1.1rem; font-weight: 700; color: var(--text-muted);">+0.00</span>`;

    summary.innerHTML = `
      <div class="maxer-summary-item">
        <span>Current SGPA</span>
        <span>${baselineSgpa.toFixed(2)}</span>
      </div>
      <div class="maxer-summary-item">
        <span>Simulated SGPA</span>
        <span style="color: var(--accent-terracotta);">${simulatedSgpa.toFixed(2)}</span>
      </div>
      <div class="maxer-summary-item">
        <span>Potential Increase</span>
        <span>${deltaBadgeHtml}</span>
      </div>
    `;
  }
}

function renderUnivMaxerView() {
  if (state.loadedMaxerStudentId) {
    renderUnivMaxerStudentData();
  } else {
    const emptyDiv = document.getElementById('univ-maxer-empty');
    const contentDiv = document.getElementById('univ-maxer-content');
    if (emptyDiv) emptyDiv.classList.remove('hidden');
    if (contentDiv) contentDiv.classList.add('hidden');
  }
}
