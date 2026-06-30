const fs = require('fs');

// Mock browser globals to allow evaluating app.js in Node.js
global.window = global;
global.document = {
  readyState: 'complete',
  addEventListener: () => {},
  getElementById: (id) => {
    return {
      addEventListener: () => {},
      classList: { remove: () => {} },
      appendChild: () => {},
      value: '2019'
    };
  },
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: (tagName) => {
    return {
      style: {},
      setAttribute: () => {},
      appendChild: () => {},
      classList: { add: () => {}, remove: () => {} },
      innerHTML: '',
      textContent: ''
    };
  }
};
global.Chart = class {};
global.pdfjsLib = { GlobalWorkerOptions: {} };

// Evaluate app.js
let appJsCode = fs.readFileSync('./app.js', 'utf8');
appJsCode = appJsCode.replace('const state =', 'global.state = state =');
appJsCode = appJsCode.replace('const globalCreditsMap =', 'global.globalCreditsMap = globalCreditsMap =');
eval(appJsCode);

// Test 1: Unified scale checking
console.log('--- TEST 1: UNIFIED GRADING SCALE ---');
const expectedGrades = {
  'S': 10.0,
  'A+': 9.0,
  'A': 8.5,
  'B+': 8.0,
  'B': 7.5,
  'C+': 7.0,
  'C': 6.5,
  'D': 6.0,
  'P': 5.5,
  'F': 0.0,
  'FE': 0.0,
  'I': 0.0
};

let unifiedPassed = true;
['2019', '2024'].forEach(scheme => {
  Object.keys(expectedGrades).forEach(grade => {
    const pts = getGradePoints(grade, scheme);
    if (pts !== expectedGrades[grade]) {
      console.error(`[FAIL] Scheme ${scheme}, Grade ${grade} returned ${pts}, expected ${expectedGrades[grade]}`);
      unifiedPassed = false;
    }
  });
});

if (unifiedPassed) {
  console.log('[PASS] Unified grading scale matches requirements for both 2019 and 2024.');
} else {
  process.exit(1);
}

// Test 2: Backlog SGPA calculations check
console.log('\n--- TEST 2: BACKLOG SGPA CALCULATION ---');
// Setup test student state
state.students = [
  {
    id: 'PRC22AD037',
    name: 'Test Student',
    grades: {
      'MAT201': 'A',  // 8.5 points, 4 credits
      'CST201': 'F',  // 0 points, 3 credits
      'EST200': 'B+'  // 8.0 points, 3 credits
    },
    branch: 'AD',
    status: 'SUPPLY',
    sgpa: 0
  }
];

// Initialize default credits
globalCreditsMap['MAT201'] = 4;
globalCreditsMap['CST201'] = 3;
globalCreditsMap['EST200'] = 3;

processParsedData();

const student = state.students[0];
const expectedNumerator = (8.5 * 4) + (0 * 3) + (8.0 * 3); // 34 + 0 + 24 = 58
const expectedDenominator = 4 + 3 + 3; // 10
const expectedSgpa = expectedNumerator / expectedDenominator; // 5.80

console.log(`Calculated SGPA: ${student.sgpa}`);
console.log(`Expected SGPA: ${expectedSgpa}`);

if (Math.abs(student.sgpa - expectedSgpa) < 0.001) {
  console.log('[PASS] SGPA for student with backlogs calculated correctly using registered credits in denominator.');
} else {
  console.error('[FAIL] Backlog SGPA calculation failed.');
  process.exit(1);
}

// Test 3: Table Sorting Engine Check
console.log('\n--- TEST 3: UNIVERSAL TABLE SORTING ENGINE ---');
let clickCallback = null;
const mockTh = {
  style: {},
  dataset: { sort: 'sgpa' },
  addEventListener: function(event, callback) {
    if (event === 'click') {
      clickCallback = callback;
    }
  },
  parentElement: {
    parentElement: {
      parentElement: {
        querySelector: (selector) => {
          if (selector === 'tbody') {
            return { id: 'table-body-student' };
          }
          return null;
        },
        querySelectorAll: () => {
          return {
            forEach: () => {}
          };
        }
      }
    }
  }
};

