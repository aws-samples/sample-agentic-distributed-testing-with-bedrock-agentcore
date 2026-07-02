import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUsers } from '../api';
import Pagination from '../components/Pagination';

export default function UserList() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadUsers(0);
  }, []);

  const loadUsers = async (pg) => {
    setLoading(true);
    setError('');
    try {
      const data = await getUsers({ page: pg, size: 10 });
      setUsers(data.content || []);
      setPage(data.page ?? pg);
      setTotalPages(data.totalPages || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    loadUsers(newPage);
  };

  return (
    <div>
      <div className="page-header flex-between">
        <div>
          <h1>User Management</h1>
          <p>Manage system users and roles</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/users/add')}>
          Add User
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && <div className="loading">Loading users...</div>}

      {!loading && users.length === 0 && !error && (
        <div className="no-data">No users found.</div>
      )}

      {!loading && users.length > 0 && (
        <div className="card">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>User ID</th>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.userId}
                    className="clickable"
                    onClick={() => navigate(`/users/${u.userId}/edit`)}
                  >
                    <td><strong>{u.userId}</strong></td>
                    <td>{u.firstName || '-'}</td>
                    <td>{u.lastName || '-'}</td>
                    <td>
                      <span className={`badge ${u.userType === 'A' || u.userType === 'ADMIN' ? 'badge-admin' : 'badge-user'}`}>
                        {u.userType === 'A' || u.userType === 'ADMIN' ? 'Admin' : 'User'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={handlePageChange} />
        </div>
      )}
    </div>
  );
}
