import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { ProtectedRoute, PublicRoute } from "./components/ProtectedRoute";
import Landing from "./pages/Landing";
import Login from "./pages/login";
import AdminDashboard from "./pages/dashBoard";
import QuizCreator from "./pages/QuizCreator";
import QuizTaker from "./pages/QuizTaker";
import QuizResult from "./pages/QuizResult";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={
              <PublicRoute>
                <Landing />
              </PublicRoute>
            } />
            <Route path="/login" element={
              <PublicRoute>
                <Login />
              </PublicRoute>
            } />
            <Route 
              path="/dashboard" 
              element={
                <ProtectedRoute>
                  <AdminDashboard />
                </ProtectedRoute>
              } 
            />
            {/* Legacy alias to unified dashboard route */}
            <Route 
              path="/student-dashboard" 
              element={
                <ProtectedRoute>
                  <AdminDashboard />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/quiz/create" 
              element={
                <ProtectedRoute>
                  <QuizCreator />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/quiz/edit/:quizId" 
              element={
                <ProtectedRoute>
                  <QuizCreator />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/quiz/:quizId/take" 
              element={
                <ProtectedRoute>
                  <QuizTaker />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/quiz-result/:attemptId" 
              element={
                <ProtectedRoute>
                  <QuizResult />
                </ProtectedRoute>
              } 
            />
            <Route path="*" element={
              <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                  <h1 className="text-5xl sm:text-6xl font-bold text-gray-800 mb-4">404</h1>
                  <p className="text-lg sm:text-xl text-gray-600 mb-8">Page Not Found</p>
                  <a href="/" className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                    Go Home
                  </a>
                </div>
              </div>
            } />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}