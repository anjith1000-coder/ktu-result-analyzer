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
document.addEventListener('DOMContentLoaded', () => {
  initSchemeConfig();
  setupEventListeners();
});

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
  const studentRegex = /\b(L?)([A-Z]{3})(\d{2})([A-Z]{2})(\d{3})\b/g;
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
    
    student.sgpa = totalCredits > 0 ? (earnedGradePoints / totalCredits) : 0.0;
    student.backlogs = backlogs;
    student.passedCount = passedSubjects;
    student.totalCount = totalSubjects;
    student.status = backlogs === 0 ? 'PASS' : 'SUPPLY';
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
        passPercentage: 0,
        averageSgpa: 0
      };
    }
    
    const d = state.departments[branch];
    d.appeared++;
    d.totalSgpa += student.sgpa;
    
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
    d.averageSgpa = d.appeared > 0 ? (d.totalSgpa / d.appeared) : 0;
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
        <button class="btn btn-accent" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;" onclick="viewStudentDetails('${stud.id}')">View Details</button>
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
  exportToExcelCustom(true, true, true, true, true);
}

function exportToPdfDirect() {
  exportToPdfCustom(true, true, true, true, true);
}

function closeExportModal() {
  // Modal has been removed, safe no-op
}

function exportToExcelCustom(summary, dept, subject, student, backlog) {
  if (state.students.length === 0) return;
  showLoading();
  
  setTimeout(() => {
    try {
      const defaultCreditsEl = document.getElementById('input-default-credits');
      const defaultCred = defaultCreditsEl ? (parseFloat(defaultCreditsEl.value) || 4) : 4;
      const wb = XLSX.utils.book_new();

      // SHEET 1: COLLEGE CONSOLIDATED SUMMARY
      if (summary) {
        const summaryData = [
          ["APJ ABDUL KALAM TECHNOLOGICAL UNIVERSITY - COLLEGE RESULTS REPORT"],
          [],
          ["OVERALL METRICS"],
          ["Total Appeared", state.students.length],
          ["Total Passed (All Subjects Cleared)", state.students.filter(s => s.status === 'PASS').length],
          ["Total Failed / Supplies", state.students.filter(s => s.status === 'SUPPLY').length],
          ["Overall Pass Percentage", ((state.students.filter(s => s.status === 'PASS').length / state.students.length) * 100).toFixed(2) + "%"],
          [],
          ["BRANCH WISE SUMMARY"],
          ["Branch Code", "Branch Name", "Appeared", "Passed", "Failed", "Pass %", "Average SGPA"]
        ];
        Object.values(state.departments).sort((a,b) => b.passPercentage - a.passPercentage).forEach(d => {
          summaryData.push([d.code, d.name, d.appeared, d.fullPass, d.supply, d.passPercentage.toFixed(2) + "%", d.averageSgpa.toFixed(2)]);
        });
        const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, wsSummary, "Consolidated College Report");
      }

      // SHEET 2: DETAILED DEPARTMENT ANALYSIS
      if (dept) {
        const deptData = [
          ["DEPARTMENT Standings & STATISTICS"],
          [],
          ["Rank", "Branch Code", "Branch Name", "Students Appeared", "Passed", "Failed (Supply)", "Pass Percentage", "Average SGPA"]
        ];
        Object.values(state.departments).sort((a,b) => b.passPercentage - a.passPercentage).forEach((d, idx) => {
          deptData.push([idx + 1, d.code, d.name, d.appeared, d.fullPass, d.supply, d.passPercentage.toFixed(2) + "%", d.averageSgpa.toFixed(2)]);
        });
        const wsDept = XLSX.utils.aoa_to_sheet(deptData);
        XLSX.utils.book_append_sheet(wb, wsDept, "Department Result Report");
      }

      // SHEET 3: SUBJECT ANALYSIS REPORT
      if (subject) {
        const subjectAgg = {};
        state.students.forEach(student => {
          Object.keys(student.grades).forEach(subCode => {
            if (!subjectAgg[subCode]) {
              subjectAgg[subCode] = { code: subCode, name: state.subjects[subCode] || subCode, registered: 0, passed: 0, failed: 0, grads: {} };
              Object.keys(state.gradePoints).forEach(g => subjectAgg[subCode].grads[g] = 0);
            }
            subjectAgg[subCode].registered++;
            const grade = student.grades[subCode];
            if (['F', 'FE', 'I'].includes(grade)) subjectAgg[subCode].failed++;
            else subjectAgg[subCode].passed++;
            
            if (subjectAgg[subCode].grads[grade] !== undefined) subjectAgg[subCode].grads[grade]++;
          });
        });

        const subjectHeader = ["Subject Code", "Subject Name", "Registered", "Passed", "Failed", "Pass Percentage"];
        const gradeHeaders = Object.keys(state.gradePoints);
        const fullSubHeader = subjectHeader.concat(gradeHeaders);
        const subData = [
          ["SUBJECT ANALYSIS AND GRADE DISTRIBUTIONS"],
          [],
          fullSubHeader
        ];
        Object.values(subjectAgg).sort((a,b) => b.failed - a.failed).forEach(s => {
          const passPct = s.registered > 0 ? (s.passed / s.registered) * 100 : 0;
          const row = [s.code, s.name, s.registered, s.passed, s.failed, passPct.toFixed(2) + "%"];
          gradeHeaders.forEach(g => {
            row.push(s.grads[g] || 0);
          });
          subData.push(row);
        });
        const wsSubject = XLSX.utils.aoa_to_sheet(subData);
        XLSX.utils.book_append_sheet(wb, wsSubject, "Subject Analysis Report");
      }

      // SHEET 4: STUDENT RESULTS REPORT (PIVOT GRID MAPPING STUDENTS TO SUBJECT CODES)
      if (student) {
        const subjectAgg = {};
        state.students.forEach(student => {
          Object.keys(student.grades).forEach(subCode => {
            if (!subjectAgg[subCode]) {
              subjectAgg[subCode] = { code: subCode };
            }
          });
        });
        const uniqueSubjects = Object.keys(subjectAgg).sort();
        const studentHeader = ["Class Rank", "Dept Rank", "Register No", "Name", "Branch Code", "Passed / Total", "Backlog Count", "SGPA", "Status"];
        const fullStudHeader = studentHeader.concat(uniqueSubjects);
        const studReportData = [
          ["STUDENT PERFORMANCE PIVOT DIRECTORY"],
          [],
          fullStudHeader
        ];
        const sortedStudents = [...state.students].sort((a, b) => b.sgpa - a.sgpa);
        sortedStudents.forEach(stud => {
          const row = [
            stud.classRank,
            stud.deptRank,
            stud.id,
            stud.name,
            stud.branch,
            `${stud.passedCount} / ${stud.totalCount}`,
            stud.backlogs,
            stud.sgpa.toFixed(2),
            stud.status === 'PASS' ? 'Full Pass' : 'Supply'
          ];
          uniqueSubjects.forEach(subCode => {
            row.push(stud.grades[subCode] || "-");
          });
          studReportData.push(row);
        });
        const wsStudent = XLSX.utils.aoa_to_sheet(studReportData);
        XLSX.utils.book_append_sheet(wb, wsStudent, "Student Performance Report");
      }

      // SHEET 5: BACKLOG/SUPPLY ANALYSIS
      if (backlog) {
        const subjectAgg = {};
        state.students.forEach(student => {
          Object.keys(student.grades).forEach(subCode => {
            if (!subjectAgg[subCode]) {
              subjectAgg[subCode] = { code: subCode, name: state.subjects[subCode] || subCode, registered: 0, failed: 0 };
            }
            subjectAgg[subCode].registered++;
            const grade = student.grades[subCode];
            if (['F', 'FE', 'I'].includes(grade)) subjectAgg[subCode].failed++;
          });
        });
        const backlogData = [
          ["BACKLOG AND FAILURE METRICS ANALYSIS"],
          [],
          ["SUBJECT-WISE FAILURE RATE RANKING"],
          ["Subject Code", "Subject Name", "Failures Count", "Failure Rate"],
        ];
        Object.values(subjectAgg).sort((a,b) => b.failed - a.failed).filter(s => s.failed > 0).forEach(s => {
          backlogData.push([s.code, s.name, s.failed, ((s.failed / s.registered) * 100).toFixed(2) + "%"]);
        });
        backlogData.push([]);
        backlogData.push([]);
        backlogData.push(["STUDENTS WITH MAXIMUM BACKLOGS"]);
        backlogData.push(["Register No", "Name", "Branch Code", "Backlog Count", "Failed Subject Codes"]);
        state.students.filter(s => s.backlogs > 0).sort((a,b) => b.backlogs - a.backlogs).forEach(stud => {
          const failedSubs = Object.keys(stud.grades).filter(code => ['F', 'FE', 'I'].includes(stud.grades[code])).join(', ');
          backlogData.push([stud.id, stud.name, stud.branch, stud.backlogs, failedSubs]);
        });
        const wsBacklog = XLSX.utils.aoa_to_sheet(backlogData);
        XLSX.utils.book_append_sheet(wb, wsBacklog, "Backlog Analysis Report");
      }

      XLSX.writeFile(wb, "KTU_Result_Analysis_Report.xlsx");
      hideLoading();
      closeExportModal();
    } catch (err) {
      alert("Failed to export Excel report: " + err.message);
      hideLoading();
    }
  }, 100);
}

