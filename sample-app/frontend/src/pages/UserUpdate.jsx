import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getUser, updateUser, deleteUser } from '../api';

export default function UserUpdate() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [form, setForm] = useState({
    password: '',
    firstName: '',
    lastName: '',
    userType: 'U',
  });

  useEffect(() => {
    loadUser();
  }, [id]);

  const loadUser = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getUser(id);
      setForm({
        password: '',
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        userType: data.userType || 'U',
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

    setSaving(true);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        userType: form.userType,
      };
      if (form.password.trim()) {
        payload.password = form.password;
      }
      await updateUser(id, payload);
      setSuccess('User updated successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      await deleteUser(id);
      navigate('/users');
    } catch (err) {
      setError(err.message);
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="loading">Loading user...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Update User</h1>
        <p>User ID: {id}</p>
      </div>

      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>User ID</label>
              <div className="form-static">{id}</div>
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
                placeholder="Leave blank to keep current"
              />
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
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Update User'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/users')}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete User
            </button>
          </div>
        </form>
      </div>

      {showDeleteConfirm && (
        <div className="confirmation-box">
          <h3>Confirm Delete</h3>
          <p>Are you sure you want to delete user <strong>{id}</strong>? This action cannot be undone.</p>
          <div className="btn-group mt-16">
            <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Yes, Delete'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
            >
              No, Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
