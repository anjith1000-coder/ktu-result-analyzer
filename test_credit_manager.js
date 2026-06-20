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

console.log('[PASS] SGPA Maxer revaluation simulations and dynamic calculations verified successfully.');

console.log('\nAll tests completed successfully!');
