import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addUser } from '../api';

export default function UserAdd() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    userId: '',
    password: '',
    firstName: '',
    lastName: '',
    userType: 'U',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const errors = {};
    if (!form.userId.trim()) errors.userId = 'User ID is required.';
    if (!form.password.trim()) errors.password = 'Password is required.';
    if (!form.firstName.trim()) errors.firstName = 'First name is required.';
    if (!form.lastName.trim()) errors.lastName = 'Last name is required.';
    if (form.userType !== 'A' && form.userType !== 'U') {
      errors.userType = 'User type must be Admin (A) or User (U).';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!validate()) return;

    setSubmitting(true);
    try {
      await addUser({
        userId: form.userId.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        userType: form.userType,
      });
      setSuccess(`User "${form.userId.trim()}" created successfully.`);
      setForm({
        userId: '',
        password: '',
        firstName: '',
        lastName: '',
        userType: 'U',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Add User</h1>
        <p>Create a new system user</p>
      </div>

      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="userId" className="required">User ID</label>
              <input
                id="userId"
                name="userId"
                type="text"
                value={form.userId}
                onChange={handleChange}
                className={fieldErrors.userId ? 'error' : ''}
              />
              {fieldErrors.userId && <div className="field-error">{fieldErrors.userId}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="password" className="required">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
                className={fieldErrors.password ? 'error' : ''}
              />
              {fieldErrors.password && <div className="field-error">{fieldErrors.password}</div>}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="firstName" className="required">First Name</label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                value={form.firstName}
                onChange={handleChange}
                className={fieldErrors.firstName ? 'error' : ''}
              />
              {fieldErrors.firstName && <div className="field-error">{fieldErrors.firstName}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="lastName" className="required">Last Name</label>
              <input
                id="lastName"
                name="lastName"
                type="text"
                value={form.lastName}
                onChange={handleChange}
                className={fieldErrors.lastName ? 'error' : ''}
              />
              {fieldErrors.lastName && <div className="field-error">{fieldErrors.lastName}</div>}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="userType" className="required">User Type</label>
              <select
                id="userType"
                name="userType"
                value={form.userType}
                onChange={handleChange}
                className={fieldErrors.userType ? 'error' : ''}
              >
                <option value="U">User</option>
                <option value="A">Admin</option>
              </select>
              {fieldErrors.userType && <div className="field-error">{fieldErrors.userType}</div>}
            </div>
          </div>

          <div className="btn-group mt-24">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create User'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/users')}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