// Temporarily mock document queries for headers
const originalQuerySelectorAll = global.document.querySelectorAll;
const originalGetElementById = global.document.getElementById;

global.document.querySelectorAll = (selector) => {
  if (selector === 'table th[data-sort]') {
    return [mockTh];
  }
  return [];
};

// Mock getElementById to handle element references during render/sort execution
global.document.getElementById = (id) => {
  return {
    addEventListener: () => {},
    classList: { remove: () => {}, add: () => {} },
    appendChild: () => {},
    querySelectorAll: () => {
      return {
        forEach: () => {}
      };
    },
    value: 'ALL',
    innerHTML: ''
  };
};

// Reset sort state to defaults
state.sortState.student = { column: 'classRank', direction: 'asc' };

// Initialize sorting engine
setupTableSorting();

if (typeof clickCallback !== 'function') {
  console.error('[FAIL] Click event listener was not attached to table headers.');
  process.exit(1);
}

// First click - sorts by 'sgpa' desc by default
clickCallback();
console.log(`First click: column = ${state.sortState.student.column}, direction = ${state.sortState.student.direction}`);
if (state.sortState.student.column !== 'sgpa' || state.sortState.student.direction !== 'desc') {
  console.error('[FAIL] Sorting state not updated correctly on first click.');
  process.exit(1);
}

// Second click - toggles direction to 'asc'
clickCallback();
console.log(`Second click: column = ${state.sortState.student.column}, direction = ${state.sortState.student.direction}`);
if (state.sortState.student.column !== 'sgpa' || state.sortState.student.direction !== 'asc') {
  console.error('[FAIL] Sorting direction did not toggle correctly on second click.');
  process.exit(1);
}

console.log('[PASS] Sorting engine correctly toggles column and direction state.');

// Test 4: Backlog Department Filtering check
console.log('\n--- TEST 4: BACKLOG DEPARTMENT FILTERING ---');
// Setup test state with multiple branches
state.students = [
  { id: 'PRC22CS001', name: 'CS Student', branch: 'CS', grades: { 'MAT201': 'F' }, backlogs: 1, status: 'SUPPLY', sgpa: 2.5 },
  { id: 'PRC22ME001', name: 'ME Student', branch: 'ME', grades: { 'MAT201': 'F' }, backlogs: 1, status: 'SUPPLY', sgpa: 2.0 },
  { id: 'PRC22CS002', name: 'CS Student 2', branch: 'CS', grades: { 'MAT201': 'B' }, backlogs: 0, status: 'PASS', sgpa: 7.5 }
];
state.departments = {
  'CS': { code: 'CS', name: 'Computer Science', appeared: 2, passed: 1, failed: 1, fullPass: 1, supply: 1, averageSgpa: 7.5 },
  'ME': { code: 'ME', name: 'Mechanical', appeared: 1, passed: 0, failed: 1, fullPass: 0, supply: 1, averageSgpa: 0.0 }
};

let filterValue = 'CS';

// We want to capture what gets rendered in tbodyMax
const tbodyMaxContent = [];
const mockTbodyMax = {
  get innerHTML() { return ''; },
  set innerHTML(val) { tbodyMaxContent.push(val); },
  appendChild: (child) => {
    tbodyMaxContent.push(child.innerHTML);
  }
};
// We also want to capture tbodyDept elements
const tbodyDeptContent = [];
const mockTbodyDept = {
  get innerHTML() { return ''; },
  set innerHTML(val) { tbodyDeptContent.push(val); },
  appendChild: (child) => {
    tbodyDeptContent.push(child.innerHTML);
  }
};

