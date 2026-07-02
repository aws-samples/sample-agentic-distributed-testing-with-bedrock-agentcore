import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCards } from '../api';

function maskCardNumber(num) {
  if (!num) return '****';
  const str = String(num).replace(/\s/g, '');
  if (str.length <= 4) return str;
  const last4 = str.slice(-4);
  return '**** **** **** ' + last4;
}

export default function CardList() {
  const { user } = useAuth();
  const isAdmin = user?.userType === 'A' || user?.userType === 'ADMIN';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [accountId, setAccountId] = useState(searchParams.get('accountId') || '');
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const paramAccountId = searchParams.get('accountId');
    if (paramAccountId) {
      setAccountId(paramAccountId);
      loadCards(paramAccountId);
    } else if (isAdmin) {
      loadCards('');
    }
  }, [searchParams, isAdmin]);

  const loadCards = async (acctId) => {
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const data = await getCards(acctId || undefined);
      setCards(Array.isArray(data) ? data : [data]);
    } catch (err) {
      setError(err.message);
      setCards([]);
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
    loadCards(accountId.trim());
  };

  return (
    <div>
      <div className="page-header">
        <h1>Cards</h1>
        <p>View and manage credit cards</p>
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

      {loading && <div className="loading">Loading cards...</div>}

      {!loading && searched && cards.length === 0 && !error && (
        <div className="no-data">No cards found.</div>
      )}

      {!loading && cards.length > 0 && (
        <div className="card">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Card Number</th>
                  <th>Account ID</th>
                  <th>Embossed Name</th>
                  <th>Expiration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr
                    key={card.cardNum}
                    className="clickable"
                    onClick={() => navigate(`/cards/${card.cardNum}`)}
                  >
                    <td><span className="card-number-masked">{maskCardNumber(card.cardNum)}</span></td>
                    <td>{card.accountId}</td>
                    <td>{card.embossedName || '-'}</td>
                    <td>{card.expirationDate || '-'}</td>
                    <td>
                      <span className={`badge ${card.activeStatus === 'Y' ? 'badge-active' : 'badge-inactive'}`}>
                        {card.activeStatus === 'Y' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
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