function exportToPdfCustom(summary, dept, subject, student, backlog) {
  if (state.students.length === 0) return;
  showLoading();

  setTimeout(() => {
    try {
      // Create offscreen container
      const container = document.createElement('div');
      container.style.padding = '20px';
      container.style.background = '#FFFFFF';
      container.style.color = '#000000';
      container.style.fontFamily = 'Arial, sans-serif';
      
      const styles = `
        <style>
          .pdf-title { text-align: center; font-size: 22px; font-weight: bold; margin-bottom: 20px; color: #1e293b; text-transform: uppercase; }
          .pdf-subtitle { text-align: center; font-size: 14px; color: #64748b; margin-top: -15px; margin-bottom: 30px; }
          .pdf-h2 { font-size: 16px; border-bottom: 2px solid #cbd5e1; padding-bottom: 5px; margin-top: 30px; margin-bottom: 15px; color: #334155; page-break-after: avoid; }
          .pdf-table { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 10px; }
          .pdf-table th { background: #f1f5f9; font-weight: bold; color: #1e293b; border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
          .pdf-table td { border: 1px solid #cbd5e1; padding: 6px 8px; color: #334155; }
          .pdf-table tr:nth-child(even) td { background: #f8fafc; }
          .pdf-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 25px; }
          .pdf-kpi-card { border: 1px solid #cbd5e1; padding: 10px; border-radius: 4px; background: #f8fafc; }
          .pdf-kpi-label { font-size: 8px; text-transform: uppercase; color: #64748b; font-weight: bold; }
          .pdf-kpi-value { font-size: 18px; font-weight: bold; color: #0f172a; margin-top: 2px; }
          .pdf-page-break { page-break-before: always; }
        </style>
      `;
      
      let htmlContent = styles;
      htmlContent += `<div class="pdf-title">APJ Abdul Kalam Technological University</div>`;
      htmlContent += `<div class="pdf-subtitle">College Results Analysis Report</div>`;

      // 1. Consolidated Summary
      if (summary) {
        const totalApp = state.students.length;
        const totalPass = state.students.filter(s => s.status === 'PASS').length;
        const totalFail = totalApp - totalPass;
        const passRate = (totalPass / totalApp) * 100;
        
        let topBranch = "N/A";
        let maxPassPct = -1;
        Object.keys(state.departments).forEach(branch => {
          const d = state.departments[branch];
          if (d.passPercentage > maxPassPct) {
            maxPassPct = d.passPercentage;
            topBranch = d.code;
          }
        });

        htmlContent += `
          <div class="pdf-h2">1. Consolidated College Report Summary</div>
          <div class="pdf-kpi-grid">
            <div class="pdf-kpi-card">
              <div class="pdf-kpi-label">Students Appeared</div>
              <div class="pdf-kpi-value">${totalApp}</div>
            </div>
            <div class="pdf-kpi-card">
              <div class="pdf-kpi-label">Overall Pass Rate</div>
              <div class="pdf-kpi-value">${passRate.toFixed(1)}%</div>
            </div>
            <div class="pdf-kpi-card">
              <div class="pdf-kpi-label">Supply Students</div>
              <div class="pdf-kpi-value">${totalFail}</div>
            </div>
            <div class="pdf-kpi-card">
              <div class="pdf-kpi-label">Top Branch</div>
              <div class="pdf-kpi-value">${topBranch}</div>
            </div>
          </div>
          
          <table class="pdf-table">
            <thead>
              <tr>
                <th>Branch</th>
                <th>Department Name</th>
                <th style="text-align: center;">Appeared</th>
                <th style="text-align: center;">Passed</th>
                <th style="text-align: center;">Supply</th>
                <th style="text-align: center;">Pass %</th>
                <th style="text-align: center;">Avg SGPA</th>
              </tr>
            </thead>
            <tbody>
        `;
        Object.values(state.departments).sort((a,b) => b.passPercentage - a.passPercentage).forEach(d => {
          htmlContent += `
            <tr>
              <td><strong>${d.code}</strong></td>
              <td>${d.name}</td>
              <td style="text-align: center;">${d.appeared}</td>
              <td style="text-align: center;">${d.fullPass}</td>
              <td style="text-align: center;">${d.supply}</td>
              <td style="text-align: center; font-weight: bold;">${d.passPercentage.toFixed(1)}%</td>
              <td style="text-align: center;">${d.averageSgpa.toFixed(2)}</td>
            </tr>
          `;
        });
        htmlContent += `</tbody></table>`;
      }

      // 2. Department stands
      if (dept) {
        const isBreak = summary ? " pdf-page-break" : "";
        htmlContent += `
          <div class="pdf-h2${isBreak}">2. Department Result Standings Report</div>
          <table class="pdf-table">
            <thead>
              <tr>
                <th style="width: 40px; text-align: center;">Rank</th>
                <th>Branch</th>
                <th>Department Name</th>
                <th style="text-align: center;">Appeared</th>
                <th style="text-align: center;">Passed</th>
                <th style="text-align: center;">Supply</th>
                <th style="text-align: center;">Pass %</th>
                <th style="text-align: center;">Average SGPA</th>
              </tr>
            </thead>
            <tbody>
        `;
        Object.values(state.departments).sort((a,b) => b.passPercentage - a.passPercentage).forEach((d, idx) => {
          htmlContent += `
            <tr>
              <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
              <td><strong>${d.code}</strong></td>
              <td>${d.name}</td>
              <td style="text-align: center;">${d.appeared}</td>
              <td style="text-align: center;">${d.fullPass}</td>
              <td style="text-align: center;">${d.supply}</td>
              <td style="text-align: center; font-weight: bold;">${d.passPercentage.toFixed(1)}%</td>
              <td style="text-align: center; font-weight: bold;">${d.averageSgpa.toFixed(2)}</td>
            </tr>
          `;
        });
        htmlContent += `</tbody></table>`;
      }

      // 3. Subject Analysis
      if (subject) {
        const isBreak = (summary || dept) ? " pdf-page-break" : "";
        const subjectAgg = {};
        state.students.forEach(student => {
          Object.keys(student.grades).forEach(subCode => {
            if (!subjectAgg[subCode]) {
              subjectAgg[subCode] = { code: subCode, name: state.subjects[subCode] || subCode, registered: 0, passed: 0, failed: 0 };
            }
            subjectAgg[subCode].registered++;
            const grade = student.grades[subCode];
            if (['F', 'FE', 'I'].includes(grade)) subjectAgg[subCode].failed++;
            else subjectAgg[subCode].passed++;
          });
        });

        htmlContent += `
          <div class="pdf-h2${isBreak}">3. Subject-wise Analysis Report</div>
          <table class="pdf-table">
            <thead>
              <tr>
                <th>Subject Code</th>
                <th>Subject Name</th>
                <th style="text-align: center;">Registered</th>
                <th style="text-align: center;">Passed</th>
                <th style="text-align: center;">Failed</th>
                <th style="text-align: center;">Pass %</th>
              </tr>
            </thead>
            <tbody>
        `;
        Object.values(subjectAgg).sort((a,b) => b.failed - a.failed).forEach(s => {
          const passPct = s.registered > 0 ? (s.passed / s.registered) * 100 : 0;
          htmlContent += `
            <tr>
              <td><span style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-weight: bold;">${s.code}</span></td>
              <td><strong>${s.name}</strong></td>
              <td style="text-align: center;">${s.registered}</td>
              <td style="text-align: center;">${s.passed}</td>
              <td style="text-align: center;">${s.failed}</td>
              <td style="text-align: center; font-weight: bold; color: ${passPct < 60 ? '#b56559' : '#000000'};">${passPct.toFixed(1)}%</td>
            </tr>
          `;
        });
        htmlContent += `</tbody></table>`;
      }

      // 4. Student performance report
      if (student) {
        const isBreak = (summary || dept || subject) ? " pdf-page-break" : "";
        htmlContent += `
          <div class="pdf-h2${isBreak}">4. Student Performance Report Directory</div>
          <table class="pdf-table">
            <thead>
              <tr>
                <th style="width: 40px; text-align: center;">Rank</th>
                <th>Register No</th>
                <th>Student Name</th>
                <th style="text-align: center;">Branch</th>
                <th style="text-align: center;">Pass / Total</th>
                <th style="text-align: center;">Supplies</th>
                <th style="text-align: center;">SGPA</th>
                <th style="text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
        `;
        const sortedStudents = [...state.students].sort((a, b) => b.sgpa - a.sgpa);
        sortedStudents.forEach(stud => {
          htmlContent += `
            <tr>
              <td style="text-align: center;">${stud.classRank}</td>
              <td><strong>${stud.id}</strong></td>
              <td>${stud.name}</td>
              <td style="text-align: center;">${stud.branch}</td>
              <td style="text-align: center;">${stud.passedCount} / ${stud.totalCount}</td>
              <td style="text-align: center; font-weight: bold; color: ${stud.backlogs > 0 ? '#b56559' : '#64748b'};">${stud.backlogs}</td>
              <td style="text-align: center; font-weight: bold; color: #6b705c;">${stud.sgpa.toFixed(2)}</td>
              <td style="text-align: center; font-weight: bold; color: ${stud.status === 'PASS' ? '#608066' : '#b56559'};">${stud.status === 'PASS' ? 'Full Pass' : 'Supply'}</td>
            </tr>
          `;
        });
        htmlContent += `</tbody></table>`;
      }

      // 5. Backlog Analysis Report
      if (backlog) {
        const isBreak = (summary || dept || subject || student) ? " pdf-page-break" : "";
        const subjectAgg = {};
        state.students.forEach(student => {
          Object.keys(student.grades).forEach(subCode => {
            if (!subjectAgg[subCode]) {
              subjectAgg[subCode] = { code: subCode, name: state.subjects[subCode] || subCode, registered: 0, failed: 0 };
            }
            subjectAgg[subCode].registered++;
            const grade = student.grades[subCode];
            if (['F', 'FE', 'I'].includes(grade)) subjectAgg[subCode].failed++;
          });
        });

        htmlContent += `
          <div class="pdf-h2${isBreak}">5. Backlog / Supply Analysis Report</div>
          <h3 style="font-size: 11px; margin-bottom: 8px; color: #334155;">Top Difficult Subjects (Highest Failure Count)</h3>
          <table class="pdf-table">
            <thead>
              <tr>
                <th>Subject Code</th>
                <th>Subject Name</th>
                <th style="text-align: center;">Failures Count</th>
                <th style="text-align: center;">Failure Rate</th>
              </tr>
            </thead>
            <tbody>
        `;
        Object.values(subjectAgg).sort((a,b) => b.failed - a.failed).filter(s => s.failed > 0).slice(0, 10).forEach(s => {
          htmlContent += `
            <tr>
              <td><span style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-weight: bold;">${s.code}</span></td>
              <td><strong>${s.name}</strong></td>
              <td style="text-align: center; font-weight: bold; color: #b56559;">${s.failed}</td>
              <td style="text-align: center; font-weight: bold; color: #b56559;">${((s.failed / s.registered) * 100).toFixed(1)}%</td>
            </tr>
          `;
        });
        htmlContent += `</tbody></table>`;

        htmlContent += `
          <h3 style="font-size: 11px; margin-top: 20px; margin-bottom: 8px; color: #334155; page-break-before: avoid;">Students with Maximum Backlogs</h3>
          <table class="pdf-table">
            <thead>
              <tr>
                <th>Register No</th>
                <th>Student Name</th>
                <th style="text-align: center;">Branch</th>
                <th style="text-align: center;">Backlogs</th>
                <th>Failed Subject Codes</th>
              </tr>
            </thead>
            <tbody>
        `;
        const backlogStudents = state.students.filter(s => s.backlogs > 0).sort((a,b) => b.backlogs - a.backlogs).slice(0, 15);
        if (backlogStudents.length === 0) {
          htmlContent += `<tr><td colspan="5" style="text-align: center;">No student failures registered. Outstanding performance.</td></tr>`;
        } else {
          backlogStudents.forEach(stud => {
            const failedSubs = Object.keys(stud.grades).filter(code => ['F', 'FE', 'I'].includes(stud.grades[code])).join(', ');
            htmlContent += `
              <tr>
                <td><strong>${stud.id}</strong></td>
                <td>${stud.name}</td>
                <td style="text-align: center;">${stud.branch}</td>
                <td style="text-align: center; font-weight: bold; color: #b56559;">${stud.backlogs}</td>
                <td style="color: #b56559;">${failedSubs}</td>
              </tr>
            `;
          });
        }
        htmlContent += `</tbody></table>`;
      }

      container.innerHTML = htmlContent;

      // Generate PDF from container
      const opt = {
        margin:       [12, 12, 12, 12],
        filename:     'KTU_Result_Analysis_Report.pdf',
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      html2pdf().from(container).set(opt).save().then(() => {
        hideLoading();
        closeExportModal();
      }).catch(err => {
        alert("Error generating PDF: " + err.message);
        hideLoading();
      });
    } catch (err) {
      alert("Failed to generate PDF: " + err.message);
      hideLoading();
    }
  }, 100);
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
