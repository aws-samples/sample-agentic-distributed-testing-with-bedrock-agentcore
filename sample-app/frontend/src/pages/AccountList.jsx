import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAccounts } from '../api';

function formatCurrency(val) {
  if (val === null || val === undefined) return '$0.00';
  return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AccountList() {
  const { user } = useAuth();
  const isAdmin = user?.userType === 'A' || user?.userType === 'ADMIN';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [accountId, setAccountId] = useState(searchParams.get('accountId') || '');
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      loadAccounts('');
    }
  }, [isAdmin]);

  useEffect(() => {
    const paramId = searchParams.get('accountId');
    if (paramId) {
      setAccountId(paramId);
      loadAccounts(paramId);
    }
  }, [searchParams]);

  const loadAccounts = async (id) => {
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const data = await getAccounts(id || undefined);
      setAccounts(Array.isArray(data) ? data : [data]);
    } catch (err) {
      setError(err.message);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (!isAdmin && !accountId.trim()) {
      setError('Please enter an Account ID to search.');
      return;
    }
    loadAccounts(accountId.trim());
  };

  return (
    <div>
      <div className="page-header">
        <h1>Accounts</h1>
        <p>Search and view credit card accounts</p>
      </div>

      <div className="card">
        <form onSubmit={handleSearch} className="form-inline">
          <div className="form-group">
            <label htmlFor="accountId">Account ID</label>
            <input
              id="accountId"
              type="text"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="Enter Account ID"
            />
          </div>
          <button type="submit" className="btn btn-primary">Search</button>
        </form>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && <div className="loading">Loading accounts...</div>}

      {!loading && searched && accounts.length === 0 && !error && (
        <div className="no-data">No accounts found.</div>
      )}

      {!loading && accounts.length > 0 && (
        <div className="card">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Account ID</th>
                  <th>Status</th>
                  <th className="text-right">Current Balance</th>
                  <th className="text-right">Credit Limit</th>
                  <th>Open Date</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acct) => (
                  <tr
                    key={acct.accountId}
                    className="clickable"
                    onClick={() => navigate(`/accounts/${acct.accountId}`)}
                  >
                    <td><strong>{acct.accountId}</strong></td>
                    <td>
                      <span className={`badge ${acct.activeStatus === 'Y' ? 'badge-active' : 'badge-inactive'}`}>
                        {acct.activeStatus === 'Y' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="text-right amount">{formatCurrency(acct.currentBalance)}</td>
                    <td className="text-right amount">{formatCurrency(acct.creditLimit)}</td>
                    <td>{acct.openDate || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
