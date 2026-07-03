/**
 * Settings Helper Utilities
 * Load and use system settings configured in the Settings page
 */

// Get all departments
export const getDepartments = () => {
    const saved = localStorage.getItem('quiz_departments');
    return saved ? JSON.parse(saved) : [
        'Computer Science Engg.',
        'Mechanical Engineering',
        'Electrical Engineering',
        'Civil Engineering',
        'Electronics & Communication'
    ];
};

// Get grading scale
export const getGradingScale = () => {
    const saved = localStorage.getItem('quiz_grading_scale');
    return saved ? JSON.parse(saved) : [
        { grade: 'A+', minPercentage: 90, maxPercentage: 100 },
        { grade: 'A', minPercentage: 80, maxPercentage: 89 },
        { grade: 'B+', minPercentage: 70, maxPercentage: 79 },
        { grade: 'B', minPercentage: 60, maxPercentage: 69 },
        { grade: 'C', minPercentage: 50, maxPercentage: 59 },
        { grade: 'D', minPercentage: 40, maxPercentage: 49 },
        { grade: 'F', minPercentage: 0, maxPercentage: 39 }
    ];
};

// Get platform settings
export const getPlatformSettings = () => {
    const saved = localStorage.getItem('quiz_platform_settings');
    return saved ? JSON.parse(saved) : {
        defaultQuizDuration: 30,
        defaultGracePeriod: 5,
        defaultMarksPerQuestion: 1,
        defaultNegativeMarking: 0,
        maxQuestionsPerQuiz: 100,
        minQuestionsPerQuiz: 1,
        allowStudentRetake: false,
        showResultsImmediately: true
    };
};

// Get grade from percentage
export const getGradeFromPercentage = (percentage) => {
    const numeric = Number(percentage);
    if (!Number.isFinite(numeric)) return 'N/A';

    // Match on lower bounds only: a band covers [min, next band's min), so
    // fractional scores from negative marking (e.g. 59.17%) can never fall
    // into a gap between integer-bounded bands like C 50-59 and B 60-69.
    const scale = [...getGradingScale()].sort((a, b) => b.minPercentage - a.minPercentage);
    const match = scale.find((s) => numeric >= s.minPercentage);
    if (match) return match.grade;

    // Below every band (possible with negative marking): lowest grade.
    return scale.length > 0 ? scale[scale.length - 1].grade : 'N/A';
};

// Get letter grade with color
export const getGradeWithColor = (percentage) => {
    const grade = getGradeFromPercentage(percentage);
    
    let color = 'gray';
    if (grade.startsWith('A')) color = 'green';
    else if (grade.startsWith('B')) color = 'blue';
    else if (grade.startsWith('C')) color = 'yellow';
    else if (grade.startsWith('D')) color = 'orange';
    else if (grade === 'F') color = 'red';
    
    return { grade, color };
};

// Validate quiz against platform settings
export const validateQuizSettings = (quizData) => {
    const settings = getPlatformSettings();
    const errors = [];
    
    if (quizData.duration_minutes && quizData.duration_minutes < 1) {
        errors.push('Duration must be at least 1 minute');
    }
    
    if (quizData.questions) {
        const questionCount = quizData.questions.length;
        if (questionCount < settings.minQuestionsPerQuiz) {
            errors.push(`Quiz must have at least ${settings.minQuestionsPerQuiz} question(s)`);
        }
        if (questionCount > settings.maxQuestionsPerQuiz) {
            errors.push(`Quiz cannot have more than ${settings.maxQuestionsPerQuiz} questions`);
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};
