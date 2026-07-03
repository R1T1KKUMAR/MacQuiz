import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { userAPI, quizAPI, attemptAPI, analyticsAPI } from "../services/api";
import { getDepartments, getGradeFromPercentage } from "../utils/settingsHelper";
import BulkUploadModal from "../components/BulkUploadModal";
import BulkQuizUploadModal from "../components/BulkQuizUploadModal";
import QuizAssignmentModal from "../components/QuizAssignmentModal";
import QuizCreator from "./QuizCreator";
import sdcLogo from "../assets/sdc-logo.png";
import {
    LayoutDashboard, Users, Zap, FileText, Settings, LogOut, CheckCircle, Clock,
    TrendingUp, TrendingDown, ClipboardList, BarChart3, Search, Plus, X, List, Save, UserCheck, Calendar, Upload,
    Eye, EyeOff, RefreshCw, Key, ShieldCheck, AlertTriangle, AlertCircle, GraduationCap, XCircle, Trophy, Download, FileSpreadsheet, Code2, Award, ChevronDown, Copy
} from 'lucide-react';

// No mock data needed - all data fetched from API

/**
 * --- UTILITY FUNCTIONS ---
 */

// Password strength validator
const validatePasswordStrength = (password) => {
    const checks = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        // eslint-disable-next-line no-useless-escape
        special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
    };

    const score = Object.values(checks).filter(Boolean).length;
    
    let strength = 'weak';
    let color = 'bg-red-500';
    
    if (score >= 5) {
        strength = 'strong';
        color = 'bg-green-500';
    } else if (score >= 3) {
        strength = 'medium';
        color = 'bg-yellow-500';
    }

    return { checks, score, strength, color };
};

