import { useState } from 'react';
import { ArrowRight, GraduationCap, Presentation, ShieldCheck } from 'lucide-react';
import { Modal, Button, Logo } from './ui';
import { post } from '../services/api';
export default function AuthModal({ mode, onClose, onSuccess }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.target);
    try {
      await post('/auth/' + (register ? 'register' : 'login'), Object.fromEntries(f));
      await onSuccess();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function demo(role) {
    setBusy(true);
    setError('');
    try {
      await post('/auth/demo', { role });
      await onSuccess();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={register ? 'Start your next chapter' : 'Welcome to your orbit'} onClose={onClose}>
      <p className="modal-intro">Learn something new, or help someone else learn.</p>
      {mode === 'demo' && (
        <>
          <div className="demo-accounts">
            {[
              ['STUDENT', GraduationCap, 'Student', 'Learn, practice, and earn certificates'],
              ['INSTRUCTOR', Presentation, 'Instructor', 'Create courses and host live classes'],
              ['ADMIN', ShieldCheck, 'Admin', 'Manage people and the platform'],
            ].map(([role, Icon, label, desc]) => (
              <button key={role} disabled={busy} onClick={() => demo(role)}>
                <span className="demo-icon">
                  <Icon size={21} />
                </span>
                <span>
                  <b>Explore as {label}</b>
                  <small>{desc}</small>
                </span>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
          <div className="divider">
            <span>or use your account</span>
          </div>
        </>
      )}
      <form onSubmit={submit} className="form-stack">
        {register && (
          <label>
            Your name
            <input
              name="name"
              autoComplete="name"
              required
              minLength={2}
              maxLength={80}
              placeholder="Alex Morgan"
            />
          </label>
        )}
        {register && (
          <>
            <label>
              Account type
              <select name="role" defaultValue="STUDENT" disabled={busy}>
                <option value="STUDENT">Student — learn and earn certificates</option>
                <option value="INSTRUCTOR">Instructor — teach on ClassOrbit</option>
              </select>
            </label>
            <p className="form-hint">
              Instructor accounts can sign in immediately. Creating courses and uploading videos
              requires admin approval.
            </p>
          </>
        )}
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={register ? 'new-password' : 'current-password'}
            required
            minLength={register ? 10 : 1}
            maxLength={128}
            placeholder={register ? 'At least 10 characters' : 'Enter your password'}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button disabled={busy} type="submit">
          {busy ? 'One moment…' : register ? 'Create an account' : 'Sign in'}
          <ArrowRight size={17} />
        </Button>
      </form>
      <p className="auth-toggle">
        {register ? 'Already in orbit?' : 'New around here?'}{' '}
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError('');
          }}
        >
          {register ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </Modal>
  );
}