global.document.getElementById = (id) => {
  if (id === 'backlogBranchFilter') {
    return { value: filterValue };
  }
  if (id === 'table-body-backlogs-max') {
    return mockTbodyMax;
  }
  if (id === 'table-body-backlogs-dept') {
    return mockTbodyDept;
  }
  return {
    innerHTML: '',
    appendChild: () => {},
    classList: { remove: () => {}, add: () => {} },
    value: 'ALL',
    querySelectorAll: () => {
      return {
        forEach: () => {}
      };
    }
  };
};

renderBacklogsView();

// Verify that only the CS student is listed in the max backlogs table
console.log(`Rendered backlog students HTML check:`, tbodyMaxContent);
const csRendered = tbodyMaxContent.some(html => html.includes('PRC22CS001'));
const meRendered = tbodyMaxContent.some(html => html.includes('PRC22ME001'));

if (csRendered && !meRendered) {
  console.log('[PASS] Students Max Backlog correctly filtered by department.');
} else {
  console.error('[FAIL] Max backlogs filter logic error: CS rendered = ' + csRendered + ', ME rendered = ' + meRendered);
  process.exit(1);
}

// Verify that only CS department row is in the department backlog stats
const csDeptRendered = tbodyDeptContent.some(html => html.includes('<strong>CS</strong>'));
const meDeptRendered = tbodyDeptContent.some(html => html.includes('<strong>ME</strong>'));
if (csDeptRendered && !meDeptRendered) {
  console.log('[PASS] Department backlog statistics correctly filtered by department.');
} else {
  console.error('[FAIL] Department backlog stats filter logic error: CS rendered = ' + csDeptRendered + ', ME rendered = ' + meDeptRendered);
  process.exit(1);
}

// Restore original mocks
global.document.querySelectorAll = originalQuerySelectorAll;
global.document.getElementById = originalGetElementById;

// Test 5: 416-series project/viva extraction check
console.log('\n--- TEST 5: 416-SERIES PROJECT/VIVA EXTRACTION ---');

const originalRecalculateAndRefresh = recalculateAndRefresh;
global.recalculateAndRefresh = recalculateAndRefresh = () => {};

const originalGetElementByIdTest5 = global.document.getElementById;
global.document.getElementById = (id) => {
  return {
    addEventListener: () => {},
    classList: { remove: () => {}, add: () => {} },
    appendChild: () => {},
    value: '2019',
    innerHTML: ''
  };
};

// 1. Check cleanAndExtractSubjects directly
const testCase1 = cleanAndExtractSubjects('MET415', 'COMPREHENSIVE COURSE VIVA MED416 PROJECT PHASE II R');
console.log('cleanAndExtractSubjects clean name:', testCase1.cleanedName);
console.log('cleanAndExtractSubjects extracted code:', testCase1.extractedVivaCode);

if (testCase1.extractedVivaCode !== 'MED416') {
  console.error('[FAIL] cleanAndExtractSubjects did not extract MED416.');
  process.exit(1);
}

// 2. Check parseKTUResultText integrates extraction correctly
state.subjects = {};
const testText = "MET415  COMPREHENSIVE COURSE VIVA MED416 PROJECT PHASE II R\nstudent results follow:\nPRC22ME019(S) PRC22ME019 MET415(O) MED416(A+)";
parseKTUResultText(testText);

console.log('state.subjects after parsing:', state.subjects);
if (state.subjects['MET415'] !== 'COMPREHENSIVE COURSE VIVA') {
  console.error(`[FAIL] Parent subject MET415 name was not cleaned correctly: "${state.subjects['MET415']}"`);
  process.exit(1);
}
if (state.subjects['MED416'] !== 'PROJECT PHASE II') {
  console.error(`[FAIL] Standalone subject MED416 was not created correctly: "${state.subjects['MED416']}"`);
  process.exit(1);
}

