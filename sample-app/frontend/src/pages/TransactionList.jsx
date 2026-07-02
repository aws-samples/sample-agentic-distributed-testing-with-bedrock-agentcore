import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getTransactions } from '../api';
import Pagination from '../components/Pagination';

function formatCurrency(val) {
  if (val === null || val === undefined) return '$0.00';
  const num = Number(val);
  const formatted = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (num < 0 ? '-$' : '$') + formatted;
}

function maskCardNumber(num) {
  if (!num) return '****';
  const str = String(num).replace(/\s/g, '');
  if (str.length <= 4) return str;
  return '...' + str.slice(-4);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US');
  } catch {
    return dateStr;
  }
}

export default function TransactionList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [accountId, setAccountId] = useState(searchParams.get('accountId') || '');
  const [cardNum, setCardNum] = useState(searchParams.get('cardNum') || '');
  const [transactions, setTransactions] = useState([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const paramAcct = searchParams.get('accountId');
    const paramCard = searchParams.get('cardNum');
    if (paramAcct || paramCard) {
      setAccountId(paramAcct || '');
      setCardNum(paramCard || '');
      loadTransactions(paramAcct || '', paramCard || '', 0);
    } else {
      loadTransactions('', '', 0);
    }
  }, [searchParams]);

  const loadTransactions = async (acctId, card, pg) => {
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const data = await getTransactions({
        accountId: acctId || undefined,
        cardNum: card || undefined,
        page: pg,
        size: 10,
      });
      setTransactions(data.content || []);
      setPage(data.page ?? pg);
      setTotalPages(data.totalPages || 0);
    } catch (err) {
      setError(err.message);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = (e) => {
    e.preventDefault();
    setPage(0);
    loadTransactions(accountId.trim(), cardNum.trim(), 0);
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    loadTransactions(accountId.trim(), cardNum.trim(), newPage);
  };

  return (
    <div>
      <div className="page-header">
        <h1>Transactions</h1>
        <p>Browse and filter transaction history</p>
      </div>

      <div className="card">
        <form onSubmit={handleFilter} className="form-inline">
          <div className="form-group">
            <label htmlFor="filterAccountId">Account ID</label>
            <input
              id="filterAccountId"
              type="text"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="Account ID"
            />
          </div>
          <div className="form-group">
            <label htmlFor="filterCardNum">Card Number</label>
            <input
              id="filterCardNum"
              type="text"
              value={cardNum}
              onChange={(e) => setCardNum(e.target.value)}
              placeholder="Card Number"
            />
          </div>
          <button type="submit" className="btn btn-primary">Filter</button>
        </form>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && <div className="loading">Loading transactions...</div>}

      {!loading && searched && transactions.length === 0 && !error && (
        <div className="no-data">No transactions found.</div>
      )}

      {!loading && transactions.length > 0 && (
        <div className="card">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Tran ID</th>
                  <th>Card</th>
                  <th>Type</th>
                  <th className="text-right">Amount</th>
                  <th>Date</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn) => {
                  const amt = Number(txn.amount);
                  return (
                    <tr
                      key={txn.tranId}
                      className="clickable"
                      onClick={() => navigate(`/transactions/${txn.tranId}`)}
                    >
                      <td><strong>{txn.tranId}</strong></td>
                      <td className="card-number-masked">{maskCardNumber(txn.cardNum)}</td>
                      <td>{txn.typeCode || txn.typeDescription || '-'}</td>
                      <td className={`text-right amount ${amt >= 0 ? 'amount-positive' : 'amount-negative'}`}>
                        {formatCurrency(txn.amount)}
                      </td>
                      <td>{formatDate(txn.origTimestamp)}</td>
                      <td>{txn.description || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={handlePageChange} />
        </div>
      )}
    </div>
  );
}
