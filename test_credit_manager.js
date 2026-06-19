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
  addEventListener: () => {}
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

// Restore original mocks
global.document.querySelectorAll = originalQuerySelectorAll;
global.document.getElementById = originalGetElementById;

console.log('\nAll tests completed successfully!');
