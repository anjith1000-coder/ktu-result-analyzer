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
  customCredits: {},  // Subject code -> credit override map
  charts: {}          // Active Chart.js instances (to destroy before re-rendering)
};

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
  '2015': { 'S': 10, 'A+': 9, 'A': 8.5, 'B+': 8, 'B': 7, 'C': 6, 'D': 5.5, 'P': 5, 'F': 0, 'FE': 0, 'I': 0 },
  '2019': { 'O': 10, 'A+': 9, 'A': 8.5, 'B+': 8, 'B': 7, 'C': 6, 'P': 5, 'F': 0, 'FE': 0, 'I': 0 },
  '2024': { 'S': 10, 'A+': 9, 'A': 8.5, 'B+': 8, 'B': 7.5, 'C+': 7, 'C': 6.5, 'D': 6, 'P': 5.5, 'F': 0, 'FE': 0, 'I': 0 }
};

// Initialize the Application
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initSchemeConfig();
    setupEventListeners();
  });
} else {
  initSchemeConfig();
  setupEventListeners();
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
  renderActiveTab();
  updateKPIs();
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
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      const tabId = e.target.getAttribute('data-tab');
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      document.getElementById(`tab-${tabId}`).classList.remove('hidden');
      
      renderActiveTab();
    });
  });

  // Direct Export Triggers
  document.getElementById('btn-export-excel').addEventListener('click', exportToExcelDirect);
  document.getElementById('btn-export-pdf').addEventListener('click', exportToPdfDirect);

  // Demo Mock Data Trigger
  document.getElementById('btn-mock-data').addEventListener('click', loadDemoMockData);

  // Modal Close
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('details-modal').addEventListener('click', (e) => {
    if (e.target.id === 'details-modal') closeModal();
  });

  // Search & Filter listeners
  document.getElementById('search-student').addEventListener('input', renderStudentsTable);
  document.getElementById('filter-student-dept').addEventListener('change', renderStudentsTable);
  document.getElementById('filter-student-status').addEventListener('change', renderStudentsTable);
  document.getElementById('sort-student').addEventListener('change', renderStudentsTable);
  document.getElementById('search-subject').addEventListener('input', renderSubjectsTable);
}

