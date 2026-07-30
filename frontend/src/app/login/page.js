"use client";
import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";

export default function LoginPage() {
  const { login } = useAuth();
  
  const [view, setView] = useState("LOGIN"); // LOGIN, FORGOT_EMAIL, FORGOT_OTP, FORGOT_RESET
  
  // Form State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  
  // UI State
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotEmail(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await api.post("/auth/forgot-password", { email });
      setMessage(res.message);
      setView("FORGOT_OTP");
    } catch (err) {
      setError(err.message || "Failed to send OTP.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotOtp(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await api.post("/auth/verify-otp", { email, otp });
      setResetToken(res.resetToken);
      setView("FORGOT_RESET");
    } catch (err) {
      setError(err.message || "Invalid OTP.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotReset(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post("/auth/reset-password", { email, resetToken, newPassword });
      setMessage(res.message);
      setView("LOGIN");
      setPassword("");
    } catch (err) {
      setError(err.message || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  }

  function renderView() {
    if (view === "LOGIN") {
      return (
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="form-group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <label className="form-label" style={{ marginBottom: 0 }}>Password</label>
              <button type="button" onClick={() => { setView("FORGOT_EMAIL"); setError(""); setMessage(""); }} style={{ background: "none", border: "none", color: "var(--accent-primary)", fontSize: "12px", cursor: "pointer", padding: 0 }}>Forgot Password?</button>
            </div>
            <div style={{ position: "relative" }}>
              <input 
                className="form-input" 
                type={showPassword ? "text" : "password"} 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required 
                style={{ paddingRight: "40px" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0
                }}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                )}
              </button>
            </div>
          </div>
          <button className="btn btn-primary btn-animated" type="submit" disabled={loading} style={{ width: "100%", marginTop: 6 }}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      );
    }

    if (view === "FORGOT_EMAIL") {
      return (
        <form onSubmit={handleForgotEmail}>
          <div className="form-group">
            <label className="form-label">Email to send OTP</label>
            <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <button className="btn btn-primary btn-animated" type="submit" disabled={loading} style={{ width: "100%", marginTop: 6, marginBottom: 12 }}>
            {loading ? "Sending..." : "Send OTP"}
          </button>
          <div style={{ textAlign: "center" }}>
            <button type="button" onClick={() => { setView("LOGIN"); setError(""); }} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer" }}>Back to Login</button>
          </div>
        </form>
      );
    }

    if (view === "FORGOT_OTP") {
      return (
        <form onSubmit={handleForgotOtp}>
          <div className="form-group">
            <label className="form-label">Enter 6-digit OTP sent to {email}</label>
            <input className="form-input" type="text" value={otp} onChange={(e) => setOtp(e.target.value)} required autoFocus placeholder="123456" maxLength={6} style={{ textAlign: "center", letterSpacing: "4px", fontSize: "16px" }} />
          </div>
          <button className="btn btn-primary btn-animated" type="submit" disabled={loading} style={{ width: "100%", marginTop: 6, marginBottom: 12 }}>
            {loading ? "Verifying..." : "Verify OTP"}
          </button>
          <div style={{ textAlign: "center" }}>
            <button type="button" onClick={() => { setView("FORGOT_EMAIL"); setError(""); }} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer" }}>Change Email</button>
          </div>
        </form>
      );
    }

    if (view === "FORGOT_RESET") {
      return (
        <form onSubmit={handleForgotReset}>
          <div className="form-group">
            <label className="form-label">New Password</label>
            <div style={{ position: "relative" }}>
              <input 
                className="form-input" 
                type={showNewPassword ? "text" : "password"} 
                value={newPassword} 
                onChange={(e) => setNewPassword(e.target.value)} 
                required 
                autoFocus 
                style={{ paddingRight: "40px" }}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                title={showNewPassword ? "Hide password" : "Show password"}
              >
                {showNewPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                )}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <div style={{ position: "relative" }}>
              <input 
                className="form-input" 
                type={showConfirmPassword ? "text" : "password"} 
                value={confirmPassword} 
                onChange={(e) => setConfirmPassword(e.target.value)} 
                required 
                style={{ paddingRight: "40px" }}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                title={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                )}
              </button>
            </div>
          </div>
          <button className="btn btn-primary btn-animated" type="submit" disabled={loading} style={{ width: "100%", marginTop: 6 }}>
            {loading ? "Resetting..." : "Set New Password"}
          </button>
        </form>
      );
    }
  }

  return (
    <>
      <style>{`
        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .login-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          background: linear-gradient(-45deg, var(--navy-50), var(--bg-primary), var(--navy-100), var(--bg-primary));
          background-size: 400% 400%;
          animation: gradientShift 15s ease infinite;
        }
        .login-card {
          animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .btn-animated {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .btn-animated:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .btn-animated:active {
          transform: translateY(0);
        }
      `}</style>
      <div className="login-container">
        <div style={{ width: "100%", maxWidth: 380 }}>
          <div className="card login-card" style={{ padding: "32px 32px 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div className="sidebar-logo" style={{ margin: "0 auto 12px", width: 48, height: 48, fontSize: 20 }}>A</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{view === "LOGIN" ? "Account Payroll" : "Reset Password"}</div>
            {view === "LOGIN" && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Production &amp; Final Payable Management</div>}
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className="alert alert-success">{message}</div>}

          {renderView()}
        </div>
      </div>
    </div>
    </>
  );
}
