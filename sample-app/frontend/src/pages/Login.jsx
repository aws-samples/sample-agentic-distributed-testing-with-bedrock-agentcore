import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const DOLLAR_ART = [
  '!%%%%%%%  NATIONAL RESERVE NOTE  %%%%%%%!',
  '!%(1)  THE UNITED STATES OF KICSLAND (1)%!',
  '!%$$         ___________          $$%!',
  '!%$  {x}      (o o)       $$%!',
  '!%$  ******  ( V )   O N E    $$%!',
  '!%(1)       ---m-m---         (1)%!',
  '!%%---------  ONE DOLLAR  ----------%%!',
];

export default function Login() {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate('/menu');
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!userId.trim() || !password.trim()) {
      setError('Please enter both User ID and Password.');
      return;
    }

    setLoading(true);
    try {
      await login(userId.trim(), password);
      navigate('/menu');
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <span style={{ color: '#00ccff' }}>Tran: </span>
            <span style={{ color: '#33ff33' }}>CC00</span>
            {'    '}
            <span style={{ color: '#00ccff' }}>Prog: </span>
            <span style={{ color: '#33ff33' }}>COSGN00C</span>
          </div>
          <div>
            <span style={{ color: '#e0e0e0', fontWeight: 700 }}>AWS Mainframe Modernization</span>
          </div>
          <div>
            <span style={{ color: '#00ccff' }}>SysID: </span>
            <span style={{ color: '#33ff33' }}>AWSA</span>
          </div>
        </div>

        <h1 className="login-title">CardDemo</h1>
        <p className="login-subtitle">Credit Card Demo Application for Mainframe Modernization</p>

        <div style={{
          textAlign: 'center',
          margin: '16px 0',
          padding: '12px',
          border: '1px solid #555',
          color: '#33ff33',
          fontSize: '11px',
          lineHeight: '1.4',
          whiteSpace: 'pre',
          fontFamily: 'var(--term-font)',
        }}>
          {DOLLAR_ART.join('\n')}
        </div>

        <p style={{ color: '#ffff00', textAlign: 'center', marginBottom: '16px', fontSize: '14px' }}>
          Type your User ID and Password, then press ENTER:
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', alignItems: 'center', marginBottom: '8px' }}>
            <label style={{ color: '#00ccff', minWidth: '100px', textAlign: 'right' }}>User ID</label>
            <span style={{ color: '#00ccff' }}>:</span>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              autoFocus
              disabled={loading}
              style={{ width: '200px' }}
              maxLength={8}
            />
            <span style={{ color: '#555' }}>(8 Char)</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', alignItems: 'center', marginBottom: '16px' }}>
            <label style={{ color: '#00ccff', minWidth: '100px', textAlign: 'right' }}>Password</label>
            <span style={{ color: '#00ccff' }}>:</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              style={{ width: '200px' }}
              maxLength={8}
            />
            <span style={{ color: '#555' }}>(8 Char)</span>
          </div>

          <div style={{ borderTop: '1px solid #333', paddingTop: '10px', marginTop: '10px' }}>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ fontWeight: 700 }}>
              {loading ? 'Signing In...' : 'ENTER=Sign-on'}
            </button>
            <span style={{ color: '#33ff33', marginLeft: '16px' }}>F3=Exit</span>
          </div>
        </form>
      </div>
    </div>
  );
}
