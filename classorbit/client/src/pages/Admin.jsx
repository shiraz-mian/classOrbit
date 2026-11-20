import { useEffect, useState } from 'react';
import { ShieldCheck, Search } from 'lucide-react';
import { Avatar, Loader, Button } from '../components/ui';
import { api } from '../services/api';
export default function Admin({ data, notify, refresh }) {
  const [users, setUsers] = useState(null),
    [search, setSearch] = useState(''),
    [busy, setBusy] = useState('');
  const load = () => api('/admin/users').then(setUsers);
  useEffect(() => {
    load().catch((e) => notify(e.message, 'error'));
  }, []);
  async function change(user, role) {
    setBusy(user.id);
    try {
      await api('/admin/users/' + user.id + '/role', { method: 'PATCH', body: { role } });
      await Promise.all([load(), refresh()]);
      notify('Role updated for ' + user.name + '.');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function teachingAccess(user) {
    setBusy(user.id);
    try {
      const approved = !user.instructorApproved;
      await api('/admin/users/' + user.id + '/instructor-access', {
        method: 'PATCH',
        body: { approved },
      });
      await Promise.all([load(), refresh()]);
      notify(
        approved
          ? 'Teaching access approved for ' + user.name + '.'
          : 'Teaching access revoked for ' + user.name + '.',
      );
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  const pending =
    users?.filter((u) => u.role === 'INSTRUCTOR' && !u.instructorApproved).length || 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A WELL-RUN LEARNING COMMUNITY</span>
          <h1>People make the platform.</h1>
          <p>Manage roles and approve instructor teaching access.</p>
        </div>
        <span className="certificate-heading-icon">
          <ShieldCheck size={35} />
        </span>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>People & permissions</h2>
            <p className="muted">
              {pending} instructor{pending === 1 ? '' : 's'} awaiting teaching approval
            </p>
          </div>
          <label className="search-box">
            <Search size={17} />
            <input
              aria-label="Search people"
              placeholder="Find a person…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {!users ? (
          <Loader />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Role</th>
                  <th>Teaching access</th>
                </tr>
              </thead>
              <tbody>
                {users
                  .filter((u) =>
                    (u.name + ' ' + u.email).toLowerCase().includes(search.toLowerCase()),
                  )
                  .sort(
                    (a, b) =>
                      Number(b.role === 'INSTRUCTOR' && !b.instructorApproved) -
                        Number(a.role === 'INSTRUCTOR' && !a.instructorApproved) ||
                      a.name.localeCompare(b.name),
                  )
                  .map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span className="user-cell">
                          <Avatar name={u.name} />
                          <b>{u.name}</b>
                          {u.id === data.user.id && <small>You</small>}
                        </span>
                      </td>
                      <td>{u.email}</td>
                      <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td>
                        <select
                          aria-label={'Role for ' + u.name}
                          disabled={u.id === data.user.id || busy === u.id}
                          value={u.role}
                          onChange={(e) => change(u, e.target.value)}
                        >
                          <option value="STUDENT">Student</option>
                          <option value="INSTRUCTOR">Instructor</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      </td>
                      <td>
                        {u.role === 'INSTRUCTOR' ? (
                          <div className="teaching-access">
                            <span
                              className={
                                'teaching-status ' + (u.instructorApproved ? 'approved' : 'pending')
                              }
                            >
                              {u.instructorApproved ? 'Approved' : 'Awaiting approval'}
                            </span>
                            <Button
                              secondary
                              disabled={busy === u.id}
                              onClick={() => teachingAccess(u)}
                              aria-label={
                                (u.instructorApproved ? 'Revoke' : 'Approve') +
                                ' teaching access for ' +
                                u.name
                              }
                            >
                              {busy === u.id
                                ? 'Saving…'
                                : u.instructorApproved
                                  ? 'Revoke access'
                                  : 'Approve teaching'}
                            </Button>
                          </div>
                        ) : (
                          <span className="muted">
                            {u.role === 'ADMIN' ? 'Full access' : 'Student account'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
