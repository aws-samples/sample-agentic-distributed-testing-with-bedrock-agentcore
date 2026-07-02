import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTransactionDetail } from '../api';

function formatCurrency(val) {
  if (val === null || val === undefined) return '$0.00';
  const num = Number(val);
  const formatted = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (num < 0 ? '-$' : '$') + formatted;
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('en-US');
  } catch {
    return dateStr;
  }
}

export default function TransactionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [txn, setTxn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTransaction();
  }, [id]);

  const loadTransaction = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getTransactionDetail(id);
      setTxn(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading transaction details...</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!txn) return <div className="no-data">Transaction not found.</div>;

  const amt = Number(txn.amount);

  return (
    <div>
      <div className="page-header">
        <h1>Transaction Details</h1>
        <p>Transaction ID: {txn.tranId}</p>
      </div>

      <div className="card">
        <div className="detail-section">
          <h3 className="detail-section-title">Transaction Information</h3>
          <div className="detail-row">
            <span className="detail-label">Transaction ID</span>
            <span className="detail-value">{txn.tranId}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Card Number</span>
            <span className="detail-value card-number-masked">{txn.cardNum || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Type Code</span>
            <span className="detail-value">{txn.typeCode || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Type Description</span>
            <span className="detail-value">{txn.typeDescription || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Category Code</span>
            <span className="detail-value">{txn.categoryCode || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Category Description</span>
            <span className="detail-value">{txn.categoryDescription || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Source</span>
            <span className="detail-value">{txn.source || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Description</span>
            <span className="detail-value">{txn.description || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Amount</span>
            <span className={`detail-value amount ${amt >= 0 ? 'amount-positive' : 'amount-negative'}`}>
              {formatCurrency(txn.amount)}
            </span>
          </div>
        </div>

        <div className="detail-section">
          <h3 className="detail-section-title">Merchant Information</h3>
          <div className="detail-row">
            <span className="detail-label">Merchant ID</span>
            <span className="detail-value">{txn.merchantId || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Merchant Name</span>
            <span className="detail-value">{txn.merchantName || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Merchant City</span>
            <span className="detail-value">{txn.merchantCity || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Merchant ZIP</span>
            <span className="detail-value">{txn.merchantZip || '-'}</span>
          </div>
        </div>

        <div className="detail-section">
          <h3 className="detail-section-title">Timestamps</h3>
          <div className="detail-row">
            <span className="detail-label">Original Date</span>
            <span className="detail-value">{formatDateTime(txn.origTimestamp)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Processing Date</span>
            <span className="detail-value">{formatDateTime(txn.procTimestamp)}</span>
          </div>
        </div>
      </div>

      <div className="btn-group">
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
    </div>
  );
}