// Parses "MAT416:3, MED416:4" -> state.customCredits map
function parseCustomCredits(str) {
  state.customCredits = {};
  if (!str) return;
  const parts = str.split(',');
  parts.forEach(part => {
    const [sub, cred] = part.split(':');
    if (sub && cred) {
      state.customCredits[sub.trim().toUpperCase()] = parseFloat(cred.trim()) || 4;
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

// ----------------------------------------------------
// KTU RESULT SHEET TEXT PARSER
// ----------------------------------------------------

function parseKTUResultText(text) {
  // 1. Scan for Course Code -> Name Mappings
  // Example lines from PDF text:
  // "MET416 COMPOSITE MATERIALS"
  // "MET468 ADDITIVE MANUFACTURING"
  state.subjects = {};
  const courseMappingRegex = /\b([A-Z]{3,4}\d{3,4}[A-Z]?)\s{2,}([A-Z][A-Z0-9\s&()\-',.+/]{3,60})/g;
  let subMatch;
  while ((subMatch = courseMappingRegex.exec(text)) !== null) {
    const code = subMatch[1].toUpperCase();
    const name = subMatch[2].trim();
    // Exclude noise (like register number patterns or headers matching this shape)
    if (!code.match(/^[A-Z]{5,}/) && !name.match(/^(GENERATED|APJ ABDUL|REG NO|COURSE CODE)/i)) {
      state.subjects[code] = name;
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
    const gradeRegex = /\b([A-Z0-9_\-/]+)\((O|S|A\+|A|B\+|B|C\+|C|D|P|F|FE|I)\)/g;
    let gradeMatch;
    const studentGrades = {};
    while ((gradeMatch = gradeRegex.exec(blockText)) !== null) {
      const subCode = gradeMatch[1].toUpperCase();
      const grade = gradeMatch[2].toUpperCase();
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
  document.getElementById('btn-export-pdf').classList.remove('hidden');

  // Populate department filter select
  populateDeptFilterOptions();

  // Run stats calculations
  recalculateAndRefresh();
}

// ----------------------------------------------------
// STATS GENERATOR / DATA PROCESSOR
// ----------------------------------------------------

function processParsedData() {
  const defaultCreditsEl = document.getElementById('input-default-credits');
  const defaultCred = defaultCreditsEl ? (parseFloat(defaultCreditsEl.value) || 4) : 4;
  
  // Reset aggregates
  state.departments = {};
  
  // 1. Calculate individual SGPA and Backlog info
  state.students.forEach(student => {
    let totalCredits = 0;
    let earnedGradePoints = 0;
    let backlogs = 0;
    let passedSubjects = 0;
    let totalSubjects = 0;
    
    Object.keys(student.grades).forEach(subCode => {
      const grade = student.grades[subCode];
      const credit = state.customCredits[subCode] !== undefined ? state.customCredits[subCode] : defaultCred;
      
      totalSubjects++;
      if (['F', 'FE', 'I'].includes(grade)) {
        backlogs++;
      } else {
        passedSubjects++;
      }
      
      // Calculate grade points (failed courses count as 0, but credits count in SGPA denominator)
      const points = state.gradePoints[grade] || 0;
      earnedGradePoints += points * credit;
      totalCredits += credit;
    });
    
    student.backlogs = backlogs;
    student.passedCount = passedSubjects;
    student.totalCount = totalSubjects;
    student.status = backlogs === 0 ? 'PASS' : 'SUPPLY';
    student.sgpa = (student.status === 'PASS' && totalCredits > 0) ? (earnedGradePoints / totalCredits) : 0.0;
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

  // 2. Generate Department-wise stats
  state.students.forEach(student => {
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
    if (student.sgpa > 0) {
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
  const totalStudents = state.students.length;
  if (totalStudents === 0) return;

  const passedCount = state.students.filter(s => s.status === 'PASS').length;
  const failedCount = totalStudents - passedCount;
  const passRate = (passedCount / totalStudents) * 100;

  document.getElementById('kpi-appeared').textContent = totalStudents;
  document.getElementById('kpi-pass-rate').textContent = passRate.toFixed(1) + '%';
  document.getElementById('kpi-failed').textContent = failedCount;
  
  // Find top branch by pass percentage
  let topBranch = "N/A";
  let maxPassPct = -1;
  Object.keys(state.departments).forEach(branch => {
    const d = state.departments[branch];
    if (d.passPercentage > maxPassPct) {
      maxPassPct = d.passPercentage;
      topBranch = d.code;
    }
  });
  
  const bName = branchNames[topBranch] || topBranch;
  document.getElementById('kpi-top-branch').textContent = topBranch;
  document.getElementById('kpi-top-branch-sub').textContent = `${bName} (${maxPassPct.toFixed(1)}% Pass)`;
}

function populateDeptFilterOptions() {
  const select = document.getElementById('filter-student-dept');
  select.innerHTML = '<option value="ALL">All Departments</option>';
  
  // Get sorted list of department codes
  const codes = Object.keys(state.departments).sort();
  codes.forEach(code => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = `${code} - ${branchNames[code] || 'Branch'}`;
    select.appendChild(option);
  });
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

  const depts = Object.keys(state.departments).sort();
  const passPercentages = depts.map(d => state.departments[d].passPercentage);
  const averageSgpas = depts.map(d => state.departments[d].averageSgpa);

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
  
  state.students.forEach(student => {
    Object.values(student.grades).forEach(grade => {
      if (gradeCounts[grade] !== undefined) gradeCounts[grade]++;
    });
  });

  const gradeLabels = Object.keys(gradeCounts);
  const gradeValues = Object.values(gradeCounts);

  const ctxGradeDist = document.getElementById('chart-grade-dist').getContext('2d');
  state.charts.gradeDist = new Chart(ctxGradeDist, {
    type: 'doughnut',
    data: {
      labels: gradeLabels,
      datasets: [{
        data: gradeValues,
        backgroundColor: [
          '#1d3557', // S/O (Royal dark blue)
          '#2a9d8f', // A+ (Teal green)
          '#457b9d', // A (Steel blue)
          '#e9c46a', // B+ (Amber yellow)
          '#f4a261', // B (Warm orange)
          '#e76f51', // C+ (Coral orange)
          '#f8ad9d', // C (Soft peach)
          '#d3ab9e', // P (Muted rose)
          '#e63946'  // F/FE/I (Vibrant red)
        ],
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
  state.students.forEach(student => {
    Object.keys(student.grades).forEach(subCode => {
      if (!subjectStats[subCode]) {
        subjectStats[subCode] = { registered: 0, failed: 0 };
      }
      subjectStats[subCode].registered++;
      if (['F', 'FE', 'I'].includes(student.grades[subCode])) {
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

  state.students.forEach(student => {
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

  const sortedDepts = Object.values(state.departments).sort((a, b) => b.passPercentage - a.passPercentage);
  
  sortedDepts.forEach((dept, idx) => {
    const rank = idx + 1;
    let badgeClass = "rank-other";
    if (rank === 1) badgeClass = "rank-1";
    else if (rank === 2) badgeClass = "rank-2";
    else if (rank === 3) badgeClass = "rank-3";

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align: center;"><span class="rank-badge ${badgeClass}">${rank}</span></td>
      <td><strong>${dept.code}</strong></td>
      <td>${dept.name}</td>
      <td style="text-align: center;">${dept.appeared}</td>
      <td style="text-align: center; color: var(--success); font-weight: 600;">${dept.fullPass}</td>
      <td style="text-align: center; color: ${dept.supply > 0 ? 'var(--danger)' : 'var(--text-muted)'};">${dept.supply}</td>
      <td style="text-align: center; font-weight: 700;">${dept.passPercentage.toFixed(1)}%</td>
      <td style="text-align: center; color: var(--accent-terracotta); font-weight: 600;">${dept.averageSgpa.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// --- TAB RENDER: SUBJECTS ANALYSIS TABLE ---
function renderSubjectsTable() {
  const tbody = document.getElementById('table-body-subject');
  tbody.innerHTML = '';

  const searchQuery = document.getElementById('search-subject').value.toUpperCase();

  // Aggregate stats per subject code
  const subjectAgg = {};
  state.students.forEach(student => {
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
      if (['F', 'FE', 'I'].includes(grade)) {
        subjectAgg[subCode].failed++;
      } else {
        subjectAgg[subCode].passed++;
      }
      
      if (subjectAgg[subCode].gradeDistribution[grade] !== undefined) {
        subjectAgg[subCode].gradeDistribution[grade]++;
      }
    });
  });

  const list = Object.values(subjectAgg).filter(sub => {
    return sub.code.includes(searchQuery) || sub.name.toUpperCase().includes(searchQuery);
  });

  // Sort by failure count descending
  list.sort((a, b) => b.failed - a.failed);

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

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="subject-badge">${sub.code}</span></td>
      <td><strong>${sub.name}</strong></td>
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
  const sortBy = document.getElementById('sort-student').value;

  // Filter students
  let filtered = state.students.filter(student => {
    const matchSearch = student.id.includes(search) || student.name.toUpperCase().includes(search);
    const matchDept = deptFilter === 'ALL' || student.branch === deptFilter;
    const matchStatus = statusFilter === 'ALL' || student.status === statusFilter;
    return matchSearch && matchDept && matchStatus;
  });

  // Sort students
  if (sortBy === 'ROLL_ASC') {
    filtered.sort((a, b) => a.id.localeCompare(b.id));
  } else if (sortBy === 'SGPA_DESC') {
    filtered.sort((a, b) => b.sgpa - a.sgpa);
  } else if (sortBy === 'SGPA_ASC') {
    filtered.sort((a, b) => a.sgpa - b.sgpa);
  } else if (sortBy === 'BACK_DESC') {
    filtered.sort((a, b) => b.backlogs - a.backlogs);
  }

  const hasNames = Object.keys(state.nameMap).length > 0;
  const thName = document.getElementById('th-student-name');
  if (thName) {
    if (hasNames) {
      thName.classList.remove('hidden');
    } else {
      thName.classList.add('hidden');
    }
  }

  filtered.forEach((stud, index) => {
    let badgeClass = "rank-other";
    if (stud.classRank === 1) badgeClass = "rank-1";
    else if (stud.classRank === 2) badgeClass = "rank-2";
    else if (stud.classRank === 3) badgeClass = "rank-3";

    let actionsHtml = "";
    if (stud.backlogs > 0) {
      const failedSubs = Object.keys(stud.grades)
        .filter(code => ['F', 'FE', 'I'].includes(stud.grades[code]))
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
  // 1. Fill Student Backlog Leaders Table
  const tbodyMax = document.getElementById('table-body-backlogs-max');
  tbodyMax.innerHTML = '';

  const studentsWithBacklogs = state.students.filter(s => s.backlogs > 0);
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

  const topBacklogStudents = studentsWithBacklogs.slice(0, 15);
  if (topBacklogStudents.length === 0) {
    tbodyMax.innerHTML = `<tr><td colspan="${hasNames ? 5 : 4}" style="text-align:center; color:var(--text-muted);">No backlogs recorded! Outstanding campus performance.</td></tr>`;
  } else {
    topBacklogStudents.forEach(stud => {
      const failedSubs = Object.keys(stud.grades).filter(code => ['F', 'FE', 'I'].includes(stud.grades[code])).join(', ');
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${stud.id}</strong></td>
        ${hasNames ? `<td>${stud.name}</td>` : ''}
        <td style="text-align: center;"><span class="subject-badge">${stud.branch}</span></td>
        <td style="text-align: center; color: var(--danger); font-weight: 700;">${stud.backlogs}</td>
        <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${failedSubs}">
          <span style="color: var(--danger); font-size: 0.85rem;">${failedSubs}</span>
        </td>
      `;
      tbodyMax.appendChild(tr);
    });
  }

  // 2. Fill top difficult subjects table
  const tbodySubs = document.getElementById('table-body-backlogs-subjects');
  tbodySubs.innerHTML = '';

  const subjectAgg = {};
  state.students.forEach(student => {
    Object.keys(student.grades).forEach(subCode => {
      if (!subjectAgg[subCode]) {
        subjectAgg[subCode] = { code: subCode, name: state.subjects[subCode] || subCode, registered: 0, failed: 0 };
      }
      subjectAgg[subCode].registered++;
      if (['F', 'FE', 'I'].includes(student.grades[subCode])) {
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

  const depts = Object.keys(state.departments).sort();
  depts.forEach(branch => {
    let totalBacklogs = 0;
    let studentsWithSupply = 0;
    let count = 0;
    
    state.students.forEach(student => {
      if (student.branch === branch) {
        count++;
        totalBacklogs += student.backlogs;
        if (student.backlogs > 0) {
          studentsWithSupply++;
        }
      }
    });

    const avgBacklogs = count > 0 ? (totalBacklogs / count) : 0;
    const name = branchNames[branch] || branch + " Department";

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

  const defaultCreditsEl = document.getElementById('input-default-credits');
  const defaultCred = defaultCreditsEl ? (parseFloat(defaultCreditsEl.value) || 4) : 4;

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
    const credits = state.customCredits[subCode] !== undefined ? state.customCredits[subCode] : defaultCred;
    const points = state.gradePoints[grade] || 0;

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
// SHEETJS EXCEL & PDF EXPORT SYSTEM
// ----------------------------------------------------

function exportToExcelDirect() {
  if (state.students.length === 0) return;
  showLoading();
  
  setTimeout(() => {
    try {
      // Calculate overall metrics
      const totalRegistered = state.students.length;
      const totalPassed = state.students.filter(s => s.status === 'PASS').length;
      const totalFailed = totalRegistered - totalPassed;
      const overallPassPct = totalRegistered > 0 ? ((totalPassed / totalRegistered) * 100).toFixed(2) : "0.00";
      
      // Rule A: Calculate total institutional average SGPA as a true weighted average of valid SGPAs (excluding 0.00)
      const validSgpas = state.students.filter(s => s.sgpa > 0).map(s => s.sgpa);
      const totalValidSgpasSum = validSgpas.reduce((sum, val) => sum + val, 0);
      const averageSgpaInstitutional = validSgpas.length > 0 ? (totalValidSgpasSum / validSgpas.length).toFixed(2) : "0.00";
      
      // Academic Standing Tiers (Passed Students Only)
      const passingStudents = state.students.filter(s => s.status === 'PASS');
      const distinctionCount = passingStudents.filter(s => s.sgpa >= 8.5).length;
      const firstClassCount = passingStudents.filter(s => s.sgpa >= 7.0 && s.sgpa < 8.5).length;
      const secondClassCount = passingStudents.filter(s => s.sgpa < 7.0).length;

      // Calculate departments standings
      const sortedDepts = Object.values(state.departments).sort((a, b) => b.passPercentage - a.passPercentage);
      let deptRows = "";
      sortedDepts.forEach(d => {
        deptRows += `
          <tr>
            <td style="border: 1px solid #CCCCCC; padding: 8px;">${d.name}</td>
            <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: right;">${d.appeared}</td>
            <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: right; color: #608066; font-weight: bold;">${d.fullPass}</td>
            <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: right; color: #B56559;">${d.supply}</td>
            <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: right; font-weight: bold;">${d.passPercentage.toFixed(2)}%</td>
            <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: right; color: #CB997E; font-weight: bold;">${d.averageSgpa.toFixed(2)}</td>
          </tr>
        `;
      });
      
      // Calculate subject analytics
      const subjectAgg = {};
      state.students.forEach(student => {
        Object.keys(student.grades).forEach(subCode => {
          if (!subjectAgg[subCode]) {
            subjectAgg[subCode] = {
              code: subCode,
              name: state.subjects[subCode] || subCode,
              registered: 0,
              passed: 0,
              failed: 0
            };
          }
          subjectAgg[subCode].registered++;
          if (['F', 'FE', 'I'].includes(student.grades[subCode])) {
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
        const deptPrefix = s.code.substring(0, 2).toUpperCase();
        const deptName = branchNames[deptPrefix] || "General Science/Humanities";
        subjectRows += `
          <tr>
            <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: center; font-weight: bold;">${idx + 1}</td>
            <td style="border: 1px solid #CCCCCC; padding: 8px;">${s.code}</td>
            <td style="border: 1px solid #CCCCCC; padding: 8px;">${deptName}</td>
            <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: right; font-weight: bold;">${s.passPct.toFixed(2)}%</td>
            <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: right;">${s.registered}</td>
            <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: right; color: #608066;">${s.passed}</td>
            <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: right; color: #B56559;">${s.failed}</td>
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
            <td colspan="6" style="border: 1px solid #CCCCCC; padding: 8px; text-align: center; font-style: italic;">No critical subject risks identified.</td>
          </tr>
        `;
      } else {
        riskSubjects.forEach((s, idx) => {
          const deptPrefix = s.code.substring(0, 2).toUpperCase();
          const deptName = branchNames[deptPrefix] || "General Science/Humanities";
          riskRows += `
            <tr>
              <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: center; font-weight: bold;">${idx + 1}</td>
              <td style="border: 1px solid #CCCCCC; padding: 8px;">${s.code}</td>
              <td style="border: 1px solid #CCCCCC; padding: 8px;">${s.name}</td>
              <td style="border: 1px solid #CCCCCC; padding: 8px;">${deptName}</td>
              <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: right; color: #B56559; font-weight: bold;">${s.failed}</td>
              <td style="border: 1px solid #CCCCCC; padding: 8px; text-align: right; font-weight: bold; color: #C62828;">${s.failPct.toFixed(2)}%</td>
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
            td, th { border: 1px solid #CCCCCC; padding: 8px; font-size: 11pt; vertical-align: middle; }
            .header-banner-1 { background-color: #6A1B9A; color: #FFFFFF; font-weight: bold; text-align: center; font-size: 16pt; height: 35px; border: 1px solid #4A148C; }
            .header-banner-2 { background-color: #4CAF50; color: #FFFFFF; font-weight: bold; text-align: center; font-size: 13pt; height: 30px; border: 1px solid #388E3C; }
            .header-banner-3 { background-color: #FFC107; color: #000000; font-weight: bold; text-align: center; font-size: 11pt; height: 25px; border: 1px solid #F57F17; }
            .section-header-stat { background-color: #E65100; color: #FFFFFF; font-weight: bold; font-size: 12pt; height: 25px; text-align: left; }
            .section-header-dept { background-color: #F57C00; color: #FFFFFF; font-weight: bold; font-size: 12pt; height: 25px; text-align: left; }
            .section-header-risk { background-color: #C62828; color: #FFFFFF; font-weight: bold; font-size: 12pt; height: 25px; text-align: left; }
            .table-header { background-color: #0D47A1; color: #FFFFFF; font-weight: bold; text-align: center; font-size: 11pt; height: 25px; }
            .table-header-risk { background-color: #C62828; color: #FFFFFF; font-weight: bold; text-align: center; font-size: 11pt; height: 25px; }
            .bold-text { font-weight: bold; background-color: #F5F5F5; }
            .number-cell { text-align: right; }
            .percent-cell { text-align: right; font-weight: bold; }
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
              <td colspan="4" class="section-header-stat" style="background-color: #E65100; color: #FFFFFF; font-weight: bold; font-size: 12pt;">OVERALL STATISTICS - REGULAR STUDENTS ONLY</td>
              <td colspan="3" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text" style="font-weight: bold; background-color: #F5F5F5;">Total Registered</td>
              <td class="number-cell" style="text-align: right;">${totalRegistered}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text" style="font-weight: bold; background-color: #F5F5F5;">Total Passed</td>
              <td class="number-cell" style="text-align: right;">${totalPassed}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text" style="font-weight: bold; background-color: #F5F5F5;">Total Failed</td>
              <td class="number-cell" style="text-align: right;">${totalFailed}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text" style="font-weight: bold; background-color: #F5F5F5;">Overall Pass %</td>
              <td class="percent-cell" style="text-align: right; font-weight: bold;">${overallPassPct}%</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text" style="font-weight: bold; background-color: #F5F5F5;">Average SGPA (Passed)</td>
              <td class="number-cell" style="text-align: right; font-weight: bold; color: #E65100;">${averageSgpaInstitutional}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>

            <!-- Empty Spacer -->
            <tr><td colspan="7" style="border:none; height: 10px;"></td></tr>

            <!-- Academic Standing Tiers -->
            <tr>
              <td colspan="4" class="section-header-stat" style="background-color: #E65100; color: #FFFFFF; font-weight: bold; font-size: 12pt;">ACADEMIC STANDING TIERS (PASSED STUDENTS ONLY)</td>
              <td colspan="3" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text" style="font-weight: bold; background-color: #F5F5F5;">Distinction Tiers (SGPA >= 8.5)</td>
              <td class="number-cell" style="text-align: right;">${distinctionCount}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text" style="font-weight: bold; background-color: #F5F5F5;">First Class Tiers (7.0 to 8.49)</td>
              <td class="number-cell" style="text-align: right;">${firstClassCount}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            <tr>
              <td class="bold-text" style="font-weight: bold; background-color: #F5F5F5;">Second Class Tiers (SGPA < 7.0)</td>
              <td class="number-cell" style="text-align: right;">${secondClassCount}</td>
              <td colspan="5" style="border:none;"></td>
            </tr>
            
            <!-- Empty Spacer -->
            <tr><td colspan="7" style="border:none; height: 15px;"></td></tr>
            
            <!-- Department Table Header -->
            <tr>
              <td colspan="6" class="section-header-dept" style="background-color: #F57C00; color: #FFFFFF; font-weight: bold; font-size: 12pt;">DEPARTMENT-WISE PERFORMANCE ANALYSIS</td>
              <td style="border:none;"></td>
            </tr>
            <tr class="table-header" style="background-color: #0D47A1; color: #FFFFFF; font-weight: bold;">
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
              <td colspan="7" class="section-header-dept" style="background-color: #F57C00; color: #FFFFFF; font-weight: bold; font-size: 12pt;">TOP 5 PERFORMING SUBJECTS</td>
            </tr>
            <tr class="table-header" style="background-color: #0D47A1; color: #FFFFFF; font-weight: bold;">
              <td>Rank</td>
              <td>Subject Code</td>
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
              <td colspan="6" class="section-header-risk" style="background-color: #C62828; color: #FFFFFF; font-weight: bold; font-size: 12pt;">CRITICAL SUBJECT RISK DIRECTORY (HIGHEST FAILURE RATES)</td>
              <td style="border:none;"></td>
            </tr>
            <tr class="table-header-risk" style="background-color: #C62828; color: #FFFFFF; font-weight: bold;">
              <td>Rank</td>
              <td>Subject Code</td>
              <td>Subject Name</td>
              <td>Department</td>
              <td>Fail Count</td>
              <td>Failure Rate %</td>
              <td style="border:none;"></td>
            </tr>
            ${riskRows}
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

function exportToPdfDirect() {
  window.print();
}

// ----------------------------------------------------
// DEMO MOCK DATA GENERATOR
// ----------------------------------------------------

function loadDemoMockData() {
  if (document.getElementById('page-loading')) return; // Prevent concurrent overlaps
  showLoading();
  
  // Set sample subjects
  state.subjects = {
    'MAT201': 'PARTIAL DIFFERENTIAL EQUATIONS & COMPLEX ANALYSIS',
    'CST201': 'DATA STRUCTURES',
    'CST203': 'LOGIC SYSTEM DESIGN',
    'ECT201': 'SOLID STATE DEVICES',
    'ECT203': 'LOGIC CIRCUIT DESIGN',
    'MET201': 'MECHANICALS OF SOLIDS',
    'MET203': 'THEORY OF MACHINES',
    'EST200': 'DESIGN & ENGINEERING',
    'MCN201': 'CONSTITUTION OF INDIA',
    'HUT200': 'PROFESSIONAL ETHICS'
  };

  // Sample Students Lists
  const mockNames = [
    "Rahul Krishna", "Devika Nair", "Aravind S", "Anjana Ramesh", "Aditya Prasad",
    "Gopika Menon", "Siddharth Raj", "Meenakshi K", "Arjun Varma", "Sneha Joseph",
    "Manu Pillai", "Kavya Madhavan", "Vivek Anand", "Aiswarya Roy", "Abhishek Sen",
    "Nandana Sree", "Rohan Kurian", "Gouri Parvathy", "Kiran Mathew", "Deepa Balan",
    "Harikrishnan U", "Athira Chandran", "Varun Das", "Amina Becker", "Jithin Thomas",
    "Gautham Suresh", "Malavika B", "Sreehari P", "Shreya Jacob", "Anandhu G",
    "Nikhil Paul", "Pooja Hegde", "Midhun Manoj", "Nivedita Bose", "Sanjay Nair",
    "Sandra Davis", "Faisal Khan", "Riya George", "Akhil Kumar", "Vrindha Mohan",
    "Arun Dev", "Bhavana Ram", "Sarath Chandran", "Elizabeth Roy", "Vishnu Prasad",
    "Anila Augustine", "Amal Sajeev", "Reshma Das", "Abhijith R", "Keerthi Suresh"
  ];

  const branches = ['CS', 'DS', 'AD', 'CY', 'AM', 'EC', 'ME'];
  const gradesPool = ['O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F'];
  const gradesWeight = [0.1, 0.15, 0.25, 0.2, 0.15, 0.08, 0.05, 0.02]; // realistic skew

  function getRandomGrade() {
    const r = Math.random();
    let sum = 0;
    for (let i = 0; i < gradesPool.length; i++) {
      sum += gradesWeight[i];
      if (r <= sum) return gradesPool[i];
    }
    return 'B';
  }

  state.students = [];
  
  // Create 60 realistic students
  for (let i = 1; i <= 60; i++) {
    const branch = branches[Math.floor(Math.random() * branches.length)];
    const rollNo = String(i).padStart(3, '0');
    const isLateral = Math.random() < 0.1;
    const prefix = isLateral ? "L" : "";
    const regNo = `${prefix}PRC22${branch}${rollNo}`;
    
    const studentGrades = {};
    // Assign core courses based on branch
    const coreSubjects = [];
    if (['CS', 'DS', 'AD', 'CY', 'AM'].includes(branch)) {
      coreSubjects.push('CST201', 'CST203');
    } else if (branch === 'EC') {
      coreSubjects.push('ECT201', 'ECT203');
    } else if (branch === 'ME') {
      coreSubjects.push('MET201', 'MET203');
    }
    
    // Common subjects
    coreSubjects.push('MAT201', 'EST200', 'MCN201', 'HUT200');

    coreSubjects.forEach(code => {
      studentGrades[code] = getRandomGrade();
    });

    // Student profile
    const nameIndex = (i - 1) % mockNames.length;
    const baseName = mockNames[nameIndex];
    const suffix = Math.floor((i - 1) / mockNames.length) > 0 ? " " + (Math.floor((i - 1) / mockNames.length) + 1) : "";
    
    state.students.push({
      id: regNo,
      prefix: prefix,
      college: "PRC",
      year: "22",
      branch: branch,
      roll: rollNo,
      grades: studentGrades,
      name: baseName + suffix
    });
  }

  // Populate Name map as well
  state.nameMap = {};
  state.students.forEach(s => state.nameMap[s.id] = s.name);

  // Set default custom credits in input config for demo look
  const customCreditsInput = document.getElementById('input-subject-credits');
  if (customCreditsInput) {
    customCreditsInput.value = 'MAT201:4, CST201:4, CST203:3, EST200:3, MCN201:0, HUT200:2';
  }
  parseCustomCredits('MAT201:4, CST201:4, CST203:3, EST200:3, MCN201:0, HUT200:2');

  // Trigger page views
  document.getElementById('badge-result').textContent = 'Demo Loaded (60 Students)';
  document.getElementById('badge-result').className = 'status-badge success';
  document.getElementById('status-result').classList.add('active');
  
  document.getElementById('badge-names').textContent = 'Demo Mappings Loaded';
  document.getElementById('badge-names').className = 'status-badge success';
  document.getElementById('status-names').classList.add('active');

  document.getElementById('empty-state-section').classList.add('hidden');
  document.getElementById('analysis-section').classList.remove('hidden');
  document.getElementById('btn-export-excel').classList.remove('hidden');
  document.getElementById('btn-export-pdf').classList.remove('hidden');

  populateDeptFilterOptions();
  recalculateAndRefresh();
  
  hideLoading();
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
