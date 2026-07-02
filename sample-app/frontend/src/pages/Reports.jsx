import React, { useState } from 'react';
import { generateReport } from '../api';

function formatCurrency(val) {
  if (val === null || val === undefined) return '$0.00';
  const num = Number(val);
  const formatted = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (num < 0 ? '-$' : '$') + formatted;
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

function getMonthDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

function getYearDates() {
  const now = new Date();
  return {
    startDate: `${now.getFullYear()}-01-01`,
    endDate: `${now.getFullYear()}-12-31`,
  };
}

export default function Reports() {
  const [reportType, setReportType] = useState('Monthly');
  const [startDate, setStartDate] = useState(getMonthDates().startDate);
  const [endDate, setEndDate] = useState(getMonthDates().endDate);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const handleTypeChange = (e) => {
    const type = e.target.value;
    setReportType(type);
    setConfirming(false);
    setReport(null);

    if (type === 'Monthly') {
      const dates = getMonthDates();
      setStartDate(dates.startDate);
      setEndDate(dates.endDate);
    } else if (type === 'Yearly') {
      const dates = getYearDates();
      setStartDate(dates.startDate);
      setEndDate(dates.endDate);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!startDate || !endDate) {
      setError('Please select both start and end dates.');
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      setError('Start date must be before end date.');
      return;
    }

    setConfirming(true);
  };

  const handleConfirm = async () => {
    setLoading(true);
    setError('');
    setConfirming(false);
    try {
      const data = await generateReport({
        reportType,
        startDate,
        endDate,
      });
      setReport(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelConfirm = () => {
    setConfirming(false);
  };

  return (
    <div>
      <div className="page-header">
        <h1>Transaction Reports</h1>
        <p>Generate transaction reports by date range</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="reportType">Report Type</label>
              <select
                id="reportType"
                value={reportType}
                onChange={handleTypeChange}
              >
                <option value="Monthly">Monthly</option>
                <option value="Yearly">Yearly</option>
                <option value="Custom">Custom</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="startDate">Start Date</label>
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={reportType !== 'Custom'}
              />
            </div>
            <div className="form-group">
              <label htmlFor="endDate">End Date</label>
              <input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={reportType !== 'Custom'}
              />
            </div>
          </div>
          <div className="btn-group mt-16">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              Generate Report
            </button>
          </div>
        </form>
      </div>

      {confirming && (
        <div className="confirmation-box">
          <h3>Confirm Report Generation</h3>
          <p>
            Generate a <strong>{reportType}</strong> report from{' '}
            <strong>{startDate}</strong> to <strong>{endDate}</strong>?
          </p>
          <div className="btn-group mt-16">
            <button className="btn btn-success" onClick={handleConfirm}>
              Yes, Generate
            </button>
            <button className="btn btn-secondary" onClick={handleCancelConfirm}>
              No, Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <div className="loading">Generating report...</div>}

      {report && (
        <div className="card mt-16">
          <div className="card-header">
            {report.reportType} Report: {report.startDate} to {report.endDate}
          </div>

          {report.entries && report.entries.length > 0 ? (
            <>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tran ID</th>
                      <th>Card</th>
                      <th>Type</th>
                      <th>Category</th>
                      <th className="text-right">Amount</th>
                      <th>Date</th>
                      <th>Merchant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.entries.map((entry, idx) => {
                      const amt = Number(entry.amount);
                      return (
                        <tr key={entry.tranId || idx}>
                          <td>{entry.tranId || '-'}</td>
                          <td>{entry.cardNum || '-'}</td>
                          <td>{entry.typeCode || entry.typeDescription || '-'}</td>
                          <td>{entry.categoryCode || entry.categoryDescription || '-'}</td>
                          <td className={`text-right amount ${amt >= 0 ? 'amount-positive' : 'amount-negative'}`}>
                            {formatCurrency(entry.amount)}
                          </td>
                          <td>{formatDate(entry.origTimestamp)}</td>
                          <td>{entry.merchantName || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="report-total">
                Total Amount: {formatCurrency(report.totalAmount)}
              </div>
            </>
          ) : (
            <div className="no-data">No transactions found for this period.</div>
          )}
        </div>
      )}
    </div>
  );
}
