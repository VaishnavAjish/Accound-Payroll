"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";

export default function AccountPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (form.newPassword !== form.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/change-password", { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setSuccess("Password updated.");
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <button className="btn btn-secondary btn-sm" onClick={() => router.back()}>← Back</button>
      </div>

      <div className="card" style={{ marginBottom: 16, maxWidth: 460 }}>
        <div className="card-header"><span className="card-title">Profile</span></div>
        <div className="card-body">
          <div className="form-row">
            <div><div className="form-label">Name</div><div>{user.name}</div></div>
            <div><div className="form-label">Role</div><div>{user.role.replace("_", " ")}</div></div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="form-label">Email</div><div>{user.email}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 460 }}>
        <div className="card-header"><span className="card-title">Change Password</span></div>
        <div className="card-body">
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
          <form onSubmit={submit}>
            <div className="form-group">
              <label className="form-label">Current Password</label>
              <input type="password" className="form-input" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
            </div>
            <div className="form-group">
              <label className="form-label">New Password</label>
              <input type="password" className="form-input" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required minLength={8} />
              <div className="form-hint">At least 8 characters.</div>
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input type="password" className="form-input" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required minLength={8} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Update Password"}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
