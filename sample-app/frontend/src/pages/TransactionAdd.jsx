import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addTransaction } from '../api';

function formatCurrency(val) {
  if (val === null || val === undefined) return '$0.00';
  const num = Number(val);
  const formatted = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (num < 0 ? '-$' : '$') + formatted;
}

export default function TransactionAdd() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    accountId: '',
    cardNum: '',
    typeCode: '',
    categoryCode: '',
    source: '',
    description: '',
    amount: '',
    merchantId: '',
    merchantName: '',
    merchantCity: '',
    merchantZip: '',
    origTimestamp: '',
    procTimestamp: '',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    setConfirming(false);
  };

  const validate = () => {
    const errors = {};

    if (!form.accountId.trim() && !form.cardNum.trim()) {
      errors.accountId = 'Account ID or Card Number is required.';
      errors.cardNum = 'Account ID or Card Number is required.';
    }
    if (!form.typeCode.trim()) errors.typeCode = 'Type code is required.';
    if (!form.categoryCode.trim()) errors.categoryCode = 'Category code is required.';
    if (!form.source.trim()) errors.source = 'Source is required.';
    if (!form.description.trim()) errors.description = 'Description is required.';
    if (!form.amount.trim()) {
      errors.amount = 'Amount is required.';
    } else if (isNaN(Number(form.amount))) {
      errors.amount = 'Amount must be a valid number.';
    }
    if (!form.merchantId.trim()) errors.merchantId = 'Merchant ID is required.';
    if (!form.merchantName.trim()) errors.merchantName = 'Merchant name is required.';
    if (!form.merchantCity.trim()) errors.merchantCity = 'Merchant city is required.';
    if (!form.merchantZip.trim()) errors.merchantZip = 'Merchant ZIP is required.';
    if (!form.origTimestamp) errors.origTimestamp = 'Original date is required.';
    if (!form.procTimestamp) errors.procTimestamp = 'Processing date is required.';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!validate()) return;

    setConfirming(true);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        accountId: form.accountId.trim() || undefined,
        cardNum: form.cardNum.trim() || undefined,
        typeCode: form.typeCode.trim(),
        categoryCode: form.categoryCode.trim(),
        source: form.source.trim(),
        description: form.description.trim(),
        amount: Number(form.amount),
        merchantId: form.merchantId.trim(),
        merchantName: form.merchantName.trim(),
        merchantCity: form.merchantCity.trim(),
        merchantZip: form.merchantZip.trim(),
        origTimestamp: form.origTimestamp,
        procTimestamp: form.procTimestamp,
      };
      const result = await addTransaction(payload);
      const txnId = result?.tranId || result?.id || 'N/A';
      setSuccess(`Transaction created. ID: ${txnId}`);
      setConfirming(false);
      setForm({
        accountId: '',
        cardNum: '',
        typeCode: '',
        categoryCode: '',
        source: '',
        description: '',
        amount: '',
        merchantId: '',
        merchantName: '',
        merchantCity: '',
        merchantZip: '',
        origTimestamp: '',
        procTimestamp: '',
      });
    } catch (err) {
      setError(err.message);
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setConfirming(false);
  };

  return (
    <div>
      <div className="page-header">
        <h1>Add Transaction</h1>
        <p>Record a new credit card transaction</p>
      </div>

      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {confirming ? (
        <div className="confirmation-box">
          <h3>Confirm Transaction</h3>
          <div className="summary-row">
            <strong>Account ID</strong>
            <span>{form.accountId || '-'}</span>
          </div>
          <div className="summary-row">
            <strong>Card Number</strong>
            <span>{form.cardNum || '-'}</span>
          </div>
          <div className="summary-row">
            <strong>Type Code</strong>
            <span>{form.typeCode}</span>
          </div>
          <div className="summary-row">
            <strong>Category Code</strong>
            <span>{form.categoryCode}</span>
          </div>
          <div className="summary-row">
            <strong>Source</strong>
            <span>{form.source}</span>
          </div>
          <div className="summary-row">
            <strong>Description</strong>
            <span>{form.description}</span>
          </div>
          <div className="summary-row">
            <strong>Amount</strong>
            <span className="amount">{formatCurrency(form.amount)}</span>
          </div>
          <div className="summary-row">
            <strong>Merchant</strong>
            <span>{form.merchantName} ({form.merchantId})</span>
          </div>
          <div className="summary-row">
            <strong>Merchant Location</strong>
            <span>{form.merchantCity}, {form.merchantZip}</span>
          </div>
          <div className="summary-row">
            <strong>Original Date</strong>
            <span>{form.origTimestamp}</span>
          </div>
          <div className="summary-row">
            <strong>Processing Date</strong>
            <span>{form.procTimestamp}</span>
          </div>
          <div className="btn-group mt-16">
            <button className="btn btn-success" onClick={handleConfirm} disabled={submitting}>
              {submitting ? 'Submitting...' : 'Yes, Submit'}
            </button>
            <button className="btn btn-secondary" onClick={handleCancel} disabled={submitting}>
              No, Go Back
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="accountId">Account ID</label>
                <input
                  id="accountId"
                  name="accountId"
                  type="text"
                  value={form.accountId}
                  onChange={handleChange}
                  placeholder="Enter Account ID"
                  className={fieldErrors.accountId ? 'error' : ''}
                />
                {fieldErrors.accountId && <div className="field-error">{fieldErrors.accountId}</div>}
              </div>
              <div className="form-group">
                <label htmlFor="cardNum">Card Number</label>
                <input
                  id="cardNum"
                  name="cardNum"
                  type="text"
                  value={form.cardNum}
                  onChange={handleChange}
                  placeholder="Enter Card Number"
                  className={fieldErrors.cardNum ? 'error' : ''}
                />
                {fieldErrors.cardNum && <div className="field-error">{fieldErrors.cardNum}</div>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="typeCode" className="required">Type Code</label>
                <input
                  id="typeCode"
                  name="typeCode"
                  type="text"
                  value={form.typeCode}
                  onChange={handleChange}
                  className={fieldErrors.typeCode ? 'error' : ''}
                />
                {fieldErrors.typeCode && <div className="field-error">{fieldErrors.typeCode}</div>}
              </div>
              <div className="form-group">
                <label htmlFor="categoryCode" className="required">Category Code</label>
                <input
                  id="categoryCode"
                  name="categoryCode"
                  type="text"
                  value={form.categoryCode}
                  onChange={handleChange}
                  className={fieldErrors.categoryCode ? 'error' : ''}
                />
                {fieldErrors.categoryCode && <div className="field-error">{fieldErrors.categoryCode}</div>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="source" className="required">Source</label>
                <input
                  id="source"
                  name="source"
                  type="text"
                  value={form.source}
                  onChange={handleChange}
                  className={fieldErrors.source ? 'error' : ''}
                />
                {fieldErrors.source && <div className="field-error">{fieldErrors.source}</div>}
              </div>
              <div className="form-group">
                <label htmlFor="amount" className="required">Amount</label>
                <input
                  id="amount"
                  name="amount"
                  type="text"
                  value={form.amount}
                  onChange={handleChange}
                  placeholder="e.g. 125.50 or -50.00"
                  className={fieldErrors.amount ? 'error' : ''}
                />
                {fieldErrors.amount && <div className="field-error">{fieldErrors.amount}</div>}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="description" className="required">Description</label>
              <input
                id="description"
                name="description"
                type="text"
                value={form.description}
                onChange={handleChange}
                className={fieldErrors.description ? 'error' : ''}
              />
              {fieldErrors.description && <div className="field-error">{fieldErrors.description}</div>}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="merchantId" className="required">Merchant ID</label>
                <input
                  id="merchantId"
                  name="merchantId"
                  type="text"
                  value={form.merchantId}
                  onChange={handleChange}
                  className={fieldErrors.merchantId ? 'error' : ''}
                />
                {fieldErrors.merchantId && <div className="field-error">{fieldErrors.merchantId}</div>}
              </div>
              <div className="form-group">
                <label htmlFor="merchantName" className="required">Merchant Name</label>
                <input
                  id="merchantName"
                  name="merchantName"
                  type="text"
                  value={form.merchantName}
                  onChange={handleChange}
                  className={fieldErrors.merchantName ? 'error' : ''}
                />
                {fieldErrors.merchantName && <div className="field-error">{fieldErrors.merchantName}</div>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="merchantCity" className="required">Merchant City</label>
                <input
                  id="merchantCity"
                  name="merchantCity"
                  type="text"
                  value={form.merchantCity}
                  onChange={handleChange}
                  className={fieldErrors.merchantCity ? 'error' : ''}
                />
                {fieldErrors.merchantCity && <div className="field-error">{fieldErrors.merchantCity}</div>}
              </div>
              <div className="form-group">
                <label htmlFor="merchantZip" className="required">Merchant ZIP</label>
                <input
                  id="merchantZip"
                  name="merchantZip"
                  type="text"
                  value={form.merchantZip}
                  onChange={handleChange}
                  className={fieldErrors.merchantZip ? 'error' : ''}
                />
                {fieldErrors.merchantZip && <div className="field-error">{fieldErrors.merchantZip}</div>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="origTimestamp" className="required">Original Date</label>
                <input
                  id="origTimestamp"
                  name="origTimestamp"
                  type="date"
                  value={form.origTimestamp}
                  onChange={handleChange}
                  className={fieldErrors.origTimestamp ? 'error' : ''}
                />
                {fieldErrors.origTimestamp && <div className="field-error">{fieldErrors.origTimestamp}</div>}
              </div>
              <div className="form-group">
                <label htmlFor="procTimestamp" className="required">Processing Date</label>
                <input
                  id="procTimestamp"
                  name="procTimestamp"
                  type="date"
                  value={form.procTimestamp}
                  onChange={handleChange}
                  className={fieldErrors.procTimestamp ? 'error' : ''}
                />
                {fieldErrors.procTimestamp && <div className="field-error">{fieldErrors.procTimestamp}</div>}
              </div>
            </div>

            <div className="btn-group mt-24">
              <button type="submit" className="btn btn-primary">
                Review Transaction
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate('/transactions')}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
