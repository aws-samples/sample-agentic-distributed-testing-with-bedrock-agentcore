import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getCardDetail } from '../api';

function maskCardNumber(num) {
  if (!num) return '****';
  const str = String(num).replace(/\s/g, '');
  if (str.length <= 4) return str;
  const last4 = str.slice(-4);
  return '**** **** **** ' + last4;
}

function formatCurrency(val) {
  if (val === null || val === undefined) return '$0.00';
  return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CardDetail() {
  const { cardNum } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCard();
  }, [cardNum]);

  const loadCard = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getCardDetail(cardNum);
      setCard(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading card details...</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!card) return <div className="no-data">Card not found.</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Card Details</h1>
        <p>Card: {maskCardNumber(card.cardNum)}</p>
      </div>

      <div className="card">
        <div className="detail-section">
          <h3 className="detail-section-title">Card Information</h3>
          <div className="detail-row">
            <span className="detail-label">Card Number</span>
            <span className="detail-value card-number-masked">{maskCardNumber(card.cardNum)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Account ID</span>
            <span className="detail-value">{card.accountId}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Embossed Name</span>
            <span className="detail-value">{card.embossedName || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Expiration Date</span>
            <span className="detail-value">{card.expirationDate || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Status</span>
            <span className="detail-value">
              <span className={`badge ${card.activeStatus === 'Y' ? 'badge-active' : 'badge-inactive'}`}>
                {card.activeStatus === 'Y' ? 'Active' : 'Inactive'}
              </span>
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">CVV</span>
            <span className="detail-value">***</span>
          </div>
        </div>

        <div className="detail-section">
          <h3 className="detail-section-title">Account Information</h3>
          <div className="detail-row">
            <span className="detail-label">Customer Name</span>
            <span className="detail-value">{card.customerName || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Account Status</span>
            <span className="detail-value">
              {card.accountStatus ? (
                <span className={`badge ${card.accountStatus === 'Y' ? 'badge-active' : 'badge-inactive'}`}>
                  {card.accountStatus === 'Y' ? 'Active' : 'Inactive'}
                </span>
              ) : '-'}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Current Balance</span>
            <span className="detail-value amount">{formatCurrency(card.currentBalance)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Credit Limit</span>
            <span className="detail-value amount">{formatCurrency(card.creditLimit)}</span>
          </div>
        </div>
      </div>

      <div className="btn-group">
        <button className="btn btn-primary" onClick={() => navigate(`/cards/${cardNum}/edit`)}>
          Edit Card
        </button>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
    </div>
  );
}