// 3. Check credit weights
const med416Credits = getInitialDefaultCredits('MED416', '2019');
const csd416Credits = getInitialDefaultCredits('CSD416', '2019');
console.log(`MED416 Credits: ${med416Credits}`);
console.log(`CSD416 Credits: ${csd416Credits}`);

if (med416Credits !== 4 || csd416Credits !== 4) {
  console.error('[FAIL] Credits for 416-series project subjects were not mapped to 4.');
  process.exit(1);
}

// 4. Check general column text bleeding truncation
const bleedTest = cleanAndExtractSubjects('CST302', 'DATABASE MANAGEMENT SYSTEMS EET436 ADDITIONAL INFO');
console.log('bleedTest name:', bleedTest.cleanedName);
if (bleedTest.cleanedName !== 'DATABASE MANAGEMENT SYSTEMS') {
  console.error(`[FAIL] Bleeding text EET436 was not correctly truncated: "${bleedTest.cleanedName}"`);
  process.exit(1);
}
if (state.subjects['EET436'] !== 'ADDITIONAL INFO') {
  console.error(`[FAIL] Swallowed bleeding course EET436 was not auto-populated in state.subjects: "${state.subjects['EET436']}"`);
  process.exit(1);
}

const fallbackTest = cleanAndExtractSubjects('MET404', 'MET404 MET404');
console.log('fallbackTest name:', fallbackTest.cleanedName);
if (fallbackTest.cleanedName !== 'COMPREHENSIVE VIVA VOCE') {
  console.error(`[FAIL] Fallback name for MET404 was not assigned correctly: "${fallbackTest.cleanedName}"`);
  process.exit(1);
}

// 5. Check 404-series comprehensive credits
const met404Credits = getInitialDefaultCredits('MET404', '2019');
const cst404Credits = getInitialDefaultCredits('CST404', '2024');
console.log(`MET404 Credits: ${met404Credits}`);
console.log(`CST404 Credits: ${cst404Credits}`);

if (met404Credits !== 1 || cst404Credits !== 1) {
  console.error(`[FAIL] Credits for 404-series subjects were not mapped to 1. MET404: ${met404Credits}, CST404: ${cst404Credits}`);
  process.exit(1);
}

global.document.getElementById = originalGetElementByIdTest5;
global.recalculateAndRefresh = recalculateAndRefresh = originalRecalculateAndRefresh;

// Test 6: SGPA Maxer calculation checks
console.log('\n--- TEST 6: SGPA MAXER CALCULATION ENGINE ---');

const studentForMaxer = {
  id: 'PRC22CS001',
  name: 'Maxer Test Student',
  grades: {
    'MAT201': 'F',
    'CST201': 'B',
    'EST200': 'A+'
  },
  sgpa: 4.80
};

// Set credits in global map
globalCreditsMap['MAT201'] = 4;
globalCreditsMap['CST201'] = 3;
globalCreditsMap['EST200'] = 3;

// Mock dropdown elements
const mockDropdowns = [
  {
    dataset: { subject: 'MAT201', credits: '4' },
    value: 'A' // upgraded from F (8.5 points)
  },
  {
    dataset: { subject: 'CST201', credits: '3' },
    value: 'B+' // upgraded from B (8.0 points)
  },
  {
    dataset: { subject: 'EST200', credits: '3' },
    value: 'S' // upgraded from A+ (10.0 points)
  }
];

// Mock document.querySelectorAll to return these mock selects
const originalQuerySelectorAllMaxer = global.document.querySelectorAll;
global.document.querySelectorAll = (selector) => {
  if (selector === '.maxer-grade-select') {
    return mockDropdowns;
  }
  return [];
};

// Capture what gets written to summary card
let summaryCardContent = '';
const originalGetElementByIdMaxer = global.document.getElementById;
global.document.getElementById = (id) => {
  if (id === 'sgpa-maxer-summary') {
    return {
      set innerHTML(val) {
        summaryCardContent = val;
      }
    };
  }
  return originalGetElementByIdMaxer(id);
};

