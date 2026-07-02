import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAccountDetail, updateAccount } from '../api';

function formatCurrency(val) {
  if (val === null || val === undefined) return '$0.00';
  return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AccountUpdate() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [account, setAccount] = useState(null);
  const [form, setForm] = useState({
    activeStatus: 'Y',
    creditLimit: '',
    cashCreditLimit: '',
    expirationDate: '',
    groupId: '',
  });

  useEffect(() => {
    loadAccount();
  }, [id]);

  const loadAccount = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAccountDetail(id);
      setAccount(data);
      setForm({
        activeStatus: data.activeStatus || 'Y',
        creditLimit: data.creditLimit !== undefined ? String(data.creditLimit) : '',
        cashCreditLimit: data.cashCreditLimit !== undefined ? String(data.cashCreditLimit) : '',
        expirationDate: data.expirationDate || '',
        groupId: data.groupId || '',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const errors = {};
    if (form.creditLimit !== '' && (isNaN(Number(form.creditLimit)) || Number(form.creditLimit) < 0)) {
      errors.creditLimit = 'Credit limit must be a non-negative number.';
    }
    if (form.cashCreditLimit !== '' && (isNaN(Number(form.cashCreditLimit)) || Number(form.cashCreditLimit) < 0)) {
      errors.cashCreditLimit = 'Cash credit limit must be a non-negative number.';
    }
    if (form.expirationDate && isNaN(Date.parse(form.expirationDate))) {
      errors.expirationDate = 'Please enter a valid date.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        activeStatus: form.activeStatus,
        creditLimit: form.creditLimit !== '' ? Number(form.creditLimit) : undefined,
        cashCreditLimit: form.cashCreditLimit !== '' ? Number(form.cashCreditLimit) : undefined,
        expirationDate: form.expirationDate || undefined,
        groupId: form.groupId || undefined,
      };
      await updateAccount(id, payload);
      setSuccess('Account updated successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Loading account...</div>;
  if (error && !account) return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Update Account</h1>
        <p>Account ID: {id}</p>
      </div>

      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Account ID</label>
              <div className="form-static">{account?.accountId}</div>
            </div>
            <div className="form-group">
              <label>Open Date</label>
              <div className="form-static">{account?.openDate || '-'}</div>
            </div>
            <div className="form-group">
              <label>Current Balance</label>
              <div className="form-static">{formatCurrency(account?.currentBalance)}</div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="activeStatus">Status</label>
              <select
                id="activeStatus"
                name="activeStatus"
                value={form.activeStatus}
                onChange={handleChange}
              >
                <option value="Y">Active (Y)</option>
                <option value="N">Inactive (N)</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="creditLimit">Credit Limit</label>
              <input
                id="creditLimit"
                name="creditLimit"
                type="text"
                value={form.creditLimit}
                onChange={handleChange}
                className={fieldErrors.creditLimit ? 'error' : ''}
              />
              {fieldErrors.creditLimit && <div className="field-error">{fieldErrors.creditLimit}</div>}
            </div>

            <div className="form-group">
              <label htmlFor="cashCreditLimit">Cash Credit Limit</label>
              <input
                id="cashCreditLimit"
                name="cashCreditLimit"
                type="text"
                value={form.cashCreditLimit}
                onChange={handleChange}
                className={fieldErrors.cashCreditLimit ? 'error' : ''}
              />
              {fieldErrors.cashCreditLimit && <div className="field-error">{fieldErrors.cashCreditLimit}</div>}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="expirationDate">Expiration Date</label>
              <input
                id="expirationDate"
                name="expirationDate"
                type="date"
                value={form.expirationDate}
                onChange={handleChange}
                className={fieldErrors.expirationDate ? 'error' : ''}
              />
              {fieldErrors.expirationDate && <div className="field-error">{fieldErrors.expirationDate}</div>}
            </div>

            <div className="form-group">
              <label htmlFor="groupId">Group ID</label>
              <input
                id="groupId"
                name="groupId"
                type="text"
                value={form.groupId}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="btn-group mt-24">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Update Account'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/accounts/${id}`)}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
