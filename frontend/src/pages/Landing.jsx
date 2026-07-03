import React from "react";
import { useNavigate } from "react-router-dom";
import {
    GraduationCap, ShieldCheck, Users, BookOpen, BarChart3, Sparkles,
    Upload, Timer, CheckCircle2, ListChecks, ToggleLeft, PenLine, ArrowRight, LogIn,
} from "lucide-react";
import Logo from "../assets/sdc-logo.png";

const FONT = { fontFamily: "Inter, sans-serif" };

const ROLES = [
    {
        icon: ShieldCheck,
        title: "Admins",
        blurb: "Full command over people, quizzes and insights.",
        accent: "from-blue-500 to-blue-600",
        points: [
            "Manage teachers & students",
            "Bulk import users via Excel / CSV",
            "Real-time analytics dashboard",
            "AI-powered performance reports",
        ],
    },
    {
        icon: GraduationCap,
        title: "Teachers",
        blurb: "Author assessments and follow every attempt.",
        accent: "from-indigo-500 to-indigo-600",
        points: [
            "Create & manage quizzes",
            "MCQ, True/False & Short Answer",
            "Department & class based filtering",
            "Review student attempts and scores",
        ],
    },
    {
        icon: Users,
        title: "Students",
        blurb: "Practice, submit and grow with instant feedback.",
        accent: "from-purple-500 to-purple-600",
        points: [
            "Browse available quizzes",
            "Instant result calculation",
            "Track history & performance",
            "Class-specific assessments",
        ],
    },
];

const HIGHLIGHTS = [
    {
        icon: Sparkles,
        title: "AI-Powered Insights",
        text: "Turn raw attempts into readable, actionable reports with built-in AI analytics.",
    },
    {
        icon: Upload,
        title: "Bulk Onboarding",
        text: "Import users and entire question banks from Excel or CSV in a single click.",
    },
    {
        icon: BarChart3,
        title: "Live Dashboards",
        text: "Watch engagement, scores and activity update in real time as quizzes run.",
    },
    {
        icon: Timer,
        title: "Timed & Instant",
        text: "Set durations, auto-score submissions and surface results the moment they finish.",
    },
];

const QUESTION_TYPES = [
    { icon: ListChecks, label: "Multiple Choice" },
    { icon: ToggleLeft, label: "True / False" },
    { icon: PenLine, label: "Short Answer" },
];

const STATS = [
    { value: "3", label: "Question types", accent: "from-blue-500 to-blue-600" },
    { value: "3", label: "Role-based views", accent: "from-indigo-500 to-indigo-600" },
    { value: "Instant", label: "Auto scoring", accent: "from-purple-500 to-purple-600" },
    { value: "AI", label: "Smart reports", accent: "from-blue-600 to-indigo-600" },
];

const FOCUS_RING =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

function GradientText({ children }) {
    return (
        <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            {children}
        </span>
    );
}

function Eyebrow({ children }) {
    return (
        <span className="inline-flex items-center gap-3 text-xs font-bold uppercase tracking-[0.22em] text-gray-500">
            <span className="h-px w-8 bg-gradient-to-r from-transparent via-blue-600 to-indigo-600" aria-hidden="true" />
            {children}
            <span className="h-px w-8 bg-gradient-to-l from-transparent via-blue-600 to-indigo-600" aria-hidden="true" />
        </span>
    );
}

/* Decorative hero props (xl and up only) */
function FloatingQuizCard() {
    return (
        <div aria-hidden="true" className="mq-fade-up pointer-events-none absolute -right-2 top-24 hidden w-64 xl:block" style={{ animationDelay: "0.6s" }}>
            <div className="mq-float rotate-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Question 4 / 10</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                        <Timer size={12} /> 04:32
                    </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-gray-800">
                    Which HTTP status code means &ldquo;Created&rdquo;?
                </p>
                <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">200 OK</div>
                    <div className="flex items-center justify-between rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-md">
                        201 Created <CheckCircle2 size={14} />
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">204 No Content</div>
                </div>
            </div>
        </div>
    );
}

function FloatingScoreCard() {
    return (
        <div aria-hidden="true" className="mq-fade-up pointer-events-none absolute -left-2 top-40 hidden w-56 xl:block" style={{ animationDelay: "0.7s" }}>
            <div className="mq-float-slow -rotate-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-xl">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md">
                        <BarChart3 size={18} />
                    </div>
                    <div className="leading-tight">
                        <p className="text-sm font-bold text-gray-900">Scored 92%</p>
                        <p className="text-[11px] font-medium text-gray-500">Result, instantly</p>
                    </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full w-[92%] rounded-full bg-gradient-to-r from-blue-500 to-indigo-600" />
                </div>
                <p className="mt-2 text-[11px] font-medium text-gray-500">Attempt auto-scored on submit</p>
            </div>
        </div>
    );
}