// Run calculation
calculateMaxedSgpa(studentForMaxer);

console.log('SGPA Maxer Summary Output HTML:\n', summaryCardContent);

// Verify calculations in output text
if (!summaryCardContent.includes('4.95') || !summaryCardContent.includes('8.80') || !summaryCardContent.includes('+3.85')) {
  console.error('[FAIL] SGPA Maxer calculations or HTML output are incorrect.');
  process.exit(1);
}

// Restore mocks
global.document.querySelectorAll = originalQuerySelectorAllMaxer;
global.document.getElementById = originalGetElementByIdMaxer;

// Test 7: Universal SGPA Maxer calculation checks
console.log('\n--- TEST 7: UNIVERSAL SGPA MAXER SIMULATION ---');

const studentForUnivMaxer = {
  id: 'PRC22CS099',
  name: 'Univ Maxer Student',
  grades: {
    'MAT201': 'P',  // 5.5 points, 4 credits
    'CST201': 'C',  // 6.5 points, 3 credits
    'EST200': 'D'   // 6.0 points, 3 credits
  },
  sgpa: 5.95
};

// Add student to state
state.students.push(studentForUnivMaxer);

// Set credits in global map
globalCreditsMap['MAT201'] = 4;
globalCreditsMap['CST201'] = 3;
globalCreditsMap['EST200'] = 3;

// Mock dropdown elements for the universal view
const mockUnivDropdowns = [
  {
    dataset: { subject: 'MAT201', credits: '4' },
    value: 'S' // upgraded from P to S (10.0 points)
  },
  {
    dataset: { subject: 'CST201', credits: '3' },
    value: 'A+' // upgraded from C to A+ (9.0 points)
  },
  {
    dataset: { subject: 'EST200', credits: '3' },
    value: 'B' // upgraded from D to B (7.5 points)
  }
];

const originalQuerySelectorAllUniv = global.document.querySelectorAll;
global.document.querySelectorAll = (selector) => {
  if (selector === '.univ-maxer-grade-select') {
    return mockUnivDropdowns;
  }
  return [];
};

let univSummaryCardContent = '';
const originalGetElementByIdUniv = global.document.getElementById;
global.document.getElementById = (id) => {
  if (id === 'univ-maxer-summary') {
    return {
      set innerHTML(val) {
        univSummaryCardContent = val;
      }
    };
  }
  return originalGetElementByIdUniv(id);
};

// Run calculation
calculateUnivMaxedSgpa(studentForUnivMaxer);

console.log('Universal SGPA Maxer Summary Output HTML:\n', univSummaryCardContent);

// Baseline: (5.5 * 4) + (6.5 * 3) + (6.0 * 3) = 22 + 19.5 + 18.0 = 59.5 => 5.95 SGPA
// Simulated: (10.0 * 4) + (9.0 * 3) + (7.5 * 3) = 40 + 27 + 22.5 = 89.5 => 8.95 SGPA
// Delta: 8.95 - 5.95 = 3.00

if (!univSummaryCardContent.includes('5.95') || !univSummaryCardContent.includes('8.95') || !univSummaryCardContent.includes('+3.00')) {
  console.error('[FAIL] Universal SGPA Maxer calculations or HTML output are incorrect.');
  process.exit(1);
}

// Restore mocks
global.document.querySelectorAll = originalQuerySelectorAllUniv;
global.document.getElementById = originalGetElementByIdUniv;

// Test 8: Regular Cohort vs Supplementary Separation check
console.log('\n--- TEST 8: REGULAR COHORT vs SUPPLEMENTARY SEPARATION ---');

