import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getCardDetail, updateCard } from '../api';

function maskCardNumber(num) {
  if (!num) return '****';
  const str = String(num).replace(/\s/g, '');
  if (str.length <= 4) return str;
  const last4 = str.slice(-4);
  return '**** **** **** ' + last4;
}

export default function CardUpdate() {
  const { cardNum } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [card, setCard] = useState(null);
  const [form, setForm] = useState({
    embossedName: '',
    expirationMonth: '',
    expirationYear: '',
    activeStatus: 'Y',
  });

  useEffect(() => {
    loadCard();
  }, [cardNum]);

  const loadCard = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getCardDetail(cardNum);
      setCard(data);

      let month = '';
      let year = '';
      if (data.expirationDate) {
        const parts = data.expirationDate.split('-');
        if (parts.length >= 2) {
          year = parts[0];
          month = parts[1];
        } else if (data.expirationDate.includes('/')) {
          const slashParts = data.expirationDate.split('/');
          month = slashParts[0];
          year = slashParts[1];
        }
      }

      setForm({
        embossedName: data.embossedName || '',
        expirationMonth: month,
        expirationYear: year,
        activeStatus: data.activeStatus || 'Y',
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

    if (!form.embossedName.trim()) {
      errors.embossedName = 'Embossed name is required.';
    }

    const monthNum = parseInt(form.expirationMonth, 10);
    if (!form.expirationMonth || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      errors.expirationMonth = 'Month must be between 1 and 12.';
    }

    const yearNum = parseInt(form.expirationYear, 10);
    if (!form.expirationYear || isNaN(yearNum) || yearNum < 1950 || yearNum > 2099) {
      errors.expirationYear = 'Year must be between 1950 and 2099.';
    }

    if (form.activeStatus !== 'Y' && form.activeStatus !== 'N') {
      errors.activeStatus = 'Status must be Y or N.';
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
      const month = form.expirationMonth.padStart(2, '0');
      const expirationDate = `${form.expirationYear}-${month}-01`;

      await updateCard(cardNum, {
        embossedName: form.embossedName.trim(),
        expirationDate,
        activeStatus: form.activeStatus,
      });
      setSuccess('Card updated successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Loading card...</div>;
  if (error && !card) return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Update Card</h1>
        <p>Card: {maskCardNumber(cardNum)}</p>
      </div>

      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Card Number</label>
              <div className="form-static card-number-masked">{maskCardNumber(cardNum)}</div>
            </div>
            <div className="form-group">
              <label>Account ID</label>
              <div className="form-static">{card?.accountId}</div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="embossedName" className="required">Embossed Name</label>
              <input
                id="embossedName"
                name="embossedName"
                type="text"
                value={form.embossedName}
                onChange={handleChange}
                className={fieldErrors.embossedName ? 'error' : ''}
              />
              {fieldErrors.embossedName && <div className="field-error">{fieldErrors.embossedName}</div>}
            </div>
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
              {fieldErrors.activeStatus && <div className="field-error">{fieldErrors.activeStatus}</div>}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="expirationMonth" className="required">Expiration Month</label>
              <input
                id="expirationMonth"
                name="expirationMonth"
                type="number"
                min="1"
                max="12"
                value={form.expirationMonth}
                onChange={handleChange}
                placeholder="MM"
                className={fieldErrors.expirationMonth ? 'error' : ''}
              />
              {fieldErrors.expirationMonth && <div className="field-error">{fieldErrors.expirationMonth}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="expirationYear" className="required">Expiration Year</label>
              <input
                id="expirationYear"
                name="expirationYear"
                type="number"
                min="1950"
                max="2099"
                value={form.expirationYear}
                onChange={handleChange}
                placeholder="YYYY"
                className={fieldErrors.expirationYear ? 'error' : ''}
              />
              {fieldErrors.expirationYear && <div className="field-error">{fieldErrors.expirationYear}</div>}
            </div>
          </div>

          <div className="btn-group mt-24">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Update Card'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/cards/${cardNum}`)}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
