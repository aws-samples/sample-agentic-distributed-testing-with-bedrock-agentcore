import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const TRAN_MAP = {
  '/menu': 'CM00',
  '/accounts': 'CAVW',
  '/cards': 'CCVW',
  '/transactions': 'CT00',
  '/transactions/add': 'CTAD',
  '/billing': 'CBIL',
  '/reports': 'CRPT',
  '/users': 'CUSR',
  '/batch': 'CBAT',
};

const PROG_MAP = {
  '/menu': 'COMEN01C',
  '/accounts': 'COACTVWC',
  '/cards': 'COCRDLSC',
  '/transactions': 'COTRNLSC',
  '/transactions/add': 'COTRNADC',
  '/billing': 'COBILLPC',
  '/reports': 'CORPTGEC',
  '/users': 'COUSRLSC',
  '/batch': 'COBATCHC',
};

function getDateTime() {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
  });
  const time = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return { date, time };
}

function matchPath(pathname) {
  const basePath = '/' + pathname.split('/').filter(Boolean).slice(0, 1).join('/');
  if (TRAN_MAP[pathname]) return pathname;
  if (TRAN_MAP[basePath]) return basePath;
  return '/menu';
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [dateTime, setDateTime] = useState(getDateTime());

  useEffect(() => {
    const interval = setInterval(() => setDateTime(getDateTime()), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const isAdmin = user?.userType === 'A' || user?.userType === 'ADMIN';
  const matchedPath = matchPath(location.pathname);
  const tran = TRAN_MAP[matchedPath] || 'CM00';
  const prog = PROG_MAP[matchedPath] || 'COMEN01C';

  return (
    <div className="app-container">
      <nav className="navbar">
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <div>
            <span style={{ color: '#00ccff' }}>Tran: </span>
            <span style={{ color: '#33ff33' }}>{tran}</span>
            {'    '}
            <span style={{ color: '#00ccff' }}>Prog: </span>
            <span style={{ color: '#33ff33' }}>{prog}</span>
          </div>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <span style={{ color: '#e0e0e0', fontWeight: 700 }}>AWS Mainframe Modernization</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ color: '#00ccff' }}>Date: </span>
            <span style={{ color: '#33ff33' }}>{dateTime.date}</span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <div>
            <span style={{ color: '#00ccff' }}>User: </span>
            <span style={{ color: '#33ff33' }}>{user?.userId}</span>
            {'  '}
            <span className={`badge ${isAdmin ? 'badge-admin' : 'badge-user'}`}>
              {isAdmin ? 'ADMIN' : 'USER'}
            </span>
          </div>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <NavLink to="/menu" className="navbar-title">CardDemo</NavLink>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ color: '#00ccff' }}>Time: </span>
            <span style={{ color: '#33ff33' }}>{dateTime.time}</span>
          </div>
        </div>
        <div className="navbar-links">
          <NavLink to="/menu" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Menu</NavLink>
          <NavLink to="/accounts" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Accounts</NavLink>
          <NavLink to="/cards" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Cards</NavLink>
          <NavLink to="/transactions" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Transactions</NavLink>
          <NavLink to="/billing" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Bill-Pay</NavLink>
          <NavLink to="/reports" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Reports</NavLink>
          {isAdmin && (
            <>
              <NavLink to="/users" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Users</NavLink>
              <NavLink to="/batch" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Batch</NavLink>
            </>
          )}
          <span style={{ marginLeft: 'auto' }}>
            <button className="btn-logout" onClick={handleLogout}>F3=Signoff</button>
          </span>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
      <div className="terminal-footer">
        ENTER=Continue  F3=Exit  F7=Backward  F8=Forward
      </div>
    </div>
  );
}