export default function Landing() {
    const navigate = useNavigate();
    const goLogin = () => navigate("/login");

    return (
        <div
            className="mq-landing relative min-h-screen overflow-x-clip bg-gray-50 font-inter text-gray-800"
            style={FONT}
        >
            {/* White sticky navbar (mirrors the app shell) */}
            <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/90 shadow-sm backdrop-blur">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8">
                    <a
                        href="#top"
                        className={`flex items-center gap-3 rounded-xl ${FOCUS_RING}`}
                        aria-label="MacQuiz home"
                    >
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm">
                            <img src={Logo} alt="SDC logo" className="h-8 w-8 object-contain" />
                        </div>
                        <div className="leading-tight">
                            <p className="text-lg font-extrabold tracking-tight text-blue-700">MacQuiz</p>
                            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">
                                Software Development Cell
                            </p>
                        </div>
                    </a>
                    <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
                        <a href="#features" className={`rounded-md text-sm font-semibold text-gray-600 transition hover:text-blue-600 ${FOCUS_RING}`}>
                            Features
                        </a>
                        <a href="#capabilities" className={`rounded-md text-sm font-semibold text-gray-600 transition hover:text-blue-600 ${FOCUS_RING}`}>
                            Capabilities
                        </a>
                    </nav>
                    <button
                        onClick={goLogin}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition duration-300 hover:bg-blue-700 ${FOCUS_RING}`}
                    >
                        <LogIn size={16} /> Sign In
                    </button>
                </div>
            </header>

            <main id="top">
                {/* Hero on the app's soft blue -> indigo -> purple gradient band */}
                <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
                    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                        <div className="mq-float absolute -top-24 -left-16 h-72 w-72 rounded-full bg-blue-300/30 blur-3xl" />
                        <div className="mq-float-slow absolute -right-20 top-1/3 h-96 w-96 rounded-full bg-indigo-300/25 blur-3xl" />
                        <div className="mq-float absolute -bottom-16 left-1/4 h-80 w-80 rounded-full bg-purple-300/25 blur-3xl" />
                    </div>

                    <div className="relative z-10 mx-auto max-w-7xl px-5 pt-14 pb-20 sm:px-8 sm:pt-20 lg:pt-24">
                        <FloatingScoreCard />
                        <FloatingQuizCard />
                        <div className="mx-auto max-w-3xl text-center">
                            <span
                                className="mq-fade-up inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-semibold text-gray-700 shadow-sm"
                                style={{ animationDelay: "0.05s" }}
                            >
                                <Sparkles size={14} className="text-blue-600" aria-hidden="true" />
                                Role-based quiz &amp; assessment platform
                            </span>
                            <h1
                                className="mq-fade-up mt-7 text-4xl font-extrabold leading-[1.08] tracking-tight text-gray-900 sm:text-6xl"
                                style={{ animationDelay: "0.15s" }}
                            >
                                Assess. Learn. <GradientText>Improve.</GradientText>
                            </h1>
                            <p
                                className="mq-fade-up mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600 sm:text-xl"
                                style={{ animationDelay: "0.25s" }}
                            >
                                MacQuiz is a complete quiz management system for admins, teachers and
                                students, with instant scoring, live dashboards and AI-powered insights,
                                all in one clean workspace.
                            </p>
                            <div
                                className="mq-fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
                                style={{ animationDelay: "0.35s" }}
                            >
                                <button
                                    onClick={goLogin}
                                    className={`group inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 py-3.5 text-base font-bold text-white shadow-lg transition duration-300 hover:bg-blue-700 sm:w-auto ${FOCUS_RING}`}
                                >
                                    Get Started
                                    <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
                                </button>
                                <a
                                    href="#features"
                                    className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-7 py-3.5 text-base font-semibold text-gray-700 shadow-sm transition duration-300 hover:bg-gray-50 sm:w-auto ${FOCUS_RING}`}
                                >
                                    Explore Features
                                </a>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Stats: saturated gradient tiles (mirrors the dashboard stat cards) */}
                <section className="relative z-20 mx-auto max-w-5xl px-5 sm:px-8">
                    <dl className="mq-fade-up -mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4" style={{ animationDelay: "0.45s" }}>
                        {STATS.map((s) => (
                            <div
                                key={s.label}
                                className={`rounded-2xl bg-gradient-to-br ${s.accent} p-5 text-white shadow-lg`}
                            >
                                <dd className="text-3xl font-extrabold tracking-tight">{s.value}</dd>
                                <dt className="mt-1 text-sm font-medium text-white/85">{s.label}</dt>
                            </div>
                        ))}
                    </dl>
                </section>

                {/* Role cards */}
                <section id="features" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-16 sm:px-8">
                    <div className="mx-auto max-w-2xl text-center">
                        <Eyebrow>Who it&rsquo;s for</Eyebrow>
                        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
                            Built for <GradientText>every role</GradientText>
                        </h2>
                        <p className="mt-4 text-lg text-gray-600">
                            One platform, three tailored experiences, so everyone works with exactly
                            what they need.
                        </p>
                    </div>
                    <div className="mt-12 grid gap-6 md:grid-cols-3">
                        {ROLES.map(({ icon: Icon, title, blurb, points, accent }) => (
                            <div
                                key={title}
                                className="group relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-7 shadow-lg transition duration-300 hover:-translate-y-1.5 hover:shadow-xl"
                            >
                                <div
                                    className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 to-indigo-600 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                                    aria-hidden="true"
                                />
                                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${accent} text-white shadow-md`}>
                                    <Icon size={26} aria-hidden="true" />
                                </div>
                                <h3 className="mt-5 text-xl font-bold text-gray-900">{title}</h3>
                                <p className="mt-1.5 text-sm text-gray-600">{blurb}</p>
                                <ul className="mt-5 space-y-3">
                                    {points.map((p) => (
                                        <li key={p} className="flex items-start gap-2.5 text-sm text-gray-700">
                                            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-blue-600" aria-hidden="true" />
                                            <span>{p}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Capabilities */}
                <section id="capabilities" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-16 sm:px-8">
                    <div className="grid items-start gap-10 lg:grid-cols-2">
                        <div>
                            <Eyebrow>Capabilities</Eyebrow>
                            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
                                Everything you need to run <GradientText>great assessments</GradientText>
                            </h2>
                            <p className="mt-4 text-lg text-gray-600">
                                From onboarding hundreds of users to reading the story behind the
                                scores, MacQuiz keeps the whole quiz lifecycle in one place.
                            </p>
                            <div className="mt-8 rounded-2xl border border-gray-100 bg-white p-6 shadow-lg">
                                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                                    <BookOpen size={18} className="text-blue-600" aria-hidden="true" />
                                    Supported question types
                                </div>
                                <div className="mt-4 flex flex-wrap gap-3">
                                    {QUESTION_TYPES.map(({ icon: Icon, label }) => (
                                        <span
                                            key={label}
                                            className="inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm font-medium text-gray-800"
                                        >
                                            <Icon size={16} className="text-blue-600" aria-hidden="true" /> {label}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="grid gap-5 sm:grid-cols-2">
                            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
                                <div
                                    key={title}
                                    className="rounded-2xl border border-gray-100 bg-white p-6 shadow-lg transition duration-300 hover:-translate-y-1 hover:shadow-xl"
                                >
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                        <Icon size={20} aria-hidden="true" />
                                    </div>
                                    <h3 className="mt-4 text-base font-bold text-gray-900">{title}</h3>
                                    <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{text}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* CTA banner (mirrors the app's blue -> indigo headers) */}
                <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
                    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-14 text-center shadow-xl sm:px-16">
                        <div
                            className="pointer-events-none absolute inset-0 opacity-20"
                            style={{
                                backgroundImage: "radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)",
                                backgroundSize: "22px 22px",
                            }}
                            aria-hidden="true"
                        />
                        <div className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-white/15 blur-2xl" aria-hidden="true" />
                        <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
                        <h2 className="relative text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                            Ready to get smarter every day?
                        </h2>
                        <p className="relative mx-auto mt-4 max-w-xl text-lg text-blue-50">
                            Sign in to your MacQuiz account and start creating, taking and analysing
                            quizzes in minutes.
                        </p>
                        <button
                            onClick={goLogin}
                            className={`group relative mt-8 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-bold text-blue-700 shadow-lg transition duration-300 hover:bg-blue-50 ${FOCUS_RING}`}
                        >
                            Sign In to MacQuiz
                            <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
                        </button>
                    </div>
                </section>
            </main>

            {/* Footer */}
            <footer className="border-t border-gray-100 bg-white">
                <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-7 sm:flex-row sm:px-8">
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white">
                            <img src={Logo} alt="SDC logo" className="h-6 w-6 object-contain" />
                        </div>
                        <span className="text-sm font-extrabold text-blue-700">MacQuiz</span>
                    </div>
                    <nav className="flex items-center gap-6" aria-label="Footer">
                        <a href="#features" className={`rounded-md text-sm font-medium text-gray-600 transition hover:text-blue-600 ${FOCUS_RING}`}>
                            Features
                        </a>
                        <a href="#capabilities" className={`rounded-md text-sm font-medium text-gray-600 transition hover:text-blue-600 ${FOCUS_RING}`}>
                            Capabilities
                        </a>
                        <button onClick={goLogin} className={`cursor-pointer rounded-md text-sm font-medium text-gray-600 transition hover:text-blue-600 ${FOCUS_RING}`}>
                            Sign In
                        </button>
                    </nav>
                    <p className="text-sm text-gray-500">
                        Built by the Software Development Cell &middot; &copy; 2026 MacQuiz
                    </p>
                </div>
            </footer>
        </div>
    );
}
