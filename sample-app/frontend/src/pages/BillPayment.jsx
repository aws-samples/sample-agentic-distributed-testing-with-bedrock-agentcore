import React, { useState } from 'react';
import { getAccountDetail, payBill } from '../api';

function formatCurrency(val) {
  if (val === null || val === undefined) return '$0.00';
  return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BillPayment() {
  const [accountId, setAccountId] = useState('');
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirming, setConfirming] = useState(false);

  const handleLookup = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setAccount(null);
    setConfirming(false);

    if (!accountId.trim()) {
      setError('Please enter an Account ID.');
      return;
    }

    setLoading(true);
    try {
      const data = await getAccountDetail(accountId.trim());
      setAccount(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePayClick = () => {
    setConfirming(true);
  };

  const handleConfirmPay = async () => {
    setPaying(true);
    setError('');
    try {
      const result = await payBill(account.accountId);
      setSuccess(
        `Payment successful. Transaction ID: ${result.transactionId}. Amount: ${formatCurrency(result.amountPaid)}`
      );
      setConfirming(false);
      setAccount(null);
    } catch (err) {
      setError(err.message);
      setConfirming(false);
    } finally {
      setPaying(false);
    }
  };

  const handleCancelPay = () => {
    setConfirming(false);
  };

  const balance = account ? Number(account.currentBalance) : 0;

  return (
    <div>
      <div className="page-header">
        <h1>Bill Payment</h1>
        <p>Pay the outstanding balance on a credit card account</p>
      </div>

      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <form onSubmit={handleLookup} className="form-inline">
          <div className="form-group">
            <label htmlFor="accountId">Account ID</label>
            <input
              id="accountId"
              type="text"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setAccount(null);
                setConfirming(false);
                setSuccess('');
              }}
              placeholder="Enter Account ID"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Looking Up...' : 'Look Up'}
          </button>
        </form>
      </div>

      {account && (
        <div className="card">
          <div className="detail-section">
            <h3 className="detail-section-title">Account Information</h3>
            <div className="detail-row">
              <span className="detail-label">Account ID</span>
              <span className="detail-value">{account.accountId}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Current Balance</span>
              <span className="detail-value amount">{formatCurrency(account.currentBalance)}</span>
            </div>
          </div>

          {balance > 0 ? (
            <div className="mt-16">
              <div className="detail-row">
                <span className="detail-label">Payment Amount</span>
                <span className="detail-value amount">
                  {formatCurrency(balance)} (Full Balance)
                </span>
              </div>

              {confirming ? (
                <div className="confirmation-box mt-16">
                  <h3>Confirm Payment</h3>
                  <p>
                    Are you sure you want to pay <strong>{formatCurrency(balance)}</strong> for
                    account <strong>{account.accountId}</strong>?
                  </p>
                  <div className="btn-group mt-16">
                    <button
                      className="btn btn-success"
                      onClick={handleConfirmPay}
                      disabled={paying}
                    >
                      {paying ? 'Processing...' : 'Yes, Pay Now'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={handleCancelPay}
                      disabled={paying}
                    >
                      No, Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-16">
                  <button className="btn btn-success btn-lg" onClick={handlePayClick}>
                    Pay Full Balance
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="alert alert-info mt-16">
              You have nothing to pay. Your current balance is {formatCurrency(balance)}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
