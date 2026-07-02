import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAccountDetail } from '../api';

function formatCurrency(val) {
  if (val === null || val === undefined) return '$0.00';
  return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AccountView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadAccount();
  }, [id]);

  const loadAccount = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAccountDetail(id);
      setAccount(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading account details...</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!account) return <div className="no-data">Account not found.</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Account Details</h1>
        <p>Account ID: {account.accountId}</p>
      </div>

      <div className="card">
        <div className="detail-section">
          <h3 className="detail-section-title">Account Information</h3>
          <div className="detail-row">
            <span className="detail-label">Account ID</span>
            <span className="detail-value">{account.accountId}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Status</span>
            <span className="detail-value">
              <span className={`badge ${account.activeStatus === 'Y' ? 'badge-active' : 'badge-inactive'}`}>
                {account.activeStatus === 'Y' ? 'Active' : 'Inactive'}
              </span>
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Open Date</span>
            <span className="detail-value">{account.openDate || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Expiration Date</span>
            <span className="detail-value">{account.expirationDate || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Reissue Date</span>
            <span className="detail-value">{account.reissueDate || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Group ID</span>
            <span className="detail-value">{account.groupId || '-'}</span>
          </div>
        </div>

        <div className="detail-section">
          <h3 className="detail-section-title">Financial Information</h3>
          <div className="detail-row">
            <span className="detail-label">Current Balance</span>
            <span className="detail-value amount">{formatCurrency(account.currentBalance)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Credit Limit</span>
            <span className="detail-value amount">{formatCurrency(account.creditLimit)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Cash Credit Limit</span>
            <span className="detail-value amount">{formatCurrency(account.cashCreditLimit)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Current Cycle Credit</span>
            <span className="detail-value amount">{formatCurrency(account.currentCycleCredit)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Current Cycle Debit</span>
            <span className="detail-value amount">{formatCurrency(account.currentCycleDebit)}</span>
          </div>
        </div>

        <div className="detail-section">
          <h3 className="detail-section-title">Customer Information</h3>
          <div className="detail-row">
            <span className="detail-label">Customer Name</span>
            <span className="detail-value">
              {account.customerFirstName} {account.customerLastName}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">FICO Score</span>
            <span className="detail-value">{account.customerFicoScore || '-'}</span>
          </div>
        </div>
      </div>

      <div className="btn-group">
        <button className="btn btn-primary" onClick={() => navigate(`/accounts/${id}/edit`)}>
          Edit Account
        </button>
        <button className="btn btn-secondary" onClick={() => navigate('/accounts')}>
          Back to Accounts
        </button>
        <button className="btn btn-secondary" onClick={() => navigate(`/cards?accountId=${id}`)}>
          View Cards
        </button>
        <button className="btn btn-secondary" onClick={() => navigate(`/transactions?accountId=${id}`)}>
          View Transactions
        </button>
      </div>
    </div>
  );
}
