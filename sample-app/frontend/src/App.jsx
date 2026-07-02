import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import MainMenu from './pages/MainMenu';
import AccountList from './pages/AccountList';
import AccountView from './pages/AccountView';
import AccountUpdate from './pages/AccountUpdate';
import CardList from './pages/CardList';
import CardDetail from './pages/CardDetail';
import CardUpdate from './pages/CardUpdate';
import TransactionList from './pages/TransactionList';
import TransactionDetail from './pages/TransactionDetail';
import TransactionAdd from './pages/TransactionAdd';
import BillPayment from './pages/BillPayment';
import Reports from './pages/Reports';
import UserList from './pages/UserList';
import UserAdd from './pages/UserAdd';
import UserUpdate from './pages/UserUpdate';
import BatchOperations from './pages/BatchOperations';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/menu" element={<MainMenu />} />
          <Route path="/accounts" element={<AccountList />} />
          <Route path="/accounts/:id" element={<AccountView />} />
          <Route path="/accounts/:id/edit" element={<AccountUpdate />} />
          <Route path="/cards" element={<CardList />} />
          <Route path="/cards/:cardNum" element={<CardDetail />} />
          <Route path="/cards/:cardNum/edit" element={<CardUpdate />} />
          <Route path="/transactions" element={<TransactionList />} />
          <Route path="/transactions/add" element={<TransactionAdd />} />
          <Route path="/transactions/:id" element={<TransactionDetail />} />
          <Route path="/billing" element={<BillPayment />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/users" element={<UserList />} />
          <Route path="/users/add" element={<UserAdd />} />
          <Route path="/users/:id" element={<UserUpdate />} />
          <Route path="/users/:id/edit" element={<UserUpdate />} />
          <Route path="/batch" element={<BatchOperations />} />
        </Route>
      </Route>
    </Routes>
  );
}