// Strong password generator
const generateStrongPassword = () => {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*_-+=';
    
    const allChars = uppercase + lowercase + numbers + special;
    
    // Ensure at least one of each type
    let password = '';
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += special[Math.floor(Math.random() * special.length)];
    
    // Fill remaining characters (total length 12)
    for (let i = password.length; i < 12; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
};

// Email domain validator
const validateEmailDomain = (email) => {
    const allowedDomains = ['gmail.com', 'rbmi.in', 'yahoo.com', 'outlook.com', 'hotmail.com'];
    const domain = email.split('@')[1]?.toLowerCase();
    return allowedDomains.includes(domain);
};

const getDisplayUserId = (user) => {
    if (!user) return 'N/A';
    if (user.role === 'student') return user.student_id || `STU-${user.id ?? 'N/A'}`;
    if (user.role === 'teacher') {
        if (user.student_id) return user.student_id;
        const numericId = Number(user.id);
        return Number.isFinite(numericId)
            ? `RBMI-T-${String(numericId).padStart(4, '0')}`
            : 'RBMI-T-0000';
    }
    return `ADM-${user.id ?? 'N/A'}`;
};


/**
 * --- UTILITY COMPONENTS ---
 */

// Stat Card component for key metrics
const StatCard = ({ title, value, icon: StatIcon, color, trend, subtitle }) => { // Icon renamed to StatIcon to fix ESLint error
    // If trend is N/A, we prevent showing red/green colours
    const trendColor = trend === 'N/A' ? 'text-gray-500' : (trend.includes('-') ? 'text-red-600' : 'text-green-600');
    return (
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 transition duration-300 hover:shadow-xl">
            <div className="flex items-center justify-between">
                <div className={`p-3 rounded-full ${color}`}>
                    <StatIcon size={24} />
                </div>
                <div className="text-sm font-medium text-gray-500">{title}</div>
            </div>
            <div className="mt-4 flex items-end justify-between">
                <div className="text-4xl font-bold text-gray-900">{value}</div>
                <div className={`flex items-center text-sm font-semibold ${trendColor}`}>
                    {trend}
                </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">{subtitle}</p>
        </div>
    );
};

// Activity Feed Item
const ActivityItem = ({ user, action, time, status }) => {
    const statusColor = status === 'success' ? 'text-green-500' : status === 'error' ? 'text-red-500' : 'text-blue-500'; // Reverted to blue accent
    const StatusIcon = status === 'success' ? CheckCircle : ClipboardList;

    return (
        <div className="flex items-center justify-between p-4 border-b last:border-b-0 hover:bg-gray-50 rounded-lg transition">
            <div className="flex items-center space-x-3">
                <StatusIcon size={20} className={statusColor} />
                <div>
                    <p className="font-semibold text-gray-800">{user}</p>
                    <p className="text-sm text-gray-600">{action}</p>
                </div>
            </div>
            <div className="text-xs text-gray-500 flex items-center">
                <Clock size={14} className="mr-1" />
                {time}
            </div>
        </div>
    );
};

class TabErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, errorMessage: '' };
    }

    static getDerivedStateFromError(error) {
        return {
            hasError: true,
            errorMessage: error?.message || 'Unexpected error'
        };
    }

    componentDidCatch(error, errorInfo) {
        console.error('Tab render error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="bg-white rounded-2xl shadow-lg border border-red-100 p-6">
                    <h3 className="text-lg font-bold text-red-700 mb-2">Unable to load this section</h3>
                    <p className="text-sm text-red-600 mb-4">{this.state.errorMessage}</p>
                    <button
                        onClick={() => this.setState({ hasError: false, errorMessage: '' })}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition"
                    >
                        Retry
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

// Card: Quick link for Admin to add new user (Teacher or Student)
const AddNewUserCard = ({ onAddClick }) => (
    // REMOVED: hover:shadow-2xl transition duration-300 transform hover:scale-[1.01]
    <div className="bg-blue-600/90 text-white p-6 rounded-2xl shadow-xl border border-blue-700 cursor-pointer" onClick={onAddClick}>
        <div className="flex items-center justify-between">
            <div>
                <h3 className="text-xl font-bold">New User Provisioning</h3>
                <p className="text-blue-200 text-sm mt-1">Quickly onboard new teachers or students.</p>
            </div>
        </div>
        {/* Reverted Button text color to blue */}
        <div className="mt-5 w-full bg-white text-blue-800 py-3 rounded-xl text-center font-semibold transition shadow-lg text-lg">
            Add Teacher / Student
        </div>
    </div>
);

const SdcTeamSection = () => {
    const backendTeam = [
        'Ritik Kumar',
        'Devang Pathak',
        'Vivek Sharma',
        'Vighnesh Shukla'
    ];

    const frontendTeam = [
        'Dakshita Tiwari',
        'Anjali Tiwari',
        'Rohit',
        'Satyam Diwaker'
    ];

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Software Development Cell (SDC)</h2>
                <p className="text-gray-600">MacQuiz Development Team (Student Contributors)</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                        <Code2 size={20} className="mr-2 text-blue-600" />
                        Backend Team
                    </h3>
                    <ul className="space-y-2">
                        {backendTeam.map((name) => (
                            <li key={name} className="px-3 py-2 rounded-lg bg-blue-50 text-gray-800 font-medium">
                                {name}
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                        <Code2 size={20} className="mr-2 text-indigo-600" />
                        Frontend Team
                    </h3>
                    <ul className="space-y-2">
                        {frontendTeam.map((name) => (
                            <li key={name} className="px-3 py-2 rounded-lg bg-indigo-50 text-gray-800 font-medium">
                                {name}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Tech Stack Used</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
                        <p className="text-sm text-gray-600 mb-1">Backend</p>
                        <p className="text-lg font-semibold text-gray-900">FastAPI</p>
                    </div>
                    <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100">
                        <p className="text-sm text-gray-600 mb-1">Frontend</p>
                        <p className="text-lg font-semibold text-gray-900">React</p>
                    </div>
                    <div className="p-4 rounded-xl bg-green-50 border border-green-100">
                        <p className="text-sm text-gray-600 mb-1">Database</p>
                        <p className="text-lg font-semibold text-gray-900">MySQL/Postgres</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

// New Component: Form for creating new users
const UserCreationForm = ({ onCancel, onUserCreated, currentUserRole }) => {
    const { success, error} = useToast();
    const [formData, setFormData] = useState({
        role: 'student', // Default role (lowercase for API)
        first_name: '',
        last_name: '',
        email: '',
        password: '',
        phone_number: '', // New phone number field
        student_id: '', // Used for student roll no. and teacher ID
        department: '',
        class_year: '1st Year'
    });
    const [showBulkUpload, setShowBulkUpload] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState(null);
    const [emailError, setEmailError] = useState('');
    const [showDomainDropdown, setShowDomainDropdown] = useState(false);
    const [emailUsername, setEmailUsername] = useState('');
    const allowedDomains = ['gmail.com', 'rbmi.in', 'yahoo.com', 'outlook.com', 'hotmail.com'];

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });

        // Validate password strength on change
        if (name === 'password') {
            if (value.length > 0) {
                setPasswordStrength(validatePasswordStrength(value));
            } else {
                setPasswordStrength(null);
            }
        }

        // Handle email input with domain dropdown
        if (name === 'email') {
            if (value.includes('@')) {
                const parts = value.split('@');
                setEmailUsername(parts[0]);
                setShowDomainDropdown(false);
                
                if (!validateEmailDomain(value)) {
                    setEmailError('Please use a valid email domain (gmail.com, rbmi.in, yahoo.com, outlook.com, hotmail.com)');
                } else {
                    setEmailError('');
                }
            } else {
                setEmailUsername(value);
                setShowDomainDropdown(value.length > 0);
                setEmailError('');
            }
        }
    };

    const handleDomainSelect = (domain) => {
        setFormData({ ...formData, email: `${emailUsername}@${domain}` });
        setShowDomainDropdown(false);
        setEmailError('');
    };

    const handleGeneratePassword = () => {
        const newPassword = generateStrongPassword();
        setFormData({ ...formData, password: newPassword });
        setPasswordStrength(validatePasswordStrength(newPassword));
        success('Strong password generated! Make sure to copy it.');
    };

    const handleCopyPassword = async () => {
        if (!formData.password) {
            error('Enter or generate a password first.');
            return;
        }

        try {
            await navigator.clipboard.writeText(formData.password);
            success('Password copied to clipboard.');
        } catch (_err) {
            error('Unable to copy password. Please copy it manually.');
        }
    };

    const handleBulkUploadSuccess = (result) => {
        success(`Successfully created ${result.created_count} users!`);
        
        if (result.error_count > 0) {
            console.error("Upload errors:", result.errors);
            error(`${result.error_count} rows had errors. Check console for details.`);
        }

        if (onUserCreated) {
            onUserCreated(result);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Validate email domain before submission
        if (!validateEmailDomain(formData.email)) {
            error('Please use a valid email domain (gmail.com, rbmi.in, yahoo.com, outlook.com, hotmail.com)');
            return;
        }

        // Validate password strength
        if (passwordStrength && passwordStrength.score < 3) {
            error('Password is too weak. Please use a stronger password or generate one.');
            return;
        }

        setIsSubmitting(true);

        try {
            const userData = {
                email: formData.email,
                password: formData.password,
                first_name: formData.first_name,
                last_name: formData.last_name,
                role: formData.role.toLowerCase(),
                department: formData.department,
                class_year: formData.class_year,
                phone_number: formData.phone_number || null, // Add phone number
            };

            // Add identifier for students and teachers
            if (['student', 'teacher'].includes(formData.role.toLowerCase())) {
                userData.student_id = formData.student_id;
            }

            const response = await userAPI.createUser(userData);
            
            success(`User ${response.first_name} ${response.last_name} created successfully!`);
            
            // Reset form
            setFormData({
                role: 'student',
                first_name: '',
                last_name: '',
                email: '',
                password: '',
                phone_number: '',
                student_id: '',
                department: '',
                class_year: '1st Year'
            });

            if (onUserCreated) {
                onUserCreated(response);
            }

            // Close form after 1 second
            setTimeout(() => {
                onCancel();
            }, 1000);
            
        } catch (err) {
            if (err.status === 400) {
                error(err.data?.detail || "Email or User ID already exists!");
            } else if (err.status === 401 || err.status === 403) {
                error("You don't have permission to create users. Please login as admin.");
            } else {
                error(err.message || "Failed to create user. Please try again.");
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl shadow-xl border border-gray-100">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b pb-4 mb-6">
                <h2 className="text-2xl font-bold text-gray-800">Provision New User Account</h2>
                <button onClick={onCancel} className="text-gray-400 hover:text-red-600 transition">
                    <X size={24} />
                </button>
            </div>

            {/* Bulk Upload Modal */}
            <BulkUploadModal 
                isOpen={showBulkUpload}
                onClose={() => setShowBulkUpload(false)}
                onSuccess={handleBulkUploadSuccess}
            />

            {/* Bulk Upload Button - Admin Only */}
            {currentUserRole === 'admin' && (
                <>
                    <div className="border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 sm:p-6 rounded-xl mb-8">
                        <div className="flex flex-col lg:flex-row items-start justify-between gap-4">
                            <div className="flex items-start space-x-3">
                                <Upload size={24} className="text-blue-600 mt-1" />
                                <div>
                                    <h3 className="text-lg font-bold text-gray-800 mb-2">
                                        Bulk User Upload
                                    </h3>
                                    <p className="text-sm text-gray-600 mb-3">
                                        Upload a CSV file to add multiple users at once. Preview data, detect duplicates, and validate before importing.
                                    </p>
                                    <ul className="text-xs text-gray-500 space-y-1">
                                        <li>• Real-time validation and duplicate detection</li>
                                        <li>• Preview imported data before uploading</li>
                                        <li>• Automatic error reporting with line numbers</li>
                                    </ul>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowBulkUpload(true)}
                                disabled={isSubmitting}
                                className="w-full lg:w-auto justify-center flex items-center px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-lg whitespace-nowrap disabled:opacity-50"
                            >
                                <Upload size={20} className="mr-2" />
                                Bulk Upload
                            </button>
                        </div>
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Or, Add Single User Manually</h3>
                </>
            )}
            
            {currentUserRole === 'teacher' && (
                <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Add New Student</h3>
            )}

            <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off">
                {/* User Role Selector - Admin Only */}
                {currentUserRole === 'admin' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">User Role</label>
                        <select 
                            name="role" 
                            value={formData.role} 
                            onChange={handleInputChange} 
                            required 
                            disabled={isSubmitting}
                            className="w-full p-3 border border-gray-300 rounded-lg bg-blue-50 ring-2 ring-blue-500 font-semibold disabled:bg-gray-100"
                        >
                            <option value="teacher">Teacher / Professor</option>
                            <option value="admin">Admin</option>
                            <option value="student">Student</option>
                        </select>
                    </div>
                )}

                {/* User ID field (shown first for students/teachers) */}
                {(formData.role === 'student' || formData.role === 'teacher') && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            {formData.role === 'student' ? 'Roll No. / Student ID (Required)' : 'Teacher ID (Required)'}
                        </label>
                        <input 
                            type="text" 
                            name="student_id" 
                            value={formData.student_id} 
                            onChange={handleInputChange} 
                            required={formData.role === 'student' || formData.role === 'teacher'} 
                            disabled={isSubmitting}
                            autoComplete="off"
                            placeholder={formData.role === 'student' ? 'e.g., CS2024001' : 'e.g., TCH001'}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100" 
                        />
                    </div>
                )}

                {/* Grid for main details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                        <input 
                            type="text" 
                            name="first_name" 
                            value={formData.first_name} 
                            onChange={handleInputChange} 
                            required 
                            disabled={isSubmitting}
                            autoComplete="off"
                            placeholder="Enter first name"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100" 
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                        <input 
                            type="text" 
                            name="last_name" 
                            value={formData.last_name} 
                            onChange={handleInputChange} 
                            required 
                            disabled={isSubmitting}
                            autoComplete="off"
                            placeholder="Enter last name"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100" 
                        />
                    </div>
                    <div className="col-span-1 md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Email (Login ID) <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                            <input 
                                type="email" 
                                name="email" 
                                value={formData.email} 
                                onChange={handleInputChange} 
                                required 
                                disabled={isSubmitting}
                                autoComplete="off"
                                placeholder="Type username (e.g., john.doe)"
                                className={`w-full p-3 border rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 ${emailError ? 'border-red-500' : 'border-gray-300'}`}
                                onFocus={() => {
                                    if (!formData.email.includes('@') && formData.email.length > 0) {
                                        setShowDomainDropdown(true);
                                    }
                                }}
                            />
                            
                            {/* Domain Dropdown */}
                            {showDomainDropdown && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                                    <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border-b text-xs font-medium text-gray-700 flex items-center justify-between">
                                        <span>📧 Select your email domain:</span>
                                        <button
                                            type="button"
                                            onClick={() => setShowDomainDropdown(false)}
                                            className="text-gray-400 hover:text-gray-600"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                    {allowedDomains.map((domain) => (
                                        <button
                                            key={domain}
                                            type="button"
                                            onClick={() => handleDomainSelect(domain)}
                                            className="w-full text-left px-4 py-3 hover:bg-blue-50 transition flex items-center justify-between group border-b last:border-b-0"
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-sm font-semibold text-gray-800 group-hover:text-blue-600">
                                                    {emailUsername}@{domain}
                                                </span>
                                                <span className="text-xs text-gray-500 mt-0.5">
                                                    {domain === 'rbmi.in' && '🏫 Institute Domain'}
                                                    {domain === 'gmail.com' && '📬 Most Popular'}
                                                    {domain === 'yahoo.com' && '🌐 Yahoo Mail'}
                                                    {domain === 'outlook.com' && '📧 Microsoft Outlook'}
                                                    {domain === 'hotmail.com' && '📮 Hotmail'}
                                                </span>
                                            </div>
                                            <span className="text-xs text-blue-500 group-hover:text-blue-700 font-medium">
                                                Click →
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        
                        {emailError && (
                            <div className="flex items-center mt-2 text-xs text-red-600">
                                <AlertTriangle size={14} className="mr-1" />
                                {emailError}
                            </div>
                        )}
                        <div className="mt-2 text-xs text-gray-500">
                            <span className="font-medium">💡 Tip:</span> Type your username, then select a domain from the dropdown
                        </div>
                    </div>
                    <div className="col-span-1 md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number (Optional)</label>
                        <input 
                            type="tel" 
                            name="phone_number" 
                            value={formData.phone_number} 
                            onChange={handleInputChange} 
                            disabled={isSubmitting}
                            autoComplete="off"
                            placeholder="+1234567890 or 1234567890"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100" 
                        />
                    </div>
                    <div className="col-span-1 md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Temporary Password <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                            <input 
                                type={showPassword ? "text" : "password"}
                                name="password" 
                                value={formData.password} 
                                onChange={handleInputChange} 
                                required 
                                disabled={isSubmitting}
                                autoComplete="new-password"
                                placeholder="Set temporary password"
                                className="hide-password-reveal w-full p-3 pr-36 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100" 
                            />
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center space-x-1">
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="p-2 text-gray-500 hover:text-gray-700 transition"
                                    title={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleGeneratePassword}
                                    disabled={isSubmitting}
                                    className="p-2 text-blue-600 hover:text-blue-700 transition disabled:opacity-50"
                                    title="Generate strong password"
                                >
                                    <RefreshCw size={18} />
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCopyPassword}
                                    disabled={isSubmitting || !formData.password}
                                    className="p-2 text-green-600 hover:text-green-700 transition disabled:opacity-50"
                                    title="Copy password"
                                >
                                    <Copy size={18} />
                                </button>
                            </div>
                        </div>
                        
                        {/* Password Strength Indicator */}
                        {passwordStrength && (
                            <div className="mt-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-gray-700">Password Strength:</span>
                                    <span className={`text-xs font-bold uppercase ${
                                        passwordStrength.strength === 'strong' ? 'text-green-600' :
                                        passwordStrength.strength === 'medium' ? 'text-yellow-600' :
                                        'text-red-600'
                                    }`}>
                                        {passwordStrength.strength === 'strong' && <span className="flex items-center"><ShieldCheck size={14} className="mr-1" />Strong</span>}
                                        {passwordStrength.strength === 'medium' && <span className="flex items-center"><Key size={14} className="mr-1" />Medium</span>}
                                        {passwordStrength.strength === 'weak' && <span className="flex items-center"><AlertTriangle size={14} className="mr-1" />Weak</span>}
                                    </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div 
                                        className={`h-2 rounded-full transition-all ${passwordStrength.color}`}
                                        style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                                    ></div>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className={passwordStrength.checks.length ? 'text-green-600' : 'text-gray-400'}>
                                        {passwordStrength.checks.length ? '✓' : '○'} At least 8 characters
                                    </div>
                                    <div className={passwordStrength.checks.uppercase ? 'text-green-600' : 'text-gray-400'}>
                                        {passwordStrength.checks.uppercase ? '✓' : '○'} Uppercase letter
                                    </div>
                                    <div className={passwordStrength.checks.lowercase ? 'text-green-600' : 'text-gray-400'}>
                                        {passwordStrength.checks.lowercase ? '✓' : '○'} Lowercase letter
                                    </div>
                                    <div className={passwordStrength.checks.number ? 'text-green-600' : 'text-gray-400'}>
                                        {passwordStrength.checks.number ? '✓' : '○'} Number
                                    </div>
                                    <div className={passwordStrength.checks.special ? 'text-green-600' : 'text-gray-400'}>
                                        {passwordStrength.checks.special ? '✓' : '○'} Special character
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Student-specific fields */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-6">
                    <div className="col-span-1 md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                        <select 
                            name="department" 
                            value={formData.department} 
                            onChange={handleInputChange} 
                            required 
                            disabled={isSubmitting} 
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                        >
                            <option value="">Select Department</option>
                            {['Computer Science Engg.', 'Artificial Intelligence', 'Mechanical Engineering', 'Electrical Engineering'].map(dept => (
                                <option key={dept} value={dept}>{dept}</option>
                            ))}
                        </select>
                    </div>
                    {formData.role === 'student' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Class/Year</label>
                            <select 
                                name="class_year" 
                                value={formData.class_year} 
                                onChange={handleInputChange} 
                                required={formData.role === 'student'} 
                                disabled={isSubmitting}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                            >
                                {['1st Year', '2nd Year', '3rd Year', '4th Year'].map(year => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end space-x-4 pt-4">
                    <button 
                        type="button" 
                        onClick={onCancel} 
                        disabled={isSubmitting}
                        className="flex items-center px-4 py-2 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-100 transition disabled:opacity-50"
                    >
                        <X size={20} className="mr-2" /> Cancel
                    </button>
                    <button 
                        type="submit" 
                        disabled={isSubmitting}
                        className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-md disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <>
                                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                                Creating...
                            </>
                        ) : (
                            <>
                                <Save size={20} className="mr-2" /> Create User
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

// Component for editing existing users
const EditUserModal = ({ user, onClose, onSuccess }) => {
    const { success, error } = useToast();
    const [formData, setFormData] = useState({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email || '',
        student_id: user.student_id || '',
        phone_number: user.phone_number || '',
        department: user.department || '',
        class_year: user.class_year || '',
        is_active: user.is_active !== undefined ? user.is_active : true,
        password: '', // New password field (optional)
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState(null);
    const [showPasswordSection, setShowPasswordSection] = useState(false);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        const finalValue = e.target.type === 'checkbox' ? e.target.checked : value;
        setFormData({ ...formData, [name]: finalValue });

        // Validate password strength on change
        if (name === 'password') {
            if (value.length > 0) {
                setPasswordStrength(validatePasswordStrength(value));
            } else {
                setPasswordStrength(null);
            }
        }
    };

    const handleGeneratePassword = () => {
        const newPassword = generateStrongPassword();
        setFormData({ ...formData, password: newPassword });
        setPasswordStrength(validatePasswordStrength(newPassword));
        success('Strong password generated! Make sure to copy it.');
    };

    const handleCopyPassword = async () => {
        if (!formData.password) {
            error('Enter or generate a password first.');
            return;
        }

        try {
            await navigator.clipboard.writeText(formData.password);
            success('Password copied to clipboard.');
        } catch (_err) {
            error('Unable to copy password. Please copy it manually.');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Validate password strength if password is being changed
        if (formData.password && passwordStrength && passwordStrength.score < 3) {
            error('Password is too weak. Please use a stronger password or generate one.');
            return;
        }

        setIsSubmitting(true);

        try {
            const updateData = {
                first_name: formData.first_name,
                last_name: formData.last_name,
                student_id: ['student', 'teacher'].includes(user.role) ? (formData.student_id || null) : null,
                phone_number: formData.phone_number || null,
                department: formData.department || null,
                class_year: formData.class_year || null,
                is_active: formData.is_active,
            };

            // Only include password if it's being changed
            if (formData.password) {
                updateData.password = formData.password;
            }

            await userAPI.updateUser(user.id, updateData);
            success(`User ${formData.first_name} ${formData.last_name} updated successfully!`);
            if (onSuccess) onSuccess();
        } catch (err) {
            if (err.status === 400) {
                error(err.data?.detail || "Failed to update user");
            } else if (err.status === 401 || err.status === 403) {
                error("You don't have permission to update users.");
            } else {
                error(err.message || "Failed to update user. Please try again.");
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 rounded-t-2xl flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold">Edit User</h2>
                        <p className="text-blue-100 text-sm mt-1">Update user information</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-white hover:bg-white/20 p-2 rounded-full transition"
                        disabled={isSubmitting}
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Email (Read-only) */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email (Login ID)</label>
                        <input 
                            type="email" 
                            value={formData.email}
                            disabled
                            className="w-full p-3 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed" 
                        />
                        <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
                    </div>

                    {/* Role (Read-only) */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                        <input 
                            type="text" 
                            value={user.role}
                            disabled
                            className="w-full p-3 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed capitalize" 
                        />
                        <p className="text-xs text-gray-500 mt-1">Role cannot be changed</p>
                    </div>

                    {/* Name fields */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                            <input 
                                type="text" 
                                name="first_name" 
                                value={formData.first_name} 
                                onChange={handleInputChange} 
                                required 
                                disabled={isSubmitting}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100" 
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                            <input 
                                type="text" 
                                name="last_name" 
                                value={formData.last_name} 
                                onChange={handleInputChange} 
                                required 
                                disabled={isSubmitting}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100" 
                            />
                        </div>
                    </div>

                    {/* Teacher/Student ID */}
                    {['student', 'teacher'].includes(user.role) && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {user.role === 'student' ? 'Roll No. / Student ID' : 'Teacher ID'}
                            </label>
                            <input
                                type="text"
                                name="student_id"
                                value={formData.student_id}
                                onChange={handleInputChange}
                                disabled={isSubmitting}
                                placeholder={user.role === 'student' ? 'e.g., CS2024001' : 'e.g., TCH001'}
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                            />
                        </div>
                    )}

                    {/* Phone Number */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                        <input 
                            type="tel" 
                            name="phone_number" 
                            value={formData.phone_number} 
                            onChange={handleInputChange} 
                            disabled={isSubmitting}
                            placeholder="+1234567890"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100" 
                        />
                    </div>

                    {/* Department and Class/Year */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                            <select 
                                name="department" 
                                value={formData.department} 
                                onChange={handleInputChange} 
                                disabled={isSubmitting} 
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                            >
                                <option value="">Select Department</option>
                                {['Computer Science Engg.', 'Artificial Intelligence', 'Mechanical Engineering', 'Electrical Engineering', 'Mathematics', 'Physics'].map(dept => (
                                    <option key={dept} value={dept}>{dept}</option>
                                ))}
                            </select>
                        </div>
                        {user.role === 'student' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Class/Year</label>
                                <select 
                                    name="class_year" 
                                    value={formData.class_year} 
                                    onChange={handleInputChange} 
                                    disabled={isSubmitting}
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                                >
                                    <option value="">Select Year</option>
                                    {['1st Year', '2nd Year', '3rd Year', '4th Year'].map(year => (
                                        <option key={year} value={year}>{year}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    {/* Active Status */}
                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            name="is_active"
                            checked={formData.is_active}
                            onChange={handleInputChange}
                            disabled={isSubmitting}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label className="ml-2 block text-sm text-gray-700">
                            Active User (Uncheck to deactivate account)
                        </label>
                    </div>

                    {/* Password Reset Section */}
                    <div className="border-t pt-4">
                        <button
                            type="button"
                            onClick={() => setShowPasswordSection(!showPasswordSection)}
                            className="flex items-center text-blue-600 hover:text-blue-700 font-medium text-sm mb-3"
                        >
                            <Key size={16} className="mr-2" />
                            {showPasswordSection ? 'Cancel Password Reset' : 'Reset User Password'}
                        </button>

                        {showPasswordSection && (
                            <div className="space-y-3">
                                <label className="block text-sm font-medium text-gray-700">
                                    New Password
                                </label>
                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                                    Current password cannot be shown. Passwords are stored securely and only a new password can be set.
                                </p>
                                <div className="relative">
                                    <input 
                                        type={showPassword ? "text" : "password"}
                                        name="password" 
                                        value={formData.password} 
                                        onChange={handleInputChange} 
                                        disabled={isSubmitting}
                                        autoComplete="new-password"
                                        placeholder="Enter new password"
                                        className="hide-password-reveal w-full p-3 pr-36 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100" 
                                    />
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center space-x-1">
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="p-2 text-gray-500 hover:text-gray-700 transition"
                                            title={showPassword ? "Hide password" : "Show password"}
                                        >
                                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleGeneratePassword}
                                            disabled={isSubmitting}
                                            className="p-2 text-blue-600 hover:text-blue-700 transition disabled:opacity-50"
                                            title="Generate strong password"
                                        >
                                            <RefreshCw size={18} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleCopyPassword}
                                            disabled={isSubmitting || !formData.password}
                                            className="p-2 text-green-600 hover:text-green-700 transition disabled:opacity-50"
                                            title="Copy password"
                                        >
                                            <Copy size={18} />
                                        </button>
                                    </div>
                                </div>
                                
                                {/* Password Strength Indicator */}
                                {passwordStrength && formData.password && (
                                    <div className="mt-3 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium text-gray-700">Password Strength:</span>
                                            <span className={`text-xs font-bold uppercase ${
                                                passwordStrength.strength === 'strong' ? 'text-green-600' :
                                                passwordStrength.strength === 'medium' ? 'text-yellow-600' :
                                                'text-red-600'
                                            }`}>
                                                {passwordStrength.strength === 'strong' && <span className="flex items-center"><ShieldCheck size={14} className="mr-1" />Strong</span>}
                                                {passwordStrength.strength === 'medium' && <span className="flex items-center"><Key size={14} className="mr-1" />Medium</span>}
                                                {passwordStrength.strength === 'weak' && <span className="flex items-center"><AlertTriangle size={14} className="mr-1" />Weak</span>}
                                            </span>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                            <div 
                                                className={`h-2 rounded-full transition-all ${passwordStrength.color}`}
                                                style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                                            ></div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div className={passwordStrength.checks.length ? 'text-green-600' : 'text-gray-400'}>
                                                {passwordStrength.checks.length ? '✓' : '○'} At least 8 characters
                                            </div>
                                            <div className={passwordStrength.checks.uppercase ? 'text-green-600' : 'text-gray-400'}>
                                                {passwordStrength.checks.uppercase ? '✓' : '○'} Uppercase letter
                                            </div>
                                            <div className={passwordStrength.checks.lowercase ? 'text-green-600' : 'text-gray-400'}>
                                                {passwordStrength.checks.lowercase ? '✓' : '○'} Lowercase letter
                                            </div>
                                            <div className={passwordStrength.checks.number ? 'text-green-600' : 'text-gray-400'}>
                                                {passwordStrength.checks.number ? '✓' : '○'} Number
                                            </div>
                                            <div className={passwordStrength.checks.special ? 'text-green-600' : 'text-gray-400'}>
                                                {passwordStrength.checks.special ? '✓' : '○'} Special character
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end space-x-4 pt-4 border-t">
                        <button 
                            type="button" 
                            onClick={onClose} 
                            disabled={isSubmitting}
                            className="flex items-center px-4 py-2 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-100 transition disabled:opacity-50"
                        >
                            <X size={20} className="mr-2" /> Cancel
                        </button>
                        <button 
                            type="submit" 
                            disabled={isSubmitting}
                            className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-md disabled:bg-blue-400 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <>
                                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2"></div>
                                    Updating...
                                </>
                            ) : (
                                <>
                                    <Save size={20} className="mr-2" /> Update User
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Component for viewing user profile (read-only)
const ViewProfileModal = ({ user, profileImage, onClose }) => {
    const identityValue = user ? getDisplayUserId(user) : 'Not assigned';
    const identityLabel = user?.role === 'student'
        ? 'Student ID'
        : user?.role === 'teacher'
            ? 'Teacher ID'
            : 'Admin Account';

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-gray-900">User Profile</h2>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 rounded-lg transition"
                        >
                            <X size={24} className="text-gray-500" />
                        </button>
                    </div>

                    <div className="flex flex-col items-center mb-6">
                        <div className="w-24 h-24 rounded-full bg-blue-600 overflow-hidden flex items-center justify-center text-white font-bold text-3xl shadow-lg ring-4 ring-blue-100 mb-4">
                            {profileImage ? (
                                <img src={profileImage} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase() || 'U'
                            )}
                        </div>
                        <h3 className="text-xl font-semibold text-gray-900">{user?.first_name} {user?.last_name}</h3>
                        <p className="text-gray-500">{user?.email}</p>
                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full mt-2 ${
                            user?.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                            user?.role === 'teacher' ? 'bg-blue-100 text-blue-800' :
                            'bg-green-100 text-green-800'
                        }`}>
                            {user?.role}
                        </span>
                    </div>

                    <div className="space-y-4">
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <p className="text-xs text-gray-500 mb-1">Full Name</p>
                            <p className="font-semibold text-gray-900">{user?.first_name} {user?.last_name}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <p className="text-xs text-gray-500 mb-1">Email</p>
                            <p className="font-semibold text-gray-900 break-all">{user?.email || 'N/A'}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <p className="text-xs text-gray-500 mb-1">{identityLabel}</p>
                            <p className="font-semibold text-gray-900">{identityValue}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <p className="text-xs text-gray-500 mb-1">Department</p>
                            <p className="font-semibold text-gray-900">{user?.department || 'N/A'}</p>
                        </div>
                        {user?.role === 'student' && (
                            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                <p className="text-xs text-gray-500 mb-1">Class / Year</p>
                                <p className="font-semibold text-gray-900">{user?.class_year || 'N/A'}</p>
                            </div>
                        )}
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <p className="text-xs text-gray-500 mb-1">Phone</p>
                            <p className="font-semibold text-gray-900">{user?.phone_number || 'N/A'}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <p className="text-xs text-gray-500 mb-1">Account Status</p>
                            <p className={`font-semibold ${user?.is_active ? 'text-green-700' : 'text-red-700'}`}>
                                {user?.is_active ? 'Active' : 'Inactive'}
                            </p>
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end">
                        <button
                            onClick={onClose}
                            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Component for listing existing users
const UserList = ({ onAddClick, refreshTrigger }) => {
    const { success, error } = useToast();
    const [users, setUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, teacher, student
    const [editingUser, setEditingUser] = useState(null);
    const [viewingUser, setViewingUser] = useState(null);
    const [viewingUserProfileImage, setViewingUserProfileImage] = useState('');

    const fetchUsers = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await userAPI.getAllUsers();
            setUsers(response);
        } catch (_err) {
            error("Failed to load users");
        } finally {
            setIsLoading(false);
        }
    }, [error]);

    useEffect(() => {
        fetchUsers();
    }, [filter, refreshTrigger, fetchUsers]);

    const handleDelete = async (userId, userName) => {
        if (!window.confirm(`Are you sure you want to delete ${userName}?`)) {
            return;
        }

        try {
            await userAPI.deleteUser(userId);
            success(`User ${userName} deleted successfully`);
            fetchUsers(); // Refresh list
        } catch (err) {
            error(err.data?.detail || "Failed to delete user");
        }
    };

    const handleEdit = (user) => {
        setEditingUser(user);
    };

    const handleUpdateSuccess = () => {
        setEditingUser(null);
        fetchUsers();
    };

    const handleViewProfile = async (user) => {
        try {
            const fullUser = await userAPI.getUser(user.id);
            setViewingUser(fullUser);
            setViewingUserProfileImage(fullUser.profile_image || '');
        } catch (err) {
            error(err.data?.detail || "Failed to load user profile");
        }
    };

    const filteredUsers = users.filter(user => {
        if (filter === 'all') return true;
        return user.role === filter;
    });

    return (
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
            <div className="flex justify-between items-center border-b pb-4 mb-4">
                <div>
                    <h2 className="text-xl font-semibold text-gray-800">Existing Users ({filteredUsers.length})</h2>
                    <div className="flex gap-2 mt-2">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-3 py-1 rounded-lg text-sm transition ${
                                filter === 'all'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            All Users
                        </button>
                        <button
                            onClick={() => setFilter('teacher')}
                            className={`px-3 py-1 rounded-lg text-sm transition ${
                                filter === 'teacher'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            Teachers
                        </button>
                        <button
                            onClick={() => setFilter('student')}
                            className={`px-3 py-1 rounded-lg text-sm transition ${
                                filter === 'student'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            Students
                        </button>
                    </div>
                </div>
                <button onClick={onAddClick} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-md">
                    <Plus size={20} className="mr-2" /> Add New User
                </button>
            </div>

            {isLoading ? (
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-500">Loading users...</p>
                </div>
            ) : filteredUsers.length === 0 ? (
                <p className="text-center text-gray-500 py-12">
                    No users found. Click "Add New User" to create one.
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Photo</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User ID</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {filteredUsers.map((user) => (
                                <tr key={user.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="w-10 h-10 rounded-full bg-blue-600 overflow-hidden flex items-center justify-center text-white font-semibold text-sm">
                                            {user.profile_image ? (
                                                <img src={user.profile_image} alt="Profile" className="w-full h-full object-cover" />
                                            ) : (
                                                `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase()
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {user.first_name} {user.last_name}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.email}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.phone_number || '-'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                            user.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                                            user.role === 'teacher' ? 'bg-blue-100 text-blue-800' :
                                            'bg-green-100 text-green-800'
                                        }`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.department || '-'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{getDisplayUserId(user)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                            user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                        }`}>
                                            {user.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                        <div className="flex space-x-3">
                                            <button
                                                onClick={() => handleViewProfile(user)}
                                                className="text-green-600 hover:text-green-900 transition"
                                            >
                                                View
                                            </button>
                                            {user.role !== 'admin' && (
                                                <>
                                                    <button
                                                        onClick={() => handleEdit(user)}
                                                        className="text-blue-600 hover:text-blue-900 transition"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(user.id, `${user.first_name} ${user.last_name}`)}
                                                        className="text-red-600 hover:text-red-900 transition"
                                                    >
                                                        Delete
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Edit User Modal */}
            {editingUser && (
                <EditUserModal
                    user={editingUser}
                    onClose={() => setEditingUser(null)}
                    onSuccess={handleUpdateSuccess}
                />
            )}

            {/* View Profile Modal */}
            {viewingUser && (
                <ViewProfileModal
                    user={viewingUser}
                    profileImage={viewingUserProfileImage}
                    onClose={() => {
                        setViewingUser(null);
                        setViewingUserProfileImage('');
                    }}
                />
            )}
        </div>
    );
};

// New Component: Unified Table for Teacher/Student Activity Lookup
const UserActivityTable = ({ userType }) => {
    const { error } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [userData, setUserData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch users when component mounts
    useEffect(() => {
        const fetchUsers = async () => {
            setIsLoading(true);
            try {
                const response = await userAPI.getAllUsers();
                // Filter by role based on userType
                const role = userType === 'Teachers' ? 'teacher' : 'student';
                const filteredUsers = response.filter(user => user.role === role);
                setUserData(filteredUsers);
            } catch (err) {
                error(`Failed to load ${userType.toLowerCase()}`);
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchUsers();
    }, [userType, error]);

    // Filter data based on search term (Name or ID/RollNo)
    const filteredData = userData.filter(user => {
        const searchLower = searchTerm.toLowerCase();
        const fullName = `${user.first_name} ${user.last_name}`.toLowerCase();
        const nameMatch = fullName.includes(searchLower);
        const emailMatch = user.email.toLowerCase().includes(searchLower);
        const displayId = getDisplayUserId(user).toLowerCase();
        const idMatch = displayId.includes(searchLower);

        return nameMatch || emailMatch || idMatch;
    });

    // Format last active date
    const formatLastActive = (lastActive) => {
        if (!lastActive) return 'Never';
        try {
            const date = new Date(lastActive);
            return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return 'N/A';
        }
    };

    // Export to CSV functionality
    const exportToCSV = () => {
        // Prepare CSV headers with all details
        const headers = userType === 'Students' 
            ? ['Sr. No.', 'Student ID', 'First Name', 'Last Name', 'Email', 'Phone Number', 'Department', 'Class/Year', 'Role', 'Created At', 'Last Active', 'Status']
            : ['Sr. No.', 'Teacher ID', 'First Name', 'Last Name', 'Email', 'Phone Number', 'Department', 'Role', 'Created At', 'Last Active', 'Status'];

        // Prepare CSV rows with complete information
        const rows = filteredData.map((user, index) => {
            const createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { 
                month: 'short', day: 'numeric', year: 'numeric' 
            }) : 'N/A';

            if (userType === 'Students') {
                return [
                    index + 1,
                    user.student_id || 'N/A',
                    user.first_name,
                    user.last_name,
                    user.email,
                    user.phone_number || 'N/A',
                    user.department || 'N/A',
                    user.class_year || 'N/A',
                    user.role || 'student',
                    createdDate,
                    formatLastActive(user.last_active),
                    user.is_active ? 'Active' : 'Inactive'
                ];
            }

            // For teachers
            return [
                index + 1,
                getDisplayUserId(user),
                user.first_name,
                user.last_name,
                user.email,
                user.phone_number || 'N/A',
                user.department || 'N/A',
                user.role || 'teacher',
                createdDate,
                formatLastActive(user.last_active),
                user.is_active ? 'Active' : 'Inactive'
            ];
        });

        // Combine headers and rows
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        // Create blob and download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${userType.toLowerCase()}_complete_details_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-800">{userType} Activity Lookup</h2>
                <div className="text-sm text-gray-600">
                    Total: <span className="font-bold text-blue-600">{userData.length}</span> {userType}
                </div>
            </div>

            {/* Search Bar (Prominently placed at the top) */}
            <div className="flex items-center space-x-2 w-full max-w-lg">
                <div className="relative w-full">
                    <input
                        type="text"
                        placeholder={`Search ${userType} by Name${userType === 'Students' ? ', Roll No.' : ', Teacher ID'} or Email...`}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    />
                    <Search size={20} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                </div>
                {searchTerm && (
                    <button
                        onClick={() => setSearchTerm('')}
                        className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                    >
                        Clear
                    </button>
                )}
            </div>

            {/* Loading State */}
            {isLoading ? (
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-500">Loading {userType.toLowerCase()}...</p>
                </div>
            ) : (
                <>
                    {/* Results Count */}
                    {searchTerm && (
                        <div className="text-sm text-gray-600">
                            Showing <span className="font-bold text-blue-600">{filteredData.length}</span> of {userData.length} {userType.toLowerCase()}
                        </div>
                    )}

                    {/* User List Table */}
                    <div className="overflow-x-auto border rounded-xl shadow-sm">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sr. No.</th>
                                    {userType === 'Students' && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Roll No.</th>}
                                    {userType === 'Teachers' && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Teacher ID</th>}
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Class/Year</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Active</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {filteredData.length > 0 ? filteredData.map((user, index) => (
                                    <tr key={user.id} className="hover:bg-gray-50 transition">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{index + 1}</td>
                                        {userType === 'Students' && (
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 font-mono bg-blue-50">
                                                {user.student_id || 'N/A'}
                                            </td>
                                        )}
                                        {userType === 'Teachers' && (
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 font-mono bg-blue-50">
                                                {getDisplayUserId(user)}
                                            </td>
                                        )}
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            {user.first_name} {user.last_name}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                            {user.email}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {user.department || 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {user.class_year || 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {formatLastActive(user.last_active)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                                user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                            }`}>
                                                {user.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={userType === 'Students' ? 8 : 8} className="px-6 py-12 text-center">
                                            <div className="flex flex-col items-center justify-center space-y-3">
                                                <UserCheck size={48} className="text-gray-300" />
                                                <p className="text-gray-500 font-medium">
                                                    {searchTerm 
                                                        ? `No ${userType.toLowerCase()} found matching "${searchTerm}"`
                                                        : `No ${userType.toLowerCase()} found. Add some users to get started.`
                                                    }
                                                </p>
                                                {searchTerm && (
                                                    <button
                                                        onClick={() => setSearchTerm('')}
                                                        className="text-blue-600 hover:text-blue-700 text-sm font-semibold"
                                                    >
                                                        Clear search
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Export/Actions */}
                    {filteredData.length > 0 && (
                        <div className="flex justify-between items-center pt-4 border-t">
                            <p className="text-sm text-gray-600">
                                Displaying {filteredData.length} {userType.toLowerCase()}
                            </p>
                            <button 
                                onClick={exportToCSV}
                                className="flex items-center px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-md"
                            >
                                <Calendar size={16} className="mr-2" />
                                Export to CSV
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

// Component for Detailed Reports Tab
const DetailedReportsTool = () => {
    const { error } = useToast();
    
    // Get departments from settings with error handling
    let departmentOptions = ['All'];
    try {
        departmentOptions = ['All', ...getDepartments()];
    } catch (err) {
        console.error('Failed to load departments:', err);
        departmentOptions = ['All', 'Computer Science Engg.', 'Mechanical Engineering', 'Electrical Engineering'];
    }
    const years = ['All', '1st Year', '2nd Year', '3rd Year', '4th Year'];

    const [classYear, setClassYear] = useState('All');
    const [department, setDepartment] = useState('All');
    const [semester, setSemester] = useState('All');
    const [selectedQuizId, setSelectedQuizId] = useState('all');
    const [aiInsights, setAiInsights] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [reportData, setReportData] = useState(null);
    const [allUsers, setAllUsers] = useState([]);
    const [allQuizzes, setAllQuizzes] = useState([]);

    // Fetch real data on component mount
    useEffect(() => {
        const fetchData = async () => {
            try {
                const [users, quizzes] = await Promise.all([
                    userAPI.getAllUsers(),
                    quizAPI.getAllQuizzes()
                ]);
                setAllUsers(users || []);
                setAllQuizzes(quizzes || []);
            } catch (err) {
                console.error('Failed to fetch data:', err);
                error('Failed to load report data');
            }
        };
        fetchData();
    }, [error]);

    // Calculate semester options based on year
    const availableSemesters = useMemo(() => {
        const baseOptions = ['All'];
        if (classYear === 'All') {
            return [...baseOptions, 'Sem 1', 'Sem 2', 'Sem 3', 'Sem 4', 'Sem 5', 'Sem 6', 'Sem 7', 'Sem 8'];
        }

        const yearMap = {
            '1st Year': [1, 2],
            '2nd Year': [3, 4],
            '3rd Year': [5, 6],
            '4th Year': [7, 8],
        };

        const yearSemesters = yearMap[classYear] || [];
        return [...baseOptions, ...yearSemesters.map(sem => `Sem ${sem}`)];
    }, [classYear]);

    // Reset semester when class year changes
    useEffect(() => {
        if (!availableSemesters.includes(semester)) {
            setSemester('All');
        }
    }, [classYear, availableSemesters, semester]);

    // Function to generate real report data based on filters
    const generateReportData = () => {
        // Filter students based on selections
        let filteredStudents = allUsers.filter(u => u.role === 'student');
        
        if (department !== 'All') {
            filteredStudents = filteredStudents.filter(s => s.department === department);
        }
        
        if (classYear !== 'All') {
            filteredStudents = filteredStudents.filter(s => s.class_year === classYear);
        }

        // Get quiz statistics
        const activeQuizzes = allQuizzes.filter(q => q.is_active);
        const totalQuizzes = allQuizzes.length;
        const totalAttempts = allQuizzes.reduce((sum, q) => sum + (q.attempts || 0), 0);
        
        // Calculate average completion rate
        const potentialAttempts = filteredStudents.length * activeQuizzes.length;
        const completionRate = potentialAttempts > 0 ? ((totalAttempts / potentialAttempts) * 100).toFixed(1) : 0;

        // Get teacher statistics
        const teachers = allUsers.filter(u => u.role === 'teacher');
        const teachersWithQuizzes = teachers.filter(t => 
            allQuizzes.some(q => q.creator_id === t.id)
        );
        const inactiveTeachers = teachers.length - teachersWithQuizzes.length;

        return {
            totalStudents: filteredStudents.length,
            totalQuizzes,
            activeQuizzes: activeQuizzes.length,
            totalAttempts,
            completionRate,
            totalTeachers: teachers.length,
            activeTeachers: teachersWithQuizzes.length,
            inactiveTeachers,
            filters: { classYear, department, semester }
        };
    };

    // Function to analyze report and generate insights
    const analyzeReport = async () => {
        setIsGenerating(true);
        setAiInsights(null);

        // Generate report data from actual system data
        const data = generateReportData();
        setReportData(data);

        try {
            const payload = {
                include_recommendations: true,
            };

            if (department !== 'All') {
                payload.department = department;
            }

            if (selectedQuizId !== 'all') {
                payload.quiz_id = Number(selectedQuizId);
            }

            const response = await analyticsAPI.getAIInsights(payload);
            setAiInsights(response);
        } catch (err) {
            console.error('Failed to generate AI insights:', err);
            error(err?.data?.detail || err?.message || 'Failed to generate AI insights');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Segmented Assessment Reports</h2>
            <p className="text-gray-600">
                Generate analytical reports by filtering the student results based on class structure, department, and semester.
            </p>

            {/* Input Filters */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-gray-50 p-4 rounded-xl border">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Class/Year</label>
                    <select value={classYear} onChange={(e) => setClassYear(e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-600 focus:border-blue-600">
                        {years.map(year => (<option key={year}>{year}</option>))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                    <select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-600 focus:border-blue-600">
                        {departmentOptions.map(dept => (<option key={dept}>{dept}</option>))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Semester</label>
                    <select value={semester} onChange={(e) => setSemester(e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-600 focus:border-blue-600">
                        {/* UPDATED: Dynamic semester options based on classYear */}
                        {availableSemesters.map(sem => (<option key={sem}>{sem}</option>))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Quiz Scope</label>
                    <select value={selectedQuizId} onChange={(e) => setSelectedQuizId(e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-600 focus:border-blue-600">
                        <option value="all">All Quizzes</option>
                        {allQuizzes.map((quiz) => (
                            <option key={quiz.id} value={String(quiz.id)}>
                                {quiz.title || `Quiz ${quiz.id}`}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex items-end">
                    {/* Reverted primary button color to blue */}
                    <button onClick={analyzeReport} disabled={isGenerating} className="w-full flex items-center justify-center p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition disabled:bg-gray-400">
                        {isGenerating ? (
                            <div className="flex items-center">
                                <svg className="animate-spin h-5 w-5 mr-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Analyzing...
                            </div>
                        ) : (
                            <>
                                <BarChart3 size={20} className="mr-2" /> Generate Insights
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Statistics Cards */}
            {reportData && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 border-t pt-6">
                    {/* Total Students Card */}
                    <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-5 rounded-xl shadow-lg text-white">
                        <div className="flex items-center justify-between mb-2">
                            <Users size={28} className="opacity-80" />
                            <span className="text-3xl font-bold">{reportData.totalStudents}</span>
                        </div>
                        <p className="text-sm opacity-90 font-medium">Total Students</p>
                        <p className="text-xs opacity-75 mt-1">In selected cohort</p>
                    </div>

                    {/* Total Quizzes Card */}
                    <div className="bg-gradient-to-br from-purple-500 to-purple-600 p-5 rounded-xl shadow-lg text-white">
                        <div className="flex items-center justify-between mb-2">
                            <FileText size={28} className="opacity-80" />
                            <span className="text-3xl font-bold">{reportData.totalQuizzes}</span>
                        </div>
                        <p className="text-sm opacity-90 font-medium">Total Quizzes</p>
                        <p className="text-xs opacity-75 mt-1">{reportData.activeQuizzes} currently active</p>
                    </div>

                    {/* Completion Rate Card */}
                    <div className={`bg-gradient-to-br ${
                        reportData.completionRate >= 80 ? 'from-green-500 to-green-600' :
                        reportData.completionRate >= 50 ? 'from-yellow-500 to-yellow-600' :
                        'from-red-500 to-red-600'
                    } p-5 rounded-xl shadow-lg text-white`}>
                        <div className="flex items-center justify-between mb-2">
                            <TrendingUp size={28} className="opacity-80" />
                            <span className="text-3xl font-bold">{reportData.completionRate}%</span>
                        </div>
                        <p className="text-sm opacity-90 font-medium">Completion Rate</p>
                        <p className="text-xs opacity-75 mt-1">{reportData.totalAttempts} total attempts</p>
                    </div>

                    {/* Teacher Activity Card */}
                    <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 p-5 rounded-xl shadow-lg text-white">
                        <div className="flex items-center justify-between mb-2">
                            <GraduationCap size={28} className="opacity-80" />
                            <span className="text-3xl font-bold">{reportData.activeTeachers}/{reportData.totalTeachers}</span>
                        </div>
                        <p className="text-sm opacity-90 font-medium">Active Teachers</p>
                        <p className="text-xs opacity-75 mt-1">
                            {reportData.inactiveTeachers === 0 ? 'Full participation!' : `${reportData.inactiveTeachers} inactive`}
                        </p>
                    </div>
                </div>
            )}

            {/* Gemini Analysis Output */}
            <div className="border-t pt-6 space-y-4">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">Actionable Insights (Powered by AI)</h3>

                {/* Reverted BG and border to light blue */}
                <div className="bg-blue-50/50 p-6 rounded-xl border border-blue-200 min-h-[150px]">
                    {aiInsights ? (
                        <div className="space-y-4 text-gray-800">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                                <span className="px-2 py-1 rounded-md bg-blue-100 text-blue-800">
                                    Provider: {aiInsights.provider}
                                </span>
                                <span className="px-2 py-1 rounded-md bg-indigo-100 text-indigo-800">
                                    Model: {aiInsights.model}
                                </span>
                                {aiInsights.fallback_used && (
                                    <span className="px-2 py-1 rounded-md bg-amber-100 text-amber-800">
                                        Fallback mode
                                    </span>
                                )}
                            </div>

                            <div>
                                <h4 className="text-base font-bold text-gray-900 mb-1">Summary</h4>
                                <p className="text-sm text-gray-700">{aiInsights.summary}</p>
                            </div>

                            <div>
                                <h4 className="text-base font-bold text-gray-900 mb-2">Key Findings</h4>
                                <ul className="space-y-2 text-sm text-gray-700">
                                    {(aiInsights.key_findings || []).map((finding, idx) => (
                                        <li key={`${finding}-${idx}`} className="flex items-start">
                                            <span className="mr-2 text-blue-600">•</span>
                                            <span>{finding}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {(aiInsights.recommendations || []).length > 0 && (
                                <div>
                                    <h4 className="text-base font-bold text-gray-900 mb-2">Recommendations</h4>
                                    <ul className="space-y-2 text-sm text-gray-700">
                                        {aiInsights.recommendations.map((recommendation, idx) => (
                                            <li key={`${recommendation}-${idx}`} className="flex items-start">
                                                <span className="mr-2 text-green-600">•</span>
                                                <span>{recommendation}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-gray-500 text-center pt-10">
                            Use the filters and click 'Generate Insights' to get live backend AI analysis.
                        </p>
                    )}
                </div>
            </div>

        </div>
    );
};

// Quiz Management Component
// Teacher Quiz Management - Create and manage own quizzes
const TeacherStudentsView = () => {
    const { error } = useToast();
    const [students, setStudents] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [studentSortBy, setStudentSortBy] = useState('name_asc');
    const [viewingStudent, setViewingStudent] = useState(null);
    const [viewingStudentProfileImage, setViewingStudentProfileImage] = useState('');

    const fetchTeacherStudents = useCallback(async () => {
        setIsLoading(true);
        try {
            // Get all users
            const allUsers = await userAPI.getAllUsers();
            
            // Filter to show only students
            const studentsList = allUsers.filter(u => u.role === 'student');
            setStudents(studentsList);
        } catch (err) {
            error('Failed to load students');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }, [error]);

    useEffect(() => {
        if (!showAddForm) {
            fetchTeacherStudents();
        }
    }, [showAddForm, fetchTeacherStudents]);

    const handleUserCreated = () => {
        setShowAddForm(false);
        fetchTeacherStudents();
    };

    const handleViewStudentProfile = async (student) => {
        try {
            const fullStudent = await userAPI.getUser(student.id);
            setViewingStudent(fullStudent);
            setViewingStudentProfileImage(fullStudent.profile_image || '');
        } catch (err) {
            error(err.data?.detail || "Failed to load student profile");
        }
    };

    const sortedStudents = useMemo(() => {
        const list = [...students];
        list.sort((a, b) => {
            const nameA = `${a?.first_name || ''} ${a?.last_name || ''}`.trim().toLowerCase();
            const nameB = `${b?.first_name || ''} ${b?.last_name || ''}`.trim().toLowerCase();
            const idA = String(a?.student_id || '').toLowerCase();
            const idB = String(b?.student_id || '').toLowerCase();
            const emailA = String(a?.email || '').toLowerCase();
            const emailB = String(b?.email || '').toLowerCase();

            if (studentSortBy === 'name_desc') return nameB.localeCompare(nameA);
            if (studentSortBy === 'id_asc') return idA.localeCompare(idB, undefined, { numeric: true });
            if (studentSortBy === 'id_desc') return idB.localeCompare(idA, undefined, { numeric: true });
            if (studentSortBy === 'email_asc') return emailA.localeCompare(emailB);
            if (studentSortBy === 'email_desc') return emailB.localeCompare(emailA);
            return nameA.localeCompare(nameB);
        });
        return list;
    }, [students, studentSortBy]);

    if (showAddForm) {
        return (
            <UserCreationForm 
                onCancel={() => setShowAddForm(false)}
                onUserCreated={handleUserCreated}
                currentUserRole="teacher"
            />
        );
    }

    return (
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-lg border border-gray-100">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">My Students</h2>
                    <p className="text-gray-600 mt-1">View and manage your students</p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end gap-3 w-full sm:w-auto">
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Sort By</label>
                        <select
                            value={studentSortBy}
                            onChange={(e) => setStudentSortBy(e.target.value)}
                            className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="name_asc">Name A-Z</option>
                            <option value="name_desc">Name Z-A</option>
                            <option value="id_asc">Student ID Asc</option>
                            <option value="id_desc">Student ID Desc</option>
                            <option value="email_asc">Email A-Z</option>
                            <option value="email_desc">Email Z-A</option>
                        </select>
                    </div>
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="w-full sm:w-auto justify-center flex items-center px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition shadow-lg"
                    >
                        <Plus size={20} className="mr-2" />
                        Add Student
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-500">Loading students...</p>
                </div>
            ) : students.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b-2 border-gray-200">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Photo</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Student ID</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Email</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Department</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Year</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {sortedStudents.map((student) => (
                                <tr key={student.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="w-10 h-10 rounded-full bg-blue-600 overflow-hidden flex items-center justify-center text-white font-semibold text-sm">
                                            {student.profile_image ? (
                                                <img src={student.profile_image} alt="Profile" className="w-full h-full object-cover" />
                                            ) : (
                                                `${student.first_name?.[0] || ''}${student.last_name?.[0] || ''}`.toUpperCase()
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="font-semibold text-gray-900">{student.first_name} {student.last_name}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                        {student.student_id || 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                        {student.email}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                        {student.department || 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                        {student.class_year || 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <button
                                            onClick={() => handleViewStudentProfile(student)}
                                            className="text-green-600 hover:text-green-900 transition text-sm font-medium"
                                        >
                                            View Profile
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="text-center py-12 text-gray-500">
                    <AlertCircle size={48} className="mx-auto mb-4 text-gray-400" />
                    <p>No students found</p>
                </div>
            )}

            {/* View Student Profile Modal */}
            {viewingStudent && (
                <ViewProfileModal
                    user={viewingStudent}
                    profileImage={viewingStudentProfileImage}
                    onClose={() => {
                        setViewingStudent(null);
                        setViewingStudentProfileImage('');
                    }}
                />
            )}
        </div>
    );
};

const TeacherQuizManagement = () => {
    const navigate = useNavigate();
    const { success, error } = useToast();
    const [quizzes, setQuizzes] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showBulkUpload, setShowBulkUpload] = useState(false);
    const [assignQuizModal, setAssignQuizModal] = useState({ open: false, quiz: null });
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [showCreateQuizInline, setShowCreateQuizInline] = useState(false);
    const [inlineEditQuizId, setInlineEditQuizId] = useState(null);
    const [quizSortBy, setQuizSortBy] = useState('title_asc');

    const fetchQuizzes = useCallback(async () => {
        setIsLoading(true);
        try {
            console.log('Fetching quizzes...');
            const data = await quizAPI.getAllQuizzes();
            console.log('Quizzes loaded:', data);
            const normalizedQuizzes = Array.isArray(data)
                ? data.filter((quiz) => quiz && typeof quiz === 'object' && quiz.id)
                : [];
            setQuizzes(normalizedQuizzes);
        } catch (err) {
            console.error('Failed to load quizzes:', err);
            error(`Failed to load quizzes: ${err.data?.detail || err.message || 'Unknown error'}`);
            setQuizzes([]);
        } finally {
            setIsLoading(false);
        }
    }, [error]);

    useEffect(() => {
        fetchQuizzes();
    }, [refreshTrigger, fetchQuizzes]);

    const handleDeleteQuiz = async (quizId) => {
        if (!window.confirm('Are you sure you want to delete this quiz?')) return;
        
        try {
            console.log(`Attempting to delete quiz ${quizId}...`);
            await quizAPI.deleteQuiz(quizId);
            console.log('Delete successful');
            success('Quiz deleted successfully');
            setRefreshTrigger(prev => prev + 1);
        } catch (err) {
            console.error('Failed to delete quiz:', err);
            error(`Failed to delete quiz: ${err.data?.detail || err.message || 'Unknown error'}`);
        }
    };

    const handleToggleQuizStatus = async (quizId, currentStatus) => {
        const action = currentStatus ? 'deactivate' : 'activate';
        if (!window.confirm(`Are you sure you want to ${action} this quiz?${!currentStatus ? ' Students will be able to see and take it.' : ' Students will no longer be able to take it.'}`)) return;
        
        try {
            console.log(`Attempting to ${action} quiz ${quizId}...`);
            const result = await quizAPI.updateQuiz(quizId, { is_active: !currentStatus });
            console.log('Update result:', result);
            success(`Quiz ${action}d successfully! ${!currentStatus ? 'Students can now take this quiz.' : 'Quiz is now hidden from students.'}`);
            setRefreshTrigger(prev => prev + 1);
        } catch (err) {
            console.error(`Failed to ${action} quiz:`, err);
            error(`Failed to ${action} quiz: ${err.data?.detail || err.message || 'Unknown error'}`);
        }
    };

    const handleBulkUploadSuccess = (result) => {
        if (result.success > 0) {
            success(`Successfully uploaded ${result.success} quiz${result.success !== 1 ? 'zes' : ''}!`);
        }
        if (result.failed > 0 && result.failedQuizzes && result.failedQuizzes.length > 0) {
            // Show each failed quiz with its error
            result.failedQuizzes.forEach((failedQuiz, idx) => {
                setTimeout(() => {
                    error(`Failed: ${failedQuiz.title}\nReason: ${failedQuiz.error}`);
                }, idx * 100); // Stagger the error notifications
            });
            console.error('Failed quizzes details:', result.failedQuizzes);
        } else if (result.failed > 0) {
            error(`${result.failed} quiz${result.failed !== 1 ? 'zes' : ''} failed to upload`);
        }
        setRefreshTrigger(prev => prev + 1);
    };

    const sortedQuizzes = useMemo(() => {
        const list = quizzes.filter((quiz) => quiz && quiz.id);
        return [...list].sort((a, b) => {
            const titleA = String(a?.title || '').toLowerCase();
            const titleB = String(b?.title || '').toLowerCase();
            const attemptsA = Number(a?.attempts || 0);
            const attemptsB = Number(b?.attempts || 0);
            const durationA = Number(a?.duration_minutes || 0);
            const durationB = Number(b?.duration_minutes || 0);
            const liveA = a?.is_active ? 1 : 0;
            const liveB = b?.is_active ? 1 : 0;

            if (quizSortBy === 'title_desc') return titleB.localeCompare(titleA);
            if (quizSortBy === 'attempts_desc') return attemptsB - attemptsA;
            if (quizSortBy === 'attempts_asc') return attemptsA - attemptsB;
            if (quizSortBy === 'duration_desc') return durationB - durationA;
            if (quizSortBy === 'duration_asc') return durationA - durationB;
            if (quizSortBy === 'live_first') return liveB - liveA;
            return titleA.localeCompare(titleB);
        });
    }, [quizzes, quizSortBy]);

    if (showCreateQuizInline || inlineEditQuizId) {
        return (
            <div className="space-y-4">
                <button
                    onClick={() => {
                        setShowCreateQuizInline(false);
                        setInlineEditQuizId(null);
                    }}
                    className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition"
                >
                    ← Back to Quiz Management
                </button>
                <QuizCreator
                    embedded
                    quizIdOverride={inlineEditQuizId}
                    onDone={() => {
                        setShowCreateQuizInline(false);
                        setInlineEditQuizId(null);
                        setRefreshTrigger(prev => prev + 1);
                    }}
                />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 md:p-8">
                <div className="flex flex-col gap-3 mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">Quiz Management</h2>
                        <p className="text-gray-600 mt-1">Create and manage quizzes for students</p>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 w-full">
                        <select
                            value={quizSortBy}
                            onChange={(e) => setQuizSortBy(e.target.value)}
                            className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            title="Sort quizzes"
                        >
                            <option value="title_asc">Sort: Title A-Z</option>
                            <option value="title_desc">Sort: Title Z-A</option>
                            <option value="live_first">Sort: Live First</option>
                            <option value="attempts_desc">Sort: Attempts High-Low</option>
                            <option value="attempts_asc">Sort: Attempts Low-High</option>
                            <option value="duration_desc">Sort: Duration High-Low</option>
                            <option value="duration_asc">Sort: Duration Low-High</option>
                        </select>
                        <button
                            onClick={() => setRefreshTrigger(prev => prev + 1)}
                            className="w-full sm:w-auto justify-center flex items-center px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition shadow-md"
                            title="Refresh quiz list"
                        >
                            <RefreshCw size={20} />
                        </button>
                        <button
                            onClick={() => setShowBulkUpload(true)}
                            className="w-full sm:w-auto justify-center flex items-center px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition shadow-lg"
                        >
                            <Upload size={20} className="mr-2" />
                            Bulk Upload
                        </button>
                        <button
                            onClick={() => {
                                setInlineEditQuizId(null);
                                setShowCreateQuizInline(true);
                            }}
                            className="w-full sm:w-auto justify-center flex items-center px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition shadow-lg"
                        >
                            <Plus size={20} className="mr-2" />
                            Create New Quiz
                        </button>
                    </div>
                </div>

                {isLoading ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                        <p className="mt-4 text-gray-500">Loading quizzes...</p>
                    </div>
                ) : quizzes.length === 0 ? (
                    <div className="text-center py-20">
                        <FileText size={64} className="mx-auto mb-4 text-gray-300" />
                        <h3 className="text-xl font-semibold text-gray-600 mb-2">No Quizzes Yet</h3>
                        <p className="text-gray-500 mb-6">Start by creating your first quiz for students</p>
                        <button
                            onClick={() => {
                                setInlineEditQuizId(null);
                                setShowCreateQuizInline(true);
                            }}
                            className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition shadow-lg"
                        >
                            <Plus size={20} className="mr-2" />
                            Create First Quiz
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {sortedQuizzes.map((quiz) => {
                            const quizTitle = typeof quiz.title === 'string' && quiz.title.trim() ? quiz.title : 'Untitled Quiz';
                            const quizDescription = typeof quiz.description === 'string' && quiz.description.trim()
                                ? quiz.description
                                : 'No description available';
                            const isLiveNow = (() => {
                                if (!quiz?.is_live_session || !quiz?.is_active) return false;
                                const now = Date.now();
                                const start = quiz?.live_start_time ? new Date(quiz.live_start_time).getTime() : null;
                                const end = quiz?.live_end_time ? new Date(quiz.live_end_time).getTime() : null;
                                const hasStart = Number.isFinite(start);
                                const hasEnd = Number.isFinite(end);
                                if (!hasStart && !hasEnd) return true;
                                if (!hasStart && hasEnd) return end > now;
                                if (hasStart && !hasEnd) return start <= now;
                                return start <= now && end > now;
                            })();
                            return (
                            <div key={quiz.id} className={`border-2 rounded-xl p-4 sm:p-6 transition ${
                                isLiveNow
                                    ? 'border-green-200 bg-green-50/30 hover:border-green-300'
                                    : 'border-gray-200 bg-gray-50/30 hover:border-gray-300'
                            }`}>
                                <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
                                    <div className="flex-1">
                                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                            <h3 className="text-xl font-bold text-gray-900">{quizTitle}</h3>
                                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                                isLiveNow
                                                    ? 'bg-green-100 text-green-800'
                                                    : 'bg-gray-200 text-gray-600'
                                            }`}>
                                                {isLiveNow ? '🟢 LIVE NOW' : '⚪ Inactive'}
                                            </span>
                                        </div>
                                        <p className="text-gray-600 mt-1">{quizDescription}</p>
                                        <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-3 text-sm text-gray-500">
                                            <span className="flex items-center">
                                                <FileText size={16} className="mr-1" />
                                                {quiz.questions?.length || quiz.total_questions || 0} Questions
                                            </span>
                                            <span className="flex items-center">
                                                <Clock size={16} className="mr-1" />
                                                {quiz.duration_minutes || 30} mins
                                            </span>
                                            <span className="flex items-center">
                                                <Users size={16} className="mr-1" />
                                                {quiz.attempts || 0} Attempts
                                            </span>
                                            <span className="flex items-center">
                                                <Award size={16} className="mr-1" />
                                                +{quiz.marks_per_correct || 1} / -{quiz.negative_marking || 0}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="w-full lg:w-auto flex flex-wrap items-center gap-2">
                                        {quiz.is_active ? (
                                            <button 
                                                onClick={() => handleToggleQuizStatus(quiz.id, quiz.is_active)}
                                                className="flex-1 sm:flex-none min-w-[120px] px-3 py-2 rounded-lg font-semibold transition text-sm text-orange-600 hover:bg-orange-50 border border-orange-200"
                                            >
                                                {isLiveNow ? '🔴 End Live' : '🔴 Deactivate'}
                                            </button>
                                        ) : (
                                            <button 
                                                onClick={() => setAssignQuizModal({ open: true, quiz })}
                                                className="flex-1 sm:flex-none min-w-[120px] px-3 py-2 rounded-lg font-semibold transition text-sm text-green-600 hover:bg-green-50 border border-green-200"
                                            >
                                                🟢 Go Live
                                            </button>
                                        )}
                                        <button 
                                            onClick={() => navigate(`/quiz/${quiz.id}/take`)}
                                            className="flex-1 sm:flex-none min-w-[92px] px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-lg font-semibold transition text-sm border border-blue-100"
                                        >
                                            Preview
                                        </button>
                                        <button 
                                            onClick={() => {
                                                setShowCreateQuizInline(false);
                                                setInlineEditQuizId(quiz.id);
                                            }}
                                            className="flex-1 sm:flex-none min-w-[92px] px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-semibold transition text-sm border border-gray-200"
                                        >
                                            Edit
                                        </button>
                                        <button 
                                            onClick={() => handleDeleteQuiz(quiz.id)}
                                            className="flex-1 sm:flex-none min-w-[92px] px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg font-semibold transition text-sm border border-red-100"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                        })}
                    </div>
                )}
            </div>

            {/* Bulk Quiz Upload Modal */}
            <BulkQuizUploadModal
                isOpen={showBulkUpload}
                onClose={() => setShowBulkUpload(false)}
                onSuccess={handleBulkUploadSuccess}
            />

            {/* Quiz Assignment Modal */}
            <QuizAssignmentModal
                isOpen={assignQuizModal.open}
                quiz={assignQuizModal.quiz}
                onClose={() => setAssignQuizModal({ open: false, quiz: null })}
                onSuccess={() => {
                    success('Quiz assignment updated successfully!');
                    fetchQuizzes();
                }}
            />
        </div>
    );
};

// Admin Quiz Monitoring - View all teachers' work
const AdminQuizMonitoring = () => {
    const { error } = useToast();
    const [quizzes, setQuizzes] = useState([]);
    const [users, setUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterTeacher, setFilterTeacher] = useState('all');
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [quizzesData, usersData] = await Promise.all([
                quizAPI.getAllQuizzes(),
                userAPI.getAllUsers()
            ]);
            setQuizzes(quizzesData || []);
            setUsers(usersData || []);
        } catch (err) {
            console.error('Dashboard data error:', err);
            console.error('Error details:', err.data);
            console.error('Error status:', err.status);
            error(err.data?.detail || err.message || 'Failed to load data');
        } finally {
            setIsLoading(false);
        }
    }, [error]);

    useEffect(() => {
        fetchData();
    }, [refreshTrigger, fetchData]);

    const teachers = users.filter(u => u.role === 'teacher');
    const filteredQuizzes = filterTeacher === 'all' 
        ? quizzes 
        : quizzes.filter(q => q.creator_id === parseInt(filterTeacher));

    // Group quizzes by teacher
    const quizzesByTeacher = teachers.map(teacher => ({
        teacher,
        quizzes: quizzes.filter(q => q.creator_id === teacher.id),
        totalQuizzes: quizzes.filter(q => q.creator_id === teacher.id).length,
        totalAttempts: quizzes.filter(q => q.creator_id === teacher.id)
            .reduce((sum, q) => sum + (q.attempts || 0), 0)
    }));

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-lg p-8">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">Quiz Monitoring Dashboard</h2>
                        <p className="text-gray-600 mt-1">Monitor all teachers' quiz activities</p>
                    </div>
                    <button
                        onClick={() => setRefreshTrigger(prev => prev + 1)}
                        className="flex items-center px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition shadow-md"
                        title="Refresh data"
                    >
                        <RefreshCw size={20} className="mr-2" />
                        Refresh
                    </button>
                </div>

                {/* Teacher Performance Overview */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-blue-50 p-4 rounded-xl">
                        <div className="text-sm text-blue-600 font-semibold">Total Teachers</div>
                        <div className="text-3xl font-bold text-blue-900 mt-1">{teachers.length}</div>
                    </div>
                    <div className="bg-green-50 p-4 rounded-xl">
                        <div className="text-sm text-green-600 font-semibold">Total Quizzes</div>
                        <div className="text-3xl font-bold text-green-900 mt-1">{quizzes.length}</div>
                    </div>
                    <div className="bg-purple-50 p-4 rounded-xl">
                        <div className="text-sm text-purple-600 font-semibold">Total Attempts</div>
                        <div className="text-3xl font-bold text-purple-900 mt-1">
                            {quizzes.reduce((sum, q) => sum + (q.attempts || 0), 0)}
                        </div>
                    </div>
                </div>

                {/* Filter by Teacher */}
                <div className="mb-6">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Filter by Teacher
                    </label>
                    <select
                        value={filterTeacher}
                        onChange={(e) => setFilterTeacher(e.target.value)}
                        className="w-full md:w-64 px-4 py-2 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none"
                    >
                        <option value="all">All Teachers</option>
                        {teachers.map(teacher => (
                            <option key={teacher.id} value={teacher.id}>
                                {teacher.first_name} {teacher.last_name} ({teacher.email})
                            </option>
                        ))}
                    </select>
                </div>

                {isLoading ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                        <p className="mt-4 text-gray-500">Loading data...</p>
                    </div>
                ) : (
                    <div>
                        {/* Teacher Activity Table */}
                        <h3 className="text-xl font-bold text-gray-900 mb-4">Teacher Activity Summary</h3>
                        <div className="overflow-x-auto mb-8">
                            <table className="w-full">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Teacher</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Email</th>
                                        <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Quizzes Created</th>
                                        <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Total Attempts</th>
                                        <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {quizzesByTeacher.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                                                No teachers found
                                            </td>
                                        </tr>
                                    ) : (
                                        quizzesByTeacher.map(({ teacher, totalQuizzes, totalAttempts }) => (
                                            <tr key={teacher.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="font-semibold text-gray-900">{teacher.first_name} {teacher.last_name}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                                    {teacher.email}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold">
                                                        {totalQuizzes}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-semibold">
                                                        {totalAttempts}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                                                        totalQuizzes > 0 
                                                            ? 'bg-green-100 text-green-800' 
                                                            : 'bg-gray-100 text-gray-600'
                                                    }`}>
                                                        {totalQuizzes > 0 ? 'Active' : 'Inactive'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Detailed Quiz List */}
                        <h3 className="text-xl font-bold text-gray-900 mb-4">
                            Quiz Details {filterTeacher !== 'all' && `(${teachers.find(t => t.id === parseInt(filterTeacher))?.name})`}
                        </h3>
                        {filteredQuizzes.length === 0 ? (
                            <div className="text-center py-12 bg-gray-50 rounded-xl">
                                <FileText size={64} className="mx-auto mb-4 text-gray-300" />
                                <p className="text-gray-500">No quizzes found</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {filteredQuizzes.map((quiz) => {
                                    const creator = users.find(u => u.id === quiz.creator_id);
                                    return (
                                        <div key={quiz.id} className="border-2 border-gray-200 rounded-xl p-6 hover:border-blue-300 transition">
                                            <div className="flex justify-between items-start">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-3 mb-2">
                                                        <h3 className="text-xl font-bold text-gray-900">{quiz.title}</h3>
                                                        <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">
                                                            {quiz.is_active ? 'Active' : 'Inactive'}
                                                        </span>
                                                    </div>
                                                    <p className="text-gray-600 mb-2">{quiz.description}</p>
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <span className="text-sm text-gray-500">Created by:</span>
                                                        <span className="text-sm font-semibold text-gray-700">
                                                            {creator ? `${creator.first_name} ${creator.last_name}` : 'Unknown'} ({creator?.email || 'N/A'})
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-4 text-sm text-gray-500">
                                                        <span className="flex items-center">
                                                            <FileText size={16} className="mr-1" />
                                                            {quiz.questions?.length || quiz.total_questions || 0} Questions
                                                        </span>
                                                        <span className="flex items-center">
                                                            <Clock size={16} className="mr-1" />
                                                            {quiz.duration_minutes || 30} mins
                                                        </span>
                                                        <span className="flex items-center">
                                                            <Users size={16} className="mr-1" />
                                                            {quiz.attempts || 0} Attempts
                                                        </span>
                                                        {quiz.department && (
                                                            <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-semibold">
                                                                {quiz.department}
                                                            </span>
                                                        )}
                                                        {quiz.year && (
                                                            <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs font-semibold">
                                                                Year {quiz.year}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// Settings Component
const SettingsComponent = ({ currentUserRole }) => {
    const { success, error } = useToast();
    const [activeSection, setActiveSection] = useState('departments');
    const canManageSettings = currentUserRole === 'admin' || currentUserRole === 'teacher';
    
    // Load from localStorage or use defaults
    const [departments, setDepartments] = useState(() => {
        const saved = localStorage.getItem('quiz_departments');
        return saved ? JSON.parse(saved) : [
            'Computer Science Engg.',
            'Mechanical Engineering',
            'Electrical Engineering',
            'Civil Engineering',
            'Electronics & Communication'
        ];
    });
    
    const [newDepartment, setNewDepartment] = useState('');
    
    const [gradingScale, setGradingScale] = useState(() => {
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
    });
    
    const [platformSettings, setPlatformSettings] = useState(() => {
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
    });

    const handleAddDepartment = () => {
        if (!canManageSettings) {
            error('You do not have permission to modify settings');
            return;
        }
        if (!newDepartment.trim()) {
            error('Please enter a department name');
            return;
        }
        if (departments.includes(newDepartment.trim())) {
            error('Department already exists');
            return;
        }
        const updated = [...departments, newDepartment.trim()];
        setDepartments(updated);
        localStorage.setItem('quiz_departments', JSON.stringify(updated));
        setNewDepartment('');
        success('Department added successfully');
    };

    const handleRemoveDepartment = (dept) => {
        if (!canManageSettings) {
            error('You do not have permission to modify settings');
            return;
        }
        const updated = departments.filter(d => d !== dept);
        setDepartments(updated);
        localStorage.setItem('quiz_departments', JSON.stringify(updated));
        success('Department removed successfully');
    };

    const handleSaveGradingScale = () => {
        if (!canManageSettings) {
            error('You do not have permission to modify settings');
            return;
        }
        // Validate grading scale
        const sorted = [...gradingScale].sort((a, b) => b.minPercentage - a.minPercentage);
        let valid = true;
        
        for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].minPercentage > sorted[i].maxPercentage) {
                valid = false;
                break;
            }
        }

        if (!valid) {
            error('Invalid grading scale: Min percentage cannot be greater than max percentage');
            return;
        }

        localStorage.setItem('quiz_grading_scale', JSON.stringify(gradingScale));
        success('Grading scale saved successfully');
    };

    const handleSavePlatformSettings = () => {
        if (!canManageSettings) {
            error('You do not have permission to modify settings');
            return;
        }
        if (platformSettings.defaultQuizDuration < 1) {
            error('Quiz duration must be at least 1 minute');
            return;
        }
        if (platformSettings.maxQuestionsPerQuiz < platformSettings.minQuestionsPerQuiz) {
            error('Max questions cannot be less than min questions');
            return;
        }
        localStorage.setItem('quiz_platform_settings', JSON.stringify(platformSettings));
        success('Platform settings saved successfully');
    };

    if (!canManageSettings) {
        return (
            <div className="bg-white p-10 rounded-2xl shadow-lg border border-gray-100 text-center">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
                <p className="text-gray-600">You do not have permission to view or modify settings.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Info Banner */}
            <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-2xl shadow-lg p-6">
                <div className="flex items-start gap-4">
                    <Settings size={32} className="flex-shrink-0 mt-1" />
                    <div>
                        <h3 className="text-xl font-bold mb-2">Settings are Active!</h3>
                        <p className="text-blue-100 mb-2">
                            Your configurations are saved locally and will be applied across the platform:
                        </p>
                        <ul className="space-y-1 text-sm text-blue-50">
                            <li>✓ <strong>Departments:</strong> Available in user creation and quiz assignment filters</li>
                            <li>✓ <strong>Grading Scale:</strong> Used to calculate letter grades from quiz scores</li>
                            <li>✓ <strong>Platform Settings:</strong> Default values for new quizzes and system behavior</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 md:p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">System Settings</h2>
                <p className="text-gray-600 mb-6">Configure platform settings and preferences</p>

                {/* Section Tabs */}
                <div className="flex flex-wrap gap-2 mb-6 border-b border-gray-200 pb-2">
                    <button
                        onClick={() => setActiveSection('departments')}
                        className={`px-4 sm:px-6 py-3 font-semibold transition rounded-lg ${
                            activeSection === 'departments'
                                ? 'border-b-2 border-blue-600 text-blue-600'
                                : 'text-gray-600 hover:text-blue-600'
                        }`}
                    >
                        Departments
                        <span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded-full">
                            {departments.length}
                        </span>
                    </button>
                    <button
                        onClick={() => setActiveSection('grading')}
                        className={`px-4 sm:px-6 py-3 font-semibold transition rounded-lg ${
                            activeSection === 'grading'
                                ? 'border-b-2 border-blue-600 text-blue-600'
                                : 'text-gray-600 hover:text-blue-600'
                        }`}
                    >
                        Grading Scale
                        <span className="ml-2 px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full">
                            {gradingScale.length} grades
                        </span>
                    </button>
                    <button
                        onClick={() => setActiveSection('platform')}
                        className={`px-4 sm:px-6 py-3 font-semibold transition rounded-lg ${
                            activeSection === 'platform'
                                ? 'border-b-2 border-blue-600 text-blue-600'
                                : 'text-gray-600 hover:text-blue-600'
                        }`}
                    >
                        Platform Settings
                        <span className="ml-2 px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded-full">
                            8 options
                        </span>
                    </button>
                </div>

                {/* Department Management */}
                {activeSection === 'departments' && (
                    <div className="space-y-4">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
                            <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded-lg flex-1">
                                <p className="text-sm text-blue-900">
                                    <strong>Department Management:</strong> Add or remove departments for student classification.
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    const defaults = [
                                        'Computer Science Engg.',
                                        'Mechanical Engineering',
                                        'Electrical Engineering',
                                        'Civil Engineering',
                                        'Electronics & Communication'
                                    ];
                                    setDepartments(defaults);
                                    localStorage.setItem('quiz_departments', JSON.stringify(defaults));
                                    success('Reset to default departments');
                                }}
                                className="w-full lg:w-auto lg:ml-4 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition text-sm font-semibold"
                            >
                                Reset to Defaults
                            </button>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <input
                                type="text"
                                value={newDepartment}
                                onChange={(e) => setNewDepartment(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleAddDepartment()}
                                placeholder="Enter department name"
                                className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none"
                            />
                            <button
                                onClick={handleAddDepartment}
                                className="w-full sm:w-auto justify-center px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition flex items-center"
                            >
                                <Plus size={20} className="mr-2" />
                                Add
                            </button>
                        </div>

                        <div className="space-y-2">
                            <h3 className="font-semibold text-gray-700">Current Departments:</h3>
                            {departments.length === 0 ? (
                                <p className="text-gray-500 text-center py-8">No departments added yet</p>
                            ) : (
                                <div className="space-y-2">
                                    {departments.map((dept, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition"
                                        >
                                            <span className="font-medium text-gray-800">{dept}</span>
                                            <button
                                                onClick={() => handleRemoveDepartment(dept)}
                                                className="text-red-600 hover:text-red-800 hover:bg-red-50 p-2 rounded-lg transition"
                                            >
                                                <X size={20} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Grading Scale */}
                {activeSection === 'grading' && (
                    <div className="space-y-4">
                        <div className="bg-green-50 border-l-4 border-green-600 p-4 rounded-lg">
                            <p className="text-sm text-green-900">
                                <strong>Grading Scale:</strong> Define grade boundaries based on percentage scores.
                            </p>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Grade</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Min %</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Max %</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {gradingScale.map((scale, index) => (
                                        <tr key={index} className="hover:bg-gray-50">
                                            <td className="px-6 py-4">
                                                <input
                                                    type="text"
                                                    value={scale.grade}
                                                    onChange={(e) => {
                                                        const newScale = [...gradingScale];
                                                        newScale[index].grade = e.target.value;
                                                        setGradingScale(newScale);
                                                    }}
                                                    className="w-20 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                                                />
                                            </td>
                                            <td className="px-6 py-4">
                                                <input
                                                    type="number"
                                                    value={scale.minPercentage}
                                                    onChange={(e) => {
                                                        const newScale = [...gradingScale];
                                                        newScale[index].minPercentage = parseInt(e.target.value) || 0;
                                                        setGradingScale(newScale);
                                                    }}
                                                    className="w-24 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                                                    min="0"
                                                    max="100"
                                                />
                                            </td>
                                            <td className="px-6 py-4">
                                                <input
                                                    type="number"
                                                    value={scale.maxPercentage}
                                                    onChange={(e) => {
                                                        const newScale = [...gradingScale];
                                                        newScale[index].maxPercentage = parseInt(e.target.value) || 0;
                                                        setGradingScale(newScale);
                                                    }}
                                                    className="w-24 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                                                    min="0"
                                                    max="100"
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <button
                            onClick={handleSaveGradingScale}
                            className="w-full sm:w-auto justify-center px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition flex items-center"
                        >
                            <Save size={20} className="mr-2" />
                            Save Grading Scale
                        </button>
                    </div>
                )}

                {/* Platform Settings */}
                {activeSection === 'platform' && (
                    <div className="space-y-6">
                        <div className="bg-purple-50 border-l-4 border-purple-600 p-4 rounded-lg">
                            <p className="text-sm text-purple-900">
                                <strong>Platform Settings:</strong> Configure default quiz parameters and behavior.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Quiz Duration */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                    Default Quiz Duration (minutes)
                                </label>
                                <input
                                    type="number"
                                    value={platformSettings.defaultQuizDuration}
                                    onChange={(e) => setPlatformSettings({
                                        ...platformSettings,
                                        defaultQuizDuration: parseInt(e.target.value) || 30
                                    })}
                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none"
                                    min="1"
                                />
                            </div>

                            {/* Grace Period */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                    Default Grace Period (minutes)
                                </label>
                                <input
                                    type="number"
                                    value={platformSettings.defaultGracePeriod}
                                    onChange={(e) => setPlatformSettings({
                                        ...platformSettings,
                                        defaultGracePeriod: parseInt(e.target.value) || 5
                                    })}
                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none"
                                    min="0"
                                />
                            </div>

                            {/* Marks Per Question */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                    Default Marks Per Question
                                </label>
                                <input
                                    type="number"
                                    value={platformSettings.defaultMarksPerQuestion}
                                    onChange={(e) => setPlatformSettings({
                                        ...platformSettings,
                                        defaultMarksPerQuestion: parseFloat(e.target.value) || 1
                                    })}
                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none"
                                    min="0"
                                    step="0.25"
                                />
                            </div>

                            {/* Negative Marking */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                    Default Negative Marking
                                </label>
                                <input
                                    type="number"
                                    value={platformSettings.defaultNegativeMarking}
                                    onChange={(e) => setPlatformSettings({
                                        ...platformSettings,
                                        defaultNegativeMarking: parseFloat(e.target.value) || 0
                                    })}
                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none"
                                    min="0"
                                    step="0.25"
                                />
                            </div>

                            {/* Max Questions */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                    Max Questions Per Quiz
                                </label>
                                <input
                                    type="number"
                                    value={platformSettings.maxQuestionsPerQuiz}
                                    onChange={(e) => setPlatformSettings({
                                        ...platformSettings,
                                        maxQuestionsPerQuiz: parseInt(e.target.value) || 100
                                    })}
                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none"
                                    min="1"
                                />
                            </div>

                            {/* Min Questions */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                    Min Questions Per Quiz
                                </label>
                                <input
                                    type="number"
                                    value={platformSettings.minQuestionsPerQuiz}
                                    onChange={(e) => setPlatformSettings({
                                        ...platformSettings,
                                        minQuestionsPerQuiz: parseInt(e.target.value) || 1
                                    })}
                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none"
                                    min="1"
                                />
                            </div>
                        </div>

                        {/* Toggles */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                                <div>
                                    <h4 className="font-semibold text-gray-800">Allow Student Retake</h4>
                                    <p className="text-sm text-gray-600">Students can retake quizzes multiple times</p>
                                </div>
                                <button
                                    onClick={() => setPlatformSettings({
                                        ...platformSettings,
                                        allowStudentRetake: !platformSettings.allowStudentRetake
                                    })}
                                    className={`relative inline-flex h-8 w-14 items-center rounded-full transition ${
                                        platformSettings.allowStudentRetake ? 'bg-green-600' : 'bg-gray-300'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-6 w-6 transform rounded-full bg-white transition ${
                                            platformSettings.allowStudentRetake ? 'translate-x-7' : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                                <div>
                                    <h4 className="font-semibold text-gray-800">Show Results Immediately</h4>
                                    <p className="text-sm text-gray-600">Display results right after quiz submission</p>
                                </div>
                                <button
                                    onClick={() => setPlatformSettings({
                                        ...platformSettings,
                                        showResultsImmediately: !platformSettings.showResultsImmediately
                                    })}
                                    className={`relative inline-flex h-8 w-14 items-center rounded-full transition ${
                                        platformSettings.showResultsImmediately ? 'bg-green-600' : 'bg-gray-300'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-6 w-6 transform rounded-full bg-white transition ${
                                            platformSettings.showResultsImmediately ? 'translate-x-7' : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </div>
                        </div>

                        <button
                            onClick={handleSavePlatformSettings}
                            className="px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition flex items-center"
                        >
                            <Save size={20} className="mr-2" />
                            Save Platform Settings
                        </button>
                    </div>
                )}
            </div>

            {/* Quick Summary Card */}
            <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl shadow-lg p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Current Configuration Summary</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-xl p-4 shadow-sm">
                        <div className="text-sm text-gray-600 mb-1">Departments</div>
                        <div className="text-2xl font-bold text-blue-600">{departments.length}</div>
                        <div className="text-xs text-gray-500 mt-1">Available for classification</div>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow-sm">
                        <div className="text-sm text-gray-600 mb-1">Grade Levels</div>
                        <div className="text-2xl font-bold text-green-600">{gradingScale.length}</div>
                        <div className="text-xs text-gray-500 mt-1">From {gradingScale[gradingScale.length-1]?.grade} to {gradingScale[0]?.grade}</div>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow-sm">
                        <div className="text-sm text-gray-600 mb-1">Default Duration</div>
                        <div className="text-2xl font-bold text-purple-600">{platformSettings.defaultQuizDuration} min</div>
                        <div className="text-xs text-gray-500 mt-1">For new quizzes</div>
                    </div>
                </div>
                <div className="mt-4 p-3 bg-green-50 border-l-4 border-green-500 rounded">
                    <p className="text-sm text-green-900">
                        <CheckCircle size={16} className="inline mr-2" />
                        <strong>Settings saved for this browser.</strong> These values are read from <code className="bg-green-100 px-1 rounded">localStorage</code> via <code className="bg-green-100 px-1 rounded">utils/settingsHelper.js</code>.
                    </p>
                </div>
            </div>
        </div>
    );
};

// Student Results View - Shows all quiz attempts with student performance
const StudentResultsView = ({ selfOnly = false }) => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { error, success } = useToast();
    const [attempts, setAttempts] = useState([]);
    const [students, setStudents] = useState([]);
    const [quizzes, setQuizzes] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
    const [filterQuiz, setFilterQuiz] = useState('all');
    const [filterStudent, setFilterStudent] = useState('all');
    const [liveQuizFocus, setLiveQuizFocus] = useState('all');
    const [liveMinScore, setLiveMinScore] = useState('');
    const [liveMaxScore, setLiveMaxScore] = useState('');
    const [liveSortBy, setLiveSortBy] = useState('score_desc');
    const [resultsSortBy, setResultsSortBy] = useState('submitted_desc');
    const [kickingAttemptId, setKickingAttemptId] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const LIVE_RESULTS_POLL_MS = 30000;
    const FOCUS_REFRESH_THROTTLE_MS = 15000;
    const lastFocusRefreshRef = useRef(0);

    const isQuizLiveNow = useCallback((quiz) => {
        if (!quiz?.is_live_session || !quiz?.is_active) {
            return false;
        }

        const now = Date.now();

        const startTime = quiz?.live_start_time ? new Date(quiz.live_start_time).getTime() : null;
        const endTime = quiz?.live_end_time ? new Date(quiz.live_end_time).getTime() : null;

        const hasValidStart = Number.isFinite(startTime);
        const hasValidEnd = Number.isFinite(endTime);

        if (!hasValidStart && !hasValidEnd) {
            return true;
        }
        if (!hasValidStart && hasValidEnd) {
            return endTime > now;
        }
        if (hasValidStart && !hasValidEnd) {
            return startTime <= now;
        }

        return startTime <= now && endTime > now;
    }, []);

    const fetchAttemptsOnly = useCallback(async ({ silent = false } = {}) => {
        if (silent) {
            setIsBackgroundRefreshing(true);
        }

        let attemptsData = [];
        try {
            attemptsData = selfOnly
                ? await attemptAPI.getMyAttempts()
                : await attemptAPI.getAllAttempts({ completed_only: false });
        } catch (err) {
            // Keep existing rows on transient polling failures.
            if (!silent) {
                if (err?.status === 403 || err?.status === 404) {
                    attemptsData = [];
                } else {
                    attemptsData = [];
                }
            } else {
                attemptsData = null;
            }
        } finally {
            if (silent) {
                setIsBackgroundRefreshing(false);
            }
        }

        if (attemptsData !== null) {
            const normalizedAttempts = Array.isArray(attemptsData)
                ? attemptsData.filter((item) => item && typeof item === 'object' && Number.isFinite(Number(item.id)))
                : [];
            setAttempts(normalizedAttempts);
        }
    }, [selfOnly]);

    const fetchStaticData = useCallback(async () => {
        setIsLoading(true);
        try {
            let usersData;
            let quizzesData;

            try {
                if (selfOnly) {
                    usersData = user ? [user] : [];
                } else {
                    usersData = await userAPI.getAllUsers();
                }
            } catch (err) {
                throw new Error(`Users API failed: ${err.message}`);
            }

            try {
                quizzesData = await quizAPI.getAllQuizzes();
            } catch (err) {
                throw new Error(`Quizzes API failed: ${err.message}`);
            }

            const studentsList = usersData.filter(u => u.role === 'student');
            setStudents(studentsList);
            setQuizzes(quizzesData || []);
            await fetchAttemptsOnly({ silent: false });
        } catch (err) {
            // Better error message formatting
            let errorMessage = 'Failed to load student results';
            if (typeof err === 'string') {
                errorMessage = err;
            } else if (err?.message) {
                errorMessage = err.message;
            } else if (err?.data?.detail) {
                errorMessage = err.data.detail;
            } else {
                errorMessage = JSON.stringify(err, null, 2);
            }
            error(errorMessage);
        } finally {
            setIsLoading(false);
        }
    }, [error, fetchAttemptsOnly, selfOnly, user]);

    useEffect(() => {
        fetchStaticData();
    }, [refreshKey, fetchStaticData]);

    useEffect(() => {
        const hasLiveQuizRunning = quizzes.some((quiz) => isQuizLiveNow(quiz));
        const hasInProgressAttempts = attempts.some((attempt) => attempt?.status === 'in_progress');
        const shouldAutoRefresh = hasLiveQuizRunning || hasInProgressAttempts;

        if (!shouldAutoRefresh) {
            setIsBackgroundRefreshing(false);
            return undefined;
        }

        const liveRefresh = setInterval(() => {
            if (document.hidden) {
                return;
            }
            // Live monitor refreshes attempts data only without blocking the whole page.
            fetchAttemptsOnly({ silent: true });
        }, LIVE_RESULTS_POLL_MS);

        return () => clearInterval(liveRefresh);
    }, [fetchAttemptsOnly, quizzes, attempts, isQuizLiveNow]);

    useEffect(() => {
        const onFocus = () => {
            const now = Date.now();
            if (now - lastFocusRefreshRef.current < FOCUS_REFRESH_THROTTLE_MS) {
                return;
            }
            lastFocusRefreshRef.current = now;
            fetchAttemptsOnly({ silent: true });
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [fetchAttemptsOnly]);

    // Filter attempts
    const filteredAttempts = attempts.filter(attempt => {
        if (filterQuiz !== 'all' && attempt.quiz_id !== parseInt(filterQuiz)) return false;
        if (!selfOnly && filterStudent !== 'all' && attempt.student_id !== parseInt(filterStudent)) return false;
        if (selfOnly && user?.id && attempt.student_id !== user.id) return false;
        return true;
    });

    const activeLiveQuizzes = quizzes.filter((quiz) => isQuizLiveNow(quiz));
    const activeLiveQuizIds = new Set(activeLiveQuizzes.map((quiz) => quiz.id));
    const liveAttempts = filteredAttempts.filter(
        (attempt) => attempt.status === 'in_progress' && activeLiveQuizIds.has(attempt.quiz_id)
    );
    const expiredAttempts = filteredAttempts.filter(attempt => attempt.status === 'expired');
    const completedAttempts = filteredAttempts.filter(attempt => attempt.is_completed);
    const bestCompletedAttempts = useMemo(() => {
        const byStudentQuiz = new Map();
        for (const attempt of completedAttempts) {
            const key = `${attempt.student_id}-${attempt.quiz_id}`;
            const existing = byStudentQuiz.get(key);

            if (!existing) {
                byStudentQuiz.set(key, attempt);
                continue;
            }

            // A student may have several completed attempts once a teacher grants
            // reattempts. Keep the best-scoring one; break ties by latest submission.
            const existingScore = toSafeNumber(existing.percentage, -Infinity);
            const currentScore = toSafeNumber(attempt.percentage, -Infinity);
            if (currentScore > existingScore) {
                byStudentQuiz.set(key, attempt);
                continue;
            }
            if (currentScore === existingScore) {
                const existingSubmitted = existing.submitted_at ? new Date(existing.submitted_at).getTime() : 0;
                const currentSubmitted = attempt.submitted_at ? new Date(attempt.submitted_at).getTime() : 0;
                if (currentSubmitted >= existingSubmitted) {
                    byStudentQuiz.set(key, attempt);
                }
            }
        }
        return Array.from(byStudentQuiz.values());
    }, [completedAttempts]);
    const liveMonitorAutoRefreshEnabled = activeLiveQuizzes.length > 0 || liveAttempts.length > 0;
    const minLiveScore = liveMinScore === '' ? null : Number(liveMinScore);
    const maxLiveScore = liveMaxScore === '' ? null : Number(liveMaxScore);
    const focusedLiveAttempts = liveAttempts.filter((attempt) => {
        if (liveQuizFocus !== 'all' && attempt.quiz_id !== parseInt(liveQuizFocus)) {
            return false;
        }

        // Filter by real-time live score percentage from backend.
        const liveScoreMetric = Number(
            attempt?.live_percentage ?? attempt?.percentage ?? attempt?.progress_percentage ?? 0
        );

        if (Number.isFinite(minLiveScore) && liveScoreMetric < minLiveScore) {
            return false;
        }
        if (Number.isFinite(maxLiveScore) && liveScoreMetric > maxLiveScore) {
            return false;
        }

        return true;
    }).sort((a, b) => {
        const scoreA = Number(a?.live_percentage ?? a?.percentage ?? a?.progress_percentage ?? 0);
        const scoreB = Number(b?.live_percentage ?? b?.percentage ?? b?.progress_percentage ?? 0);
        const nameA = String(a?.student_name || a?.student_email || a?.student_id || '').toLowerCase();
        const nameB = String(b?.student_name || b?.student_email || b?.student_id || '').toLowerCase();
        const elapsedA = Number(a?.elapsed_seconds ?? 0);
        const elapsedB = Number(b?.elapsed_seconds ?? 0);

        if (liveSortBy === 'score_asc') return scoreA - scoreB;
        if (liveSortBy === 'elapsed_desc') return elapsedB - elapsedA;
        if (liveSortBy === 'elapsed_asc') return elapsedA - elapsedB;
        if (liveSortBy === 'name_asc') return nameA.localeCompare(nameB);
        if (liveSortBy === 'name_desc') return nameB.localeCompare(nameA);

        if (scoreA !== scoreB) {
            return scoreB - scoreA;
        }
        return Number(b?.answered_count ?? 0) - Number(a?.answered_count ?? 0);
    });

    const sortedLatestCompletedAttempts = useMemo(() => {
        const list = [...bestCompletedAttempts];
        list.sort((a, b) => {
            const submittedA = a?.submitted_at ? new Date(a.submitted_at).getTime() : 0;
            const submittedB = b?.submitted_at ? new Date(b.submitted_at).getTime() : 0;
            const percA = Number(a?.percentage ?? 0);
            const percB = Number(b?.percentage ?? 0);
            const scoreA = Number(a?.score ?? 0);
            const scoreB = Number(b?.score ?? 0);
            const studentA = String(a?.student_name || a?.student_email || a?.student_id || '').toLowerCase();
            const studentB = String(b?.student_name || b?.student_email || b?.student_id || '').toLowerCase();

            if (resultsSortBy === 'submitted_asc') return submittedA - submittedB;
            if (resultsSortBy === 'percentage_desc') return percB - percA;
            if (resultsSortBy === 'percentage_asc') return percA - percB;
            if (resultsSortBy === 'score_desc') return scoreB - scoreA;
            if (resultsSortBy === 'score_asc') return scoreA - scoreB;
            if (resultsSortBy === 'student_asc') return studentA.localeCompare(studentB);
            if (resultsSortBy === 'student_desc') return studentB.localeCompare(studentA);
            return submittedB - submittedA;
        });
        return list;
    }, [bestCompletedAttempts, resultsSortBy]);
    const reviewFlagCount = bestCompletedAttempts.filter(
        (attempt) => attempt?.needs_review || (Array.isArray(attempt?.sanity_flags) && attempt.sanity_flags.length > 0)
    ).length;

    const toSafeNumber = (value, fallback = 0) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    };

    const quizDurationById = useMemo(() => {
        const map = new Map();
        for (const quiz of quizzes) {
            const durationMinutes = Number(quiz?.duration_minutes);
            if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
                map.set(Number(quiz.id), durationMinutes);
            }
        }
        return map;
    }, [quizzes]);

    const formatRemaining = (seconds) => {
        if (seconds === null || seconds === undefined) return '—';
        if (seconds <= 0) return 'Expired';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    const formatElapsed = (attempt) => {
        const elapsedSeconds = Number(attempt?.elapsed_seconds);
        if (Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0) {
            let seconds = Math.max(0, Math.floor(elapsedSeconds));
            if (seconds === 0 && attempt?.status === 'in_progress' && Number(attempt?.answered_count || 0) > 0) {
                seconds = 1;
            }
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins}m ${secs}s`;
        }

        const durationMinutes = Number(
            attempt?.quiz_duration_minutes ?? quizDurationById.get(Number(attempt?.quiz_id))
        );
        const remainingSeconds = Number(attempt?.remaining_seconds);
        if (Number.isFinite(durationMinutes) && durationMinutes > 0 && Number.isFinite(remainingSeconds) && remainingSeconds >= 0) {
            let derived = Math.max(0, Math.floor(durationMinutes * 60) - Math.floor(remainingSeconds));
            if (derived === 0 && attempt?.status === 'in_progress' && Number(attempt?.answered_count || 0) > 0) {
                derived = 1;
            }
            const mins = Math.floor(derived / 60);
            const secs = derived % 60;
            return `${mins}m ${secs}s`;
        }

        const startedAt = attempt?.started_at;
        if (!startedAt) return '—';
        const started = new Date(startedAt);
        const now = new Date();
        let seconds = Math.max(0, Math.floor((now - started) / 1000));
        if (seconds === 0 && attempt?.status === 'in_progress' && Number(attempt?.answered_count || 0) > 0) {
            seconds = 1;
        }
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    // Get student name by ID
    const getStudentName = (studentId) => {
        const student = students.find(s => s.id === studentId);
        return student ? `${student.first_name} ${student.last_name}` : 'Unknown';
    };

    const handleKickOut = async (attempt) => {
        if (!attempt?.id) return;

        const studentName = attempt.student_name || getStudentName(attempt.student_id);
        const confirmed = window.confirm(`Kick ${studentName} out of this live quiz? Their current attempt will be submitted.`);
        if (!confirmed) {
            return;
        }

        setKickingAttemptId(attempt.id);
        try {
            await attemptAPI.kickOutAttempt(attempt.id);
            success(`${studentName} was removed from the live quiz.`);
            // Optimistic local update avoids a fragile immediate refetch path on some deployments.
            setAttempts((prev) => Array.isArray(prev) ? prev.filter((row) => Number(row?.id) !== Number(attempt.id)) : []);
        } catch (err) {
            const status = Number(err?.status);
            if (status === 404 || status === 405 || status === 422) {
                const backendUrl = err?.data?.backend_url;
                const suffix = backendUrl ? ` Backend URL: ${backendUrl}` : '';
                error(`Kick-out endpoint is not available on backend deployment yet. Please redeploy backend, then try again.${suffix}`);
            } else {
                error(err?.data?.detail || err?.message || 'Failed to kick out student');
            }
        } finally {
            setKickingAttemptId(null);
        }
    };

    // Export to CSV
    const exportToCSV = () => {
        if (sortedLatestCompletedAttempts.length === 0) {
            error('No data to export');
            return;
        }

        const headers = ['Student Name', 'Email', 'Quiz', 'Score', 'Total Marks', 'Percentage', 'Grade', 'Correct Answers', 'Total Questions', 'Time Taken', 'Submitted At', 'Status'];
        const csvData = sortedLatestCompletedAttempts.map((attempt) => {
            const percentage = toSafeNumber(attempt?.percentage, 0);
            const score = toSafeNumber(attempt?.score, 0);
            const grade = getGradeFromPercentage(percentage);
            return [
                attempt.student_name || getStudentName(attempt.student_id),
                attempt.student_email || '',
                attempt.quiz_title || `Quiz ${attempt.quiz_id}`,
                score.toFixed(1),
                attempt.quiz_total_marks || attempt.total_marks,
                percentage.toFixed(1) + '%',
                grade,
                attempt.correct_answers || 0,
                attempt.total_questions || 0,
                attempt.time_taken || 'N/A',
                attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString() : 'Not submitted',
                `${grade === 'F' || grade === 'N/A' ? 'Failed' : 'Passed'}${attempt?.needs_review ? ' (Review)' : ''}`
            ];
        });

        const csv = [headers, ...csvData].map(row => row.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `student-results-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        success('Report exported successfully');
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
            <div className="mb-6 flex flex-col sm:flex-row justify-between items-start gap-3 sm:gap-0">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">{selfOnly ? 'My Quiz Results' : 'Student Quiz Results'}</h2>
                    <p className="text-gray-600">{selfOnly ? 'View your quiz attempts and performance' : 'View all student quiz attempts and performance'}</p>
                </div>
                <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                    <button
                        onClick={() => setRefreshKey(prev => prev + 1)}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors w-full sm:w-auto"
                        title="Refresh results"
                    >
                        <RefreshCw size={20} />
                        Refresh
                    </button>
                    <button
                        onClick={exportToCSV}
                        disabled={sortedLatestCompletedAttempts.length === 0}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors w-full sm:w-auto"
                    >
                        <Download size={20} />
                        Export Report
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-4 mb-6">
                <div className="w-full sm:w-auto">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Quiz</label>
                    <select
                        value={filterQuiz}
                        onChange={(e) => setFilterQuiz(e.target.value)}
                        className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="all">All Quizzes</option>
                        {quizzes.map(quiz => (
                            <option key={quiz.id} value={quiz.id}>{quiz.title}</option>
                        ))}
                    </select>
                </div>

                {!selfOnly && (
                    <div className="w-full sm:w-auto">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Student</label>
                        <select
                            value={filterStudent}
                            onChange={(e) => setFilterStudent(e.target.value)}
                            className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="all">All Students</option>
                            {students.map(student => (
                                <option key={student.id} value={student.id}>
                                    {student.first_name} {student.last_name}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {/* Live Session Monitor */}
            {!selfOnly && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-red-900">Live Session Monitor</h3>
                    <span className="text-xs text-red-700 bg-red-100 px-2 py-1 rounded-full">
                        {liveMonitorAutoRefreshEnabled
                            ? `Auto-refresh: 30s${isBackgroundRefreshing ? ' (syncing...)' : ''}`
                            : 'Auto-refresh paused (no active live session)'}
                    </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                    <div className="bg-white border border-red-200 rounded-lg px-3 py-2">
                        <p className="text-xs text-red-700">Active Live Quizzes</p>
                        <p className="text-lg font-bold text-red-900">{activeLiveQuizzes.length}</p>
                    </div>
                    <div className="bg-white border border-red-200 rounded-lg px-3 py-2">
                        <p className="text-xs text-red-700">Students In Progress</p>
                        <p className="text-lg font-bold text-red-900">{liveAttempts.length}</p>
                    </div>
                    <div className="bg-white border border-red-200 rounded-lg px-3 py-2">
                        <p className="text-xs text-red-700">Selected Monitor Rows</p>
                        <p className="text-lg font-bold text-red-900">{focusedLiveAttempts.length}</p>
                    </div>
                </div>

                {expiredAttempts.length > 0 && (
                    <p className="text-xs text-amber-800 mb-3 bg-amber-100 border border-amber-200 rounded px-2 py-1 inline-block">
                        {expiredAttempts.length} attempt(s) are expired and awaiting submission finalization.
                    </p>
                )}

                <p className="text-xs text-red-800 mb-3">
                    Live monitor tracks only students who are currently <strong>in progress</strong>; completed attempts are shown in the results table below.
                </p>

                <div className="mb-3 max-w-sm">
                    <label className="block text-xs font-medium text-red-800 mb-1">Focus by Quiz</label>
                    <select
                        value={liveQuizFocus}
                        onChange={(e) => setLiveQuizFocus(e.target.value)}
                        className="w-full px-3 py-2 border border-red-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-red-300 focus:border-red-300"
                    >
                        <option value="all">All Live Quizzes</option>
                        {activeLiveQuizzes.map(quiz => (
                            <option key={quiz.id} value={quiz.id}>{quiz.title}</option>
                        ))}
                    </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 max-w-xl">
                    <div>
                        <label className="block text-xs font-medium text-red-800 mb-1">Min Live Score %</label>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            value={liveMinScore}
                            onChange={(e) => setLiveMinScore(e.target.value)}
                            placeholder="e.g. 40"
                            className="w-full px-3 py-2 border border-red-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-red-300 focus:border-red-300"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-red-800 mb-1">Max Live Score %</label>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            value={liveMaxScore}
                            onChange={(e) => setLiveMaxScore(e.target.value)}
                            placeholder="e.g. 90"
                            className="w-full px-3 py-2 border border-red-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-red-300 focus:border-red-300"
                        />
                    </div>
                </div>

                <div className="mb-3 max-w-sm">
                    <label className="block text-xs font-medium text-red-800 mb-1">Sort Live Rows</label>
                    <select
                        value={liveSortBy}
                        onChange={(e) => setLiveSortBy(e.target.value)}
                        className="w-full px-3 py-2 border border-red-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-red-300 focus:border-red-300"
                    >
                        <option value="score_desc">Live Score High-Low</option>
                        <option value="score_asc">Live Score Low-High</option>
                        <option value="elapsed_desc">Elapsed High-Low</option>
                        <option value="elapsed_asc">Elapsed Low-High</option>
                        <option value="name_asc">Student Name A-Z</option>
                        <option value="name_desc">Student Name Z-A</option>
                    </select>
                </div>

                {focusedLiveAttempts.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-red-800 border-b border-red-200">
                                    <th className="px-3 py-2">Student</th>
                                    <th className="px-3 py-2">Quiz</th>
                                    <th className="px-3 py-2">Progress</th>
                                    <th className="px-3 py-2">Live Score %</th>
                                    <th className="px-3 py-2">Elapsed</th>
                                    <th className="px-3 py-2">Remaining</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {focusedLiveAttempts.map((attempt) => (
                                    <tr key={attempt.id} className="border-b border-red-100">
                                        <td className="px-3 py-2 font-medium text-gray-900">{attempt.student_name || getStudentName(attempt.student_id)}</td>
                                        <td className="px-3 py-2 text-gray-700">{attempt.quiz_title || `Quiz ${attempt.quiz_id}`}</td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {attempt.answered_count || 0}/{attempt.total_questions || 0}
                                            <span className="ml-2 text-xs text-gray-500">({toSafeNumber(attempt?.progress_percentage, 0).toFixed(1)}%)</span>
                                        </td>
                                        <td className="px-3 py-2 font-semibold text-gray-800">
                                            {Number(attempt?.live_percentage ?? attempt?.percentage ?? attempt?.progress_percentage ?? 0).toFixed(1)}
                                            <span className="ml-2 text-xs text-gray-500">
                                                ({Number(attempt?.live_score ?? attempt?.score ?? 0).toFixed(2)} / {Number(attempt?.quiz_total_marks ?? attempt?.total_marks ?? 0).toFixed(0)})
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{formatElapsed(attempt)}</td>
                                        <td className="px-3 py-2 font-semibold text-red-700">{formatRemaining(attempt.remaining_seconds)}</td>
                                        <td className="px-3 py-2">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                                attempt.status === 'expired'
                                                    ? 'bg-amber-100 text-amber-800'
                                                    : 'bg-yellow-100 text-yellow-800'
                                            }`}>
                                                {attempt.status === 'expired' ? 'Expired' : 'In Progress'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <button
                                                onClick={() => handleKickOut(attempt)}
                                                disabled={kickingAttemptId === attempt.id}
                                                className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {kickingAttemptId === attempt.id ? 'Kicking...' : 'Kick Out'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="text-sm text-red-800">No students are currently in an active quiz session for the selected quiz.</p>
                )}
            </div>
            )}

            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600">Completed Attempts (Latest)</div>
                    <div className="text-2xl font-bold text-blue-600">{bestCompletedAttempts.length}</div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600">Average Score</div>
                    <div className="text-2xl font-bold text-green-600">
                        {bestCompletedAttempts.length > 0
                            ? (bestCompletedAttempts.reduce((sum, a) => sum + toSafeNumber(a?.percentage, 0), 0) / bestCompletedAttempts.length).toFixed(1)
                            : '0'}%
                    </div>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600">Pass Rate</div>
                    <div className="text-2xl font-bold text-yellow-600">
                        {bestCompletedAttempts.length > 0
                            ? ((bestCompletedAttempts.filter(a => {
                                const grade = getGradeFromPercentage(toSafeNumber(a?.percentage, 0));
                                return grade !== 'F' && grade !== 'N/A';
                            }).length / bestCompletedAttempts.length) * 100).toFixed(1)
                            : '0'}%
                    </div>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600">{selfOnly ? 'Completed Attempts' : 'Completed Unique Students'}</div>
                    <div className="text-2xl font-bold text-purple-600">
                        {selfOnly
                            ? bestCompletedAttempts.length
                            : new Set(bestCompletedAttempts.map(a => a.student_id)).size}
                    </div>
                </div>
            </div>

            <div className="mb-4 max-w-sm">
                <label className="block text-sm font-medium text-gray-700 mb-2">Sort Completed Results</label>
                <select
                    value={resultsSortBy}
                    onChange={(e) => setResultsSortBy(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                    <option value="submitted_desc">Submitted Newest First</option>
                    <option value="submitted_asc">Submitted Oldest First</option>
                    <option value="percentage_desc">Percentage High-Low</option>
                    <option value="percentage_asc">Percentage Low-High</option>
                    <option value="score_desc">Score High-Low</option>
                    <option value="score_asc">Score Low-High</option>
                    <option value="student_asc">Student Name A-Z</option>
                    <option value="student_desc">Student Name Z-A</option>
                </select>
            </div>

            {!selfOnly && reviewFlagCount > 0 && (
                <div className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {reviewFlagCount} completed attempt(s) flagged for review due to scoring/time sanity checks.
                </div>
            )}

            {/* Results Table */}
            {isLoading ? (
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-500">Loading results...</p>
                </div>
            ) : filteredAttempts.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b-2 border-gray-200">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase">Student</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase">Quiz</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase">Score</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase">Percentage</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase">Grade</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase">Correct/Total</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase">Time Taken</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase">Submitted</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase">Action</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                                    {sortedLatestCompletedAttempts.map((attempt) => {
                                const percentage = toSafeNumber(attempt?.percentage, 0);
                                const score = toSafeNumber(attempt?.score, 0);
                                const totalMarks = toSafeNumber(attempt?.quiz_total_marks ?? attempt?.total_marks, 0);
                                const grade = getGradeFromPercentage(percentage);
                                const passed = grade !== 'F' && grade !== 'N/A';
                                
                                return (
                                    <tr key={attempt.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="font-semibold text-gray-900">
                                                {getStudentName(attempt.student_id)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                            {attempt.quiz_title || 'Quiz ' + attempt.quiz_id}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="font-bold text-gray-900">
                                                {score.toFixed(1)} / {totalMarks}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`font-bold ${passed ? 'text-green-600' : 'text-red-600'}`}>
                                                {percentage.toFixed(1)}%
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${passed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                {grade}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                            {attempt.correct_answers || 0} / {attempt.total_questions || 0}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                            {attempt.time_taken || 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                            {attempt.submitted_at 
                                                ? new Date(attempt.submitted_at).toLocaleString()
                                                : 'Not submitted'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                {passed ? (
                                                    <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold flex items-center gap-1 w-fit">
                                                        <CheckCircle size={14} />
                                                        Passed
                                                    </span>
                                                ) : (
                                                    <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-bold flex items-center gap-1 w-fit">
                                                        <XCircle size={14} />
                                                        Failed
                                                    </span>
                                                )}
                                                {(attempt?.needs_review || (Array.isArray(attempt?.sanity_flags) && attempt.sanity_flags.length > 0)) && (
                                                    <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">
                                                        Review
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <button
                                                onClick={() => navigate(`/quiz-result/${attempt.id}`)}
                                                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-xs font-semibold"
                                            >
                                                View Result
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="text-center py-12">
                    <Trophy size={48} className="mx-auto mb-4 text-gray-400" />
                    <p className="text-gray-500">No quiz results found</p>
                </div>
            )}
        </div>
    );
};

const ExtendedProfileView = ({ user, profileImage, onPickProfileImage, onRemoveProfileImage }) => {
    const identityValue = user ? getDisplayUserId(user) : 'Not assigned';
    const identityLabel = user?.role === 'student'
        ? 'Student ID'
        : user?.role === 'teacher'
            ? 'Teacher ID'
            : 'Admin Account';

    return (
        <div className="space-y-6">
            <div className="bg-white p-5 sm:p-6 rounded-2xl shadow-lg border border-gray-100">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">My Profile</h2>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 sm:gap-6">
                    <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-blue-600 overflow-hidden flex items-center justify-center text-white font-bold text-4xl shadow-lg ring-4 ring-blue-100">
                        {profileImage ? (
                            <img src={profileImage} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                            `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase() || 'U'
                        )}
                    </div>

                    <div className="min-w-0">
                        <p className="text-xl sm:text-2xl font-semibold text-gray-900 break-words">{user?.first_name} {user?.last_name}</p>
                        <p className="text-sm text-gray-500 break-all">{user?.email}</p>
                        <p className="text-xs text-gray-500 mt-1 capitalize">Role: {user?.role || 'user'}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                        <button
                            onClick={onPickProfileImage}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-semibold"
                        >
                            {profileImage ? 'Change Image' : 'Upload Image'}
                        </button>
                        {profileImage && (
                            <button
                                onClick={onRemoveProfileImage}
                                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition text-sm font-semibold"
                            >
                                Remove
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-white p-5 sm:p-6 rounded-2xl shadow-lg border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Extended Profile View</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <p className="text-xs text-gray-500 mb-1">Full Name</p>
                        <p className="font-semibold text-gray-900 break-words">{user?.first_name} {user?.last_name}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <p className="text-xs text-gray-500 mb-1">Email</p>
                        <p className="font-semibold text-gray-900 break-all">{user?.email || 'N/A'}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <p className="text-xs text-gray-500 mb-1">{identityLabel}</p>
                        <p className="font-semibold text-gray-900 break-words">{identityValue}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <p className="text-xs text-gray-500 mb-1">Department</p>
                        <p className="font-semibold text-gray-900">{user?.department || 'N/A'}</p>
                    </div>
                    {user?.role === 'student' && (
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <p className="text-xs text-gray-500 mb-1">Class / Year</p>
                            <p className="font-semibold text-gray-900">{user?.class_year || 'N/A'}</p>
                        </div>
                    )}
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <p className="text-xs text-gray-500 mb-1">Account Status</p>
                        <p className={`font-semibold ${user?.is_active ? 'text-green-700' : 'text-red-700'}`}>
                            {user?.is_active ? 'Active' : 'Inactive'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StudentUnifiedView = ({ activeTab, user, profileImage, onPickProfileImage, onRemoveProfileImage }) => {
    const navigate = useNavigate();
    const { error } = useToast();
    const [quizzes, setQuizzes] = useState([]);
    const [attempts, setAttempts] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [quizzesData, attemptsData] = await Promise.all([
                quizAPI.getAllQuizzes().catch(() => []),
                attemptAPI.getMyAttempts().catch(() => []),
            ]);

            const activeQuizzes = Array.isArray(quizzesData)
                ? quizzesData.filter((quiz) => quiz && quiz.is_active === true)
                : [];

            setQuizzes(activeQuizzes);
            setAttempts(Array.isArray(attemptsData) ? attemptsData : []);
        } catch (err) {
            error(err?.data?.detail || err?.message || 'Failed to load student data');
            setQuizzes([]);
            setAttempts([]);
        } finally {
            setIsLoading(false);
        }
    }, [error]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const QuizCard = ({ quiz }) => {
        const hasCompleted = attempts.some((a) => a.quiz_id === quiz.id && a.is_completed);
        return (
            <div className="bg-white p-5 rounded-xl border border-gray-200 hover:shadow-md transition">
                <div className="flex justify-between items-start gap-3">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900">{quiz.title || 'Untitled Quiz'}</h3>
                        <p className="text-sm text-gray-600 mt-1">{quiz.description || 'No description available'}</p>
                        <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                            <span className="flex items-center"><FileText size={15} className="mr-1" />{quiz.total_questions || 0} Qs</span>
                            <span className="flex items-center"><Clock size={15} className="mr-1" />{quiz.duration_minutes || 30} mins</span>
                            <span className="flex items-center"><Trophy size={15} className="mr-1" />{quiz.total_marks || 0} marks</span>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate(`/quiz/${quiz.id}/take`)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                        {hasCompleted ? 'Reattempt' : 'Start'}
                    </button>
                </div>
            </div>
        );
    };

    if (activeTab === 'Profile') {
        return (
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">My Profile</h2>
                <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="w-20 h-20 rounded-full bg-blue-600 overflow-hidden flex items-center justify-center text-white font-bold text-2xl">
                        {profileImage ? (
                            <img src={profileImage} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                            `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase() || 'U'
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={onPickProfileImage}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-semibold"
                        >
                            Upload Image
                        </button>
                        {profileImage && (
                            <button
                                onClick={onRemoveProfileImage}
                                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition text-sm font-semibold"
                            >
                                Remove
                            </button>
                        )}
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-700">
                    <div><span className="text-gray-500">Name:</span> {user?.first_name} {user?.last_name}</div>
                    <div><span className="text-gray-500">Email:</span> {user?.email}</div>
                    <div><span className="text-gray-500">Student ID:</span> {user?.student_id || 'N/A'}</div>
                    <div><span className="text-gray-500">Class:</span> {user?.class_year || 'N/A'}</div>
                </div>
            </div>
        );
    }

    if (activeTab === 'My Progress') {
        return (
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">My Progress</h2>
                {isLoading ? (
                    <p className="text-gray-500">Loading progress...</p>
                ) : attempts.length === 0 ? (
                    <p className="text-gray-500">No attempts yet.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Quiz</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Score</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Grade</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Submitted</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {attempts.map((attempt) => {
                                    const percentage = attempt.percentage || 0;
                                    const grade = getGradeFromPercentage(percentage);
                                    return (
                                        <tr key={attempt.id} className="border-b hover:bg-gray-50">
                                            <td className="px-4 py-3 text-sm text-gray-800">{attempt.quiz_title || `Quiz ${attempt.quiz_id}`}</td>
                                            <td className="px-4 py-3 text-sm font-semibold text-gray-900">{percentage.toFixed(1)}%</td>
                                            <td className="px-4 py-3 text-sm"><span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">{grade}</span></td>
                                            <td className="px-4 py-3 text-sm text-gray-600">{attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString() : 'Not submitted'}</td>
                                            <td className="px-4 py-3 text-sm">
                                                {attempt.is_completed ? (
                                                    <button
                                                        onClick={() => navigate(`/quiz-result/${attempt.id}`)}
                                                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-xs font-semibold"
                                                    >
                                                        View Result
                                                    </button>
                                                ) : (
                                                    <span className="text-gray-400 text-xs">In Progress</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    }

    if (activeTab === 'My Quizzes') {
        return (
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 space-y-4">
                <h2 className="text-2xl font-bold text-gray-900">My Quizzes</h2>
                {isLoading ? <p className="text-gray-500">Loading quizzes...</p> : quizzes.length > 0 ? quizzes.map((quiz) => <QuizCard key={quiz.id} quiz={quiz} />) : <p className="text-gray-500">No quizzes available right now.</p>}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-xl shadow border border-gray-100">
                    <p className="text-sm text-gray-600">Total Attempts</p>
                    <p className="text-3xl font-bold text-blue-600">{attempts.length}</p>
                </div>
                <div className="bg-white p-5 rounded-xl shadow border border-gray-100">
                    <p className="text-sm text-gray-600">Average Score</p>
                    <p className="text-3xl font-bold text-green-600">
                        {attempts.length ? (attempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / attempts.length).toFixed(1) : '0.0'}%
                    </p>
                </div>
                <div className="bg-white p-5 rounded-xl shadow border border-gray-100">
                    <p className="text-sm text-gray-600">Available Quizzes</p>
                    <p className="text-3xl font-bold text-purple-600">{quizzes.length}</p>
                </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-900">Quick Start</h2>
                    <button onClick={fetchData} className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition">Refresh</button>
                </div>
                {isLoading ? <p className="text-gray-500">Loading quizzes...</p> : quizzes.slice(0, 3).map((quiz) => <QuizCard key={quiz.id} quiz={quiz} />)}
                {!isLoading && quizzes.length === 0 && <p className="text-gray-500">No quizzes available right now.</p>}
            </div>
        </div>
    );
};


/**
 * --- MAIN APPLICATION COMPONENT (Admin Dashboard) ---
 */
export default function AdminDashboard() {
    const navigate = useNavigate();
    const { user, logout, checkAuth } = useAuth();
    const { success, error } = useToast();

    const roleLabel = user?.role === 'teacher' ? 'Teacher' : user?.role === 'student' ? 'Student' : 'Administrator';
    const portalLabel = user?.role === 'teacher' ? 'Teacher Portal' : user?.role === 'student' ? 'Student Portal' : 'Admin';
    const userInitials = `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase() || 'U';
    const identityLabel = user?.role === 'student' ? 'Student ID' : user?.role === 'teacher' ? 'Teacher ID' : 'Admin ID';
    const identityValue = user ? getDisplayUserId(user) : 'N/A';
    
    // userViewMode can be 'list' (show table) or 'add' (show form)
    const [activeTab, setActiveTab] = useState('Dashboard');
    const [userViewMode, setUserViewMode] = useState('list');
    const [userListRefresh, setUserListRefresh] = useState(0);
    const [statsLoading, setStatsLoading] = useState(true);
    const [statsRefresh, setStatsRefresh] = useState(0);
    const [statsData, setStatsData] = useState(null);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const profileMenuRef = useRef(null);
    const profileImageInputRef = useRef(null);
    const [profileImage, setProfileImage] = useState('');
    const hasMountedRef = useRef(false);

    useEffect(() => {
        if (!user?.id) {
            setProfileImage('');
            return;
        }
        setProfileImage(user?.profile_image || '');
    }, [user?.id, user?.profile_image]);

    const triggerProfileImagePicker = () => {
        profileImageInputRef.current?.click();
    };

    const fileToDataUrl = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image'));
        reader.readAsDataURL(file);
    });

    const compressImageToDataUrl = (file, maxSide = 800, quality = 0.82) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const width = img.width || 1;
                const height = img.height || 1;
                const scale = Math.min(1, maxSide / Math.max(width, height));
                canvas.width = Math.max(1, Math.round(width * scale));
                canvas.height = Math.max(1, Math.round(height * scale));

                const context = canvas.getContext('2d');
                if (!context) {
                    reject(new Error('Image processing is unavailable in this browser'));
                    return;
                }

                context.drawImage(img, 0, 0, canvas.width, canvas.height);
                const optimized = canvas.toDataURL('image/jpeg', quality);
                resolve(optimized);
            };
            img.onerror = () => reject(new Error('Failed to process image'));
            img.src = String(reader.result || '');
        };
        reader.onerror = () => reject(new Error('Failed to read image'));
        reader.readAsDataURL(file);
    });

    const handleProfileImageSelected = async (event) => {
        const file = event.target?.files?.[0];
        if (!file) return;

        const isImage = file.type?.startsWith('image/');
        if (!isImage) {
            error('Please select an image file.');
            return;
        }

        // Keep upload/payload bounded for API and mobile networks.
        if (file.size > 6 * 1024 * 1024) {
            error('Image is too large. Please select an image smaller than 6 MB.');
            return;
        }

        try {
            let dataUrl = await compressImageToDataUrl(file, 800, 0.82);

            // Backend currently rejects very large base64 payloads; reduce quality once more if needed.
            if (dataUrl.length > 2_800_000) {
                dataUrl = await compressImageToDataUrl(file, 640, 0.72);
            }

            // Fallback path in case compression unexpectedly fails to reduce enough.
            if (dataUrl.length > 2_900_000) {
                dataUrl = await fileToDataUrl(file);
            }

            if (dataUrl.length > 2_950_000) {
                error('Image is still too large after optimization. Please choose a smaller image.');
                return;
            }

            await userAPI.updateCurrentUser({ profile_image: dataUrl });
            setProfileImage(dataUrl);
            await checkAuth();
            setIsProfileMenuOpen(false);
            success('Profile image updated successfully.');
        } catch (errObj) {
            const detail = errObj?.data?.detail || errObj?.message || 'Failed to update profile image.';
            error(`Failed to update profile image: ${detail}`);
        } finally {
            // Allow selecting the same file again.
            if (event.target) {
                event.target.value = '';
            }
        }
    };

    const removeProfileImage = () => {
        userAPI.updateCurrentUser({ profile_image: null })
            .then(async () => {
                setProfileImage('');
                await checkAuth();
                setIsProfileMenuOpen(false);
                success('Profile image removed.');
            })
            .catch((errObj) => {
                const detail = errObj?.data?.detail || errObj?.message || 'Failed to remove profile image.';
                error(`Failed to remove profile image: ${detail}`);
            });
    };

    const fetchDashboardStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            if (user?.role === 'admin') {
                const data = await analyticsAPI.getDashboardStats();
                setStatsData({ kind: 'admin', data });
                return;
            }

            if (user?.role === 'teacher' && user?.id) {
                const [data, completedAttempts] = await Promise.all([
                    analyticsAPI.getTeacherStats(user.id),
                    attemptAPI.getAllAttempts({ completed_only: true, limit: 300, skip: 0 }),
                ]);

                // Reduce to each student's best attempt per quiz so granted
                // reattempts don't inflate the unique-student count or the average.
                const bestByStudentQuiz = new Map();
                for (const attempt of completedAttempts || []) {
                    const studentId = attempt?.student_id;
                    if (studentId === null || studentId === undefined) continue;
                    const key = `${studentId}-${attempt?.quiz_id}`;
                    const pct = Number(attempt?.percentage);
                    const existing = bestByStudentQuiz.get(key);
                    const existingPct = existing && Number.isFinite(Number(existing.percentage))
                        ? Number(existing.percentage)
                        : -Infinity;
                    if (!existing || (Number.isFinite(pct) && pct > existingPct)) {
                        bestByStudentQuiz.set(key, attempt);
                    }
                }
                const bestAttempts = Array.from(bestByStudentQuiz.values());

                const uniqueStudents = new Set(
                    bestAttempts
                        .map((attempt) => attempt?.student_id)
                        .filter((studentId) => studentId !== null && studentId !== undefined)
                ).size;

                const percentages = bestAttempts
                    .map((attempt) => Number(attempt?.percentage))
                    .filter((value) => Number.isFinite(value));

                const computedAvg = percentages.length
                    ? Number((percentages.reduce((sum, value) => sum + value, 0) / percentages.length).toFixed(2))
                    : null;

                const mergedTeacherStats = {
                    ...data,
                    students_attempted: uniqueStudents,
                    average_quiz_score: computedAvg,
                };
                setStatsData({ kind: 'teacher', data: mergedTeacherStats });
                return;
            }

            if (user?.role === 'student' && user?.id) {
                const data = await analyticsAPI.getStudentStats(user.id);
                setStatsData({ kind: 'student', data });
                return;
            }

            setStatsData(null);
        } catch (_err) {
            // Keep the dashboard usable even if stats fail to load
            setStatsData(null);
        } finally {
            setStatsLoading(false);
        }
    }, [user?.id, user?.role]);

    useEffect(() => {
        fetchDashboardStats();
    }, [fetchDashboardStats, statsRefresh]);

    // Refresh stats whenever user navigates back to Dashboard
    useEffect(() => {
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return;
        }
        if (activeTab === 'Dashboard') {
            setStatsRefresh(prev => prev + 1);
        }
    }, [activeTab]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
                setIsProfileMenuOpen(false);
            }
        };

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setIsProfileMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    // Calculate dynamic stats from real user data
    const dynamicStats = useMemo(() => {
        if (statsData?.kind === 'admin' && statsData?.data) {
            const s = statsData.data;

            return [
                {
                    title: "Total Quizzes Held",
                    value: String(s.total_quizzes ?? 0),
                    icon: FileText,
                    color: "bg-blue-100/50 text-blue-800",
                    subtitle: `${s.active_quizzes ?? 0} active`,
                    trend: "Updated",
                },
                {
                    title: "Total Students",
                    value: String(s.total_students ?? 0),
                    icon: UserCheck,
                    color: "bg-indigo-100/50 text-indigo-800",
                    subtitle: `${s.active_students ?? 0} active`,
                    trend: "Updated",
                },
                {
                    title: "Total Teachers",
                    value: String(s.total_teachers ?? 0),
                    icon: Users,
                    color: "bg-green-100/50 text-green-800",
                    subtitle: `${s.active_teachers ?? 0} active`,
                    trend: "Updated",
                },
                {
                    title: "Total Attempts",
                    value: String(s.total_attempts ?? 0),
                    icon: Trophy,
                    color: "bg-yellow-100/50 text-yellow-800",
                    subtitle: `${s.yesterday_assessments ?? 0} yesterday`,
                    trend: "Updated",
                },
            ];
        }

        if (statsData?.kind === 'teacher' && statsData?.data) {
            const s = statsData.data;
            const avg = s.average_quiz_score;
            const avgLabel = avg === null || avg === undefined ? 'N/A' : `${avg}%`;

            return [
                {
                    title: "Quizzes Created",
                    value: String(s.total_quizzes_created ?? 0),
                    icon: FileText,
                    color: "bg-blue-100/50 text-blue-800",
                    subtitle: `${s.active_quizzes ?? 0} active`,
                    trend: "Updated",
                },
                {
                    title: "Students Attempted",
                    value: String(s.students_attempted ?? 0),
                    icon: Users,
                    color: "bg-indigo-100/50 text-indigo-800",
                    subtitle: "Unique students", 
                    trend: "Updated",
                },
                {
                    title: "Average Score",
                    value: avgLabel,
                    icon: TrendingUp,
                    color: "bg-green-100/50 text-green-800",
                    subtitle: "Completed attempts",
                    trend: "Updated",
                },
                {
                    title: "Questions Authored",
                    value: String(s.total_questions_authored ?? 0),
                    icon: ClipboardList,
                    color: "bg-yellow-100/50 text-yellow-800",
                    subtitle: `${s.subjects_taught ?? 0} subjects taught`,
                    trend: "Updated",
                },
            ];
        }

        if (statsData?.kind === 'student' && statsData?.data) {
            const s = statsData.data;
            const avgLabel = s.average_percentage === null || s.average_percentage === undefined
                ? 'N/A'
                : `${s.average_percentage}%`;

            return [
                {
                    title: "Quizzes Attempted",
                    value: String(s.total_quizzes_attempted ?? 0),
                    icon: FileText,
                    color: "bg-blue-100/50 text-blue-800",
                    subtitle: `${s.quizzes_completed ?? 0} completed`,
                    trend: "Updated",
                },
                {
                    title: "Average",
                    value: avgLabel,
                    icon: TrendingUp,
                    color: "bg-green-100/50 text-green-800",
                    subtitle: "Completed attempts",
                    trend: "Updated",
                },
                {
                    title: "Highest Score",
                    value: String(s.highest_score ?? 'N/A'),
                    icon: Trophy,
                    color: "bg-indigo-100/50 text-indigo-800",
                    subtitle: "Best attempt",
                    trend: "Updated",
                },
                {
                    title: "Pending Quizzes",
                    value: String(s.pending_quizzes ?? 0),
                    icon: Clock,
                    color: "bg-yellow-100/50 text-yellow-800",
                    subtitle: "Not attempted yet",
                    trend: "Updated",
                },
            ];
        }

        // Fallback cards (e.g., not logged in yet)
        return [
            {
                title: "Total Quizzes Held",
                value: "0",
                icon: FileText,
                color: "bg-blue-100/50 text-blue-800",
                subtitle: "Stats unavailable",
                trend: "N/A",
            },
            {
                title: "Total Students",
                value: "0",
                icon: UserCheck,
                color: "bg-indigo-100/50 text-indigo-800",
                subtitle: "Stats unavailable",
                trend: "N/A",
            },
            {
                title: "Total Teachers",
                value: "0",
                icon: Users,
                color: "bg-green-100/50 text-green-800",
                subtitle: "Stats unavailable",
                trend: "N/A",
            },
            {
                title: "Total Attempts",
                value: "0",
                icon: Trophy,
                color: "bg-yellow-100/50 text-yellow-800",
                subtitle: "Stats unavailable",
                trend: "N/A",
            },
        ];
    }, [statsData]);

    const handleLogout = () => {
        if (window.confirm('Are you sure you want to logout?')) {
            logout();
            success('Logged out successfully');
            navigate('/');
        }
    };

    // Handler when user is created successfully
    const handleUserCreated = () => {
        setUserListRefresh(prev => prev + 1); // Trigger refresh
        setStatsRefresh(prev => prev + 1);
    };

    // Role-based navigation
    const navItems = user?.role === 'teacher' ? [
        { name: "Dashboard", icon: LayoutDashboard, title: "Dashboard" },
        { name: "Quizzes", icon: FileText, title: "My Quizzes" },
        { name: "Students", icon: Users, title: "My Students" },
        { name: "Student Results", icon: Trophy, title: "Student Results" },
        { name: "Profile", icon: UserCheck, title: "Profile" },
        { name: "SDC Team", icon: Code2, title: "SDC Team" },
        { name: "Settings", icon: Settings, title: "Settings" },
    ] : user?.role === 'student' ? [
        { name: "Dashboard", icon: LayoutDashboard, title: "Dashboard" },
        { name: "My Quizzes", icon: FileText, title: "My Quizzes" },
        { name: "My Progress", icon: Trophy, title: "My Progress" },
        { name: "Profile", icon: Users, title: "Profile" },
        { name: "SDC Team", icon: Code2, title: "SDC Team" },
    ] : [
        { name: "Dashboard", icon: LayoutDashboard, title: "Dashboard" },
        { name: "Users", icon: Users, title: "User Management", onClick: () => setUserViewMode('list') },
        { name: "Teachers", icon: Users, title: "Teacher Activity Lookup" },
        { name: "Students", icon: Users, title: "Student Activity Lookup" },
        { name: "Quizzes", icon: FileText, title: "Quiz Management" },
        { name: "Student Results", icon: Trophy, title: "Student Results" },
        { name: "Detailed Reports", icon: BarChart3, title: "Detailed Reports" },
        { name: "Profile", icon: UserCheck, title: "Profile" },
        { name: "SDC Team", icon: Code2, title: "SDC Team" },
        { name: "Settings", icon: Settings, title: "Settings" },
    ];

    useEffect(() => {
        const allowedTabsByRole = {
            teacher: ["Dashboard", "Quizzes", "Students", "Student Results", "Profile", "SDC Team", "Settings"],
            student: ["Dashboard", "My Quizzes", "My Progress", "Profile", "SDC Team"],
            admin: ["Dashboard", "Users", "Teachers", "Students", "Quizzes", "Student Results", "Detailed Reports", "Profile", "SDC Team", "Settings"],
        };

        const role = user?.role || 'student';
        const allowedTabs = allowedTabsByRole[role] || allowedTabsByRole.student;

        if (!allowedTabs.includes(activeTab)) {
            setActiveTab('Dashboard');
            setUserViewMode('list');
        }
    }, [activeTab, user?.role]);

    // Handler to switch to Users tab and open the Add User form immediately
    const handleAddNewUser = () => {
        setActiveTab('Users');
        setUserViewMode('add');
    };

    const getCurrentTitle = () => {
        if (activeTab === 'Users' && userViewMode === 'add') {
            return 'Add New User';
        }
        const currentItem = navItems.find(item => item.name === activeTab);
        return currentItem ? currentItem.title : activeTab;
    }

    const renderContent = () => {
        switch (activeTab) {
            case 'Dashboard': { // Added braces to fix no-case-declarations
                if (user?.role === 'student') {
                    return <StudentUnifiedView activeTab="Dashboard" user={user} profileImage={profileImage} onPickProfileImage={triggerProfileImagePicker} onRemoveProfileImage={removeProfileImage} />;
                }
                return (
                    <div className="space-y-8">
                        {/* 4 Block Metrics (Colors reverted) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            {statsLoading ? (
                                // Loading skeleton
                                Array.from({ length: 4 }).map((_, idx) => (
                                    <div key={idx} className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 animate-pulse">
                                        <div className="flex items-center justify-between">
                                            <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
                                            <div className="h-4 w-24 bg-gray-200 rounded"></div>
                                        </div>
                                        <div className="mt-4">
                                            <div className="h-10 w-20 bg-gray-200 rounded"></div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                dynamicStats.map((stat) => (
                                    <StatCard key={stat.title} {...stat} />
                                ))
                            )}
                        </div>
                        {/* Quick Access Card (Admin only) */}
                        {user?.role === 'admin' && <AddNewUserCard onAddClick={handleAddNewUser} />}

                        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                            <h2 className="text-xl font-semibold text-gray-800 border-b pb-4 mb-4">
                                Recent System Activity
                            </h2>
                            <div className="space-y-2">
                                <div className="text-center py-10 text-gray-500 text-lg">
                                    No activity recorded yet. Start by provisioning users and creating quizzes!
                                </div>
                            </div>
                        </div>
                    </div>
                );
            } // Added braces to fix no-case-declarations
            case 'Users':
                if (user?.role !== 'admin') {
                    return <Placeholder content="You do not have access to User Management." />;
                }
                return userViewMode === 'add' ? (
                    <UserCreationForm 
                        onCancel={() => setUserViewMode('list')} 
                        onUserCreated={handleUserCreated}
                        currentUserRole={user?.role}
                    />
                ) : (
                    <UserList 
                        onAddClick={() => setUserViewMode('add')} 
                        refreshTrigger={userListRefresh}
                    />
                );
            // NEW CASES for dedicated sidebar links
            case 'Teachers':
                return <UserActivityTable userType="Teachers" />;
            case 'Students':
                return user?.role === 'teacher' 
                    ? <TeacherStudentsView />
                    : <UserActivityTable userType="Students" />;
            // Removed old 'Activity Tracker' case
            case 'Quizzes':
                // Teachers can create/manage quizzes, Admins can only monitor
                return user?.role === 'teacher' 
                    ? (
                        <TabErrorBoundary>
                            <TeacherQuizManagement />
                        </TabErrorBoundary>
                    )
                    : (
                        <TabErrorBoundary>
                            <AdminQuizMonitoring />
                        </TabErrorBoundary>
                    );
            case 'My Quizzes':
                return user?.role === 'student'
                    ? <StudentUnifiedView activeTab="My Quizzes" user={user} profileImage={profileImage} onPickProfileImage={triggerProfileImagePicker} onRemoveProfileImage={removeProfileImage} />
                    : <Placeholder content="Page Not Found" />;
            case 'My Progress':
                return user?.role === 'student'
                    ? <StudentUnifiedView activeTab="My Progress" user={user} profileImage={profileImage} onPickProfileImage={triggerProfileImagePicker} onRemoveProfileImage={removeProfileImage} />
                    : <Placeholder content="Page Not Found" />;
            case 'Profile':
                return <ExtendedProfileView user={user} profileImage={profileImage} onPickProfileImage={triggerProfileImagePicker} onRemoveProfileImage={removeProfileImage} />;
            case 'Student Results':
                if (user?.role === 'student') {
                    return <Placeholder content="Page Not Found" />;
                }
                return (
                    <TabErrorBoundary>
                        <StudentResultsView />
                    </TabErrorBoundary>
                );
            case 'Detailed Reports':
                return <DetailedReportsTool />;
            case 'SDC Team':
                return <SdcTeamSection />;
            case 'Settings':
                return user?.role === 'student'
                    ? <Placeholder content="You do not have access to Settings." />
                    : <SettingsComponent currentUserRole={user?.role} />;
            default:
                return <Placeholder content="Page Not Found" />;
        }
    };

    // Generic placeholder component for unimplemented tabs
    const Placeholder = ({ content }) => (
        <div className="bg-white p-12 rounded-2xl shadow-lg border border-gray-100 text-center text-gray-500 h-96 flex items-center justify-center">
            <p className="text-2xl font-medium max-w-lg">{content}</p>
        </div>
    );

    return (
        <div className="min-h-screen flex flex-col lg:flex-row font-inter bg-gray-50">
            {/* Mobile Header */}
            <div className="lg:hidden border-b shadow-md p-4 flex items-center justify-between sticky top-0 z-30 bg-white">
                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => setActiveTab('Dashboard')}
                        className="text-xl font-bold text-blue-600"
                    >
                        MacQuiz
                    </button>
                    <span className="text-sm text-gray-500">
                        {roleLabel}
                    </span>
                </div>
                <button
                    onClick={handleLogout}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                >
                    <LogOut size={20} />
                </button>
            </div>

            {/* Sidebar Navigation */}
            <aside className="hidden lg:flex w-64 flex-col fixed inset-y-0 border-r shadow-lg z-20 bg-white">
                <div className="p-6 text-2xl font-extrabold text-blue-700 border-b">
                    MacQuiz <span className="text-gray-400 font-light">
                        {portalLabel}
                    </span>
                </div>
                <nav className="flex-1 p-4 flex flex-col min-h-0">
                    <div className="space-y-2 overflow-y-auto pr-1">
                        {navItems.map((item) => {
                            const isActive = activeTab === item.name;
                            return (
                                <button
                                    key={item.name}
                                    onClick={() => {
                                        setActiveTab(item.name);
                                        if (item.onClick) item.onClick();
                                    }}
                                    className={`w-full flex items-center p-3 rounded-xl transition duration-150 text-left space-x-3
                                        ${isActive
                                            ? 'bg-blue-600 text-white shadow-md' // Active: Blue BG, White Text
                                            : 'text-gray-600 hover:bg-gray-100 hover:text-blue-600' // Hover: Light Gray BG, Blue Text
                                        }`}
                                >
                                    <item.icon size={20} />
                                    <span className="font-medium">{item.title}</span>
                                </button>
                            );
                        })}
                    </div>
                </nav>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 lg:ml-64 p-3 sm:p-4 md:p-6 lg:p-8 pb-24 lg:pb-8 w-full overflow-x-hidden">
                <input
                    ref={profileImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProfileImageSelected}
                />
                {/* Header/Title with Profile Avatar */}
                <header className="mb-4 sm:mb-6 md:mb-8 flex flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                    <div className="min-w-0 flex-1">
                        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900">
                            {getCurrentTitle()}
                        </h1>
                        <p className="text-gray-500 mt-1">
                            {activeTab === 'Dashboard'
                                ? (user?.role === 'student' ? "Your quizzes and progress overview." : "System overview and quick access actions.")
                                : activeTab === 'Profile'
                                    ? "View and manage your account details and profile image."
                                    : "Detailed views and management tools."}
                        </p>
                    </div>

                    {/* Profile Dropdown - Available on mobile and desktop */}
                    <div className="flex items-start self-auto shrink-0" ref={profileMenuRef}>
                        <div className="relative">
                            <button
                                onClick={() => setIsProfileMenuOpen(prev => !prev)}
                                className="flex items-center gap-2 sm:gap-3 px-1.5 sm:px-3 py-1.5 sm:py-2 rounded-xl hover:bg-gray-100 transition duration-150 border border-gray-200"
                            >
                                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-blue-600 overflow-hidden flex items-center justify-center text-white font-bold text-lg sm:text-xl shadow-md">
                                    {profileImage ? (
                                        <img src={profileImage} alt="Profile" className="w-full h-full object-cover" />
                                    ) : (
                                        userInitials
                                    )}
                                </div>
                                <div className="hidden md:block text-right">
                                    <p className="text-xs sm:text-sm font-semibold text-gray-800">{roleLabel}</p>
                                    <p className="text-xs text-gray-500">{identityLabel}: {identityValue}</p>
                                </div>
                                <ChevronDown
                                    size={16}
                                    className={`hidden sm:block text-gray-500 transition-transform duration-150 ${isProfileMenuOpen ? 'rotate-180' : ''}`}
                                />
                            </button>

                            {isProfileMenuOpen && (
                                <div className="absolute right-0 mt-2 w-[92vw] max-w-xs sm:w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden origin-top-right transform transition-all duration-200 ease-out opacity-100 scale-100 translate-y-0 animate-[fadeIn_0.18s_ease-out]">
                                    <div className="px-4 py-3 border-b bg-gray-50">
                                        <p className="text-sm font-semibold text-gray-900">{user?.first_name} {user?.last_name}</p>
                                        <p className="text-xs text-gray-500">{user?.email}</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setIsProfileMenuOpen(false);
                                            setActiveTab('Profile');
                                        }}
                                        className="w-full flex items-center px-4 py-3 text-gray-800 hover:bg-gray-50 transition text-sm font-medium"
                                    >
                                        <Users size={16} className="mr-2" />
                                        View Profile
                                    </button>
                                    <button
                                        onClick={() => {
                                            setIsProfileMenuOpen(false);
                                            handleLogout();
                                        }}
                                        className="w-full flex items-center px-4 py-3 text-red-600 hover:bg-red-50 transition text-sm font-medium"
                                    >
                                        <LogOut size={16} className="mr-2" />
                                        Logout
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                {renderContent()}
            </main>

            {/* Mobile Bottom Navigation */}
            <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-30">
                <div className="flex items-center py-2 px-2 gap-2 overflow-x-auto scrollbar-hide">
                    {navItems.map((item) => (
                        <button
                            key={item.name}
                            onClick={() => {
                                setActiveTab(item.name);
                                if (item.onClick) item.onClick();
                            }}
                            className={`flex-shrink-0 min-w-[72px] flex flex-col items-center p-2 rounded-lg transition ${
                                activeTab === item.name
                                    ? 'text-blue-600'
                                    : 'text-gray-600'
                            }`}
                        >
                            <item.icon size={20} />
                            <span className="text-xs mt-1">{item.title.split(' ')[0]}</span>
                        </button>
                    ))}
                </div>
            </nav>

            <div className="hidden sm:block fixed left-3 bottom-20 lg:bottom-4 z-40 pointer-events-none">
                <img
                    src={sdcLogo}
                    alt="SDC Logo"
                    className="w-[160px] sm:w-[180px] h-auto object-contain"
                />
            </div>

        </div>
    );
}