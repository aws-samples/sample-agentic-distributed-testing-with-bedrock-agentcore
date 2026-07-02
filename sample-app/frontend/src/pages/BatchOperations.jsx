import React, { useState } from 'react';
import { postTransactions, calculateInterest } from '../api';

function formatCurrency(val) {
  if (val === null || val === undefined) return '$0.00';
  return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BatchOperations() {
  const [postLoading, setPostLoading] = useState(false);
  const [postResult, setPostResult] = useState(null);
  const [postError, setPostError] = useState('');

  const [interestLoading, setInterestLoading] = useState(false);
  const [interestResult, setInterestResult] = useState(null);
  const [interestError, setInterestError] = useState('');

  const handlePostTransactions = async () => {
    setPostLoading(true);
    setPostError('');
    setPostResult(null);
    try {
      const result = await postTransactions();
      setPostResult(result);
    } catch (err) {
      setPostError(err.message);
    } finally {
      setPostLoading(false);
    }
  };

  const handleCalculateInterest = async () => {
    setInterestLoading(true);
    setInterestError('');
    setInterestResult(null);
    try {
      const result = await calculateInterest();
      setInterestResult(result);
    } catch (err) {
      setInterestError(err.message);
    } finally {
      setInterestLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Batch Operations</h1>
        <p>Run batch processing jobs for daily transactions and interest calculations</p>
      </div>

      <div className="batch-section">
        <h3>Post Daily Transactions</h3>
        <p>
          Process all pending daily transactions. This job reads the transaction file,
          validates each transaction, posts valid transactions to accounts, and rejects
          invalid ones. Run this as part of the daily batch cycle.
        </p>

        {postError && <div className="alert alert-error">{postError}</div>}

        <button
          className="btn btn-primary"
          onClick={handlePostTransactions}
          disabled={postLoading}
        >
          {postLoading ? 'Running...' : 'Run Post Transactions'}
        </button>

        {postLoading && <div className="loading">Processing transactions...</div>}

        {postResult && (
          <div className="batch-results">
            <div className="stat">
              <strong>{postResult.processed}</strong> transactions processed
            </div>
            <div className="stat">
              <strong>{postResult.rejected}</strong> transactions rejected
            </div>
            {postResult.rejections && postResult.rejections.length > 0 && (
              <div className="mt-16">
                <strong>Rejection Details:</strong>
                <div className="table-wrapper mt-8">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {postResult.rejections.map((reason, idx) => (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td>{typeof reason === 'string' ? reason : JSON.stringify(reason)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="batch-section">
        <h3>Calculate Interest</h3>
        <p>
          Calculate and apply interest charges to all eligible accounts based on
          their current balances and applicable interest rates. This should be run
          after posting daily transactions.
        </p>

        {interestError && <div className="alert alert-error">{interestError}</div>}

        <button
          className="btn btn-primary"
          onClick={handleCalculateInterest}
          disabled={interestLoading}
        >
          {interestLoading ? 'Running...' : 'Run Calculate Interest'}
        </button>

        {interestLoading && <div className="loading">Calculating interest...</div>}

        {interestResult && (
          <div className="batch-results">
            <div className="stat">
              <strong>{interestResult.accountsProcessed}</strong> accounts processed
            </div>
            <div className="stat">
              Total interest applied: <strong>{formatCurrency(interestResult.totalInterest)}</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