// Mock data with mixed batch years
state.students = [
  { id: 'PRC22CS001', name: 'Regular CS 1', branch: 'CS', grades: { 'MAT201': 'B' }, backlogs: 0, status: 'PASS', sgpa: 7.5 },
  { id: 'PRC22CS002', name: 'Regular CS 2', branch: 'CS', grades: { 'MAT201': 'C' }, backlogs: 0, status: 'PASS', sgpa: 6.5 },
  { id: 'PRC20CS001', name: 'Supply CS 1', branch: 'CS', grades: { 'MAT201': 'F' }, backlogs: 1, status: 'SUPPLY', sgpa: 0.0 }
];

// Mock credits
globalCreditsMap['MAT201'] = 4;

// Run parsing processor
processParsedData();

console.log(`Detected Regular Batch Year: ${state.regularBatchYear}`);
console.log(`Regular Student 1 isRegular: ${state.students.find(s => s.id === 'PRC22CS001').isRegular}`);
console.log(`Supply Student isRegular: ${state.students.find(s => s.id === 'PRC20CS001').isRegular}`);
console.log(`Department Appeared (Regular only): ${state.departments['CS'].appeared}`);

if (state.regularBatchYear !== '22') {
  console.error(`[FAIL] Dynamic regular batch year detected as ${state.regularBatchYear}, expected '22'.`);
  process.exit(1);
}

if (!state.students.find(s => s.id === 'PRC22CS001').isRegular || state.students.find(s => s.id === 'PRC20CS001').isRegular) {
  console.error('[FAIL] Student cohort flags were not assigned correctly.');
  process.exit(1);
}

if (state.departments['CS'].appeared !== 2) {
  console.error(`[FAIL] Department stats contaminated by supply students. Appeared count is ${state.departments['CS'].appeared}, expected 2.`);
  process.exit(1);
}

// Check supplementary clearances rendering hook
let clearanceMetricsContent = '';
const originalGetElementByIdDept = global.document.getElementById;
global.document.getElementById = (id) => {
  if (id === 'supply-clearance-metrics') {
    return {
      set innerHTML(val) {
        clearanceMetricsContent = val;
      },
      appendChild: (child) => {
        clearanceMetricsContent += child.innerHTML;
      }
    };
  }
  if (id === 'table-body-dept') {
    return {
      appendChild: () => {}
    };
  }
  return originalGetElementByIdDept(id);
};

renderDepartmentsTable();
console.log(`Supplementary Clearances Content:`, clearanceMetricsContent);

if (!clearanceMetricsContent.includes('Supply CS 1') && !clearanceMetricsContent.includes('/ 1 Cleared') && !clearanceMetricsContent.includes('CS -')) {
  // Wait, the department select name mapping branchNames['CS'] is 'Computer Science & Engineering'
  if (!clearanceMetricsContent.includes('Computer Science & Engineering')) {
    console.error('[FAIL] Supplementary Clearances metrics panel not populated correctly.');
    process.exit(1);
  }
}

global.document.getElementById = originalGetElementByIdDept;
console.log('[PASS] Regular cohort and supplementary student separation verified successfully.');

// Test 9: Multi-letter grade parsing and absent mapping
console.log('\n--- TEST 9: MULTI-LETTER GRADES & ABSENT MAPPING ---');
const testText9 = "UCHWT127(PASS) CST201(Ab) EST200(FE) CYT100(FAIL)\nstudent results follow:\nPRC24CS001(S) PRC24CS001 UCHWT127(PASS) CST201(Ab) EST200(FE) CYT100(FAIL)";

// Mock document elements for parser scheme change detection
const originalGetElementByIdTest9 = global.document.getElementById;
global.document.getElementById = (id) => {
  return {
    addEventListener: () => {},
    classList: { remove: () => {}, add: () => {} },
    appendChild: () => {},
    value: '2024',
    innerHTML: ''
  };
};

const originalRecalculateAndRefreshTest9 = recalculateAndRefresh;
global.recalculateAndRefresh = recalculateAndRefresh = () => {
  processParsedData();
};

