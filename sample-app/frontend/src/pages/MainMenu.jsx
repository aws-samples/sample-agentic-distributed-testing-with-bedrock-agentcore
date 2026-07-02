import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function MainMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.userType === 'A' || user?.userType === 'ADMIN';
  const [option, setOption] = useState('');

  const menuItems = [
    { number: '01', title: 'Account View', path: '/accounts' },
    { number: '02', title: 'Account Update', path: '/accounts' },
    { number: '03', title: 'Credit Card List', path: '/cards' },
    { number: '04', title: 'Credit Card View', path: '/cards' },
    { number: '05', title: 'Credit Card Update', path: '/cards' },
    { number: '06', title: 'Transaction List', path: '/transactions' },
    { number: '07', title: 'Transaction View', path: '/transactions' },
    { number: '08', title: 'Transaction Add', path: '/transactions/add' },
    { number: '09', title: 'Transaction Reports', path: '/reports' },
    { number: '10', title: 'Bill Payment', path: '/billing' },
  ];

  const adminItems = [
    { number: '11', title: 'User List (Security)', path: '/users' },
    { number: '12', title: 'User Add (Security)', path: '/users/add' },
    { number: '13', title: 'Batch Operations', path: '/batch' },
  ];

  const allItems = isAdmin ? [...menuItems, ...adminItems] : menuItems;

  const handleSubmit = (e) => {
    e.preventDefault();
    const num = option.trim();
    const item = allItems.find((i) => i.number === num.padStart(2, '0'));
    if (item) {
      navigate(item.path);
    }
  };

  return (
    <div>
      <div className="welcome-header">
        <h1>{isAdmin ? 'Admin Menu' : 'Main Menu'}</h1>
      </div>

      <div style={{ padding: '16px 0' }}>
        {menuItems.map((item) => (
          <div key={item.number} style={{ padding: '2px 0' }}>
            <Link
              to={item.path}
              style={{ color: '#33ff33', textDecoration: 'none' }}
              onMouseOver={(e) => (e.target.style.color = '#ffff00')}
              onMouseOut={(e) => (e.target.style.color = '#33ff33')}
            >
              {'        '}{item.number}. {item.title}
            </Link>
          </div>
        ))}

        {isAdmin && (
          <>
            <div style={{ borderTop: '1px solid #333', margin: '8px 0' }} />
            {adminItems.map((item) => (
              <div key={item.number} style={{ padding: '2px 0' }}>
                <Link
                  to={item.path}
                  style={{ color: '#33ff33', textDecoration: 'none' }}
                  onMouseOver={(e) => (e.target.style.color = '#ffff00')}
                  onMouseOut={(e) => (e.target.style.color = '#33ff33')}
                >
                  {'        '}{item.number}. {item.title}
                </Link>
              </div>
            ))}
          </>
        )}
      </div>

      <div style={{ marginTop: '24px' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#ffff00' }}>Please select an option :</span>
          <input
            type="text"
            value={option}
            onChange={(e) => setOption(e.target.value)}
            style={{ width: '40px', textAlign: 'center' }}
            maxLength={2}
            autoFocus
          />
        </form>
      </div>
    </div>
  );
}