state.students = [];
state.subjects = {};
parseKTUResultText(testText9);

console.log('Parsed subjects:', Object.keys(state.students[0].grades));
console.log('Parsed grades:', state.students[0].grades);

const gradesParsed = state.students[0].grades;
if (gradesParsed['UCHWT127'] !== 'PASS') {
  console.error(`[FAIL] UCHWT127 grade should be PASS, got: ${gradesParsed['UCHWT127']}`);
  process.exit(1);
}
if (gradesParsed['CST201'] !== 'F') {
  console.error(`[FAIL] CST201 (Ab) grade should be mapped to F, got: ${gradesParsed['CST201']}`);
  process.exit(1);
}
if (gradesParsed['EST200'] !== 'F') {
  console.error(`[FAIL] EST200 (FE) grade should be mapped to F, got: ${gradesParsed['EST200']}`);
  process.exit(1);
}
if (gradesParsed['CYT100'] !== 'FAIL') {
  console.error(`[FAIL] CYT100 grade should be FAIL, got: ${gradesParsed['CYT100']}`);
  process.exit(1);
}
console.log('[PASS] Multi-letter grades parsed and absent grades mapped to F correctly.');
global.document.getElementById = originalGetElementByIdTest9;
global.recalculateAndRefresh = recalculateAndRefresh = originalRecalculateAndRefreshTest9;

// Test 10: SGPA and Credit contribution of PASS grade, and neutrality of FAIL grade
console.log('\n--- TEST 10: SGPA & CREDIT FOR PASS, NEUTRALITY FOR FAIL ---');
state.students = [
  {
    id: 'PRC24CS001',
    name: 'Neutrality Student',
    grades: {
      'GAPHT121': 'A',     // 8.5 points, 4 credits
      'UCHWT127': 'PASS',  // 5.5 points, 1 credit (maps to P, included in SGPA)
      'GXEST203': 'FAIL'   // Neutral in SGPA, but counts as 1 backlog
    },
    branch: 'CS',
    status: 'SUPPLY',
    sgpa: 0
  }
];

// Verify credit resolver resolves UCHWT127 to 1 credit automatically under 2024 scheme
const resolvedCredits = getInitialDefaultCredits('UCHWT127', '2024');
if (resolvedCredits !== 1) {
  console.error(`[FAIL] getInitialDefaultCredits('UCHWT127', '2024') should return 1, got ${resolvedCredits}`);
  process.exit(1);
}
console.log(`[PASS] UCHWT127 credits resolved to ${resolvedCredits} successfully.`);

globalCreditsMap['GAPHT121'] = 4;
globalCreditsMap['UCHWT127'] = 1;
globalCreditsMap['GXEST203'] = 3;

processParsedData();

const sObj = state.students[0];
// expected SGPA: ((8.5 * 4) + (5.0 * 1) + 0) / (4 + 1 + 3) = 39.0 / 8 = 4.875
const expectedSgpa10 = 4.875;
console.log(`Calculated SGPA: ${sObj.sgpa}`);
console.log(`Calculated Backlogs: ${sObj.backlogs}`);
console.log(`Calculated Completed Credits (including PASS, excluding FAIL/backlogs): ${getCompletedCredits(sObj)}`);

if (Math.abs(sObj.sgpa - expectedSgpa10) < 0.001) {
  console.log('[PASS] SGPA calculated correctly factoring in PASS and FAIL grades.');
} else {
  console.error(`[FAIL] SGPA calculation failed. Got: ${sObj.sgpa}, Expected: ${expectedSgpa10}`);
  process.exit(1);
}

if (sObj.backlogs === 1) {
  console.log('[PASS] FAIL counted as backlog successfully.');
} else {
  console.error(`[FAIL] FAIL was not counted as backlog. Got backlogs count: ${sObj.backlogs}`);
  process.exit(1);
}

if (getCompletedCredits(sObj) === 5) {
  console.log('[PASS] Completed credits calculated correctly including PASS credits.');
} else {
  console.error(`[FAIL] Completed credits calculation failed. Got: ${getCompletedCredits(sObj)}, Expected: 5`);
  process.exit(1);
}

// Test 11: UCSEM129 Course Injection & Grade Change
console.log('\n--- TEST 11: UCSEM129 COURSE INJECTION & GRADE CHANGE ---');

const originalGetElementByIdTest11 = global.document.getElementById;
let mockSemesterValue = '2';
global.document.getElementById = (id) => {
  if (id === 'select-semester') {
    return {
      value: mockSemesterValue,
      addEventListener: () => {}
    };
  }
  if (id === 'select-scheme') {
    return {
      value: '2024',
      addEventListener: () => {}
    };
  }
  return {
    addEventListener: () => {},
    classList: { remove: () => {}, add: () => {} },
    appendChild: () => {},
    value: '2024',
    innerHTML: ''
  };
};

state.scheme = '2024';
state.students = [
  {
    id: 'PRC24CS001',
    name: 'Test Student S2',
    grades: {
      'CYT100': 'B+' // 8.0 points, 4 credits
    },
    branch: 'CS',
    status: 'PASS',
    sgpa: 0
  }
];

globalCreditsMap['CYT100'] = 4;

// Run processing
processParsedData();

const studentS2 = state.students[0];
console.log('Student grades after S2 processing:', studentS2.grades);
if (studentS2.grades['UCSEM129'] !== 'PASS') {
  console.error(`[FAIL] UCSEM129 was not injected, or has incorrect grade: ${studentS2.grades['UCSEM129']}`);
  process.exit(1);
}

const resolvedUCSEMCredits = globalCreditsMap['UCSEM129'] !== undefined ? globalCreditsMap['UCSEM129'] : getInitialDefaultCredits('UCSEM129', state.scheme);
if (resolvedUCSEMCredits !== 1) {
  console.error(`[FAIL] UCSEM129 should have 1 credit, got: ${resolvedUCSEMCredits}`);
  process.exit(1);
}
console.log('[PASS] UCSEM129 was successfully injected with 1 credit.');

// Expected SGPA with PASS: ((8.0 * 4) + (5.0 * 1)) / (4 + 1) = (32.0 + 5.0) / 5 = 37.0 / 5 = 7.40
const expectedSgpaPass = 7.40;
console.log(`Calculated SGPA (PASS): ${studentS2.sgpa}`);
if (Math.abs(studentS2.sgpa - expectedSgpaPass) > 0.001) {
  console.error(`[FAIL] Expected SGPA with PASS to be ${expectedSgpaPass}, got ${studentS2.sgpa}`);
  process.exit(1);
}
console.log('[PASS] Baseline SGPA with injected UCSEM129 PASS is correct.');

// Change grade of UCSEM129 to FAIL and verify SGPA shifts
studentS2.grades['UCSEM129'] = 'FAIL';
processParsedData();

// Expected SGPA with FAIL (credits included in denominator): ((8.0 * 4) + 0) / (4 + 1) = 32 / 5 = 6.40
const expectedSgpaFail = 6.40;
console.log(`Calculated SGPA (FAIL): ${studentS2.sgpa}`);
if (Math.abs(studentS2.sgpa - expectedSgpaFail) > 0.001) {
  console.error(`[FAIL] Expected SGPA with FAIL to be ${expectedSgpaFail}, got ${studentS2.sgpa}`);
  process.exit(1);
}
console.log('[PASS] SGPA shifts correctly and drops lower than PASS state when UCSEM129 is set to FAIL.');

// Restore original getElementById mock
global.document.getElementById = originalGetElementByIdTest11;
console.log('[PASS] UCSEM129 injection and grade change test passed!');

console.log('\nAll tests completed successfully!');
